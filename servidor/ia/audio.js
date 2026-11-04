import fs from 'node:fs';
import { CUSTO, VOZES } from '../config.js';
import { achar, registrarLog } from '../nucleo/banco.js';
import { avisarAdministradores } from '../nucleo/avisar-administradores.js';
import { lancar } from '../nucleo/creditos.js';
import { agora } from '../nucleo/util.js';
import { caminhoDaMidia, guardarBuffer } from '../nucleo/midia.js';
import { transcreverLocal, transcricaoLocalDisponivel, motorLocal } from './transcricao-local.js';

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

/*
 * A nuvem (OpenAI) so transcreve com CORREIA_TRANSCRICAO_NUVEM=1. Pedido do
 * escritorio em 27/10/2026: "quero que transcreva audio sem usar nenhuma IA".
 * Reconhecer fala sempre pede um modelo de voz treinado; o que da para tirar
 * e o servico de IA de fora — e aqui ele sai: o audio do cliente e transcrito
 * pelo programa de voz instalado no servidor do escritorio, sem chave, sem
 * custo e sem sair de la. A suite de testes liga a nuvem para conferir esse
 * caminho com a OpenAI de mentira. A voz das respostas (sintetizar) nao muda.
 */
const nuvemLigada = () => process.env.CORREIA_TRANSCRICAO_NUVEM === '1';
const chaveDeTranscricao = (workspaceId) => (nuvemLigada() ? chaveOpenai(workspaceId) : '');

/** Por que nao ha transcricao nesta maquina, dito do jeito que vale para ela. */
export function motivoSemTranscricao() {
  return nuvemLigada()
    ? 'Transcricao indisponivel — falta o modelo de voz em modelos/ ou a chave da OpenAI em Integracoes.'
    : 'Transcricao indisponivel — o programa de voz do servidor ainda nao esta pronto.';
}

/*
 * Transcricao existe de dois jeitos, e o de casa vem primeiro.
 *
 * O motor local nao custa nada e nao manda o audio do cliente para fora. A
 * OpenAI fica como reserva, para a maquina que nao tiver ffmpeg com whisper
 * nem modelo baixado. Enquanto um dos dois existir, a tela nao pode dizer que
 * o audio e ignorado.
 */
export function transcricaoDisponivel(workspaceId) {
  return transcricaoLocalDisponivel() || Boolean(chaveDeTranscricao(workspaceId));
}

/** Qual motor esta valendo, para a tela de Integracoes e para o diagnostico. */
export function motorDeTranscricao(workspaceId) {
  const local = motorLocal();
  if (local.disponivel) return { tipo: 'local', ...local, custo: 0 };
  if (chaveDeTranscricao(workspaceId)) return { tipo: 'openai', disponivel: true, modelo: 'whisper-1', ffmpeg: local.ffmpeg, filtro: local.filtro };
  return { tipo: 'nenhum', ...local };
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
/*
 * As ultimas tentativas, para conferir de fora (/api/saude): quando, se deu
 * texto, quanto demorou e o motivo da falha — nunca o texto nem o audio.
 * 27/10/2026: "ainda nao esta transcrevendo", e daqui nao dava para saber se
 * o audio nem chegava ao motor, se o motor falhava ou se so demorava.
 */
const ultimas = [];
export const ultimasTranscricoes = () => [...ultimas];

export async function transcrever(argumentos) {
  const inicio = Date.now();
  const resultado = await transcreverAgora(argumentos);
  ultimas.push({
    em: new Date(inicio).toISOString(),
    ok: Boolean(resultado.texto),
    segundos: Math.round((Date.now() - inicio) / 100) / 10,
    motor: resultado.motor || null,
    erro: resultado.texto ? null : String(resultado.erro || '').slice(0, 160),
  });
  if (ultimas.length > 10) ultimas.shift();
  return resultado;
}

async function transcreverAgora({ workspaceId, contatoId, midia, agenteId = null }) {
  const caminho = caminhoDaMidia(midia?.url);
  if (!caminho) return { texto: null, erro: 'O áudio não pôde ser lido do disco.' };

  /*
   * O motor de casa vem primeiro, e nao cobra credito.
   *
   * Nao e so economia: pelo caminho da OpenAI o audio de um cliente contando
   * a doenca dele sai do escritorio. Rodando aqui, nao sai. Quando o local
   * existe e consegue transcrever, nem tentamos a nuvem.
   *
   * A lista de duvidas sobe junto com o texto. O filtro do ffmpeg nao devolve
   * confianca por palavra, entao o que marcamos e onde ele comprovadamente
   * erra: numero (beneficio, CPF, data) e termo do ramo. Quem atende confere
   * ouvindo o audio, que continua anexado na conversa.
   */
  if (transcricaoLocalDisponivel()) {
    const local = await transcreverLocal(caminho);
    if (local.texto) {
      return { texto: local.texto, erro: null, duvidas: local.duvidas || [], motor: 'local' };
    }
    /* O local falhou. Havendo chave, a nuvem ainda pode salvar este audio; sem
       chave, o motivo do local e a resposta mais util que existe. */
    if (!chaveDeTranscricao(workspaceId)) return { texto: null, erro: local.erro, duvidas: [] };
  }

  const chave = chaveDeTranscricao(workspaceId);
  if (!chave) {
    return {
      texto: null,
      erro: motivoSemTranscricao(),
      duvidas: [],
    };
  }

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
    lancar(workspaceId, contatoId, 'transcricao_audio', (CUSTO.transcricaoAudioPorMinuto * segundos) / 60, null, agenteId);

    const texto = corpo.text?.trim() || null;
    /* A OpenAI nao diz de que trecho ela duvidou, entao a lista vem vazia — e
       vazia aqui quer dizer "nao sei", nunca "esta tudo certo". */
    return texto
      ? { texto, erro: null, duvidas: [], motor: 'openai' }
      : { texto: null, erro: 'O servico de transcricao nao devolveu texto.', duvidas: [] };
  } catch (erro) {
    return { texto: null, erro: `Transcrição falhou: ${erro.message}` };
  }
}

/*
 * As ultimas tentativas de falar, para conferir de fora (/api/saude), como as da
 * transcricao: quando, se deu certo e o motivo da falha — nunca o texto falado.
 *
 * 03/11/2026: "a IA ainda nao manda audio". Sem a chave da OpenAI ela nem tenta
 * (vozDisponivel), mas com a chave errada ou sem saldo a tentativa falhava EM
 * SILENCIO: a resposta saia em texto e nada dizia por que. O texto continua
 * saindo (o cliente nunca fica sem resposta), mas agora a falha deixa uma linha
 * na conversa, entra aqui, e a causa de chave ou saldo avisa os administradores.
 */
const sinteses = [];
export const ultimasSinteses = () => [...sinteses];

function anotarSintese(entrada) {
  sinteses.unshift({ em: agora(), ...entrada });
  sinteses.length = Math.min(sinteses.length, 10);
}

/* A OpenAI as vezes repete um pedaco da chave na mensagem de erro: nunca a guardamos. */
const semChave = (texto) => String(texto || '').replace(/sk-[A-Za-z0-9_*.-]{8,}/g, 'sk-…').slice(0, 200);

const avisadoNoDia = new Map();

function falhouAVoz(workspaceId, contatoId, status, motivoBruto) {
  const motivo = semChave(motivoBruto);
  anotarSintese({ ok: false, status, erro: motivo });
  registrarLog(workspaceId, contatoId, 'erro_voz', `Falha da voz: ${motivo}. A resposta saiu em texto.`);

  /* Chave recusada ou sem saldo: so uma pessoa resolve, entao avisa — uma vez por dia. */
  const dePessoa = [401, 402, 403].includes(status) || /insufficient_quota|exceeded your current quota|billing|incorrect api key|invalid api key/i.test(motivo);
  const dia = agora().slice(0, 10);
  const chave = `${workspaceId}:${dia}`;
  for (const antiga of avisadoNoDia.keys()) if (!antiga.endsWith(dia)) avisadoNoDia.delete(antiga);
  if (dePessoa && !avisadoNoDia.has(chave)) {
    avisadoNoDia.set(chave, true);
    avisarAdministradores(workspaceId, {
      titulo: 'A voz da IA parou: a OpenAI recusou o pedido',
      texto: `Motivo: ${motivo}. As respostas continuam saindo, mas em texto. Confira a chave e o saldo da OpenAI (platform.openai.com) e a chave em Integrações › Inteligência artificial › Áudio do cliente. Este aviso vem uma vez por dia.`,
    });
  }
  return null;
}

/**
 * A voz ficou pronta, mas o WhatsApp recusou o audio na hora de entregar.
 * Aparece junto com as outras falhas da voz (/api/saude) e na conversa; o texto
 * da resposta sai em seguida (ia/motor.js). Nao avisa os administradores: a
 * causa nao e de chave nem de saldo, e o cliente nao fica sem resposta.
 */
export function anotarFalhaDoEnvioDoAudio(workspaceId, contatoId, motivoBruto) {
  const motivo = semChave(motivoBruto || 'sem motivo informado');
  anotarSintese({ ok: false, status: 0, erro: `o WhatsApp recusou o audio: ${motivo}` });
  registrarLog(workspaceId, contatoId, 'erro_voz', `O WhatsApp recusou o audio: ${motivo}. A resposta saiu em texto.`);
}

/** Gera o audio da resposta com a voz configurada no agente. */
export async function sintetizar({ workspaceId, contatoId, texto, vozId, agenteId = null }) {
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
    if (!resposta.ok) {
      const dados = await resposta.json().catch(() => ({}));
      return falhouAVoz(workspaceId, contatoId, resposta.status, dados?.error?.message || `HTTP ${resposta.status}`);
    }

    const conteudo = Buffer.from(await resposta.arrayBuffer());
    const midia = guardarBuffer({ nome: 'resposta.mp3', dados: conteudo, mime: 'audio/mpeg' });

    // Estimativa honesta: a locucao em portugues fica perto de 14 caracteres por segundo.
    const segundos = Math.max(1, Math.round(texto.length / 14));
    lancar(workspaceId, contatoId, 'geracao_audio', (CUSTO.audioPorMinuto * segundos) / 60, null, agenteId);

    anotarSintese({ ok: true, segundos });
    return { ...midia, duracaoEstimada: segundos };
  } catch (erro) {
    return falhouAVoz(workspaceId, contatoId, 0, erro.message);
  }
}
