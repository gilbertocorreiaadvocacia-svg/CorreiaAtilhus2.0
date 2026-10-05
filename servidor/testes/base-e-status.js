import { spawn } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

import { suite } from './apoio.js';

/**
 * `npm run base-e-status`: tira a "Quebra de objecoes" previdenciaria dos
 * agentes trabalhistas e poe departamento nos status de saida do funil.
 *
 * O que nao pode falhar: simular nao grava nada; aplicar mexe SO nos
 * trabalhistas (a cadeia previdenciaria continua com o item), SO nos status de
 * saida sem departamento (um status que ja tem dono nao muda), nao apaga o item
 * da base, e rodar duas vezes nao desfaz nem repete nada.
 */
export async function testarBaseEStatus({ raiz }) {
  const s = suite('Base de conhecimento e status de saida');
  const urlDoBanco = pathToFileURL(path.join(raiz, 'servidor/nucleo/banco.js')).href;
  const pasta = fs.mkdtempSync(path.join(os.tmpdir(), 'base-status-'));

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

  /* Monta a base descartavel num processo a parte, para o gravador sincronizar. */
  const montagem = path.join(pasta, 'montar.mjs');
  fs.writeFileSync(
    montagem,
    `import { iniciarBanco, inserir, encerrarBanco } from ${JSON.stringify(urlDoBanco)};
iniciarBanco();
inserir('workspaces', { id: 'w1', nome: 'Teste' });
inserir('departamentos', { id: 'd-com', workspaceId: 'w1', nome: 'Comercial' });
inserir('departamentos', { id: 'd-jur', workspaceId: 'w1', nome: 'Juridico' });
inserir('conhecimento', { id: 'k-quebra', workspaceId: 'w1', nome: 'Quebra de objeções', conteudo: 'x' });
inserir('conhecimento', { id: 'k-outro', workspaceId: 'w1', nome: 'Acidente de trabalho', conteudo: 'y' });
inserir('agentes', { id: 'a-trab', workspaceId: 'w1', nome: 'AG01', area: 'trabalhista', conhecimentoIds: ['k-quebra', 'k-outro'] });
inserir('agentes', { id: 'a-prev', workspaceId: 'w1', nome: 'Triagem BPC', area: 'previdenciario', conhecimentoIds: ['k-quebra'] });
inserir('status', { id: 's-des', workspaceId: 'w1', nome: 'Desistencia', tipo: 'desistencia', departamentoId: null });
inserir('status', { id: 's-dq', workspaceId: 'w1', nome: 'Desqualificado', tipo: 'desqualificado', departamentoId: null });
inserir('status', { id: 's-nq', workspaceId: 'w1', nome: 'Não Qualificado', tipo: 'nenhum', departamentoId: null });
inserir('status', { id: 's-jur', workspaceId: 'w1', nome: 'Em analise', tipo: 'analise', departamentoId: 'd-jur' });
inserir('status', { id: 's-livre', workspaceId: 'w1', nome: 'Lead frio', tipo: 'nenhum', departamentoId: null });
await encerrarBanco();
`,
  );
  const lerBase = async () => {
    const dump = path.join(pasta, 'ler.mjs');
    fs.writeFileSync(
      dump,
      `import { iniciarBanco, listar } from ${JSON.stringify(urlDoBanco)};
iniciarBanco();
console.log(JSON.stringify({ agentes: listar('agentes'), status: listar('status'), kb: listar('conhecimento') }));
process.exit(0);
`,
    );
    const r = await rodar(dump);
    return JSON.parse(r.texto.trim().split('\n').pop());
  };

  try {
    const m = await rodar(montagem);
    if (!s.ok('a base descartavel foi montada', m.codigo === 0, m.texto.slice(-300))) return s;
    const ferramenta = path.join(raiz, 'servidor/ferramentas/base-e-status.js');

    /* --- Simular nao grava ------------------------------------------- */
    const simulado = await rodar(ferramenta);
    let b = await lerBase();
    s.ok('simular termina sem erro', simulado.codigo === 0, simulado.texto.slice(-300));
    s.ok(
      'simular diz o que faria',
      /AG01/.test(simulado.texto) && /Desistencia/.test(simulado.texto) && /Nao Qualificado|Não Qualificado/.test(simulado.texto),
      simulado.texto.slice(-500),
    );
    s.ok(
      'simular nao grava nada',
      b.agentes.find((a) => a.id === 'a-trab').conhecimentoIds.length === 2 && b.status.filter((x) => !x.departamentoId).length === 4,
      JSON.stringify(b.status.map((x) => x.departamentoId)),
    );

    /* --- Aplicar ------------------------------------------------------ */
    const aplicado = await rodar(ferramenta, ['--aplicar']);
    b = await lerBase();
    s.ok('aplicar termina sem erro', aplicado.codigo === 0, aplicado.texto.slice(-300));
    const trab = b.agentes.find((a) => a.id === 'a-trab');
    const prev = b.agentes.find((a) => a.id === 'a-prev');
    s.ok(
      'o trabalhista perde a Quebra de objecoes e fica com o resto',
      JSON.stringify(trab.conhecimentoIds) === JSON.stringify(['k-outro']),
      JSON.stringify(trab.conhecimentoIds),
    );
    s.ok('o previdenciario continua com ela', JSON.stringify(prev.conhecimentoIds) === JSON.stringify(['k-quebra']), JSON.stringify(prev.conhecimentoIds));
    s.ok('o item nao e apagado da base', b.kb.some((k) => k.id === 'k-quebra'), b.kb.map((k) => k.id).join(','));

    const dep = (id) => b.status.find((x) => x.id === id).departamentoId;
    s.ok('Desistencia, Desqualificado e Nao Qualificado vao para o Comercial', ['s-des', 's-dq', 's-nq'].every((id) => dep(id) === 'd-com'), JSON.stringify(b.status.map((x) => [x.nome, x.departamentoId])));
    s.ok('status que ja tinha dono nao muda', dep('s-jur') === 'd-jur', String(dep('s-jur')));
    s.ok('status que nao e de saida nao ganha dono por tabela', !dep('s-livre'), String(dep('s-livre')));

    /* --- Idempotente -------------------------------------------------- */
    const denovo = await rodar(ferramenta, ['--aplicar']);
    const c = await lerBase();
    s.ok('rodar de novo nao muda nada', JSON.stringify(c) === JSON.stringify(b), denovo.texto.slice(-300));
    s.ok('e avisa que ja estava feito', /ja estava feito|nenhum/.test(denovo.texto), denovo.texto.slice(-300));
  } finally {
    fs.rmSync(pasta, { recursive: true, force: true });
  }
  return s;
}
