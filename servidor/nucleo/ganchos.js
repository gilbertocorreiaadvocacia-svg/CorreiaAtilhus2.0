import { registrarLog } from './banco.js';

/**
 * Ganchos: o que acontece DEPOIS de um fato do sistema, sem o fato conhecer quem
 * reage. O contrato assinado nao precisa saber que existe um Atilhus Juri do
 * outro lado — ele avisa "contrato_assinado", e quem se inscreveu faz a sua
 * parte.
 *
 * Falha de quem reage nunca derruba quem avisou: o contrato continua assinado
 * mesmo se o envio ao Juri cair. A falha vira linha no historico da conversa.
 */

const ouvintes = new Map();

export function aoAcontecer(evento, funcao) {
  if (!ouvintes.has(evento)) ouvintes.set(evento, new Set());
  ouvintes.get(evento).add(funcao);
  return () => ouvintes.get(evento)?.delete(funcao);
}

export async function disparar(evento, dados = {}) {
  /* Uma linha por disparo: e por ela que se confere que o evento saiu uma vez
     so, e nao a cada consulta do documento. */
  registrarLog(dados.workspaceId || null, dados.contatoId || null, 'gancho', `Evento ${evento}`, { tipo: 'sistema', nome: 'Sistema' }, dados);
  for (const funcao of ouvintes.get(evento) || []) {
    try {
      await funcao(dados);
    } catch (erro) {
      registrarLog(dados.workspaceId || null, dados.contatoId || null, 'erro_gancho', `${evento}: ${erro.message}`);
    }
  }
}
