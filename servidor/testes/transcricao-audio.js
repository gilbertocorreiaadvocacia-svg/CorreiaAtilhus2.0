import { cliente, suite } from './apoio.js';

/**
 * Audio que o CLIENTE manda vira texto sozinho, com a chave da OpenAI
 * cadastrada — ponta a ponta, contra uma OpenAI de mentira.
 *
 * O caminho (servidor/whatsapp/recebimento.js -> transcrever -> OpenAI ->
 * mensagem.transcricao/conteudo) ja existia e ja era seguro (sem crash, sem
 * perder o audio original quando falha), mas nunca tinha teste proprio —
 * achado ao reconferir, em 09/10/2026, a pergunta "o audio do cliente vira
 * texto sozinho?". O que nao pode falhar: com a chave cadastrada, a mensagem
 * de entrada do tipo audio chega com `transcricao` e `conteudo` preenchidos
 * com o texto que a OpenAI devolveu, e o anexo original continua intacto.
 *
 * 09/10/2026 — motivo da falta de transcricao, visivel: padrao visto no
 * Atilhus Juri (sistema irmao). Sem a chave, a mensagem de audio continua
 * chegando normal (nunca trava o recebimento), mas agora com
 * `transcricaoErro` dizendo exatamente por que nao virou texto, em vez de
 * `transcricao` simplesmente vazia sem explicacao.
 */
export async function testarTranscricaoDeAudio({ base, openai }) {
  const s = suite('Transcricao do audio do cliente');
  const api = cliente(base);
  await api.entrar();
  const oa = cliente(openai);
  const pedidos = async () => (await oa.get('/__chamadas')).dados || [];

  const simulador = ((await api.get('/api/conexoes')).dados || []).find((c) => c.tipo === 'simulador');
  if (!s.ok('ha conexao de simulador', Boolean(simulador))) return s;

  await oa.post('/__zerar', {});
  await api.patch('/api/integracoes', { ia: { chaveOpenai: 'sk-openai-de-mentira' } });

  /* Um audio de mentira precisa existir em disco de verdade: transcrever()
     le o arquivo pelo caminho guardado na midia, igual a um anexo recebido
     de verdade do WhatsApp (recebimento.js ja baixou antes de chamar). */
  const midia = (
    await api.post('/api/midia', {
      nome: 'audio-de-teste.ogg',
      mime: 'audio/ogg',
      conteudoBase64: 'data:audio/ogg;base64,ZmFsc28tYXVkaW8tZGUtdGVzdGU=',
    })
  ).dados;
  if (!s.ok('o audio de mentira sobe para o disco', Boolean(midia?.url), JSON.stringify(midia))) return s;

  const resultado = await api.post('/api/simulador/mensagem', {
    conexaoId: simulador.id,
    telefone: '5581936000001',
    nome: 'Cliente que manda audio',
    tipo: 'audio',
    midia,
  });
  if (!s.ok('a mensagem de entrada e aceita', resultado.status === 200, JSON.stringify(resultado))) return s;

  const lista = (await api.get(`/api/contatos/${resultado.dados.contatoId}/mensagens`)).dados;
  const mensagens = Array.isArray(lista) ? lista : lista?.mensagens || [];
  const recebida = mensagens.find((m) => m.direcao === 'entrada');

  s.ok('a OpenAI de transcricao foi chamada uma vez', (await pedidos()).filter((p) => p.rota === 'transcriptions').length === 1, JSON.stringify(await pedidos()));
  s.ok('a mensagem guarda a transcricao', recebida?.transcricao === 'transcricao de mentira', JSON.stringify(recebida));
  s.ok('e o conteudo da mensagem e a propria transcricao (o agente le isso)', recebida?.conteudo === 'transcricao de mentira', String(recebida?.conteudo));
  s.ok('o audio original continua anexado', recebida?.midia?.tipo === 'audio' && Boolean(recebida?.midia?.url), JSON.stringify(recebida?.midia));
  s.ok('sem erro nenhum quando a transcricao deu certo', !recebida?.transcricaoErro, String(recebida?.transcricaoErro));

  /* --- Sem a chave: a mensagem chega do mesmo jeito, com o motivo exato --- */
  await oa.post('/__zerar', {});
  await api.patch('/api/integracoes', { ia: { chaveOpenai: null } });

  const resultadoSemChave = await api.post('/api/simulador/mensagem', {
    conexaoId: simulador.id,
    telefone: '5581936000002',
    nome: 'Cliente sem chave configurada',
    tipo: 'audio',
    midia,
  });
  if (!s.ok('sem chave, a mensagem de entrada ainda e aceita', resultadoSemChave.status === 200, JSON.stringify(resultadoSemChave))) return s;

  const listaSemChave = (await api.get(`/api/contatos/${resultadoSemChave.dados.contatoId}/mensagens`)).dados;
  const mensagensSemChave = Array.isArray(listaSemChave) ? listaSemChave : listaSemChave?.mensagens || [];
  const recebidaSemChave = mensagensSemChave.find((m) => m.direcao === 'entrada');

  s.ok('a OpenAI nao e chamada sem chave', (await pedidos()).filter((p) => p.rota === 'transcriptions').length === 0, JSON.stringify(await pedidos()));
  s.ok('sem transcricao', !recebidaSemChave?.transcricao, String(recebidaSemChave?.transcricao));
  s.ok('mas com o motivo exato, nao so vazio', /chave da OpenAI/.test(recebidaSemChave?.transcricaoErro || ''), String(recebidaSemChave?.transcricaoErro));
  s.ok('e o audio original ainda chega, intacto', recebidaSemChave?.midia?.tipo === 'audio' && Boolean(recebidaSemChave?.midia?.url), JSON.stringify(recebidaSemChave?.midia));

  return s;
}
