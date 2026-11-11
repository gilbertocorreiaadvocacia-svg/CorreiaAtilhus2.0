import { spawn } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

import { suite } from './apoio.js';

/**
 * Teto de casos em aberto por pessoa (nucleo/teto-de-casos.js).
 *
 * Pedido do escritorio em 11/11/2026: impedir que alguem assuma varios casos
 * para si e feche contrato atras de meta, tirando dos colegas.
 *
 * O QUE NAO PODE FALHAR:
 *
 *  - nasce DESLIGADO. E a assercao mais importante do arquivo: um teto que ja
 *    chega valendo bloquearia gente no dia da implantacao, no meio de
 *    atendimento, sem ninguem ter pedido numero nenhum;
 *  - conta a conversa assumida e nao concluida, e so essa: conversa da IA nao
 *    e de ninguem, e concluida ja saiu da mao da pessoa;
 *  - o ajuste individual vence o padrao, inclusive para TIRAR o teto de
 *    alguem (o socio que fecha o que aparecer);
 *  - contar e por pessoa e por escritorio, sem vazar de um para o outro.
 */
export async function testarTetoDeCasos({ raiz }) {
  const s = suite('Teto de casos em aberto por pessoa');
  const url = (arquivo) => JSON.stringify(pathToFileURL(path.join(raiz, arquivo)).href);
  const pasta = fs.mkdtempSync(path.join(os.tmpdir(), 'teto-casos-'));
  const script = path.join(pasta, 'teto.mjs');

  fs.writeFileSync(
    script,
    `import { iniciarBanco, inserir, atualizar, encerrarBanco } from ${url('servidor/nucleo/banco.js')};
import { casosEmAberto, casosPorPessoa, conferirTeto, motivoDoBloqueio, tetoDoMembro } from ${url('servidor/nucleo/teto-de-casos.js')};
iniciarBanco();

inserir('workspaces', { id: 'w1', nome: 'Correia' });
inserir('workspaces', { id: 'w2', nome: 'Outro' });
inserir('usuarios', { id: 'u1', nome: 'Dani' });
inserir('usuarios', { id: 'u2', nome: 'Milena' });
inserir('usuarios', { id: 'u3', nome: 'Socio' });
inserir('membros', { id: 'm1', workspaceId: 'w1', usuarioId: 'u1', papel: 'atendente' });
inserir('membros', { id: 'm2', workspaceId: 'w1', usuarioId: 'u2', papel: 'atendente' });
inserir('membros', { id: 'm3', workspaceId: 'w1', usuarioId: 'u3', papel: 'owner' });
inserir('membros', { id: 'm9', workspaceId: 'w2', usuarioId: 'u1', papel: 'atendente' });

let n = 0;
const conversa = (campos) => inserir('contatos', { id: 'c' + (n += 1), workspaceId: 'w1', nome: 'Cliente', ...campos });

/* Dani: 3 assumidas em aberto, 1 concluida (nao conta), 1 da IA (nao e dela). */
conversa({ aceitoPor: 'm1', estado: 'ativo' });
conversa({ aceitoPor: 'm1', estado: 'ativo' });
conversa({ aceitoPor: 'm1', estado: 'pendente' });
conversa({ aceitoPor: 'm1', estado: 'arquivado' });
conversa({ aceitoPor: null, estado: 'ia', responsavel: { tipo: 'agente', id: 'a1' } });
/* Milena: 1. */
conversa({ aceitoPor: 'm2', estado: 'ativo' });
/* Do outro escritorio, com o MESMO id de membro na mao: nao pode somar aqui. */
inserir('contatos', { id: 'cX', workspaceId: 'w2', nome: 'De fora', aceitoPor: 'm1', estado: 'ativo' });

const desligado = {
  teto: tetoDoMembro('w1', 'm1'),
  conferido: conferirTeto('w1', 'm1'),
};

/* Liga com padrao 2: Dani (3) passa, Milena (1) nao. */
atualizar('workspaces', 'w1', { tetoDeCasos: { padrao: 2, porMembro: {} } });
const comPadrao = {
  dani: conferirTeto('w1', 'm1'),
  milena: conferirTeto('w1', 'm2'),
  motivo: motivoDoBloqueio(conferirTeto('w1', 'm1')),
};

/* Ajuste individual: Dani ganha 5 (passa a caber) e o socio perde o teto. */
atualizar('workspaces', 'w1', { tetoDeCasos: { padrao: 2, porMembro: { m1: 5, m3: 0 } } });
const comIndividual = {
  dani: conferirTeto('w1', 'm1'),
  socio: conferirTeto('w1', 'm3'),
  tetoDoSocio: tetoDoMembro('w1', 'm3'),
};

console.log(JSON.stringify({
  desligado,
  abertosDaDani: casosEmAberto('w1', 'm1'),
  abertosDaMilena: casosEmAberto('w1', 'm2'),
  abertosDoOutroEscritorio: casosEmAberto('w2', 'm1'),
  comPadrao,
  comIndividual,
  lista: casosPorPessoa('w1'),
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

    s.ok(
      'sem nada configurado, ninguem tem teto e nada e barrado',
      b.desligado.teto === null && b.desligado.conferido.pode === true && b.desligado.conferido.excedeu === false,
      JSON.stringify(b.desligado),
    );

    s.ok('conta a conversa assumida e em aberto', b.abertosDaDani === 3, String(b.abertosDaDani));
    s.ok('a concluida e a da IA ficam de fora', b.abertosDaDani === 3 && b.abertosDaMilena === 1, JSON.stringify({ dani: b.abertosDaDani, milena: b.abertosDaMilena }));
    s.ok('conversa de outro escritorio nao soma', b.abertosDoOutroEscritorio === 1, String(b.abertosDoOutroEscritorio));

    s.ok('com o padrao ligado, quem passou do teto e barrado', b.comPadrao.dani.pode === false && b.comPadrao.dani.excedeu === true, JSON.stringify(b.comPadrao.dani));
    s.ok('e quem esta dentro continua fechando', b.comPadrao.milena.pode === true, JSON.stringify(b.comPadrao.milena));
    s.ok(
      'a frase do bloqueio diz o numero e como sair disso',
      /3 casos em aberto/.test(b.comPadrao.motivo) && /limite é 2/.test(b.comPadrao.motivo) && /Conclua/.test(b.comPadrao.motivo),
      b.comPadrao.motivo,
    );

    s.ok('o ajuste individual vence o padrao', b.comIndividual.dani.teto === 5 && b.comIndividual.dani.pode === true, JSON.stringify(b.comIndividual.dani));
    s.ok(
      'e zero no individual quer dizer SEM teto, nao teto zero',
      b.comIndividual.tetoDoSocio === null && b.comIndividual.socio.pode === true,
      JSON.stringify(b.comIndividual),
    );

    const dani = b.lista.find((p) => p.nome === 'Dani');
    s.ok('a lista do administrador traz nome, teto e quantos em aberto', dani?.abertos === 3 && dani?.teto === 5, JSON.stringify(dani));
    s.ok('e vem ordenada pelo mais carregado', b.lista[0]?.nome === 'Dani', JSON.stringify(b.lista.map((p) => p.nome)));
  } finally {
    fs.rmSync(pasta, { recursive: true, force: true });
  }
  return s;
}
