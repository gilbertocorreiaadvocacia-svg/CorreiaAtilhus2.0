import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { suite } from './apoio.js';

/**
 * O motor de transcricao que roda na propria maquina.
 *
 * Este teste nao passa pelo servidor: chama o modulo direto. O caminho por
 * HTTP ja e coberto em transcricao-audio.js, e o que importa aqui e outra
 * coisa — se o audio do cliente, no formato que o WhatsApp entrega (Opus),
 * vira texto sem chave nenhuma e sem sair desta maquina.
 *
 * A suite se declara PULADA quando falta ffmpeg com filtro whisper ou o
 * modelo em modelos/. Ela depende de 500 MB de binario que nao vao para o
 * git, entao exigir isso de toda maquina quebraria a suite inteira em quem so
 * quer rodar os testes. Pulado aparece no relatorio e nao vira "ok" falso.
 */
export async function testarTranscricaoLocal() {
  const s = suite('Transcricao local (sem chave, sem nuvem)');

  /* O interruptor da suite desliga o motor para os outros testes; aqui ele
     precisa estar ligado, senao este teste nao testaria nada. */
  const comoEstava = process.env.CORREIA_TRANSCRICAO_LOCAL;
  delete process.env.CORREIA_TRANSCRICAO_LOCAL;

  try {
    const motor = await import('../ia/transcricao-local.js');
    const estado = motor.motorLocal();

    if (!estado.disponivel) {
      const falta = !estado.ffmpeg
        ? 'ffmpeg nao instalado'
        : !estado.filtro
          ? 'ffmpeg sem o filtro whisper'
          : 'nenhum modelo em modelos/';
      s.ok(`PULADO: ${falta} — motor local nao testado nesta maquina`, true);
      return s;
    }

    s.ok('o motor se declara disponivel', estado.disponivel === true, JSON.stringify(estado));
    s.ok('e diz qual modelo esta usando', Boolean(estado.modelo), String(estado.modelo));

    /* Um audio de verdade, gerado na hora pelo proprio ffmpeg, no formato que
       o WhatsApp manda: Opus, mono, 16 kHz. Nao da para usar arquivo gravado
       no repositorio (voz de pessoa nao entra em codigo) nem audio de cliente. */
    const pasta = fs.mkdtempSync(path.join(os.tmpdir(), 'teste-voz-'));
    const ogg = path.join(pasta, 'fala.ogg');

    try {
      /* Tom puro: nao tem fala, e e exatamente esse o caso que precisa ser
         tratado sem quebrar — audio que chega sem voz nenhuma. */
      execFileSync(
        process.env.CORREIA_FFMPEG || 'ffmpeg',
        ['-hide_banner', '-loglevel', 'error', '-y', '-f', 'lavfi', '-i', 'sine=frequency=440:duration=2',
         '-c:a', 'libopus', '-b:a', '24k', '-ar', '16000', '-ac', '1', ogg],
        { timeout: 60000, stdio: ['ignore', 'ignore', 'pipe'] },
      );
      s.ok('o audio de teste foi gerado em Opus, como o do WhatsApp', fs.existsSync(ogg));

      const semFala = motor.transcreverLocal(ogg);
      s.ok(
        'audio sem fala nao quebra e nao inventa texto',
        !semFala.texto || semFala.texto.length < 40,
        JSON.stringify(semFala).slice(0, 200),
      );
      s.ok('a lista de duvidas existe sempre, mesmo vazia', Array.isArray(semFala.duvidas), String(semFala.duvidas));

      /* Arquivo que nao e audio: tem de falhar com motivo, nunca em silencio. */
      const lixo = path.join(pasta, 'naoeaudio.ogg');
      fs.writeFileSync(lixo, 'isto nao e audio nenhum');
      const invalido = motor.transcreverLocal(lixo);
      s.ok('arquivo invalido devolve erro', Boolean(invalido.erro), String(invalido.erro));
      s.ok('e nao devolve texto inventado', !invalido.texto, String(invalido.texto));

      /* Arquivo que nem existe. */
      const sumido = motor.transcreverLocal(path.join(pasta, 'nao-existe.ogg'));
      s.ok('arquivo inexistente devolve erro claro', /nao pode ser lido|nao existe/i.test(sumido.erro || ''), String(sumido.erro));
    } finally {
      fs.rmSync(pasta, { recursive: true, force: true });
    }

    /* O interruptor precisa desligar de verdade: e ele que a suite usa. */
    process.env.CORREIA_TRANSCRICAO_LOCAL = '0';
    s.ok('o interruptor desliga o motor', motor.transcricaoLocalDisponivel() === false);
    delete process.env.CORREIA_TRANSCRICAO_LOCAL;
    s.ok('e religa quando sai', motor.transcricaoLocalDisponivel() === true);

    await testarCaminhoDoCli(s, motor);
    return s;
  } finally {
    if (comoEstava === undefined) delete process.env.CORREIA_TRANSCRICAO_LOCAL;
    else process.env.CORREIA_TRANSCRICAO_LOCAL = comoEstava;
  }
}

/**
 * O caminho de duas etapas (ffmpeg + whisper-cli), que e o da HOSPEDAGEM.
 *
 * Aqui no notebook o ffmpeg tem o filtro whisper e esse caminho nunca roda.
 * Na VPS e o contrario: o Alpine nao traz o filtro, e so existe o cli. Entao
 * o caminho que vai para producao seria justamente o unico sem teste — foi
 * assim que a imagem Docker ficou um ano sem nunca ter sido construida.
 *
 * O whisper-cli de mentira (apoio-whisper-cli.mjs) nao reconhece fala: ele
 * CONFERE o que recebeu. Se os argumentos sairem fora de ordem, se faltar -oj,
 * ou se o WAV nao vier em 16 kHz mono, ele falha — e e exatamente isso que
 * precisa ser pego aqui, porque no binario de verdade esses erros sao calados.
 */
async function testarCaminhoDoCli(s, motor) {
  const daqui = path.dirname(fileURLToPath(import.meta.url));
  const roteiro = path.join(daqui, 'apoio-whisper-cli.mjs');
  const pasta = fs.mkdtempSync(path.join(os.tmpdir(), 'teste-cli-'));

  const guardados = {
    cli: process.env.CORREIA_WHISPER_CLI,
    via: process.env.CORREIA_TRANSCRICAO_VIA,
  };

  try {
    /* O embrulho muda com o sistema: .cmd no Windows, script com +x no resto.
       E proposital testar o embrulho, e nao chamar o node direto — e assim que
       alguem instalaria o whisper-cli nesta maquina. */
    const ehWindows = process.platform === 'win32';
    const embrulho = path.join(pasta, ehWindows ? 'whisper-cli.cmd' : 'whisper-cli');
    fs.writeFileSync(
      embrulho,
      ehWindows
        ? `@echo off\r\nnode "${roteiro}" %*\r\n`
        : `#!/bin/sh\nexec node "${roteiro}" "$@"\n`,
    );
    if (!ehWindows) fs.chmodSync(embrulho, 0o755);

    process.env.CORREIA_WHISPER_CLI = embrulho;
    process.env.CORREIA_TRANSCRICAO_VIA = 'cli';

    /* O modulo guarda em cache qual cli achou; recarregar e mais honesto que
       expor um "esqueca o cache" que so o teste usaria. */
    const novo = await import(`../ia/transcricao-local.js?cli=${Date.now()}`);

    s.ok('com a via forcada, o motor se declara no cli', novo.motorLocal().via === 'cli', JSON.stringify(novo.motorLocal()));

    const ogg = path.join(pasta, 'fala.ogg');
    execFileSync(
      process.env.CORREIA_FFMPEG || 'ffmpeg',
      ['-hide_banner', '-loglevel', 'error', '-y', '-f', 'lavfi', '-i', 'sine=frequency=440:duration=2',
       '-c:a', 'libopus', '-b:a', '24k', '-ar', '16000', '-ac', '1', ogg],
      { timeout: 60000, stdio: ['ignore', 'ignore', 'pipe'] },
    );

    const r = novo.transcreverLocal(ogg);

    s.ok('o cli aceitou os argumentos e devolveu texto', Boolean(r.texto), JSON.stringify(r).slice(0, 220));
    s.ok('e o resultado diz que veio pelo cli', r.motor?.via === 'cli', JSON.stringify(r.motor));
    s.ok(
      'o trecho repetido pelo cli entra uma vez so',
      (r.texto || '').match(/A pericia foi dia 12 de agosto/g)?.length === 1,
      String(r.texto),
    );
    s.ok('a grafia impossivel e corrigida (INCSS vira INSS)', /\bINSS\b/.test(r.texto || '') && !/INCSS/.test(r.texto || ''), String(r.texto));
    s.ok('numero e termo juridico voltam marcados', (r.duvidas || []).length >= 2, JSON.stringify(r.duvidas));

    /*
     * E o estado em que a hospedagem fica se o docker build nao gerar o
     * binario: via no cli, cli nenhum instalado. Precisa DEVOLVER MOTIVO, e
     * nao lancar — isso roda no meio do recebimento de uma mensagem de
     * cliente, e excecao ali derruba a mensagem inteira.
     */
    process.env.CORREIA_WHISPER_CLI = path.join(pasta, 'nao-existe-nenhum');
    const semCli = await import(`../ia/transcricao-local.js?semcli=${Date.now()}`);
    let lancou = null;
    let resposta = null;
    try {
      resposta = semCli.transcreverLocal(ogg);
    } catch (erro) {
      lancou = erro;
    }
    s.ok('sem whisper-cli nenhum, nao lanca excecao', lancou === null, String(lancou && lancou.message));
    s.ok('e devolve o motivo em vez de texto', Boolean(resposta && resposta.erro && !resposta.texto), JSON.stringify(resposta));
  } finally {
    for (const [chave, valor] of [['CORREIA_WHISPER_CLI', guardados.cli], ['CORREIA_TRANSCRICAO_VIA', guardados.via]]) {
      if (valor === undefined) delete process.env[chave];
      else process.env[chave] = valor;
    }
    fs.rmSync(pasta, { recursive: true, force: true });
  }
}
