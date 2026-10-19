import { spawn } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

import { suite } from './apoio.js';

/**
 * `custoPorAgente` (servidor/nucleo/creditos.js) — a base da tela "Qualidade
 * e custos dos agentes": soma custo, numero de chamadas de IA de verdade e
 * duracao media por agente, num periodo.
 *
 * O que nao pode falhar: credito sem agenteId (de antes desta mudanca, ou
 * de uma acao sem agente - ex. teste de voz) nunca entra na conta de
 * nenhum agente; so 'processamento_ia' conta como chamada e entra na
 * duracao media; os demais tipos de credito (mencao, audio) somam ao custo
 * do agente mas nao a chamada nem a duracao; o filtro de periodo (de/ate)
 * funciona; agente sem nenhum credito no periodo nao aparece.
 */
export async function testarCustoPorAgente({ raiz }) {
  const s = suite('Custo, chamadas e duracao media por agente');
  const urlDoBanco = pathToFileURL(path.join(raiz, 'servidor/nucleo/banco.js')).href;
  const urlDoModulo = pathToFileURL(path.join(raiz, 'servidor/nucleo/creditos.js')).href;
  const pasta = fs.mkdtempSync(path.join(os.tmpdir(), 'custo-por-agente-'));

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
import { lancar, custoPorAgente } from ${JSON.stringify(urlDoModulo)};
iniciarBanco();
inserir('workspaces', { id: 'w1', nome: 'Teste' });
inserir('contatos', { id: 'c1', workspaceId: 'w1', telefone: '5581977770000', nome: 'Ana', etiquetas: [] });

/* Agente A: duas chamadas de processamento_ia (com duracao) + uma mencao. */
lancar('w1', 'c1', 'processamento_ia', 9, { duracaoMs: 1000 }, 'ag-a');
lancar('w1', 'c1', 'processamento_ia', 9, { duracaoMs: 3000 }, 'ag-a');
lancar('w1', 'c1', 'mencao_status', 1, null, 'ag-a');

/* Agente B: uma chamada de processamento_ia, sem detalhe de duracao (nao deve quebrar). */
lancar('w1', 'c1', 'processamento_ia', 9, null, 'ag-b');

/* Credito sem agenteId (de antes desta mudanca, ou teste de voz): nunca deve entrar na conta de ninguem. */
lancar('w1', 'c1', 'geracao_audio', 50, null, null);

/* Fora do periodo que o teste vai consultar. */
const antigo = lancar('w1', 'c1', 'processamento_ia', 9, null, 'ag-a');
antigo.criadoEm = '2020-01-01T00:00:00.000Z';

const resultado = custoPorAgente('w1', { de: '2026-01-01T00:00:00.000Z' });
console.log(JSON.stringify(resultado));
await encerrarBanco();
process.exit(0);
`,
  );

  try {
    const r = await rodar(script);
    if (!s.ok('roda sem erro', r.codigo === 0, r.texto.slice(-500))) return s;
    const resultado = JSON.parse(r.texto.trim().split('\n').pop());
    const porId = (id) => resultado.find((r2) => r2.agenteId === id);

    s.ok('so os dois agentes com credito no periodo aparecem', resultado.length === 2, JSON.stringify(resultado));

    const a = porId('ag-a');
    s.ok('o agente A soma custo das chamadas + da mencao (9+9+1=19)', a?.custo === 19, JSON.stringify(a));
    s.ok('o agente A conta 2 chamadas (so processamento_ia, a mencao nao conta)', a?.chamadas === 2, JSON.stringify(a));
    s.ok('a duracao media do agente A e a media das duas chamadas ((1000+3000)/2=2000)', a?.duracaoMediaMs === 2000, JSON.stringify(a));

    const b = porId('ag-b');
    s.ok('o agente B soma so o seu credito (9)', b?.custo === 9, JSON.stringify(b));
    s.ok('o agente B conta 1 chamada', b?.chamadas === 1, JSON.stringify(b));
    s.ok('sem detalhe.duracaoMs, a duracao media fica 0 (nao quebra, nao vira NaN)', b?.duracaoMediaMs === 0, JSON.stringify(b));
  } finally {
    fs.rmSync(pasta, { recursive: true, force: true });
  }
  return s;
}
