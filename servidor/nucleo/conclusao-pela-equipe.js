import { atualizar, listar } from './banco.js';
import { agora } from './util.js';

/**
 * Conversa que uma PESSOA concluiu nao volta para a IA sozinha (pedido do
 * escritorio, 03/11/2026).
 *
 * "Concluir" e como a equipe tira a conversa de Ativos e de Pendentes ("eu
 * arquivo apenas para nao estar nos ativos"). Quando o cliente volta a escrever,
 * a conversa reabre — mas a regra de 24/10/2026 ("todo contato que manda
 * mensagem vai para a IA") a entregava a um agente, que respondia por cima de um
 * atendimento que a equipe tinha dado por encerrado. O que o escritorio quer: a
 * conversa volta DIRETO para Pendentes, para alguem da equipe ver, e a IA nao
 * atua, porque quem finalizou antes foi uma pessoa.
 *
 * O sinal e `contato.semIa`, gravado ao concluir. Enquanto ele existir:
 *  - a mensagem do cliente reabre a conversa em Pendentes (sem agente), e nenhuma
 *    escolha automatica de agente vale: nem a palavra-chave, nem "toda mensagem
 *    vai para a IA", nem a varredura que devolve pendentes a IA (todas passam por
 *    escolherAgente, que devolve nada para quem tem o sinal);
 *  - ele CONTINUA nas mensagens seguintes: a conversa que esta em Pendentes
 *    esperando a equipe nao pode ser tomada pela IA na segunda mensagem do cliente.
 *
 * O sinal sai quando uma pessoa decide de novo sobre a conversa: aceita, assume,
 * escolhe um responsavel (inclusive um agente) ou reabre pelo botao. A partir dai
 * valem as regras de sempre.
 *
 * So quem foi concluido por uma pessoa tem o sinal. O historico importado do
 * celular, a desistencia do follow-up e a avaliacao nao mexem: o cliente que
 * volta nesses casos continua indo para a IA, como antes.
 */

/** As mudancas de quando uma pessoa conclui a conversa. */
export function mudancasDeConcluir(membro, nomeDaPessoa) {
  return {
    estado: 'arquivado',
    semIa: { motivo: 'concluida-pela-equipe', em: agora(), por: membro ? { id: membro.id, nome: nomeDaPessoa || null } : null },
  };
}

/** Uma pessoa decidiu de novo sobre a conversa: as regras de sempre voltam a valer. */
export const LIBERAR_PARA_A_IA = { semIa: null };

export const semIaAutomatica = (contato) => Boolean(contato?.semIa);

/**
 * Uma vez, ao subir: quem a equipe ja concluiu ANTES desta regra tambem ganha o
 * sinal. So entra quem esta concluida agora e cujo ultimo registro de
 * conclusao/reabertura e uma conclusao feita por pessoa ("Atendimento
 * concluido", gravado pela rota de concluir). O historico importado e as
 * concluidas pelo follow-up nao tem esse registro e ficam como estavam.
 * Idempotente: quem ja tem o sinal nao e tocado.
 */
export function marcarConcluidasPelaEquipe() {
  const ultimos = new Map();
  for (const log of listar('logs')) {
    if (log.tipo !== 'arquivo' && log.tipo !== 'desarquivar') continue;
    const anterior = ultimos.get(log.contatoId);
    if (!anterior || String(log.criadoEm) > String(anterior.criadoEm)) ultimos.set(log.contatoId, log);
  }

  let marcadas = 0;
  for (const contato of listar('contatos', { estado: 'arquivado' })) {
    if (contato.semIa) continue;
    const ultimo = ultimos.get(contato.id);
    if (!ultimo || ultimo.tipo !== 'arquivo' || !/conclu/i.test(ultimo.descricao || '')) continue;
    atualizar('contatos', contato.id, { semIa: { motivo: 'concluida-pela-equipe', em: ultimo.criadoEm, por: null, retroativo: true } });
    marcadas += 1;
  }
  return marcadas;
}
