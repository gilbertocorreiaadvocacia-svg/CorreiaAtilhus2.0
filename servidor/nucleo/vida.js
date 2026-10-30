import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { PASTA_DADOS } from '../config.js';
import { lerBatimento } from './batimento.js';

/**
 * Como o sistema saiu da ultima vez, a cada subida.
 *
 * Pedido do escritorio em 29/10/2026: "as vezes o sistema cai, quero que voce
 * conserte isso". De fora, uma implantacao e uma queda de verdade sao a mesma
 * coisa — a tela para de responder e depois volta — e sem saber qual das duas
 * aconteceu nao ha o que consertar. Aqui cada subida fica anotada com:
 *
 *   - quanto tempo o sistema ficou parado (o ultimo pulso de nucleo/batimento.js);
 *   - se ele foi DESLIGADO (recebeu o aviso de parar: implantacao, reinicio
 *     pedido, a hospedagem trocando o conteiner) ou CAIU (morreu sem aviso:
 *     falta de memoria, a maquina reiniciando, processo derrubado);
 *   - se a versao mudou (desligado + versao nova = implantacao);
 *   - o ultimo erro que escapou do codigo antes da saida, e a memoria que o
 *     processo usava no ultimo pulso (memoria alta antes de cair aponta para
 *     falta de memoria).
 *
 * Fica num arquivo, e nao no banco, pelo mesmo motivo do pulso: precisa
 * sobreviver a uma parada suja, em que o banco nao gravou o que tinha.
 * Vai no /api/saude: so datas, numeros e o erro com todo numero comprido
 * trocado por "#".
 */

const ARQUIVO = path.join(PASTA_DADOS, 'vida.json');

/* Quem e este processo. Cada conteiner tem o proprio nome de maquina: duas copias
   do sistema na mesma pasta de dados (uma implantacao que sobe a nova antes de
   derrubar a antiga) aparecem como dois nomes. O teste troca o valor por ambiente. */
const QUEM_SOU = process.env.CORREIA_PROCESSO_ID || os.hostname();
const GUARDAR = 20;

const semNumeros = (texto) => String(texto || '').replace(/\d{6,}/g, '#').slice(0, 300);

function ler() {
  try {
    const dados = JSON.parse(fs.readFileSync(ARQUIVO, 'utf8'));
    return dados && typeof dados === 'object' ? dados : {};
  } catch {
    return {};
  }
}

function gravar(dados) {
  try {
    fs.writeFileSync(ARQUIVO, JSON.stringify(dados));
  } catch {
    /* Disco cheio ou somente leitura: anotar a vida nunca derruba o sistema. */
  }
}

let errosDesdeASubida = 0;

/**
 * Anota esta subida. ANTES de iniciarBatimento(), enquanto o pulso em disco
 * ainda e o da vez anterior.
 */
export function registrarSubida(codigo) {
  const dados = ler();
  const pulso = lerBatimento();
  const agora = Date.now();
  const anterior = (dados.subidas || [])[0] || null;
  const saida = dados.saida || null;
  const erro = dados.ultimoErro && (!anterior || dados.ultimoErro.em > anterior.em) ? dados.ultimoErro : null;

  let comoSaiu = 'primeira subida';
  if (anterior) {
    if (saida && saida.em >= anterior.em) comoSaiu = saida.codigo && saida.codigo !== codigo ? 'implantacao' : 'reiniciado, mesma versao';
    else comoSaiu = 'caiu';
  }

  const subida = {
    em: new Date(agora).toISOString(),
    codigo,
    comoSaiu,
    paradoSegundos: pulso ? Math.max(0, Math.round((agora - pulso.em) / 1000)) : null,
    memoriaNoUltimoPulsoMb: pulso?.memoriaMb ?? null,
    motivoDoDesligamento: saida && saida.em >= (anterior?.em || '') ? saida.motivo : null,
    processo: QUEM_SOU,
    ultimoErro: erro ? { em: erro.em, mensagem: erro.mensagem } : null,
  };
  gravar({ subidas: [subida, ...(dados.subidas || [])].slice(0, GUARDAR), saida: null, ultimoErro: dados.ultimoErro || null });
  return subida;
}

/** Recebeu o aviso de parar (SIGTERM/SIGINT): o que vier depois nao e queda. */
export function registrarDesligamento(motivo, codigo) {
  const dados = ler();
  gravar({ ...dados, saida: { em: new Date().toISOString(), motivo, codigo, processo: QUEM_SOU } });
}

/*
 * A copia antiga ainda estava no ar quando esta subiu?
 *
 * Achado de 30/10/2026: a subida depois de uma implantacao saiu anotada como
 * "caiu", sem erro e com a memoria normal. Duas explicacoes cabem: o aviso de
 * parar nao chegou, ou a hospedagem subiu esta copia ANTES de derrubar a
 * antiga — e ai as duas gravam nos mesmos arquivos ao mesmo tempo. Se a copia
 * antiga grava o aviso de parar DEPOIS de esta ja ter subido, e de outro
 * processo, e sobreposicao. Chamada alguns segundos depois da subida.
 */
let sobreposicao = null;
export function conferirSobreposicao(subidaEm) {
  const { saida } = ler();
  if (saida?.processo && saida.processo !== QUEM_SOU && saida.em > subidaEm) {
    sobreposicao = {
      segundos: Math.round((Date.parse(saida.em) - Date.parse(subidaEm)) / 1000),
      versaoAnterior: saida.codigo || null,
    };
  }
  return sobreposicao;
}

/** Um erro escapou do codigo (uncaughtException): fica anotado para a proxima subida e para a saude. */
export function registrarErroNaoTratado(erro) {
  errosDesdeASubida += 1;
  const dados = ler();
  const onde = String(erro?.stack || '').split('\n').slice(1, 3).map((l) => l.trim()).join(' | ');
  gravar({ ...dados, ultimoErro: { em: new Date().toISOString(), mensagem: semNumeros(`${erro?.message || erro}${onde ? ` (${onde})` : ''}`) } });
}

/** Para /api/saude. */
export function vidaDoSistema() {
  const dados = ler();
  return {
    subidas: (dados.subidas || []).slice(0, 10),
    errosNaoTratadosDesdeASubida: errosDesdeASubida,
    sobreposicaoNaImplantacao: sobreposicao,
    ultimoErro: dados.ultimoErro || null,
  };
}
