import { spawn } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

import { suite } from './apoio.js';

/**
 * O portugues dos agentes, com acento (nucleo/acentos-dos-agentes.js). Pedido do
 * escritorio em 30/10/2026: "o portugues dos agentes esta sem acentos,
 * modifique isso em todos".
 *
 * O que nao pode falhar:
 *  - o que o sistema escreve (agentes e templates de exemplo, o Civel, as
 *    instrucoes ao modelo) sai com acento, e a conta de palavras sem acento nos
 *    pacotes e na base de exemplo e ZERO — assim, texto novo sem acento reprova;
 *  - os agentes JA instalados, que guardam a copia antiga, ganham o acento so nas
 *    linhas inteiras que o sistema escreveu; linha da equipe nao e tocada;
 *  - rodar de novo nao muda nada;
 *  - a lista de linhas esta em dia com o codigo: toda linha corrigida existe nos
 *    textos de agora (senao alguem mexeu no texto e esqueceu a lista);
 *  - o modelo recebe a regra de escrever com acento, mesmo que o roteiro nao tenha.
 */
export async function testarAcentosDosAgentes({ raiz }) {
  const s = suite('O portugues dos agentes sai com acento');
  const url = (arquivo) => JSON.stringify(pathToFileURL(path.join(raiz, arquivo)).href);
  const pasta = fs.mkdtempSync(path.join(os.tmpdir(), 'acentos-'));
  const script = path.join(pasta, 'acentos.mjs');
  fs.writeFileSync(
    script,
    `import { iniciarBanco, achar, inserir, listar, encerrarBanco } from ${url('servidor/nucleo/banco.js')};
import { semearSePrecisar } from ${url('servidor/nucleo/seed.js')};
import { PACOTES, TEMPLATES } from ${url('servidor/ia/pacotes.js')};
import { PARES_DE_ACENTO } from ${url('servidor/nucleo/acentos-pares.js')};
import { acentuarLinhas, corrigirAcentosDosAgentes, palavrasSemAcento, agentesSemAcento } from ${url('servidor/nucleo/acentos-dos-agentes.js')};
import { montarSistema } from ${url('servidor/ia/motor.js')};
iniciarBanco();
semearSePrecisar();
const resultado = {};

/* 1. O que o sistema escreve, hoje: zero palavra sem acento. */
const semAcentoNoSeed = [
  ...listar('agentes').map((a) => ['agente ' + a.nome, palavrasSemAcento(a.prompt)]),
  ...listar('templates').map((t) => ['template @' + t.atalho, palavrasSemAcento(t.conteudo)]),
  ...listar('conhecimento').map((c) => ['base ' + c.nome, palavrasSemAcento(c.conteudo)]),
].filter(([, palavras]) => palavras.length);
const semAcentoNosPacotes = [
  ...Object.entries(PACOTES).flatMap(([area, p]) => (p.agentes || []).map((a) => [area + '/' + a.nome, palavrasSemAcento(a.prompt)])),
  ...Object.entries(TEMPLATES).map(([atalho, [, conteudo]]) => ['template @' + atalho, palavrasSemAcento(conteudo)]),
].filter(([, palavras]) => palavras.length);
resultado.semAcentoNoSeed = semAcentoNoSeed;
resultado.semAcentoNosPacotes = semAcentoNosPacotes;
resultado.agentesDoCivel = (PACOTES.civel?.agentes || []).length;

/* 2. A lista esta em dia com o codigo: toda linha corrigida existe nos textos de agora. */
const textosDeAgora = new Set(
  [
    ...listar('agentes').map((a) => a.prompt),
    ...listar('templates').map((t) => t.conteudo),
    ...listar('conhecimento').map((c) => c.conteudo),
    ...Object.values(PACOTES).flatMap((p) => (p.agentes || []).map((a) => a.prompt)),
  ].flatMap((t) => String(t).split('\\n')),
);
resultado.linhasQueSumiram = PARES_DE_ACENTO.filter(([, certa]) => !textosDeAgora.has(certa)).map(([, certa]) => certa.slice(0, 80));
resultado.paresComAcentoNoAntigo = PARES_DE_ACENTO.filter(([antiga, certa]) => antiga === certa).length;

/* 3. Agentes JA instalados: a copia antiga, e a de uma equipe que mexeu. */
const [[antigaA, certaA], [antigaB, certaB], [antigaC, certaC]] = PARES_DE_ACENTO;
const linhaDaEquipe = 'Linha escrita pela equipe: voce nao deve mexer aqui';
inserir('workspaces', { id: 'w1', nome: 'Escritorio Antigo' });
inserir('agentes', { id: 'ag-intocado', workspaceId: 'w1', nome: 'Instalado e intocado', ativo: false, prompt: [antigaA, '', antigaB].join('\\n') });
inserir('agentes', { id: 'ag-editado', workspaceId: 'w1', nome: 'Editado pela equipe', ativo: false, prompt: [antigaA, linhaDaEquipe, antigaC].join('\\n') });
inserir('agentes', { id: 'ag-crlf', workspaceId: 'w1', nome: 'Com quebra do Windows', ativo: false, prompt: [antigaA, antigaB].join('\\r\\n') });
inserir('agentes', { id: 'ag-ja-certo', workspaceId: 'w1', nome: 'Ja com acento', ativo: false, prompt: [certaA, certaB].join('\\n') });
inserir('templates', { id: 'tp-antigo', workspaceId: 'w1', nome: 'Antigo', atalho: 'antigo', conteudo: antigaB });
inserir('conhecimento', { id: 'kb-antigo', workspaceId: 'w1', nome: 'Base antiga', conteudo: [antigaC, antigaA].join('\\n') });
const antesDeCorrigir = agentesSemAcento('w1').map((a) => a.agente);
const feito = corrigirAcentosDosAgentes();
resultado.antesDeCorrigir = antesDeCorrigir;
resultado.feito = feito;
resultado.intocado = achar('agentes', 'ag-intocado').prompt === [certaA, '', certaB].join('\\n');
resultado.editado = achar('agentes', 'ag-editado').prompt.split('\\n');
resultado.editadoEsperado = [certaA, linhaDaEquipe, certaC];
resultado.crlf = achar('agentes', 'ag-crlf').prompt === [certaA, certaB].join('\\r\\n');
resultado.template = achar('templates', 'tp-antigo').conteudo === certaB;
resultado.base = achar('conhecimento', 'kb-antigo').conteudo === [certaC, certaA].join('\\n');
resultado.depois = agentesSemAcento('w1').map((a) => a.agente);
const denovo = corrigirAcentosDosAgentes();
resultado.denovo = denovo;
resultado.acentuarLinhasIgual = acentuarLinhas('texto sem nenhuma linha da lista') === 'texto sem nenhuma linha da lista';
resultado.contaMenciaoEEtiqueta = palavrasSemAcento('Altere o @status para "Documentacao pendente" e adicione a @tag "Auxilio-acidente". @responsavel {{endereco}}').length;
resultado.contaFala = palavrasSemAcento('Voce nao precisa mandar a procuracao agora').length;

/* 4. O modelo recebe a regra de escrever com acento. */
const workspace = achar('workspaces', 'w1');
const agente = achar('agentes', 'ag-intocado');
inserir('contatos', { id: 'ct-1', workspaceId: 'w1', conexaoId: 'cx', telefone: '5581930000001', nome: 'Cliente', estado: 'ia', etiquetas: [] });
const sistema = montarSistema({ agente, contato: achar('contatos', 'ct-1'), workspace });
resultado.regraNoSistema = /português do Brasil correto, com todos os acentos/.test(sistema);
resultado.rotuloDoEscritorio = /DADOS DO ESCRITÓRIO:/.test(sistema);
resultado.instrucaoSemAcentoNoSistema = palavrasSemAcento(sistema.split('--- CONTEXTO DO SISTEMA')[1] || '');

console.log(JSON.stringify(resultado));
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

    s.ok('os agentes, templates e a base de exemplo saem sem palavra sem acento', b.semAcentoNoSeed.length === 0, JSON.stringify(b.semAcentoNoSeed));
    s.ok('os pacotes (inclusive os tres do Civel) tambem', b.agentesDoCivel === 5 && b.semAcentoNosPacotes.length === 0, JSON.stringify({ civel: b.agentesDoCivel, resto: b.semAcentoNosPacotes }));
    s.ok('a lista de linhas esta em dia: toda linha corrigida existe nos textos de agora', b.linhasQueSumiram.length === 0, JSON.stringify(b.linhasQueSumiram.slice(0, 4)));
    s.ok('e nenhum par troca uma linha por ela mesma', b.paresComAcentoNoAntigo === 0, String(b.paresComAcentoNoAntigo));

    s.ok(
      'antes de corrigir, os agentes instalados com a copia antiga aparecem como sem acento',
      ['Instalado e intocado', 'Editado pela equipe', 'Com quebra do Windows'].every((n) => b.antesDeCorrigir.includes(n)) && !b.antesDeCorrigir.includes('Ja com acento'),
      JSON.stringify(b.antesDeCorrigir),
    );
    s.ok('corrigir conta o que mudou: tres agentes, um template, um item da base', b.feito.agentes === 3 && b.feito.templates === 1 && b.feito.conhecimento === 1, JSON.stringify(b.feito));
    s.ok('o agente instalado e intocado fica com acento, linha por linha', b.intocado);
    s.ok(
      'o agente que a equipe editou: so as linhas do sistema ganham acento, a da equipe nao e tocada',
      JSON.stringify(b.editado) === JSON.stringify(b.editadoEsperado),
      JSON.stringify(b.editado),
    );
    s.ok('quebra de linha do Windows e mantida', b.crlf);
    s.ok('o template e a base de conhecimento instalados tambem', b.template && b.base);
    s.ok('depois, nenhum deles aparece como sem acento, a nao ser a linha da equipe', b.depois.length === 1 && b.depois[0] === 'Editado pela equipe', JSON.stringify(b.depois));
    s.ok('rodar de novo nao muda nada', b.denovo.agentes === 0 && b.denovo.templates === 0 && b.denovo.conhecimento === 0, JSON.stringify(b.denovo));
    s.ok('texto sem linha da lista fica como esta', b.acentuarLinhasIgual);
    s.ok('a conta nao cobra nome de etiqueta, status, mencao nem variavel', b.contaMenciaoEEtiqueta === 0, String(b.contaMenciaoEEtiqueta));
    s.ok('mas cobra fala sem acento', b.contaFala === 3, String(b.contaFala));

    s.ok('o modelo recebe a regra de escrever com acento, mesmo que o roteiro nao tenha', b.regraNoSistema);
    s.ok('o rotulo dos dados do escritorio sai com acento', b.rotuloDoEscritorio);
    s.ok('e as instrucoes do sistema ao modelo estao com acento', b.instrucaoSemAcentoNoSistema.length === 0, JSON.stringify(b.instrucaoSemAcentoNoSistema));
  } finally {
    fs.rmSync(pasta, { recursive: true, force: true });
  }
  return s;
}
