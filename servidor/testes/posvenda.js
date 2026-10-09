import { spawn } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

import { suite } from './apoio.js';

/**
 * `garantirPosVendaNosEscritorios` (servidor/nucleo/agentes-por-escritorio.js):
 * todo escritorio de area ganha um agente de Pós-venda, e ele vira o
 * responsavel automatico depois da assinatura quando esse ponto ainda nao
 * foi configurado.
 *
 * O que nao pode falhar: cria o agente pelo nome, uma vez por escritorio;
 * liga posAssinatura so quando estava vazio (nunca substitui escolha manual
 * ja feita); cria o departamento "Pós-venda" quando falta; acha o status
 * "Contrato fechado" certo do escritorio; escritorio sem area (geral) nao e
 * tocado; e rodar duas vezes nao duplica nem desfaz nada.
 */
export async function testarPosVenda({ raiz }) {
  const s = suite('Pós-venda instalado e ligado apos a assinatura');
  const urlDoBanco = pathToFileURL(path.join(raiz, 'servidor/nucleo/banco.js')).href;
  const urlDoModulo = pathToFileURL(path.join(raiz, 'servidor/nucleo/agentes-por-escritorio.js')).href;
  const pasta = fs.mkdtempSync(path.join(os.tmpdir(), 'posvenda-'));

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
/* w1: Previdenciario, sem posAssinatura configurado ainda. */
inserir('workspaces', { id: 'w1', nome: 'Previdenciario de Teste', area: 'previdenciario' });
inserir('status', { id: 's-fechado', workspaceId: 'w1', nome: 'Contrato fechado', tipo: 'sucesso' });
inserir('integracoes', { id: 'int-w1', workspaceId: 'w1', zapsign: { chave: '', modelos: [], ativo: false } });
/* w2: Trabalhista, ja tem posAssinatura apontando para um membro — nao mexer. */
inserir('workspaces', { id: 'w2', nome: 'Trabalhista de Teste', area: 'trabalhista' });
inserir('integracoes', { id: 'int-w2', workspaceId: 'w2', zapsign: { chave: '', modelos: [], ativo: false, posAssinatura: { responsavel: { tipo: 'membro', id: 'mbr-fixo', nome: 'Fulana' } } } });
/* w3: escritorio geral, sem area — nao e tocado. */
inserir('workspaces', { id: 'w3', nome: 'Geral de Teste' });
inserir('integracoes', { id: 'int-w3', workspaceId: 'w3', zapsign: { chave: '', modelos: [], ativo: false } });
await encerrarBanco();
`,
  );

  const rodarMigracao = path.join(pasta, 'migrar.mjs');
  fs.writeFileSync(
    rodarMigracao,
    `import { iniciarBanco, listar, encerrarBanco } from ${JSON.stringify(urlDoBanco)};
import { garantirPosVendaNosEscritorios } from ${JSON.stringify(urlDoModulo)};
iniciarBanco();
const resultado = garantirPosVendaNosEscritorios();
console.log(JSON.stringify({ resultado, agentes: listar('agentes'), integracoes: listar('integracoes'), departamentos: listar('departamentos') }));
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

    const agenteW1 = b.agentes.find((a) => a.workspaceId === 'w1' && a.nome === 'Pós-venda · Previdenciário');
    s.ok('cria o agente de pos-venda no Previdenciario', Boolean(agenteW1), JSON.stringify(b.agentes.map((a) => a.nome)));
    s.ok('o agente nasce ativo', agenteW1?.ativo === true, String(agenteW1?.ativo));

    const depW1 = b.departamentos.find((d) => d.workspaceId === 'w1' && d.nome === 'Pós-venda');
    s.ok('cria o departamento Pos-venda que faltava', Boolean(depW1), JSON.stringify(b.departamentos));

    const intW1 = b.integracoes.find((i) => i.workspaceId === 'w1');
    s.ok(
      'liga o agente como responsavel apos a assinatura',
      intW1?.zapsign?.posAssinatura?.responsavel?.id === agenteW1?.id,
      JSON.stringify(intW1?.zapsign?.posAssinatura),
    );
    s.ok('acha o status "Contrato fechado" certo', intW1?.zapsign?.posAssinatura?.statusId === 's-fechado', String(intW1?.zapsign?.posAssinatura?.statusId));
    s.ok('usa o departamento recem-criado', intW1?.zapsign?.posAssinatura?.departamentoId === depW1?.id, String(intW1?.zapsign?.posAssinatura?.departamentoId));

    const agenteW2 = b.agentes.find((a) => a.workspaceId === 'w2' && a.nome === 'Pós-venda · Trabalhista');
    s.ok('cria o agente no Trabalhista tambem', Boolean(agenteW2), JSON.stringify(b.agentes.map((a) => a.nome)));
    const intW2 = b.integracoes.find((i) => i.workspaceId === 'w2');
    s.ok(
      'mas NAO mexe no responsavel ja configurado a mao',
      intW2?.zapsign?.posAssinatura?.responsavel?.id === 'mbr-fixo',
      JSON.stringify(intW2?.zapsign?.posAssinatura),
    );

    s.ok('escritorio sem area nao ganha agente de pos-venda', !b.agentes.some((a) => a.workspaceId === 'w3'), JSON.stringify(b.agentes.filter((a) => a.workspaceId === 'w3')));

    const r2 = await rodar(rodarMigracao);
    const c = JSON.parse(r2.texto.trim().split('\n').pop());
    s.ok('rodar de novo nao instala nem liga nada a mais', c.resultado.instalados === 0 && c.resultado.configurados === 0, JSON.stringify(c.resultado));
    s.ok('e nao duplica o agente', c.agentes.filter((a) => a.nome === 'Pós-venda · Previdenciário').length === 1, String(c.agentes.filter((a) => a.nome === 'Pós-venda · Previdenciário').length));
  } finally {
    fs.rmSync(pasta, { recursive: true, force: true });
  }
  return s;
}
