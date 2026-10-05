import { cliente, suite } from './apoio.js';

/**
 * A voz do agente, de ponta a ponta, contra uma OpenAI de mentira.
 *
 * Quem nao sabe ler precisa ouvir a resposta. O caminho existia (o agente liga
 * o modo audio com @ativaraudio e o motor fala em vez de so escrever), mas
 * nunca tinha sido exercido: so apareceria no primeiro cliente de verdade.
 *
 * O que nao pode falhar: sem o modo ligado, sai texto; ligado, sai AUDIO com
 * o texto junto (a equipe le o historico sem abrir cada audio), com a voz e a
 * velocidade escolhidas no agente; e se a OpenAI falhar, o cliente recebe o
 * texto — nunca o silencio.
 */
const MARCA = 'MARCA-DA-SUITE-VOZ';

export async function testarVoz({ base, anthropic, openai }) {
  const s = suite('Voz do agente');
  const api = cliente(base);
  await api.entrar();
  const falsa = cliente(anthropic);
  const roteiro = (itens) => falsa.post('/__roteiro', { roteiro: itens, marca: MARCA });
  const oa = cliente(openai);
  const pedidos = async () => (await oa.get('/__chamadas')).dados || [];

  const simulador = ((await api.get('/api/conexoes')).dados || []).find((c) => c.tipo === 'simulador');
  if (!s.ok('ha conexao de simulador', Boolean(simulador))) return s;

  await oa.post('/__zerar', {});
  await api.patch('/api/integracoes', { ia: { chaveAnthropic: 'sk-ant-de-mentira', chaveOpenai: 'sk-openai-de-mentira' } });

  const voz = (await api.post('/api/vozes', { nome: 'Voz do Teste', vozBase: 'shimmer', velocidade: 0.9 })).dados;
  if (!s.ok('a voz e cadastrada', Boolean(voz?.id), JSON.stringify(voz))) return s;
  const agente = (await api.post('/api/agentes', { nome: 'Agente que fala' })).dados;
  await api.patch(`/api/agentes/${agente.id}`, {
    delaySegundos: 60,
    vozId: voz.id,
    prompt: `${MARCA}. Se o cliente disser que nao sabe ler, use @ativaraudio. Para voltar ao texto, @desativaraudio.`,
  });

  let sufixo = 0;
  const novaConversa = async () => {
    sufixo += 1;
    const r = await api.post('/api/simulador/mensagem', {
      conexaoId: simulador.id,
      agenteId: agente.id,
      telefone: `558193200${String(sufixo).padStart(4, '0')}`,
      nome: 'Cliente de Voz',
      conteudo: 'Eu nao sei ler direito, pode me explicar?',
    });
    return r.dados?.contatoId;
  };
  const saidas = async (id) => {
    const d = (await api.get(`/api/contatos/${id}/mensagens`)).dados;
    const lista = Array.isArray(d) ? d : d?.mensagens || [];
    return lista.filter((m) => m.direcao === 'saida' && !m.nota);
  };
  const ligar = { nome: 'modo_audio', argumentos: { ligar: true } };
  const desligar = { nome: 'modo_audio', argumentos: { ligar: false } };

  /* --- 1. Sem o modo ligado, texto -------------------------------------- */
  const a = await novaConversa();
  await roteiro([{ status: 200, texto: 'Resposta escrita normal.' }]);
  await api.post(`/api/agentes/${agente.id}/responder-agora`, { contatoId: a });
  const texto = await saidas(a);
  s.ok('sem o modo audio, a resposta sai como texto', texto.length === 1 && texto[0].tipo !== 'audio', JSON.stringify(texto.map((m) => m.tipo)));
  s.ok('e a OpenAI nao e chamada a toa', (await pedidos()).length === 0, JSON.stringify(await pedidos()));

  /* --- 2. O cliente diz que nao sabe ler: o agente liga e FALA ---------- */
  const b = await novaConversa();
  await roteiro([
    { status: 200, texto: 'Claro, vou falar com voce por audio.', chamadas: [ligar] },
    { status: 200, texto: 'Pode ficar tranquilo, eu explico tudo.' },
  ]);
  await api.post(`/api/agentes/${agente.id}/responder-agora`, { contatoId: b });
  const falada = await saidas(b);
  const audio = falada.find((m) => m.tipo === 'audio');
  s.ok('ligado o modo, a resposta sai como AUDIO', Boolean(audio), JSON.stringify(falada.map((m) => m.tipo)));
  s.ok('o audio tem arquivo guardado', Boolean(audio?.midia?.url || audio?.midia?.arquivo), JSON.stringify(audio?.midia));
  s.ok('e o texto vai junto, para a equipe ler o historico', String(audio?.conteudo || '').includes('Claro, vou falar'), JSON.stringify(audio?.conteudo));
  const fala = (await pedidos()).filter((p) => p.rota === 'speech');
  s.ok('a OpenAI foi chamada uma vez', fala.length === 1, JSON.stringify(fala));
  s.ok('com a voz escolhida no agente', fala[0]?.voice === 'shimmer', JSON.stringify(fala[0]));
  s.ok('na velocidade da voz', fala[0]?.speed === 0.9, JSON.stringify(fala[0]));
  s.ok('com a chave do escritorio', fala[0]?.autorizacao === 'Bearer sk-openai-de-mentira', String(fala[0]?.autorizacao));
  s.ok('lendo a fala inteira (as duas falas da rodada)', String(fala[0]?.input || '').includes('eu explico tudo'), String(fala[0]?.input));

  /* --- 3. A conversa continua em audio na mensagem seguinte ------------- */
  await oa.post('/__zerar', {});
  await roteiro([{ status: 200, texto: 'Segue a explicacao do beneficio.' }]);
  await api.post(`/api/agentes/${agente.id}/responder-agora`, { contatoId: b });
  const seguinte = (await saidas(b)).filter((m) => m.tipo === 'audio');
  s.ok('a mensagem seguinte tambem vai em audio', seguinte.length === 2, JSON.stringify((await saidas(b)).map((m) => m.tipo)));

  /* --- 4. Voltar ao texto ----------------------------------------------- */
  await roteiro([
    { status: 200, texto: 'Certo, volto a escrever.', chamadas: [desligar] },
    { status: 200, texto: 'Pronto, de volta ao texto.' },
  ]);
  await api.post(`/api/agentes/${agente.id}/responder-agora`, { contatoId: b });
  const depois = await saidas(b);
  s.ok('desligado o modo, a resposta volta a ser texto', depois[depois.length - 1].tipo !== 'audio', JSON.stringify(depois.map((m) => m.tipo)));

  /* --- 5. Falha na OpenAI vira texto, nao silencio ---------------------- */
  const c = await novaConversa();
  await oa.post('/__zerar', {});
  await roteiro([
    { status: 200, texto: 'Vou falar por audio.', chamadas: [ligar] },
    { status: 200, texto: 'Esta fala precisa chegar mesmo assim.' },
  ]);
  await oa.post('/__falhar', { status: 500 });
  await api.post(`/api/agentes/${agente.id}/responder-agora`, { contatoId: c });
  const semAudio = await saidas(c);
  s.ok(
    'OpenAI fora do ar: o cliente recebe o TEXTO',
    semAudio.length >= 1 && semAudio.every((m) => m.tipo !== 'audio') && semAudio.map((m) => m.conteudo).join(' ').includes('precisa chegar'),
    JSON.stringify(semAudio.map((m) => [m.tipo, m.conteudo])),
  );

  /* --- 6. Sem chave, tambem texto, e sem chamar ninguem ----------------- */
  const d = await novaConversa();
  await oa.post('/__zerar', {});
  await roteiro([
    { status: 200, texto: 'Vou falar por audio.', chamadas: [ligar] },
    { status: 200, texto: 'Sem chave, sai escrito.' },
  ]);
  await api.patch('/api/integracoes', { ia: { chaveOpenai: null } });
  await api.post(`/api/agentes/${agente.id}/responder-agora`, { contatoId: d });
  const escritas = await saidas(d);
  s.ok('sem chave da OpenAI, sai texto', escritas.length >= 1 && escritas.every((m) => m.tipo !== 'audio'), JSON.stringify(escritas.map((m) => m.tipo)));
  s.ok('e nenhuma chamada e feita', (await pedidos()).length === 0, JSON.stringify(await pedidos()));

  /* Limpeza: a suite seguinte conta agente e depende de nao haver chave. */
  await falsa.post('/__roteiro', { roteiro: [] });
  await api.patch(`/api/agentes/${agente.id}`, { ativo: false });
  await api.delete(`/api/agentes/${agente.id}`);
  await api.delete(`/api/vozes/${voz.id}`);
  await api.patch('/api/integracoes', { ia: { chaveAnthropic: null, chaveOpenai: null } });
  return s;
}
