import { listar } from './banco.js';

/**
 * Situacoes em que o contrato ainda esta em andamento: com a equipe para
 * conferir, ou com o cliente para assinar. Fica num modulo so de banco para o
 * follow-up poder perguntar sem importar a integracao da ZapSign (que importa o
 * follow-up, e o ciclo de import quebraria na partida).
 */
export const SITUACOES_ABERTAS = ['em_conferencia', 'link_enviado', 'link_aberto'];

/** O contrato em andamento mais recente da conversa, ou null. */
export function contratoAbertoDe(contatoId) {
  return (
    listar('contratos', { contatoId })
      .filter((c) => SITUACOES_ABERTAS.includes(c.situacao))
      .sort((a, b) => String(b.criadoEm).localeCompare(String(a.criadoEm)))[0] || null
  );
}
