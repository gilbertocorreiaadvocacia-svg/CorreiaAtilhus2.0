import { cliente, suite } from './apoio.js';

/**
 * O chat de teste, onde a equipe faz o papel do cliente.
 *
 * Tres coisas precisam ficar afirmadas aqui, porque errar em qualquer uma e
 * silencioso:
 *
 * 1. O agente escolhido na tela e quem responde — inclusive quando a mensagem
 *    traz a palavra-chave de outro agente, e depois de um /restart.
 * 2. O chat NUNCA fala por conexao de verdade. Por um numero real, a resposta
 *    do agente iria para o WhatsApp do numero inventado na tela.
 * 3. O numero digitado ganha o 55, como todo numero digitado.
 */
export async function testarChatDeTeste({ base }) {
  const s = suite('Chat de teste');
  const api = cliente(base);
  await api.entrar();

  const conexoes = (await api.get('/api/conexoes')).dados || [];
  const simulador = conexoes.find((c) => c.tipo === 'simulador');
  if (!s.ok('ha conexao de simulador para o chat de teste', Boolean(simulador))) return s;

  const agentes = ((await api.get('/api/agentes')).dados || []).filter((a) => a.ativo);
  if (!s.ok('ha pelo menos dois agentes ativos para escolher', agentes.length >= 2)) return s;

  const conversa = async (id) => (await api.get(`/api/contatos/${id}`)).dados;
  let contador = 0;
  const numeroNovo = () => `3297${String(Date.now()).slice(-6)}${contador++}`;
  const falar = (dados) => api.post('/api/simulador/mensagem', { conexaoId: simulador.id, nome: 'Cliente de Teste', ...dados });

  /* ---------------- 1. escolher o agente ---------------- */

  const alvo = agentes[1];
  const r1 = await falar({ agenteId: alvo.id, telefone: numeroNovo(), conteudo: 'Bom dia' });
  s.ok('a mensagem do chat de teste e aceita', r1.status === 200, JSON.stringify(r1.dados));
  const c1 = r1.dados?.contatoId ? await conversa(r1.dados.contatoId) : null;
  s.ok(
    'o agente escolhido na tela vira o responsavel',
    c1?.responsavel?.tipo === 'agente' && c1?.responsavel?.id === alvo.id,
    JSON.stringify(c1?.responsavel),
  );
  s.ok('e a conversa fica com a IA', c1?.estado === 'ia', c1?.estado);
  s.ok('a resposta da rota diz quem responde', r1.dados?.responsavel?.id === alvo.id, JSON.stringify(r1.dados?.responsavel));

  /* ---------------- 3. o 55 do numero digitado ---------------- */

  s.ok('o numero digitado ganha o 55', String(c1?.telefone || '').startsWith('55'), c1?.telefone);

  /* ---------------- escolha vence palavra-chave ---------------- */

  const comPalavra = agentes.find((a) => (a.palavrasChave || []).length);
  const outro = comPalavra ? agentes.find((a) => a.id !== comPalavra.id) : null;
  if (comPalavra && outro) {
    const r2 = await falar({
      agenteId: outro.id,
      telefone: numeroNovo(),
      conteudo: `quero saber sobre ${comPalavra.palavrasChave[0]}`,
    });
    const c2 = await conversa(r2.dados.contatoId);
    s.ok(
      'o agente escolhido vence a palavra-chave de outro agente',
      c2?.responsavel?.id === outro.id,
      `ficou com ${c2?.responsavel?.nome}; a palavra era de ${comPalavra.nome}`,
    );
  }

  /* ---------------- automatico = regra real ---------------- */

  const r3 = await falar({ agenteId: null, telefone: numeroNovo(), conteudo: 'Bom dia' });
  const c3 = await conversa(r3.dados.contatoId);
  const padrao = simulador.responsavelPadrao;
  s.ok(
    'no automatico vale o padrao da conexao, como no WhatsApp',
    padrao ? c3?.responsavel?.id === padrao.id : !c3?.responsavel,
    JSON.stringify(c3?.responsavel),
  );

  /* ---------------- /restart mantem a escolha ---------------- */

  const tel = numeroNovo();
  await falar({ agenteId: alvo.id, telefone: tel, conteudo: 'oi' });
  const rr = await falar({ agenteId: alvo.id, telefone: tel, conteudo: '/restart' });
  s.ok('recomecar e reconhecido', rr.dados?.reiniciado === true, JSON.stringify(rr.dados));
  const c4 = await conversa(rr.dados.contatoId);
  s.ok(
    'recomecar devolve a conversa ao agente escolhido, e nao ao padrao',
    c4?.responsavel?.id === alvo.id,
    JSON.stringify(c4?.responsavel),
  );

  /* ---------------- 2. nunca por conexao de verdade ---------------- */

  const real = (await api.post('/api/conexoes', { nome: 'Numero de verdade (teste)', tipo: 'qrcode' })).dados;
  const r5 = await falar({ conexaoId: real?.id, telefone: numeroNovo(), conteudo: 'oi' });
  s.ok('o chat de teste recusa conexao que nao e de simulador', r5.status === 400, String(r5.status));
  if (real?.id) await api.delete(`/api/conexoes/${real.id}`);

  /* ---------------- agente desligado ---------------- */

  const desligavel = agentes[agentes.length - 1];
  await api.patch(`/api/agentes/${desligavel.id}`, { ativo: false });
  const r6 = await falar({ agenteId: desligavel.id, telefone: numeroNovo(), conteudo: 'oi' });
  s.ok(
    'agente desligado e recusado, dizendo o motivo',
    r6.status === 400 && /deslig/i.test(JSON.stringify(r6.dados)),
    `${r6.status} ${JSON.stringify(r6.dados)}`,
  );
  await api.patch(`/api/agentes/${desligavel.id}`, { ativo: true });

  return s;
}
