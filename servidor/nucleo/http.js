import fs from 'node:fs';
import path from 'node:path';
import { LIMITE_CORPO, PASTA_WEB } from '../config.js';

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
   * Revalidacao em vez de prazo de validade.
   *
   * Com max-age o navegador servia o arquivo do cache sem perguntar nada ate o
   * prazo vencer. Depois de uma atualizacao do sistema, quem ja estava com a
   * tela aberta seguia rodando a versao antiga sem sinal nenhum de que havia
   * versao nova, e misturar JavaScript novo com CSS velho quebra de um jeito
   * dificil de diagnosticar.
   *
   * Com no-cache o navegador SEMPRE pergunta, mas a resposta e um 304 vazio
   * quando nada mudou: na rede do escritorio isso custa alguns milissegundos e
   * garante que todo mundo roda a mesma versao.
   */
  const etiqueta = '"' + info.size.toString(16) + '-' + info.mtimeMs.toString(16) + '"';
  if (req.headers['if-none-match'] === etiqueta) {
    res.writeHead(304, { ETag: etiqueta, 'Cache-Control': 'no-cache' });
    res.end();
    return true;
  }

  res.writeHead(200, {
    'Content-Type': TIPOS[extensao] || 'application/octet-stream',
    'Content-Length': info.size,
    'Cache-Control': extensao === '.html' ? 'no-store' : 'no-cache',
    ETag: etiqueta,
  });
  fs.createReadStream(destino).pipe(res);
  return true;
}
