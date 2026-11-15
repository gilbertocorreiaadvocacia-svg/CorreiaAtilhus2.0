import { spawn } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

import { cliente, suite } from './apoio.js';

/**
 * Senha do gov.br e do Meu INSS (C-TL1, 15/11/2026, autorizado pelo
 * Dr. Gilberto): o escritorio nao pede nem aceita essa senha pelo WhatsApp.
 *
 * O que nao pode falhar:
 *  - nenhum agente de pacote pede a senha do gov.br ou do Meu INSS (nem como
 *    documento obrigatorio do auxilio-acidente);
 *  - pedir a senha e achado escrito de varios jeitos; a recusa e o "nao
 *    repita" nao contam como pedido;
 *  - as regras antigas (ate 26/10 e de 26/10 a 15/11) e o pedido do roteiro
 *    saem dos agentes ja instalados, em qualquer escritorio, sem mexer no
 *    resto do prompt, e rodar de novo nao muda nada;
 *  - o pedido escrito a mao fica como esta, mas aparece pelo nome do agente
 *    (o /api/saude mostra);
 *  - todo agente recebe, depois do prompt dele, a regra que recusa a senha e
 *    oferece o caminho seguro (o proprio cliente no Meu INSS, o escritorio
 *    como representante/procurador, ou atendimento com uma pessoa).
 *
 * A Anthropic e a de mentira, com roteiro (ver passagem-de-verdade.js).
 */
const MARCA = 'MARCA-DA-SUITE-DA-SENHA-DO-GOV';

export async function testarSenhaDoGov({ anthropic, raiz }) {
  const s = suite('Nenhum agente pede ou aceita a senha do gov.br (C-TL1)');
  const url = (arquivo) => JSON.stringify(pathToFileURL(path.join(raiz, arquivo)).href);
  const falsa = cliente(anthropic);
  const pasta = fs.mkdtempSync(path.join(os.tmpdir(), 'senha-do-gov-'));

  const rodar = (arquivo) =>
    new Promise((resolve) => {
      const p = spawn(process.execPath, [arquivo], {
        env: { ...process.env, CORREIA_DADOS: pasta, CORREIA_ANTHROPIC_URL: anthropic },
        stdio: ['ignore', 'pipe', 'pipe'],
      });
      let texto = '';
      p.stdout.on('data', (d) => (texto += d));
      p.stderr.on('data', (d) => (texto += d));
      p.on('close', (codigo) => resolve({ codigo, texto }));
    });

  const script = path.join(pasta, 'senha.mjs');
  fs.writeFileSync(
    script,
    `import { iniciarBanco, achar, inserir, inserirMensagem, encerrarBanco } from ${url('servidor/nucleo/banco.js')};
import { ESCRITORIO_GERAL, EQUIPE_TRABALHISTA_NO_GERAL, PACOTES, REGRA_DA_SENHA, REGRA_DA_SENHA_26_10_A_15_11, REGRA_DA_SENHA_ATE_26_10 } from ${url('servidor/ia/pacotes.js')};
import { agentesQuePedemSenhaDoGov, pedeSenhaDoGov, atualizarRegraDaSenhaDoGov } from ${url('servidor/nucleo/senha-do-gov.js')};
import { retomarRespostasPendentes } from ${url('servidor/ia/motor.js')};
iniciarBanco();

const dosPacotes = [...Object.values(PACOTES).flatMap((p) => p.agentes), ...ESCRITORIO_GERAL.agentes, ...EQUIPE_TRABALHISTA_NO_GERAL.agentes];
const pacotesQuePedem = dosPacotes.filter((a) => pedeSenhaDoGov(a.prompt)).map((a) => a.nome);
const pacotesComSenhaObrigatoria = dosPacotes.filter((a) => /senha do (inss|gov)[^.\\n]*obrigat|e senha do inss s[aã]o obrigat/i.test(a.prompt || '')).map((a) => a.nome);
const frases = {
  roteiroAntigo: pedeSenhaDoGov('Peça, um de cada vez: RG e CPF (ou CNH); senha do INSS ou GOV; CAT; laudo médico.'),
  meEnvie: pedeSenhaDoGov('Me envie a senha do gov.br, por favor.'),
  obrigatoria: pedeSenhaDoGov('RG, CPF (ou CNH) e senha do INSS são obrigatórios.'),
  regraNova: pedeSenhaDoGov(REGRA_DA_SENHA),
  regraAte26: pedeSenhaDoGov(REGRA_DA_SENHA_ATE_26_10),
  naoRepetir: pedeSenhaDoGov('SENHA DO GOV: nunca repita a senha em mensagem, resumo ou nota.'),
  recusa: pedeSenhaDoGov('Nunca peça a senha do gov.br; se o cliente mandar, diga que ele não deve mandar senha por aqui.'),
};

const ROTEIRO_ANTIGO = 'Peça, um de cada vez: RG e CPF (ou CNH); senha do INSS ou GOV; CAT; laudo médico.\\n\\nSENHA DO GOV: nunca repita a senha em mensagem, resumo ou nota.\\n\\nRG, CPF (ou CNH) e senha do INSS são obrigatórios. Nos demais, depois ele envia.';
const ha = (min) => new Date(Date.now() - min * 60000).toISOString();
inserir('workspaces', { id: 'w1', nome: 'Teste' });
inserir('integracoes', { id: 'int1', workspaceId: 'w1', ia: { chaveAnthropic: 'sk-ant-de-mentira' } });
inserir('conexoes', { id: 'conx-sim', workspaceId: 'w1', tipo: 'simulador' });
inserir('agentes', { id: 'ag-civel', workspaceId: 'w1', nome: 'Secretaria Antiga', ativo: true, prompt: 'Atenda.\\n' + REGRA_DA_SENHA_ATE_26_10 + '\\n- Documento em foto: leia.' });
inserir('agentes', { id: 'ag-civel-2', workspaceId: 'w1', nome: 'Secretaria de Outubro', ativo: true, prompt: 'Atenda.\\n' + REGRA_DA_SENHA_26_10_A_15_11 + '\\n- Documento em foto: leia.' });
inserir('agentes', { id: 'ag-roteiro', workspaceId: 'w1', nome: 'Acidente Instalado', ativo: true, prompt: 'DOCUMENTOS\\n\\n' + ROTEIRO_ANTIGO });
inserir('agentes', { id: 'ag-a-mao', workspaceId: 'w1', nome: 'Agente Escrito a Mao', ativo: true, prompt: 'Peça ao cliente a senha do gov.br.' });
inserir('agentes', { id: 'ag-acidente', workspaceId: 'w1', nome: 'Acidente', ativo: true, delaySegundos: 1, modelo: 'claude-sonnet-5', prompt: '${MARCA}. Atenda o cliente.' });
const acidente = { tipo: 'agente', id: 'ag-acidente', nome: 'Acidente' };
inserir('contatos', { id: 'c-senha', workspaceId: 'w1', conexaoId: 'conx-sim', telefone: '5581931119001', nome: 'Cliente da Senha', estado: 'ia', responsavel: acidente, ultimaEntradaEm: ha(1), ultimaSaidaEm: ha(2), etiquetas: [] });
inserirMensagem('c-senha', { direcao: 'saida', tipo: 'texto', conteudo: 'Me conte do seu caso.', autor: acidente, situacao: 'enviada', criadoEm: ha(2) });
inserirMensagem('c-senha', { direcao: 'entrada', tipo: 'texto', conteudo: 'Segue a senha do gov: exemplo-de-teste', autor: { tipo: 'cliente' }, situacao: 'recebida', criadoEm: ha(1) });

const antes = agentesQuePedemSenhaDoGov('w1');
const trocados = atualizarRegraDaSenhaDoGov();
const deNovo = atualizarRegraDaSenhaDoGov();
const civel = achar('agentes', 'ag-civel').prompt;
const civel2 = achar('agentes', 'ag-civel-2').prompt;
const roteiro = achar('agentes', 'ag-roteiro').prompt;

retomarRespostasPendentes();
await new Promise((ok) => setTimeout(ok, 3500));
console.log(JSON.stringify({
  pacotesQuePedem,
  pacotesComSenhaObrigatoria,
  frases,
  antes,
  trocados,
  deNovo,
  civel: { antiga: civel.includes(REGRA_DA_SENHA_ATE_26_10), nova: civel.includes(REGRA_DA_SENHA), resto: civel.startsWith('Atenda.') && civel.endsWith('- Documento em foto: leia.') },
  civel2: { antiga: civel2.includes(REGRA_DA_SENHA_26_10_A_15_11), nova: civel2.includes(REGRA_DA_SENHA) },
  roteiro: { pede: pedeSenhaDoGov(roteiro), resto: roteiro.startsWith('DOCUMENTOS') && roteiro.includes('CAT; laudo médico') && roteiro.includes('RG e CPF (ou CNH) são obrigatórios') },
  depois: agentesQuePedemSenhaDoGov('w1'),
  aMao: achar('agentes', 'ag-a-mao').prompt,
}));
await encerrarBanco();
process.exit(0);
`,
  );

  try {
    await falsa.post('/__roteiro', { roteiro: [{ status: 200, texto: 'Recebido, obrigado! Vamos seguir com o seu caso.' }], marca: MARCA });
    const r = await rodar(script);
    if (!s.ok('o escritorio de teste roda sem erro', r.codigo === 0, r.texto.slice(-600))) return s;
    const b = JSON.parse(r.texto.trim().split('\n').pop());
    const chamada = (await falsa.get('/__chamadas')).dados?.chamadas?.[0];
    const contexto = chamada?.sistemaCompleto || '';

    s.ok('nenhum agente de pacote pede a senha do gov.br ou do Meu INSS', b.pacotesQuePedem.length === 0, JSON.stringify(b.pacotesQuePedem));
    s.ok('nenhum roteiro de pacote tem a senha como documento obrigatorio', b.pacotesComSenhaObrigatoria.length === 0, JSON.stringify(b.pacotesComSenhaObrigatoria));
    s.ok('o pedido da senha e achado escrito de varios jeitos', b.frases.roteiroAntigo && b.frases.meEnvie && b.frases.obrigatoria, JSON.stringify(b.frases));
    s.ok(
      'a recusa, o "nao repita" e as regras de senha nao contam como pedido',
      !b.frases.regraNova && !b.frases.regraAte26 && !b.frases.naoRepetir && !b.frases.recusa,
      JSON.stringify(b.frases),
    );
    s.ok(
      'as regras antigas saem dos agentes ja instalados e o resto do prompt fica',
      b.trocados === 3 && !b.civel.antiga && b.civel.nova && b.civel.resto && !b.civel2.antiga && b.civel2.nova,
      JSON.stringify({ trocados: b.trocados, civel: b.civel, civel2: b.civel2 }),
    );
    s.ok('o roteiro instalado deixa de pedir a senha e o resto fica', !b.roteiro.pede && b.roteiro.resto, JSON.stringify(b.roteiro));
    s.ok('rodar de novo nao muda nada', b.deNovo === 0, JSON.stringify(b.deNovo));
    s.ok(
      'o pedido escrito a mao fica como esta, mas aparece pelo nome do agente',
      JSON.stringify(b.antes) === JSON.stringify(['Acidente Instalado', 'Agente Escrito a Mao']) &&
        JSON.stringify(b.depois) === JSON.stringify(['Agente Escrito a Mao']) &&
        b.aMao === 'Peça ao cliente a senha do gov.br.',
      JSON.stringify({ antes: b.antes, depois: b.depois }),
    );
    s.ok(
      'o agente recebe a regra que recusa a senha do gov.br',
      /Senha do gov\.br ou do Meu INSS: o escritório não pede nem aceita essa senha pelo WhatsApp/.test(contexto) && /Nunca peça/.test(contexto),
      contexto.slice(-900),
    );
    s.ok(
      'e a regra oferece o caminho seguro',
      /ele mesmo entra no Meu INSS/.test(contexto) && /representante \(procurador\) no Meu INSS/.test(contexto) && /atendimento com uma pessoa da equipe/.test(contexto),
      contexto.slice(-900),
    );
    s.ok('a regra antiga, que mandava aceitar a senha, nao aparece mais', !/Nunca diga a ele que não deve passar essa senha ao escritório/.test(contexto));
    s.ok(
      'e ela vem depois do prompt do agente, para valer sobre ele',
      contexto.indexOf(MARCA) !== -1 && contexto.indexOf(MARCA) < contexto.indexOf('Senha do gov.br ou do Meu INSS'),
    );
  } finally {
    await falsa.post('/__roteiro', { roteiro: [] });
    fs.rmSync(pasta, { recursive: true, force: true });
  }
  return s;
}
