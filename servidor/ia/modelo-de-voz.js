import fs from 'node:fs';
import path from 'node:path';
import { Readable } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import { HOSPEDADO } from '../config.js';
import { PASTA_MODELOS, faltaSoOModelo } from './transcricao-local.js';

/**
 * O modelo de voz da hospedagem, baixado pelo proprio sistema.
 *
 * Pedido do escritorio em 26/10/2026: "ele nao transcreve audio ainda". A
 * imagem ja traz o ffmpeg e o whisper-cli (ver o Dockerfile); faltava o
 * modelo, que mora no volume, e nao na imagem, e nunca tinha sido posto la.
 * Na subida, se so ele falta, o sistema baixa o `base` — 141 MB, o que uma VPS
 * de 1 vCPU aguenta (ver TRANSCRICAO.md) — do repositorio oficial do
 * whisper.cpp, uma vez. Antes de por no lugar, confere que veio inteiro e que
 * e um modelo mesmo (comeca com "lmgg"): um arquivo pela metade faria o
 * whisper-cli falhar em todo audio, sem ninguem saber por que.
 *
 * CORREIA_BAIXAR_MODELO_VOZ=0 desliga; CORREIA_MODELO_VOZ_URL troca a origem.
 */
const URL_DO_MODELO = process.env.CORREIA_MODELO_VOZ_URL || 'https://huggingface.co/ggerganov/whisper.cpp/resolve/main/ggml-base.bin';
const MAGICA = 'lmgg';

/* O que aconteceu com o download, para conferir de fora (/api/saude). */
const situacao = { estado: 'nao precisou', erro: null, em: null };
export const situacaoDoModeloDeVoz = () => ({ ...situacao });

/** Baixa e confere. Devolve { ok, caminho } ou { ok: false, erro }; nunca deixa arquivo pela metade. */
export async function baixarModeloDeVoz({ url = URL_DO_MODELO, pasta = PASTA_MODELOS, nome = 'ggml-base.bin' } = {}) {
  fs.mkdirSync(pasta, { recursive: true });
  const destino = path.join(pasta, nome);
  const parcial = `${destino}.baixando`;
  try {
    const resposta = await fetch(url, { redirect: 'follow' });
    if (!resposta.ok || !resposta.body) throw new Error(`o endereco do modelo respondeu ${resposta.status}`);
    await pipeline(Readable.fromWeb(resposta.body), fs.createWriteStream(parcial));

    /* Comprimido no caminho, o tamanho anunciado e o do pacote, nao o do arquivo. */
    const esperado = resposta.headers.get('content-encoding') ? null : Number(resposta.headers.get('content-length')) || null;
    const tamanho = fs.statSync(parcial).size;
    if (esperado && tamanho !== esperado) throw new Error(`o modelo veio pela metade (${tamanho} de ${esperado} bytes)`);

    const inicio = Buffer.alloc(MAGICA.length);
    const arquivo = fs.openSync(parcial, 'r');
    fs.readSync(arquivo, inicio, 0, inicio.length, 0);
    fs.closeSync(arquivo);
    if (inicio.toString('latin1') !== MAGICA) throw new Error('o arquivo baixado nao e um modelo de voz');

    fs.renameSync(parcial, destino);
    return { ok: true, caminho: destino, tamanho };
  } catch (erro) {
    fs.rmSync(parcial, { force: true });
    return { ok: false, erro: erro.message };
  }
}

/** Na hospedagem, baixa o modelo quando ele e a unica coisa que falta. Roda na subida, sem segurar nada. */
export async function garantirModeloDeVoz() {
  const desligado = ['0', 'false', 'nao', 'off'].includes(String(process.env.CORREIA_BAIXAR_MODELO_VOZ || '').toLowerCase());
  if (!HOSPEDADO || desligado || !faltaSoOModelo()) return null;

  Object.assign(situacao, { estado: 'baixando', erro: null, em: new Date().toISOString() });
  console.log('Transcricao: baixando o modelo de voz (ggml-base, 141 MB)...');
  const resultado = await baixarModeloDeVoz();
  Object.assign(situacao, { estado: resultado.ok ? 'pronto' : 'erro', erro: resultado.ok ? null : resultado.erro, em: new Date().toISOString() });
  console.log(
    resultado.ok ? 'Transcricao: modelo de voz pronto; o audio do cliente passa a ser transcrito aqui.' : `Transcricao: o modelo de voz nao baixou (${resultado.erro}).`,
  );
  return resultado;
}
