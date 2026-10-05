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
 * desligado, e rodar duas vezes nao duplica nada.
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
    s.ok('cadastra as duas vozes', b.vozes.length === 2 && b.vozes.some((v) => v.vozBase === 'shimmer') && b.vozes.some((v) => v.vozBase === 'nova'), JSON.stringify(b.vozes));
    const acolhedora = b.vozes.find((v) => v.nome === 'Acolhedora');
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

    const denovo = await rodar(ferramenta, ['--aplicar']);
    const c = await lerBase();
    s.ok('rodar de novo nao muda nada', JSON.stringify(c) === JSON.stringify(b), denovo.texto.slice(-300));
    s.ok('e nao duplica a voz', c.vozes.length === 2, String(c.vozes.length));
  } finally {
    fs.rmSync(pasta, { recursive: true, force: true });
  }
  return s;
}
