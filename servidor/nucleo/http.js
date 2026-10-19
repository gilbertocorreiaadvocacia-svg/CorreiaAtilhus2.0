import fs from 'node:fs';
import path from 'node:path';
import zlib from 'node:zlib';
import { HOSPEDADO, LIMITE_CORPO, PASTA_WEB } from '../config.js';

const TIPOS = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.gif': 'image/gif',
  '.webp': 'image/webp',
  '.ico': 'image/x-icon',
  '.woff2': 'font/woff2',
  '.mp4': 'video/mp4',
  '.webm': 'video/webm',
  '.mp3': 'audio/mpeg',
  '.ogg': 'audio/ogg',
  '.pdf': 'application/pdf',
  '.txt': 'text/plain; charset=utf-8',
};

export function responderJson(res, dados, codigo = 200) {
  const corpo = JSON.stringify(dados ?? null);
  res.writeHead(codigo, {
    'Content-Type': 'application/json; charset=utf-8',
    'Cache-Control': 'no-store',
    'Content-Length': Buffer.byteLength(corpo),
  });
  res.end(corpo);
}

export function responderErro(res, codigo, mensagem, extra = {}) {
  responderJson(res, { erro: mensagem, codigo, ...extra }, codigo);
}

export function responderTexto(res, texto, codigo = 200, tipo = 'text/plain; charset=utf-8') {
  res.writeHead(codigo, { 'Content-Type': tipo, 'Cache-Control': 'no-store' });
  res.end(texto);
}

export function lerCorpo(req) {
  return new Promise((resolve, reject) => {
    const pedacos = [];
    let tamanho = 0;
    req.on('data', (pedaco) => {
      tamanho += pedaco.length;
      if (tamanho > LIMITE_CORPO) {
        reject(Object.assign(new Error('Corpo grande demais'), { codigo: 413 }));
        req.destroy();
        return;
      }
      pedacos.push(pedaco);
    });
    req.on('end', () => resolve(Buffer.concat(pedacos)));
    req.on('error', reject);
  });
}

export async function lerJsonDoCorpo(req) {
  const bruto = await lerCorpo(req);
  if (!bruto.length) return {};
  try {
    return JSON.parse(bruto.toString('utf8'));
  } catch {
    throw Object.assign(new Error('JSON invalido no corpo da requisicao'), { codigo: 400 });
  }
}

export function lerCookies(req) {
  const cabecalho = req.headers.cookie;
  if (!cabecalho) return {};
  const saida = {};
  for (const parte of cabecalho.split(';')) {
    const igual = parte.indexOf('=');
    if (igual < 0) continue;
    saida[parte.slice(0, igual).trim()] = decodeURIComponent(parte.slice(igual + 1).trim());
  }
  return saida;
}

export function definirCookie(res, nome, valor, opcoes = {}) {
  const partes = [`${nome}=${encodeURIComponent(valor)}`, 'Path=/', 'HttpOnly', 'SameSite=Lax'];
  /* Hospedado, so por HTTPS: o Caddy faz o certificado (ver config.js). */
  if (HOSPEDADO) partes.push('Secure');
  if (opcoes.maxIdade) partes.push(`Max-Age=${opcoes.maxIdade}`);
  if (opcoes.expirar) partes.push('Max-Age=0');
  const atuais = res.getHeader('Set-Cookie');
  const lista = Array.isArray(atuais) ? atuais : atuais ? [atuais] : [];
  lista.push(partes.join('; '));
  res.setHeader('Set-Cookie', lista);
}

/**
 * Roteador minimo: registra caminhos com :parametro e devolve o que casar.
 * Sem framework, o sistema roda so com o Node instalado.
 */
export function criarRoteador() {
  const rotas = [];

  function registrar(metodo, padrao, manipulador) {
    const partes = padrao.split('/').filter(Boolean);
    rotas.push({ metodo, partes, manipulador, padrao });
  }

  const api = {
    get: (p, h) => registrar('GET', p, h),
    post: (p, h) => registrar('POST', p, h),
    put: (p, h) => registrar('PUT', p, h),
    patch: (p, h) => registrar('PATCH', p, h),
    delete: (p, h) => registrar('DELETE', p, h),
    resolver(metodo, caminho) {
      const partes = caminho.split('/').filter(Boolean);
      for (const rota of rotas) {
        if (rota.metodo !== metodo) continue;
        if (rota.partes.length !== partes.length) continue;
        const parametros = {};
        let casou = true;
        for (let i = 0; i < rota.partes.length; i += 1) {
          const esperado = rota.partes[i];
          if (esperado.startsWith(':')) {
            parametros[esperado.slice(1)] = decodeURIComponent(partes[i]);
          } else if (esperado !== partes[i]) {
            casou = false;
            break;
          }
        }
        if (casou) return { manipulador: rota.manipulador, parametros };
      }
      return null;
    },
  };

  return api;
}

/*
 * Compressao gzip dos estaticos de texto.
 *
 * O tema.css passa de 260 KB e o JavaScript soma algumas centenas: crus, isso
 * pesa o carregamento sobre a internet. Gzip corta ~80%. O buffer comprimido
 * fica guardado por caminho + mtime, entao a compressao acontece uma vez por
 * versao do arquivo, e nao a cada requisicao. zlib e nativo do Node, sem
 * dependencia nova.
 */
const COMPRIMIVEL = new Set(['.html', '.css', '.js', '.json', '.svg', '.map', '.txt', '.webmanifest']);

/*
 * Cache longo + versao automatica nos .js/.html, em vez de pedir confirmacao
 * ao servidor em toda abertura da tela (achado em 19/10/2026: isso se
 * repetia em TODA abertura, nao so depois de deploy, e pesava mais do que
 * qualquer requisicao de API medida).
 *
 * VERSAO_ESTATICOS muda uma vez por subida do processo — nao precisa de
 * ferramenta de build, so um numero que muda a cada deploy (o processo e
 * recriado a cada deploy de qualquer jeito). O HTML continua 'no-store'
 * (sempre revalidado, decide qual versao carregar); os demais arquivos
 * (.js, .css, fontes, etc.) ganham `Cache-Control: immutable` de verdade —
 * o navegador para de perguntar.
 *
 * Isso so e seguro porque a versao e EMBUTIDA na propria URL de cada
 * referencia: o HTML aponta para "js/app.js?v=<versao>", e cada modulo .js
 * que importa outro (`from './estado.js'`, `import('./paginas/x.js')`)
 * tambem ganha a query acrescentada no texto, na hora de servir — senao so
 * o arquivo de entrada seria versionado, e os ~22 modulos importados por
 * dentro da cadeia ficariam reifens do cache antigo (JS novo importando
 * modulo velho e exatamente o problema que o 'no-cache' anterior evitava).
 * `reescreverReferencias` e essa reescrita; roda uma vez por arquivo e fica
 * em `conteudoCache`, no mesmo padrao que a compressao gzip ja usava.
 */
const VERSAO_ESTATICOS = String(Date.now());
const PRECISA_VERSAO = new Set(['.html', '.js']);
const REFERENCIA_HTML = /(src|href)="([^":]+\.(?:js|css))"/g;
const IMPORT_DE = /from(\s*)(['"])([^'"]+\.js)\2/g;
const IMPORT_DINAMICO = /import\((\s*)(['"])([^'"]+\.js)\2(\s*)\)/g;

function reescreverReferencias(texto, extensao) {
  if (extensao === '.html') {
    return texto.replace(REFERENCIA_HTML, (bate, atributo, caminho) => `${atributo}="${caminho}?v=${VERSAO_ESTATICOS}"`);
  }
  return texto
    .replace(IMPORT_DE, (bate, espaco, aspas, caminho) => `from${espaco}${aspas}${caminho}?v=${VERSAO_ESTATICOS}${aspas}`)
    .replace(IMPORT_DINAMICO, (bate, antes, aspas, caminho, depois) => `import(${antes}${aspas}${caminho}?v=${VERSAO_ESTATICOS}${aspas}${depois})`);
}

const conteudoCache = new Map();

/** O conteudo de verdade a enviar: o arquivo como esta, ou (para .html/.js) com as referencias versionadas. */
function conteudoDe(destino, extensao, mtimeMs) {
  const guardado = conteudoCache.get(destino);
  if (guardado && guardado.mtime === mtimeMs) return guardado.buf;
  const bruto = fs.readFileSync(destino);
  const buf = PRECISA_VERSAO.has(extensao) ? Buffer.from(reescreverReferencias(bruto.toString('utf8'), extensao), 'utf8') : bruto;
  conteudoCache.set(destino, { mtime: mtimeMs, buf });
  return buf;
}

const gzipCache = new Map();

function gzipDe(destino, extensao, mtimeMs) {
  const guardado = gzipCache.get(destino);
  if (guardado && guardado.mtime === mtimeMs) return guardado.buf;
  const buf = zlib.gzipSync(conteudoDe(destino, extensao, mtimeMs), { level: 6 });
  gzipCache.set(destino, { mtime: mtimeMs, buf });
  return buf;
}

/** Serve os arquivos da pasta web, barrando qualquer tentativa de subir de pasta. */
export function servirEstatico(req, res, caminhoUrl) {
  let relativo = decodeURIComponent(caminhoUrl.split('?')[0]);
  if (relativo === '/' || relativo === '') relativo = '/index.html';
  const destino = path.join(PASTA_WEB, path.normalize(relativo).replace(/^([/\\])+/, ''));
  if (!destino.startsWith(PASTA_WEB)) {
    responderErro(res, 403, 'Caminho fora da pasta publica');
    return true;
  }
  let info;
  try {
    info = fs.statSync(destino);
  } catch {
    return false;
  }
  if (info.isDirectory()) return false;

  const extensao = path.extname(destino).toLowerCase();

  /*
   * O HTML decide qual versao carregar, entao continua 'no-store': sempre
   * buscado de novo, nunca guardado. Os demais arquivos tem a versao
   * embutida na propria URL (ver VERSAO_ESTATICOS acima) — o conteudo por
   * tras de uma URL com `?v=X` nunca muda, entao o navegador pode guardar
   * 'para sempre' (`immutable`) sem risco de rodar versao velha: uma versao
   * nova do arquivo so aparece com uma URL nova, nunca pisando na antiga.
   */
  const etiqueta = '"' + info.size.toString(16) + '-' + info.mtimeMs.toString(16) + '"';
  const cacheControl = extensao === '.html' ? 'no-store' : 'public, max-age=31536000, immutable';
  if (req.headers['if-none-match'] === etiqueta) {
    res.writeHead(304, { ETag: etiqueta, 'Cache-Control': cacheControl });
    res.end();
    return true;
  }

  /* Texto vai comprimido quando o navegador aceita; o resto (imagem, fonte,
     woff2) ja e comprimido e segue direto. */
  const aceitaGzip = /\bgzip\b/.test(req.headers['accept-encoding'] || '');
  if (aceitaGzip && COMPRIMIVEL.has(extensao)) {
    const buf = gzipDe(destino, extensao, info.mtimeMs);
    res.writeHead(200, {
      'Content-Type': TIPOS[extensao] || 'application/octet-stream',
      'Content-Length': buf.length,
      'Content-Encoding': 'gzip',
      Vary: 'Accept-Encoding',
      'Cache-Control': cacheControl,
      ETag: etiqueta,
    });
    res.end(buf);
    return true;
  }

  const buf = conteudoDe(destino, extensao, info.mtimeMs);
  res.writeHead(200, {
    'Content-Type': TIPOS[extensao] || 'application/octet-stream',
    'Content-Length': buf.length,
    'Cache-Control': cacheControl,
    ETag: etiqueta,
  });
  res.end(buf);
  return true;
}
