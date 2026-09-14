import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { AREAS, PASTA_ARQUIVOS } from '../config.js';
import { achar, atualizar, listar, mensagensDe, registrarLog } from '../nucleo/banco.js';
import { membrosQuePodemVer } from '../nucleo/auth.js';
import { TIPOS_DE_CASO, definirMomento, tipoDeCasoDa } from '../nucleo/casos.js';
import { emitir } from '../nucleo/eventos.js';
import { aoAcontecer } from '../nucleo/ganchos.js';
import { agora, normalizar } from '../nucleo/util.js';
import { inserirNota, notificar } from '../ia/mencoes.js';

/**
 * Contrato assinado vai para o Atilhus Juri.
 *
 * Do outro lado, a edge `receber-contrato-assinado` (repositorio do Juri,
 * decisao 0068) confere a assinatura e abre o contato, o caso em A validar e a
 * tarefa da pos-venda de Timbauba. Daqui sai um pacote assinado com HMAC —
 * nenhuma chave de servico do Juri mora no Chat.
 *
 * Nada se perde: o envio que falha por rede ou erro do Juri fica na fila e e
 * tentado de novo com espera crescente. A recusa por FALHA FECHADA (o Juri diz
 * "sem pos-venda em Timbauba", "sem CPF") nao se repete sozinha: vai para a
 * equipe resolver, e o botao Reenviar tenta de novo.
 *
 * O resumo e completo (decisao do socio), com duas travas: linha que fala de
 * senha nao vai, e o CPF sai do texto — ele ja segue no campo proprio.
 */

const INTERVALO = Number(process.env.CORREIA_JURI_INTERVALO) || 60 * 1000;
const ESPERAS = (() => {
  const doAmbiente = (process.env.CORREIA_JURI_ESPERAS || '').split(',').map(Number).filter((n) => n > 0);
  return doAmbiente.length ? doAmbiente : [60000, 5 * 60000, 15 * 60000, 60 * 60000, 6 * 60 * 60000];
})();
const TEMPO_LIMITE = 30 * 1000;
const MENSAGENS_NO_RESUMO = 80;
const TETO_DO_RESUMO = 20000;

const UFS = new Set(['AC', 'AL', 'AP', 'AM', 'BA', 'CE', 'DF', 'ES', 'GO', 'MA', 'MT', 'MS', 'MG', 'PA', 'PB', 'PR', 'PE', 'PI', 'RJ', 'RN', 'RS', 'RO', 'RR', 'SC', 'SP', 'SE', 'TO']);
const SENHA = /senha|password|\bpin\b|gov\.?br.*(acesso|codigo)/i;
const CPF_NO_TEXTO = /\b\d{3}\.?\d{3}\.?\d{3}-?\d{2}\b/g;
const sistema = { tipo: 'sistema', nome: 'Atilhus Juri' };

function configuracao(workspaceId) {
  return achar('integracoes', { workspaceId })?.atilhusJuri || { url: '', segredo: '', ativo: false };
}

/** A assinatura que a edge confere: HMAC-SHA256 de "<carimbo>.<corpo>". */
export const assinar = (segredo, carimbo, corpo) =>
  crypto.createHmac('sha256', segredo).update(`${carimbo}.${corpo}`).digest('hex');

async function postar(cfg, pacote) {
  const corpo = JSON.stringify(pacote);
  const carimbo = String(Date.now());
  const controle = new AbortController();
  const prazo = setTimeout(() => controle.abort(), TEMPO_LIMITE);
  try {
    const resposta = await fetch(cfg.url, {
      method: 'POST',
      signal: controle.signal,
      headers: {
        'Content-Type': 'application/json',
        'x-atilhus-chat-carimbo': carimbo,
        'x-atilhus-chat-assinatura': assinar(cfg.segredo, carimbo, corpo),
      },
      body: corpo,
    });
    return { status: resposta.status, dados: await resposta.json().catch(() => ({})) };
  } finally {
    clearTimeout(prazo);
  }
}

/** O "Testar conexao": prova endereco e segredo sem abrir caso nenhum. */
export async function testarJuri(workspaceId) {
  const cfg = configuracao(workspaceId);
  if (!cfg.url || !cfg.segredo) return { ok: false, erro: 'Preencha o endereco e o segredo do Atilhus Juri.' };
  try {
    const { status, dados } = await postar(cfg, { ping: true });
    if (status === 200 && dados?.ping) return { ok: true };
    if (status === 401) return { ok: false, erro: 'O Atilhus Juri recusou a assinatura: confira o segredo.' };
    return { ok: false, erro: `O Atilhus Juri respondeu ${status}${dados?.erro ? ` (${dados.erro})` : ''}.` };
  } catch (erro) {
    return { ok: false, erro: `Nao consegui falar com o Atilhus Juri: ${erro.message}` };
  }
}

/* ---------------- Os dados no vocabulario do Juri ---------------- */

const ESTADOS_CIVIS = [
  ['uniao', 'uniao_estavel'],
  ['amasiad', 'uniao_estavel'],
  ['solteir', 'solteiro'],
  ['casad', 'casado'],
  ['separad', 'separado'],
  ['divorciad', 'divorciado'],
  ['viuv', 'viuvo'],
];
export function estadoCivil(texto) {
  const alvo = normalizar(texto);
  return ESTADOS_CIVIS.find(([pedaco]) => alvo.includes(pedaco))?.[1] || null;
}

export function dataIso(texto) {
  const br = /(\d{2})\/(\d{2})\/(\d{4})/.exec(String(texto || ''));
  if (br) return `${br[3]}-${br[2]}-${br[1]}`;
  return /^\d{4}-\d{2}-\d{2}/.exec(String(texto || ''))?.[0] || null;
}

/**
 * "Rua Tal, 10, Centro, Timbauba-PE, 55870-000" em campos. So devolve quando
 * acha municipio e UF de verdade: endereco partido errado e pior que endereco
 * nenhum, que a pos-venda completa ao validar.
 */
export function enderecoEmCampos(texto) {
  const bruto = String(texto || '').trim();
  if (!bruto) return null;
  const cep = /(\d{5})-?(\d{3})/.exec(bruto);
  const partes = bruto.replace(/(\d{5})-?(\d{3})/, '').split(',').map((p) => p.trim()).filter(Boolean);

  let indice = -1;
  let uf = null;
  let municipio = null;
  for (let i = partes.length - 1; i >= 0; i -= 1) {
    const achado = /^(.*?)[\s/-]+([A-Za-z]{2})$/.exec(partes[i]);
    if (achado && achado[1].trim() && UFS.has(achado[2].toUpperCase())) {
      uf = achado[2].toUpperCase();
      municipio = achado[1].trim();
      indice = i;
      break;
    }
  }
  if (!uf || indice < 1) return null;

  const antes = partes.slice(0, indice);
  let logradouro = antes[0];
  let resto = antes.slice(1);
  if (resto.length && /^(\d+[A-Za-z]?|s\/?n)$/i.test(resto[0])) {
    logradouro = `${logradouro}, ${resto[0]}`;
    resto = resto.slice(1);
  }
  return {
    logradouro,
    bairro: resto.length ? resto[resto.length - 1] : null,
    complemento: resto.length > 1 ? resto.slice(0, -1).join(', ') : null,
    municipio,
    uf,
    cep: cep ? `${cep[1]}${cep[2]}` : null,
  };
}

/** Area e especie como o Juri chama. BPC decide idoso ou deficiente pela idade. */
function casoParaOJuri(contato) {
  const etiqueta = tipoDeCasoDa(contato);
  const tipo = TIPOS_DE_CASO.find((t) => t.caso === etiqueta?.caso);
  const area = AREAS.find((a) => a.id === (contato.area || tipo?.area));
  let especieChave = tipo?.chavesJuri?.[0] || null;
  if (tipo?.caso === 'bpc') {
    const idade = Number(String(contato.variaveis?.idade || '').replace(/\D/g, ''));
    especieChave = idade > 0 ? (idade >= 65 ? 'bpc_idoso' : 'bpc_def') : null;
  }
  return { area_juri: area?.areaJuri || null, especie_chave: especieChave, especie_texto: etiqueta?.nome || null };
}

function limparTexto(texto) {
  return String(texto || '')
    .split('\n')
    .filter((linha) => !SENHA.test(linha))
    .join('\n')
    .replace(CPF_NO_TEXTO, '[CPF no cadastro]');
}

export function montarResumo(contato, contrato) {
  const quando = (iso) => new Date(iso).toLocaleString('pt-BR', { timeZone: 'America/Sao_Paulo' });
  const status = contato.statusId ? achar('status', contato.statusId) : null;
  const linhas = [
    `Atendimento pelo WhatsApp (Atilhus Chat). Contrato assinado em ${quando(contrato.assinadoEm || agora())}.`,
    `Tipo de caso: ${tipoDeCasoDa(contato)?.nome || 'nao identificado'} · Status: ${status?.nome || '-'} · Momento: ${contato.momento?.nome || '-'}`,
  ];

  const dados = Object.entries(contato.variaveis || {}).filter(([chave, valor]) => chave !== 'cpf' && String(valor).trim());
  if (dados.length) {
    linhas.push('', 'Dados coletados:');
    for (const [chave, valor] of dados) linhas.push(`- ${chave}: ${valor}`);
  }

  const passagens = (contato.passagens || []).slice(-5);
  if (passagens.length) {
    linhas.push('', 'Passagens entre atendentes:');
    for (const p of passagens) linhas.push(`- ${p.deNome || 'Equipe'} para ${p.paraNome || 'equipe'}: ${p.resumo}`);
  }

  const conversa = mensagensDe(contato.id)
    .filter((m) => !m.nota && m.conteudo)
    .slice(-MENSAGENS_NO_RESUMO);
  if (conversa.length) {
    linhas.push('', 'Conversa (mensagens mais recentes):');
    for (const m of conversa) {
      const quem = m.direcao === 'entrada' ? 'Cliente' : m.autor?.nome || 'Escritorio';
      linhas.push(`[${quando(m.criadoEm)}] ${quem}: ${String(m.conteudo).slice(0, 500)}`);
    }
  }

  return limparTexto(linhas.join('\n')).slice(0, TETO_DO_RESUMO);
}

function documentosAssinados(contrato, contato) {
  const ids = new Set(contrato.arquivosAssinados || []);
  const documentos = [];
  for (const arquivo of contato.arquivos || []) {
    if (!ids.has(arquivo.id)) continue;
    try {
      const dados = fs.readFileSync(path.join(PASTA_ARQUIVOS, arquivo.caminho));
      documentos.push({ tipo: arquivo.tipo, nome: arquivo.nome, mime: 'application/pdf', base64: dados.toString('base64') });
    } catch {
      /* arquivo sumiu do disco: segue sem ele, e a pos-venda ve na validacao */
    }
  }
  return documentos;
}

export function montarPacote(contrato, contato) {
  const v = contato.variaveis || {};
  return {
    versao: 1,
    token_documento: contrato.tokenExterno || contrato.id,
    contato: {
      nome: v.nome_completo || contato.nome,
      documento: String(v.cpf || '').replace(/\D/g, ''),
      email: v.email || null,
      nascimento: dataIso(v.nascimento),
      telefone: contato.telefone || null,
      estado_civil: estadoCivil(v.estado_civil),
      nacionalidade: v.nacionalidade || null,
      profissao: v.profissao || null,
      endereco: enderecoEmCampos(v.endereco),
    },
    caso: casoParaOJuri(contato),
    resumo: montarResumo(contato, contrato),
    documentos: documentosAssinados(contrato, contato),
  };
}

/* ---------------- Envio e fila ---------------- */

const guardar = (contrato, mudancas) => {
  const atual = achar('contratos', contrato.id);
  return atualizar('contratos', contrato.id, { juri: { ...(atual?.juri || {}), ...mudancas } });
};

const avisarEquipe = (contato, titulo, texto) => {
  for (const membro of membrosQuePodemVer(contato.workspaceId, contato)) {
    notificar(contato.workspaceId, membro.id, 'juri', titulo, texto, contato.id);
  }
};

function falhou(contrato, contato, erro) {
  const tentativas = (contrato.juri?.tentativas || 0) + 1;
  const espera = ESPERAS[Math.min(tentativas - 1, ESPERAS.length - 1)];
  guardar(contrato, {
    situacao: 'falhou',
    erro,
    tentativas,
    proximaTentativaEm: new Date(Date.now() + espera).toISOString(),
  });
  registrarLog(contrato.workspaceId, contato.id, 'juri', `Envio ao Atilhus Juri falhou (tentativa ${tentativas}): ${erro}`, sistema);
  /* Um aviso na primeira falha e depois a cada cinco: a fila continua tentando. */
  if (tentativas === 1 || tentativas % 5 === 0) {
    avisarEquipe(contato, 'Atilhus Juri fora do ar', `${contato.nome}: o caso ainda nao foi aberto no Juri. O sistema tenta de novo sozinho. (${erro})`);
  }
  emitir(contrato.workspaceId, 'contrato', { contatoId: contato.id, contratoId: contrato.id });
  return { ok: false, erro, vaiTentarDeNovo: true };
}

function recusado(contrato, contato, erro) {
  guardar(contrato, { situacao: 'recusado', erro, proximaTentativaEm: null });
  if (contato) {
    inserirNota(contato, `O Atilhus Juri recusou abrir o caso: ${erro}. Resolva o motivo e use Reenviar no cartao do contrato.`, sistema);
    registrarLog(contrato.workspaceId, contato.id, 'juri', `Atilhus Juri recusou: ${erro}`, sistema);
    avisarEquipe(contato, 'Atilhus Juri recusou o caso', `${contato.nome}: ${erro}`);
    emitir(contrato.workspaceId, 'contrato', { contatoId: contato.id, contratoId: contrato.id });
  }
  return { ok: false, erro };
}

const enviando = new Set();

/** Manda um contrato assinado. `manual` e o Reenviar da tela. */
export async function enviarAoJuri(contratoId, { manual = false } = {}) {
  if (enviando.has(contratoId)) return { ok: true, emAndamento: true };
  enviando.add(contratoId);
  try {
    const contrato = achar('contratos', contratoId);
    if (!contrato) return { ok: false, erro: 'Contrato nao encontrado.' };
    if (contrato.situacao !== 'assinado') return { ok: false, erro: 'So contrato assinado vai para o Atilhus Juri.' };
    if (contrato.juri?.situacao === 'enviado' && !manual) return { ok: true, situacao: 'enviado' };

    const contato = achar('contatos', contrato.contatoId);
    if (!contato) return recusado(contrato, null, 'a conversa deste contrato foi removida');

    const cfg = configuracao(contrato.workspaceId);
    if (!cfg.ativo || !cfg.url || !cfg.segredo) {
      guardar(contrato, { situacao: 'aguardando_configuracao', erro: null });
      return { ok: false, erro: 'Configure o Atilhus Juri em Integracoes.' };
    }

    const pacote = montarPacote(contrato, contato);
    if (pacote.contato.documento.length !== 11) return recusado(contrato, contato, 'o CPF do cliente esta faltando ou incompleto');

    let resposta;
    try {
      resposta = await postar(cfg, pacote);
    } catch (erro) {
      return falhou(contrato, contato, erro.name === 'AbortError' ? 'o Atilhus Juri nao respondeu a tempo' : erro.message);
    }

    const { status, dados } = resposta;
    if (status === 200 && dados?.ok) {
      guardar(contrato, {
        situacao: 'enviado',
        enviadoEm: agora(),
        repetido: dados.situacao === 'repetido',
        casoId: dados.caso_id || null,
        contatoJuriId: dados.contato_id || null,
        tarefaId: dados.tarefa_id || null,
        documentos: dados.documentos ?? null,
        erro: null,
        proximaTentativaEm: null,
      });
      if (dados.situacao !== 'repetido') {
        definirMomento(contato, 'Enviado ao Juri', sistema);
        inserirNota(contato, 'Enviado ao Atilhus Juri: contato cadastrado, caso em A validar e tarefa para a pos-venda.', sistema);
        registrarLog(contrato.workspaceId, contato.id, 'juri', 'Caso aberto no Atilhus Juri, em A validar', sistema);
      }
      emitir(contrato.workspaceId, 'contrato', { contatoId: contato.id, contratoId });
      return { ok: true, situacao: 'enviado', repetido: dados.situacao === 'repetido' };
    }

    /* 4xx e decisao do Juri (falha fechada, corpo invalido, assinatura): repetir
       sozinho daria o mesmo resultado. 408 e 429 sao "agora nao", e voltam a fila. */
    if (status >= 400 && status < 500 && status !== 408 && status !== 429) {
      const motivo = status === 401 ? 'assinatura recusada (confira o segredo em Integracoes)' : dados?.mensagem || dados?.erro || `resposta ${status}`;
      return recusado(contrato, contato, motivo);
    }
    return falhou(contrato, contato, dados?.erro ? `${dados.erro} (${status})` : `o Atilhus Juri respondeu ${status}`);
  } finally {
    enviando.delete(contratoId);
  }
}

let laco = null;
let ocupado = false;

export function iniciarIntegracaoJuri() {
  if (laco) return;

  aoAcontecer('contrato_assinado', async ({ contratoId }) => {
    const contrato = achar('contratos', contratoId);
    if (contrato && !contrato.juri) guardar(contrato, { situacao: 'pendente', tentativas: 0 });
    await enviarAoJuri(contratoId);
  });

  laco = setInterval(async () => {
    if (ocupado) return;
    ocupado = true;
    try {
      const agoraIso = new Date().toISOString();
      const devidos = listar('contratos').filter((c) => {
        if (c.situacao !== 'assinado' || !c.juri) return false;
        if (c.juri.situacao === 'aguardando_configuracao') return configuracao(c.workspaceId).ativo;
        return ['pendente', 'falhou'].includes(c.juri.situacao) && (!c.juri.proximaTentativaEm || c.juri.proximaTentativaEm <= agoraIso);
      });
      for (const contrato of devidos) await enviarAoJuri(contrato.id).catch(() => {});
    } finally {
      ocupado = false;
    }
  }, INTERVALO);
  if (typeof laco.unref === 'function') laco.unref();
}
