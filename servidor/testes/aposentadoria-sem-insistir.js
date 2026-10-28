import { spawn } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

import { suite } from './apoio.js';

/**
 * A triagem do auxilio-acidente para de insistir na pergunta da aposentadoria
 * (nucleo/aposentadoria-sem-insistir.js). Pedido do escritorio em 28/10/2026:
 * "se o cliente nao responder sobre se recebe aposentadoria ou nao, pode
 * continuar o atendimento".
 *
 * O que nao pode falhar: o pacote ja traz a regra; o agente instalado com o
 * texto do pacote a ganha logo depois do caminho NAO RECEBE, e o reescrito
 * pelo escritorio, no fim; o BPC (que tambem pergunta, mas la aposentadoria
 * desqualifica) e o agente que nao pergunta ficam como estao; roda uma vez
 * por agente, e quem apagar a regra na tela nao a ve voltar.
 */
export async function testarAposentadoriaSemInsistir({ raiz }) {
  const s = suite('A triagem do auxilio-acidente nao insiste na pergunta da aposentadoria');
  const url = (arquivo) => JSON.stringify(pathToFileURL(path.join(raiz, arquivo)).href);
  const pasta = fs.mkdtempSync(path.join(os.tmpdir(), 'aposentadoria-'));
  const script = path.join(pasta, 'aposentadoria.mjs');
  fs.writeFileSync(
    script,
    `import { iniciarBanco, achar, atualizar, inserir, encerrarBanco } from ${url('servidor/nucleo/banco.js')};
import { aposentadoriaSemInsistir, aposentadoriaNosAgentes } from ${url('servidor/nucleo/aposentadoria-sem-insistir.js')};
import { AUXILIO_ACIDENTE, APOSENTADORIA_SEM_RESPOSTA } from ${url('servidor/ia/pacotes/auxilio-acidente.js')};
iniciarBanco();
const beatrizDoPacote = AUXILIO_ACIDENTE[0];
const semARegra = beatrizDoPacote.prompt.replace('\\n\\n' + APOSENTADORIA_SEM_RESPOSTA, '');
inserir('workspaces', { id: 'w1', nome: 'Correia Advogados' });
inserir('agentes', { id: 'beatriz', workspaceId: 'w1', nome: 'Beatriz (Triagem)', pasta: 'Auxílio-Acidente FER MAR26', prompt: semARegra });
inserir('agentes', { id: 'reescrita', workspaceId: 'w1', nome: '#01 Triagem [aux acidente]', pasta: 'Outra', prompt: 'Pergunte: Você já recebe aposentadoria? Depois siga.' });
inserir('agentes', { id: 'bpc', workspaceId: 'w1', nome: 'Andreia (BPC 1) Triagem', pasta: 'BPC Loas', prompt: 'PERGUNTA 1: Você já recebe aposentadoria, pensão por morte ou o BPC Loas?' });
inserir('agentes', { id: 'segurado', workspaceId: 'w1', nome: '#02 Segurado [aux acidente]', pasta: 'Auxílio-Acidente FER MAR26', prompt: 'Analise a qualidade de segurado.' });

const mudados = aposentadoriaSemInsistir();
const prompt = (id) => achar('agentes', id).prompt;
const saude = aposentadoriaNosAgentes('w1');
const reescrita = prompt('reescrita');

atualizar('agentes', 'reescrita',{ prompt: 'Pergunte: Você já recebe aposentadoria? Depois siga.' });
const deNovo = aposentadoriaSemInsistir();

console.log(JSON.stringify({
  pacoteTem: beatrizDoPacote.prompt.includes(APOSENTADORIA_SEM_RESPOSTA),
  mudados,
  beatriz: prompt('beatriz'),
  reescrita,
  bpc: prompt('bpc'),
  segurado: prompt('segurado'),
  regra: APOSENTADORIA_SEM_RESPOSTA,
  saude,
  deNovo,
}));
await encerrarBanco();
process.exit(0);
`,
  );

  try {
    const r = await new Promise((resolve) => {
      const p = spawn(process.execPath, [script], { env: { ...process.env, CORREIA_DADOS: pasta }, stdio: ['ignore', 'pipe', 'pipe'] });
      let texto = '';
      p.stdout.on('data', (d) => (texto += d));
      p.stderr.on('data', (d) => (texto += d));
      p.on('close', (codigo) => resolve({ codigo, texto }));
    });
    if (!s.ok('o escritorio de teste roda sem erro', r.codigo === 0, r.texto.slice(-600))) return s;
    const b = JSON.parse(r.texto.trim().split('\n').pop());

    s.ok('o pacote do auxilio-acidente ja traz a regra', b.pacoteTem);
    const naoRecebe = b.beatriz.indexOf('NÃO RECEBE: falou de acidente');
    const regra = b.beatriz.indexOf(b.regra);
    const acidente = b.beatriz.indexOf('\nACIDENTE\n');
    s.ok(
      'a Beatriz instalada ganha a regra logo depois do caminho NAO RECEBE',
      naoRecebe >= 0 && regra > naoRecebe && regra < acidente && b.beatriz.split(b.regra).length === 2,
      JSON.stringify({ naoRecebe, regra, acidente }),
    );
    s.ok('o roteiro reescrito pelo escritorio ganha a regra no fim', b.reescrita.endsWith(b.regra), b.reescrita.slice(-200));
    s.ok('o BPC e o agente que nao pergunta ficam como estavam', !b.bpc.includes(b.regra) && !b.segurado.includes(b.regra));
    s.ok('conta os dois agentes mudados', b.mudados === 2, String(b.mudados));
    s.ok(
      'a saude mostra quem pergunta da aposentadoria e se ja tem a regra',
      b.saude.length === 2 && b.saude.every((a) => a.semInsistir),
      JSON.stringify(b.saude),
    );
    s.ok('uma vez por agente: quem apagou a regra na tela nao a ve voltar', b.deNovo === 0, String(b.deNovo));
  } finally {
    fs.rmSync(pasta, { recursive: true, force: true });
  }
  return s;
}
