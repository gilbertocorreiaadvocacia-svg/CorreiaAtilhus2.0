import { spawn } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { esperarNoAr, suite } from './apoio.js';

/**
 * A guarda de porta ocupada.
 *
 * Este teste existe por causa de um defeito que custou uma tarde inteira: havia
 * duas copias do sistema na mesma maquina, uma que subia sozinha no login do
 * Windows e outra recem-aberta no editor. As duas atendem em localhost:4477 e a
 * tela e identica. A segunda via a porta ocupada, dizia apenas "ja esta rodando,
 * abra o navegador", e saia com codigo 0 como se estivesse tudo bem.
 *
 * O resultado: a pessoa editava o codigo na pasta certa, recarregava a pagina,
 * via a versao antiga e concluia que o programa estava quebrado. Nada na tela
 * dizia que ela estava olhando para OUTRA copia.
 *
 * Agora a guarda pergunta a quem esta na porta de onde ele roda, e trata os
 * casos como o que eles sao: mesma pasta e rotina, pasta diferente e problema.
 */
export async function testarPortaOcupada({ raiz, portaLivre }) {
  const s = suite('Guarda de porta ocupada');

  const porta = await portaLivre();
  const dadosDono = fs.mkdtempSync(path.join(os.tmpdir(), 'correia-dono-'));
  const dadosOutra = fs.mkdtempSync(path.join(os.tmpdir(), 'correia-outra-'));
  const copia = fs.mkdtempSync(path.join(os.tmpdir(), 'correia-copia-'));

  /* Uma segunda instalacao de verdade, em outra pasta: e o cenario real. So o
     que o servidor precisa para subir, para o teste nao ficar caro. */
  fs.cpSync(path.join(raiz, 'servidor'), path.join(copia, 'servidor'), { recursive: true });
  fs.cpSync(path.join(raiz, 'web'), path.join(copia, 'web'), { recursive: true });

  const dono = spawn(process.execPath, [path.join(raiz, 'servidor/index.js')], {
    env: { ...process.env, PORTA: String(porta), CORREIA_DADOS: dadosDono },
    stdio: 'ignore',
  });

  function limpar() {
    try {
      dono.kill();
    } catch {
      /* ja morreu */
    }
    for (const pasta of [dadosDono, dadosOutra, copia]) {
      fs.rmSync(pasta, { recursive: true, force: true });
    }
  }

  /** Sobe uma instancia que vai falhar, e devolve o que ela disse e como saiu. */
  function tentarSubir(deQualPasta, pastaDados) {
    return new Promise((resolve) => {
      const p = spawn(process.execPath, [path.join(deQualPasta, 'servidor/index.js')], {
        env: { ...process.env, PORTA: String(porta), CORREIA_DADOS: pastaDados },
        stdio: ['ignore', 'pipe', 'pipe'],
      });
      let saida = '';
      p.stdout.on('data', (d) => (saida += d));
      p.stderr.on('data', (d) => (saida += d));
      p.on('close', (codigo) => resolve({ saida, codigo }));
    });
  }

  try {
    if (!(await esperarNoAr(`http://127.0.0.1:${porta}/api/saude`))) {
      s.ok('a primeira copia subiu', false, 'nao respondeu na porta');
      limpar();
      return s;
    }
    s.ok('a primeira copia subiu e ocupou a porta', true);

    const saude = await (await fetch(`http://127.0.0.1:${porta}/api/saude`)).json();
    s.ok('a saude diz de qual pasta a copia roda', path.resolve(saude.raiz) === path.resolve(raiz), saude.raiz);

    /* O caso que enganou: outra pasta. */
    const outra = await tentarSubir(copia, dadosOutra);
    s.ok('copia de outra pasta e recusada com codigo de erro', outra.codigo === 1, `saiu com ${outra.codigo}`);
    s.ok('o aviso mostra a pasta que esta no ar', outra.saida.includes(raiz));
    s.ok('o aviso mostra a pasta que tentou subir', outra.saida.includes(copia));
    s.ok(
      'o aviso diz que a tela nao e a desta pasta',
      /NAO esta/.test(outra.saida) && /ATENCAO/.test(outra.saida),
    );

    /* O caso benigno: a mesma pasta, subindo duas vezes. Rotina do inicio
       automatico, e nao pode virar erro. */
    const mesma = await tentarSubir(raiz, dadosDono);
    s.ok('a mesma pasta subindo de novo sai limpa', mesma.codigo === 0, `saiu com ${mesma.codigo}`);
    s.ok('e sem alarme falso', !/ATENCAO/.test(mesma.saida));
  } finally {
    limpar();
  }

  return s;
}
