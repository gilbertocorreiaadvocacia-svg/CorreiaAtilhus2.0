import { cliente, esperar, suite } from './apoio.js';

/**
 * A avaliacao do atendimento (automacao/avaliacao.js).
 *
 * O que nao pode falhar: concluir UMA conversa passa para o agente de
 * avaliacao, que pergunta a nota na hora; a nota fica guardada e a conversa
 * volta concluida para quem atendia; nota baixa avisa quem atendeu; e nada
 * disso acontece sem chave de IA, no "Concluir" em massa ou de novo em menos de
 * 90 dias — os tres casos em que o sistema mandaria mensagem sem motivo.
 *
 * A Anthropic e a de mentira, com roteiro (ver encadeamento.js).
 */

const MARCA = 'MARCA-DA-SUITE-DE-AVALIACAO';
const TELEFONE = (n) => `558193100${String(n).padStart(4, '0')}`;

export async function testarAvaliacao({ base, anthropic }) {
  const s = suite('Avaliacao do atendimento');
  const api = cliente(base);
  await api.entrar();
  const falsa = cliente(anthropic);
  const roteiro = (itens) => falsa.post('/__roteiro', { roteiro: itens, marca: MARCA });
  const registro = async () => (await falsa.get('/__chamadas')).dados;

  const simulador = ((await api.get('/api/conexoes')).dados || []).find((c) => c.tipo === 'simulador');
  if (!s.ok('ha conexao de simulador', Boolean(simulador))) return s;

  /* O avaliador desta suite e o unico ligado enquanto ela roda. */
  const outros = ((await api.get('/api/agentes')).dados || []).filter((a) => a.objetivo === 'avaliar' && a.ativo);
  for (const agente of outros) await api.patch(`/api/agentes/${agente.id}`, { ativo: false });

  const avaliador = (await api.post('/api/agentes', { nome: 'Avaliador da Suite', objetivo: 'avaliar' })).dados;
  await api.patch(`/api/agentes/${avaliador.id}`, {
    delaySegundos: 60,
    prompt: `${MARCA}. Pergunte a nota, convide todos para o Google com @avaliacao e encerre com @concluiravaliacao.`,
  });
  const atendente = (await api.post('/api/agentes', { nome: 'Atendente da Suite de Avaliacao' })).dados;
  await api.patch(`/api/agentes/${atendente.id}`, { delaySegundos: 60 });

  const conversa = async (id) => (await api.get(`/api/contatos/${id}`)).dados;
  const saidas = async (id) => {
    const d = (await api.get(`/api/contatos/${id}/mensagens`)).dados;
    return (Array.isArray(d) ? d : d?.mensagens || []).filter((m) => m.direcao === 'saida' && !m.nota);
  };
  /* Conversa com mensagem do cliente, aceita por uma pessoa da equipe. */
  const novaConversa = async (n) => {
    const r = await api.post('/api/simulador/mensagem', {
      conexaoId: simulador.id,
      agenteId: atendente.id,
      telefone: TELEFONE(n),
      nome: `Cliente da Avaliacao ${n}`,
      conteudo: 'Obrigado pela ajuda de hoje',
    });
    const id = r.dados?.contatoId;
    if (id) await api.post(`/api/contatos/${id}/aceitar`);
    return id;
  };
  const concluir = (id) => api.post(`/api/contatos/${id}/arquivar`, { arquivar: true });
  const esperarChamadas = async (quantas) => {
    for (let i = 0; i < 50; i += 1) {
      if ((await registro()).total >= quantas) break;
      await esperar(100);
    }
    await esperar(300);
  };
  const criadas = [];

  try {
    /* ---------------- Sem chave de IA: nao pede ---------------- */

    await api.patch('/api/integracoes', { ia: { chaveAnthropic: null } });
    const semChave = await novaConversa(1);
    criadas.push(semChave);
    await concluir(semChave);
    const r1 = await conversa(semChave);
    s.ok('sem chave de IA, concluir nao pede avaliacao', !r1?.avaliacao && r1?.responsavel?.tipo === 'membro', JSON.stringify(r1?.avaliacao));

    /* ---------------- Pede, pergunta a nota e guarda ---------------- */

    await api.patch('/api/integracoes', { ia: { chaveAnthropic: 'sk-ant-de-mentira' } });
    const contatoId = await novaConversa(2);
    criadas.push(contatoId);
    await roteiro([{ status: 200, texto: 'Oi! De 1 a 5, que nota voce da para o nosso atendimento?' }]);
    await concluir(contatoId);
    const pedida = await conversa(contatoId);
    s.ok(
      'concluir passa a conversa para o agente de avaliacao',
      pedida?.responsavel?.id === avaliador.id && pedida?.avaliacao?.situacao === 'pedida',
      JSON.stringify({ responsavel: pedida?.responsavel, avaliacao: pedida?.avaliacao }),
    );
    s.ok('e a conversa continua concluida', pedida?.estado === 'arquivado', pedida?.estado);
    await esperarChamadas(1);
    s.ok(
      'o agente pergunta a nota sem o cliente escrever',
      (await saidas(contatoId)).some((m) => m.autor?.id === avaliador.id && /nota/.test(m.conteudo || '')),
      (await saidas(contatoId)).map((m) => `${m.autor?.nome}: ${m.conteudo}`).join(' | '),
    );

    await api.post('/api/simulador/mensagem', { conexaoId: simulador.id, telefone: TELEFONE(2), nome: 'Cliente da Avaliacao 2', conteudo: '5' });
    const respondeu = await conversa(contatoId);
    s.ok(
      'a resposta do cliente reabre a conversa com o agente de avaliacao',
      respondeu?.estado === 'ia' && respondeu?.responsavel?.id === avaliador.id,
      JSON.stringify({ estado: respondeu?.estado, responsavel: respondeu?.responsavel }),
    );

    await roteiro([{ status: 200, texto: 'Obrigado pela nota!', chamadas: [{ nome: 'concluir_avaliacao', argumentos: { nota: 5 } }] }]);
    await api.post(`/api/agentes/${avaliador.id}/responder-agora`, { contatoId });
    const fim = await conversa(contatoId);
    s.ok('a nota fica guardada na conversa', fim?.avaliacao?.situacao === 'respondida' && fim?.avaliacao?.nota === 5, JSON.stringify(fim?.avaliacao));
    s.ok(
      'e a conversa volta concluida, com quem atendia',
      fim?.estado === 'arquivado' && fim?.responsavel?.tipo === 'membro',
      JSON.stringify({ estado: fim?.estado, responsavel: fim?.responsavel }),
    );
    s.ok('a despedida chega ao cliente', (await saidas(contatoId)).some((m) => m.conteudo === 'Obrigado pela nota!'));

    await api.post(`/api/contatos/${contatoId}/arquivar`, { arquivar: false });
    await concluir(contatoId);
    const deNovo = await conversa(contatoId);
    s.ok(
      'nao pede de novo em menos de 90 dias',
      deNovo?.avaliacao?.situacao === 'respondida' && deNovo?.responsavel?.tipo === 'membro',
      JSON.stringify({ avaliacao: deNovo?.avaliacao?.situacao, responsavel: deNovo?.responsavel }),
    );

    /* ---------------- Nota baixa avisa quem atendeu ---------------- */

    const baixa = await novaConversa(3);
    criadas.push(baixa);
    await roteiro([
      { status: 200, texto: 'De 1 a 5, que nota voce da para o nosso atendimento?' },
      { status: 200, texto: 'Obrigado pela sinceridade.', chamadas: [{ nome: 'concluir_avaliacao', argumentos: { nota: 2, comentario: 'Demoraram a responder' } }] },
    ]);
    await concluir(baixa);
    await esperarChamadas(1);
    await api.post(`/api/agentes/${avaliador.id}/responder-agora`, { contatoId: baixa });
    const avisos = (await api.get('/api/notificacoes')).dados || [];
    s.ok(
      'nota baixa avisa quem atendeu, com o comentario',
      avisos.some((n) => n.tipo === 'avaliacao' && n.contatoId === baixa && /Demoraram/.test(n.texto || '')),
      JSON.stringify(avisos.filter((n) => n.tipo === 'avaliacao')),
    );

    /* ---------------- Reabrir no meio interrompe ---------------- */

    const reaberta = await novaConversa(4);
    criadas.push(reaberta);
    await roteiro([{ status: 200, texto: 'De 1 a 5, que nota voce da para o nosso atendimento?' }]);
    await concluir(reaberta);
    await esperarChamadas(1);
    await api.post(`/api/contatos/${reaberta}/arquivar`, { arquivar: false });
    const r4 = await conversa(reaberta);
    s.ok(
      'reabrir no meio interrompe a avaliacao e devolve a conversa',
      r4?.avaliacao?.situacao === 'interrompida' && r4?.responsavel?.tipo === 'membro' && r4?.estado !== 'arquivado',
      JSON.stringify({ avaliacao: r4?.avaliacao?.situacao, responsavel: r4?.responsavel, estado: r4?.estado }),
    );

    /* ---------------- Concluir em massa nao pede ---------------- */

    const massa = await novaConversa(5);
    criadas.push(massa);
    await api.post('/api/contatos/acoes-em-massa', { ids: [massa], acao: 'arquivar' });
    s.ok('concluir em massa nao pede avaliacao', !(await conversa(massa))?.avaliacao);
  } finally {
    await falsa.post('/__roteiro', { roteiro: [] });
    await api.patch('/api/integracoes', { ia: { chaveAnthropic: null } });
    for (const id of criadas.filter(Boolean)) await api.delete(`/api/contatos/${id}`);
    for (const agente of [avaliador, atendente]) if (agente?.id) await api.delete(`/api/agentes/${agente.id}`);
    for (const agente of outros) await api.patch(`/api/agentes/${agente.id}`, { ativo: true });
  }
  return s;
}
