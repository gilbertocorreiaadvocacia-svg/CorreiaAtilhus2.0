import { spawn } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

import { suite } from './apoio.js';

/**
 * A tela de Saude e o contrato: os tres jeitos de nao sair link nenhum.
 *
 * Pedido do escritorio em 16/11/2026: "os agentes ainda nao estao enviando o
 * link do contrato [...] reveja toda a parte desse processo".
 *
 * Revendo o caminho inteiro, a Saude do sistema tinha DOIS pontos cegos, e os
 * dois davam tela verde num sistema que nao fechava contrato nenhum:
 *
 *  1. COBERTURA DOS MODELOS. A pergunta era "ha ALGUM modelo escolhido?". Mas
 *     integracoes/zapsign.js escolhe o modelo DO CASO, ou o PADRAO, ou nada —
 *     entao, sem padrao, cada tipo de caso sem modelo proprio falha, e a
 *     conversa SEM tipo de caso tambem. Com um unico modelo cadastrado a tela
 *     dizia que estava tudo certo enquanto o escritorio inteiro falhava com
 *     "sem_modelo" depois de ja ter pedido os dados ao cliente;
 *
 *  2. NINGUEM PEDINDO. Nenhum agente ligado com @gerarcontrato no roteiro
 *     significa nenhum contrato gerado, em silencio: sem erro, sem tentativa,
 *     sem nada em lugar nenhum. O escritorio procura o defeito na ZapSign, que
 *     esta certa.
 *
 * Como a suite de Diagnostico diz: o que nao pode falhar e ACHAR enquanto o
 * defeito existe e PARAR de acusar depois de corrigido. Um que acusa sempre
 * vira ruido; um que nunca acusa e uma tela verde mentindo. Os dois lados
 * estao aqui, para cada um dos tres achados.
 *
 * Em processo proprio, e nao pelo servidor da suite: estes casos mexem na
 * configuracao da ZapSign do escritorio, e fazer isso no servidor
 * compartilhado estragaria as suites de contrato que rodam em volta.
 */
export async function testarDiagnosticoDoContrato({ raiz }) {
  const s = suite('A Saude do sistema enxerga o contrato que nao sai');
  const url = (arquivo) => JSON.stringify(pathToFileURL(path.join(raiz, arquivo)).href);
  const pasta = fs.mkdtempSync(path.join(os.tmpdir(), 'diag-contrato-'));
  const script = path.join(pasta, 'diag.mjs');

  fs.writeFileSync(
    script,
    `import { iniciarBanco, atualizar, inserir, listar, encerrarBanco } from ${url('servidor/nucleo/banco.js')};
import { diagnosticar } from ${url('servidor/nucleo/diagnostico.js')};
iniciarBanco();

inserir('workspaces', { id: 'w1', nome: 'Correia Advogados' });
inserir('usuarios', { id: 'u1', nome: 'Administrador' });
inserir('membros', { id: 'm1', workspaceId: 'w1', usuarioId: 'u1', papel: 'admin' });
inserir('conexoes', { id: 'cx1', workspaceId: 'w1', tipo: 'oficial', nome: 'Comercial', estado: 'conectado', statusPadraoId: 'st1' });
inserir('status', { id: 'st1', workspaceId: 'w1', nome: 'NOVO lead', tipo: 'nova' });
/* Dois tipos de caso, para a cobertura parcial ter o que descobrir. */
inserir('etiquetas', { id: 'etq-trab', workspaceId: 'w1', nome: 'Trabalhista', tipo: 'caso', caso: 'trabalhista' });
inserir('etiquetas', { id: 'etq-aux', workspaceId: 'w1', nome: 'Auxilio-acidente', tipo: 'caso', caso: 'auxilio_acidente' });
/* Uma conversa SEM tipo de caso: sem modelo padrao, ela tambem fica sem contrato. */
inserir('contatos', { id: 'c1', workspaceId: 'w1', conexaoId: 'cx1', statusId: 'st1', nome: 'Cliente', telefone: '5581930000001', etiquetas: [] });

const agente = inserir('agentes', { id: 'ag1', workspaceId: 'w1', nome: 'Debora', ativo: true, prompt: 'Feche a proposta e use @gerarcontrato quando o cliente aceitar.' });
const integracao = inserir('integracoes', { id: 'int1', workspaceId: 'w1' });

/* diagnosticar devolve { verificadoEm, achados, resumo } — os achados estao
   dentro, e nao na raiz. */
const ids = () => (diagnosticar('w1').achados || []).map((a) => a.id);
const achar = (id) => (diagnosticar('w1').achados || []).find((a) => a.id === id) || null;
const zapsign = (cfg) => atualizar('integracoes', 'int1', { zapsign: cfg });

/* --- 1. Chave, e nenhum modelo ------------------------------------- */
zapsign({ chave: 'zs', modelos: [] });
const nenhumModelo = { ids: ids(), achado: achar('contrato-sem-modelo') };

/* --- 2. Chave e UM modelo por caso, sem padrao ---------------------- */
zapsign({ chave: 'zs', modelosPorCaso: { trabalhista: { contratoId: 'mdl-trab' } } });
const parcial = { ids: ids(), achado: achar('contrato-modelo-incompleto') };

/* --- 3. Caso cadastrado, mas com o contrato em branco --------------- */
zapsign({ chave: 'zs', modelosPorCaso: { trabalhista: { contratoId: 'mdl-trab' }, auxilio_acidente: { procuracaoId: 'so-procuracao' } } });
const emBranco = { ids: ids(), achado: achar('contrato-modelo-incompleto') };

/* --- 4. Todos os casos cobertos, mas a conversa sem tipo de caso ---- */
zapsign({ chave: 'zs', modelosPorCaso: { trabalhista: { contratoId: 'a' }, auxilio_acidente: { contratoId: 'b' } } });
const soSemTipo = { ids: ids(), achado: achar('contrato-modelo-incompleto') };

/* --- 5. Modelo padrao: cobre tudo, e a tela cala -------------------- */
zapsign({ chave: 'zs', modeloPadraoId: 'mdl-padrao' });
const comPadrao = { ids: ids() };

/* --- 6. Ninguem pede o contrato ------------------------------------- */
atualizar('agentes', agente.id, { prompt: 'Converse com o cliente e tire duvidas.' });
const ninguemPede = { ids: ids(), achado: achar('contrato-ninguem-pede') };

/* --- 7. Sem chave e sem ninguem pedindo: nao cobra nada ------------- */
zapsign({ ativo: false });
const semNada = { ids: ids() };

/* --- 8. O agente volta a pedir: para de acusar ---------------------- */
atualizar('agentes', agente.id, { prompt: 'Feche com @gerarcontrato.' });
zapsign({ chave: 'zs', modeloPadraoId: 'mdl-padrao' });
const voltouAoNormal = { ids: ids() };

console.log(JSON.stringify({ nenhumModelo, parcial, emBranco, soSemTipo, comPadrao, ninguemPede, semNada, voltouAoNormal }));
await encerrarBanco();
process.exit(0);
`,
  );

  try {
    const r = await new Promise((resolve) => {
      const p = spawn(process.execPath, [script], { env: { ...process.env, CORREIA_DADOS: pasta }, stdio: ['ignore', 'pipe', 'pipe'] });
      let texto = '';
      p.stdout.on('data', (d) => (texto += d));
      p.stderr.on('data', (d) => (texto += d));
      p.on('close', (codigo) => resolve({ codigo, texto }));
    });
    if (!s.ok('o escritorio de teste roda sem erro', r.codigo === 0, r.texto.slice(-800))) return s;
    const b = JSON.parse(r.texto.trim().split('\n').pop());

    /* --- Nenhum modelo: o achado antigo continua de pe ---------------- */
    s.ok('sem modelo nenhum, acusa', b.nenhumModelo.ids.includes('contrato-sem-modelo'), JSON.stringify(b.nenhumModelo.ids));

    /* --- Cobertura parcial: o ponto cego ------------------------------ */
    s.ok(
      'com modelo para um caso so e sem padrao, acusa a cobertura incompleta',
      b.parcial.ids.includes('contrato-modelo-incompleto'),
      JSON.stringify(b.parcial.ids),
    );
    s.ok(
      'e diz, pelo nome, qual tipo de caso esta descoberto',
      /Auxilio-acidente/i.test(b.parcial.achado?.detalhe || ''),
      String(b.parcial.achado?.detalhe || ''),
    );
    s.ok(
      'nao acusa o caso que TEM modelo',
      !/Trabalhista/i.test(b.parcial.achado?.detalhe || ''),
      String(b.parcial.achado?.detalhe || ''),
    );
    s.ok(
      'e conta as conversas sem tipo de caso, que tambem ficam sem contrato',
      /sem tipo de caso/i.test(b.parcial.achado?.detalhe || ''),
      String(b.parcial.achado?.detalhe || ''),
    );
    /*
     * A chave existir no objeto nunca foi a pergunta: o que vale e haver
     * contratoId. Um caso cadastrado so com a procuracao continua sem contrato,
     * e era exatamente assim que a contagem antiga (Object.keys) dava tudo
     * certo.
     */
    s.ok(
      'caso cadastrado com o contrato em branco conta como sem modelo',
      b.emBranco.ids.includes('contrato-modelo-incompleto') && /Auxilio-acidente/i.test(b.emBranco.achado?.detalhe || ''),
      String(b.emBranco.achado?.detalhe || ''),
    );
    s.ok(
      'com todos os casos cobertos, ainda acusa por causa da conversa sem tipo de caso',
      b.soSemTipo.ids.includes('contrato-modelo-incompleto') && /sem tipo de caso/i.test(b.soSemTipo.achado?.detalhe || ''),
      String(b.soSemTipo.achado?.detalhe || ''),
    );

    /* --- Modelo padrao cobre tudo: a tela precisa CALAR ---------------- */
    s.ok(
      'com modelo padrao, para de acusar modelo',
      !b.comPadrao.ids.includes('contrato-modelo-incompleto') && !b.comPadrao.ids.includes('contrato-sem-modelo'),
      JSON.stringify(b.comPadrao.ids),
    );

    /* --- Ninguem pedindo ---------------------------------------------- */
    s.ok(
      'ZapSign pronta e nenhum agente com @gerarcontrato: acusa',
      b.ninguemPede.ids.includes('contrato-ninguem-pede'),
      JSON.stringify(b.ninguemPede.ids),
    );
    s.ok(
      'e manda olhar o roteiro do agente, que e onde se resolve',
      b.ninguemPede.achado?.onde === '#/agentes',
      String(b.ninguemPede.achado?.onde),
    );
    /*
     * Escritorio que nao fecha contrato pelo sistema nao tem chave nenhuma e
     * nao pode ser cobrado por isso todo dia. Diagnostico que cobra o que
     * ninguem pediu vira ruido, e ruido se aprende a ignorar.
     */
    s.ok(
      'sem chave da ZapSign, nao cobra contrato de ninguem',
      !b.semNada.ids.some((id) => id.startsWith('contrato-')),
      JSON.stringify(b.semNada.ids),
    );
    s.ok(
      'e com tudo em ordem a tela fica limpa de achados de contrato',
      !b.voltouAoNormal.ids.some((id) => id.startsWith('contrato-')),
      JSON.stringify(b.voltouAoNormal.ids),
    );
  } finally {
    fs.rmSync(pasta, { recursive: true, force: true });
  }
  return s;
}
