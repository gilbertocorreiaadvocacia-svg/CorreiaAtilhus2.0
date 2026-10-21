import { spawn } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

import { suite } from './apoio.js';

/**
 * `evolucaoDeCustoPorAgente` (servidor/nucleo/creditos.js) — a base do
 * grafico "Desempenho dos agentes de IA" do Dashboard. Pedido do escritorio
 * em 20/10/2026.
 *
 * O que nao pode falhar: o custo de cada agente fica separado por periodo
 * (nao so o total); um agente sem gasto num periodo especifico entra com 0
 * nesse periodo, em vez de faltar; credito sem agenteId nunca entra;
 * contatosPermitidos filtra como em consumoDoWorkspace; de/ate recortam o
 * periodo.
 */
export async function testarEvolucaoDeCustoPorAgente({ raiz }) {
  const s = suite('Evolucao de custo por agente, no tempo');
  const urlDoBanco = pathToFileURL(path.join(raiz, 'servidor/nucleo/banco.js')).href;
  const urlDoModulo = pathToFileURL(path.join(raiz, 'servidor/nucleo/creditos.js')).href;
  const pasta = fs.mkdtempSync(path.join(os.tmpdir(), 'evolucao-custo-agente-'));

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
    `import { iniciarBanco, inserir, encerrarBanco } from ${JSON.stringify(urlDoBanco)};
import { lancar, evolucaoDeCustoPorAgente } from ${JSON.stringify(urlDoModulo)};
iniciarBanco();
inserir('workspaces', { id: 'w1', nome: 'Teste' });
inserir('contatos', { id: 'c1', workspaceId: 'w1', telefone: '5581977770000', nome: 'Ana', etiquetas: [] });
inserir('contatos', { id: 'c2', workspaceId: 'w1', telefone: '5581977770001', nome: 'Bia', etiquetas: [] });

/* Dia 1: agente A gasta 10 no contato c1, agente B gasta 5 no contato c2. */
const diaUm = (registro) => { registro.criadoEm = '2026-02-01T12:00:00.000Z'; return registro; };
diaUm(lancar('w1', 'c1', 'processamento_ia', 10, null, 'ag-a'));
diaUm(lancar('w1', 'c2', 'processamento_ia', 5, null, 'ag-b'));

/* Dia 2: so o agente A gasta (3) — o agente B precisa aparecer com 0 nesse dia, nao faltar. */
const diaDois = (registro) => { registro.criadoEm = '2026-02-02T12:00:00.000Z'; return registro; };
diaDois(lancar('w1', 'c1', 'processamento_ia', 3, null, 'ag-a'));

/* Credito sem agenteId: nunca entra na conta de ninguem. */
diaUm(lancar('w1', 'c1', 'geracao_audio', 99, null, null));

/* Fora do periodo que o primeiro teste vai consultar. */
const foraDoPeriodo = (registro) => { registro.criadoEm = '2020-01-01T00:00:00.000Z'; return registro; };
foraDoPeriodo(lancar('w1', 'c1', 'processamento_ia', 777, null, 'ag-a'));

const geral = evolucaoDeCustoPorAgente('w1', { de: '2026-01-01T00:00:00.000Z', ate: '2026-12-31T23:59:59.999Z' });
const soC1 = evolucaoDeCustoPorAgente('w1', { de: '2026-01-01T00:00:00.000Z', contatosPermitidos: new Set(['c1']) });
console.log(JSON.stringify({ geral, soC1 }));
await encerrarBanco();
process.exit(0);
`,
  );

  try {
    const r = await rodar(script);
    if (!s.ok('roda sem erro', r.codigo === 0, r.texto.slice(-500))) return s;
    const { geral, soC1 } = JSON.parse(r.texto.trim().split('\n').pop());

    s.ok('dois periodos aparecem, fora do credito antigo', geral.periodos.length === 2, JSON.stringify(geral.periodos));
    s.ok(
      'os periodos vem ordenados',
      geral.periodos[0] === '2026-02-01' && geral.periodos[1] === '2026-02-02',
      JSON.stringify(geral.periodos),
    );

    const totalDe = (id) => geral.agentes.find((a) => a.agenteId === id)?.custoTotal;
    s.ok('o agente A soma 10+3=13 no total, sem o credito sem agenteId nem o de fora do periodo', totalDe('ag-a') === 13, JSON.stringify(geral.agentes));
    s.ok('o agente B soma 5 no total', totalDe('ag-b') === 5, JSON.stringify(geral.agentes));

    const linhaDoDiaUm = geral.serieCustos.find((l) => l.periodo === '2026-02-01');
    const linhaDoDiaDois = geral.serieCustos.find((l) => l.periodo === '2026-02-02');
    s.ok('dia 1: agente A com 10, agente B com 5', linhaDoDiaUm?.['ag-a'] === 10 && linhaDoDiaUm?.['ag-b'] === 5, JSON.stringify(linhaDoDiaUm));
    s.ok(
      'dia 2: agente A com 3, agente B ENTRA COM 0 (nao fica faltando)',
      linhaDoDiaDois?.['ag-a'] === 3 && linhaDoDiaDois?.['ag-b'] === 0,
      JSON.stringify(linhaDoDiaDois),
    );

    s.ok(
      'contatosPermitidos filtra como em consumoDoWorkspace: so o credito do c1 conta',
      soC1.agentes.find((a) => a.agenteId === 'ag-a')?.custoTotal === 13 && !soC1.agentes.some((a) => a.agenteId === 'ag-b'),
      JSON.stringify(soC1.agentes),
    );
  } finally {
    fs.rmSync(pasta, { recursive: true, force: true });
  }
  return s;
}
