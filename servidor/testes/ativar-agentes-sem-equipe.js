import { spawn } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

import { suite } from './apoio.js';

/**
 * `ativarAgentesSemEquipe` (servidor/nucleo/agentes-por-escritorio.js): numero
 * de WhatsApp de verdade conectado, mas ZERO agente ativo para responder.
 *
 * O que nao pode falhar: liga TODO agente de atendimento inativo de um
 * escritorio sem nenhum ligado; nao mexe em escritorio que ja tem pelo menos
 * um agente ativo (nao ressuscita quem foi desligado de proposito); nao mexe
 * em escritorio so com conexao de simulador; nao mexe em escritorio sem
 * nenhum agente; e nunca liga o agente de Avaliacao por essa porta.
 */
export async function testarAtivarAgentesSemEquipe({ raiz }) {
  const s = suite('Ativar agentes sem equipe');
  const urlDoBanco = pathToFileURL(path.join(raiz, 'servidor/nucleo/banco.js')).href;
  const urlDoModulo = pathToFileURL(path.join(raiz, 'servidor/nucleo/agentes-por-escritorio.js')).href;
  const pasta = fs.mkdtempSync(path.join(os.tmpdir(), 'ativar-sem-equipe-'));

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
/* w1: conexao real, dois agentes de atendimento inativos e um avaliador inativo. Deve ligar so os dois de atendimento. */
inserir('workspaces', { id: 'w1', nome: 'Civel de Teste' });
inserir('conexoes', { id: 'c1', workspaceId: 'w1', tipo: 'oficial', nome: 'Numero Civel' });
inserir('agentes', { id: 'a1', workspaceId: 'w1', nome: 'Secretaria Civel', objetivo: 'atender', ativo: false });
inserir('agentes', { id: 'a2', workspaceId: 'w1', nome: 'Especialista Consumidor', objetivo: 'atender', ativo: false });
inserir('agentes', { id: 'a3', workspaceId: 'w1', nome: 'Avaliacao Civel', objetivo: 'avaliar', ativo: false });
/* w2: ja tem um agente ativo; o outro, inativo, foi desligado de proposito e nao deve ser religado. */
inserir('workspaces', { id: 'w2', nome: 'Ja tem equipe' });
inserir('conexoes', { id: 'c2', workspaceId: 'w2', tipo: 'qrcode', nome: 'Numero com equipe' });
inserir('agentes', { id: 'a4', workspaceId: 'w2', nome: 'Triagem', objetivo: 'atender', ativo: true });
inserir('agentes', { id: 'a5', workspaceId: 'w2', nome: 'Agente aposentado', objetivo: 'atender', ativo: false });
/* w3: so tem conexao de simulador, nao conta como numero real. */
inserir('workspaces', { id: 'w3', nome: 'So simulador' });
inserir('conexoes', { id: 'c3', workspaceId: 'w3', tipo: 'simulador', nome: 'Teste' });
inserir('agentes', { id: 'a6', workspaceId: 'w3', nome: 'Agente do simulador', objetivo: 'atender', ativo: false });
/* w4: conexao real, mas nenhum agente cadastrado ainda. */
inserir('workspaces', { id: 'w4', nome: 'Sem agente nenhum' });
inserir('conexoes', { id: 'c4', workspaceId: 'w4', tipo: 'oficial', nome: 'Numero sem agente' });
await encerrarBanco();
`,
  );

  const rodarAtivacao = path.join(pasta, 'ativar.mjs');
  fs.writeFileSync(
    rodarAtivacao,
    `import { iniciarBanco, listar, encerrarBanco } from ${JSON.stringify(urlDoBanco)};
import { ativarAgentesSemEquipe } from ${JSON.stringify(urlDoModulo)};
iniciarBanco();
const ativados = ativarAgentesSemEquipe();
console.log(JSON.stringify({ ativados, agentes: listar('agentes') }));
await encerrarBanco();
process.exit(0);
`,
  );

  try {
    const m = await rodar(montagem);
    if (!s.ok('a base descartavel foi montada', m.codigo === 0, m.texto.slice(-300))) return s;

    const r1 = await rodar(rodarAtivacao);
    if (!s.ok('roda sem erro', r1.codigo === 0, r1.texto.slice(-400))) return s;
    const { ativados, agentes } = JSON.parse(r1.texto.trim().split('\n').pop());
    const por = (id) => agentes.find((a) => a.id === id);

    s.ok('liga os dois agentes de atendimento do escritorio sem equipe', por('a1').ativo && por('a2').ativo, JSON.stringify([por('a1').ativo, por('a2').ativo]));
    s.ok('nao liga o agente de Avaliacao por essa porta', !por('a3').ativo, String(por('a3').ativo));
    s.ok('nao mexe no escritorio que ja tinha agente ativo', por('a4').ativo && !por('a5').ativo, JSON.stringify([por('a4').ativo, por('a5').ativo]));
    s.ok('conexao de simulador nao conta como numero real', !por('a6').ativo, String(por('a6').ativo));
    s.ok('relata os dois agentes ligados, com o nome do escritorio', ativados.length === 2 && ativados.every((a) => a.escritorio === 'Civel de Teste'), JSON.stringify(ativados));

    const r2 = await rodar(rodarAtivacao);
    const segunda = JSON.parse(r2.texto.trim().split('\n').pop());
    s.ok('rodar de novo nao liga nada a mais (ja tem equipe em todo mundo que podia ter)', segunda.ativados.length === 0, JSON.stringify(segunda.ativados));
  } finally {
    fs.rmSync(pasta, { recursive: true, force: true });
  }
  return s;
}
