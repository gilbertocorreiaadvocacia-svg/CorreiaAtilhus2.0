import { spawn } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

import { cliente, suite } from './apoio.js';

/**
 * Contratos fechados por agente de IA, mes a mes
 * (nucleo/contratos-por-mes.js). Pedido do escritorio em 11/11/2026.
 *
 * Duas suites, porque sao duas perguntas diferentes:
 *
 *  (a) a CONTA, num escritorio de mentira com contratos em meses escolhidos a
 *      dedo. E o unico jeito de provar o corte por mes: contrato assinado de
 *      verdade cai sempre no mes de hoje, e o defeito que custa caro aqui e o
 *      de borda (o contrato de 31 de janeiro aparecendo em fevereiro);
 *  (b) a ROTA, no servidor compartilhado, que e o que a tela consome.
 */

export async function testarContratosPorMes({ raiz }) {
  const s = suite('Contratos por mes: a conta');
  const url = (arquivo) => JSON.stringify(pathToFileURL(path.join(raiz, arquivo)).href);
  const pasta = fs.mkdtempSync(path.join(os.tmpdir(), 'contratos-mes-'));
  const script = path.join(pasta, 'contratos-mes.mjs');

  fs.writeFileSync(
    script,
    `import { iniciarBanco, inserir, encerrarBanco } from ${url('servidor/nucleo/banco.js')};
import { contratosPorMes, mesesAte, mesDe } from ${url('servidor/nucleo/contratos-por-mes.js')};
iniciarBanco();

inserir('workspaces', { id: 'w1', nome: 'Correia Advogados' });
inserir('workspaces', { id: 'w2', nome: 'Outro escritorio' });

/* A janela e sempre contada para TRAS a partir do mes de hoje, entao os meses
   do teste saem daqui e nao de datas cravadas: um teste com "2026-03" fixo
   passa este ano e reprova no ano que vem. */
const janela = mesesAte(mesDe(new Date().toISOString()), 12);
const mesAtual = janela[11];
const mesPassado = janela[10];
const tresAtras = janela[9];
const antigo = mesesAte(janela[0], 2)[0]; // um mes antes da janela

for (const id of ['ana', 'bruno', 'carla', 'davi', 'elisa', 'fabio', 'gina']) {
  inserir('agentes', { id, workspaceId: 'w1', nome: 'Agente ' + id });
}
for (const [id, w] of [['c1','w1'],['c2','w1'],['c3','w1'],['c4','w1'],['c5','w1'],['c6','w1'],['c7','w1'],['c8','w1'],['c9','w2']]) {
  inserir('contatos', { id, workspaceId: w, nome: 'Cliente ' + id });
}

/* Dia 10 ao meio-dia UTC: longe de qualquer borda, para estes contratos caírem
   no mes que o teste quer sem depender de fuso. O de borda vem depois. */
const em = (mes, dia = 10, hora = 12) => mes + '-' + String(dia).padStart(2, '0') + 'T' + String(hora).padStart(2, '0') + ':00:00.000Z';
let n = 0;
const assinar = (contatoId, agenteId, quando, extra = {}) =>
  inserir('contratos', { id: 'ct' + (n += 1), workspaceId: extra.workspaceId || 'w1', contatoId, agenteId, situacao: 'assinado', assinadoEm: quando, ...extra });

// Ana: 3 no mes atual, 1 no passado  -> melhor mes = o atual
assinar('c1', 'ana', em(mesAtual));
assinar('c2', 'ana', em(mesAtual));
assinar('c3', 'ana', em(mesAtual));
assinar('c4', 'ana', em(mesPassado));
// Bruno: 2 no mes passado
assinar('c5', 'bruno', em(mesPassado));
assinar('c6', 'bruno', em(tresAtras));
// Mais cinco agentes com 1 cada, para a cauda "Outros" existir (o grafico leva 6)
assinar('c7', 'carla', em(mesPassado));
assinar('c8', 'davi', em(mesPassado));
assinar('c1', 'elisa', em(mesPassado));
assinar('c2', 'fabio', em(mesPassado));
assinar('c3', 'gina', em(mesPassado));
// Sem agente (criado a mao)
assinar('c4', null, em(mesAtual));
// Fora da janela, e nao assinado: nenhum dos dois pode entrar
assinar('c5', 'ana', em(antigo));
inserir('contratos', { id: 'ctPend', workspaceId: 'w1', contatoId: 'c6', agenteId: 'ana', situacao: 'em_conferencia', assinadoEm: null });
// De outro escritorio: nao pode vazar
assinar('c9', 'ana', em(mesAtual), { workspaceId: 'w2' });

/* A BORDA DO FUSO: 31 do mes passado as 22h30 em Sao Paulo e 01 do mes atual
   as 01h30 em UTC. Tem que contar no mes PASSADO. */
const ultimoDiaDoPassado = new Date(Date.UTC(Number(mesAtual.slice(0,4)), Number(mesAtual.slice(5,7)) - 1, 1, 1, 30));
assinar('c7', 'bruno', ultimoDiaDoPassado.toISOString());

const ctx = { workspaceId: 'w1', papel: 'owner' };
const r = contratosPorMes(ctx, { meses: 12 });
const deOutro = contratosPorMes({ workspaceId: 'w2', papel: 'owner' }, { meses: 12 });
const curto = contratosPorMes(ctx, { meses: 3 });
const teto = contratosPorMes(ctx, { meses: 999 });

console.log(JSON.stringify({
  janela: r.meses,
  mesAtual,
  mesPassado,
  total: r.totais.total,
  foraDaJanela: r.totais.foraDaJanela,
  mediaMensal: r.totais.mediaMensal,
  melhorMes: r.totais.melhorMes,
  doMesAtual: r.totais.mesAtual,
  doMesAnterior: r.totais.mesAnterior,
  variacao: r.totais.variacao,
  agentesQueFecharam: r.totais.agentesQueFecharam,
  nomes: r.agentes.map((a) => a.nome),
  ana: r.agentes.find((a) => a.nome === 'Agente ana'),
  bruno: r.agentes.find((a) => a.nome === 'Agente bruno'),
  semAgente: r.semAgente,
  comLinhaPropria: r.comLinhaPropria.length,
  outros: r.outros,
  serieDoMesAtual: r.serie.find((l) => l.periodo === mesAtual),
  totalDeOutroEscritorio: deOutro.totais.total,
  mesesCurto: curto.meses.length,
  mesesTeto: teto.meses.length,
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

    s.ok('a janela tem os 12 meses pedidos e termina no mes de hoje', b.janela.length === 12 && b.janela[11] === b.mesAtual, JSON.stringify(b.janela));

    /* 13 assinados dentro da janela: 4 da ana, 3 do bruno (um deles o da borda),
       1 de cada um dos outros cinco, e 1 sem agente. */
    s.ok('conta so o assinado, dentro da janela e deste escritorio', b.total === 13, `total=${b.total}`);
    s.ok('o assinado antes da janela fica de fora, mas e contado a parte', b.foraDaJanela === 1, `fora=${b.foraDaJanela}`);
    s.ok('contrato de outro escritorio nao vaza', b.totalDeOutroEscritorio === 1, `w2=${b.totalDeOutroEscritorio}`);

    /* O de 31 as 22h30 de Sao Paulo (01h30 UTC do dia 1) tem que estar no mes
       PASSADO: e o defeito que o corte por string do ISO causaria. */
    s.ok(
      'contrato da virada do mes conta no mes do escritorio, e nao no do UTC',
      b.bruno?.porMes[b.mesPassado] === 2 && b.bruno?.porMes[b.mesAtual] === 0,
      JSON.stringify(b.bruno?.porMes),
    );

    s.ok('o agente que mais fechou vem primeiro', b.nomes[0] === 'Agente ana', JSON.stringify(b.nomes));
    s.ok('o total do agente soma os meses dele', b.ana?.total === 4, JSON.stringify({ total: b.ana?.total, porMes: b.ana?.porMes }));
    s.ok(
      'o melhor mes do agente e o de maior numero',
      b.ana?.melhorMes?.periodo === b.mesAtual && b.ana?.melhorMes?.quantidade === 3,
      JSON.stringify(b.ana?.melhorMes),
    );
    /* 4 contratos em 12 meses = 0,3; a media divide pela janela inteira, e nao
       so pelos meses em que o agente fechou alguma coisa. */
    s.ok('a media do agente divide pela janela inteira', b.ana?.mediaMensal === 0.3, String(b.ana?.mediaMensal));
    s.ok('a fatia do agente e sobre o total do escritorio', b.ana?.fatia === 31, `${b.ana?.fatia}% de ${b.total}`);

    s.ok('o contrato sem agente fica no proprio balde', b.semAgente?.total === 1, JSON.stringify(b.semAgente?.total));
    s.ok('sete agentes fecharam contrato', b.agentesQueFecharam === 7, String(b.agentesQueFecharam));
    s.ok('seis ganham linha propria no grafico e o resto vira "Outros"', b.comLinhaPropria === 6 && b.outros?.quantidade === 1, JSON.stringify(b.outros));

    /* O total do mes na serie inclui o sem-agente: e ele que a tela mostra no
       rodape da tabela, e tem que bater com a soma das linhas. */
    s.ok(
      'o total do mes na serie soma os agentes e o sem-agente',
      b.serieDoMesAtual?.__total === 4,
      JSON.stringify(b.serieDoMesAtual),
    );

    s.ok('o mes atual e o anterior saem nos totais', b.doMesAtual === 4 && b.doMesAnterior === 8, JSON.stringify({ atual: b.doMesAtual, anterior: b.doMesAnterior }));
    s.ok('a variacao compara os dois', b.variacao === -50, String(b.variacao));
    s.ok('o melhor mes do escritorio e o de maior total', b.melhorMes?.periodo === b.mesPassado && b.melhorMes?.quantidade === 8, JSON.stringify(b.melhorMes));
    s.ok('a media mensal divide pela janela', b.mediaMensal === Number((13 / 12).toFixed(1)), String(b.mediaMensal));

    s.ok('pedir menos meses encurta a janela', b.mesesCurto === 3, String(b.mesesCurto));
    s.ok('e pedir demais para no teto, para nao varrer a base a toa', b.mesesTeto === 36, String(b.mesesTeto));
  } finally {
    fs.rmSync(pasta, { recursive: true, force: true });
  }
  return s;
}

/**
 * A rota que a tela consome. Aqui nao da para escolher o mes (contrato assinado
 * cai sempre em hoje), entao o que se afirma e o contrato da resposta: a forma
 * que o grafico e a tabela esperam, e o contrato novo aparecendo no mes atual.
 */
export async function testarRotaContratosPorMes({ base }) {
  const s = suite('Contratos por mes: a rota');
  const api = cliente(base);
  await api.entrar();

  const r = await api.get('/api/relatorios/contratos-por-mes?meses=12');
  if (!s.ok('a rota responde', r.status === 200 && r.dados, JSON.stringify(r.dados).slice(0, 200))) return s;
  const d = r.dados;

  s.ok('devolve 12 meses em ordem, do mais antigo para o mais novo', d.meses?.length === 12 && [...d.meses].sort().join() === d.meses.join(), JSON.stringify(d.meses));
  s.ok('o ultimo mes e o de hoje', d.meses?.[11] === d.mesAtual, `${d.meses?.[11]} vs ${d.mesAtual}`);
  s.ok('a serie tem uma linha por mes, com o periodo e o total', d.serie?.length === 12 && d.serie.every((l) => l.periodo && typeof l.__total === 'number'), JSON.stringify(d.serie?.[0]));
  s.ok('os totais vem com a estatistica que a tela mostra', typeof d.totais?.total === 'number' && typeof d.totais?.mediaMensal === 'number' && 'variacao' in d.totais, JSON.stringify(d.totais));
  s.ok('e diz que o mes corrente ainda esta correndo, para a tela avisar', d.mesIncompleto === true);

  /* Soma de controle: o total tem que bater com a soma dos meses da serie —
     um balde que escapa aqui vira numero errado no cartao do topo. */
  const somaDaSerie = (d.serie || []).reduce((soma, l) => soma + (l.__total || 0), 0);
  s.ok('o total bate com a soma dos meses', somaDaSerie === d.totais?.total, `serie=${somaDaSerie} totais=${d.totais?.total}`);

  /* E com a soma das linhas da tabela (agentes + sem agente): e a conferencia
     que o escritorio faz no olho, somando a coluna. */
  const somaDasLinhas = (d.agentes || []).reduce((soma, a) => soma + a.total, 0) + (d.semAgente?.total || 0);
  s.ok('e com a soma das linhas da tabela', somaDasLinhas === d.totais?.total, `linhas=${somaDasLinhas} totais=${d.totais?.total}`);

  const seis = await api.get('/api/relatorios/contratos-por-mes?meses=6');
  s.ok('a janela obedece ao seletor da tela', seis.dados?.meses?.length === 6, String(seis.dados?.meses?.length));

  /* A planilha leva o mesmo recorte: tela e CSV nao podem discordar. */
  const planilha = await api.get('/api/relatorios/contratos.csv');
  s.ok(
    'a planilha traz o bloco mes a mes',
    /Contratos por agente, mes a mes/.test(planilha.dados?.csv || ''),
    String(planilha.dados?.csv).slice(-300),
  );

  return s;
}
