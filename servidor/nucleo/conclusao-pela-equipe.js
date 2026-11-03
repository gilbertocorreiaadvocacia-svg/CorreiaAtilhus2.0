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

/*
 * O texto EXATO que a conclusao por pessoa grava no historico (rotas/atendimento.js: o
 * botao Concluir e a conclusao em massa). Tem de ser igual, e nao "parecido": as
 * arrumacoes do historico do celular tambem gravam uma linha de tipo "arquivo" que diz
 * "Concluida na arrumacao de Ativos...", e olhar so a palavra "conclu" marcou, na
 * primeira versao desta regra (03/11/2026), 1609 conversas importadas como se a equipe
 * as tivesse concluido — e o cliente que voltasse a escrever nelas ficaria em Pendentes
 * sem a IA, o contrario do que o escritorio quer para elas.
 */
const TEXTO_DA_CONCLUSAO = 'Atendimento concluido';
const ehConclusaoPorPessoa = (descricao) => String(descricao || '').trim() === TEXTO_DA_CONCLUSAO;

/**
 * Ao subir: quem a equipe ja concluiu ANTES desta regra tambem ganha o sinal. So entra
 * quem esta concluida agora e cujo ultimo registro de conclusao/reabertura e a conclusao
 * por pessoa (texto exato acima). O historico importado e o que o follow-up concluiu nao
 * tem esse registro e ficam como estavam. Idempotente.
 *
 * E tambem CONFERE o que uma versao anterior deste proprio arquivo marcou: todo sinal
 * "retroativo" cujo registro de origem (o de mesma data) nao e a conclusao por pessoa
 * sai — mesmo que a conversa ja tenha sido reaberta pelo cliente nesse meio tempo. Sem
 * conseguir confirmar a origem, o sinal sai: o que fica e o comportamento de antes (o
 * cliente que volta vai para a IA), que e o seguro.
 *
 * Devolve { marcadas, corrigidas }.
 */
export function marcarConcluidasPelaEquipe() {
  const ultimos = new Map();
  const descricaoDe = new Map();
  for (const log of listar('logs')) {
    if (log.tipo !== 'arquivo' && log.tipo !== 'desarquivar') continue;
    const anterior = ultimos.get(log.contatoId);
    if (!anterior || String(log.criadoEm) > String(anterior.criadoEm)) ultimos.set(log.contatoId, log);
    if (log.tipo === 'arquivo') descricaoDe.set(`${log.contatoId}|${log.criadoEm}`, log.descricao);
  }

  let marcadas = 0;
  let corrigidas = 0;
  for (const contato of listar('contatos')) {
    if (contato.semIa?.retroativo) {
      if (ehConclusaoPorPessoa(descricaoDe.get(`${contato.id}|${contato.semIa.em}`))) continue;
      atualizar('contatos', contato.id, { semIa: null });
      corrigidas += 1;
      continue;
    }
    if (contato.semIa || contato.estado !== 'arquivado') continue;
    const ultimo = ultimos.get(contato.id);
    if (!ultimo || ultimo.tipo !== 'arquivo' || !ehConclusaoPorPessoa(ultimo.descricao)) continue;
    atualizar('contatos', contato.id, { semIa: { motivo: 'concluida-pela-equipe', em: ultimo.criadoEm, por: null, retroativo: true } });
    marcadas += 1;
  }
  return { marcadas, corrigidas };
}
