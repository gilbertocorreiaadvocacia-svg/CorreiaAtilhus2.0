import { spawn } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { esperar, esperarNoAr, suite } from './apoio.js';

/**
 * O que o sistema faz para sobreviver a uma queda.
 *
 * Duas coisas que nao existiam ate 30/09/2026:
 *
 * 1. COPIA DE SEGURANCA. Mil e cento e oitenta e oito conversas de cliente
 *    viviam num disco so, sem copia em lugar nenhum.
 *
 * 2. O QUE CHEGA COM O SISTEMA PARADO. A Evolution chama o webhook uma vez e
 *    nao tenta de novo: mensagem que chega com o sistema fora do ar fica so no
 *    celular e ninguem e avisado. A recuperacao ja existia (a importacao do
 *    historico reconhece pelo id o que ja esta gravado), o que faltava era
 *    SABER que houve buraco.
 *
 * Sobe processos proprios, em portas proprias, com bases descartaveis.
 */
export async function testarSobreviver({ raiz, portaLivre }) {
  const s = suite('Sobreviver a queda');
  const pastas = [];
  const vivos = [];

  function subir(porta, dados, extra = {}) {
    const processo = spawn(process.execPath, [path.join(raiz, 'servidor/index.js')], {
      env: {
        ...process.env,
        PORTA: String(porta),
        CORREIA_DADOS: dados,
        CORREIA_HOST: '127.0.0.1',
        CORREIA_EVOLUTION_ENV: path.join(dados, 'sem-evolution.env'),
        ANTHROPIC_API_KEY: '',
        OPENAI_API_KEY: '',
        ...extra,
      },
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    vivos.push(processo);
    return processo;
  }

  async function subirEEsperar(dados, extra = {}) {
    const porta = await portaLivre();
    const processo = subir(porta, dados, extra);
    let saida = '';
    processo.stdout.on('data', (d) => (saida += d));
    processo.stderr.on('data', (d) => (saida += d));
    const noAr = await esperarNoAr(`http://127.0.0.1:${porta}/api/saude`);
    return { processo, porta, noAr, saidaAte: () => saida };
  }

  const pasta = fs.mkdtempSync(path.join(os.tmpdir(), 'correia-sobreviver-'));
  pastas.push(pasta);

  /* --- 1. A copia acontece sozinha, ao subir ---------------------------- */

  const primeira = await subirEEsperar(pasta);
  if (!s.ok('o sistema sobe com a base descartavel', primeira.noAr, primeira.saidaAte())) return s;

  const pastaBackups = path.join(pasta, 'backups');
  const copias = () => (fs.existsSync(pastaBackups) ? fs.readdirSync(pastaBackups).sort() : []);

  s.ok('uma copia de seguranca e feita ao subir, sem ninguem pedir', copias().length === 1, JSON.stringify(copias()));

  const primeiraCopia = path.join(pastaBackups, copias()[0]);
  s.ok(
    'a copia leva os arquivos do banco',
    fs.existsSync(path.join(primeiraCopia, 'status.json')) &&
      fs.existsSync(path.join(primeiraCopia, 'agentes.json')),
    fs.readdirSync(primeiraCopia).join(', '),
  );
  s.ok(
    'e a copia nao copia a si mesma',
    !fs.existsSync(path.join(primeiraCopia, 'backups')),
  );

  /* O pulso e um arquivo, e nao um registro do banco: precisa sobreviver a uma
     parada suja, em que o banco nao gravou o que tinha em memoria. */
  s.ok('o pulso do sistema fica gravado em disco', fs.existsSync(path.join(pasta, 'batimento.json')));

  /* --- 2. Reiniciar nao pode varrer as copias --------------------------- */

  primeira.processo.kill();
  await esperar(500);

  const segunda = await subirEEsperar(pasta);
  s.ok('o sistema sobe de novo', segunda.noAr, segunda.saidaAte());
  /*
   * Num dia de manutencao o sistema reinicia meia duzia de vezes. Copiando em
   * todas, as guardadas viravam copias das ultimas horas e a versao de ontem
   * — a unica que serve para desfazer o estrago de hoje — sairia da pasta.
   */
  s.ok(
    'reiniciar logo em seguida NAO faz outra copia',
    copias().length === 1,
    `${copias().length} copias: ${copias().join(', ')}`,
  );
  s.ok(
    'e o sistema diz por que nao copiou',
    /ja ha copia recente/i.test(segunda.saidaAte()),
    segunda.saidaAte().slice(-400),
  );

  segunda.processo.kill();
  await esperar(500);

  /* --- 3. Parada longa dispara a conferencia do que chegou -------------- */

  /* Volta o pulso no tempo: e o que o disco mostraria depois de o sistema
     passar dez minutos fora do ar. */
  const batimento = path.join(pasta, 'batimento.json');
  const dezMinutosAtras = new Date(Date.now() - 10 * 60 * 1000).toISOString();
  fs.writeFileSync(batimento, JSON.stringify({ em: dezMinutosAtras }));

  const terceira = await subirEEsperar(pasta);
  s.ok('o sistema sobe depois da parada longa', terceira.noAr, terceira.saidaAte());
  await esperar(1500);

  const saida = terceira.saidaAte();
  s.ok(
    'depois de uma parada longa, o sistema percebe o buraco',
    /sem bater/i.test(saida),
    saida.slice(-600),
  );
  s.ok(
    'e diz de quanto tempo foi',
    /\b(9|10|11) min sem bater/.test(saida),
    (saida.match(/.*sem bater.*/) || ['nao encontrado'])[0],
  );
  s.ok(
    'sem numero conectado, ele nao inventa recuperacao nenhuma',
    /0 numero\(s\) conectado\(s\)/.test(saida),
    (saida.match(/.*numero\(s\) conectado.*/) || ['nao encontrado'])[0],
  );
  /* O pulso e reescrito ao subir: a proxima parada e medida a partir de agora,
     e nao a partir do carimbo velho. */
  const agoraNoDisco = Date.parse(JSON.parse(fs.readFileSync(batimento, 'utf8')).em);
  s.ok('o pulso volta a bater depois da recuperacao', Date.now() - agoraNoDisco < 60000);

  terceira.processo.kill();
  await esperar(500);

  /* --- 4. Parada curta nao dispara nada --------------------------------- */

  fs.writeFileSync(batimento, JSON.stringify({ em: new Date(Date.now() - 20 * 1000).toISOString() }));
  const quarta = await subirEEsperar(pasta);
  await esperar(1000);
  s.ok(
    'uma parada de segundos (atualizacao de versao) nao dispara busca nenhuma',
    !/sem bater/i.test(quarta.saidaAte()),
    quarta.saidaAte().slice(-400),
  );
  quarta.processo.kill();

  /* --- 5. A copia manual, e a rotacao ----------------------------------- */

  await esperar(500);
  const rodarBackup = (motivo) =>
    new Promise((resolve) => {
      const p = spawn(process.execPath, [path.join(raiz, 'servidor/ferramentas/backup.js'), '--motivo', motivo], {
        env: { ...process.env, CORREIA_DADOS: pasta },
        stdio: ['ignore', 'pipe', 'pipe'],
      });
      let texto = '';
      p.stdout.on('data', (d) => (texto += d));
      p.stderr.on('data', (d) => (texto += d));
      p.on('close', () => resolve(texto));
    });

  const manual = await rodarBackup('antes-do-teste');
  s.ok('npm run backup faz uma copia com o motivo no nome', /antes-do-teste/.test(manual), manual.slice(-300));
  s.ok(
    'e a copia manual aparece na pasta',
    copias().some((n) => n.includes('antes-do-teste')),
    copias().join(', '),
  );

  for (const processo of vivos) {
    try {
      processo.kill();
    } catch {
      /* ja morreu */
    }
  }
  await esperar(300);
  for (const p of pastas) fs.rmSync(p, { recursive: true, force: true });

  return s;
}
