import { spawn } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

import { cliente, suite } from './apoio.js';

/**
 * Senha do gov.br. Pedido do escritorio em 26/10/2026: "quero que tire de
 * todos os agentes o que fala que nao pode compartilhar a senha do gov" — o
 * agente tinha respondido a um cliente de auxilio-acidente que mandou a senha
 * "nunca compartilhe sua senha do gov.br, nao precisamos dela".
 *
 * O que nao pode falhar:
 *  - nenhum agente de pacote diz ao cliente para nao passar a senha do gov.br,
 *    nem que ela nao e necessaria;
 *  - a regra antiga do Civel sai dos agentes ja instalados, em qualquer
 *    escritorio, e rodar de novo nao muda nada;
 *  - o aviso escrito a mao fica como esta, mas aparece pelo nome do agente
 *    (o /api/saude mostra);
 *  - pedir a senha como documento e nao repeti-la nao contam como aviso;
 *  - todo agente recebe a regra da senha do gov.br no contexto, depois do
 *    prompt dele (montarSistema, em ia/motor.js).
 *
 * A Anthropic e a de mentira, com roteiro (ver passagem-de-verdade.js).
 */
const MARCA = 'MARCA-DA-SUITE-DA-SENHA-DO-GOV';

export async function testarSenhaDoGov({ anthropic, raiz }) {
  const s = suite('Nenhum agente diz ao cliente que nao pode passar a senha do gov.br');
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
import { ESCRITORIO_GERAL, EQUIPE_TRABALHISTA_NO_GERAL, PACOTES, REGRA_DA_SENHA, REGRA_DA_SENHA_ATE_26_10 } from ${url('servidor/ia/pacotes.js')};
import { agentesComAvisoDaSenhaDoGov, avisaParaNaoPassarASenhaDoGov, tirarAvisoDaSenhaDoGov } from ${url('servidor/nucleo/senha-do-gov.js')};
import { retomarRespostasPendentes } from ${url('servidor/ia/motor.js')};
iniciarBanco();

const dosPacotes = [...Object.values(PACOTES).flatMap((p) => p.agentes), ...ESCRITORIO_GERAL.agentes, ...EQUIPE_TRABALHISTA_NO_GERAL.agentes];
const pacotesComAviso = dosPacotes.filter((a) => avisaParaNaoPassarASenhaDoGov(a.prompt)).map((a) => a.nome);
const frases = {
  compartilhar: avisaParaNaoPassarASenhaDoGov('Por favor, nunca compartilhe sua senha do gov.br com ninguém, nem com a equipe.'),
  naoPrecisamos: avisaParaNaoPassarASenhaDoGov('Se o cliente mandar a senha do INSS, diga que não precisamos dela.'),
  regraAntiga: avisaParaNaoPassarASenhaDoGov(REGRA_DA_SENHA_ATE_26_10),
  regraNova: avisaParaNaoPassarASenhaDoGov(REGRA_DA_SENHA),
  naoRepetir: avisaParaNaoPassarASenhaDoGov('SENHA DO GOV: nunca repita a senha em mensagem, resumo ou nota.'),
  pedirComoDocumento: avisaParaNaoPassarASenhaDoGov('Peça, um de cada vez: RG e CPF (ou CNH); senha do INSS ou GOV; CAT; laudo médico.'),
};

/* Escritorio sem area: um agente com a regra antiga do Civel, um com o aviso
   escrito a mao e o cliente que mandou a senha, esperando resposta. */
const ha = (min) => new Date(Date.now() - min * 60000).toISOString();
inserir('workspaces', { id: 'w1', nome: 'Teste' });
inserir('integracoes', { id: 'int1', workspaceId: 'w1', ia: { chaveAnthropic: 'sk-ant-de-mentira' } });
inserir('conexoes', { id: 'conx-sim', workspaceId: 'w1', tipo: 'simulador' });
inserir('agentes', { id: 'ag-civel', workspaceId: 'w1', nome: 'Secretaria Antiga', ativo: true, prompt: 'Atenda.\\n' + REGRA_DA_SENHA_ATE_26_10 + '\\n- Documento em foto: leia.' });
inserir('agentes', { id: 'ag-a-mao', workspaceId: 'w1', nome: 'Agente Escrito a Mao', ativo: true, prompt: 'Nunca compartilhe a senha do gov.br, avise o cliente.' });
inserir('agentes', { id: 'ag-acidente', workspaceId: 'w1', nome: 'Acidente', ativo: true, delaySegundos: 1, modelo: 'claude-sonnet-5', prompt: '${MARCA}. Peça a senha do INSS ou GOV.' });
const acidente = { tipo: 'agente', id: 'ag-acidente', nome: 'Acidente' };
inserir('contatos', { id: 'c-senha', workspaceId: 'w1', conexaoId: 'conx-sim', telefone: '5581931119001', nome: 'Cliente da Senha', estado: 'ia', responsavel: acidente, ultimaEntradaEm: ha(1), ultimaSaidaEm: ha(2), etiquetas: [] });
inserirMensagem('c-senha', { direcao: 'saida', tipo: 'texto', conteudo: 'Me envie a senha do gov.br, por favor.', autor: acidente, situacao: 'enviada', criadoEm: ha(2) });
inserirMensagem('c-senha', { direcao: 'entrada', tipo: 'texto', conteudo: 'Segue a senha do gov: exemplo123', autor: { tipo: 'cliente' }, situacao: 'recebida', criadoEm: ha(1) });

const antes = agentesComAvisoDaSenhaDoGov('w1');
const trocados = tirarAvisoDaSenhaDoGov();
const deNovo = tirarAvisoDaSenhaDoGov();
const civel = achar('agentes', 'ag-civel').prompt;

retomarRespostasPendentes();
await new Promise((ok) => setTimeout(ok, 3500));
console.log(JSON.stringify({
  pacotesComAviso,
  frases,
  antes,
  trocados,
  deNovo,
  civel: { antiga: civel.includes(REGRA_DA_SENHA_ATE_26_10), nova: civel.includes(REGRA_DA_SENHA), resto: civel.startsWith('Atenda.') && civel.endsWith('- Documento em foto: leia.') },
  depois: agentesComAvisoDaSenhaDoGov('w1'),
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

    s.ok('nenhum agente de pacote diz ao cliente para nao passar a senha do gov.br', b.pacotesComAviso.length === 0, JSON.stringify(b.pacotesComAviso));
    s.ok('o aviso e achado escrito de varios jeitos', b.frases.compartilhar && b.frases.naoPrecisamos && b.frases.regraAntiga, JSON.stringify(b.frases));
    s.ok(
      'pedir a senha como documento, nao repeti-la e a regra nova nao contam como aviso',
      !b.frases.pedirComoDocumento && !b.frases.naoRepetir && !b.frases.regraNova,
      JSON.stringify(b.frases),
    );
    s.ok(
      'a regra antiga do Civel sai do agente ja instalado, num escritorio sem area, e o resto do prompt fica',
      b.trocados === 1 && !b.civel.antiga && b.civel.nova && b.civel.resto,
      JSON.stringify({ trocados: b.trocados, civel: b.civel }),
    );
    s.ok('rodar de novo nao muda nada', b.deNovo === 0, JSON.stringify(b.deNovo));
    s.ok(
      'o aviso escrito a mao fica como esta, mas aparece pelo nome do agente',
      JSON.stringify(b.antes) === JSON.stringify(['Secretaria Antiga', 'Agente Escrito a Mao']) &&
        JSON.stringify(b.depois) === JSON.stringify(['Agente Escrito a Mao']) &&
        b.aMao === 'Nunca compartilhe a senha do gov.br, avise o cliente.',
      JSON.stringify({ antes: b.antes, depois: b.depois }),
    );
    s.ok(
      'o agente recebe a regra da senha do gov.br no contexto',
      /Senha do gov\.br ou do Meu INSS/.test(contexto) && /Nunca diga a ele que nao deve passar essa senha ao escritorio/.test(contexto),
      contexto.slice(-700),
    );
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
