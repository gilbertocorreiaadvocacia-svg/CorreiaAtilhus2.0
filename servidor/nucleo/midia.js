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
  'audio/x-wav': '.wav',
  'audio/wave': '.wav',
  'audio/webm': '.webm',
  'audio/mp4': '.m4a',
  'audio/x-m4a': '.m4a',
  'audio/aac': '.aac',
  'audio/amr': '.amr',
  'audio/3gpp': '.3gp',
  'audio/flac': '.flac',
  'application/pdf': '.pdf',
};

export function tipoPeloMime(mime = '') {
  if (mime.startsWith('image/')) return 'imagem';
  if (mime.startsWith('video/')) return 'video';
  if (mime.startsWith('audio/')) return 'audio';
  return 'documento';
}

/** "audio/webm;codecs=opus" -> "audio/webm": o tipo sozinho, sem os parametros. */
export function tipoSemParametros(mime = '') {
  return String(mime).split(';')[0].trim().toLowerCase();
}

/*
 * A extensao sai do tipo SEM os parametros. O WhatsApp entrega o audio como
 * "audio/ogg; codecs=opus" (com espaco): com a busca pelo texto inteiro nao
 * achava nada, e o arquivo era guardado sem extensao.
 */
export function nomeSeguro(nome = 'arquivo', mime = '') {
  const limpo = String(nome).replace(/[^\w.-]+/g, '_').slice(-60);
  const temExtensao = /\.[a-z0-9]{2,5}$/i.test(limpo);
  return `${novoId('mid')}-${limpo}${temExtensao ? '' : EXTENSOES[tipoSemParametros(mime)] || ''}`;
}

/**
 * Recebe o que veio da tela (data URI ou base64 puro) e grava em disco.
 *
 * O navegador monta o data URI com o tipo do arquivo por inteiro, parametros e
 * tudo: o gravador de voz entrega "audio/webm;codecs=opus", e o cabecalho vira
 * "data:audio/webm;codecs=opus;base64,". Ate 03/11/2026 so se reconhecia
 * "data:tipo;base64,": o resto caia no ramo do base64 puro, o decodificador
 * parava no primeiro "=" ("codecs=opus") e o sistema guardava ~15 bytes de lixo
 * no lugar da gravacao, sem avisar ninguem — a equipe nao conseguia mandar
 * audio. Agora o cabecalho e lido pela virgula, e um data URI que nao seja
 * base64 e recusado em vez de gravado quebrado.
 */
export function guardarBase64({ nome, conteudoBase64, mime }) {
  const bruto = String(conteudoBase64 || '');
  let tipoDoCabecalho = '';
  let carga = bruto;
  if (/^data:/i.test(bruto)) {
    const virgula = bruto.indexOf(',');
    const partes = virgula > 0 ? bruto.slice(5, virgula).split(';') : [];
    if (partes.pop()?.trim().toLowerCase() !== 'base64') {
      throw Object.assign(new Error('O arquivo veio num formato que o sistema nao entende.'), { codigo: 400 });
    }
    tipoDoCabecalho = tipoSemParametros(partes[0]);
    carga = bruto.slice(virgula + 1);
  }
  const mimeFinal = tipoDoCabecalho || tipoSemParametros(mime) || 'application/octet-stream';
  const dados = Buffer.from(carga, 'base64');

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

/* ------------------------------------------------------------------ */
/* Entrega do arquivo ao navegador                                     */
/* ------------------------------------------------------------------ */

const TIPOS_POR_EXTENSAO = {
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.png': 'image/png',
  '.webp': 'image/webp',
  '.gif': 'image/gif',
  '.mp4': 'video/mp4',
  '.webm': 'video/webm',
  '.mov': 'video/quicktime',
  '.mp3': 'audio/mpeg',
  '.ogg': 'audio/ogg',
  '.oga': 'audio/ogg',
  '.opus': 'audio/ogg',
  '.m4a': 'audio/mp4',
  '.aac': 'audio/aac',
  '.amr': 'audio/amr',
  '.3gp': 'audio/3gpp',
  '.flac': 'audio/flac',
  '.wav': 'audio/wav',
  '.pdf': 'application/pdf',
};

/**
 * O tipo de um arquivo pelos primeiros bytes. Serve para o que foi guardado sem
 * extensao (anexos que vieram do WhatsApp com o tipo escrito de outro jeito) ou
 * com uma extensao que a tabela acima nao conhece.
 */
export function tipoPelosBytes(inicio) {
  const b = Buffer.from(inicio || []);
  const texto = (de, ate) => b.subarray(de, ate).toString('latin1');
  if (b.length < 4) return null;
  if (texto(0, 4) === 'OggS') return 'audio/ogg';
  if (texto(0, 4) === 'fLaC') return 'audio/flac';
  if (texto(0, 5) === '#!AMR') return 'audio/amr';
  if (texto(0, 4) === 'RIFF' && texto(8, 12) === 'WAVE') return 'audio/wav';
  if (b[0] === 0x1a && b[1] === 0x45 && b[2] === 0xdf && b[3] === 0xa3) return 'video/webm';
  if (texto(4, 8) === 'ftyp') return /^(M4A |M4B |f4a )/.test(texto(8, 12)) ? 'audio/mp4' : 'video/mp4';
  if (texto(0, 3) === 'ID3') return 'audio/mpeg';
  if (b[0] === 0xff && (b[1] & 0xe0) === 0xe0) return (b[1] & 0x06) === 0 ? 'audio/aac' : 'audio/mpeg';
  if (texto(0, 5) === '%PDF-') return 'application/pdf';
  if (b[0] === 0x89 && texto(1, 4) === 'PNG') return 'image/png';
  if (b[0] === 0xff && b[1] === 0xd8) return 'image/jpeg';
  return null;
}

export function tipoDoArquivo(arquivo) {
  const porNome = TIPOS_POR_EXTENSAO[path.extname(arquivo).toLowerCase()];
  if (porNome) return porNome;
  try {
    const fd = fs.openSync(arquivo, 'r');
    try {
      const inicio = Buffer.alloc(16);
      const lidos = fs.readSync(fd, inicio, 0, 16, 0);
      return tipoPelosBytes(inicio.subarray(0, lidos)) || 'application/octet-stream';
    } finally {
      fs.closeSync(fd);
    }
  } catch {
    return 'application/octet-stream';
  }
}

/**
 * O trecho que o navegador pediu (cabecalho Range), contra o tamanho do arquivo.
 * Devolve null (sem Range, ou um formato que nao tratamos: entrega inteiro),
 * 'invalida' (comeca depois do fim: 416) ou { inicio, fim } (206).
 */
export function faixaPedida(cabecalho, tamanho) {
  const casou = /^bytes=(\d*)-(\d*)$/.exec(String(cabecalho || '').trim());
  if (!casou) return null;
  const [, de, ate] = casou;
  if (de === '' && ate === '') return null;
  let inicio;
  let fim;
  if (de === '') {
    const ultimos = Number(ate);
    if (!ultimos) return 'invalida';
    inicio = Math.max(0, tamanho - ultimos);
    fim = tamanho - 1;
  } else {
    inicio = Number(de);
    fim = ate === '' ? tamanho - 1 : Math.min(Number(ate), tamanho - 1);
  }
  return inicio >= tamanho || inicio > fim ? 'invalida' : { inicio, fim };
}

/**
 * Entrega um arquivo de /midia/.
 *
 * Aceita Range: o iPhone (Safari) so toca audio e video de um servidor que
 * responde por trechos, e em qualquer navegador e isso que deixa pular para o
 * meio de um audio longo. Antes a resposta era sempre o arquivo inteiro, com
 * 200, e o tocador do iPhone dava erro.
 */
export function servirMidia(req, res, arquivo) {
  const { size } = fs.statSync(arquivo);
  const cabecalhos = {
    'Content-Type': tipoDoArquivo(arquivo),
    'Accept-Ranges': 'bytes',
    'Cache-Control': 'private, max-age=86400',
  };
  const faixa = faixaPedida(req.headers.range, size);

  if (faixa === 'invalida') {
    res.writeHead(416, { ...cabecalhos, 'Content-Range': `bytes */${size}`, 'Content-Length': 0 });
    res.end();
    return;
  }

  const fluxo = faixa ? fs.createReadStream(arquivo, { start: faixa.inicio, end: faixa.fim }) : fs.createReadStream(arquivo);
  if (faixa) {
    res.writeHead(206, {
      ...cabecalhos,
      'Content-Range': `bytes ${faixa.inicio}-${faixa.fim}/${size}`,
      'Content-Length': faixa.fim - faixa.inicio + 1,
    });
  } else {
    res.writeHead(200, { ...cabecalhos, 'Content-Length': size });
  }
  fluxo.on('error', () => res.destroy());
  fluxo.pipe(res);
}
