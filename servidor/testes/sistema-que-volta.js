import { spawn } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

import { suite } from './apoio.js';

/**
 * "As vezes o sistema cai" (pedido do escritorio em 29/10/2026). Tres partes:
 *
 *   1. O servidor anota cada subida e como saiu da vez anterior
 *      (nucleo/vida.js): implantacao, reiniciado na mesma versao, ou caiu — com
 *      o tempo parado, a memoria no ultimo pulso e o ultimo erro solto, sem
 *      telefone de ninguem.
 *   2. A copia de seguranca da subida pode esperar (nucleo/backup.js), para
 *      nao atrasar a volta do sistema.
 *   3. A tela aguenta o servidor fora por alguns segundos: leitura tenta de
 *      novo sozinha, envio nao (repetir um POST mandaria a mensagem duas
 *      vezes), erro de verdade do sistema nao e confundido com servidor fora, e
 *      o tempo real se religa e recarrega a tela quando o servidor volta.
 *
 * Cada parte num processo proprio: a 3 troca fetch, EventSource e a pagina por
 * versoes de mentira, e isso nao pode vazar para as outras suites.
 */

function rodar(script, pasta) {
  return new Promise((resolve) => {
    const p = spawn(process.execPath, [script], { env: { ...process.env, CORREIA_DADOS: pasta }, stdio: ['ignore', 'pipe', 'pipe'] });
    let texto = '';
    p.stdout.on('data', (d) => (texto += d));
    p.stderr.on('data', (d) => (texto += d));
    p.on('close', (codigo) => resolve({ codigo, texto }));
  });
}

export async function testarSistemaQueVolta({ raiz }) {
  const s = suite('Sistema que cai: a subida conta como saiu, e a tela se recupera sozinha');
  const url = (arquivo) => JSON.stringify(pathToFileURL(path.join(raiz, arquivo)).href);
  const pasta = fs.mkdtempSync(path.join(os.tmpdir(), 'sistema-que-volta-'));

  try {
    /* ---------------- 1. Como saiu da vez anterior ---------------- */
    const vida = path.join(pasta, 'vida.mjs');
    fs.writeFileSync(
      vida,
      `import fs from 'node:fs';
import path from 'node:path';
import { registrarSubida, registrarDesligamento, registrarErroNaoTratado, vidaDoSistema } from ${url('servidor/nucleo/vida.js')};
const pulso = (segundosAtras, memoriaMb) =>
  fs.writeFileSync(path.join(process.env.CORREIA_DADOS, 'batimento.json'), JSON.stringify({ em: new Date(Date.now() - segundosAtras * 1000).toISOString(), memoriaMb }));
const pausa = () => new Promise((r) => setTimeout(r, 5));

const primeira = registrarSubida('v1');
await pausa();
registrarDesligamento('SIGTERM', 'v1');
pulso(20, 180);
const implantacao = registrarSubida('v2');
await pausa();
registrarDesligamento('SIGTERM', 'v2');
const mesma = registrarSubida('v2');
await pausa();
registrarErroNaoTratado(new Error('falhou ao gravar a conversa de 5581999990000'));
pulso(420, 950);
const caiu = registrarSubida('v2');
console.log(JSON.stringify({ primeira, implantacao, mesma, caiu, saude: vidaDoSistema() }));
`,
    );
    const r1 = await rodar(vida, pasta);
    if (s.ok('a anotacao das subidas roda sem erro', r1.codigo === 0, r1.texto.slice(-600))) {
      const v = JSON.parse(r1.texto.trim().split('\n').pop());
      s.ok('a primeira subida e a primeira', v.primeira.comoSaiu === 'primeira subida', v.primeira.comoSaiu);
      s.ok(
        'desligado e subiu com versao nova: implantacao, com o tempo parado e a memoria',
        v.implantacao.comoSaiu === 'implantacao' && v.implantacao.paradoSegundos >= 19 && v.implantacao.memoriaNoUltimoPulsoMb === 180 && v.implantacao.motivoDoDesligamento === 'SIGTERM',
        JSON.stringify(v.implantacao),
      );
      s.ok('desligado e subiu com a mesma versao: reiniciado', v.mesma.comoSaiu === 'reiniciado, mesma versao', v.mesma.comoSaiu);
      s.ok(
        'sem o aviso de parar: caiu, com o ultimo erro solto e a memoria alta do ultimo pulso',
        v.caiu.comoSaiu === 'caiu' && v.caiu.paradoSegundos >= 419 && v.caiu.memoriaNoUltimoPulsoMb === 950 && /falhou ao gravar/.test(v.caiu.ultimoErro?.mensagem || ''),
        JSON.stringify(v.caiu),
      );
      s.ok('o erro anotado nao leva o telefone do cliente', !/\d{6,}/.test(JSON.stringify(v.caiu)), v.caiu.ultimoErro?.mensagem);
      s.ok('a saude mostra as subidas, da mais nova para a mais velha', v.saude.subidas.length === 4 && v.saude.subidas[0].comoSaiu === 'caiu', JSON.stringify(v.saude.subidas.map((x) => x.comoSaiu)));
    }

    /* ---------------- 2. A copia da subida espera ---------------- */
    const copia = path.join(pasta, 'copia.mjs');
    fs.writeFileSync(
      copia,
      `import { iniciarBanco, inserir, encerrarBanco } from ${url('servidor/nucleo/banco.js')};
import { iniciarBackup, listarBackups } from ${url('servidor/nucleo/backup.js')};
iniciarBanco();
inserir('workspaces', { id: 'w1', nome: 'Correia Advogados' });
await encerrarBanco();
const relogio = iniciarBackup({ primeiraDepoisDeMs: 300 });
const antes = listarBackups().length;
await new Promise((r) => setTimeout(r, 900));
const depois = listarBackups().length;
clearInterval(relogio);
console.log(JSON.stringify({ antes, depois }));
process.exit(0);
`,
    );
    const r2 = await rodar(copia, path.join(pasta, 'dados-copia'));
    if (s.ok('a copia adiada roda sem erro', r2.codigo === 0, r2.texto.slice(-600))) {
      const c = JSON.parse(r2.texto.trim().split('\n').pop());
      s.ok('a copia da subida nao segura a porta: sai depois da espera', c.antes === 0 && c.depois === 1, JSON.stringify(c));
    }

    /* ---------------- 3. A tela com o servidor fora ---------------- */
    const tela = path.join(pasta, 'tela.mjs');
    fs.writeFileSync(
      tela,
      `/* A pagina de mentira: so o que ui.js usa para mostrar um aviso. */
class No {
  constructor() { this.filhos = []; this.dataset = {}; this.style = { setProperty() {} }; this.classList = { add() {}, remove() {} }; this.textContent = ''; }
  setAttribute() {}
  addEventListener() {}
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
const textosDosAvisos = () => avisos.filhos.map((n) => n.filhos.map((f) => f.textContent).join(' '));

/* O servidor de mentira: cada chamada consome uma resposta da fila. */
let fila = [];
let chamadas = 0;
const json = (status, corpo) => ({ status, ok: status < 400, headers: { get: () => 'application/json; charset=utf-8' }, text: async () => JSON.stringify(corpo) });
const html = (status) => ({ status, ok: false, headers: { get: () => 'text/html' }, text: async () => '<html>Bad Gateway</html>' });
globalThis.fetch = async () => {
  chamadas += 1;
  const proxima = fila.shift();
  if (proxima === 'rede') throw new TypeError('Failed to fetch');
  return proxima;
};

const { api } = await import(${url('web/js/api.js')});
const resultado = {};

fila = ['rede', html(502), json(200, { ok: 1 })];
chamadas = 0;
resultado.leitura = { dados: await api.get('/api/contatos'), chamadas };

fila = ['rede'];
chamadas = 0;
try { await api.post('/api/contatos/c1/mensagens', { conteudo: 'oi' }); resultado.envio = 'passou'; }
catch (erro) { resultado.envio = { erro: erro.message, chamadas }; }

fila = [json(502, { erro: 'Nao consegui gerar o audio agora.' })];
chamadas = 0;
try { await api.get('/api/vozes/x/amostra'); resultado.erroDoSistema = 'passou'; }
catch (erro) { resultado.erroDoSistema = { erro: erro.message, chamadas }; }

/* O tempo real: o servidor reinicia, a conexao fecha de vez, e volta. */
const fontes = [];
globalThis.EventSource = class {
  static CLOSED = 2;
  constructor(endereco) { this.endereco = endereco; this.readyState = 0; fontes.push(this); }
  addEventListener() {}
  close() { this.readyState = 2; }
};
const { conectarEventos, ouvir } = await import(${url('web/js/estado.js')});
let recarregou = 0;
ouvir('contatos', () => { recarregou += 1; });
conectarEventos();
fontes[0].readyState = 2;
fontes[0].onerror();
await new Promise((r) => setTimeout(r, 1300));
const religou = fontes.length;
await new Promise((r) => setTimeout(r, 4200));
const avisouAQueda = textosDosAvisos().some((t) => /caiu/.test(t));
fontes[1].readyState = 1;
fontes[1].onopen();
resultado.tempoReal = { religou, avisouAQueda, recarregou, avisouAVolta: textosDosAvisos().some((t) => /restabelecida/.test(t)) };
console.log(JSON.stringify(resultado));
process.exit(0);
`,
    );
    const r3 = await rodar(tela, pasta);
    if (s.ok('a tela de mentira roda sem erro', r3.codigo === 0, r3.texto.slice(-600))) {
      const t = JSON.parse(r3.texto.trim().split('\n').pop());
      s.ok('leitura com o servidor fora tenta de novo sozinha e chega', t.leitura.dados?.ok === 1 && t.leitura.chamadas === 3, JSON.stringify(t.leitura));
      s.ok(
        'envio com o servidor fora NAO tenta de novo, e diz o que fazer',
        t.envio?.chamadas === 1 && /reiniciando/.test(t.envio?.erro || ''),
        JSON.stringify(t.envio),
      );
      s.ok('erro de verdade do sistema nao e confundido com servidor fora', t.erroDoSistema?.chamadas === 1 && /audio/.test(t.erroDoSistema?.erro || ''), JSON.stringify(t.erroDoSistema));
      s.ok(
        'o tempo real fechado de vez se religa, e ao voltar a tela recarrega e avisa',
        t.tempoReal.religou === 2 && t.tempoReal.avisouAQueda && t.tempoReal.recarregou === 1 && t.tempoReal.avisouAVolta,
        JSON.stringify(t.tempoReal),
      );
    }
  } finally {
    fs.rmSync(pasta, { recursive: true, force: true });
  }
  return s;
}

/**
 * No servidor de teste no ar: a batida leve que a hospedagem confere
 * (/api/vivo, sem sessao) e a saude com as subidas e as falhas da subida.
 */
export async function testarBatidaDaHospedagem({ base }) {
  const s = suite('A hospedagem confere uma batida leve, e a saude conta as subidas');
  const vivo = await fetch(`${base}/api/vivo`);
  const corpo = await vivo.json().catch(() => null);
  s.ok('/api/vivo responde sem sessao', vivo.status === 200 && corpo?.ok === true, `${vivo.status} ${JSON.stringify(corpo)}`);
  const saude = await (await fetch(`${base}/api/saude`)).json();
  s.ok(
    'a saude traz a subida de agora e as falhas da subida (nenhuma)',
    Array.isArray(saude.vida?.subidas) && saude.vida.subidas.length >= 1 && saude.vida.subidas[0].codigo === saude.codigo && Array.isArray(saude.falhasNaSubida) && saude.falhasNaSubida.length === 0,
    JSON.stringify({ vida: saude.vida, falhasNaSubida: saude.falhasNaSubida }),
  );
  return s;
}
