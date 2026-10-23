import { spawn } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

import { suite } from './apoio.js';

/**
 * `retomarRespostasPendentes` (servidor/ia/motor.js): depois de uma queda do
 * servidor, o cronometro de resposta do agente (so memoria, nunca
 * espelhado em disco) se perde. O contato continua no banco com
 * responsavel:agente e estado:'ia', mas sem ningm agendando a resposta de
 * novo — era esse o motivo de "quando o sistema voltou da queda, ficou tudo
 * bugado nas conversas" que o escritorio relatou em 23/10/2026.
 *
 * O que nao pode falhar: conversa 'ia' com mensagem do cliente esperando
 * (ultima entrada mais nova que a ultima saida) ganha o cronometro de volta
 * e o agente responde de verdade; conversa 'ia' em repouso (ultima fala foi
 * do PROPRIO agente) NAO ganha uma mensagem do nada; conversa 'ia' cujo
 * agente esta desligado nao e tocada; conversa 'pendente' (nao 'ia') nao e
 * nem considerada — essa fila e do reatribuir-pendentes.js, nao deste.
 */
export async function testarRetomarRespostasPendentes({ raiz }) {
  const s = suite('Depois de uma queda, o cronometro de resposta do agente volta sozinho');
  const urlDoBanco = pathToFileURL(path.join(raiz, 'servidor/nucleo/banco.js')).href;
  const urlDoModulo = pathToFileURL(path.join(raiz, 'servidor/ia/motor.js')).href;
  const pasta = fs.mkdtempSync(path.join(os.tmpdir(), 'retomar-respostas-'));

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
inserir('workspaces', { id: 'w1', nome: 'Teste' });

inserir('agentes', { id: 'ag-ativo', workspaceId: 'w1', nome: 'Ativo', ativo: true, delaySegundos: 1 });
inserir('agentes', { id: 'ag-desligado', workspaceId: 'w1', nome: 'Desligado', ativo: false });
inserir('conexoes', { id: 'conx-sim', workspaceId: 'w1', tipo: 'simulador' });

const responsavelAtivo = { tipo: 'agente', id: 'ag-ativo', nome: 'Ativo' };
const antes = new Date(Date.now() - 60000).toISOString();
const agora = new Date().toISOString();

/* 'ia', mensagem do cliente sem resposta (ultima entrada mais nova) — e o
   caso da queda: o cronometro morreu antes de disparar. */
inserir('contatos', {
  id: 'c-sem-resposta', workspaceId: 'w1', conexaoId: 'conx-sim', telefone: '5581977770001', nome: 'Ana',
  estado: 'ia', responsavel: responsavelAtivo, ultimaEntradaEm: agora, ultimaSaidaEm: antes, etiquetas: [],
});
/* 'ia' em repouso: a ULTIMA fala foi do agente (saida mais nova). Nao deve
   ganhar mensagem nova so porque o servidor reiniciou. */
inserir('contatos', {
  id: 'c-em-repouso', workspaceId: 'w1', conexaoId: 'conx-sim', telefone: '5581977770002', nome: 'Beto',
  estado: 'ia', responsavel: responsavelAtivo, ultimaEntradaEm: antes, ultimaSaidaEm: agora, etiquetas: [],
});
/* 'ia', agente desligado: nao tocar (agendarResposta tambem nao agendaria). */
inserir('contatos', {
  id: 'c-agente-desligado', workspaceId: 'w1', conexaoId: 'conx-sim', telefone: '5581977770003', nome: 'Carla',
  estado: 'ia', responsavel: { tipo: 'agente', id: 'ag-desligado', nome: 'Desligado' }, ultimaEntradaEm: agora, ultimaSaidaEm: antes, etiquetas: [],
});
/* 'pendente': fila de outro mecanismo (reatribuir-pendentes.js), nem deve
   ser considerada aqui. */
inserir('contatos', {
  id: 'c-pendente', workspaceId: 'w1', conexaoId: 'conx-sim', telefone: '5581977770004', nome: 'Dani',
  estado: 'pendente', responsavel: null, ultimaEntradaEm: agora, etiquetas: [],
});
await encerrarBanco();
`,
  );

  const rodarRetomada = path.join(pasta, 'retomar.mjs');
  fs.writeFileSync(
    rodarRetomada,
    `import { iniciarBanco, listar, mensagensDe, encerrarBanco } from ${JSON.stringify(urlDoBanco)};
import { retomarRespostasPendentes } from ${JSON.stringify(urlDoModulo)};
iniciarBanco();
const resultado = retomarRespostasPendentes();
/* agendarResposta tem piso de 1s de delay (ver motor.js); espera generosa
   para o timer ter chance de disparar dentro deste processo descartavel. */
await new Promise((resolver) => setTimeout(resolver, 1800));
const contatos = listar('contatos');
const mensagens = Object.fromEntries(contatos.map((c) => [c.id, mensagensDe(c.id).length]));
console.log(JSON.stringify({ resultado, mensagens }));
await encerrarBanco();
process.exit(0);
`,
  );

  try {
    const m = await rodar(montagem);
    if (!s.ok('a base descartavel foi montada', m.codigo === 0, m.texto.slice(-400))) return s;

    const r = await rodar(rodarRetomada);
    if (!s.ok('a retomada roda sem erro', r.codigo === 0, r.texto.slice(-500))) return s;
    const b = JSON.parse(r.texto.trim().split('\n').pop());

    s.ok('so a Ana (sem resposta) e retomada — Beto, Carla e Dani nao contam', b.resultado.retomados === 1, JSON.stringify(b.resultado));
    s.ok('a Ana (sem resposta) ganha a resposta de verdade do agente', b.mensagens['c-sem-resposta'] > 0, JSON.stringify(b.mensagens));
    s.ok(
      'o Beto (em repouso), a Carla (agente desligado) e a Dani (pendente, nao ia) nao ganham mensagem nenhuma',
      ['c-em-repouso', 'c-agente-desligado', 'c-pendente'].every((id) => b.mensagens[id] === 0),
      JSON.stringify(b.mensagens),
    );
  } finally {
    fs.rmSync(pasta, { recursive: true, force: true });
  }
  return s;
}
