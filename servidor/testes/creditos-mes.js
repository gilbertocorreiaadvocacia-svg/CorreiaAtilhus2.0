import { cliente, suite } from './apoio.js';

/**
 * Quanto cada lead consumiu de credito no mes corrente, ao vivo no painel da
 * conversa (GET /api/contatos/:id/creditos-mes). Pedido do escritorio em
 * 13/10/2026, igual ao painel geral de Configuracoes > Consumo
 * (nucleo/creditos.js: consumoDoWorkspace), mas por lead e sem esperar quem
 * abre o dashboard — o numero sobe conforme a IA responde esta conversa.
 *
 * O que nao pode falhar: o numero e POR CONVERSA (o credito de um lead nunca
 * aparece na conta de outro) e SOBE conforme a IA volta a responder o mesmo
 * lead, sem precisar de nenhuma acao manual.
 */
export async function testarCreditosMes({ base, anthropic }) {
  const s = suite('Creditos do mes, por lead');
  const api = cliente(base);
  await api.entrar();
  const falsa = cliente(anthropic);
  const roteiro = (itens) => falsa.post('/__roteiro', { roteiro: itens });

  await api.patch('/api/integracoes', { ia: { chaveAnthropic: 'sk-ant-de-mentira' } });

  const simulador = ((await api.get('/api/conexoes')).dados || []).find((c) => c.tipo === 'simulador');
  if (!s.ok('ha conexao de simulador', Boolean(simulador))) return s;

  const agente = (await api.post('/api/agentes', { nome: 'Agente de creditos' })).dados;
  await api.patch(`/api/agentes/${agente.id}`, { delaySegundos: 60, prompt: 'Responda qualquer coisa em uma frase.' });

  /* Lead A: uma rodada de IA, que ja lanca credito de processamento (ver
     ia/motor.js, lancar(..., 'processamento_ia', ...) a cada volta). */
  await roteiro([{ status: 200, texto: 'Oi! Como posso ajudar?' }]);
  const criadoA = await api.post('/api/simulador/mensagem', {
    conexaoId: simulador.id,
    agenteId: agente.id,
    telefone: '5581937000001',
    nome: 'Lead A dos creditos',
    conteudo: 'Oi',
  });
  const contatoA = criadoA.dados?.contatoId;
  if (!s.ok('a conversa do Lead A foi criada', Boolean(contatoA))) return s;
  await api.post(`/api/agentes/${agente.id}/responder-agora`, { contatoId: contatoA });

  /* Lead B: existe, mas ainda nao teve nenhuma rodada de IA. */
  const criadoB = await api.post('/api/simulador/mensagem', {
    conexaoId: simulador.id,
    agenteId: agente.id,
    telefone: '5581937000002',
    nome: 'Lead B dos creditos',
    conteudo: 'Oi',
  });
  const contatoB = criadoB.dados?.contatoId;
  if (!s.ok('a conversa do Lead B foi criada', Boolean(contatoB))) return s;

  const mesDoA1 = (await api.get(`/api/contatos/${contatoA}/creditos-mes`)).dados;
  s.ok('o Lead A ja tem credito lancado no mes', mesDoA1?.creditos > 0, JSON.stringify(mesDoA1));

  const mesDoB = (await api.get(`/api/contatos/${contatoB}/creditos-mes`)).dados;
  s.ok(
    'o credito do Lead A nunca aparece na conta do Lead B (sem nenhuma IA ainda, fica zero)',
    mesDoB?.creditos === 0,
    JSON.stringify(mesDoB),
  );

  /* O Lead A continua a conversa: o numero sobe, sem nenhuma acao manual, so
     pela IA ter respondido de novo (e por isso que aparece "ao vivo"). */
  await roteiro([{ status: 200, texto: 'Claro, me conta mais.' }]);
  await api.post('/api/simulador/mensagem', {
    conexaoId: simulador.id,
    telefone: '5581937000001',
    nome: 'Lead A dos creditos',
    conteudo: 'Quero saber sobre BPC',
  });
  await api.post(`/api/agentes/${agente.id}/responder-agora`, { contatoId: contatoA });

  const mesDoA2 = (await api.get(`/api/contatos/${contatoA}/creditos-mes`)).dados;
  s.ok(
    'depois da segunda rodada, o credito do mes do Lead A subiu',
    mesDoA2?.creditos > mesDoA1?.creditos,
    `antes: ${mesDoA1?.creditos}, depois: ${mesDoA2?.creditos}`,
  );

  return s;
}
