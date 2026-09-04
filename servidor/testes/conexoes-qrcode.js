import { cliente, esperar, suite } from './apoio.js';

/**
 * O caminho por QR Code, de ponta a ponta.
 *
 * Cobre o ciclo inteiro contra a Evolution de mentira: criar a conexao,
 * configurar o servico, abrir a sessao, receber mensagem pelo webhook e
 * enviar. Junto com isso, as tres armadilhas que este caminho tem e que
 * custaram caro para descobrir:
 *
 *  - o ECO: a mensagem que nos mesmos enviamos volta no evento do provedor, e
 *    sem descartar, o agente responde a si mesmo em laco;
 *  - o GRUPO: chega como @g.us e, tratado como pessoa, cria conversa com o
 *    numero errado no cadastro;
 *  - o SEGREDO: a chave do servico chega mascarada na tela, e salvar o nome da
 *    conexao com o campo em branco nao pode apagar a chave guardada.
 */
export async function testarQrCode({ base, evolucao, chaveEvolucao }) {
  const s = suite('Caminho por QR Code');
  const api = cliente(base);
  await api.entrar();

  /* 1. Criar */
  const criada = await api.post('/api/conexoes', { nome: 'Comercial (QR)', tipo: 'qrcode' });
  const id = criada.dados?.id;
  s.ok('conexao nasce com o bloco de configuracao do QR Code', criada.status === 200 && Boolean(id));
  s.ok('a instancia ja vem nomeada com o id da conexao', criada.dados?.qrcode?.instancia === id);
  if (!id) return s;

  /* 2. Configurar */
  const configurada = await api.patch(`/api/conexoes/${id}`, {
    numero: '5581999990000',
    qrcode: { servidor: evolucao, chave: chaveEvolucao, instancia: 'correia-teste', urlWebhook: base },
  });
  s.ok('a chave do servico nunca volta em claro', configurada.dados?.qrcode?.chave === '***');

  /* 3. O segredo sobrevive a um salvamento que nao o menciona */
  await api.patch(`/api/conexoes/${id}`, {
    nome: 'Comercial (QR)',
    qrcode: { servidor: evolucao, chave: '***', instancia: 'correia-teste' },
  });
  const aposSalvar = await api.post(`/api/conexoes/${id}/testar`);
  s.ok(
    'salvar sem tocar na chave mantem a chave guardada',
    aposSalvar.dados?.ok === true || String(aposSalvar.dados?.erro || '').includes('sessao'),
    JSON.stringify(aposSalvar.dados),
  );

  /* 4. Abrir a sessao */
  const conectar = await api.post(`/api/conexoes/${id}/conectar`);
  s.ok(
    'conectar devolve o QR Code para a tela desenhar',
    String(conectar.dados?.qrCode || '').startsWith('data:image'),
    conectar.dados?.erro || '',
  );

  /* 5. O celular le o codigo */
  await fetch(`${evolucao}/__escanear`, { headers: { apikey: chaveEvolucao } });
  const teste = await api.post(`/api/conexoes/${id}/testar`);
  s.ok('depois da leitura, a sessao aparece aberta', teste.dados?.ok === true);

  /* 6. Mensagem do cliente chegando pelo webhook */
  const webhook = await fetch(`${base}/webhook/${id}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', apikey: chaveEvolucao },
    body: JSON.stringify({
      event: 'messages.upsert',
      instance: 'correia-teste',
      data: {
        key: { remoteJid: '5581988887777@s.whatsapp.net', fromMe: false, id: 'WA_ABC123' },
        pushName: 'Maria de Teste',
        message: { conversation: 'Bom dia, vi o anuncio sobre o BPC' },
        messageType: 'conversation',
      },
    }),
  });
  s.ok('o webhook responde antes de processar', webhook.status === 200);
  await esperar(1200);

  const contatos = await api.get('/api/contatos');
  const conversa = (contatos.dados?.contatos || []).find((c) => c.telefone === '5581988887777');
  s.ok('a mensagem virou conversa', Boolean(conversa));
  s.ok('o nome do perfil do WhatsApp foi aproveitado', conversa?.nome === 'Maria de Teste');
  if (!conversa) return s;

  /* 7. O eco */
  await fetch(`${base}/webhook/${id}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', apikey: chaveEvolucao },
    body: JSON.stringify({
      event: 'messages.upsert',
      data: {
        key: { remoteJid: '5581988887777@s.whatsapp.net', fromMe: true, id: 'ECO' },
        message: { conversation: 'eco da nossa propria resposta' },
      },
    }),
  });
  await esperar(800);
  const mensagens = await api.get(`/api/contatos/${conversa.id}/mensagens`);
  const lidas = Array.isArray(mensagens.dados) ? mensagens.dados : mensagens.dados?.mensagens || [];
  s.ok(
    'mensagem nossa que volta no evento nao entra como do cliente',
    !lidas.some((m) => m.conteudo === 'eco da nossa propria resposta'),
  );

  /* 8. Enviar */
  const envio = await api.post(`/api/contatos/${conversa.id}/mensagens`, {
    conteudo: 'Bom dia! Sou do escritorio Correia.',
  });
  await esperar(600);
  const noServico = await (await fetch(`${evolucao}/__enviadas`, { headers: { apikey: chaveEvolucao } })).json();
  s.ok(
    'a mensagem chegou ao servico, com o numero certo',
    noServico.some((e) => e.number === '5581988887777' && String(e.text).includes('Correia')),
  );
  const idExterno = envio.dados?.idExterno || envio.dados?.mensagem?.idExterno;
  s.ok('o protocolo devolvido pelo servico foi gravado', String(idExterno || '').startsWith('MOCK_'));

  /* 9. Grupo */
  await fetch(`${base}/webhook/${id}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', apikey: chaveEvolucao },
    body: JSON.stringify({
      event: 'messages.upsert',
      data: {
        key: { remoteJid: '120363999@g.us', fromMe: false, id: 'G1' },
        pushName: 'Grupo do escritorio',
        message: { conversation: 'oi grupo' },
      },
    }),
  });
  await esperar(800);
  const depois = await api.get('/api/contatos');
  s.ok(
    'mensagem de grupo nao cria conversa',
    !(depois.dados?.contatos || []).some((c) => String(c.telefone).includes('120363')),
  );

  /* 10. Chave errada */
  const barrado = await fetch(`${base}/webhook/${id}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', apikey: 'chave-errada' },
    body: JSON.stringify({ event: 'messages.upsert', data: {} }),
  });
  s.ok('webhook com chave errada e recusado', barrado.status === 401);

  /* 11. Trilha de eventos */
  const eventos = await api.get(`/api/conexoes/${id}/eventos`);
  s.ok(
    'a trilha registrou o que aconteceu com o numero',
    Array.isArray(eventos.dados) && eventos.dados.length >= 3,
    `${eventos.dados?.length || 0} eventos`,
  );

  /* 12. Encerrar a sessao */
  const desconectar = await api.post(`/api/conexoes/${id}/desconectar`);
  s.ok('a sessao pode ser encerrada pela equipe', desconectar.dados?.ok === true);

  return s;
}
