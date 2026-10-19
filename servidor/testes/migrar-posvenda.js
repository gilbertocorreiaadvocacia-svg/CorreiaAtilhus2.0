import { spawn } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

import { suite } from './apoio.js';

/**
 * `migrarDepartamentoPosVenda` (servidor/nucleo/agentes-por-escritorio.js):
 * remove o departamento "Pós-venda" que ja existia de antes desta mudanca
 * (pedido do escritorio em 19/10/2026: so Comercial), sem deixar nenhuma
 * referencia orfa para tras.
 *
 * O que nao pode falhar: contato, status, a conexao com departamento padrao
 * em Pós-venda e o escopo de departamentos de um membro passam todos para
 * Comercial (criado se faltar) ANTES do departamento antigo ser removido;
 * a integracao do ZapSign (posAssinatura.departamentoId) tambem; um membro
 * com departamentos: ['*'] (acesso total) nao e tocado; workspace sem
 * "Pós-venda" nenhum fica igual; rodar duas vezes nao faz nada a mais.
 */
export async function testarMigrarDepartamentoPosVenda({ raiz }) {
  const s = suite('Departamento "Pós-venda" removido, tudo passa para Comercial');
  const urlDoBanco = pathToFileURL(path.join(raiz, 'servidor/nucleo/banco.js')).href;
  const urlDoModulo = pathToFileURL(path.join(raiz, 'servidor/nucleo/agentes-por-escritorio.js')).href;
  const pasta = fs.mkdtempSync(path.join(os.tmpdir(), 'migrar-posvenda-'));

  const rodar = (arquivo) =>
    new Promise((resolve) => {
      const p = spawn(process.execPath, [arquivo], { env: { ...process.env, CORREIA_DADOS: pasta }, stdio: ['ignore', 'pipe', 'pipe'] });
      let texto = '';
      p.stdout.on('data', (d) => (texto += d));
      p.stderr.on('data', (d) => (texto += d));
      p.on('close', (codigo) => resolve({ codigo, texto }));
    });

  const urlDoSeed = pathToFileURL(path.join(raiz, 'servidor/nucleo/seed.js')).href;
  const montagem = path.join(pasta, 'montar.mjs');
  fs.writeFileSync(
    montagem,
    `import { iniciarBanco, inserir, listar, encerrarBanco } from ${JSON.stringify(urlDoBanco)};
import { semearSePrecisar } from ${JSON.stringify(urlDoSeed)};
iniciarBanco();
/* O proprio seed, num banco vazio: workspace novo nao pode nascer com
   departamento "Pós-venda" nenhum (so Comercial, Juridico, Financeiro). */
semearSePrecisar();
/* w1: tem "Pós-venda" com de tudo apontando para ele. */
inserir('workspaces', { id: 'w1', nome: 'Com Pos-venda' });
inserir('departamentos', { id: 'dep-comercial', workspaceId: 'w1', nome: 'Comercial', cor: 'var(--serie-2)' });
inserir('departamentos', { id: 'dep-posvenda', workspaceId: 'w1', nome: 'Pós-venda', cor: 'var(--sucesso)' });
inserir('contatos', { id: 'c1', workspaceId: 'w1', telefone: '5581977770000', nome: 'Ana', departamentoId: 'dep-posvenda', etiquetas: [] });
inserir('contatos', { id: 'c2', workspaceId: 'w1', telefone: '5581988880000', nome: 'Beto', departamentoId: 'dep-comercial', etiquetas: [] });
inserir('status', { id: 's1', workspaceId: 'w1', nome: 'Contrato fechado', tipo: 'sucesso', departamentoId: 'dep-posvenda' });
inserir('conexoes', { id: 'conx1', workspaceId: 'w1', tipo: 'qrcode', departamentoPadraoId: 'dep-posvenda' });
inserir('membros', { id: 'mbr1', workspaceId: 'w1', usuarioId: 'u1', papel: 'equipe', departamentos: ['dep-posvenda', 'dep-comercial'] });
inserir('membros', { id: 'mbr2', workspaceId: 'w1', usuarioId: 'u2', papel: 'owner', departamentos: ['*'] });
inserir('integracoes', { id: 'int-w1', workspaceId: 'w1', zapsign: { chave: '', modelos: [], ativo: false, posAssinatura: { departamentoId: 'dep-posvenda', responsavel: { tipo: 'membro', id: 'mbr1', nome: 'Fulana' } } } });
/* w2: nunca teve "Pós-venda" — nao pode ser tocado. */
inserir('workspaces', { id: 'w2', nome: 'Sem Pos-venda' });
inserir('departamentos', { id: 'dep-comercial-w2', workspaceId: 'w2', nome: 'Comercial', cor: 'var(--serie-2)' });
inserir('contatos', { id: 'c3', workspaceId: 'w2', telefone: '5581999990000', nome: 'Carla', departamentoId: 'dep-comercial-w2', etiquetas: [] });
await encerrarBanco();
`,
  );

  const rodarMigracao = path.join(pasta, 'migrar.mjs');
  fs.writeFileSync(
    rodarMigracao,
    `import { iniciarBanco, listar, encerrarBanco } from ${JSON.stringify(urlDoBanco)};
import { migrarDepartamentoPosVenda } from ${JSON.stringify(urlDoModulo)};
iniciarBanco();
const resultado = migrarDepartamentoPosVenda();
console.log(JSON.stringify({
  resultado,
  departamentos: listar('departamentos'),
  contatos: listar('contatos'),
  status: listar('status'),
  conexoes: listar('conexoes'),
  membros: listar('membros'),
  integracoes: listar('integracoes'),
}));
await encerrarBanco();
process.exit(0);
`,
  );

  try {
    const m = await rodar(montagem);
    if (!s.ok('a base descartavel foi montada', m.codigo === 0, m.texto.slice(-300))) return s;

    const r1 = await rodar(rodarMigracao);
    if (!s.ok('roda sem erro', r1.codigo === 0, r1.texto.slice(-500))) return s;
    const b = JSON.parse(r1.texto.trim().split('\n').pop());

    s.ok('corrige um workspace (o que tinha Pós-venda)', b.resultado.workspacesCorrigidos === 1, JSON.stringify(b.resultado));
    s.ok('move um contato (Ana; Beto ja estava em Comercial)', b.resultado.contatosMovidos === 1, JSON.stringify(b.resultado));

    /* O workspace que o seed criou sozinho (nao e w1 nem w2): nunca teve
       "Pós-venda" para comecar, entao a migracao nao precisou corrigi-lo —
       o proprio seed ja nasce sem esse departamento. */
    const departamentosDoSeed = b.departamentos.filter((d) => d.workspaceId !== 'w1' && d.workspaceId !== 'w2');
    s.ok(
      'o seed nao cria departamento "Pós-venda" nenhum',
      departamentosDoSeed.length > 0 && !departamentosDoSeed.some((d) => d.nome === 'Pós-venda'),
      JSON.stringify(departamentosDoSeed.map((d) => d.nome)),
    );

    s.ok(
      'o departamento "Pós-venda" nao existe mais',
      !b.departamentos.some((d) => d.nome === 'Pós-venda'),
      JSON.stringify(b.departamentos.map((d) => d.nome)),
    );
    s.ok('o departamento "Comercial" de w1 continua o mesmo (nao duplicou)', b.departamentos.filter((d) => d.workspaceId === 'w1' && d.nome === 'Comercial').length === 1);

    const ana = b.contatos.find((c) => c.id === 'c1');
    s.ok('a Ana passa para Comercial', ana?.departamentoId === 'dep-comercial', String(ana?.departamentoId));
    const beto = b.contatos.find((c) => c.id === 'c2');
    s.ok('o Beto (ja estava em Comercial) continua igual', beto?.departamentoId === 'dep-comercial', String(beto?.departamentoId));

    const status = b.status.find((st) => st.id === 's1');
    s.ok('o status "Contrato fechado" passa para Comercial', status?.departamentoId === 'dep-comercial', String(status?.departamentoId));

    const conexao = b.conexoes.find((c) => c.id === 'conx1');
    s.ok('a conexao com departamento padrao em Pós-venda passa para Comercial', conexao?.departamentoPadraoId === 'dep-comercial', String(conexao?.departamentoPadraoId));

    const mbr1 = b.membros.find((m) => m.id === 'mbr1');
    s.ok(
      'o membro escopado em Pós-venda passa a ver Comercial no lugar (sem duplicar)',
      JSON.stringify([...mbr1.departamentos].sort()) === JSON.stringify(['dep-comercial']),
      JSON.stringify(mbr1.departamentos),
    );
    const mbr2 = b.membros.find((m) => m.id === 'mbr2');
    s.ok('o membro com acesso total (*) nao e tocado', JSON.stringify(mbr2.departamentos) === JSON.stringify(['*']), JSON.stringify(mbr2.departamentos));

    const integracao = b.integracoes.find((i) => i.workspaceId === 'w1');
    s.ok(
      'a integracao do ZapSign (posAssinatura.departamentoId) passa para Comercial',
      integracao?.zapsign?.posAssinatura?.departamentoId === 'dep-comercial',
      String(integracao?.zapsign?.posAssinatura?.departamentoId),
    );
    s.ok(
      'o responsavel do posAssinatura nao e mexido (so o departamento)',
      integracao?.zapsign?.posAssinatura?.responsavel?.id === 'mbr1',
      JSON.stringify(integracao?.zapsign?.posAssinatura?.responsavel),
    );

    s.ok(
      'o workspace sem "Pós-venda" nenhum fica intocado',
      b.departamentos.filter((d) => d.workspaceId === 'w2').length === 1 && b.contatos.find((c) => c.id === 'c3')?.departamentoId === 'dep-comercial-w2',
      JSON.stringify(b.departamentos.filter((d) => d.workspaceId === 'w2')),
    );

    const r2 = await rodar(rodarMigracao);
    const c = JSON.parse(r2.texto.trim().split('\n').pop());
    s.ok('rodar de novo nao corrige mais nenhum workspace (idempotente)', c.resultado.workspacesCorrigidos === 0, JSON.stringify(c.resultado));
  } finally {
    fs.rmSync(pasta, { recursive: true, force: true });
  }
  return s;
}
