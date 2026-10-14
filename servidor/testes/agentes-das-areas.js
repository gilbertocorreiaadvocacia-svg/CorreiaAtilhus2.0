import { spawn } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

import { suite } from './apoio.js';

/**
 * `garantirAgentesDasAreas` (servidor/nucleo/agentes-por-escritorio.js):
 * todo workspace de area (Previdenciario, Trabalhista, Civel) ganha a area
 * marcada certa e o roteiro de agentes do pacote dela — mesmo quando o
 * workspace nasceu errado, criado pelo caminho generico de criacao em vez
 * de criarWorkspacesPorArea (achado real em 14/10/2026: dois workspaces
 * viraram copia dos 6 agentes genericos do escritorio principal, repetidos
 * entre escritorios, em vez do conjunto proprio de cada area).
 *
 * O que nao pode falhar: acrescenta so o que falta, pelo nome do agente —
 * nunca apaga nem mexe no que ja existe, mesmo que seja o lixo generico que
 * causou o bug; acerta o campo area quando esta faltando; workspace sem
 * nome batendo com nenhuma area nao e tocado; e rodar duas vezes nao
 * instala nem muda nada a mais.
 */
export async function testarAgentesDasAreas({ raiz }) {
  const s = suite('Agentes das areas, sem duplicar');
  const urlDoBanco = pathToFileURL(path.join(raiz, 'servidor/nucleo/banco.js')).href;
  const urlDoModulo = pathToFileURL(path.join(raiz, 'servidor/nucleo/agentes-por-escritorio.js')).href;
  const urlDosPacotes = pathToFileURL(path.join(raiz, 'servidor/ia/pacotes.js')).href;
  const pasta = fs.mkdtempSync(path.join(os.tmpdir(), 'agentes-das-areas-'));

  const rodar = (arquivo) =>
    new Promise((resolve) => {
      const p = spawn(process.execPath, [arquivo], { env: { ...process.env, CORREIA_DADOS: pasta }, stdio: ['ignore', 'pipe', 'pipe'] });
      let texto = '';
      p.stdout.on('data', (d) => (texto += d));
      p.stderr.on('data', (d) => (texto += d));
      p.on('close', (codigo) => resolve({ codigo, texto }));
    });

  const montagem = path.join(pasta, 'montar.mjs');
  fs.writeFileSync(
    montagem,
    `import { iniciarBanco, inserir, encerrarBanco } from ${JSON.stringify(urlDoBanco)};
iniciarBanco();
/* w1: nasceu igual ao bug real — nome EXATO de area (sem acento, como o
   workspace quebrado de verdade), SEM o campo area, com dois agentes
   genericos (o lixo que o caminho de criacao generico copiou). */
inserir('workspaces', { id: 'w1', nome: 'Previdenciario' });
inserir('agentes', { id: 'agn-generico-1', workspaceId: 'w1', nome: 'Triagem', prompt: 'generico', ativo: true });
inserir('agentes', { id: 'agn-generico-2', workspaceId: 'w1', nome: 'Proposta e Contrato', prompt: 'generico', ativo: true });
/* w2: ja correto (area marcada e roteiro ja instalado). */
inserir('workspaces', { id: 'w2', nome: 'Trabalhista de Teste', area: 'trabalhista' });
/* w3: nenhum nome bate com nenhuma area — nao pode ser tocado. */
inserir('workspaces', { id: 'w3', nome: 'Geral de Teste' });
await encerrarBanco();
`,
  );

  const rodarMigracao = path.join(pasta, 'migrar.mjs');
  fs.writeFileSync(
    rodarMigracao,
    `import { iniciarBanco, listar, encerrarBanco } from ${JSON.stringify(urlDoBanco)};
import { garantirAgentesDasAreas } from ${JSON.stringify(urlDoModulo)};
iniciarBanco();
const resultado = garantirAgentesDasAreas();
console.log(JSON.stringify({ resultado, workspaces: listar('workspaces'), agentes: listar('agentes') }));
await encerrarBanco();
process.exit(0);
`,
  );

  try {
    const m = await rodar(montagem);
    if (!s.ok('a base descartavel foi montada', m.codigo === 0, m.texto.slice(-300))) return s;

    const r1 = await rodar(rodarMigracao);
    if (!s.ok('roda sem erro', r1.codigo === 0, r1.texto.slice(-400))) return s;
    const b = JSON.parse(r1.texto.trim().split('\n').pop());

    const w1 = b.workspaces.find((w) => w.id === 'w1');
    s.ok('w1 ganha a area certa', w1?.area === 'previdenciario', String(w1?.area));

    const { PACOTES } = await import(urlDosPacotes);
    const nomesCertos = PACOTES.previdenciario.agentes.map((a) => a.nome);
    const agentesW1 = b.agentes.filter((a) => a.workspaceId === 'w1');
    const nomesEmW1 = agentesW1.map((a) => a.nome);
    s.ok(
      'w1 ganha todo o roteiro do Previdenciario',
      nomesCertos.every((nome) => nomesEmW1.includes(nome)),
      JSON.stringify({ esperados: nomesCertos, tem: nomesEmW1 }),
    );
    s.ok(
      'os agentes genericos (o bug) continuam la, nao foram apagados',
      agentesW1.some((a) => a.id === 'agn-generico-1') && agentesW1.some((a) => a.id === 'agn-generico-2'),
      JSON.stringify(nomesEmW1),
    );
    const novos = agentesW1.filter((a) => nomesCertos.includes(a.nome));
    s.ok('todo agente novo nasce desligado', novos.every((a) => a.ativo === false), JSON.stringify(novos.map((a) => [a.nome, a.ativo])));

    const w2 = b.workspaces.find((w) => w.id === 'w2');
    s.ok('w2, que ja estava certo, mantem a area', w2?.area === 'trabalhista', String(w2?.area));
    const nomesCertosTrabalhista = PACOTES.trabalhista.agentes.map((a) => a.nome);
    const agentesW2 = b.agentes.filter((a) => a.workspaceId === 'w2');
    s.ok(
      'w2 tambem ganha o roteiro certo (nao tinha nenhum agente ainda)',
      nomesCertosTrabalhista.every((nome) => agentesW2.some((a) => a.nome === nome)),
      JSON.stringify(agentesW2.map((a) => a.nome)),
    );

    s.ok('w3, sem nome de area nenhum, nao ganha agente', !b.agentes.some((a) => a.workspaceId === 'w3'), JSON.stringify(b.agentes.filter((a) => a.workspaceId === 'w3')));

    const r2 = await rodar(rodarMigracao);
    const c = JSON.parse(r2.texto.trim().split('\n').pop());
    s.ok(
      'rodar de novo nao corrige area nem instala agente a mais',
      c.resultado.areasCorrigidas === 0 && c.resultado.agentesInstalados === 0,
      JSON.stringify(c.resultado),
    );
    const agentesW1Depois = c.agentes.filter((a) => a.workspaceId === 'w1');
    s.ok(
      'e a contagem de agentes de w1 fica igual (sem duplicar)',
      agentesW1Depois.length === agentesW1.length,
      `antes: ${agentesW1.length}, depois: ${agentesW1Depois.length}`,
    );
  } finally {
    fs.rmSync(pasta, { recursive: true, force: true });
  }
  return s;
}
