import fs from 'node:fs';
import path from 'node:path';
import { PASTA_DADOS, PASTA_MENSAGENS } from '../config.js';
import { agora, garantirPasta, gravarAtomico, lerJson, novoId, ordenarPor } from './util.js';
import { encerrarEspelho, espelhar } from './espelho.js';

/**
 * Banco de arquivos JSON, sem dependencia externa.
 *
 * Tudo o que e pequeno e consultado o tempo todo (contatos, status, agentes)
 * fica em memoria e e gravado com atraso curto, assim uma rajada de alteracoes
 * vira uma unica escrita em disco. As mensagens, que sao o volume real do
 * sistema, ficam em um arquivo por conversa e so sao carregadas quando a
 * conversa e aberta.
 */

const COLECOES = [
  'workspaces',
  'usuarios',
  'membros',
  'conexoes',
  'status',
  'departamentos',
  'etiquetas',
  'origens',
  'variaveis',
  'agentes',
  'conhecimento',
  'templates',
  'contatos',
  'tarefas',
  'agendamentos',
  'contratos',
  'compromissos',
  'logs',
  'notificacoes',
  'creditos',
  'integracoes',
  'vozes',
  'chavesApi',
  'configuracoes',
];

const memoria = new Map();
const sujas = new Set();
let temporizador = null;

function caminhoDa(colecao) {
  return path.join(PASTA_DADOS, `${colecao}.json`);
}

export function iniciarBanco() {
  garantirPasta(PASTA_DADOS);
  garantirPasta(PASTA_MENSAGENS);
  for (const colecao of COLECOES) {
    memoria.set(colecao, lerJson(caminhoDa(colecao), []));
  }
}

function marcarSuja(colecao) {
  sujas.add(colecao);
  if (temporizador) return;
  temporizador = setTimeout(() => {
    temporizador = null;
    salvarPendentes();
  }, 250);
  if (typeof temporizador.unref === 'function') temporizador.unref();
}

export function salvarPendentes() {
  for (const colecao of sujas) {
    gravarAtomico(caminhoDa(colecao), JSON.stringify(memoria.get(colecao) ?? [], null, 2));
  }
  sujas.clear();
}

export function tabela(colecao) {
  if (!memoria.has(colecao)) memoria.set(colecao, []);
  return memoria.get(colecao);
}

function combina(registro, filtro) {
  return Object.entries(filtro).every(([chave, valor]) => {
    if (valor === undefined) return true;
    if (Array.isArray(valor)) return valor.includes(registro[chave]);
    return registro[chave] === valor;
  });
}

export function listar(colecao, filtro = {}) {
  return tabela(colecao).filter((registro) => combina(registro, filtro));
}

export function achar(colecao, filtro = {}) {
  if (typeof filtro === 'string') return tabela(colecao).find((r) => r.id === filtro) || null;
  return tabela(colecao).find((registro) => combina(registro, filtro)) || null;
}

export function inserir(colecao, dados) {
  const registro = {
    id: dados.id || novoId(),
    criadoEm: dados.criadoEm || agora(),
    ...dados,
  };
  registro.id = dados.id || registro.id;
  tabela(colecao).push(registro);
  marcarSuja(colecao);
  espelhar(colecao, registro.id, registro);
  return registro;
}

export function atualizar(colecao, id, mudancas) {
  const registro = achar(colecao, id);
  if (!registro) return null;
  Object.assign(registro, mudancas, { atualizadoEm: agora() });
  marcarSuja(colecao);
  espelhar(colecao, registro.id, registro);
  return registro;
}

export function remover(colecao, id) {
  const lista = tabela(colecao);
  const indice = lista.findIndex((r) => r.id === id);
  if (indice < 0) return false;
  lista.splice(indice, 1);
  marcarSuja(colecao);
  espelhar(colecao, id, null);
  return true;
}

export function removerOnde(colecao, filtro) {
  const lista = tabela(colecao);
  let removidos = 0;
  for (let i = lista.length - 1; i >= 0; i -= 1) {
    if (combina(lista[i], filtro)) {
      /* O id sai ANTES do splice: depois da remocao o registro nao existe mais
         para consultar, e o espelho ficaria com a linha orfa no Supabase. */
      const { id } = lista[i];
      lista.splice(i, 1);
      espelhar(colecao, id, null);
      removidos += 1;
    }
  }
  if (removidos) marcarSuja(colecao);
  return removidos;
}

/* ------------------------------------------------------------------ */
/* Mensagens, um arquivo por conversa                                  */
/* ------------------------------------------------------------------ */

const cacheMensagens = new Map();
const mensagensSujas = new Set();
let temporizadorMensagens = null;

function caminhoMensagens(contatoId) {
  return path.join(PASTA_MENSAGENS, `${contatoId}.json`);
}

export function mensagensDe(contatoId) {
  if (!cacheMensagens.has(contatoId)) {
    cacheMensagens.set(contatoId, lerJson(caminhoMensagens(contatoId), []));
  }
  return cacheMensagens.get(contatoId);
}

function marcarMensagensSujas(contatoId) {
  mensagensSujas.add(contatoId);
  if (temporizadorMensagens) return;
  temporizadorMensagens = setTimeout(() => {
    temporizadorMensagens = null;
    salvarMensagensPendentes();
  }, 250);
  if (typeof temporizadorMensagens.unref === 'function') temporizadorMensagens.unref();
}

export function salvarMensagensPendentes() {
  for (const contatoId of mensagensSujas) {
    gravarAtomico(caminhoMensagens(contatoId), JSON.stringify(cacheMensagens.get(contatoId) ?? [], null, 2));
  }
  mensagensSujas.clear();
}

export function inserirMensagem(contatoId, dados) {
  const lista = mensagensDe(contatoId);
  const mensagem = {
    id: dados.id || novoId('msg'),
    contatoId,
    criadoEm: dados.criadoEm || agora(),
    ...dados,
  };
  lista.push(mensagem);
  marcarMensagensSujas(contatoId);
  espelhar('mensagens', mensagem.id, mensagem);
  return mensagem;
}

export function atualizarMensagem(contatoId, id, mudancas) {
  const lista = mensagensDe(contatoId);
  const mensagem = lista.find((m) => m.id === id);
  if (!mensagem) return null;
  Object.assign(mensagem, mudancas);
  marcarMensagensSujas(contatoId);
  espelhar('mensagens', mensagem.id, mensagem);
  return mensagem;
}

export function moverMensagens(deContatoId, paraContatoId) {
  const origem = mensagensDe(deContatoId);
  const destino = mensagensDe(paraContatoId);
  for (const mensagem of origem) {
    const movida = { ...mensagem, contatoId: paraContatoId };
    destino.push(movida);
    /* A mensagem mantem o id ao mudar de dono, entao no Supabase e a MESMA
       linha com contato_id novo. Sem espelhar, a unificacao de conversas ficava
       so no JSON e o espelho apontava para a conversa que deixou de existir. */
    espelhar('mensagens', movida.id, movida);
  }
  destino.sort((a, b) => String(a.criadoEm).localeCompare(String(b.criadoEm)));
  cacheMensagens.set(deContatoId, []);
  marcarMensagensSujas(deContatoId);
  marcarMensagensSujas(paraContatoId);
  return origem.length;
}

export function apagarMensagens(contatoId) {
  /* As linhas do Supabase saem uma a uma: a porta de escrita e por id, e apagar
     por contato exigiria abrir uma segunda operacao la dentro. Excluir conversa
     e raro, entao o lote maior compensa a porta menor. */
  for (const mensagem of mensagensDe(contatoId)) espelhar('mensagens', mensagem.id, null);
  cacheMensagens.delete(contatoId);
  mensagensSujas.delete(contatoId);
  try {
    fs.unlinkSync(caminhoMensagens(contatoId));
  } catch {
    /* nao existia, tudo bem */
  }
}

/* ------------------------------------------------------------------ */

export function registrarLog(workspaceId, contatoId, tipo, descricao, autor = null, dados = null) {
  return inserir('logs', { workspaceId, contatoId, tipo, descricao, autor, dados });
}

export function logsDe(contatoId, limite = 200) {
  return ordenarPor(listar('logs', { contatoId }), 'criadoEm', 'desc').slice(0, limite);
}

export function encerrarBanco() {
  salvarPendentes();
  salvarMensagensPendentes();
  /* Devolve a promessa para quem encerra poder esperar o espelho esvaziar. */
  return encerrarEspelho();
}
