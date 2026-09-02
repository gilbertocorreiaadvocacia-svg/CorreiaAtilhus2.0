import fs from 'node:fs';
import { CUSTO, VOZES } from '../config.js';
import { achar } from '../nucleo/banco.js';
import { lancar } from '../nucleo/creditos.js';
import { caminhoDaMidia, guardarBuffer } from '../nucleo/midia.js';

/**
 * Audio nas duas direcoes.
 *
 * Entrada: muita gente que procura o escritorio manda audio em vez de digitar -
 * idoso, pessoa com pouca escolaridade, quem esta no trabalho. Sem transcricao,
 * o agente simplesmente nao entende o lead.
 *
 * Saida: responder em audio em momentos decisivos (boas-vindas, quebra de
 * objecao) aproxima muito mais que texto. Nao e para usar sempre: audio custa
 * caro e cansa quando vira padrao.
 */

function chaveOpenai(workspaceId) {
  const integracoes = achar('integracoes', { workspaceId });
  return integracoes?.ia?.chaveOpenai || process.env.OPENAI_API_KEY || '';
}

export function transcricaoDisponivel(workspaceId) {
  return Boolean(chaveOpenai(workspaceId));
}

export function vozDisponivel(workspaceId) {
  return Boolean(chaveOpenai(workspaceId));
}

/** Transcreve um audio que o cliente mandou. */
export async function transcrever({ workspaceId, contatoId, midia }) {
  const chave = chaveOpenai(workspaceId);
  if (!chave) return null;

  const caminho = caminhoDaMidia(midia?.url);
  if (!caminho) return null;

  try {
    const dados = fs.readFileSync(caminho);
    const formulario = new FormData();
    formulario.append('file', new Blob([dados], { type: midia.mime || 'audio/ogg' }), midia.arquivo || 'audio.ogg');
    formulario.append('model', 'whisper-1');
    formulario.append('language', 'pt');

    const resposta = await fetch('https://api.openai.com/v1/audio/transcriptions', {
      method: 'POST',
      headers: { Authorization: `Bearer ${chave}` },
      body: formulario,
    });
    const corpo = await resposta.json().catch(() => ({}));
    if (!resposta.ok) return null;

    const segundos = Math.max(1, Math.round(dados.length / 16000));
    lancar(workspaceId, contatoId, 'transcricao_audio', (CUSTO.transcricaoAudioPorMinuto * segundos) / 60);

    return corpo.text?.trim() || null;
  } catch {
    return null;
  }
}

/** Gera o audio da resposta com a voz configurada no agente. */
export async function sintetizar({ workspaceId, contatoId, texto, vozId }) {
  const chave = chaveOpenai(workspaceId);
  if (!chave || !texto?.trim()) return null;

  const voz = achar('vozes', vozId);
  const nomeVoz = voz?.vozBase || (VOZES.some((v) => v.id === vozId) ? vozId : 'nova');

  try {
    const resposta = await fetch('https://api.openai.com/v1/audio/speech', {
      method: 'POST',
      headers: { Authorization: `Bearer ${chave}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model: 'tts-1',
        voice: nomeVoz,
        input: texto.slice(0, 4000),
        response_format: 'mp3',
        speed: voz?.velocidade || 1,
      }),
    });
    if (!resposta.ok) return null;

    const conteudo = Buffer.from(await resposta.arrayBuffer());
    const midia = guardarBuffer({ nome: 'resposta.mp3', dados: conteudo, mime: 'audio/mpeg' });

    // Estimativa honesta: a locucao em portugues fica perto de 14 caracteres por segundo.
    const segundos = Math.max(1, Math.round(texto.length / 14));
    lancar(workspaceId, contatoId, 'geracao_audio', (CUSTO.audioPorMinuto * segundos) / 60);

    return { ...midia, duracaoEstimada: segundos };
  } catch {
    return null;
  }
}
