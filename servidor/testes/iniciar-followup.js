import { cliente, suite } from './apoio.js';

/**
 * Follow-up em quem JA esta no status (04/11/2026).
 *
 * "O follow-up nao esta ativando." A sequencia so nascia na TROCA de status
 * (automacao/followup.js, aplicarStatus). Conversa que ja estava em "Follow up"
 * quando a sequencia foi configurada ficava para sempre com a aba "O que ainda vai
 * ser enviado" em "Nada agendado", e escolher o mesmo status de novo nao muda nada.
 *
 * O que nao pode falhar:
 *  - a conversa que ja esta no status comeca a sequencia por um botao (um clique, ou
 *    o lote do status), sem reiniciar o relogio de quem ja tem follow-up a sair;
 *  - a acao em massa para "Follow up" comeca a sequencia de TODAS as escolhidas,
 *    inclusive as que ja estavam nele, e sai espalhada (nunca tudo no mesmo minuto);
 *  - a previa so conta, sem agendar nada, e deixa de fora quem esta esperando
 *    resposta nossa, quem foi concluido e quem ja tem follow-up;
 *  - outro status em lote continua nao disparando nada.
 */
export async function testarIniciarFollowup({ base }) {
  const s = suite('Follow-up em quem ja esta no status');
  const api = cliente(base);
  await api.entrar();

  const simulador = ((await api.get('/api/conexoes')).dados || []).find((c) => c.tipo === 'simulador');
  if (!s.ok('ha conexao de simulador', Boolean(simulador))) return s;

  const todosOsStatus = (await api.get('/api/status')).dados || [];
  const normal = (t) => String(t).normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().trim();
  let followUp = todosOsStatus.find((x) => normal(x.nome) === 'follow up');
  const outro = todosOsStatus.find((x) => x.id !== followUp?.id && normal(x.nome) === 'em analise') || todosOsStatus.find((x) => x.id !== followUp?.id);
  if (!s.ok('existem o status Follow up e outro status', Boolean(followUp && outro))) return s;
  if (!(followUp.followups || []).length) {
    const modelo = (await api.post('/api/templates', { nome: 'Follow-up iniciar 1', atalho: 'fuiniciar1', conteudo: 'Oi {{nome}}, conseguiu pensar melhor?' })).dados;
    followUp = (await api.patch(`/api/status/${followUp.id}`, { followups: [{ templateId: modelo.id, minutos: 30 }, { templateId: modelo.id, minutos: 2880 }] })).dados;
  }
  const passos = followUp.followups.length;

  let sufixo = 0;
  const criados = [];
  const novaConversa = async (statusId) => {
    sufixo += 1;
    const c = (await api.post('/api/contatos', { conexaoId: simulador.id, telefone: `5581931190${String(sufixo).padStart(3, '0')}`, nome: `Lead do Follow ${sufixo}`, statusId })).dados;
    criados.push(c.id);
    return c.id;
  };
  const agenda = async (id) => (await api.get(`/api/contatos/${id}/agendamentos`)).dados || [];
  const aSair = async (id) => (await agenda(id)).filter((a) => a.tipo === 'followup' && a.estado === 'pendente');
  const log = async (id, tipo) => ((await api.get(`/api/contatos/${id}/logs`)).dados || []).some((l) => l.tipo === tipo);

  /* --- 1. O defeito: ja esta no status e nao ha nada agendado ----------- */
  const a = await novaConversa(followUp.id);
  s.ok('conversa que ja esta em Follow up nasce sem nada agendado (o defeito)', (await aSair(a)).length === 0, JSON.stringify(await agenda(a)));

  const iniciou = await api.post(`/api/contatos/${a}/iniciar-followup`, {});
  const depois = await aSair(a);
  s.ok('o botao da conversa comeca a sequencia inteira', iniciou.status === 200 && depois.length === passos, `${iniciou.status} ${depois.length} de ${passos}`);
  s.ok('e deixa o registro de quem iniciou, no historico', await log(a, 'followup_iniciado'));
  const primeira = depois[0]?.quando ? Date.parse(depois[0].quando) - Date.now() : 0;
  s.ok('a primeira mensagem sai no prazo do passo (30 min), nao na hora', primeira > 25 * 60000 && primeira < 40 * 60000, `${Math.round(primeira / 60000)} min`);

  const quandoAntes = depois.map((x) => x.quando).join();
  const denovo = await api.post(`/api/contatos/${a}/iniciar-followup`, {});
  s.ok('clicar de novo e recusado: quem ja tem follow-up a sair nao e reiniciado', denovo.status === 409 && (await aSair(a)).map((x) => x.quando).join() === quandoAntes, String(denovo.status));

  const semPassos = await novaConversa(outro.id);
  const recusa = await api.post(`/api/contatos/${semPassos}/iniciar-followup`, {});
  s.ok('conversa em status sem sequencia: recusado com a explicacao', recusa.status === 400 || recusa.status === 409 || (outro.followups || []).length > 0, String(recusa.status));

  /* --- 2. Acao em massa para Follow up ---------------------------------- */
  const b1 = await novaConversa(followUp.id);
  const b2 = await novaConversa(followUp.id);
  const b3 = await novaConversa(outro.id);
  const lote = await api.post('/api/contatos/acoes-em-massa', { ids: [b1, b2, b3], acao: 'status', valor: followUp.id });
  s.ok('o lote responde quantas conversas ganharam sequencia', lote.status === 200 && lote.dados?.followups === 3, JSON.stringify(lote.dados));
  const sequenciasDoLote = await Promise.all([b1, b2, b3].map(aSair));
  s.ok('todas as escolhidas comecam a sequencia, inclusive as que ja estavam em Follow up', sequenciasDoLote.every((l) => l.length === passos), JSON.stringify(sequenciasDoLote.map((l) => l.length)));
  const primeiras = sequenciasDoLote.map((l) => Date.parse(l[0]?.quando)).sort((x, y) => x - y);
  s.ok(
    'e a primeira mensagem de cada uma sai espalhada (45 s entre uma e outra), nunca tudo junto',
    primeiras[1] - primeiras[0] >= 44000 && primeiras[2] - primeiras[1] >= 44000,
    JSON.stringify(primeiras.map((t, i) => (i ? Math.round((t - primeiras[i - 1]) / 1000) : 0))),
  );

  const c1 = await novaConversa(outro.id);
  const loteOutro = await api.post('/api/contatos/acoes-em-massa', { ids: [c1], acao: 'status', valor: outro.id });
  s.ok('outro status em lote continua nao disparando nada', loteOutro.status === 200 && (await aSair(c1)).length === 0 && (loteOutro.dados?.followups || 0) === 0, JSON.stringify(loteOutro.dados));

  /* --- 3. O botao do status: previa e lote ------------------------------- */
  const e1 = await novaConversa(followUp.id);
  const e2 = await novaConversa(followUp.id);
  const e3 = await novaConversa(followUp.id);
  const concluida = await novaConversa(followUp.id);
  await api.post(`/api/contatos/${concluida}/arquivar`, {});
  const jaTem = await novaConversa(outro.id);
  await api.patch(`/api/contatos/${jaTem}`, { statusId: followUp.id });
  /* Esperando resposta NOSSA: o cliente escreveu por ultimo e o follow-up foi cancelado. */
  const esperando = await novaConversa(followUp.id);
  await api.post('/api/simulador/mensagem', { conexaoId: simulador.id, telefone: `5581931190${String(sufixo).padStart(3, '0')}`, nome: 'Lead que espera', conteudo: 'Oi, alguem pode me responder?' });
  const cancelar = await aSair(esperando);
  if (cancelar.length) await api.post('/api/agendamentos/cancelar', { ids: cancelar.map((x) => x.id) });

  const pendentesAntes = (await Promise.all([e1, e2, e3, concluida, esperando].map(async (id) => (await aSair(id)).length))).reduce((x, y) => x + y, 0);
  const previa = (await api.post(`/api/status/${followUp.id}/iniciar-followup`, { previa: true })).dados;
  const pendentesDepoisDaPrevia = (await Promise.all([e1, e2, e3, concluida, esperando].map(async (id) => (await aSair(id)).length))).reduce((x, y) => x + y, 0);
  s.ok('a previa so conta: nada e agendado', pendentesAntes === pendentesDepoisDaPrevia && pendentesAntes === 0, `${pendentesAntes} -> ${pendentesDepoisDaPrevia}`);
  s.ok('a previa diz quantas entram, quantas esperam resposta nossa e quantas ja tem follow-up', previa?.elegiveis >= 3 && previa?.esperandoNossaResposta >= 1 && previa?.comFollowupEmAndamento >= 1 && previa?.concluidas >= 1, JSON.stringify(previa));
  s.ok('e o tempo do lote (45 s por conversa) e o numero de mensagens de cada uma', previa?.intervaloSegundos === 45 && previa?.mensagensPorConversa === passos && previa?.duracaoMinutos >= 1, JSON.stringify(previa));

  const iniciado = (await api.post(`/api/status/${followUp.id}/iniciar-followup`, {})).dados;
  s.ok('o lote do status comeca todas as que a previa contou', iniciado?.iniciadas === previa?.elegiveis, JSON.stringify(iniciado));
  const aposLote = await Promise.all([e1, e2, e3].map(aSair));
  s.ok('as tres conversas paradas no status agora tem a sequencia inteira', aposLote.every((l) => l.length === passos), JSON.stringify(aposLote.map((l) => l.length)));
  s.ok('a concluida nao entra', (await aSair(concluida)).length === 0);
  s.ok('quem espera resposta nossa nao recebe "conseguiu pensar melhor?"', (await aSair(esperando)).length === 0);
  const primeirasDoLote = aposLote.map((l) => Date.parse(l[0]?.quando)).sort((x, y) => x - y);
  s.ok('e o lote sai espalhado, 45 s entre uma conversa e a outra', primeirasDoLote[1] - primeirasDoLote[0] >= 44000 && primeirasDoLote[2] - primeirasDoLote[1] >= 44000, JSON.stringify(primeirasDoLote.map((t, i) => (i ? Math.round((t - primeirasDoLote[i - 1]) / 1000) : 0))));
  const segunda = (await api.post(`/api/status/${followUp.id}/iniciar-followup`, { previa: true })).dados;
  s.ok('rodar de novo nao acha mais nada parado (so a que espera resposta, e as mesmas de antes)', segunda?.elegiveis === 0 || segunda?.elegiveis < previa?.elegiveis, JSON.stringify(segunda));

  const semSequencia = await api.post(`/api/status/${outro.id}/iniciar-followup`, { previa: true });
  s.ok('status sem sequencia recusa o pedido com a explicacao', (outro.followups || []).length ? semSequencia.status === 200 : semSequencia.status === 400, String(semSequencia.status));

  /* --- 4. O Painel de Saude mostra quantas ficaram sem sequencia --------- */
  const saude = (await api.get('/api/saude')).dados;
  const doStatus = (saude?.varredura?.escritorios || []).flatMap((x) => x.atendimento?.followupPorStatus || []).find((x) => normal(x.status) === 'follow up');
  s.ok('/api/saude conta, por status, as conversas abertas sem follow-up em andamento', typeof doStatus?.semFollowupEmAndamento === 'number', JSON.stringify(doStatus));

  /* Limpeza: o que foi criado aqui nao fica agendado para o resto da suite. */
  for (const id of criados) await api.delete(`/api/contatos/${id}`);
  return s;
}
