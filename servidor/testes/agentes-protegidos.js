import { spawn } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

import { esperar, esperarNoAr, suite } from './apoio.js';

/**
 * A IA nunca liga nem desliga sozinha (nucleo/banco.js: protegerEstadoDosAgentes).
 * Pedido do escritorio em 30/10/2026, depois de a IA "ligar sozinha" depois de
 * um "Desligar todos" (27/10/2026): o estado ligado/desligado de um agente so
 * muda por ordem de quem usa o sistema.
 *
 * Tres provas:
 *   1. a trava, no banco: com ela ligada, ligar ou desligar um agente fora de
 *      uma ordem do usuario nao pega (o resto da mudanca pega), o agente novo
 *      que o sistema cria nasce desligado, os instaladores de verdade (pacote,
 *      triagem do escritorio geral) deixam tudo desligado, a tentativa fica
 *      anotada uma vez, e dentro de comOrdemDoUsuario tudo vale;
 *   2. escritoriosSemAgenteLigado so avisa, nunca liga (era ativarAgentesSemEquipe);
 *   3. de ponta a ponta: o sistema de verdade, subindo numa base com numero
 *      conectado e TODOS os agentes desligados (o estado em que ele religava
 *      tudo no boot), sobe e continua com todos desligados.
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

export async function testarAgentesProtegidos({ raiz, portaLivre }) {
  const s = suite('A IA nunca liga nem desliga sozinha');
  const url = (arquivo) => JSON.stringify(pathToFileURL(path.join(raiz, arquivo)).href);
  const pastas = [];
  const vivos = [];
  const novaPasta = () => {
    const pasta = fs.mkdtempSync(path.join(os.tmpdir(), 'agentes-protegidos-'));
    pastas.push(pasta);
    return pasta;
  };

  try {
    /* ---------------- 1 e 2. A trava, no banco ---------------- */
    const pasta = novaPasta();
    const script = path.join(pasta, 'trava.mjs');
    fs.writeFileSync(
      script,
      `import { iniciarBanco, achar, atualizar, inserir, listar, comOrdemDoUsuario, protegerEstadoDosAgentes, situacaoDaProtecaoDosAgentes, encerrarBanco } from ${url('servidor/nucleo/banco.js')};
import { escritoriosSemAgenteLigado, garantirTriagemNoEscritorioGeral, instalarPacote } from ${url('servidor/nucleo/agentes-por-escritorio.js')};
import { PACOTES } from ${url('servidor/ia/pacotes.js')};
iniciarBanco();
inserir('workspaces', { id: 'w1', nome: 'Escritorio Um' });
inserir('workspaces', { id: 'w2', nome: 'Escritorio Dois' });
inserir('conexoes', { id: 'cx1', workspaceId: 'w1', tipo: 'qrcode', nome: 'WhatsApp' });
inserir('conexoes', { id: 'cx2', workspaceId: 'w2', tipo: 'qrcode', nome: 'WhatsApp 2' });
inserir('agentes', { id: 'a-off', workspaceId: 'w1', nome: 'Agente Desligado', objetivo: 'atender', ativo: false });
inserir('agentes', { id: 'a-on', workspaceId: 'w1', nome: 'Agente Ligado', objetivo: 'atender', ativo: true });
const estado = (id) => achar('agentes', id)?.ativo;
const resultado = {};

/* Sem a protecao ligada (ferramentas e testes), tudo como sempre foi. */
atualizar('agentes', 'a-off', { ativo: true });
resultado.antesDaProtecao = estado('a-off');
atualizar('agentes', 'a-off', { ativo: false });

protegerEstadoDosAgentes();

/* Fora de uma ordem do usuario: o ativo nao pega, o resto da mudanca pega. */
atualizar('agentes', 'a-off', { ativo: true, nome: 'Agente Renomeado' });
resultado.ligarSozinho = { ativo: estado('a-off'), nome: achar('agentes', 'a-off').nome };
atualizar('agentes', 'a-on', { ativo: false });
resultado.desligarSozinho = estado('a-on');
const barradasAteAqui = situacaoDaProtecaoDosAgentes().barradasDesdeASubida;

/* Mesmo valor: nao e mudanca de estado, nao conta como tentativa. */
atualizar('agentes', 'a-on', { ativo: true, prompt: 'novo texto' });
resultado.mesmoValorNaoConta = situacaoDaProtecaoDosAgentes().barradasDesdeASubida === barradasAteAqui && achar('agentes', 'a-on').prompt === 'novo texto';

/* Agente novo criado pelo sistema nasce desligado. */
resultado.novoLigado = inserir('agentes', { id: 'a-novo', workspaceId: 'w1', nome: 'Novo', ativo: true }).ativo;

/* Os instaladores de verdade. */
resultado.pacote = instalarPacote({ workspaceId: 'w2', area: 'previdenciario', pacote: PACOTES.previdenciario, ligar: true });
resultado.ligadosDepoisDoPacote = listar('agentes', { workspaceId: 'w2' }).filter((a) => a.ativo).length;
resultado.criadosPeloPacote = listar('agentes', { workspaceId: 'w2' }).length;
/* Instalar por cima de um agente que a pessoa desligou nao o liga. */
const eduarda = listar('agentes', { workspaceId: 'w2' })[0];
instalarPacote({ workspaceId: 'w2', area: 'previdenciario', pacote: PACOTES.previdenciario, ligar: true });
resultado.reinstalarNaoLiga = estado(eduarda.id);
garantirTriagemNoEscritorioGeral();
resultado.triagemDoGeral = { total: listar('agentes', { workspaceId: 'w1' }).length, ligados: listar('agentes', { workspaceId: 'w1' }).filter((a) => a.ativo).length };

/* So avisa, nunca liga. */
const aviso = escritoriosSemAgenteLigado();
resultado.avisoDeSemAgente = aviso.map((a) => a.escritorio);
resultado.avisoNaoLigou = listar('agentes', { workspaceId: 'w2' }).filter((a) => a.ativo).length === 0;

/* A tentativa fica anotada uma vez so por agente e direcao. */
atualizar('agentes', 'a-off', { ativo: true });
atualizar('agentes', 'a-off', { ativo: true });
resultado.logsDoAgente = listar('logs', { workspaceId: 'w1', tipo: 'seguranca' }).filter((l) => /Agente (Desligado|Renomeado)/.test(l.descricao) && /de ligar sozinho/.test(l.descricao)).length;
const situacao = situacaoDaProtecaoDosAgentes();
resultado.situacao = { ligada: situacao.ligada, total: situacao.barradasDesdeASubida, temOnde: situacao.ultimas.every((u) => u.onde && !/file:\\/\\//.test(u.onde)), ultima: situacao.ultimas.at(-1) };

/* Por ordem do usuario, vale. */
comOrdemDoUsuario(() => atualizar('agentes', 'a-off', { ativo: true }));
resultado.ligadoPeloUsuario = estado('a-off');
comOrdemDoUsuario(() => atualizar('agentes', 'a-on', { ativo: false }));
resultado.desligadoPeloUsuario = estado('a-on');
resultado.criadoPeloUsuario = comOrdemDoUsuario(() => inserir('agentes', { id: 'a-do-usuario', workspaceId: 'w1', nome: 'Criado na tela', ativo: true })).ativo;
/* E a ordem acaba: o que vem depois volta a ser barrado. */
atualizar('agentes', 'a-off', { ativo: false });
resultado.depoisDaOrdem = estado('a-off');

console.log(JSON.stringify(resultado));
await encerrarBanco();
process.exit(0);
`,
    );
    const r1 = await rodar(script, pasta);
    if (s.ok('a trava roda sem erro', r1.codigo === 0, r1.texto.slice(-700))) {
      const b = JSON.parse(r1.texto.trim().split('\n').pop());
      s.ok('sem a protecao ligada (ferramentas, testes), nada muda', b.antesDaProtecao === true, String(b.antesDaProtecao));
      s.ok(
        'ligar sozinho nao pega, mas o resto da mudanca pega',
        b.ligarSozinho.ativo === false && b.ligarSozinho.nome === 'Agente Renomeado',
        JSON.stringify(b.ligarSozinho),
      );
      s.ok('desligar sozinho tambem nao pega', b.desligarSozinho === true, String(b.desligarSozinho));
      s.ok('repetir o mesmo valor nao e mudanca de estado', b.mesmoValorNaoConta === true);
      s.ok('agente novo criado pelo sistema nasce desligado', b.novoLigado === false, String(b.novoLigado));
      s.ok(
        'o pacote instalado por ligar:true cria os agentes e nenhum liga',
        b.criadosPeloPacote > 5 && b.ligadosDepoisDoPacote === 0,
        JSON.stringify({ criados: b.criadosPeloPacote, ligados: b.ligadosDepoisDoPacote }),
      );
      s.ok('instalar de novo por cima nao liga o que a pessoa desligou', b.reinstalarNaoLiga === false, String(b.reinstalarNaoLiga));
      s.ok(
        'a triagem do escritorio geral instala e deixa tudo desligado',
        b.triagemDoGeral.total > 2 && b.triagemDoGeral.ligados === 1,
        JSON.stringify(b.triagemDoGeral),
      );
      s.ok(
        'escritoriosSemAgenteLigado so avisa, e nao liga ninguem',
        b.avisoDeSemAgente.includes('Escritorio Dois') && b.avisoNaoLigou === true,
        JSON.stringify({ aviso: b.avisoDeSemAgente, naoLigou: b.avisoNaoLigou }),
      );
      s.ok('a tentativa fica anotada uma vez so por agente', b.logsDoAgente === 1, String(b.logsDoAgente));
      s.ok(
        'e a saude sabe quantas foram barradas e de onde vieram',
        b.situacao.ligada === true && b.situacao.total >= 6 && b.situacao.temOnde && b.situacao.ultima?.queria === 'ligar',
        JSON.stringify(b.situacao),
      );
      s.ok(
        'por ordem do usuario, ligar, desligar e criar ligado valem',
        b.ligadoPeloUsuario === true && b.desligadoPeloUsuario === false && b.criadoPeloUsuario === true,
        JSON.stringify([b.ligadoPeloUsuario, b.desligadoPeloUsuario, b.criadoPeloUsuario]),
      );
      s.ok('e a ordem acaba com a chamada: o que vem depois volta a ser barrado', b.depoisDaOrdem === true, String(b.depoisDaOrdem));
    }

    /* ---------------- 3. De ponta a ponta: o sistema de verdade sobe e nao liga nada ---------------- */
    const dados = novaPasta();
    const subir = async () => {
      const porta = await portaLivre();
      const processo = spawn(process.execPath, [path.join(raiz, 'servidor/index.js')], {
        env: {
          ...process.env,
          PORTA: String(porta),
          CORREIA_DADOS: dados,
          CORREIA_HOST: '127.0.0.1',
          CORREIA_EVOLUTION_ENV: path.join(dados, 'sem-evolution.env'),
          ANTHROPIC_API_KEY: '',
          OPENAI_API_KEY: '',
        },
        stdio: ['ignore', 'pipe', 'pipe'],
      });
      vivos.push(processo);
      let saida = '';
      processo.stdout.on('data', (d) => (saida += d));
      processo.stderr.on('data', (d) => (saida += d));
      const noAr = await esperarNoAr(`http://127.0.0.1:${porta}/api/saude`);
      return { processo, porta, noAr, saida: () => saida };
    };
    const saudeDe = async (porta) => {
      for (let i = 0; i < 40; i += 1) {
        const saude = await (await fetch(`http://127.0.0.1:${porta}/api/saude`)).json();
        const escritorio = (saude.varredura?.escritorios || []).find((e) => e.numeros >= 1);
        if (escritorio) return { saude, escritorio };
        await esperar(250);
      }
      return { saude: null, escritorio: null };
    };

    /* A primeira subida semeia a base. Depois, o estado que religava tudo:
       numero conectado de verdade e TODOS os agentes desligados. */
    const primeira = await subir();
    if (!s.ok('o sistema sobe e semeia a base', primeira.noAr, primeira.saida().slice(-400))) return s;
    await esperar(800);
    primeira.processo.kill();
    await esperar(600);

    const preparar = path.join(dados, 'preparar.mjs');
    fs.writeFileSync(
      preparar,
      `import { iniciarBanco, atualizar, inserir, listar, encerrarBanco } from ${url('servidor/nucleo/banco.js')};
iniciarBanco();
const workspace = listar('workspaces')[0];
for (const agente of listar('agentes')) atualizar('agentes', agente.id, { ativo: false });
inserir('conexoes', { id: 'cx-real', workspaceId: workspace.id, tipo: 'qrcode', nome: 'WhatsApp de verdade', estado: 'conectado' });
inserir('logs', { workspaceId: workspace.id, contatoId: null, tipo: 'seguranca', descricao: 'Desligou todos os agentes de IA (1)' });
console.log(JSON.stringify({ agentes: listar('agentes').length, ligados: listar('agentes').filter((a) => a.ativo).length }));
await encerrarBanco();
process.exit(0);
`,
    );
    const r2 = await rodar(preparar, dados);
    const antes = r2.codigo === 0 ? JSON.parse(r2.texto.trim().split('\n').pop()) : null;
    if (!s.ok('a base de teste fica com numero conectado e todos os agentes desligados', antes?.agentes >= 1 && antes?.ligados === 0, r2.texto.slice(-400))) return s;

    const segunda = await subir();
    if (!s.ok('o sistema sobe de novo, nesse estado', segunda.noAr, segunda.saida().slice(-400))) return s;
    const { saude, escritorio } = await saudeDe(segunda.porta);
    s.ok('a varredura do boot enxerga o escritorio', Boolean(escritorio), segunda.saida().slice(-400));
    s.ok(
      'depois do boot, TODOS os agentes continuam desligados (ate 30/10/2026 o boot religava)',
      escritorio?.agentesLigados === 0,
      JSON.stringify({ ligados: escritorio?.agentesLigados }),
    );
    s.ok(
      'e a saude diz que a protecao esta ligada',
      saude?.protecaoDosAgentes?.ligada === true,
      JSON.stringify(saude?.protecaoDosAgentes),
    );
    s.ok(
      'o boot nao anuncia que ligou agente nenhum',
      !/Agentes ativados por falta de equipe/.test(segunda.saida()),
      segunda.saida().slice(-500),
    );
  } finally {
    for (const processo of vivos) {
      try {
        processo.kill();
      } catch {
        /* ja saiu */
      }
    }
    await esperar(300);
    for (const pasta of pastas) fs.rmSync(pasta, { recursive: true, force: true });
  }
  return s;
}
