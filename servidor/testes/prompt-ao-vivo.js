import { cliente, suite } from './apoio.js';

/**
 * Editar o prompt de um agente no meio de uma conversa vale a partir da
 * PROXIMA mensagem, sem reiniciar o servidor.
 *
 * O motor busca o agente do banco a cada volta (servidor/ia/motor.js,
 * rodarAgente), e o banco guarda o registro em memoria sem nenhuma camada de
 * cache paralela (servidor/nucleo/banco.js): um PATCH em /api/agentes/:id
 * muda o MESMO objeto que o motor vai ler na chamada seguinte. Isso ja estava
 * certo no codigo, mas nao tinha teste proprio travando contra regressao —
 * so provas indiretas (achado de 08/10/2026, ao confirmar o pedido "a IA esta
 * correspondendo aos prompts dos agentes?").
 *
 * O que nao pode falhar: a chamada de IA de uma conversa ja em andamento
 * carrega o texto do prompt como ele esta AGORA, nao como estava quando a
 * conversa comecou.
 */
const MARCA = 'MARCA-DA-SUITE-PROMPT-AO-VIVO';

export async function testarPromptAoVivo({ base, anthropic }) {
  const s = suite('Prompt editado vale na hora');
  const api = cliente(base);
  await api.entrar();
  const falsa = cliente(anthropic);
  const roteiro = (itens) => falsa.post('/__roteiro', { roteiro: itens, marca: MARCA });
  const sistemaDaUltimaChamada = async () => {
    const { chamadas } = (await falsa.get('/__chamadas')).dados;
    return chamadas[0]?.sistemaCompleto || '';
  };

  const simulador = ((await api.get('/api/conexoes')).dados || []).find((c) => c.tipo === 'simulador');
  if (!s.ok('ha conexao de simulador', Boolean(simulador))) return s;

  await api.patch('/api/integracoes', { ia: { chaveAnthropic: 'sk-ant-de-mentira' } });

  const agente = (await api.post('/api/agentes', { nome: 'Agente do prompt ao vivo' })).dados;
  await api.patch(`/api/agentes/${agente.id}`, { delaySegundos: 60, prompt: `${MARCA}. Regra original: nunca ofereca desconto.` });

  const contatoId = (
    await api.post('/api/simulador/mensagem', {
      conexaoId: simulador.id,
      agenteId: agente.id,
      telefone: '5581935000001',
      nome: 'Cliente do prompt ao vivo',
      conteudo: 'Oi, quero saber sobre o servico',
    })
  ).dados?.contatoId;
  if (!s.ok('cria a conversa', Boolean(contatoId))) return s;

  await roteiro([{ status: 200, texto: 'Oi! Como posso ajudar?' }]);
  await api.post(`/api/agentes/${agente.id}/responder-agora`, { contatoId });
  const antes = await sistemaDaUltimaChamada();
  s.ok('a primeira chamada leva o prompt original', antes.includes('Regra original: nunca ofereca desconto'), antes.slice(0, 200));

  await api.patch(`/api/agentes/${agente.id}`, { prompt: `${MARCA}. Regra nova: pode oferecer 10% de desconto.` });

  await roteiro([{ status: 200, texto: 'Oi de novo! Como posso ajudar?' }]);
  await api.post(`/api/agentes/${agente.id}/responder-agora`, { contatoId });
  const depois = await sistemaDaUltimaChamada();
  s.ok('sem reiniciar o servidor, a proxima chamada ja leva o prompt editado', depois.includes('Regra nova: pode oferecer 10% de desconto'), depois.slice(0, 200));
  s.ok('e nao carrega mais a regra antiga', !depois.includes('Regra original: nunca ofereca desconto'), depois.slice(0, 200));

  /* Limpeza: a suite seguinte conta agente e depende de nao haver roteiro preso. */
  await falsa.post('/__roteiro', { roteiro: [] });
  await api.patch(`/api/agentes/${agente.id}`, { ativo: false });

  return s;
}
