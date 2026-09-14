import { atualizar, listar } from '../nucleo/banco.js';
import { consultarDocumento, proximaConsulta } from './zapsign.js';

/**
 * Acompanha os contratos enviados, consultando a ZapSign quando vence a hora de
 * cada um (ver proximaConsulta em zapsign.js). E o caminho principal de saber
 * que o cliente assinou: este computador nao tem endereco publico, entao o
 * webhook da ZapSign nao chega ate aqui.
 */

const INTERVALO = Number(process.env.CORREIA_ZAPSIGN_INTERVALO) || 60 * 1000;
const EM_ACOMPANHAMENTO = ['link_enviado', 'link_aberto'];

let laco = null;
let ocupado = false;

export function iniciarAcompanhamento() {
  if (laco) return;
  laco = setInterval(async () => {
    /* Uma volta de cada vez: consulta lenta nao empilha outra por cima. */
    if (ocupado) return;
    ocupado = true;
    try {
      const agora = new Date().toISOString();
      const vencidos = listar('contratos').filter(
        (c) => EM_ACOMPANHAMENTO.includes(c.situacao) && c.tokenExterno && (!c.proximaConsultaEm || c.proximaConsultaEm <= agora),
      );
      for (const contrato of vencidos) {
        try {
          await consultarDocumento(contrato.id);
        } catch (erro) {
          atualizar('contratos', contrato.id, { erroConsulta: erro.message, proximaConsultaEm: proximaConsulta(contrato) });
        }
      }
    } finally {
      ocupado = false;
    }
  }, INTERVALO);
  if (typeof laco.unref === 'function') laco.unref();
}

export function pararAcompanhamento() {
  if (laco) clearInterval(laco);
  laco = null;
}
