/**
 * Para onde um clique numa notificacao deve levar. Arquivo proprio e sem
 * nenhum import: `app.js` (sino) e `avisos.js` (aviso do sistema
 * operacional) usam esta mesma funcao, e `avisos.js` nao pode depender de
 * `estado.js` sem criar um ciclo (estado.js ja importa de avisos.js).
 *
 * Pedido do escritorio em 20/10/2026: cada tipo de notificacao leva para o
 * lugar certo. Tarefa vai direto na tarefa dentro da conversa; aviso de
 * sistema (numero caiu, sincronizacao terminou) vai no numero; todo o resto
 * — ja apontava certo — continua indo para a conversa.
 */
export function destinoDaNotificacao(notificacao) {
  if (notificacao.tipo === 'tarefa' && notificacao.tarefaId && notificacao.contatoId) {
    return `#/atendimento/${notificacao.contatoId}/tarefas/${notificacao.tarefaId}`;
  }
  if (notificacao.tipo === 'sistema') {
    return notificacao.conexaoId ? `#/conexoes/${notificacao.conexaoId}` : null;
  }
  return notificacao.contatoId ? `#/atendimento/${notificacao.contatoId}` : null;
}
