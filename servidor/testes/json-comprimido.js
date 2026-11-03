import http from 'node:http';
import zlib from 'node:zlib';

import { suite } from './apoio.js';

/**
 * O JSON da API sai comprimido (nucleo/http.js, responderJson), 03/11/2026.
 * "Demora para iniciar": a tela, ao abrir, pede a lista de conversas (uns 500 KB)
 * e os agentes com todos os roteiros, e a API mandava tudo em texto puro, enquanto
 * os arquivos .js e .css ja iam em gzip.
 *
 * O que nao pode falhar:
 *  - com Accept-Encoding gzip, o JSON grande sai em gzip, com Content-Length do
 *    tamanho comprimido, Vary, e descomprime para exatamente o mesmo JSON;
 *  - sem gzip no pedido (ou so com outro formato), sai puro, como sempre saiu;
 *  - resposta pequena nao e comprimida: o cabecalho extra custaria mais;
 *  - a compressao realmente encolhe (a lista de saude vai a menos de 40%);
 *  - resposta de erro continua JSON legivel.
 * A rota usada e a de saude, que e publica; o caminho de compressao e o mesmo de
 * toda resposta JSON, e o resto da suite (que usa fetch, e fetch pede gzip)
 * passa por ele o tempo todo.
 */
function pedir(base, caminho, cabecalhos = {}) {
  return new Promise((resolve, reject) => {
    const url = new URL(caminho, base);
    const req = http.request({ hostname: url.hostname, port: url.port, path: url.pathname + url.search, method: 'GET', headers: cabecalhos }, (res) => {
      const pedacos = [];
      res.on('data', (p) => pedacos.push(p));
      res.on('end', () => resolve({ status: res.statusCode, cabecalhos: res.headers, corpo: Buffer.concat(pedacos) }));
    });
    req.on('error', reject);
    req.end();
  });
}

export async function testarJsonComprimido({ base }) {
  const s = suite('O JSON da API sai comprimido quando o navegador aceita');

  const puro = await pedir(base, '/api/saude');
  const comGzip = await pedir(base, '/api/saude', { 'Accept-Encoding': 'gzip, deflate, br' });
  const soBrotli = await pedir(base, '/api/saude', { 'Accept-Encoding': 'br' });
  const pequeno = await pedir(base, '/api/vivo', { 'Accept-Encoding': 'gzip' });
  const naoAchou = await pedir(base, '/api/rota-que-nao-existe', { 'Accept-Encoding': 'gzip' });

  if (!s.ok('a rota publica de saude responde e e maior que 1 KB (senao este teste nao prova nada)', puro.status === 200 && puro.corpo.length > 1024, `${puro.status} ${puro.corpo.length} bytes`)) return s;

  s.ok('sem Accept-Encoding: JSON puro, como sempre saiu', !puro.cabecalhos['content-encoding'] && JSON.parse(puro.corpo.toString('utf8')).ok === true);

  s.ok(
    'com gzip no pedido: sai em gzip, com Vary',
    comGzip.status === 200 && comGzip.cabecalhos['content-encoding'] === 'gzip' && /accept-encoding/i.test(comGzip.cabecalhos.vary || ''),
    JSON.stringify({ status: comGzip.status, enc: comGzip.cabecalhos['content-encoding'], vary: comGzip.cabecalhos.vary }),
  );
  s.ok('o Content-Length e o do corpo comprimido', Number(comGzip.cabecalhos['content-length']) === comGzip.corpo.length, `${comGzip.cabecalhos['content-length']} x ${comGzip.corpo.length}`);

  let descomprimido = null;
  try {
    descomprimido = JSON.parse(zlib.gunzipSync(comGzip.corpo).toString('utf8'));
  } catch {
    descomprimido = null;
  }
  s.ok('descomprime para um JSON valido, com o mesmo conteudo da resposta pura', descomprimido?.ok === true && descomprimido?.codigo === JSON.parse(puro.corpo.toString('utf8')).codigo);

  s.ok('encolhe de verdade: o comprimido tem menos de 40% do puro', comGzip.corpo.length < puro.corpo.length * 0.4, `${comGzip.corpo.length} de ${puro.corpo.length} bytes`);
  s.ok('o Cache-Control continua no-store', comGzip.cabecalhos['cache-control'] === 'no-store' && puro.cabecalhos['cache-control'] === 'no-store');

  s.ok('so brotli no pedido: sai puro (so se comprime em gzip)', !soBrotli.cabecalhos['content-encoding'], String(soBrotli.cabecalhos['content-encoding']));
  s.ok('resposta pequena nao e comprimida', pequeno.status === 200 && !pequeno.cabecalhos['content-encoding'] && pequeno.corpo.length < 1024, `${pequeno.corpo.length} bytes, ${pequeno.cabecalhos['content-encoding']}`);
  s.ok('resposta de erro continua JSON legivel', naoAchou.status === 404 && JSON.parse(naoAchou.corpo.toString('utf8')).erro !== undefined, `${naoAchou.status}`);

  return s;
}
