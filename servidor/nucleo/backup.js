import fs from 'node:fs';
import path from 'node:path';
import { PASTA_DADOS } from '../config.js';
import { salvarMensagensPendentes, salvarPendentes } from './banco.js';
import { agora } from './util.js';

/**
 * A copia de seguranca que o sistema faz de si mesmo.
 *
 * Ate aqui nao havia nenhuma. Mil e cento e oitenta e oito conversas de
 * cliente, com telefone, CPF e o que cada um contou, viviam em um disco so, sem
 * copia em lugar nenhum. O espelho para o Supabase existe no codigo mas esta
 * desligado nesta instalacao, entao nao contava.
 *
 * O que uma copia local protege de verdade: operacao de dados que da errado,
 * exclusao sem querer, defeito que reescreve arquivo. Foi exatamente esse o
 * risco da faxina do funil, quando 1.185 conversas mudaram de coluna de uma
 * vez. O que ela NAO protege e a perda do disco inteiro; para isso a copia
 * precisa sair da maquina, e isso depende de configurar o espelho ou levar a
 * pasta para fora.
 *
 * COMO A COPIA E FEITA
 *
 * Os arquivos do banco (JSON) e as mensagens sao COPIADOS: sao reescritos o
 * tempo todo, e e justamente a versao de ontem que se quer guardar.
 *
 * A midia e os anexos sao LIGADOS por hard link. Sao arquivos que nascem e
 * nunca mudam — o audio que o cliente mandou terca continua igual. Um link
 * aponta para os mesmos bytes no disco, entao a copia de 60 MB de midia custa
 * quase zero e mesmo assim a restauracao vem completa, com os anexos no lugar.
 * Copiar de verdade multiplicaria 60 MB por snapshot e a pasta de copias
 * comeria o disco em uma semana.
 *
 * Se o sistema de arquivos nao aceitar link (acontece em montagem de rede), o
 * arquivo e copiado. Vale gastar disco, nao vale perder o anexo.
 */

export const PASTA_BACKUPS = path.join(PASTA_DADOS, 'backups');

/** Copiadas: mudam. */
const COPIAR = ['mensagens'];
/** Ligadas por link: nascem e nao mudam mais. */
const LIGAR = ['midia', 'arquivos'];
/** Nunca entra na copia — seria a copia copiando a si mesma. */
const NUNCA = new Set(['backups']);

function ligarOuCopiar(origem, destino) {
  try {
    fs.linkSync(origem, destino);
  } catch {
    /* Sistema de arquivos sem link, ou origem em outro dispositivo. */
    fs.copyFileSync(origem, destino);
  }
}

function copiarPasta(origem, destino, comLink) {
  if (!fs.existsSync(origem)) return { arquivos: 0, bytes: 0 };
  fs.mkdirSync(destino, { recursive: true });
  let arquivos = 0;
  let bytes = 0;

  for (const item of fs.readdirSync(origem, { withFileTypes: true })) {
    const de = path.join(origem, item.name);
    const para = path.join(destino, item.name);
    if (item.isDirectory()) {
      const dentro = copiarPasta(de, para, comLink);
      arquivos += dentro.arquivos;
      bytes += dentro.bytes;
      continue;
    }
    if (!item.isFile()) continue;
    if (comLink) ligarOuCopiar(de, para);
    else fs.copyFileSync(de, para);
    arquivos += 1;
    /* O link nao ocupa espaco novo; contar os bytes dele inflaria o relato e
       daria a impressao de que a pasta de copias esta maior do que esta. */
    if (!comLink) bytes += fs.statSync(de).size;
  }
  return { arquivos, bytes };
}

/** As copias existentes, da mais nova para a mais velha. */
export function listarBackups() {
  if (!fs.existsSync(PASTA_BACKUPS)) return [];
  return fs
    .readdirSync(PASTA_BACKUPS, { withFileTypes: true })
    .filter((d) => d.isDirectory())
    .map((d) => {
      const completo = path.join(PASTA_BACKUPS, d.name);
      return { nome: d.name, caminho: completo, em: fs.statSync(completo).mtime.toISOString() };
    })
    .sort((a, b) => b.nome.localeCompare(a.nome));
}

/**
 * Faz uma copia agora.
 *
 * `manter` e quantas copias ficam. As mais velhas saem depois que a nova ja
 * esta inteira no disco: apagar antes deixaria a janela em que nao ha copia
 * nenhuma, que e exatamente o momento em que algo da errado.
 */
export function fazerBackup({ motivo = 'diario', manter = 7 } = {}) {
  /* O banco grava em rajada, com espera. Sem forcar, a copia sai sem o que
     acabou de acontecer — e o que acabou de acontecer costuma ser o motivo
     pelo qual alguem esta fazendo copia. */
  salvarPendentes();
  salvarMensagensPendentes();

  const carimbo = new Date().toISOString().slice(0, 16).replace(/[:T]/g, '').replace(/(\d{8})/, '$1_');
  const nome = `${carimbo}_${motivo}`;
  const destino = path.join(PASTA_BACKUPS, nome);
  fs.mkdirSync(destino, { recursive: true });

  const relato = { nome, caminho: destino, arquivos: 0, bytes: 0, ligados: 0, apagados: [], em: agora() };

  for (const item of fs.readdirSync(PASTA_DADOS, { withFileTypes: true })) {
    if (NUNCA.has(item.name)) continue;
    const de = path.join(PASTA_DADOS, item.name);
    const para = path.join(destino, item.name);

    if (item.isFile() && item.name.endsWith('.json')) {
      fs.copyFileSync(de, para);
      relato.arquivos += 1;
      relato.bytes += fs.statSync(de).size;
      continue;
    }
    if (!item.isDirectory()) continue;

    if (COPIAR.includes(item.name)) {
      const dentro = copiarPasta(de, para, false);
      relato.arquivos += dentro.arquivos;
      relato.bytes += dentro.bytes;
    } else if (LIGAR.includes(item.name)) {
      const dentro = copiarPasta(de, para, true);
      relato.ligados += dentro.arquivos;
    }
  }

  for (const velha of listarBackups().slice(manter)) {
    fs.rmSync(velha.caminho, { recursive: true, force: true });
    relato.apagados.push(velha.nome);
  }

  return relato;
}

/**
 * Uma copia ao subir e uma por dia dali em diante.
 *
 * A copia ao subir e a mais util das duas: a hora de mais risco e logo depois
 * de uma atualizacao ou de uma parada, e e nesse instante que se quer ter a
 * versao de antes guardada.
 */
const UM_DIA = 24 * 60 * 60 * 1000;

/*
 * Uma copia ao subir, mas nao a cada subida.
 *
 * Num dia de manutencao o sistema reinicia meia duzia de vezes. Copiando em
 * todas elas, as sete guardadas viravam sete copias das ultimas duas horas, e
 * a versao de ontem — a unica que serve para desfazer o estrago de hoje —
 * saia da pasta. A copia ao subir so acontece se a mais nova ja tiver alguma
 * idade.
 */
const IDADE_MINIMA = 6 * 60 * 60 * 1000;

function copiouAgoraPouco() {
  const [maisNova] = listarBackups();
  if (!maisNova) return false;
  return Date.now() - Date.parse(maisNova.em) < IDADE_MINIMA;
}

export function iniciarBackup({ manter = 7 } = {}) {
  const tentar = (motivo) => {
    try {
      const relato = fazerBackup({ motivo, manter });
      console.log(
        `[backup] ${relato.nome}: ${relato.arquivos} arquivos (${Math.round(relato.bytes / 1024)} KB) + ${relato.ligados} ligados${relato.apagados.length ? `, ${relato.apagados.length} antigas apagadas` : ''}`,
      );
    } catch (erro) {
      /* Copia que falha nunca derruba o atendimento: o sistema segue no ar e o
         erro fica no log para quem for olhar. */
      console.error('[backup] falhou:', erro.message);
    }
  };

  if (copiouAgoraPouco()) console.log('[backup] ja ha copia recente; nao copio de novo ao subir.');
  else tentar('ao-subir');

  const relogio = setInterval(() => tentar('diario'), UM_DIA);
  if (typeof relogio.unref === 'function') relogio.unref();
  return relogio;
}
