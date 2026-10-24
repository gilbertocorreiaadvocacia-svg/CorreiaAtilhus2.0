import { spawn } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

import { suite } from './apoio.js';

/**
 * A varredura periodica (automacao/reatribuir-pendentes.js) agora religa,
 * antes de reatribuir, todo numero de area sem responsavel padrao ao agente
 * de entrada (Triagem) da area dele — ligarNumerosDasAreas()
 * (nucleo/agentes-por-escritorio.js), que ate 23/10/2026 so rodava por um
 * script de linha de comando com o servidor parado (na pratica, nunca
 * rodava). Pedido do escritorio em 23/10/2026: "quero que todos os
 * pendentes vão para a IA, com seus devidos agentes em relação ao
 * benefício" — um numero novo (ex.: uma conexao de anuncio) sem
 * responsavel padrao configurado ficava pendente para sempre, mesmo com a
 * reatribuicao rodando, porque nao havia para quem reatribuir.
 *
 * O que nao pode falhar: conexao de area sem responsavel padrao ganha o
 * Triagem da area (mesmo sem `conexao.area` propria — cai no
 * `workspace.area`) e o pendente dela e reatribuido e responde de
 * verdade; conexao de simulador NUNCA e tocada (e como a tela testa
 * agente, nao atendimento de verdade); workspace sem area valida nao e
 * tocado.
 */
export async function testarLigarNumerosDasAreasNaVarredura({ raiz }) {
  const s = suite('Numero de area sem responsavel padrao ganha o Triagem sozinho (varredura periodica)');
  const urlDoBanco = pathToFileURL(path.join(raiz, 'servidor/nucleo/banco.js')).href;
  const urlDoAgentesPorEscritorio = pathToFileURL(path.join(raiz, 'servidor/nucleo/agentes-por-escritorio.js')).href;
  const urlDoReatribuir = pathToFileURL(path.join(raiz, 'servidor/automacao/reatribuir-pendentes.js')).href;
  const pasta = fs.mkdtempSync(path.join(os.tmpdir(), 'ligar-numeros-areas-'));

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

/* Escritorio do Previdenciario, com a Eduarda (o agente de entrada real do
   pacote) ja instalada e LIGADA — o cenario comum depois de alguem clicar
   em "Separar por escritorio" ou "Ativar todos". */
inserir('workspaces', { id: 'w-prev', nome: 'Previdenciario', area: 'previdenciario' });
inserir('agentes', { id: 'ag-eduarda', workspaceId: 'w-prev', nome: 'Eduarda (Triagem)', ativo: true, delaySegundos: 1 });

/* Conexao de anuncio recem-criada: ninguem configurou responsavel padrao
   nem area propria (so a area do workspace existe). */
inserir('conexoes', { id: 'conx-facebook', workspaceId: 'w-prev', tipo: 'oficial', nome: 'Trafego pago - Facebook', responsavelPadrao: null, area: null });
/* Simulador: nunca deve ser tocado. */
inserir('conexoes', { id: 'conx-sim', workspaceId: 'w-prev', tipo: 'simulador', nome: 'Chat de teste', responsavelPadrao: null, area: null });

/* Workspace sem area valida: nao deve ser tocado. */
inserir('workspaces', { id: 'w-geral', nome: 'Geral' });
inserir('conexoes', { id: 'conx-geral', workspaceId: 'w-geral', tipo: 'oficial', nome: 'Numero geral', responsavelPadrao: null, area: null });

/* Pendente de verdade na conexao do Facebook, igual ao "Ricardo" relatado. */
inserir('contatos', { id: 'c-ricardo', workspaceId: 'w-prev', conexaoId: 'conx-facebook', telefone: '5548920056366', nome: 'Ricardo', estado: 'pendente', responsavel: null, etiquetas: [] });
await encerrarBanco();
`,
  );

  const rodarVarredura = path.join(pasta, 'varrer.mjs');
  fs.writeFileSync(
    rodarVarredura,
    `import { iniciarBanco, achar, listar, mensagensDe, encerrarBanco } from ${JSON.stringify(urlDoBanco)};
import { ligarNumerosDasAreas } from ${JSON.stringify(urlDoAgentesPorEscritorio)};
import { reatribuirPendentes } from ${JSON.stringify(urlDoReatribuir)};
iniciarBanco();
const ligados = ligarNumerosDasAreas();
const resultado = reatribuirPendentes();
/* agendarResposta tem piso de 1s de delay; espera generosa para o timer ter
   chance de disparar dentro deste processo descartavel. */
await new Promise((resolver) => setTimeout(resolver, 1800));
const saida = {
  ligados,
  resultado,
  facebook: achar('conexoes', 'conx-facebook'),
  simulador: achar('conexoes', 'conx-sim'),
  geral: achar('conexoes', 'conx-geral'),
  ricardo: achar('contatos', 'c-ricardo'),
  mensagensDoRicardo: mensagensDe('c-ricardo').length,
};
console.log(JSON.stringify(saida));
await encerrarBanco();
process.exit(0);
`,
  );

  try {
    const m = await rodar(montagem);
    if (!s.ok('a base descartavel foi montada', m.codigo === 0, m.texto.slice(-400))) return s;

    const r = await rodar(rodarVarredura);
    if (!s.ok('a varredura roda sem erro', r.codigo === 0, r.texto.slice(-500))) return s;
    const b = JSON.parse(r.texto.trim().split('\n').pop());

    s.ok('ligou exatamente 1 numero (o do Facebook)', b.ligados.length === 1, JSON.stringify(b.ligados));
    s.ok(
      'a conexao do Facebook ganhou a Eduarda como responsavel padrao, com a area do workspace',
      b.facebook?.responsavelPadrao?.id === 'ag-eduarda' && b.facebook?.area === 'previdenciario',
      JSON.stringify({ responsavelPadrao: b.facebook?.responsavelPadrao, area: b.facebook?.area }),
    );
    s.ok('a conexao de simulador nunca e tocada', !b.simulador?.responsavelPadrao, JSON.stringify(b.simulador?.responsavelPadrao));
    s.ok('o workspace sem area valida nao e tocado', !b.geral?.responsavelPadrao, JSON.stringify(b.geral?.responsavelPadrao));

    s.ok('o Ricardo (pendente) foi reatribuido', b.resultado.reativados === 1, JSON.stringify(b.resultado));
    s.ok(
      'o Ricardo ganha a Eduarda como responsavel e vira estado ia',
      b.ricardo?.responsavel?.id === 'ag-eduarda' && b.ricardo?.estado === 'ia',
      JSON.stringify({ responsavel: b.ricardo?.responsavel, estado: b.ricardo?.estado }),
    );
    s.ok('o Ricardo recebe uma resposta de verdade da Eduarda', b.mensagensDoRicardo > 0, JSON.stringify(b.mensagensDoRicardo));
  } finally {
    fs.rmSync(pasta, { recursive: true, force: true });
  }
  return s;
}
