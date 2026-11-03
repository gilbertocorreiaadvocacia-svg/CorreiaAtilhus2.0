import { achar, atualizar, inserir, listar, mensagensDe, mensagensSemGuardar } from '../nucleo/banco.js';
import { lancar } from '../nucleo/creditos.js';
import { diaDe } from '../nucleo/relatorio-do-fim-de-semana.js';
import { novoId } from '../nucleo/util.js';
import { CUSTO } from '../config.js';
import { FUSO } from '../automacao/horario.js';
import { conversar, provedorDisponivel } from './provedores.js';
import { classificarErroDaIa, situacaoDaIa } from './saude-da-ia.js';

/**
 * O agente de resumo da conversa (pedido do escritorio, 03/11/2026): um resumo
 * de cada conversa, guardado e mostrado na aba de dados da conversa, para quem
 * abre saber em dez segundos quem e o cliente, o que ele quer e em que pe esta.
 *
 * Nao e um agente de conversa: nao esta em `agentes`, nao fala com cliente e
 * nao entra no roteamento. Vive em `workspace.resumoDasConversas` (configuracao)
 * e em `resumosDasConversas` (um registro por conversa). O resumo NAO fica no
 * contato de proposito: a lista de conversas e o que a tela baixa ao abrir, e
 * ela ja pesa meio megabyte.
 *
 * COMO O RESUMO NASCE
 *  - Sozinho, quando a conversa SOSSEGA: dez minutos sem mensagem nova, com pelo
 *    menos tres mensagens, e (se ja tem resumo) pelo menos duas novas. Resumir a
 *    cada mensagem gastaria uma chamada por "ok"; esperar a conversa parar gasta
 *    uma por assunto.
 *  - Na hora, pelo botao do cartao, para qualquer conversa que a pessoa possa ver.
 *
 * O resumo seguinte ATUALIZA o anterior: recebe o resumo de antes e so as
 * mensagens novas, em vez de reler a conversa inteira. Fica mais barato e nao
 * perde o comeco de uma conversa longa.
 *
 * O QUE PROTEGE O CAIXA E O ATENDIMENTO
 *  - So conversas mexidas nos ultimos sete dias; as mais velhas, so pelo botao.
 *  - Teto por escritorio por dia, e poucas por varredura, uma de cada vez.
 *  - IA parada por credito ou chave: nao tenta, e nao mexe no episodio da IA
 *    (ia/saude-da-ia.js) — um resumo que falha nao e motivo para alarme.
 *  - Se um resumo sozinho falha por credito ou chave, o escritorio fica de fora
 *    por uma hora; falha comum espera meia hora para aquela conversa.
 *  - Sem IA, o resumo manual sai padrao (as contas da conversa em frases); o
 *    automatico simplesmente nao sai, para nao tapar o lugar do resumo de verdade.
 *
 * O texto nunca leva senha nem numero de documento: o modelo e instruido, e o
 * codigo tira de qualquer jeito toda sequencia longa de digitos.
 */

export const MINIMO_DE_MENSAGENS = 3;
export const MINIMO_DE_NOVAS = 2;
const MAXIMO_DE_MENSAGENS = 120;
const MAXIMO_POR_MENSAGEM = 700;
const MAXIMO_DE_LEITURA_DE_PDF = 1200;
const LIMITE_DAS_INSTRUCOES = 1000;
const MINUTO = 60 * 1000;
const JANELA_MS = 7 * 24 * 60 * MINUTO;
const SOSSEGO_MS = Number(process.env.CORREIA_RESUMO_SOSSEGO_MS ?? 10 * MINUTO);
const VARREDURA_MS = Number(process.env.CORREIA_RESUMO_VARREDURA_MS ?? 2 * MINUTO);
const PRIMEIRA_MS = Number(process.env.CORREIA_RESUMO_PRIMEIRA_MS ?? 4 * MINUTO);
const POR_VARREDURA = Number(process.env.CORREIA_RESUMO_POR_VARREDURA ?? 5);
const POR_DIA = Number(process.env.CORREIA_RESUMO_POR_DIA ?? 200);
const ESPERA_DA_FALHA_MS = 30 * MINUTO;
const PAUSA_POR_CREDITO_MS = 60 * MINUTO;
/* Resumo padrao (sem IA) que ja tem mais de uma hora e ganha outra chance. */
const NOVA_CHANCE_DO_PADRAO_MS = 60 * MINUTO;

const ROTULOS = ['Quem é', 'O que busca', 'Em que pé está', 'Dados e documentos', 'Próximo passo'];

/* ------------------------------------------------------------- configuracao */

export function configDoResumo(workspaceId) {
  const guardado = achar('workspaces', workspaceId)?.resumoDasConversas || {};
  return {
    /* Ligado por padrao: foi o que o escritorio pediu, e o teto diario segura o gasto. */
    automatico: guardado.automatico !== false,
    instrucoes: String(guardado.instrucoes || ''),
  };
}

export function salvarConfigDoResumo(workspaceId, { automatico, instrucoes }) {
  const atual = configDoResumo(workspaceId);
  const novo = {
    automatico: automatico === undefined ? atual.automatico : automatico === true,
    instrucoes: instrucoes === undefined ? atual.instrucoes : String(instrucoes || '').slice(0, LIMITE_DAS_INSTRUCOES).trim(),
  };
  atualizar('workspaces', workspaceId, { resumoDasConversas: novo });
  return novo;
}

/* ------------------------------------------------------------------ a conversa */

const horaCurta = (iso) =>
  new Date(iso).toLocaleString('pt-BR', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit', timeZone: FUSO });

/** As mensagens que contam para o resumo: sem nota interna e sem envio que falhou. */
export function mensagensDoResumo(mensagens) {
  return mensagens.filter((m) => !m.nota && m.situacao !== 'erro').sort((a, b) => (a.criadoEm < b.criadoEm ? -1 : a.criadoEm > b.criadoEm ? 1 : 0));
}

function falaDe(m) {
  if (m.direcao === 'entrada') return 'Cliente';
  if (m.autor?.tipo === 'agente') return 'Escritório (IA)';
  if (m.autor?.tipo === 'sistema' || m.autor?.tipo === 'api') return 'Sistema';
  return 'Escritório (equipe)';
}

function textoDaMensagem(m) {
  const rotulo = m.midia ? `[${m.tipo}: ${m.midia.nome || 'arquivo'}]` : '';
  let texto = m.conteudo || rotulo;
  if (m.direcao === 'entrada' && m.leitura) {
    texto = `${m.conteudo && m.conteudo !== m.midia?.nome ? `${m.conteudo} ` : ''}${rotulo} (o que está escrito nele: ${String(m.leitura).slice(0, MAXIMO_DE_LEITURA_DE_PDF)})`;
  }
  return String(texto || `[${m.tipo || 'mensagem'}]`).replace(/\s+/g, ' ').trim().slice(0, MAXIMO_POR_MENSAGEM);
}

const transcricao = (mensagens) => mensagens.map((m) => `[${horaCurta(m.criadoEm)}] ${falaDe(m)}: ${textoDaMensagem(m)}`).join('\n');

/** Os campos que o cliente preencheu, sem o que nao pode aparecer num resumo. */
function dadosColetados(contato) {
  return Object.entries(contato.variaveis || {})
    .filter(([campo, valor]) => valor && !/senha|password|token|cpf|rg\b|nit\b|pis\b/i.test(campo))
    .slice(0, 12)
    .map(([campo, valor]) => `${campo}: ${String(valor).slice(0, 120)}`);
}

/** Tira senha e numero de documento que tenham escapado: toda sequencia longa de digitos vira "[número omitido]". */
export function redigir(texto) {
  return String(texto || '').replace(/\d[\d.\-/ ]{7,}\d/g, (trecho) => (trecho.replace(/\D/g, '').length >= 9 ? '[número omitido]' : trecho));
}

/** "Rotulo: texto" em campos; o que o modelo escrever fora do formato fica como texto livre. */
export function lerCampos(texto) {
  const campos = [];
  for (const linha of String(texto || '').split('\n')) {
    const casou = /^\s*[-*•]?\s*\**(Quem é|O que busca|Em que pé está|Dados e documentos|Próximo passo)\**\s*:\s*\**\s*(.+?)\s*$/i.exec(linha);
    if (!casou) continue;
    const rotulo = ROTULOS.find((r) => r.toLowerCase() === casou[1].toLowerCase());
    if (rotulo && casou[2]) campos.push({ rotulo, texto: casou[2] });
  }
  return campos;
}

/* ------------------------------------------------------------- o texto do agente */

const REGRAS = `Você escreve o resumo de uma conversa de atendimento de um escritório de advocacia, para a equipe interna que vai abrir essa conversa. Quem lê tem dez segundos: o resumo diz quem é o cliente, o que ele busca e em que pé está.

REGRAS QUE NÃO TÊM EXCEÇÃO
1. Use SOMENTE o que está na conversa e nos dados abaixo. Não invente nada. Se um dado não aparece, não o cite e omita a linha dele.
2. Nunca escreva senha (inclusive a do gov.br e do Meu INSS) nem número de documento (CPF, RG, NIT, PIS). Se o cliente passou a senha ou um documento, diga apenas que passou.
3. Não dê opinião jurídica, não avalie o direito do cliente e não prometa resultado.
4. Português do Brasil, direto, frases curtas, sem enfeite. No máximo 110 palavras no total.
5. Se houver "RESUMO ANTERIOR", atualize-o com as mensagens novas: mantenha o que continua valendo e corrija o que mudou. Não repita o que já está nele só por repetir.
6. "Em que pé está" diz onde a conversa parou e quem deve a próxima fala (o cliente ou o escritório).

FORMATO
Exatamente estas linhas, cada uma em uma linha só, nesta ordem, e omita a linha cujo dado não existe:
Quem é: ...
O que busca: ...
Em que pé está: ...
Dados e documentos: ...
Próximo passo: ...`;

function montarSistema(workspaceId) {
  const { instrucoes } = configDoResumo(workspaceId);
  return [REGRAS, instrucoes ? `INSTRUÇÕES DO ESCRITÓRIO (valem desde que não contrariem as regras acima):\n${instrucoes}` : ''].filter(Boolean).join('\n\n');
}

function pedido(contato, anterior, mensagens) {
  const status = contato.statusId ? achar('status', contato.statusId)?.nome : null;
  const dados = dadosColetados(contato);
  return [
    `Cliente: ${contato.nome || 'sem nome'}${contato.canal && contato.canal !== 'whatsapp' ? ` (pelo ${contato.canal})` : ''}.`,
    status ? `Etapa do funil: ${status}.` : null,
    contato.responsavel?.nome ? `Quem atende agora: ${contato.responsavel.nome}.` : null,
    dados.length ? `Dados que o sistema já guardou:\n${dados.join('\n')}` : null,
    anterior ? `RESUMO ANTERIOR (até ${horaCurta(anterior.ateEm)}):\n${anterior.texto}` : null,
    anterior ? `MENSAGENS NOVAS, depois do resumo anterior:\n${transcricao(mensagens)}` : `CONVERSA:\n${transcricao(mensagens)}`,
  ]
    .filter(Boolean)
    .join('\n\n');
}

/** O resumo sem IA: as contas da conversa em frases, no mesmo formato. */
export function resumoPadrao(contato, mensagens) {
  const entradas = mensagens.filter((m) => m.direcao === 'entrada');
  const saidas = mensagens.filter((m) => m.direcao === 'saida');
  const status = contato.statusId ? achar('status', contato.statusId)?.nome : null;
  const primeira = entradas[0] ? textoDaMensagem(entradas[0]).slice(0, 160) : null;
  const ultima = mensagens[mensagens.length - 1];
  const dados = dadosColetados(contato);
  const campos = [{ rotulo: 'Quem é', texto: `${contato.nome || 'Cliente sem nome'}${contato.canal && contato.canal !== 'whatsapp' ? `, pelo ${contato.canal}` : ''}.` }];
  if (primeira) campos.push({ rotulo: 'O que busca', texto: `Começou dizendo: “${primeira}”.` });
  campos.push({
    rotulo: 'Em que pé está',
    texto: `${status ? `Etapa ${status}. ` : ''}${entradas.length} ${entradas.length === 1 ? 'mensagem' : 'mensagens'} do cliente e ${saidas.length} do escritório; a última é de ${horaCurta(ultima.criadoEm)}${ultima.direcao === 'entrada' ? ' e é do cliente.' : '.'}`,
  });
  if (dados.length) campos.push({ rotulo: 'Dados e documentos', texto: dados.slice(0, 6).join('; ') + '.' });
  if (ultima.direcao === 'entrada') campos.push({ rotulo: 'Próximo passo', texto: 'O cliente falou por último e espera resposta.' });
  return campos;
}

/* ------------------------------------------------------------- guardar e ler */

export function resumoDe(contatoId) {
  return achar('resumosDasConversas', { contatoId });
}

/**
 * O que a tela precisa saber da conversa: o resumo guardado, quantas mensagens
 * chegaram depois dele, e se ja da para resumir.
 */
export function situacaoDoResumo(contato) {
  const resumo = resumoDe(contato.id);
  const mensagens = mensagensDoResumo(mensagensDe(contato.id));
  const novas = resumo ? mensagens.filter((m) => m.criadoEm > resumo.ateEm).length : mensagens.length;
  return {
    resumo: resumo
      ? { campos: resumo.campos, texto: resumo.texto, geradoEm: resumo.geradoEm, usouIa: resumo.usouIa, avisoDaIa: resumo.avisoDaIa, origem: resumo.origem, mensagens: resumo.mensagens }
      : null,
    novas,
    totalDeMensagens: mensagens.length,
    podeGerar: mensagens.length >= MINIMO_DE_MENSAGENS,
    gerando: gerandoAgora.has(contato.id),
  };
}

function guardar(contato, dados) {
  const existente = resumoDe(contato.id);
  const registro = { workspaceId: contato.workspaceId, contatoId: contato.id, ...dados };
  if (existente) return atualizar('resumosDasConversas', existente.id, registro);
  return inserir('resumosDasConversas', { id: novoId('rsm'), ...registro });
}

/* ---------------------------------------------------------------- gerar */

const gerandoAgora = new Set();
/* Conversa -> quando pode tentar de novo depois de uma falha. */
const esperaPorConversa = new Map();
/* Escritorio -> ate quando fica de fora (credito ou chave recusados). */
const pausaPorEscritorio = new Map();
/* "escritorio:dia" -> quantos resumos sozinhos ja saíram. */
const geradosNoDia = new Map();
/* Conversa -> a ultima mensagem que a varredura ja olhou e achou sem o que resumir. */
const jaOlhadas = new Map();

const chaveDoDia = (workspaceId, agora) => `${workspaceId}:${diaDe(agora)}`;

const semSegredo = (texto) =>
  String(texto || '')
    .replace(/sk-[A-Za-z0-9_-]{6,}/g, 'sk-…')
    .replace(/\d{6,}/g, '#')
    .slice(0, 160);

/**
 * Escreve (ou atualiza) o resumo de uma conversa e guarda. `origem` e 'manual'
 * (a pessoa pediu) ou 'automatico'. Devolve o registro guardado; no automatico,
 * devolve null quando a IA nao respondeu (nada e guardado, e a conversa espera).
 * Uma conversa por vez: o segundo pedido recebe erro `ocupado`.
 */
export async function gerarResumo(contato, { origem = 'manual', agora = new Date() } = {}) {
  if (gerandoAgora.has(contato.id)) {
    throw Object.assign(new Error('Já estou resumindo esta conversa. Aguarde alguns instantes.'), { ocupado: true });
  }
  gerandoAgora.add(contato.id);
  try {
    const todas = mensagensDoResumo(mensagensSemGuardar(contato.id));
    if (todas.length < MINIMO_DE_MENSAGENS) {
      throw Object.assign(new Error('Ainda há poucas mensagens para resumir.'), { poucasMensagens: true });
    }
    const anterior = resumoDe(contato.id);
    const novas = anterior ? todas.filter((m) => m.criadoEm > anterior.ateEm) : todas;
    /* So o resumo FEITO PELA IA serve de base: o padrao e so contagem, e atualizar
       contagem com texto de modelo nao acrescenta nada. Sem base, le a conversa. */
    const base = anterior?.usouIa && novas.length ? anterior : null;
    const lidas = (base ? novas : todas).slice(-MAXIMO_DE_MENSAGENS);
    const ateEm = todas[todas.length - 1].criadoEm;

    const modeloId = achar('integracoes', { workspaceId: contato.workspaceId })?.ia?.modeloResumo || 'claude-sonnet-5';
    let campos = null;
    let textoLivre = null;
    let avisoDaIa = null;
    let usouIa = false;

    if (!provedorDisponivel(modeloId, contato.workspaceId)) {
      avisoDaIa = 'A IA não está configurada neste escritório; este é o resumo padrão, só com as contas da conversa.';
    } else {
      try {
        const resposta = await conversar({
          modeloId,
          workspaceId: contato.workspaceId,
          sistema: montarSistema(contato.workspaceId),
          mensagens: [{ papel: 'usuario', texto: pedido(contato, base, lidas) }],
        });
        const texto = redigir(String(resposta.texto || '').trim());
        const lidos = lerCampos(texto);
        if (lidos.length >= 2) {
          campos = lidos;
        } else if (texto.length >= 40) {
          textoLivre = texto;
        }
        if (campos || textoLivre) {
          usouIa = true;
          lancar(contato.workspaceId, contato.id, 'resumo_ia', CUSTO.processamentoIA);
        } else {
          avisoDaIa = 'A IA não devolveu um resumo utilizável; este é o resumo padrão, só com as contas da conversa.';
        }
      } catch (erro) {
        const classe = classificarErroDaIa(erro);
        if (origem === 'automatico') {
          esperaPorConversa.set(contato.id, agora.getTime() + ESPERA_DA_FALHA_MS);
          if (classe === 'credito' || classe === 'chave') pausaPorEscritorio.set(contato.workspaceId, agora.getTime() + PAUSA_POR_CREDITO_MS);
          throw Object.assign(new Error(semSegredo(erro.message)), { iaFalhou: true, classe });
        }
        avisoDaIa = `A IA não respondeu (${semSegredo(erro.message)}); este é o resumo padrão, só com as contas da conversa.`;
      }
    }

    if (!usouIa && origem === 'automatico') {
      /* Resposta inutil: espera, para a varredura nao chamar a IA de novo a cada passada. */
      esperaPorConversa.set(contato.id, agora.getTime() + ESPERA_DA_FALHA_MS);
      return null;
    }
    /* Pedido manual que a IA nao atendeu, e ja havia um resumo FEITO PELA IA: ele
       continua. O resumo padrao so entra onde nao ha nenhum, ou so ha outro padrao. */
    if (!usouIa && anterior?.usouIa) throw Object.assign(new Error(avisoDaIa), { iaFalhou: true });
    if (!usouIa) campos = resumoPadrao(contato, todas);
    if (campos) campos = campos.map((c) => ({ ...c, texto: redigir(c.texto) }));

    return guardar(contato, {
      origem,
      geradoEm: agora.toISOString(),
      ateEm,
      mensagens: todas.length,
      campos,
      texto: campos ? campos.map((c) => `${c.rotulo}: ${c.texto}`).join('\n') : textoLivre,
      usouIa,
      avisoDaIa,
      modeloId: usouIa ? modeloId : null,
    });
  } finally {
    gerandoAgora.delete(contato.id);
  }
}

/* ---------------------------------------------------- a varredura que resume sozinha */

function candidatas(workspaceId, agora) {
  const sossegou = new Date(agora.getTime() - SOSSEGO_MS).toISOString();
  const recente = new Date(agora.getTime() - JANELA_MS).toISOString();
  const quando = agora.getTime();
  return listar('contatos', { workspaceId })
    .filter((c) => {
      if (c.grupo || !c.ultimaMensagemEm) return false;
      if (c.ultimaMensagemEm > sossegou || c.ultimaMensagemEm < recente) return false;
      if ((esperaPorConversa.get(c.id) || 0) > quando) return false;
      if (jaOlhadas.get(c.id) === c.ultimaMensagemEm) return false;
      const resumo = resumoDe(c.id);
      if (!resumo) return true;
      if (c.ultimaMensagemEm > resumo.ateEm) return true;
      /* O resumo padrao de antes ganha outra chance com a IA, no maximo de hora em hora. */
      return !resumo.usouIa && quando - Date.parse(resumo.geradoEm) > NOVA_CHANCE_DO_PADRAO_MS;
    })
    .sort((a, b) => (a.ultimaMensagemEm < b.ultimaMensagemEm ? 1 : -1));
}

/**
 * Uma passada: resume as conversas que sossegaram. Devolve os resumos gerados.
 * Poucas por vez, uma de cada vez, e para quando o teto do dia chega.
 */
export async function varrerResumos(agora = new Date()) {
  const gerados = [];
  for (const workspace of listar('workspaces')) {
    if (!configDoResumo(workspace.id).automatico) continue;
    if ((pausaPorEscritorio.get(workspace.id) || 0) > agora.getTime()) continue;
    const modeloId = achar('integracoes', { workspaceId: workspace.id })?.ia?.modeloResumo || 'claude-sonnet-5';
    if (!provedorDisponivel(modeloId, workspace.id)) continue;
    if (situacaoDaIa(workspace.id).problema) continue;

    const chave = chaveDoDia(workspace.id, agora);
    let feitos = 0;
    for (const contato of candidatas(workspace.id, agora)) {
      if (feitos >= POR_VARREDURA || (geradosNoDia.get(chave) || 0) >= POR_DIA) break;
      if ((pausaPorEscritorio.get(workspace.id) || 0) > agora.getTime()) break;

      const mensagens = mensagensDoResumo(mensagensSemGuardar(contato.id));
      const resumo = resumoDe(contato.id);
      const novas = resumo ? mensagens.filter((m) => m.criadoEm > resumo.ateEm).length : mensagens.length;
      const retentativa = resumo && !resumo.usouIa && novas === 0;
      if (mensagens.length < MINIMO_DE_MENSAGENS || (resumo && !retentativa && novas < MINIMO_DE_NOVAS)) {
        jaOlhadas.set(contato.id, contato.ultimaMensagemEm);
        continue;
      }
      try {
        const feito = await gerarResumo(contato, { origem: 'automatico', agora });
        if (feito) {
          gerados.push(feito);
          feitos += 1;
          geradosNoDia.set(chave, (geradosNoDia.get(chave) || 0) + 1);
        }
      } catch (erro) {
        if (!erro.ocupado && !erro.poucasMensagens && !erro.iaFalhou) console.error(`[resumo] ${contato.id}: ${erro.message}`);
      }
    }
  }
  /* O mapa de dias so precisa do dia de hoje. */
  for (const chave of [...geradosNoDia.keys()]) if (!chave.endsWith(`:${diaDe(agora)}`)) geradosNoDia.delete(chave);
  return gerados;
}

let varrendo = false;

export function iniciarResumosAutomaticos() {
  const rodar = async () => {
    if (varrendo) return;
    varrendo = true;
    try {
      await varrerResumos();
    } catch (erro) {
      console.error('[resumo] varredura falhou:', erro.message);
    } finally {
      varrendo = false;
    }
  };
  /* Espera depois de subir: na implantacao os dois containers convivem alguns segundos. */
  const primeira = setTimeout(rodar, PRIMEIRA_MS);
  if (typeof primeira.unref === 'function') primeira.unref();
  const relogio = setInterval(rodar, VARREDURA_MS);
  if (typeof relogio.unref === 'function') relogio.unref();
  return relogio;
}

/** O que /api/saude diz: so contagens e datas, sem nome nem texto de resumo. */
export function resumoPublicoDosResumos(workspaceId, agora = new Date()) {
  const todos = listar('resumosDasConversas', { workspaceId });
  const ultimo = todos.reduce((maior, r) => (r.geradoEm > maior ? r.geradoEm : maior), '');
  const pausa = pausaPorEscritorio.get(workspaceId) || 0;
  return {
    automatico: configDoResumo(workspaceId).automatico,
    total: todos.length,
    comIa: todos.filter((r) => r.usouIa).length,
    padrao: todos.filter((r) => !r.usouIa).length,
    geradosHoje: geradosNoDia.get(chaveDoDia(workspaceId, agora)) || 0,
    tetoPorDia: POR_DIA,
    ultimoEm: ultimo || null,
    pausadoAte: pausa > agora.getTime() ? new Date(pausa).toISOString() : null,
  };
}
