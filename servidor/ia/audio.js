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

/* Endereco da OpenAI. So a suite de testes troca: ela fala com uma de mentira. */
const BASE_OPENAI = process.env.CORREIA_OPENAI_URL || 'https://api.openai.com';

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

/**
 * Transcreve um audio que o cliente mandou.
 *
 * Devolve `{ texto, erro }`, nunca so uma string: um audio sem transcricao e
 * mudo demais quando a equipe nao sabe por que — "sem chave", "a API
 * recusou" e "sem fala nenhuma" pedem reacoes diferentes de quem atende.
 * Padrao visto no Atilhus Juri (irmao deste sistema): a mensagem SEMPRE e
 * gravada, com o motivo exato da falta de texto, em vez de silencio.
 */
export async function transcrever({ workspaceId, contatoId, midia }) {
  const chave = chaveOpenai(workspaceId);
  if (!chave) return { texto: null, erro: 'Transcrição não configurada — falta a chave da OpenAI em Integrações.' };

  const caminho = caminhoDaMidia(midia?.url);
  if (!caminho) return { texto: null, erro: 'O áudio não pôde ser lido do disco.' };

  try {
    const dados = fs.readFileSync(caminho);
    const formulario = new FormData();
    formulario.append('file', new Blob([dados], { type: midia.mime || 'audio/ogg' }), midia.arquivo || 'audio.ogg');
    formulario.append('model', 'whisper-1');
    formulario.append('language', 'pt');

    const resposta = await fetch(`${BASE_OPENAI}/v1/audio/transcriptions`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${chave}` },
      body: formulario,
    });
    const corpo = await resposta.json().catch(() => ({}));
    if (!resposta.ok) return { texto: null, erro: `O serviço de transcrição recusou (${resposta.status}).` };

    const segundos = Math.max(1, Math.round(dados.length / 16000));
    lancar(workspaceId, contatoId, 'transcricao_audio', (CUSTO.transcricaoAudioPorMinuto * segundos) / 60);

    const texto = corpo.text?.trim() || null;
    return texto ? { texto, erro: null } : { texto: null, erro: 'O serviço de transcrição não devolveu texto.' };
  } catch (erro) {
    return { texto: null, erro: `Transcrição falhou: ${erro.message}` };
  }
}

/** Gera o audio da resposta com a voz configurada no agente. */
export async function sintetizar({ workspaceId, contatoId, texto, vozId }) {
  const chave = chaveOpenai(workspaceId);
  if (!chave || !texto?.trim()) return null;

  const voz = achar('vozes', vozId);
  const nomeVoz = voz?.vozBase || (VOZES.some((v) => v.id === vozId) ? vozId : 'nova');

  try {
    const resposta = await fetch(`${BASE_OPENAI}/v1/audio/speech`, {
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
