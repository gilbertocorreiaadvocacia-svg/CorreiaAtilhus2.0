import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

/**
 * Transcricao de audio na propria maquina, sem chave e sem mensalidade.
 *
 * O cliente que manda audio esta descrevendo a doenca dele, o acidente de
 * trabalho, a situacao da familia. Pelo caminho da OpenAI esse audio sai do
 * escritorio e vai para o servidor de outra empresa. Aqui ele nao sai: o
 * ffmpeg ja instalado traz o whisper.cpp embutido como filtro de audio, entao
 * decodificar o Opus do WhatsApp e transcrever acontecem no mesmo comando,
 * dentro desta maquina.
 *
 * Nao existe transcricao "sem IA": reconhecer fala E um modelo. O que muda e
 * que este modelo roda aqui, de graca, e nada e enviado para fora.
 */

const AQUI = path.dirname(fileURLToPath(import.meta.url));
const RAIZ = path.resolve(AQUI, '..', '..');

/** Onde os modelos ficam. Pasta fora do git: sao 600 MB de binario. */
const PASTA_MODELOS = process.env.CORREIA_MODELOS_DIR || path.join(RAIZ, 'modelos');

/*
 * Qual modelo usar.
 *
 * `small` acerta mais, `base` e tres vezes mais rapido. Medido aqui com 30 s
 * de audio: base 10 s, small 18 s. Num notebook com varios nucleos vale o
 * small; na VPS de 1 vCPU o small nao termina a tempo de responder no
 * WhatsApp, entao la a variavel aponta para o base.
 *
 * A escolha automatica pega o melhor que existir na pasta, porque a maquina
 * que tem os dois e justamente a que aguenta o melhor.
 */
const PREFERENCIA = ['ggml-small.bin', 'ggml-base.bin', 'ggml-tiny.bin'];

/*
 * Tamanho da janela que o filtro entrega ao modelo, em segundos.
 *
 * Este numero e o achado que fez a transcricao prestar. No padrao do filtro
 * (3 s) o audio e picado de tres em tres segundos, e o modelo nunca ve um
 * numero de beneficio inteiro: "623456 78" saia como "623.4" / "5, 6, 7" /
 * "8", em tres pedacos. Com a janela em 30 s o mesmo audio devolveu
 * "623-456-78" certo — e ficou DUAS VEZES mais rapido, porque o modelo carrega
 * uma vez so em vez de a cada pedaco.
 *
 * Trinta segundos tambem e a janela nativa do whisper: acima disso ele fatia
 * internamente de qualquer jeito.
 */
const JANELA_SEGUNDOS = 30;

/*
 * O que o modelo erra de verdade, medido e nao suposto.
 *
 * Numero foi o pior caso antes da janela maior, e continua sendo o mais caro:
 * numero de beneficio, CPF e data decidem prazo e valor. Vocabulario do ramo
 * vem logo atras — "INSS" virou "Iui NSS Negô" no base e "auxilio doenca"
 * virou "auxilio do INCA" nos dois modelos.
 *
 * Por isso o trecho e MARCADO, nunca corrigido no escuro: trocar palavra que o
 * cliente falou por outra que combina mais com o escritorio e por palavra na
 * boca dele, e num processo isso e grave.
 */
const RISCO_NUMERO = /\d/;
const TERMOS_DO_RAMO = ['inss', 'auxilio', 'auxílio', 'doenca', 'doença', 'benefício', 'beneficio', 'pericia', 'perícia', 'loas', 'bpc', 'cpf', 'cnis'];

/*
 * A unica correcao automatica permitida: erro de grafia que nao existe como
 * palavra, so pode ser o termo certo escrito errado. "INCSS" nao e nada em
 * portugues; "INCA" e um instituto de verdade, entao fica de fora e so recebe
 * marca.
 */
const GRAFIA_SEGURA = [
  [/\bINCSS\b/gi, 'INSS'],
  [/\bI[nm]SS\b/g, 'INSS'],
];

/* Sondagem e barata e nao toca em arquivo: saida curta, limite de 10 s. */
const OPCOES_SONDAGEM = { encoding: 'utf8', timeout: 10000, stdio: ['ignore', 'pipe', 'ignore'] };

let ffmpegLembrado = null;

/** Acha o ffmpeg uma vez e guarda. Sem ele nao ha transcricao local. */
export function acharFfmpeg() {
  if (ffmpegLembrado !== null) return ffmpegLembrado;
  const candidatos = [process.env.CORREIA_FFMPEG, 'ffmpeg'].filter(Boolean);
  for (const candidato of candidatos) {
    try {
      /* -version e barato e nao toca em arquivo nenhum. */
      const saida = execFileSync(candidato, ['-hide_banner', '-version'], OPCOES_SONDAGEM);
      if (saida) {
        ffmpegLembrado = candidato;
        return candidato;
      }
    } catch {
      /* tenta o proximo */
    }
  }
  ffmpegLembrado = '';
  return '';
}

/** O caminho do modelo escolhido, ou '' quando nenhum foi baixado ainda. */
let cliLembrado = null;

/**
 * O whisper-cli, o segundo caminho.
 *
 * Nem todo ffmpeg traz o filtro whisper: ele exige compilar com --enable-whisper,
 * e o pacote do Alpine (que e a base da imagem da hospedagem) vem sem. La o
 * caminho e outro — ffmpeg comum decodifica o Opus para WAV, e o whisper-cli
 * transcreve o WAV. Dois passos em vez de um, mesmo resultado.
 *
 * Por isso o modulo aceita os dois. O notebook usa o filtro, que e mais
 * rapido; a hospedagem usa o cli, que compila em qualquer lugar.
 */
export function acharWhisperCli() {
  if (cliLembrado !== null) return cliLembrado;
  const candidatos = [process.env.CORREIA_WHISPER_CLI, 'whisper-cli', 'whisper'].filter(Boolean);
  for (const candidato of candidatos) {
    try {
      /* --help sai com codigo 0 e nao toca em arquivo nenhum. */
      execFileSync(candidato, ['--help'], OPCOES_SONDAGEM);
      cliLembrado = candidato;
      return candidato;
    } catch (erro) {
      /* O whisper-cli sai com codigo != 0 no --help em algumas versoes, mas
         so existe de verdade se o erro NAO for "nao encontrei o programa". */
      if (erro && erro.code !== 'ENOENT' && erro.status !== undefined) {
        cliLembrado = candidato;
        return candidato;
      }
    }
  }
  cliLembrado = '';
  return '';
}

export function acharModelo() {
  const escolhido = process.env.CORREIA_MODELO_VOZ;
  if (escolhido) {
    const direto = path.isAbsolute(escolhido) ? escolhido : path.join(PASTA_MODELOS, escolhido);
    return fs.existsSync(direto) ? direto : '';
  }
  for (const nome of PREFERENCIA) {
    const tentativa = path.join(PASTA_MODELOS, nome);
    if (fs.existsSync(tentativa)) return tentativa;
  }
  return '';
}

/**
 * Da para transcrever aqui mesmo?
 *
 * Duas coisas precisam existir: o ffmpeg COM o filtro whisper (nem toda build
 * traz) e um modelo baixado. Responder so "tem ffmpeg" faria a tela prometer
 * uma transcricao que morre na primeira tentativa.
 */
export function transcricaoLocalDisponivel() {
  if (!ligado()) return false;
  /* ffmpeg e modelo sao obrigatorios nos dois caminhos: um para decodificar o
     Opus, o outro para reconhecer a fala. O que varia e quem transcreve. */
  if (!acharFfmpeg() || !acharModelo()) return false;
  return filtroWhisperExiste() || Boolean(acharWhisperCli());
}

/*
 * Interruptor do motor local, lido a cada chamada.
 *
 * Existe por dois motivos reais. Uma VPS de 1 vCPU pode nao dar conta de
 * transcrever e responder no WhatsApp dentro de um tempo aceitavel — nesse
 * caso o escritorio prefere a nuvem, e desliga aqui sem apagar o modelo.
 *
 * E a suite de testes precisa de resultado igual em qualquer maquina: sem
 * isso, o mesmo teste passava no notebook (que tem modelo) e falhava no
 * servidor de build (que nao tem), o que e defeito do teste, nao do sistema.
 */
/** CORREIA_TRANSCRICAO_VIA=cli manda usar o whisper-cli mesmo havendo filtro. */
function forcadoParaCli() {
  return String(process.env.CORREIA_TRANSCRICAO_VIA || "").toLowerCase() === "cli";
}

function ligado() {
  const valor = process.env.CORREIA_TRANSCRICAO_LOCAL;
  return valor === undefined || !['0', 'false', 'nao', 'off'].includes(String(valor).toLowerCase());
}

let filtroLembrado = null;

function filtroWhisperExiste() {
  if (filtroLembrado !== null) return filtroLembrado;
  const ffmpeg = acharFfmpeg();
  if (!ffmpeg) {
    filtroLembrado = false;
    return false;
  }
  try {
    const saida = execFileSync(ffmpeg, ['-hide_banner', '-filters'], OPCOES_SONDAGEM);
    filtroLembrado = /\bwhisper\b/.test(saida);
  } catch {
    filtroLembrado = false;
  }
  return filtroLembrado;
}

/** Descricao do motor para a tela de Integracoes e para o diagnostico. */
export function motorLocal() {
  const modelo = acharModelo();
  const temFiltro = filtroWhisperExiste();
  const cli = acharWhisperCli();
  return {
    disponivel: transcricaoLocalDisponivel(),
    /* Qual dos dois caminhos esta valendo DE VERDADE. O filtro ganha quando
       existe (faz tudo num comando so), mas CORREIA_TRANSCRICAO_VIA=cli passa
       na frente — e o relatorio tem de contar isso, senao a tela diz "filtro"
       enquanto a maquina roda o cli. */
    via: forcadoParaCli() ? (cli ? 'cli' : null) : temFiltro ? 'filtro' : cli ? 'cli' : null,
    ffmpeg: Boolean(acharFfmpeg()),
    filtro: temFiltro,
    cli: Boolean(cli),
    modelo: modelo ? path.basename(modelo) : null,
    pastaModelos: PASTA_MODELOS,
  };
}

/**
 * Junta os trechos que o filtro devolve.
 *
 * Ele entrega um objeto JSON por linha, e as janelas SE SOBREPOEM: um trecho
 * pode comecar antes do fim do anterior. Concatenar na bruta repete palavra.
 * Como a sobreposicao vem sempre em ordem de tempo, basta descartar o trecho
 * que nao avanca o relogio.
 */
function juntarTrechos(linhas) {
  const trechos = [];
  let fimAnterior = -1;
  for (const linha of linhas) {
    const texto = String(linha.text || '').trim();
    if (!texto) continue;
    const inicio = Number(linha.start) || 0;
    const fim = Number(linha.end) || inicio;
    /* Trecho inteiramente dentro do anterior e repeticao da janela. */
    if (fim <= fimAnterior) continue;
    trechos.push({ inicio, fim, texto });
    fimAnterior = Math.max(fimAnterior, fim);
  }
  return trechos;
}

/** Aplica so as correcoes de grafia que nao podem estar erradas. */
function arrumarGrafia(texto) {
  let saida = texto;
  for (const [de, para] of GRAFIA_SEGURA) saida = saida.replace(de, para);
  return saida;
}

/**
 * Marca o que precisa de conferencia humana.
 *
 * O filtro do ffmpeg NAO devolve confianca por palavra — entao nao invento
 * uma. O que eu tenho e a medicao: numero e termo do ramo sao onde ele erra.
 * O trecho vai marcado com o motivo, e o atendente ouve o audio para conferir.
 */
function marcarDuvidas(trechos) {
  const duvidas = [];
  for (const trecho of trechos) {
    const motivos = [];
    if (RISCO_NUMERO.test(trecho.texto)) motivos.push('numero');
    const minusculo = trecho.texto.toLowerCase();
    if (TERMOS_DO_RAMO.some((termo) => minusculo.includes(termo))) motivos.push('termo juridico');
    if (motivos.length) {
      duvidas.push({
        inicio: Math.round(trecho.inicio / 1000),
        texto: trecho.texto,
        motivos,
      });
    }
  }
  return duvidas;
}

/**
 * O caminho de duas etapas, para quem nao tem o filtro no ffmpeg.
 *
 * E o caso da hospedagem: a imagem e Alpine, e o pacote de ffmpeg de la vem
 * sem --enable-whisper. Entao o ffmpeg faz so o que todo ffmpeg faz (decodificar
 * o Opus do WhatsApp para WAV 16 kHz mono, que e o que o whisper espera) e o
 * whisper-cli faz o reconhecimento.
 *
 * O resultado sai no MESMO formato do outro caminho, de proposito: quem chama
 * nao precisa saber por onde foi, e a marcacao de duvida vale igual nos dois.
 */
function porLinhaDeComando({ ffmpeg, modelo, entradaOriginal, pasta }) {
  const cli = acharWhisperCli();
  const wav = path.join(pasta, 'audio.wav');

  /* 16 kHz mono PCM: o formato que o whisper.cpp exige. Mandar outra coisa faz
     ele aceitar e transcrever lixo, em vez de reclamar. */
  execFileSync(
    ffmpeg,
    ['-hide_banner', '-loglevel', 'error', '-y', '-i', entradaOriginal, '-ar', '16000', '-ac', '1', '-c:a', 'pcm_s16le', wav],
    { timeout: 2 * 60 * 1000, stdio: ['ignore', 'ignore', 'pipe'] },
  );

  /* -oj grava <arquivo>.json ao lado do wav. -nt tira o carimbo de tempo do
     texto, que aqui viria duplicado (ja temos os offsets no JSON). */
  const argumentos = ['-m', modelo, '-f', wav, '-l', 'pt', '-oj', '-nt', '--no-prints'];

  /*
   * Na hospedagem o whisper-cli e um binario comum e isto nao se aplica. Mas no
   * Windows ele pode estar embrulhado num .cmd, e desde a correcao de seguranca
   * do Node 24 execFile recusa .cmd/.bat direto (EINVAL). Chamar pelo cmd.exe
   * resolve sem usar shell:true — os argumentos continuam indo em lista, e nao
   * concatenados numa linha que alguem poderia emendar.
   */
  const ehLote = /\.(cmd|bat)$/i.test(cli);
  if (ehLote) {
    execFileSync('cmd.exe', ['/c', cli, ...argumentos], { timeout: 15 * 60 * 1000, stdio: ['ignore', 'ignore', 'pipe'] });
  } else {
    execFileSync(cli, argumentos, { timeout: 15 * 60 * 1000, stdio: ['ignore', 'ignore', 'pipe'] });
  }

  const arquivoJson = `${wav}.json`;
  if (!fs.existsSync(arquivoJson)) {
    return { texto: null, erro: 'O whisper-cli nao gerou a transcricao.', duvidas: [] };
  }

  const bruto = JSON.parse(fs.readFileSync(arquivoJson, 'utf8'));
  /* O cli entrega {transcription:[{offsets:{from,to}, text}]}, e nao uma linha
     por objeto como o filtro. Normalizamos para a mesma forma antes de juntar. */
  const linhas = (bruto.transcription || []).map((t) => ({
    start: Number(t.offsets?.from) || 0,
    end: Number(t.offsets?.to) || 0,
    text: t.text || '',
  }));

  const trechos = juntarTrechos(linhas).map((t) => ({ ...t, texto: arrumarGrafia(t.texto) }));
  const texto = trechos.map((t) => t.texto).join(' ').replace(/\s+/g, ' ').trim();

  if (!texto) return { texto: null, erro: 'Nao consegui entender fala nenhuma neste audio.', duvidas: [] };

  return {
    texto,
    erro: null,
    duvidas: marcarDuvidas(trechos),
    motor: { local: true, modelo: path.basename(modelo), via: 'cli' },
  };
}

/**
 * Transcreve um arquivo de audio aqui mesmo.
 *
 * Devolve `{ texto, erro, duvidas, motor }`. `duvidas` e sempre uma lista, e
 * lista vazia quer dizer "nada chamou atencao", nunca "esta tudo certo": sem
 * confianca por palavra, a unica garantia honesta e a de que ninguem
 * conferiu ainda.
 */
export function transcreverLocal(caminhoDoAudio, { janela = JANELA_SEGUNDOS } = {}) {
  const ffmpeg = acharFfmpeg();
  const modelo = acharModelo();
  if (!ffmpeg) return { texto: null, erro: 'O ffmpeg nao foi encontrado nesta maquina.', duvidas: [] };
  if (!filtroWhisperExiste() && !acharWhisperCli()) {
    return {
      texto: null,
      erro: 'Nao ha como transcrever: o ffmpeg nao traz o filtro whisper e o whisper-cli nao esta instalado.',
      duvidas: [],
    };
  }
  if (!modelo) {
    return { texto: null, erro: `Nenhum modelo de voz em ${PASTA_MODELOS}. Baixe ggml-base.bin ou ggml-small.bin.`, duvidas: [] };
  }
  if (!caminhoDoAudio || !fs.existsSync(caminhoDoAudio)) {
    return { texto: null, erro: 'O audio nao pode ser lido do disco.', duvidas: [] };
  }

  /*
   * Tudo roda numa pasta temporaria propria, com nome curto, e o ffmpeg e
   * chamado com o cwd apontando para la.
   *
   * Nao e capricho: o parser de filtro do ffmpeg usa ':' para separar opcao, e
   * um caminho do Windows comeca com 'C:'. Passar o caminho inteiro quebra o
   * filtro ("No option name near..."). Com nomes curtos e relativos o problema
   * nao existe, em Windows e em Linux.
   */
  const pasta = fs.mkdtempSync(path.join(os.tmpdir(), 'correia-voz-'));
  const entrada = path.join(pasta, 'entrada' + (path.extname(caminhoDoAudio) || '.ogg'));
  const saida = path.join(pasta, 'saida.json');

  /*
   * Sem o filtro, vai pelo whisper-cli: e o caminho da hospedagem.
   *
   * CORREIA_TRANSCRICAO_VIA=cli forca esse caminho mesmo onde o filtro existe.
   * Serve para duas coisas reais: testar aqui o que vai rodar la (esta maquina
   * tem o filtro, a hospedagem nao tem) e ter para onde correr se um dia o
   * filtro de uma build nova passar a se comportar diferente.
   */
  if (forcadoParaCli() || !filtroWhisperExiste()) {
    /*
     * Conferir o cli AQUI, e nao so la em cima.
     *
     * A guarda do inicio aceita a maquina que tem o filtro, e esta tem. Mas com
     * a via forcada para cli sem cli instalado, a chamada seguia assim mesmo e
     * o execFileSync estourava com ERR_INVALID_ARG_VALUE — excecao no meio do
     * recebimento de uma mensagem, em vez de um motivo devolvido.
     *
     * E justamente o estado em que a hospedagem fica se o build nao gerar o
     * binario: o pior momento para o sistema quebrar em vez de avisar.
     */
    if (!acharWhisperCli()) {
      try {
        return {
          texto: null,
          erro: 'O whisper-cli nao esta instalado nesta maquina (e o ffmpeg nao traz o filtro whisper).',
          duvidas: [],
        };
      } finally {
        try {
          fs.rmSync(pasta, { recursive: true, force: true });
        } catch {
          /* pasta temporaria, o sistema limpa depois */
        }
      }
    }
    try {
      return porLinhaDeComando({ ffmpeg, modelo, entradaOriginal: caminhoDoAudio, pasta });
    } finally {
      try {
        fs.rmSync(pasta, { recursive: true, force: true });
      } catch {
        /* pasta temporaria, o sistema limpa depois */
      }
    }
  }

  try {
    fs.copyFileSync(caminhoDoAudio, entrada);

    const filtro = [
      `whisper=model=${path.basename(modelo)}`,
      'language=pt',
      'format=json',
      'use_gpu=false',
      `queue=${janela}`,
      `destination=${path.basename(saida)}`,
    ].join(':');

    /* O modelo tambem entra por nome curto: copiar 500 MB a cada audio seria
       absurdo, entao a pasta do modelo vira o cwd e o audio e que viaja. */
    const pastaDoModelo = path.dirname(modelo);
    fs.copyFileSync(entrada, path.join(pastaDoModelo, path.basename(entrada)));

    execFileSync(
      ffmpeg,
      ['-hide_banner', '-loglevel', 'error', '-y', '-i', path.basename(entrada), '-af', filtro, '-f', 'null', '-'],
      { cwd: pastaDoModelo, timeout: 10 * 60 * 1000, stdio: ['ignore', 'ignore', 'pipe'] },
    );

    const bruto = fs.readFileSync(path.join(pastaDoModelo, path.basename(saida)), 'utf8');
    const linhas = bruto
      .split('\n')
      .map((l) => l.trim())
      .filter(Boolean)
      .map((l) => {
        try {
          return JSON.parse(l);
        } catch {
          return null;
        }
      })
      .filter(Boolean);

    const trechos = juntarTrechos(linhas).map((t) => ({ ...t, texto: arrumarGrafia(t.texto) }));
    const texto = trechos.map((t) => t.texto).join(' ').replace(/\s+/g, ' ').trim();

    /* Limpa o que foi parar na pasta do modelo. */
    for (const sobra of [path.basename(entrada), path.basename(saida)]) {
      try {
        fs.rmSync(path.join(pastaDoModelo, sobra), { force: true });
      } catch {
        /* sobra inofensiva */
      }
    }

    if (!texto) return { texto: null, erro: 'Nao consegui entender fala nenhuma neste audio.', duvidas: [] };

    return {
      texto,
      erro: null,
      duvidas: marcarDuvidas(trechos),
      motor: { local: true, modelo: path.basename(modelo) },
    };
  } catch (erro) {
    const detalhe = erro?.stderr ? String(erro.stderr).trim().split('\n').pop() : erro.message;
    return { texto: null, erro: `A transcricao local falhou: ${detalhe}`, duvidas: [] };
  } finally {
    try {
      fs.rmSync(pasta, { recursive: true, force: true });
    } catch {
      /* pasta temporaria, o sistema limpa depois */
    }
  }
}
