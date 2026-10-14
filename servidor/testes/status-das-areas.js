import { spawn } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

import { suite } from './apoio.js';

/**
 * `garantirStatusDasAreas` (servidor/nucleo/agentes-por-escritorio.js): todo
 * workspace de area ganha o funil de status completo, mesmo quando nasceu
 * pelo caminho generico (o mesmo achado real de 14/10/2026 que motivou
 * garantirAgentesDasAreas — so que ali o roteiro de agentes foi corrigido e
 * o funil de status, que os prompts citam por nome, ficou pela metade).
 *
 * O que nao pode falhar: so acrescenta o status que falta, pelo NOME contra
 * o workspace de origem (o sem area com o funil mais completo); remonta
 * departamento e follow-up (template e desistencia) para os registros do
 * PROPRIO workspace, nunca deixando ponteiro para o workspace de origem;
 * funde departamento duplicado pelo mesmo nome sem perder quem apontava para
 * a copia; workspace ja completo nao e mexido; e rodar duas vezes nao cria
 * nada a mais.
 */
export async function testarStatusDasAreas({ raiz }) {
  const s = suite('Status das areas, funil completo');
  const urlDoBanco = pathToFileURL(path.join(raiz, 'servidor/nucleo/banco.js')).href;
  const urlDoModulo = pathToFileURL(path.join(raiz, 'servidor/nucleo/agentes-por-escritorio.js')).href;
  const pasta = fs.mkdtempSync(path.join(os.tmpdir(), 'status-das-areas-'));

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

/* w0: o escritorio geral, sem area — o funil completo de onde clonar. */
inserir('workspaces', { id: 'w0', nome: 'Escritorio Geral' });
inserir('departamentos', { id: 'dep0-comercial', workspaceId: 'w0', nome: 'Comercial', cor: 'azul' });
inserir('templates', { id: 'tpl0-fu1', workspaceId: 'w0', atalho: 'fu1', nome: 'Follow-up 1', conteudo: 'Oi {{nome}}' });
inserir('status', { id: 'sts0-novo', workspaceId: 'w0', nome: 'NOVO lead', tipo: 'nova', departamentoId: 'dep0-comercial', followups: [] });
inserir('status', { id: 'sts0-analise', workspaceId: 'w0', nome: 'Em analise', tipo: 'analise', departamentoId: 'dep0-comercial', followups: [] });
inserir('status', { id: 'sts0-desistencia', workspaceId: 'w0', nome: 'Desistencia', tipo: 'desistencia', departamentoId: null, followups: [] });
inserir('status', {
  id: 'sts0-qualificado',
  workspaceId: 'w0',
  nome: 'Qualificado',
  tipo: 'qualificado',
  departamentoId: 'dep0-comercial',
  followups: [{ id: 'fup0', templateId: 'tpl0-fu1', minutos: 60, desistir: { ativo: true, statusId: 'sts0-desistencia', responsavel: null, arquivar: true } }],
});

/* w1: nasceu pelo caminho generico, igual ao bug real — nome exato de area,
   SEM o campo area, so com o status padrao (NOVO lead), e com "Comercial"
   duplicado (o outro achado real do mesmo dia). */
inserir('workspaces', { id: 'w1', nome: 'Trabalhista' });
inserir('departamentos', { id: 'dep1-comercial-velho', workspaceId: 'w1', nome: 'Comercial', cor: 'azul', criadoEm: '2026-10-14T09:00:00.000Z' });
inserir('departamentos', { id: 'dep1-comercial-novo', workspaceId: 'w1', nome: 'Comercial', cor: 'azul', criadoEm: '2026-10-14T09:00:00.002Z' });
inserir('templates', { id: 'tpl1-fu1', workspaceId: 'w1', atalho: 'fu1', nome: 'Follow-up 1', conteudo: 'Oi {{nome}}' });
inserir('status', { id: 'sts1-novo', workspaceId: 'w1', nome: 'NOVO lead', tipo: 'nova', departamentoId: 'dep1-comercial-velho', followups: [] });
/* Agente e conexao que ja apontavam para a copia "nova" do departamento —
   tem de acompanhar a fusao, nao ficar orfao. */
inserir('conexoes', { id: 'cnx1', workspaceId: 'w1', nome: 'WhatsApp Trabalhista', tipo: 'qrcode', departamentoPadraoId: 'dep1-comercial-novo' });

/* w2: ja esta certo (area marcada, funil completo) — nao pode ser mexido. */
inserir('workspaces', { id: 'w2', nome: 'Previdenciario', area: 'previdenciario' });
inserir('status', { id: 'sts2-novo', workspaceId: 'w2', nome: 'NOVO lead', tipo: 'nova', departamentoId: null, followups: [] });
inserir('status', { id: 'sts2-analise', workspaceId: 'w2', nome: 'Em analise', tipo: 'analise', departamentoId: null, followups: [] });
inserir('status', { id: 'sts2-desistencia', workspaceId: 'w2', nome: 'Desistencia', tipo: 'desistencia', departamentoId: null, followups: [] });
inserir('status', { id: 'sts2-qualificado', workspaceId: 'w2', nome: 'Qualificado', tipo: 'qualificado', departamentoId: null, followups: [] });

/* w3: nenhum nome bate com nenhuma area — nao pode ser tocado. */
inserir('workspaces', { id: 'w3', nome: 'Geral de Teste' });

await encerrarBanco();
`,
  );

  const rodarMigracao = path.join(pasta, 'migrar.mjs');
  fs.writeFileSync(
    rodarMigracao,
    `import { iniciarBanco, listar, encerrarBanco } from ${JSON.stringify(urlDoBanco)};
import { garantirStatusDasAreas } from ${JSON.stringify(urlDoModulo)};
iniciarBanco();
const resultado = garantirStatusDasAreas();
console.log(JSON.stringify({
  resultado,
  status: listar('status'),
  departamentos: listar('departamentos'),
  conexoes: listar('conexoes'),
}));
await encerrarBanco();
process.exit(0);
`,
  );

  try {
    const m = await rodar(montagem);
    if (!s.ok('a base descartavel foi montada', m.codigo === 0, m.texto.slice(-300))) return s;

    const r1 = await rodar(rodarMigracao);
    if (!s.ok('roda sem erro', r1.codigo === 0, r1.texto.slice(-400))) return s;
    const b = JSON.parse(r1.texto.trim().split('\n').pop());

    const statusW1 = b.status.filter((x) => x.workspaceId === 'w1');
    s.ok('w1 ganha os status que faltavam, pelo nome', statusW1.length === 4, `tem ${statusW1.length}: ${statusW1.map((x) => x.nome).join(', ')}`);
    s.ok(
      'o status que ja existia (NOVO lead) nao foi duplicado',
      statusW1.filter((x) => x.nome === 'NOVO lead').length === 1,
      JSON.stringify(statusW1.map((x) => x.nome)),
    );

    const depsW1 = b.departamentos.filter((x) => x.workspaceId === 'w1');
    s.ok('o "Comercial" duplicado de w1 foi fundido em um so', depsW1.length === 1, JSON.stringify(depsW1.map((x) => x.id)));
    const comercialQueFicou = depsW1[0];
    s.ok('fica o mais antigo dos dois', comercialQueFicou?.id === 'dep1-comercial-velho', comercialQueFicou?.id);

    const cnx1 = b.conexoes.find((x) => x.id === 'cnx1');
    s.ok(
      'a conexao que apontava para a copia removida passa a apontar para o que ficou',
      cnx1?.departamentoPadraoId === 'dep1-comercial-velho',
      cnx1?.departamentoPadraoId,
    );

    const qualificadoW1 = statusW1.find((x) => x.nome === 'Qualificado');
    s.ok(
      'o status clonado aponta para o departamento DESTE workspace, nao do de origem',
      qualificadoW1?.departamentoId === 'dep1-comercial-velho',
      qualificadoW1?.departamentoId,
    );
    const passo = qualificadoW1?.followups?.[0];
    s.ok('o follow-up clonado aponta para o template DESTE workspace', passo?.templateId === 'tpl1-fu1', passo?.templateId);
    const desistenciaW1 = statusW1.find((x) => x.nome === 'Desistencia');
    s.ok(
      'e a desistencia aponta para o status de Desistencia DESTE workspace, nao do de origem',
      passo?.desistir?.statusId === desistenciaW1?.id,
      JSON.stringify({ apontaPara: passo?.desistir?.statusId, statusDesteWorkspace: desistenciaW1?.id }),
    );

    const statusW2 = b.status.filter((x) => x.workspaceId === 'w2');
    s.ok('w2, que ja estava completo, continua com os mesmos quatro', statusW2.length === 4, String(statusW2.length));

    s.ok('w3, sem nome de area nenhum, nao ganha status', !b.status.some((x) => x.workspaceId === 'w3'));

    const r2 = await rodar(rodarMigracao);
    const c = JSON.parse(r2.texto.trim().split('\n').pop());
    s.ok(
      'rodar de novo nao cria status nem funde departamento a mais',
      c.resultado.statusCriados === 0 && c.resultado.departamentosFundidos === 0,
      JSON.stringify(c.resultado),
    );
    const statusW1Depois = c.status.filter((x) => x.workspaceId === 'w1');
    s.ok('e a contagem de w1 fica igual', statusW1Depois.length === statusW1.length, `antes: ${statusW1.length}, depois: ${statusW1Depois.length}`);
  } finally {
    fs.rmSync(pasta, { recursive: true, force: true });
  }
  return s;
}
