import path from 'node:path';
import { pathToFileURL } from 'node:url';

import { cliente, suite } from './apoio.js';

/**
 * O audio guardado precisa tocar no navegador de quem atende (04/11/2026).
 *
 * "Tem audios dando erro na hora de escutar." Tres causas possiveis, as tres
 * tratadas aqui:
 *  - o servidor entregava o arquivo SEMPRE inteiro, sem aceitar Range: o iPhone
 *    (Safari) so toca de um servidor que responde por trechos, e em qualquer
 *    navegador e isso que deixa avancar dentro do audio;
 *  - arquivo guardado sem extensao (o WhatsApp escreve o tipo como "audio/ogg;
 *    codecs=opus", com espaco) saia como "application/octet-stream";
 *  - gravacao antiga, de antes da correcao do upload, que ficou com ~15 bytes de
 *    lixo: nao toca nunca, e a tela precisa dizer isso em vez de mostrar um
 *    tocador que da erro.
 */
export async function testarAudioQueToca({ base, raiz }) {
  const s = suite('Audio que toca');
  const api = cliente(base);
  await api.entrar();

  const preenchimento = Buffer.alloc(2000, 7);
  const arquivo = (inicio) => Buffer.concat([Buffer.from(inicio, 'latin1'), preenchimento]);
  const subir = async (nome, mime, bytes) =>
    (await api.post('/api/midia', { nome, mime, conteudoBase64: `data:${mime || 'application/octet-stream'};base64,${bytes.toString('base64')}` })).dados;
  const ler = (url, cabecalhos = {}) => fetch(`${base}${url}`, { headers: cabecalhos });

  /* --- 1. O tipo certo, mesmo sem extensao ----------------------------- */
  const casos = [
    ['ogg do WhatsApp', 'whatsapp-1', 'application/octet-stream', arquivo('OggS\0'), 'audio/ogg'],
    ['mp3 com etiqueta ID3', 'whatsapp-2', 'application/octet-stream', arquivo('ID3\x03\0'), 'audio/mpeg'],
    ['mp3 sem etiqueta', 'whatsapp-3', 'application/octet-stream', Buffer.concat([Buffer.from([0xff, 0xfb, 0x90, 0x00]), preenchimento]), 'audio/mpeg'],
    ['wav', 'whatsapp-4', 'application/octet-stream', Buffer.concat([Buffer.from('RIFF'), Buffer.from([0, 0, 0, 0]), Buffer.from('WAVEfmt '), preenchimento]), 'audio/wav'],
    ['m4a do iPhone', 'whatsapp-5', 'application/octet-stream', Buffer.concat([Buffer.from([0, 0, 0, 0x20]), Buffer.from('ftypM4A '), preenchimento]), 'audio/mp4'],
    ['amr', 'whatsapp-6', 'application/octet-stream', arquivo('#!AMR\n'), 'audio/amr'],
    ['gravacao webm do navegador', 'whatsapp-7', 'application/octet-stream', Buffer.concat([Buffer.from([0x1a, 0x45, 0xdf, 0xa3]), preenchimento]), 'video/webm'],
    ['bytes que ninguem conhece', 'whatsapp-8', 'application/octet-stream', arquivo('\u0001\u0002\u0003\u0004'), 'application/octet-stream'],
  ];
  for (const [rotulo, nome, mime, bytes, esperado] of casos) {
    const midia = await subir(nome, mime, bytes);
    const resposta = await ler(midia?.url || '/midia/nao-subiu');
    const tipo = (resposta.headers.get('content-type') || '').split(';')[0];
    s.ok(`${rotulo}, sem extensao, sai como ${esperado}`, resposta.status === 200 && tipo === esperado, `${resposta.status} ${tipo} (${midia?.arquivo})`);
    await resposta.arrayBuffer();
  }

  /* --- 2. A extensao sai do tipo, com ou sem os parametros -------------- */
  const doWhatsapp = await subir('whatsapp-9', 'audio/ogg; codecs=opus', arquivo('OggS\0'));
  s.ok('"audio/ogg; codecs=opus" (com espaco) guarda o arquivo como .ogg', /\.ogg$/.test(doWhatsapp?.arquivo || ''), String(doWhatsapp?.arquivo));
  const gravado = await subir('gravacao', 'audio/webm;codecs=opus', Buffer.concat([Buffer.from([0x1a, 0x45, 0xdf, 0xa3]), preenchimento]));
  s.ok('a gravacao do navegador sem extensao no nome vira .webm', /\.webm$/.test(gravado?.arquivo || ''), String(gravado?.arquivo));
  const doIphone = await subir('audio-do-iphone', 'audio/mp4', Buffer.concat([Buffer.from([0, 0, 0, 0x20]), Buffer.from('ftypM4A '), preenchimento]));
  s.ok('audio/mp4 vira .m4a e sai como audio/mp4', /\.m4a$/.test(doIphone?.arquivo || ''), String(doIphone?.arquivo));
  const m4a = await ler(doIphone.url);
  s.ok('e o tipo devolvido e o de audio, nao o de video', (m4a.headers.get('content-type') || '') === 'audio/mp4', String(m4a.headers.get('content-type')));
  await m4a.arrayBuffer();

  /* O anexo que chega do WhatsApp nao passa pelo upload da tela: o nome do arquivo
     sai direto do tipo que o servico informou, com espaco e parametros. */
  const { nomeSeguro } = await import(pathToFileURL(path.join(raiz, 'servidor/nucleo/midia.js')).href);
  s.ok('anexo do WhatsApp: "audio/ogg; codecs=opus" ganha .ogg', /\.ogg$/.test(nomeSeguro('whatsapp-1730', 'audio/ogg; codecs=opus')), nomeSeguro('whatsapp-1730', 'audio/ogg; codecs=opus'));
  s.ok('anexo do WhatsApp: tipo em maiusculas e sem espaco tambem', /\.ogg$/.test(nomeSeguro('whatsapp-1731', 'Audio/OGG;codecs=opus')), nomeSeguro('whatsapp-1731', 'Audio/OGG;codecs=opus'));
  s.ok('nome que ja tem extensao nao ganha outra', /-voz\.mp3$/.test(nomeSeguro('voz.mp3', 'audio/ogg')), nomeSeguro('voz.mp3', 'audio/ogg'));

  /* --- 3. Pedido por trecho (Range) ------------------------------------- */
  const alvo = await subir('trechos.ogg', 'audio/ogg', Buffer.from(Array.from({ length: 1000 }, (_, i) => i % 251)));
  const todos = Buffer.from(await (await ler(alvo.url)).arrayBuffer());
  const inteiro = await ler(alvo.url);
  s.ok('sem Range: 200, o arquivo inteiro, avisando que aceita trechos', inteiro.status === 200 && inteiro.headers.get('accept-ranges') === 'bytes' && Number(inteiro.headers.get('content-length')) === 1000, `${inteiro.status} ${inteiro.headers.get('accept-ranges')} ${inteiro.headers.get('content-length')}`);
  await inteiro.arrayBuffer();

  const meio = await ler(alvo.url, { Range: 'bytes=10-19' });
  const corpoMeio = Buffer.from(await meio.arrayBuffer());
  s.ok('bytes=10-19: 206, com Content-Range e so esses 10 bytes', meio.status === 206 && meio.headers.get('content-range') === 'bytes 10-19/1000' && corpoMeio.equals(todos.subarray(10, 20)), `${meio.status} ${meio.headers.get('content-range')} ${corpoMeio.length}`);

  const aberto = await ler(alvo.url, { Range: 'bytes=0-' });
  const corpoAberto = Buffer.from(await aberto.arrayBuffer());
  s.ok('bytes=0- (o primeiro pedido do tocador): 206 com tudo', aberto.status === 206 && aberto.headers.get('content-range') === 'bytes 0-999/1000' && corpoAberto.equals(todos), `${aberto.status} ${aberto.headers.get('content-range')}`);

  const fim = await ler(alvo.url, { Range: 'bytes=-5' });
  const corpoFim = Buffer.from(await fim.arrayBuffer());
  s.ok('bytes=-5: os 5 ultimos', fim.status === 206 && fim.headers.get('content-range') === 'bytes 995-999/1000' && corpoFim.equals(todos.subarray(995)), `${fim.status} ${fim.headers.get('content-range')}`);

  const passou = await ler(alvo.url, { Range: 'bytes=500-5000' });
  const corpoPassou = Buffer.from(await passou.arrayBuffer());
  s.ok('fim alem do arquivo: corta no fim do arquivo', passou.status === 206 && passou.headers.get('content-range') === 'bytes 500-999/1000' && corpoPassou.length === 500, `${passou.status} ${passou.headers.get('content-range')}`);

  const alemDoFim = await ler(alvo.url, { Range: 'bytes=5000-' });
  s.ok('comeco alem do arquivo: 416, dizendo o tamanho', alemDoFim.status === 416 && alemDoFim.headers.get('content-range') === 'bytes */1000', `${alemDoFim.status} ${alemDoFim.headers.get('content-range')}`);
  await alemDoFim.arrayBuffer();

  const estranho = await ler(alvo.url, { Range: 'bytes=0-5,10-15' });
  s.ok('varios trechos de uma vez (que nao tratamos): entrega inteiro, sem erro', estranho.status === 200 && Number(estranho.headers.get('content-length')) === 1000, String(estranho.status));
  await estranho.arrayBuffer();

  const sumido = await ler('/midia/arquivo-que-nunca-existiu.ogg', { Range: 'bytes=0-' });
  s.ok('arquivo que nao existe continua 404', sumido.status === 404, String(sumido.status));
  await sumido.arrayBuffer();

  /* --- 4. A tela reconhece a gravacao que ja nasceu quebrada ------------- */
  const { audioCorrompido } = await import(pathToFileURL(path.join(raiz, 'web/js/defeito-do-audio.js')).href);
  s.ok('15 bytes: audio com defeito', audioCorrompido({ tipo: 'audio', tamanho: 15 }) === true);
  s.ok('audio de verdade (2 KB) nao e acusado', audioCorrompido({ tipo: 'audio', tamanho: 2048 }) === false);
  s.ok('sem tamanho anotado, nao acusa (mensagens antigas, anexos do cliente)', audioCorrompido({ tipo: 'audio' }) === false && audioCorrompido(null) === false);
  s.ok('tamanho zero ou invalido nao e tratado como defeito', audioCorrompido({ tamanho: 0 }) === false && audioCorrompido({ tamanho: 'abc' }) === false);

  return s;
}
