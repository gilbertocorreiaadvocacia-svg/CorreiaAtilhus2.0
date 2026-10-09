import { spawn } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

import { suite } from './apoio.js';

/**
 * `npm run base-e-status`: tira a "Quebra de objecoes" previdenciaria dos
 * agentes trabalhistas, poe um rascunho trabalhista no lugar e departamento
 * nos status de saida do funil.
 *
 * O que nao pode falhar: simular nao grava nada; aplicar mexe SO nos
 * trabalhistas (a cadeia previdenciaria continua com o item original), cria
 * o rascunho SO uma vez por escritorio e vincula SO quem ainda nao tem, SO
 * nos status de saida sem departamento (um status que ja tem dono nao muda),
 * nao apaga o item original da base, roda duas vezes sem desfazer nem
 * repetir nada, e — o achado de 08/10/2026 — passa em TODO workspace da
 * base, nao so no primeiro.
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
inserir('agentes', { id: 'a-trab2', workspaceId: 'w1', nome: 'AG06', area: 'trabalhista', conhecimentoIds: ['k-outro'] });
inserir('agentes', { id: 'a-prev', workspaceId: 'w1', nome: 'Triagem BPC', area: 'previdenciario', conhecimentoIds: ['k-quebra'] });
inserir('status', { id: 's-des', workspaceId: 'w1', nome: 'Desistencia', tipo: 'desistencia', departamentoId: null });
inserir('status', { id: 's-dq', workspaceId: 'w1', nome: 'Desqualificado', tipo: 'desqualificado', departamentoId: null });
inserir('status', { id: 's-nq', workspaceId: 'w1', nome: 'Não Qualificado', tipo: 'nenhum', departamentoId: null });
inserir('status', { id: 's-jur', workspaceId: 'w1', nome: 'Em analise', tipo: 'analise', departamentoId: 'd-jur' });
inserir('status', { id: 's-livre', workspaceId: 'w1', nome: 'Lead frio', tipo: 'nenhum', departamentoId: null });
inserir('workspaces', { id: 'w2', nome: 'Segundo escritorio' });
inserir('departamentos', { id: 'd-com2', workspaceId: 'w2', nome: 'Comercial' });
inserir('agentes', { id: 'a-trab-w2', workspaceId: 'w2', nome: 'Triagem do segundo', area: 'trabalhista', conhecimentoIds: [] });
inserir('status', { id: 's-dq2', workspaceId: 'w2', nome: 'Desqualificado', tipo: 'desqualificado', departamentoId: null });
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
    const por = (b, id) => b.agentes.find((a) => a.id === id);

    /* --- Simular nao grava ------------------------------------------- */
    const simulado = await rodar(ferramenta);
    let b = await lerBase();
    s.ok('simular termina sem erro', simulado.codigo === 0, simulado.texto.slice(-300));
    s.ok(
      'simular diz o que faria',
      /AG01/.test(simulado.texto) && /Desistencia/.test(simulado.texto) && /Nao Qualificado|Não Qualificado/.test(simulado.texto) && /rascunho/i.test(simulado.texto),
      simulado.texto.slice(-500),
    );
    s.ok(
      'simular nao grava nada',
      por(b, 'a-trab').conhecimentoIds.length === 2 && b.status.filter((x) => !x.departamentoId).length === 5 && b.kb.length === 2,
      JSON.stringify(b.status.map((x) => x.departamentoId)),
    );

    /* --- Aplicar ------------------------------------------------------ */
    const aplicado = await rodar(ferramenta, ['--aplicar']);
    b = await lerBase();
    s.ok('aplicar termina sem erro', aplicado.codigo === 0, aplicado.texto.slice(-300));
    const trab = por(b, 'a-trab');
    const prev = por(b, 'a-prev');
    const rascunho = b.kb.find((k) => k.nome === 'Quebra de objeções · Trabalhista (rascunho)');
    s.ok('o rascunho trabalhista e criado', Boolean(rascunho), b.kb.map((k) => k.nome).join(' | '));
    s.ok('com o aviso de revisar antes de confiar', /revisar com um advogado/i.test(rascunho?.conteudo || ''), rascunho?.conteudo?.slice(0, 200));
    s.ok(
      'o trabalhista perde a Quebra de objecoes previdenciaria e ganha o rascunho',
      JSON.stringify(trab.conhecimentoIds) === JSON.stringify(['k-outro', rascunho.id]),
      JSON.stringify(trab.conhecimentoIds),
    );
    s.ok(
      'o segundo agente trabalhista do MESMO escritorio tambem ganha o rascunho (mesmo sem ter a antiga)',
      JSON.stringify(por(b, 'a-trab2').conhecimentoIds) === JSON.stringify(['k-outro', rascunho.id]),
      JSON.stringify(por(b, 'a-trab2').conhecimentoIds),
    );
    s.ok('o previdenciario continua com a Quebra de objecoes original', JSON.stringify(prev.conhecimentoIds) === JSON.stringify(['k-quebra']), JSON.stringify(prev.conhecimentoIds));
    s.ok('o item previdenciario nao e apagado da base', b.kb.some((k) => k.id === 'k-quebra'), b.kb.map((k) => k.id).join(','));

    const dep = (id) => b.status.find((x) => x.id === id).departamentoId;
    s.ok('Desistencia, Desqualificado e Nao Qualificado vao para o Comercial', ['s-des', 's-dq', 's-nq'].every((id) => dep(id) === 'd-com'), JSON.stringify(b.status.map((x) => [x.nome, x.departamentoId])));
    s.ok('status que ja tinha dono nao muda', dep('s-jur') === 'd-jur', String(dep('s-jur')));
    s.ok('status que nao e de saida nao ganha dono por tabela', !dep('s-livre'), String(dep('s-livre')));

    /* O achado de 08/10/2026: o SEGUNDO escritorio tambem precisa ganhar o
       rascunho trabalhista proprio e o status de saida com departamento. */
    const rascunhoW2 = b.kb.find((k) => k.workspaceId === 'w2');
    s.ok('o segundo escritorio ganha o proprio rascunho trabalhista', Boolean(rascunhoW2) && rascunhoW2.nome === 'Quebra de objeções · Trabalhista (rascunho)', JSON.stringify(rascunhoW2));
    s.ok(
      'e o agente dele e vinculado',
      JSON.stringify(por(b, 'a-trab-w2').conhecimentoIds) === JSON.stringify([rascunhoW2?.id]),
      JSON.stringify(por(b, 'a-trab-w2').conhecimentoIds),
    );
    s.ok('o Desqualificado do segundo escritorio tambem ganha departamento', dep('s-dq2') === 'd-com2', String(dep('s-dq2')));

    /* --- Idempotente -------------------------------------------------- */
    const denovo = await rodar(ferramenta, ['--aplicar']);
    const c = await lerBase();
    s.ok('rodar de novo nao muda nada', JSON.stringify(c) === JSON.stringify(b), denovo.texto.slice(-300));
    s.ok('e nao duplica o rascunho em nenhum dos dois escritorios', c.kb.filter((k) => k.nome === 'Quebra de objeções · Trabalhista (rascunho)').length === 2, String(c.kb.length));
  } finally {
    fs.rmSync(pasta, { recursive: true, force: true });
  }
  return s;
}
