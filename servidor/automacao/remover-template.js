import { achar, atualizar, listar, remover } from '../nucleo/banco.js';

/**
 * Apaga um template e tudo o que apontava para ele.
 *
 * Um template nao vive sozinho. Tres lugares guardam o id dele:
 *
 *   - o passo de follow-up de um status ("1h depois, mande @fu1");
 *   - o agendamento ja marcado para uma conversa;
 *   - o que a ZapSign manda depois da assinatura.
 *
 * Apagar so o registro deixava os tres apontando para o nada. O agendamento
 * ate se defendia (era cancelado na hora de sair, com "template removido"),
 * mas cancelado ANTES do passo de desistencia: o lead que devia sair do funil
 * no fim da sequencia ficava parado nele para sempre, sem ninguem saber.
 *
 * O passo de follow-up sai da sequencia. Se era o ultimo e carregava a
 * desistencia, ela passa para o novo ultimo passo — a regra "no fim, desista"
 * continua valendo para a sequencia que sobrou.
 *
 * Devolve o que mudou, para quem chamou poder contar.
 */
export function removerTemplate(templateId) {
  const template = achar('templates', templateId);
  if (!template) return null;
  const workspaceId = template.workspaceId;
  const relato = { passosRemovidos: 0, agendamentosCancelados: 0, zapsign: false };

  for (const status of listar('status', { workspaceId })) {
    const passos = status.followups || [];
    if (!passos.some((p) => p.templateId === templateId)) continue;
    const ultimoAntes = passos[passos.length - 1];
    const sobram = passos.filter((p) => p.templateId !== templateId).map((p) => ({ ...p, desistir: null }));
    if (sobram.length && ultimoAntes?.desistir) sobram[sobram.length - 1].desistir = ultimoAntes.desistir;
    atualizar('status', status.id, { followups: sobram });
    relato.passosRemovidos += passos.length - sobram.length;
  }

  for (const agendamento of listar('agendamentos', { workspaceId, templateId })) {
    if (agendamento.estado !== 'pendente') continue;
    atualizar('agendamentos', agendamento.id, { estado: 'cancelado', motivoCancelamento: 'template removido' });
    relato.agendamentosCancelados += 1;
  }

  for (const integracao of listar('integracoes', { workspaceId })) {
    if (integracao.zapsign?.posAssinatura?.templateId !== templateId) continue;
    atualizar('integracoes', integracao.id, {
      zapsign: { ...integracao.zapsign, posAssinatura: { ...integracao.zapsign.posAssinatura, templateId: null } },
    });
    relato.zapsign = true;
  }

  remover('templates', templateId);
  return relato;
}
