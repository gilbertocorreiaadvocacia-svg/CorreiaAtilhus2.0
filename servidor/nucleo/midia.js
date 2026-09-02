import fs from 'node:fs';
import path from 'node:path';
import { LIMITE_MIDIA, PASTA_MIDIA } from '../config.js';
import { garantirPasta, novoId } from './util.js';

/**
 * Guarda os arquivos que entram e saem: video de proposta, PDF de contrato,
 * audio gravado pelo cliente, audio gerado pela IA. Tudo fica em dados/midia/
 * e e servido pelo proprio sistema, nada de depender de link de fora que
 * expira sem avisar.
 */

const EXTENSOES = {
  'image/jpeg': '.jpg',
  'image/png': '.png',
  'image/webp': '.webp',
  'image/gif': '.gif',
  'video/mp4': '.mp4',
  'video/webm': '.webm',
  'audio/mpeg': '.mp3',
  'audio/mp3': '.mp3',
  'audio/ogg': '.ogg',
  'audio/opus': '.ogg',
  'audio/wav': '.wav',
  'application/pdf': '.pdf',
};

export function tipoPeloMime(mime = '') {
  if (mime.startsWith('image/')) return 'imagem';
  if (mime.startsWith('video/')) return 'video';
  if (mime.startsWith('audio/')) return 'audio';
  return 'documento';
}

function nomeSeguro(nome = 'arquivo', mime = '') {
  const limpo = String(nome).replace(/[^\w.-]+/g, '_').slice(-60);
  const temExtensao = /\.[a-z0-9]{2,5}$/i.test(limpo);
  return `${novoId('mid')}-${limpo}${temExtensao ? '' : EXTENSOES[mime] || ''}`;
}

/** Recebe o que veio da tela (data URI ou base64 puro) e grava em disco. */
export function guardarBase64({ nome, conteudoBase64, mime }) {
  const bruto = String(conteudoBase64 || '');
  const casou = /^data:([^;]+);base64,(.*)$/s.exec(bruto);
  const mimeFinal = casou ? casou[1] : mime || 'application/octet-stream';
  const dados = Buffer.from(casou ? casou[2] : bruto, 'base64');

  if (!dados.length) throw Object.assign(new Error('Arquivo vazio.'), { codigo: 400 });
  if (dados.length > LIMITE_MIDIA) {
    throw Object.assign(
      new Error(`Arquivo de ${(dados.length / 1024 / 1024).toFixed(1)} MB. O WhatsApp aceita ate 16 MB.`),
      { codigo: 413 },
    );
  }

  garantirPasta(PASTA_MIDIA);
  const arquivo = nomeSeguro(nome, mimeFinal);
  fs.writeFileSync(path.join(PASTA_MIDIA, arquivo), dados);

  return {
    nome: nome || arquivo,
    arquivo,
    url: `/midia/${arquivo}`,
    tipo: tipoPeloMime(mimeFinal),
    mime: mimeFinal,
    tamanho: dados.length,
  };
}

export function guardarBuffer({ nome, dados, mime }) {
  garantirPasta(PASTA_MIDIA);
  const arquivo = nomeSeguro(nome, mime);
  fs.writeFileSync(path.join(PASTA_MIDIA, arquivo), dados);
  return {
    nome: nome || arquivo,
    arquivo,
    url: `/midia/${arquivo}`,
    tipo: tipoPeloMime(mime),
    mime,
    tamanho: dados.length,
  };
}

export function caminhoDaMidia(url = '') {
  const arquivo = path.basename(String(url));
  const destino = path.join(PASTA_MIDIA, arquivo);
  return destino.startsWith(PASTA_MIDIA) && fs.existsSync(destino) ? destino : null;
}

export function apagarMidia(url) {
  const caminho = caminhoDaMidia(url);
  if (!caminho) return false;
  try {
    fs.unlinkSync(caminho);
    return true;
  } catch {
    return false;
  }
}
