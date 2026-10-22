import { cliente, suite } from './apoio.js';

/**
 * Acao em massa de status: "Follow up" e excecao da trava contra disparo em
 * lote.
 *
 * Pedido do escritorio em 22/10/2026. A trava (acoes-em-massa, rotas/
 * atendimento.js) existe para reclassificar um lote de contatos por um
 * motivo qualquer nao disparar a sequencia de Qualificado para duzentas
 * pessoas de uma vez so — e continua valendo para todo status, EXCETO
 * "Follow up": e justamente o status que a pessoa usa para empurrar um
 * lote inteiro de volta ao contato, e sem a sequencia disparar ali o
 * follow-up nunca saia sozinho, tinha que ser mandado a mao, um por um.
 * Marcar como concluido (arquivar) depois nao pode impedir o envio: o
 * agendador so olha o horario, nao o estado da conversa.
 */
export async function testarStatusEmMassa({ base }) {
  const s = suite('Status em massa: Follow up dispara, os demais continuam travados');
  const api = cliente(base);
  await api.entrar();

  const simulador = ((await api.get('/api/conexoes')).dados || []).find((c) => c.tipo === 'simulador');
  if (!s.ok('ha conexao de simulador', Boolean(simulador))) return s;

  const template = (
    await api.post('/api/templates', { nome: 'Follow-up em massa (teste)', conteudo: 'Oi {{nome}}, ainda podemos ajudar?' })
  ).dados;
  if (!s.ok('o template de teste foi criado', Boolean(template?.id))) return s;

  const statusList = (await api.get('/api/status')).dados || [];
  const followUp = statusList.find((st) => st.nome === 'Follow up');
  if (!s.ok('o status "Follow up" existe nesta base (vem do seed)', Boolean(followUp))) return s;

  /* "Outro" e criado do zero, e nao um status do seed emprestado: reescrever
     o followups de um status que outra suite ja configurou (ex.: Qualificado)
     vazaria para quem rodar depois. */
  const outro = (await api.post('/api/status', { nome: 'Status em massa (teste)', cor: 'var(--serie-2)' })).dados;
  if (!s.ok('o status de comparacao foi criado', Boolean(outro?.id))) return s;

  const passoDeTeste = [{ templateId: template.id, minutos: 4320, desistir: null }];
  /* O "Follow up" e do seed, compartilhado com o resto da suite: guarda a
     sequencia de antes para devolver no finally. */
  const followupsOriginais = followUp.followups;
  await api.patch(`/api/status/${followUp.id}`, { followups: passoDeTeste });
  await api.patch(`/api/status/${outro.id}`, { followups: passoDeTeste });

  try {
    const numeroNovo = () => `3292${String(Date.now()).slice(-6)}${Math.floor(Math.random() * 10)}`;
    const falar = (telefone) =>
      api.post('/api/simulador/mensagem', { conexaoId: simulador.id, nome: 'Lead em massa', telefone, conteudo: 'oi' });

    const paraFollowUp = await falar(numeroNovo());
    const paraOutro = await falar(numeroNovo());
    const idFollowUp = paraFollowUp.dados?.contatoId;
    const idOutro = paraOutro.dados?.contatoId;
    if (!s.ok('os dois contatos de teste foram criados', Boolean(idFollowUp && idOutro))) return s;

    const resultado = await api.post('/api/contatos/acoes-em-massa', {
      ids: [idFollowUp],
      acao: 'status',
      valor: followUp.id,
    });
    s.ok('a acao em massa responde ok para Follow up', resultado.status === 200 && resultado.dados?.afetados === 1, JSON.stringify(resultado.dados));

    await api.post('/api/contatos/acoes-em-massa', { ids: [idOutro], acao: 'status', valor: outro.id });

    const agendamentosFollowUp = ((await api.get(`/api/contatos/${idFollowUp}/agendamentos`)).dados || []).filter(
      (a) => a.tipo === 'followup' && a.estado === 'pendente',
    );
    s.ok(
      'em massa para "Follow up", o follow-up E agendado (excecao a trava)',
      agendamentosFollowUp.length === 1,
      JSON.stringify(agendamentosFollowUp),
    );

    const agendamentosOutro = ((await api.get(`/api/contatos/${idOutro}/agendamentos`)).dados || []).filter(
      (a) => a.tipo === 'followup' && a.estado === 'pendente',
    );
    s.ok(
      'em massa para um status qualquer, a trava continua valendo (nenhum follow-up agendado)',
      agendamentosOutro.length === 0,
      JSON.stringify(agendamentosOutro),
    );

    /* Concluir (arquivar) a conversa depois nao pode cancelar o que ja foi
       agendado: o agendador so olha o horario do agendamento, nunca o estado
       da conversa (servidor/automacao/followup.js, dispararAgendamento). */
    await api.post(`/api/contatos/${idFollowUp}/arquivar`, { arquivar: true });
    const depoisDeConcluir = ((await api.get(`/api/contatos/${idFollowUp}/agendamentos`)).dados || []).filter(
      (a) => a.tipo === 'followup' && a.estado === 'pendente',
    );
    s.ok(
      'concluir a conversa nao cancela o follow-up ja agendado',
      depoisDeConcluir.length === 1,
      JSON.stringify(depoisDeConcluir),
    );
  } finally {
    await api.patch(`/api/status/${followUp.id}`, { followups: followupsOriginais });
  }

  return s;
}
