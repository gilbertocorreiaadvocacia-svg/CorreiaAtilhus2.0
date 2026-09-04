import { spawn } from 'node:child_process';
import fs from 'node:fs';
import net from 'node:net';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { esperarNoAr, suite } from './apoio.js';
import { subirEvolucaoFalsa } from './evolution-falsa.js';
import { testarQrCode } from './conexoes-qrcode.js';
import { testarSimuladorEOficial } from './conexoes-regressao.js';

/**
 * A suite do CorreiaAtilhus2.0. Rode com `npm test`.
 *
 * Sobe o sistema de verdade e conversa com ele por HTTP, como qualquer
 * integracao faria. Nao ha teste de unidade aqui de proposito: o que quebra
 * neste sistema nao e uma funcao isolada, e a costura entre o webhook, o banco
 * em arquivo e o envio, e teste de unidade nao ve costura.
 *
 * DUAS TRAVAS DE SEGURANCA, e as duas importam:
 *
 * 1. A BASE E DESCARTAVEL. O servidor sobe apontado para uma pasta temporaria,
 *    nunca para `dados/`. Sem isso, rodar a suite na maquina do escritorio
 *    apagaria conversa de cliente para semear conversa de mentira.
 * 2. AS PORTAS SAO SORTEADAS. Nada de 4477 fixo: quem esta com o sistema aberto
 *    na propria maquina precisa conseguir rodar o teste sem fechar nada.
 */

const RAIZ = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const CHAVE_EVOLUCAO = 'chave-de-teste';

/** Uma porta livre de verdade: o sistema pergunta ao proprio sistema. */
function portaLivre() {
  return new Promise((resolve, reject) => {
    const tomada = net.createServer();
    tomada.on('error', reject);
    tomada.listen(0, '127.0.0.1', () => {
      const { port } = tomada.address();
      tomada.close(() => resolve(port));
    });
  });
}

/**
 * `node --check` em todo arquivo .js do projeto.
 *
 * Vale mais do que parece num projeto sem build: erro de sintaxe em um modulo
 * do navegador nao aparece em teste nenhum de servidor, e so quebra na tela de
 * quem abriu o sistema, sem mensagem util.
 */
async function conferirSintaxe() {
  const s = suite('Sintaxe');
  const arquivos = [];
  const ignorar = new Set(['node_modules', '.git', 'dados']);

  (function varrer(pasta) {
    for (const item of fs.readdirSync(pasta, { withFileTypes: true })) {
      if (ignorar.has(item.name)) continue;
      const completo = path.join(pasta, item.name);
      if (item.isDirectory()) varrer(completo);
      else if (item.name.endsWith('.js')) arquivos.push(completo);
    }
  })(RAIZ);

  const falhas = [];
  for (const arquivo of arquivos) {
    const codigo = await new Promise((resolve) => {
      const p = spawn(process.execPath, ['--check', arquivo], { stdio: ['ignore', 'ignore', 'pipe'] });
      let erro = '';
      p.stderr.on('data', (d) => (erro += d));
      p.on('close', (c) => resolve(c === 0 ? null : erro.split('\n').slice(0, 3).join(' ')));
    });
    if (codigo) falhas.push(`${path.relative(RAIZ, arquivo)}: ${codigo}`);
  }

  s.ok(`${arquivos.length} arquivos .js sem erro de sintaxe`, falhas.length === 0, falhas.join('\n'));
  return s;
}

async function principal() {
  const suites = [];
  suites.push(await conferirSintaxe());

  const pastaDados = fs.mkdtempSync(path.join(os.tmpdir(), 'correiatendimentos-teste-'));
  const portaSistema = await portaLivre();
  const portaEvolucao = await portaLivre();
  const base = `http://127.0.0.1:${portaSistema}`;
  const evolucao = `http://127.0.0.1:${portaEvolucao}`;

  const servicoFalso = await subirEvolucaoFalsa(portaEvolucao, CHAVE_EVOLUCAO);
  const sistema = spawn(process.execPath, [path.join(RAIZ, 'servidor/index.js')], {
    env: { ...process.env, PORTA: String(portaSistema), CORREIA_DADOS: pastaDados },
    stdio: ['ignore', 'pipe', 'pipe'],
  });

  let saidaDoSistema = '';
  sistema.stdout.on('data', (d) => (saidaDoSistema += d));
  sistema.stderr.on('data', (d) => (saidaDoSistema += d));

  function encerrar() {
    try {
      sistema.kill();
    } catch {
      /* ja morreu */
    }
    servicoFalso.close();
    fs.rmSync(pastaDados, { recursive: true, force: true });
  }

  try {
    const noAr = await esperarNoAr(`${base}/api/saude`);
    if (!noAr) {
      console.error('O sistema nao subiu. Saida do servidor:\n');
      console.error(saidaDoSistema);
      encerrar();
      process.exit(1);
    }

    suites.push(await testarSimuladorEOficial({ base }));
    suites.push(await testarQrCode({ base, evolucao, chaveEvolucao: CHAVE_EVOLUCAO }));
  } catch (erro) {
    console.error('\nA suite quebrou antes de terminar:', erro.message);
    console.error(erro.stack);
    encerrar();
    process.exit(1);
  }

  encerrar();

  /* Relatorio ---------------------------------------------------------- */
  let total = 0;
  let falharam = 0;
  for (const s of suites) {
    console.log(`\n${s.nome}`);
    for (const r of s.resultados) {
      total += 1;
      if (!r.passou) falharam += 1;
      console.log(`  ${r.passou ? 'ok   ' : 'FALHOU'} ${r.titulo}`);
      if (!r.passou && r.detalhe) console.log(`         ${r.detalhe}`);
    }
  }

  console.log(
    `\n${total - falharam} de ${total} passaram${falharam ? `, ${falharam} falharam` : ''}.`,
  );
  process.exit(falharam ? 1 : 0);
}

principal();
