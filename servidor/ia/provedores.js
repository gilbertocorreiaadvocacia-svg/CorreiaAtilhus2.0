import { MODELOS } from '../config.js';
import { achar, listar } from '../nucleo/banco.js';
import { normalizar } from '../nucleo/util.js';

/**
 * Tradutor entre o formato interno e o de cada provedor. O resto do sistema
 * so conhece { texto, chamadas }, trocar de modelo nao mexe no motor nem nas
 * mencoes.
 */

/**
 * Tempo maximo de uma chamada ao modelo.
 *
 * Sem isso, um `fetch` que nunca responde prende a resposta do agente para
 * sempre: o cronometro do motor ja disparou, a conversa fica com "digitando"
 * na tela e o cliente espera sem que nenhum erro apareca em lugar nenhum.
 * Sessenta segundos e folgado para 2000 tokens com ferramentas, e curto o
 * bastante para o problema virar aviso no mesmo minuto.
 *
 * A variavel de ambiente e so para o teste: um teste que espera sessenta
 * segundos de verdade para provar um timeout ninguem roda duas vezes.
 */
const TEMPO_LIMITE = Number(process.env.CORREIA_IA_TEMPO_LIMITE) || 60 * 1000;

/**
 * Onde cada provedor mora.
 *
 * No dia a dia ninguem mexe nisso: e sempre o endereco publico. A variavel
 * existe pelo mesmo motivo de CORREIA_DADOS em config.js — para o teste poder
 * apontar para um servidor de mentira. Sem ela, provar que a retentativa
 * acontece num 429 e que ela NAO acontece num 401 exigiria queimar chave de
 * verdade contra a API real, e uma retentativa nao testada e exatamente como
 * se publica um laco que repete erro permanente para sempre.
 */
export const BASE_ANTHROPIC = process.env.CORREIA_ANTHROPIC_URL || 'https://api.anthropic.com';
export const BASE_OPENAI = process.env.CORREIA_OPENAI_URL || 'https://api.openai.com';

/** Espera padrao antes da segunda tentativa, quando o provedor nao diz outra. */
const ESPERA_PADRAO = 2000;

/**
 * Codigos em que tentar de novo faz sentido.
 *
 * 429 e limite de uso, 408 e tempo esgotado, 5xx e problema do lado deles —
 * todos passam sozinhos. Fora dessa lista fica o que nao melhora repetindo:
 * 401 de chave errada, 400 de corpo invalido, 404 de modelo que nao existe.
 * Repetir esses tres so gastaria o dobro para receber o mesmo erro.
 */
function vaiPassar(status) {
  return status === 408 || status === 429 || status >= 500;
}

const dormir = (ms) => new Promise((r) => setTimeout(r, ms));

/**
 * Uma chamada HTTP ao provedor, com tempo limite e UMA segunda tentativa.
 *
 * Uma, e nao tres: do outro lado ha um cliente esperando no WhatsApp, e cada
 * tentativa custa dinheiro do escritorio. Duas chamadas cobrem o caso comum
 * (pico momentaneo, 429 de rajada) sem transformar uma indisponibilidade em
 * conta alta.
 *
 * O risco assumido e o da chamada que estourou o tempo mas foi processada do
 * outro lado: a segunda tentativa paga de novo. Aceitavel porque a alternativa
 * — desistir na primeira — deixa o cliente sem resposta, que e pior e mais
 * caro.
 */
async function chamar(url, opcoes, provedor) {
  let ultimoErro = null;

  for (let tentativa = 1; tentativa <= 2; tentativa += 1) {
    let resposta;
    try {
      resposta = await fetch(url, { ...opcoes, signal: AbortSignal.timeout(TEMPO_LIMITE) });
    } catch (erro) {
      // Tempo esgotado e queda de rede chegam aqui, e as duas passam sozinhas.
      ultimoErro =
        erro?.name === 'TimeoutError' || erro?.name === 'AbortError'
          ? new Error(`${provedor} nao respondeu em ${TEMPO_LIMITE / 1000}s`)
          : new Error(`Nao foi possivel falar com a ${provedor}: ${erro.message}`);
      if (tentativa === 2) throw ultimoErro;
      await dormir(ESPERA_PADRAO);
      continue;
    }

    if (resposta.ok) return resposta;

    const dados = await resposta.json().catch(() => ({}));
    ultimoErro = new Error(dados?.error?.message || `${provedor} respondeu ${resposta.status}`);
    ultimoErro.status = resposta.status;

    if (tentativa === 2 || !vaiPassar(resposta.status)) throw ultimoErro;

    // O provedor costuma dizer quanto esperar no 429. Obedecer isso evita
    // levar um segundo 429 por bater cedo demais. O teto de 10s existe para
    // um Retry-After exagerado nao segurar a resposta do cliente.
    const pedido = Number(resposta.headers.get('retry-after'));
    await dormir(Math.min(Number.isFinite(pedido) && pedido > 0 ? pedido * 1000 : ESPERA_PADRAO, 10_000));
  }

  throw ultimoErro;
}

export function modeloDe(id) {
  return MODELOS.find((m) => m.id === id) || MODELOS.find((m) => m.id === 'regras');
}

export function chavesDoWorkspace(workspaceId) {
  const integracoes = achar('integracoes', { workspaceId });
  return {
    anthropic: integracoes?.ia?.chaveAnthropic || process.env.ANTHROPIC_API_KEY || '',
    openai: integracoes?.ia?.chaveOpenai || process.env.OPENAI_API_KEY || '',
  };
}

/** Ha modelo utilizavel? Sem chave, o agente cai no roteiro por regras. */
export function provedorDisponivel(modeloId, workspaceId) {
  const modelo = modeloDe(modeloId);
  if (modelo.provedor === 'regras') return true;
  const chaves = chavesDoWorkspace(workspaceId);
  return Boolean(chaves[modelo.provedor]);
}

export async function conversar({ modeloId, workspaceId, sistema, mensagens, ferramentas = [] }) {
  const modelo = modeloDe(modeloId);
  const chaves = chavesDoWorkspace(workspaceId);

  if (modelo.provedor === 'anthropic' && chaves.anthropic) {
    return conversarAnthropic({ modelo, chave: chaves.anthropic, sistema, mensagens, ferramentas });
  }
  if (modelo.provedor === 'openai' && chaves.openai) {
    return conversarOpenai({ modelo, chave: chaves.openai, sistema, mensagens, ferramentas });
  }
  return { texto: null, chamadas: [], semProvedor: true };
}

/* ------------------------------------------------------------------ */

async function conversarAnthropic({ modelo, chave, sistema, mensagens, ferramentas }) {
  const corpo = {
    model: modelo.id,
    max_tokens: 2000,
    system: sistema,
    messages: mensagens.map(paraAnthropic),
  };
  if (ferramentas.length) {
    corpo.tools = ferramentas.map((f) => ({
      name: f.nome,
      description: f.descricao,
      input_schema: f.parametros || { type: 'object', properties: {} },
    }));
  }

  const resposta = await chamar(
    `${BASE_ANTHROPIC}/v1/messages`,
    {
      method: 'POST',
      headers: {
        'x-api-key': chave,
        'anthropic-version': '2023-06-01',
        'content-type': 'application/json',
      },
      body: JSON.stringify(corpo),
    },
    'Anthropic',
  );

  const dados = await resposta.json().catch(() => ({}));

  const texto = (dados.content || [])
    .filter((b) => b.type === 'text')
    .map((b) => b.text)
    .join('\n')
    .trim();

  const chamadas = (dados.content || [])
    .filter((b) => b.type === 'tool_use')
    .map((b) => ({ id: b.id, nome: b.name, argumentos: b.input || {} }));

  return { texto: texto || null, chamadas, bruto: dados.content, uso: dados.usage };
}

function paraAnthropic(mensagem) {
  if (mensagem.papel === 'ferramenta') {
    return {
      role: 'user',
      content: mensagem.resultados.map((r) => ({
        type: 'tool_result',
        tool_use_id: r.id,
        content: JSON.stringify(r.resultado),
      })),
    };
  }
  if (mensagem.papel === 'assistente' && mensagem.bruto) {
    return { role: 'assistant', content: mensagem.bruto };
  }
  if (mensagem.imagens?.length) {
    return {
      role: 'user',
      content: [
        ...mensagem.imagens.map((imagem) => ({
          type: 'image',
          source: { type: 'base64', media_type: imagem.mime, data: imagem.base64 },
        })),
        { type: 'text', text: mensagem.texto || 'Leia esta imagem.' },
      ],
    };
  }
  return {
    role: mensagem.papel === 'assistente' ? 'assistant' : 'user',
    content: mensagem.texto || '(sem conteudo)',
  };
}

/* ------------------------------------------------------------------ */

async function conversarOpenai({ modelo, chave, sistema, mensagens, ferramentas }) {
  const lista = [{ role: 'system', content: sistema }];
  for (const mensagem of mensagens) {
    if (mensagem.papel === 'ferramenta') {
      for (const r of mensagem.resultados) {
        lista.push({ role: 'tool', tool_call_id: r.id, content: JSON.stringify(r.resultado) });
      }
    } else if (mensagem.papel === 'assistente') {
      const item = { role: 'assistant', content: mensagem.texto || null };
      if (mensagem.chamadas?.length) {
        item.tool_calls = mensagem.chamadas.map((c) => ({
          id: c.id,
          type: 'function',
          function: { name: c.nome, arguments: JSON.stringify(c.argumentos) },
        }));
      }
      lista.push(item);
    } else if (mensagem.imagens?.length) {
      lista.push({
        role: 'user',
        content: [
          { type: 'text', text: mensagem.texto || 'Leia esta imagem.' },
          ...mensagem.imagens.map((imagem) => ({
            type: 'image_url',
            image_url: { url: `data:${imagem.mime};base64,${imagem.base64}` },
          })),
        ],
      });
    } else {
      lista.push({ role: 'user', content: mensagem.texto });
    }
  }

  const corpo = { model: modelo.id, messages: lista, max_tokens: 2000 };
  if (ferramentas.length) {
    corpo.tools = ferramentas.map((f) => ({
      type: 'function',
      function: { name: f.nome, description: f.descricao, parameters: f.parametros || { type: 'object', properties: {} } },
    }));
  }

  const resposta = await chamar(
    `${BASE_OPENAI}/v1/chat/completions`,
    {
      method: 'POST',
      headers: { Authorization: `Bearer ${chave}`, 'Content-Type': 'application/json' },
      body: JSON.stringify(corpo),
    },
    'OpenAI',
  );
  const dados = await resposta.json().catch(() => ({}));

  const escolha = dados.choices?.[0]?.message || {};
  const chamadas = (escolha.tool_calls || []).map((c) => ({
    id: c.id,
    nome: c.function?.name,
    argumentos: seguroJson(c.function?.arguments),
  }));

  return { texto: escolha.content || null, chamadas, uso: dados.usage };
}

function seguroJson(texto) {
  try {
    return JSON.parse(texto || '{}');
  } catch {
    return {};
  }
}

/* ------------------------------------------------------------------ */
/* Roteiro por regras, funciona sem nenhuma chave de API               */
/* ------------------------------------------------------------------ */

/**
 * Le o prompt do agente como um roteiro numerado e avanca uma etapa a cada
 * resposta do lead. Nao entende contexto, mas mantem o funil rodando e serve
 * para demonstrar o fluxo inteiro antes de plugar a IA de verdade.
 */
const ESPERA =
  'Obrigado pela mensagem! Ja registrei aqui e em instantes alguem do escritorio continua com voce.';

export function responderPorRegras({ agente, contato, historico }) {
  // So vale como template o que existe mesmo: no prompt tambem ha @status,
  // @tag e @responsavel, que nao sao mensagem para o cliente.
  const atalhos = new Set(
    listar('templates', { workspaceId: contato.workspaceId }).flatMap((t) => [
      normalizar(t.atalho),
      normalizar(t.nome),
    ]),
  );
  const passos = extrairPassos(agente.prompt || '', atalhos);
  const respostasDoLead = historico.filter((m) => m.direcao === 'entrada').length;
  const indice = Math.max(respostasDoLead - 1, 0);

  if (!passos.length || indice >= passos.length) {
    return { texto: ESPERA, chamadas: [], porRegras: true, fim: true };
  }

  const passo = passos[indice];
  const chamadas = [];

  if (passo.template) {
    chamadas.push({ id: `regra_${indice}`, nome: 'enviar_template', argumentos: { template: passo.template } });
  }

  return {
    texto: passo.fala ? passo.fala.replace(/\{\{nome\}\}/g, contato.nome || '') : null,
    chamadas,
    porRegras: true,
    fim: indice >= passos.length - 1,
  };
}

/**
 * Le o prompt como roteiro numerado e aproveita apenas o que esta entre aspas.
 *
 * Isso e proposital: a linha "Cumprimente pelo nome e envie @bemvindo" e
 * instrucao para o agente, nao fala para o cliente. Sem esse cuidado, o modo
 * por regras despejava o proprio prompt no WhatsApp do lead.
 */
function extrairPassos(prompt, atalhos) {
  const passos = [];
  for (const linha of String(prompt).split('\n')) {
    const casou = /^\s*\d+\.\s*(.+)$/.exec(linha);
    if (!casou) continue;

    const conteudo = casou[1].trim();
    const falas = [...conteudo.matchAll(/"([^"]{4,})"/g)].map((m) => m[1]);
    const template =
      [...conteudo.matchAll(/@([\wÀ-ÿ-]+)/g)]
        .map((m) => m[1])
        .find((nome) => atalhos.has(normalizar(nome))) || null;

    // Passo sem fala e sem template nao gera mensagem nenhuma.
    if (!falas.length && !template) continue;

    passos.push({ fala: falas.join('\n\n') || null, template });
  }
  return passos;
}
