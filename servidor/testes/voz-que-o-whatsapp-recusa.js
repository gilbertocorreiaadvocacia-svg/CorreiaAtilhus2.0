import { cliente, esperar, suite } from './apoio.js';

/**
 * A voz da IA quando o WhatsApp recusa o audio.
 *
 * A voz so e boa se chegar. O servico de WhatsApp (Evolution) converte e entrega
 * o audio, e pode recusar: arquivo que ele nao converte, sessao instavel. Ate
 * 04/11/2026 o texto so entrava de reserva quando a falha era da OpenAI; quando
 * o WhatsApp recusava o audio ja pronto, a mensagem ficava na conversa com erro
 * e o cliente nao recebia NADA — e a conversa parecia respondida.
 *
 * O que nao pode falhar: com o audio entregue, sai so o audio (sem texto
 * duplicado); com o audio recusado, o cliente recebe o texto, a falha fica a
 * vista na conversa e em /api/saude, e nada fica mudo.
 */
const MARCA = 'MARCA-DA-SUITE-VOZ-RECUSADA';
const TELEFONE = '5581977776666';

export async function testarVozQueOWhatsappRecusa({ base, evolucao, chaveEvolucao, anthropic, openai }) {
  const s = suite('Voz da IA quando o WhatsApp recusa o audio');
  const api = cliente(base);
  await api.entrar();
  const falsa = cliente(anthropic);
  const roteiro = (itens) => falsa.post('/__roteiro', { roteiro: itens, marca: MARCA });
  const noServico = async (rota, corpo) =>
    (await fetch(`${evolucao}${rota}`, { method: corpo ? 'POST' : 'GET', headers: { apikey: chaveEvolucao, 'Content-Type': 'application/json' }, body: corpo ? JSON.stringify(corpo) : undefined })).json();
  const enviadas = () => noServico('/__enviadas');

  await api.patch('/api/integracoes', { ia: { chaveAnthropic: 'sk-ant-de-mentira', chaveOpenai: 'sk-openai-de-mentira' } });
  await cliente(openai).post('/__zerar', {});

  /* Uma conexao por QR Code de verdade, apontada para a Evolution de mentira. */
  const criada = await api.post('/api/conexoes', { nome: 'Voz recusada (QR)', tipo: 'qrcode' });
  const conexaoId = criada.dados?.id;
  if (!s.ok('a conexao por QR Code e criada', Boolean(conexaoId))) return s;
  await api.patch(`/api/conexoes/${conexaoId}`, {
    numero: '5581999991111',
    qrcode: { servidor: evolucao, chave: chaveEvolucao, instancia: 'voz-recusada', urlWebhook: base },
  });
  await api.post(`/api/conexoes/${conexaoId}/conectar`);
  await noServico('/__escanear');

  const agente = (await api.post('/api/agentes', { nome: 'Agente da voz recusada' })).dados;
  await api.patch(`/api/agentes/${agente.id}`, {
    delaySegundos: 60,
    prompt: `${MARCA}. Responda de forma curta.`,
  });

  await fetch(`${base}/webhook/${conexaoId}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', apikey: chaveEvolucao },
    body: JSON.stringify({
      event: 'messages.upsert',
      instance: 'voz-recusada',
      data: {
        key: { remoteJid: `${TELEFONE}@s.whatsapp.net`, fromMe: false, id: 'VOZ_RECUSADA_1' },
        pushName: 'Cliente da voz recusada',
        message: { conversation: 'Pode me explicar por audio?' },
        messageType: 'conversation',
      },
    }),
  });
  await esperar(1200);
  const conversa = ((await api.get('/api/contatos?aba=todas&limite=1000')).dados?.contatos || []).find((c) => c.telefone === TELEFONE);
  if (!s.ok('a mensagem do cliente virou conversa na conexao', Boolean(conversa) && conversa.conexaoId === conexaoId)) return s;

  await api.patch(`/api/contatos/${conversa.id}`, { responsavel: { tipo: 'agente', id: agente.id }, modoAudio: true });

  const saidas = async () => {
    const d = (await api.get(`/api/contatos/${conversa.id}/mensagens`)).dados;
    const lista = Array.isArray(d) ? d : d?.mensagens || [];
    return lista.filter((m) => m.direcao === 'saida' && !m.nota);
  };
  const doTexto = (lista, trecho) => lista.filter((e) => String(e.rota).includes('sendText') && String(e.text || '').includes(trecho));
  const doAudio = (lista) => lista.filter((e) => String(e.rota).includes('sendWhatsAppAudio'));

  const temposRegistrados = async () => (await api.get('/api/saude')).dados?.registros?.temposResposta ?? 0;

  /* --- 1. Audio recusado pelo WhatsApp: o cliente recebe o texto ---------
     E a PRIMEIRA resposta da conversa, de proposito: e ali que um texto de
     reserva contado como resposta de novo apareceria no tempo de resposta. */
  const temposAntes = await temposRegistrados();
  await noServico('/__falhar-audio', { recusar: true });
  await roteiro([{ status: 200, texto: 'Resposta B: esta fala precisa chegar mesmo assim.' }]);
  await api.post(`/api/agentes/${agente.id}/responder-agora`, { contatoId: conversa.id });
  await esperar(500);
  const b = await saidas();
  const audioB = b.filter((m) => m.tipo === 'audio').at(-1);
  const textoB = b.filter((m) => m.tipo === 'texto' && String(m.conteudo).includes('Resposta B'));
  s.ok('o audio recusado fica na conversa com o erro a vista', audioB?.situacao === 'erro' && /converter/.test(audioB?.erro?.mensagem || ''), JSON.stringify([audioB?.situacao, audioB?.erro]));
  s.ok('o cliente recebe o TEXTO da mesma resposta', textoB.length === 1 && textoB[0].situacao === 'enviada', JSON.stringify(b.map((m) => [m.tipo, m.situacao, String(m.conteudo).slice(0, 30)])));
  const enviadasB = await enviadas();
  s.ok('e o texto chegou mesmo ao servico de WhatsApp, para o numero certo', doTexto(enviadasB, 'Resposta B').length === 1 && doTexto(enviadasB, 'Resposta B')[0].number === TELEFONE, JSON.stringify(doTexto(enviadasB, 'Resposta B')));
  s.ok('o audio recusado nao conta como entregue no servico', doAudio(enviadasB).length === 0, `${doAudio(enviadasB).length} audio(s) aceito(s)`);
  const temposDepois = await temposRegistrados();
  s.ok('a resposta conta UMA vez no tempo de resposta (o texto de reserva nao conta de novo)', temposDepois - temposAntes === 1, `+${temposDepois - temposAntes}`);

  const saude = (await api.get('/api/saude')).dados;
  const falha = (saude?.voz?.ultimas || []).find((x) => x.ok === false && /WhatsApp recusou/.test(x.erro || ''));
  s.ok('a falha aparece em /api/saude, com o motivo, sem o texto falado', Boolean(falha) && !JSON.stringify(saude?.voz).includes('Resposta B'), JSON.stringify(saude?.voz?.ultimas?.slice(0, 2)));
  const logs = (await api.get(`/api/contatos/${conversa.id}/logs`)).dados;
  const lista = Array.isArray(logs) ? logs : logs?.logs || [];
  s.ok('e a conversa guarda uma linha dizendo que a resposta saiu em texto', lista.some((l) => l.tipo === 'erro_voz' && /saiu em texto/.test(l.descricao || l.texto || l.mensagem || '')), JSON.stringify(lista.filter((l) => l.tipo === 'erro_voz').slice(0, 2)));

  /* --- 2. Audio aceito pelo WhatsApp: so o audio, sem texto duplicado ---- */
  await noServico('/__falhar-audio', { recusar: false });
  await roteiro([{ status: 200, texto: 'Resposta A: vou te explicar com calma.' }]);
  await api.post(`/api/agentes/${agente.id}/responder-agora`, { contatoId: conversa.id });
  await esperar(500);
  const a = await saidas();
  const audioA = a.filter((m) => m.tipo === 'audio').at(-1);
  s.ok('com o WhatsApp aceitando, a resposta sai como audio entregue', audioA?.situacao === 'enviada', JSON.stringify(a.map((m) => [m.tipo, m.situacao])));
  const enviadasA = await enviadas();
  s.ok('o audio chegou ao servico de WhatsApp, para o numero certo', doAudio(enviadasA).length === 1 && doAudio(enviadasA)[0].number === TELEFONE, JSON.stringify(doAudio(enviadasA).map((e) => e.number)));
  s.ok('e o texto NAO vai junto (nada de duplicado para o cliente)', doTexto(enviadasA, 'Resposta A').length === 0 && !a.some((m) => m.tipo === 'texto' && String(m.conteudo).includes('Resposta A')), JSON.stringify(a.map((m) => [m.tipo, String(m.conteudo).slice(0, 20)])));

  /* --- 3. Mais uma, ja normalizado: audio de novo, sem texto de reserva -- */
  await roteiro([{ status: 200, texto: 'Resposta C: tudo certo de novo.' }]);
  await api.post(`/api/agentes/${agente.id}/responder-agora`, { contatoId: conversa.id });
  await esperar(500);
  const enviadasC = await enviadas();
  s.ok('passada a recusa, o audio segue saindo sozinho, sem texto de reserva', doAudio(enviadasC).length === 2 && doTexto(enviadasC, 'Resposta C').length === 0, `${doAudio(enviadasC).length} audios, ${doTexto(enviadasC, 'Resposta C').length} textos`);

  /* Limpeza: as suites seguintes dependem de nao haver chave, agente nem conversa sobrando. */
  await falsa.post('/__roteiro', { roteiro: [] });
  await api.delete(`/api/contatos/${conversa.id}`);
  await api.patch(`/api/agentes/${agente.id}`, { ativo: false });
  await api.delete(`/api/agentes/${agente.id}`);
  await api.delete(`/api/conexoes/${conexaoId}`);
  await api.patch('/api/integracoes', { ia: { chaveAnthropic: null, chaveOpenai: null } });
  return s;
}
