import { spawn } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

import { suite } from './apoio.js';

/**
 * `registrarTempoResposta`/`evolucaoDoTempoResposta`
 * (servidor/nucleo/tempos-resposta.js) — a base do grafico "Tempo de
 * resposta" do Dashboard. Pedido do escritorio em 20/10/2026.
 *
 * O que nao pode falhar: espera invalida (zero, negativa, nao numerica) nunca
 * vira registro; a mediana (nao a media) e o que o grafico le; cada periodo
 * conta so as amostras dele; contatosPermitidos filtra como em
 * consumoDoWorkspace; de/ate recortam o periodo.
 */
export async function testarTempoResposta({ raiz }) {
  const s = suite('Tempo de resposta, no tempo');
  const urlDoBanco = pathToFileURL(path.join(raiz, 'servidor/nucleo/banco.js')).href;
  const urlDoModulo = pathToFileURL(path.join(raiz, 'servidor/nucleo/tempos-resposta.js')).href;
  const pasta = fs.mkdtempSync(path.join(os.tmpdir(), 'tempo-resposta-'));

  const rodar = (arquivo) =>
    new Promise((resolve) => {
      const p = spawn(process.execPath, [arquivo], { env: { ...process.env, CORREIA_DADOS: pasta }, stdio: ['ignore', 'pipe', 'pipe'] });
      let texto = '';
      p.stdout.on('data', (d) => (texto += d));
      p.stderr.on('data', (d) => (texto += d));
      p.on('close', (codigo) => resolve({ codigo, texto }));
    });

  const script = path.join(pasta, 'rodar.mjs');
  fs.writeFileSync(
    script,
    `import { iniciarBanco, inserir, listar, encerrarBanco } from ${JSON.stringify(urlDoBanco)};
import { registrarTempoResposta, evolucaoDoTempoResposta } from ${JSON.stringify(urlDoModulo)};
iniciarBanco();
inserir('workspaces', { id: 'w1', nome: 'Teste' });
inserir('contatos', { id: 'c1', workspaceId: 'w1', telefone: '5581977770000', nome: 'Ana', etiquetas: [] });
inserir('contatos', { id: 'c2', workspaceId: 'w1', telefone: '5581977770001', nome: 'Bia', etiquetas: [] });

/* Espera invalida: nunca vira registro. */
const semEspera = registrarTempoResposta('w1', 'c1', 0);
const esperaNegativa = registrarTempoResposta('w1', 'c1', -500);
const esperaNaoNumerica = registrarTempoResposta('w1', 'c1', NaN);

/* Dia 1, contato c1: 1min, 2min, 10min -> mediana 2, media (1+2+10)/3=4.3 */
const diaUm = (registro) => { registro.criadoEm = '2026-03-01T12:00:00.000Z'; return registro; };
diaUm(registrarTempoResposta('w1', 'c1', 60000, 'ag-a'));
diaUm(registrarTempoResposta('w1', 'c1', 120000, 'ag-a'));
diaUm(registrarTempoResposta('w1', 'c1', 600000));

/* Dia 2, contato c2: 5min -> mediana 5, media 5. */
const diaDois = (registro) => { registro.criadoEm = '2026-03-02T12:00:00.000Z'; return registro; };
diaDois(registrarTempoResposta('w1', 'c2', 300000));

const geral = evolucaoDoTempoResposta('w1', { de: '2026-01-01T00:00:00.000Z', ate: '2026-12-31T23:59:59.999Z' });
const soC1 = evolucaoDoTempoResposta('w1', { de: '2026-01-01T00:00:00.000Z', contatosPermitidos: new Set(['c1']) });
const totalGravado = listar('temposResposta', { workspaceId: 'w1' }).length;

console.log(JSON.stringify({
  semEspera, esperaNegativa, esperaNaoNumerica, geral, soC1, totalGravado,
}));
await encerrarBanco();
process.exit(0);
`,
  );

  try {
    const r = await rodar(script);
    if (!s.ok('roda sem erro', r.codigo === 0, r.texto.slice(-500))) return s;
    const { semEspera, esperaNegativa, esperaNaoNumerica, geral, soC1, totalGravado } = JSON.parse(r.texto.trim().split('\n').pop());

    s.ok('espera zero nao vira registro', semEspera === null);
    s.ok('espera negativa nao vira registro', esperaNegativa === null);
    s.ok('espera nao numerica nao vira registro', esperaNaoNumerica === null);
    s.ok('so as 4 esperas validas foram gravadas', totalGravado === 4, totalGravado);

    s.ok('dois periodos aparecem', geral.serie.length === 2, JSON.stringify(geral.serie));
    s.ok('o total de amostras soma as 4 esperas validas', geral.amostraTotal === 4, geral.amostraTotal);

    const diaUm = geral.serie.find((l) => l.periodo === '2026-03-01');
    s.ok('dia 1: 3 amostras', diaUm?.amostras === 3, JSON.stringify(diaUm));
    s.ok('dia 1: mediana de 1,2,10 minutos e 2 (nao a media)', diaUm?.medianaMin === 2, JSON.stringify(diaUm));
    s.ok('dia 1: media de 1,2,10 e 4.3, guardada a parte da mediana', diaUm?.mediaMin === 4.3, JSON.stringify(diaUm));

    const diaDois = geral.serie.find((l) => l.periodo === '2026-03-02');
    s.ok('dia 2: 1 amostra de 5min, mediana e media iguais', diaDois?.amostras === 1 && diaDois?.medianaMin === 5 && diaDois?.mediaMin === 5, JSON.stringify(diaDois));

    s.ok(
      'contatosPermitidos filtra como em consumoDoWorkspace: so o dia do c1 aparece',
      soC1.serie.length === 1 && soC1.serie[0].periodo === '2026-03-01' && soC1.amostraTotal === 3,
      JSON.stringify(soC1),
    );
  } finally {
    fs.rmSync(pasta, { recursive: true, force: true });
  }
  return s;
}
