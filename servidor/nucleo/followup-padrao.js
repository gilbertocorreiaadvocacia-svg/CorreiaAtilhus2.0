import { atualizar, listar } from './banco.js';
import { agora, normalizar, novoId } from './util.js';

/**
 * O status "Follow up" manda os follow-ups (pedido do escritorio, 03/11/2026):
 * "quando eu coloco em Follow up, deveria ficar mandando os follow-ups".
 *
 * O status nasce sem nenhum passo (nucleo/seed.js: "Retomar depois: aguardando um
 * retorno combinado"), e o escritorio o usa justamente para empurrar conversas de
 * volta ao contato — sem passos, colocar uma conversa ali nao mandava nada, e a
 * sequencia so existia nos tres status do funil (Qualificado, Proposta, Assinatura).
 *
 * Esta arrumacao instala nele a mesma cadencia dos outros status, com as mensagens
 * que o escritorio ja tem: fu1 uma hora depois, fu2 no dia seguinte e fu3 tres dias
 * depois. Diferente dos outros, o ultimo passo NAO desiste do lead nem arquiva: quem
 * esta em "Follow up" foi colocado la de proposito, e tirar a conversa dali sem
 * ninguem pedir seria uma surpresa. Quem quiser a desistencia liga no editor do status.
 *
 * Vale so para quem ENTRA no status daqui em diante: a sequencia comeca na entrada
 * (automacao/followup.js), e as conversas que ja estao la nao recebem nada. Mandar
 * para todas de uma vez, num numero de WhatsApp comum, e o que derruba o numero.
 *
 * Uma vez so por escritorio (workspace.followUpPadraoEm): se a equipe tirar os passos
 * depois de proposito, o proximo boot nao os poe de volta. Sem os templates fu1, fu2 e
 * fu3 no escritorio, nao instala nem marca — instala quando eles existirem. Status que
 * ja tem passos nao e tocado.
 */
export const SEQUENCIA_DO_FOLLOW_UP = [
  { atalho: 'fu1', minutos: 60 },
  { atalho: 'fu2', minutos: 60 * 24 },
  { atalho: 'fu3', minutos: 60 * 24 * 3 },
];

export function garantirSequenciaNoStatusFollowUp() {
  const relato = { instalados: 0, jaTinham: 0, semTemplates: 0 };
  for (const workspace of listar('workspaces')) {
    if (workspace.followUpPadraoEm) continue;
    const status = listar('status', { workspaceId: workspace.id }).find((s) => normalizar(s.nome).replace(/[-_\s]+/g, ' ') === 'follow up');
    if (!status) continue;

    if ((status.followups || []).length) {
      atualizar('workspaces', workspace.id, { followUpPadraoEm: agora() });
      relato.jaTinham += 1;
      continue;
    }

    const templates = listar('templates', { workspaceId: workspace.id });
    const passos = SEQUENCIA_DO_FOLLOW_UP.map((p) => ({ ...p, template: templates.find((t) => normalizar(t.atalho) === p.atalho) }));
    if (passos.some((p) => !p.template)) {
      relato.semTemplates += 1;
      continue;
    }

    atualizar('status', status.id, {
      followups: passos.map((p) => ({ id: novoId('fup'), templateId: p.template.id, minutos: p.minutos, desistir: null })),
    });
    atualizar('workspaces', workspace.id, { followUpPadraoEm: agora() });
    relato.instalados += 1;
  }
  return relato;
}
