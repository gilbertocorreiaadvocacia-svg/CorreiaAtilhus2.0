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

  /*
   * 7. As duas caras de uma mensagem "nossa".
   *
   * A sessao por QR Code usa o mesmo aparelho para os dois lados, entao tudo o
   * que sai do numero volta como evento marcado `fromMe`. Dentro disso ha duas
   * coisas opostas, e confundi-las quebra a conversa de um jeito ou de outro:
   *
   *   o ECO do que o sistema enviou   -> tem de ser DESCARTADO. Gravar de novo
   *      poe a mesma frase duas vezes na tela, e o agente responde a si mesmo.
   *   o que a pessoa digitou NO CELULAR -> tem de ENTRAR, como saida. Sem isso
   *      a conversa mostra a pergunta do cliente e silencio depois, e um
   *      atendimento que foi feito parece abandonado.
   */
  const daEquipe = (texto, idExt) =>
    fetch(`${base}/webhook/${id}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', apikey: chaveEvolucao },
      body: JSON.stringify({
        event: 'messages.upsert',
        data: {
          key: { remoteJid: '5581988887777@s.whatsapp.net', fromMe: true, id: idExt },
          message: { conversation: texto },
        },
      }),
    });

  const lerMensagens = async () => {
    const r = await api.get(`/api/contatos/${conversa.id}/mensagens`);
    return Array.isArray(r.dados) ? r.dados : r.dados?.mensagens || [];
  };

  /* 7a. Digitada no celular: entra, e entra como NOSSA. */
  await daEquipe('respondi por aqui mesmo, pelo celular', 'CEL1');
  await esperar(800);
  const comCelular = await lerMensagens();
  const doCelular = comCelular.filter((m) => m.conteudo === 'respondi por aqui mesmo, pelo celular');
  s.ok('resposta digitada no celular aparece na conversa', doCelular.length === 1, `apareceu ${doCelular.length} vez(es)`);
  s.ok('e aparece como nossa, nao como do cliente', doCelular[0]?.direcao === 'saida', doCelular[0]?.direcao);
  s.ok(
    'com autoria que nao inventa quem digitou',
    doCelular[0]?.autor?.nome === 'Pelo celular',
    JSON.stringify(doCelular[0]?.autor),
  );

  /* 7b. O mesmo evento chegando duas vezes nao duplica: o id ja e conhecido. */
  await daEquipe('respondi por aqui mesmo, pelo celular', 'CEL1');
  await esperar(800);
  const depoisDeRepetir = (await lerMensagens()).filter(
    (m) => m.conteudo === 'respondi por aqui mesmo, pelo celular',
  );
  s.ok('o mesmo evento repetido nao duplica a mensagem', depoisDeRepetir.length === 1, `ficaram ${depoisDeRepetir.length}`);

  /* 7c. O eco do que o SISTEMA enviou, com id que ele nunca viu.
     E o caso da corrida: o webhook chega antes de o envio gravar o id. So o
     texto identico e recente denuncia que a mensagem ja esta la. */
  const enviadaPelaTela = await api.post(`/api/contatos/${conversa.id}/mensagens`, {
    conteudo: 'mensagem enviada pela tela do sistema',
  });
  s.ok('a tela conseguiu enviar', enviadaPelaTela.status === 200, String(enviadaPelaTela.status));
  await esperar(400);
  await daEquipe('mensagem enviada pela tela do sistema', 'ID-QUE-O-SISTEMA-NAO-VIU');
  await esperar(800);
  const aposEco = (await lerMensagens()).filter((m) => m.conteudo === 'mensagem enviada pela tela do sistema');
  s.ok(
    'o eco do proprio envio nao vira uma segunda mensagem',
    aposEco.length === 1,
    `ficaram ${aposEco.length}`,
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
