import { spawn } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

import { cliente, suite } from './apoio.js';

/**
 * A tela aberta descobre que subiu versao nova.
 *
 * Relato do escritorio em 19/11/2026: "ainda nao aparece nas conversas esse
 * filtro". O filtro estava no ar havia um dia: producao rodando o codigo
 * certo, o arquivo servido com o botao dentro, cabecalho de cache correto,
 * sem service worker. Nada estava quebrado no servidor.
 *
 * O que segurava era a ABA. O escritorio deixa o sistema aberto o dia inteiro.
 * Numa implantacao o servidor reinicia, o tempo real cai, reconecta e manda a
 * tela recarregar os DADOS -- e so os dados. O index.html nao e pedido de novo
 * enquanto ninguem aperta F5, entao o PROGRAMA continua sendo o que baixou de
 * manha. Funcionalidade nova nao aparece, e de dentro do escritorio isso se le
 * como "a implantacao nao foi". Aconteceu duas vezes em dois dias.
 *
 * Nenhum teste podia ter pegado isso antes, porque nenhum teste tinha a nocao
 * de "a tela esta rodando uma versao e o servidor ja esta em outra". Esta
 * suite cria essa nocao e trava as tres pecas:
 *
 *  1. o servidor DIZ qual entrega esta respondendo, em toda resposta de dados;
 *  2. a tela PERCEBE quando esse valor muda, e so quando muda;
 *  3. o aviso tem botao, e o botao NAO some sozinho.
 *
 * O que ela deliberadamente NAO afirma: que a tela recarrega sozinha. Ela nao
 * recarrega, de proposito -- jogaria fora a resposta que a atendente esta
 * digitando para um cliente. Quem decide e ela.
 */

/** 1. O servidor diz qual entrega esta respondendo. */
export async function testarCabecalhoDaVersao({ base }) {
  const s = suite('O servidor diz, em toda resposta, qual entrega esta no ar');
  const api = cliente(base);
  await api.entrar();

  const saude = await api.get('/api/saude');
  const codigo = saude?.dados?.codigo;
  if (!s.ok('a saude continua dizendo o codigo da entrega', Boolean(codigo), JSON.stringify(codigo))) return s;

  /*
   * O cabecalho tem de vir em QUALQUER rota de dados, e nao so na saude: a
   * tela aberta quase nunca pede a saude, ela pede conversa, contato, agente.
   * Se o valor so viajasse na saude, a descoberta dependeria de alguem abrir
   * justo aquela pagina.
   */
  for (const rota of ['/api/sessao/eu', '/api/contatos?aba=todas&limite=1', '/api/etiquetas']) {
    const r = await api.get(rota);
    const noCabecalho = r?.cabecalhos?.['x-codigo'] || r?.cabecalhos?.['X-Codigo'] || null;
    s.ok(`${rota} responde com o codigo da entrega`, noCabecalho === codigo, `${noCabecalho} (esperado ${codigo})`);
  }

  return s;
}

/** 2 e 3. A tela percebe, e o aviso tem botao que fica. */
export async function testarAvisoDeVersaoNova({ raiz }) {
  const s = suite('A tela percebe a versao nova e oferece recarregar');
  const pasta = fs.mkdtempSync(path.join(os.tmpdir(), 'versao-nova-'));
  const script = path.join(pasta, 'tela.mjs');
  const url = (arquivo) => JSON.stringify(pathToFileURL(path.join(raiz, arquivo)).href);

  fs.writeFileSync(
    script,
    `/* A pagina de mentira: so o que ui.js e api.js encostam. */
class No {
  constructor() {
    this.filhos = []; this.dataset = {}; this.style = { setProperty() {} };
    this.classList = { add() {}, remove() {} }; this.textContent = ''; this.aoClick = null;
  }
  setAttribute() {}
  addEventListener(nome, fn) { if (nome === 'click') this.aoClick = fn; }
  append(...nos) { this.filhos.push(...nos); }
  remove() {}
}
globalThis.Node = No;
const avisos = new No();
globalThis.document = {
  createElement: () => new No(),
  createTextNode: (texto) => Object.assign(new No(), { textContent: texto }),
  getElementById: (id) => (id === 'avisos' ? avisos : null),
};
globalThis.localStorage = { getItem: () => null, setItem() {}, removeItem() {} };

/* O servidor de mentira: cada resposta diz qual entrega a respondeu. */
let codigoDoServidor = '2026-11-18.1';
globalThis.fetch = async () => ({
  status: 200,
  ok: true,
  headers: { get: (nome) => (String(nome).toLowerCase() === 'x-codigo' ? codigoDoServidor : 'application/json; charset=utf-8') },
  text: async () => JSON.stringify({ ok: 1 }),
});

const { api, quandoAVersaoMudar } = await import(${url('web/js/api.js')});
const { aviso } = await import(${url('web/js/ui.js')});

let avisadas = 0;
quandoAVersaoMudar(() => {
  avisadas += 1;
  aviso('O sistema foi atualizado. Recarregue para ver a versão nova.', '', {
    acao: { rotulo: 'Recarregar', aoClicar: () => { globalThis.__recarregou = (globalThis.__recarregou || 0) + 1; } },
  });
});

const resultado = {};

/* A tela trabalhando normalmente, com o servidor na mesma entrega. */
await api.get('/api/contatos');
await api.get('/api/etiquetas');
resultado.semMudanca = avisadas;

/* A implantacao: o servidor passa a responder outra entrega. */
codigoDoServidor = '2026-11-19.1';
await api.get('/api/contatos');
resultado.depoisDaImplantacao = avisadas;

/* A tela segue trabalhando: o aviso nao pode virar chuva. */
await api.get('/api/contatos');
await api.get('/api/etiquetas');
await api.get('/api/contatos');
resultado.depoisDeMaisPedidos = avisadas;
resultado.avisosNaTela = avisos.filhos.length;

/* O aviso por dentro: o texto, o botao que fica, e o que ele faz. */
const oAviso = avisos.filhos[0] || null;
const textos = oAviso ? oAviso.filhos.map((f) => f.textContent) : [];
resultado.texto = textos.join(' | ');
resultado.temBotaoRecarregar = textos.some((t) => /Recarregar/.test(t || ''));
resultado.temFechar = textos.some((t) => t === '×');

/* Clicar no botao faz o que promete. */
const botao = (oAviso ? oAviso.filhos : []).find((f) => /Recarregar/.test(f.textContent || ''));
if (botao && botao.aoClick) botao.aoClick();
resultado.recarregouAoClicar = globalThis.__recarregou || 0;

/* E um aviso comum, sem acao, continua sumindo sozinho. */
const antesDoComum = avisos.filhos.length;
aviso('Salvo.', 'sucesso');
const comum = avisos.filhos[avisos.filhos.length - 1];
resultado.comumTemBotao = comum.filhos.some((f) => /Recarregar/.test(f.textContent || '')) || comum.filhos.some((f) => f.textContent === '×');
resultado.comumEntrou = avisos.filhos.length === antesDoComum + 1;

console.log(JSON.stringify(resultado));
process.exit(0);
`,
  );

  try {
    const r = await new Promise((resolve) => {
      const p = spawn(process.execPath, [script], { stdio: ['ignore', 'pipe', 'pipe'] });
      let texto = '';
      p.stdout.on('data', (d) => (texto += d));
      p.stderr.on('data', (d) => (texto += d));
      p.on('close', (codigo) => resolve({ codigo, texto }));
    });
    const linha = r.texto.trim().split('\n').reverse().find((l) => l.trim().startsWith('{'));
    if (!s.ok('a tela de mentira roda e devolve resultado', Boolean(linha), `codigo ${r.codigo}\n${r.texto.slice(-700)}`)) return s;
    const b = JSON.parse(linha);

    /*
     * Esta e a assercao que protege contra o aviso chato: enquanto a entrega
     * e a mesma, ninguem e incomodado. Um aviso que aparece sem motivo e um
     * aviso que a equipe aprende a fechar sem ler.
     */
    s.ok('servidor na mesma entrega: nenhum aviso', b.semMudanca === 0, JSON.stringify(b.semMudanca));
    s.ok('o servidor muda de entrega e a tela percebe', b.depoisDaImplantacao === 1, JSON.stringify(b.depoisDaImplantacao));
    s.ok(
      'e avisa UMA vez, nao a cada pedido que a tela faz depois',
      b.depoisDeMaisPedidos === 1 && b.avisosNaTela === 1,
      JSON.stringify({ avisadas: b.depoisDeMaisPedidos, naTela: b.avisosNaTela }),
    );

    s.ok('o aviso diz o que aconteceu e o que fazer', /atualizado/i.test(b.texto || '') && /Recarregue/i.test(b.texto || ''), b.texto || '');
    s.ok('tem o botao de recarregar', b.temBotaoRecarregar === true, b.texto || '');
    /*
     * O botao FICA. Aviso comum evapora em 3,4 s; este nasceu para ser clicado,
     * e um botao que some antes de a pessoa olhar e pior do que botao nenhum.
     * O x de fechar e o sinal de que ele fica -- so quem fica ganha o x.
     */
    s.ok('e ele nao evapora: ganhou o x de fechar, como o erro', b.temFechar === true, b.texto || '');
    s.ok('clicar recarrega a tela', b.recarregouAoClicar === 1, JSON.stringify(b.recarregouAoClicar));

    s.ok('aviso comum continua sem botao, e some sozinho', b.comumTemBotao === false && b.comumEntrou === true, JSON.stringify(b));
  } finally {
    fs.rmSync(pasta, { recursive: true, force: true });
  }
  return s;
}
