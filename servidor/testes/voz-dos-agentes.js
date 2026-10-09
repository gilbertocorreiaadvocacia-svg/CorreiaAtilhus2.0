import { spawn } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

import { suite } from './apoio.js';

/**
 * `npm run voz-dos-agentes`: cadastra as vozes e ensina os agentes a falar.
 *
 * O que nao pode falhar: simular nao grava; aplicar cadastra as vozes so
 * quando o escritorio nao tem nenhuma, escolhe voz so para quem nao tem,
 * acrescenta a regra do CANAL DE VOZ so onde falta (e a de voltar ao texto so
 * onde so falta ela), deixa a Avaliacao em paz, nao encosta em agente
 * desligado, e rodar duas vezes nao duplica nada. E, o achado de 08/10/2026:
 * passa em TODO workspace da base, nao so no primeiro — a versao antiga so
 * olhava listar('workspaces')[0] e nunca chegava nos agentes de um segundo
 * escritorio.
 */
export async function testarVozDosAgentes({ raiz }) {
  const s = suite('Voz dos agentes (ferramenta)');
  const urlDoBanco = pathToFileURL(path.join(raiz, 'servidor/nucleo/banco.js')).href;
  const pasta = fs.mkdtempSync(path.join(os.tmpdir(), 'voz-agentes-'));

  const rodar = (arquivo, args = []) =>
    new Promise((resolve) => {
      const p = spawn(process.execPath, [arquivo, ...args], {
        env: { ...process.env, CORREIA_DADOS: pasta },
        stdio: ['ignore', 'pipe', 'pipe'],
      });
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
inserir('agentes', { id: 'a-rec', workspaceId: 'w1', nome: 'Recepcao', ativo: true, prompt: 'Receba o cliente.', vozId: null });
inserir('agentes', { id: 'a-trab', workspaceId: 'w1', nome: 'AG01 trab', ativo: true, prompt: 'Triagem. Se nao sabe ler, use @ativaraudio.', vozId: null });
inserir('agentes', { id: 'a-ok', workspaceId: 'w1', nome: 'Ja pronto', ativo: true, prompt: 'Use @ativaraudio e @desativaraudio.', vozId: 'voz-propria' });
inserir('agentes', { id: 'a-aval', workspaceId: 'w1', nome: 'Avaliação · Trabalhista', ativo: true, prompt: 'Pergunte a nota.', vozId: null });
inserir('agentes', { id: 'a-off', workspaceId: 'w1', nome: 'Desligado', ativo: false, prompt: 'Nada.', vozId: null });
inserir('workspaces', { id: 'w2', nome: 'Segundo escritorio' });
inserir('agentes', { id: 'a-w2', workspaceId: 'w2', nome: 'Triagem do segundo', ativo: true, prompt: 'Receba o cliente do outro escritorio.', vozId: null });
await encerrarBanco();
`,
  );
  const lerBase = async () => {
    const dump = path.join(pasta, 'ler.mjs');
    fs.writeFileSync(
      dump,
      `import { iniciarBanco, listar } from ${JSON.stringify(urlDoBanco)};
iniciarBanco();
console.log(JSON.stringify({ agentes: listar('agentes'), vozes: listar('vozes') }));
process.exit(0);
`,
    );
    const r = await rodar(dump);
    return JSON.parse(r.texto.trim().split('\n').pop());
  };

  try {
    const m = await rodar(montagem);
    if (!s.ok('a base descartavel foi montada', m.codigo === 0, m.texto.slice(-300))) return s;
    const ferramenta = path.join(raiz, 'servidor/ferramentas/voz-dos-agentes.js');
    const por = (b, id) => b.agentes.find((a) => a.id === id);

    const simulado = await rodar(ferramenta);
    let b = await lerBase();
    s.ok('simular termina sem erro e diz o que faria', simulado.codigo === 0 && /Recepcao/.test(simulado.texto), simulado.texto.slice(-400));
    s.ok('simular nao grava nada', b.vozes.length === 0 && !por(b, 'a-rec').vozId && por(b, 'a-rec').prompt === 'Receba o cliente.', JSON.stringify(b.vozes));

    const aplicado = await rodar(ferramenta, ['--aplicar']);
    b = await lerBase();
    s.ok('aplicar termina sem erro', aplicado.codigo === 0, aplicado.texto.slice(-400));
    const vozesDoW1 = b.vozes.filter((v) => v.workspaceId === 'w1');
    s.ok('cadastra as duas vozes', vozesDoW1.length === 2 && vozesDoW1.some((v) => v.vozBase === 'shimmer') && vozesDoW1.some((v) => v.vozBase === 'nova'), JSON.stringify(vozesDoW1));
    const acolhedora = vozesDoW1.find((v) => v.nome === 'Acolhedora');
    s.ok('a Acolhedora e um pouco mais lenta', acolhedora?.velocidade === 0.95, JSON.stringify(acolhedora));

    const rec = por(b, 'a-rec');
    s.ok('a Recepcao ganha a voz', rec.vozId === acolhedora.id, String(rec.vozId));
    s.ok(
      'e a regra de ligar e de desligar o audio',
      /@ativaraudio/.test(rec.prompt) && /@desativaraudio/.test(rec.prompt) && rec.prompt.startsWith('Receba o cliente.'),
      rec.prompt,
    );
    const trab = por(b, 'a-trab');
    s.ok('quem so tem a regra de ligar ganha so a de voltar ao texto', /@desativaraudio/.test(trab.prompt) && trab.prompt.split('@ativaraudio').length === 2, trab.prompt);
    s.ok('quem ja estava pronto nao muda', por(b, 'a-ok').vozId === 'voz-propria' && por(b, 'a-ok').prompt === 'Use @ativaraudio e @desativaraudio.', JSON.stringify(por(b, 'a-ok')));
    s.ok('a Avaliacao fica de fora', !por(b, 'a-aval').vozId && por(b, 'a-aval').prompt === 'Pergunte a nota.', JSON.stringify(por(b, 'a-aval')));
    s.ok('agente desligado nao e tocado', !por(b, 'a-off').vozId && por(b, 'a-off').prompt === 'Nada.', JSON.stringify(por(b, 'a-off')));

    /* O achado de 08/10/2026: um SEGUNDO workspace tambem precisa receber
       vozes proprias e o agente dele tambem precisa ganhar voz e regra. */
    const vozesDoW2 = b.vozes.filter((v) => v.workspaceId === 'w2');
    s.ok('o segundo escritorio ganha as proprias vozes', vozesDoW2.length === 2, JSON.stringify(vozesDoW2));
    const doW2 = por(b, 'a-w2');
    const acolhedoraDoW2 = vozesDoW2.find((v) => v.nome === 'Acolhedora');
    s.ok('o agente do segundo escritorio ganha voz', doW2.vozId === acolhedoraDoW2?.id, JSON.stringify(doW2));
    s.ok(
      'e a regra de voz, igual ao primeiro',
      /@ativaraudio/.test(doW2.prompt) && /@desativaraudio/.test(doW2.prompt),
      doW2.prompt,
    );

    const denovo = await rodar(ferramenta, ['--aplicar']);
    const c = await lerBase();
    s.ok('rodar de novo nao muda nada', JSON.stringify(c) === JSON.stringify(b), denovo.texto.slice(-300));
    s.ok('e nao duplica a voz em nenhum dos dois escritorios', c.vozes.length === 4, String(c.vozes.length));
  } finally {
    fs.rmSync(pasta, { recursive: true, force: true });
  }
  return s;
}

/**
 * `deduplicarVozes`: clique repetido no botao de cadastrar voz cria copias
 * identicas. O que nao pode falhar: mantem a mais antiga, remapeia quem
 * apontava para uma copia removida, nao mexe entre escritorios diferentes
 * (mesmo nome em dois escritorios nao e duplicata), e nao mexe em voz com
 * nome igual mas configuracao diferente (vozBase ou velocidade).
 */
export async function testarDeduplicarVozes({ raiz }) {
  const s = suite('Vozes duplicadas (dedup)');
  const urlDoBanco = pathToFileURL(path.join(raiz, 'servidor/nucleo/banco.js')).href;
  const urlDoModulo = pathToFileURL(path.join(raiz, 'servidor/nucleo/vozes-dos-agentes.js')).href;
  const pasta = fs.mkdtempSync(path.join(os.tmpdir(), 'dedup-vozes-'));

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
inserir('vozes', { id: 'v-original', workspaceId: 'w1', nome: 'Voz da triagem', vozBase: 'shimmer', velocidade: 1 });
inserir('vozes', { id: 'v-copia1', workspaceId: 'w1', nome: 'Voz da triagem', vozBase: 'shimmer', velocidade: 1 });
inserir('vozes', { id: 'v-copia2', workspaceId: 'w1', nome: 'Voz da triagem', vozBase: 'shimmer', velocidade: 1 });
inserir('vozes', { id: 'v-diferente', workspaceId: 'w1', nome: 'Voz da triagem', vozBase: 'nova', velocidade: 1 });
inserir('agentes', { id: 'a1', workspaceId: 'w1', nome: 'Triagem', vozId: 'v-copia2' });
inserir('workspaces', { id: 'w2', nome: 'Outro escritorio' });
inserir('vozes', { id: 'v-outro', workspaceId: 'w2', nome: 'Voz da triagem', vozBase: 'shimmer', velocidade: 1 });
await encerrarBanco();
`,
  );
  const rodarDedup = path.join(pasta, 'dedup.mjs');
  fs.writeFileSync(
    rodarDedup,
    `import { iniciarBanco, listar, encerrarBanco } from ${JSON.stringify(urlDoBanco)};
import { deduplicarVozes } from ${JSON.stringify(urlDoModulo)};
iniciarBanco();
const resultado = deduplicarVozes();
console.log(JSON.stringify({ resultado, vozes: listar('vozes'), agentes: listar('agentes') }));
await encerrarBanco();
process.exit(0);
`,
  );

  try {
    const m = await rodar(montagem);
    if (!s.ok('a base descartavel foi montada', m.codigo === 0, m.texto.slice(-300))) return s;

    const r1 = await rodar(rodarDedup);
    if (!s.ok('roda sem erro', r1.codigo === 0, r1.texto.slice(-400))) return s;
    const { resultado, vozes, agentes } = JSON.parse(r1.texto.trim().split('\n').pop());

    s.ok('remove as duas copias identicas', !vozes.some((v) => v.id === 'v-copia1') && !vozes.some((v) => v.id === 'v-copia2'), JSON.stringify(vozes.map((v) => v.id)));
    s.ok('mantem a original', vozes.some((v) => v.id === 'v-original'), JSON.stringify(vozes.map((v) => v.id)));
    s.ok('mantem a de configuracao diferente (vozBase nova)', vozes.some((v) => v.id === 'v-diferente'), JSON.stringify(vozes.map((v) => v.id)));
    s.ok('mantem a do outro escritorio, mesmo com o mesmo nome', vozes.some((v) => v.id === 'v-outro'), JSON.stringify(vozes.map((v) => v.id)));
    s.ok('remapeia o agente que apontava para a copia removida', agentes.find((a) => a.id === 'a1').vozId === 'v-original', agentes.find((a) => a.id === 'a1').vozId);
    s.ok('relata 2 removidas e 1 remapeada', resultado.removidas === 2 && resultado.remapeadas === 1, JSON.stringify(resultado));

    const r2 = await rodar(rodarDedup);
    const segunda = JSON.parse(r2.texto.trim().split('\n').pop());
    s.ok('rodar de novo nao acha mais duplicata nenhuma', segunda.resultado.removidas === 0, JSON.stringify(segunda.resultado));
  } finally {
    fs.rmSync(pasta, { recursive: true, force: true });
  }
  return s;
}
