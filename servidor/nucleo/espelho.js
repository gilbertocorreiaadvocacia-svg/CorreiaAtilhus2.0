import { PASTA_DADOS } from '../config.js';
import path from 'node:path';
import fs from 'node:fs';

/**
 * Espelho do banco no Supabase, em escrita dupla.
 *
 * O arquivo JSON continua sendo a VERDADE. Este modulo so copia para fora o que
 * ja foi gravado, para o Supabase ir enchendo em paralelo e poder ser conferido
 * antes de virar a chave. Enquanto durar esta fase, nada le de la.
 *
 * A regra que manda em todo o arquivo: **falha aqui nunca chega ao
 * atendimento**. O escritorio esta com o WhatsApp aberto atendendo cliente; se
 * a internet cair ou o Supabase demorar, a conversa nao pode travar e a tela
 * nao pode piscar erro. Toda falha vira registro em disco e uma nova tentativa
 * depois, jamais uma excecao que sobe.
 *
 * Por isso tambem nao ha `await` em lugar nenhum do caminho de escrita: quem
 * chama `espelhar()` segue em frente na mesma hora, e o envio acontece sozinho.
 *
 * Ligar exige duas variaveis de ambiente. Sem elas o modulo fica inerte, e o
 * sistema roda exatamente como antes:
 *
 *   CORREIA_SUPABASE_URL=https://xxxx.supabase.co
 *   CORREIA_SUPABASE_CHAVE=<service_role>
 *
 * A chave e de servico e passa por cima do RLS. Ela vive no ambiente, nunca no
 * codigo e nunca no repositorio.
 */

const URL_BASE = (process.env.CORREIA_SUPABASE_URL || '').replace(/\/+$/, '');
const CHAVE = process.env.CORREIA_SUPABASE_CHAVE || '';

export const ligado = Boolean(URL_BASE && CHAVE);

/* A mesma espera do disco. O banco junta as alteracoes de uma rajada antes de
   gravar; o espelho segue o mesmo ritmo, e uma triagem de 40 conversas vira uma
   chamada em vez de quarenta. */
const ESPERA_MS = 250;

/* Teto do lote enviado de uma vez. Acima disso o corpo do pedido fica grande
   demais e o tempo de resposta cresce junto; o resto vai na leva seguinte. */
const LOTE_MAXIMO = 500;

/* Espera antes de tentar de novo, dobrando ate o teto. Insistir de segundo em
   segundo com a internet caida sO gasta a fila e enche o log. */
const RECUO_INICIAL_MS = 2000;
const RECUO_MAXIMO_MS = 60000;

const ARQUIVO_PENDENTE = path.join(PASTA_DADOS, '.espelho-pendente.jsonl');

/*
 * A fila e um Map com chave "tabela/id": duas alteracoes seguidas no mesmo
 * registro viram uma so, com o estado final. Numa lista simples, o contato que
 * muda de status cinco vezes em dois segundos viajaria cinco vezes, e as quatro
 * primeiras seriam trabalho jogado fora.
 */
const fila = new Map();
let temporizador = null;
let enviando = false;
let recuo = RECUO_INICIAL_MS;

export const estado = {
  enviados: 0,
  falhas: 0,
  ultimoErro: null,
  ultimoEnvioEm: null,
};

/*
 * Onde o nome da colecao no codigo difere do nome da tabela no Postgres.
 *
 * O JavaScript usa meiaCamelo e o SQL usa minusculo_com_sublinhado. Sem esta
 * traducao, `chavesApi` bateria numa tabela que nao existe e a porta recusaria
 * o lote inteiro por causa de um registro.
 */
const TABELA_DA_COLECAO = { chavesApi: 'chaves_api' };

/**
 * Poe um registro na fila do espelho.
 *
 * @param {string} tabela  Nome da tabela em `atendimento`.
 * @param {string} id      Id do registro.
 * @param {object|null} dados  O registro inteiro, ou null para apagar.
 */
export function espelhar(tabela, id, dados) {
  if (!ligado || !tabela || !id) return;
  const alvo = TABELA_DA_COLECAO[tabela] || tabela;
  fila.set(`${alvo}/${id}`, { t: alvo, id, ...(dados ? { d: dados } : { op: 'del' }) });
  agendar();
}

/** Espelha uma colecao inteira de uma vez. Usado na carga inicial. */
export function espelharTodos(tabela, registros) {
  if (!ligado) return;
  for (const registro of registros || []) {
    if (registro?.id) espelhar(tabela, registro.id, registro);
  }
}

function agendar() {
  if (temporizador || enviando) return;
  temporizador = setTimeout(() => {
    temporizador = null;
    enviar();
  }, ESPERA_MS);
  /* unref para o temporizador nao segurar o processo aberto no encerramento. */
  if (typeof temporizador.unref === 'function') temporizador.unref();
}

async function enviar() {
  if (enviando || !fila.size) return;
  enviando = true;

  const lote = [...fila.values()].slice(0, LOTE_MAXIMO);
  const chaves = lote.map((i) => `${i.t}/${i.id}`);

  try {
    const resposta = await fetch(`${URL_BASE}/rest/v1/rpc/espelhar_atendimento`, {
      method: 'POST',
      headers: {
        apikey: CHAVE,
        Authorization: `Bearer ${CHAVE}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ lote }),
    });

    if (!resposta.ok) throw new Error(`HTTP ${resposta.status}: ${(await resposta.text()).slice(0, 200)}`);

    /* So sai da fila o que o servidor confirmou. Removendo antes do envio, uma
       queda no meio do caminho perderia o registro sem ninguem notar. */
    for (const chave of chaves) fila.delete(chave);
    estado.enviados += lote.length;
    estado.ultimoEnvioEm = new Date().toISOString();
    estado.ultimoErro = null;
    recuo = RECUO_INICIAL_MS;
  } catch (erro) {
    estado.falhas += 1;
    estado.ultimoErro = erro.message;
    anotarPendencia(lote, erro.message);
    /* A fila NAO e limpa: o lote volta na proxima tentativa. */
    setTimeout(() => {
      recuo = Math.min(recuo * 2, RECUO_MAXIMO_MS);
      enviando = false;
      agendar();
    }, recuo).unref?.();
    return;
  } finally {
    /* No caminho de erro o `enviando` volta pelo temporizador acima, para nao
       disparar duas tentativas em paralelo. */
    if (!estado.ultimoErro) enviando = false;
  }

  if (fila.size) agendar();
}

/**
 * Deixa rastro em disco do lote que nao subiu.
 *
 * Sem isso, uma falha de madrugada com o servidor reiniciado depois sumiria: no
 * dia da conferencia, a diferenca entre o JSON e o Supabase apareceria sem
 * nenhuma pista de quando e por que.
 */
function anotarPendencia(lote, motivo) {
  try {
    const linha = JSON.stringify({
      em: new Date().toISOString(),
      motivo: String(motivo).slice(0, 300),
      registros: lote.map((i) => `${i.t}/${i.id}`),
    });
    fs.appendFileSync(ARQUIVO_PENDENTE, linha + '\n');
  } catch {
    /* Se nem anotar der, nao ha o que fazer aqui: o atendimento vem primeiro. */
  }
}

/** Quantos registros ainda esperam para subir. Usado no diagnostico. */
export function pendentes() {
  return fila.size;
}

/**
 * Tenta esvaziar a fila antes de o processo fechar.
 *
 * Espera limitada de proposito: se o Supabase nao responder, o sistema fecha
 * assim mesmo e o que ficou vai na proxima subida, pela carga de conferencia.
 */
export async function encerrarEspelho(limiteMs = 3000) {
  if (!ligado || !fila.size) return;
  const ate = Date.now() + limiteMs;
  while (fila.size && Date.now() < ate) {
    enviando = false;
    await enviar();
    if (estado.ultimoErro) break;
  }
}
