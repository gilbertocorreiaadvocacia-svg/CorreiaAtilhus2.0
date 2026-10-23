import { cliente, suite } from './apoio.js';

/**
 * Palavra-chave tambem revisita quando a conversa reabre sem dono engajado
 * (servidor/whatsapp/recebimento.js).
 *
 * Pedido do escritorio em 23/10/2026: "se for salario maternidade, logo e o
 * agente de salario maternidade" — e isso vale tambem para quem ficou
 * pendente (sem agente) e escreveu de novo, ou para quem reabriu depois de
 * arquivada, nao so para a primeiriss ima mensagem de uma conversa nova (que
 * ja funcionava antes). O que nao pode mudar: nunca passa por cima de um
 * HUMANO como responsavel, e nunca troca no meio de uma conversa que um
 * agente ja esta de fato conduzindo (estado 'ia', nao pendente/arquivada).
 */
export async function testarPalavraChaveRevisita({ base }) {
  const s = suite('Palavra-chave revisita pendente/arquivada, nunca humano ou conversa em andamento');
  const api = cliente(base);
  await api.entrar();

  const simulador = ((await api.get('/api/conexoes')).dados || []).find((c) => c.tipo === 'simulador');
  if (!s.ok('ha conexao de simulador', Boolean(simulador))) return s;

  const criarEspecialista = async (nome, palavra) =>
    (
      await api.post('/api/agentes', {
        nome,
        prompt: 'Atenda com educacao.',
        ativo: true,
        palavrasChave: [palavra],
      })
    ).dados;

  const especialistaA = await criarEspecialista('Palavra-chave Revisita A (teste)', 'zzzpalavrachaveteste-a');
  const especialistaB = await criarEspecialista('Palavra-chave Revisita B (teste)', 'zzzpalavrachaveteste-b');
  if (!s.ok('os dois agentes especialistas de teste foram criados', Boolean(especialistaA?.id && especialistaB?.id))) return s;

  const numeroNovo = () => `3294${String(Date.now()).slice(-6)}${Math.floor(Math.random() * 10)}`;
  const mandar = (telefone, conteudo) => api.post('/api/simulador/mensagem', { conexaoId: simulador.id, telefone, nome: 'Cliente de teste', conteudo });

  /* ---------------- Caso 1: pendente, sem ninguem, escreve de novo ---------------- */

  const tel1 = numeroNovo();
  const abertura1 = await mandar(tel1, 'oi, bom dia');
  const id1 = abertura1.dados?.contatoId;
  await api.patch(`/api/contatos/${id1}`, { responsavel: null });
  const pendente1 = await api.get(`/api/contatos/${id1}`);
  s.ok('precondicao: ficou pendente, sem responsavel', pendente1.dados?.estado === 'pendente' && !pendente1.dados?.responsavel, JSON.stringify(pendente1.dados));

  await mandar(tel1, 'quero saber sobre zzzpalavrachaveteste-a');
  const depois1 = await api.get(`/api/contatos/${id1}`);
  s.ok(
    'pendente que escreve de novo com a palavra-chave vai direto para o especialista certo',
    depois1.dados?.responsavel?.id === especialistaA.id && depois1.dados?.estado === 'ia',
    JSON.stringify({ responsavel: depois1.dados?.responsavel, estado: depois1.dados?.estado }),
  );

  /* ---------------- Caso 2: nunca passa por cima de humano ---------------- */

  const tel2 = numeroNovo();
  const abertura2 = await mandar(tel2, 'oi, bom dia');
  const id2 = abertura2.dados?.contatoId;
  await api.patch(`/api/contatos/${id2}`, { responsavel: { tipo: 'membro', id: 'mbr-inexistente-teste' } });
  const comHumano = await api.get(`/api/contatos/${id2}`);
  s.ok(
    'precondicao: pendente, mas com humano como responsavel',
    comHumano.dados?.estado === 'pendente' && comHumano.dados?.responsavel?.tipo === 'membro',
    JSON.stringify(comHumano.dados),
  );

  await mandar(tel2, 'quero saber sobre zzzpalavrachaveteste-a');
  const depois2 = await api.get(`/api/contatos/${id2}`);
  s.ok(
    'com humano como responsavel, a palavra-chave NAO toma a conversa',
    depois2.dados?.responsavel?.tipo === 'membro' && depois2.dados?.responsavel?.id === 'mbr-inexistente-teste',
    JSON.stringify(depois2.dados?.responsavel),
  );

  /* ---------------- Caso 3: arquivada reabre e revisita por palavra-chave nova ---------------- */

  const tel3 = numeroNovo();
  const abertura3 = await mandar(tel3, 'oi, bom dia');
  const id3 = abertura3.dados?.contatoId;
  await api.patch(`/api/contatos/${id3}`, { responsavel: { tipo: 'agente', id: especialistaA.id } });
  await api.post(`/api/contatos/${id3}/arquivar`, { arquivar: true });
  const arquivada3 = await api.get(`/api/contatos/${id3}`);
  s.ok('precondicao: arquivada, com o especialista A como responsavel', arquivada3.dados?.estado === 'arquivado' && arquivada3.dados?.responsavel?.id === especialistaA.id);

  await mandar(tel3, 'na verdade quero falar sobre zzzpalavrachaveteste-b');
  const depois3 = await api.get(`/api/contatos/${id3}`);
  s.ok(
    'arquivada que reabre com palavra-chave nova troca para o especialista certo (nao fica com o antigo)',
    depois3.dados?.responsavel?.id === especialistaB.id && depois3.dados?.estado === 'ia',
    JSON.stringify({ responsavel: depois3.dados?.responsavel, estado: depois3.dados?.estado }),
  );

  /* ---------------- Caso 4: nunca no meio de uma conversa que um agente ja conduz ---------------- */

  const tel4 = numeroNovo();
  const abertura4 = await mandar(tel4, 'oi, bom dia');
  const id4 = abertura4.dados?.contatoId;
  await api.patch(`/api/contatos/${id4}`, { responsavel: { tipo: 'agente', id: especialistaA.id } });
  const emAndamento4 = await api.get(`/api/contatos/${id4}`);
  s.ok('precondicao: estado ia, com o especialista A, conversa em andamento (nao pendente/arquivada)', emAndamento4.dados?.estado === 'ia' && emAndamento4.dados?.responsavel?.id === especialistaA.id);

  await mandar(tel4, 'ah, e tambem zzzpalavrachaveteste-b');
  const depois4 = await api.get(`/api/contatos/${id4}`);
  s.ok(
    'no meio de uma conversa que o agente ja conduz, a palavra-chave de outro especialista NAO troca o responsavel',
    depois4.dados?.responsavel?.id === especialistaA.id,
    JSON.stringify(depois4.dados?.responsavel),
  );

  return s;
}
