import { cliente, esperar, suite } from './apoio.js';

/**
 * A origem do lead lida na propria mensagem (nucleo/origens.js).
 *
 * O que nao pode falhar: quem chega por anuncio do Instagram cai em "Trafego
 * pago · Instagram", com o anuncio guardado; quem chega pelo perfil cai em
 * "Instagram"; a marca vence a palavra-chave; e uma origem que alguem ja
 * escolheu nunca e trocada por ela.
 *
 * Tudo pelo webhook do QR Code, com o formato da Evolution: e por ali que o
 * escritorio recebe, e era ali que a marca do anuncio se perdia.
 */
export async function testarOrigens({ base, evolucao, chaveEvolucao }) {
  const s = suite('Origem do lead pela mensagem');
  const api = cliente(base);
  await api.entrar();

  const criada = await api.post('/api/conexoes', { nome: 'Origens (QR)', tipo: 'qrcode' });
  const id = criada.dados?.id;
  if (!s.ok('conexao de QR Code para a suite', Boolean(id))) return s;
  await api.patch(`/api/conexoes/${id}`, {
    qrcode: { servidor: evolucao, chave: chaveEvolucao, instancia: 'correia-origens', urlWebhook: base },
  });

  const origens = (await api.get('/api/origens')).dados || [];
  const doCanal = (canal) => origens.find((o) => o.canal === canal);
  s.ok(
    'as origens de anuncio e de Instagram existem, cada uma com o seu canal',
    ['anuncio_instagram', 'anuncio_facebook', 'anuncio', 'instagram', 'facebook'].every((c) => doCanal(c)),
    JSON.stringify(origens.map((o) => [o.nome, o.canal])),
  );
  s.ok(
    'a origem paga da semeadura antiga foi reconhecida, e nao duplicada',
    origens.filter((o) => o.canal === 'anuncio_instagram').length === 1 && doCanal('anuncio_instagram')?.pago === true,
  );
  s.ok(
    '"instagram" na mensagem passou a apontar para o perfil, e nao para o anuncio',
    (doCanal('instagram')?.palavrasChave || []).includes('instagram') &&
      !(doCanal('anuncio_instagram')?.palavrasChave || []).includes('instagram'),
    JSON.stringify({ perfil: doCanal('instagram')?.palavrasChave, pago: doCanal('anuncio_instagram')?.palavrasChave }),
  );

  const enviar = (telefone, message, extra = {}) =>
    fetch(`${base}/webhook/${id}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', apikey: chaveEvolucao },
      body: JSON.stringify({
        event: 'messages.upsert',
        instance: 'correia-origens',
        data: { key: { remoteJid: `${telefone}@s.whatsapp.net`, fromMe: false, id: `ORG_${telefone}_${Date.now()}` }, pushName: 'Lead da Suite', message, ...extra },
      }),
    });
  const conversa = async (telefone) => {
    const lista = (await api.get('/api/contatos?aba=todas&limite=500')).dados?.contatos || [];
    return lista.find((c) => c.telefone === telefone);
  };

  /* 1. Anuncio do Instagram: a marca vem dentro de extendedTextMessage. */
  await enviar('5581977001001', {
    extendedTextMessage: {
      text: 'Ola! Quero saber mais sobre o BPC.',
      contextInfo: {
        externalAdReply: {
          title: 'BPC para idosos: veja se voce tem direito',
          body: 'Fale com um advogado agora',
          sourceType: 'ad',
          sourceId: '120210000000000',
          sourceUrl: 'https://www.instagram.com/p/C0DIGODOANUNCIO/',
          ctwaClid: 'CLID_INSTAGRAM_SUITE',
        },
      },
    },
  });
  await esperar(900);
  const doAnuncio = await conversa('5581977001001');
  s.ok('anuncio do Instagram vira "Trafego pago · Instagram"', doAnuncio?.origem?.canal === 'anuncio_instagram', JSON.stringify(doAnuncio?.origem));
  s.ok('e a fila recebe a origem como paga', doAnuncio?.origem?.pago === true);
  s.ok(
    'o anuncio fica guardado: titulo, endereco e o CTWA Clid da Meta',
    doAnuncio?.anuncio?.ctwaClid === 'CLID_INSTAGRAM_SUITE' &&
      doAnuncio?.rastroDeOrigem?.title === 'BPC para idosos: veja se voce tem direito' &&
      /instagram\.com/.test(doAnuncio?.rastroDeOrigem?.sourceURL || ''),
    JSON.stringify(doAnuncio?.rastroDeOrigem),
  );
  s.ok('a conversa sabe que a origem foi lida na mensagem', doAnuncio?.origemAutomatica?.canal === 'anuncio_instagram');

  /* 2. Botao do perfil do Instagram: sem anuncio, com o aplicativo de entrada.
        O texto fala de anuncio, e mesmo assim a marca vence a palavra-chave. */
  await enviar('5581977001002', {
    extendedTextMessage: {
      text: 'Oi, vi o anuncio de voces',
      contextInfo: { entryPointConversionSource: 'ig_profile', entryPointConversionApp: 'instagram' },
    },
  });
  await esperar(900);
  const doPerfil = await conversa('5581977001002');
  s.ok('perfil do Instagram vira "Instagram", sem virar pago', doPerfil?.origem?.canal === 'instagram' && doPerfil?.origem?.pago === false, JSON.stringify(doPerfil?.origem));
  s.ok('sem anuncio, nada vai para a API de Conversoes', !doPerfil?.anuncio);

  /* 3. Anuncio do Facebook, com a marca na raiz do evento. */
  await enviar(
    '5581977001003',
    { conversation: 'Quero falar sobre auxilio-acidente' },
    { contextInfo: { externalAdReply: { title: 'Auxilio-acidente', sourceType: 'ad', sourceUrl: 'https://fb.me/2abcDEF', ctwaClid: 'CLID_FB_SUITE' } } },
  );
  await esperar(900);
  const doFacebook = await conversa('5581977001003');
  s.ok('anuncio do Facebook vira "Trafego pago · Facebook"', doFacebook?.origem?.canal === 'anuncio_facebook', JSON.stringify(doFacebook?.origem));

  /* 4. Sem marca: continua valendo a palavra-chave. */
  await enviar('5581977001004', { conversation: 'Boa tarde, vi voces no instagram' });
  await esperar(900);
  const semMarca = await conversa('5581977001004');
  s.ok('sem marca, "instagram" no texto leva para o perfil', semMarca?.origem?.canal === 'instagram', JSON.stringify(semMarca?.origem));
  s.ok('e a origem nao se passa por lida na mensagem', !semMarca?.origemAutomatica);

  /* 5. Origem escolhida por alguem nao e trocada pela marca de depois. */
  const indicacao = origens.find((o) => !o.canal && /indica/i.test(o.nome));
  await enviar('5581977001005', { conversation: 'Ola' });
  await esperar(700);
  const manual = await conversa('5581977001005');
  if (manual && indicacao) await api.patch(`/api/contatos/${manual.id}`, { origemId: indicacao.id });
  await enviar('5581977001005', {
    extendedTextMessage: {
      text: 'Voltei pelo anuncio',
      contextInfo: { externalAdReply: { sourceType: 'ad', sourceUrl: 'https://www.instagram.com/p/X/', ctwaClid: 'CLID_DEPOIS' } },
    },
  });
  await esperar(900);
  const depois = await conversa('5581977001005');
  s.ok(
    'origem escolhida pela equipe nao e trocada pelo anuncio de depois',
    Boolean(indicacao) && depois?.origemId === indicacao.id,
    JSON.stringify({ indicacao: indicacao?.id, agora: depois?.origemId }),
  );

  /* 6. A nossa mensagem nao carrega marca de origem. */
  await fetch(`${base}/webhook/${id}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', apikey: chaveEvolucao },
    body: JSON.stringify({
      event: 'messages.upsert',
      data: {
        key: { remoteJid: '5581977001006@s.whatsapp.net', fromMe: true, id: 'ORG_NOSSA' },
        message: { extendedTextMessage: { text: 'Mensagem nossa', contextInfo: { externalAdReply: { sourceType: 'ad', ctwaClid: 'NAO' } } } },
      },
    }),
  });
  await esperar(700);
  const nossa = await conversa('5581977001006');
  s.ok('mensagem enviada por nos nao vira origem de anuncio', !nossa || !nossa.origemAutomatica, JSON.stringify(nossa?.origem));

  /* Limpeza: as conversas e a conexao da suite. */
  for (const telefone of ['5581977001001', '5581977001002', '5581977001003', '5581977001004', '5581977001005', '5581977001006']) {
    const c = await conversa(telefone);
    if (c) await api.delete(`/api/contatos/${c.id}`);
  }
  await api.delete(`/api/conexoes/${id}`);
  return s;
}
