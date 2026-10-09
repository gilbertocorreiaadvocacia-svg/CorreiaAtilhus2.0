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

  /* Limpeza: a suite seguinte depende de nao haver chave da OpenAI cadastrada. */
  await api.patch('/api/integracoes', { ia: { chaveOpenai: null } });

  return s;
}
