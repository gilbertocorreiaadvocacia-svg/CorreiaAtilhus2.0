import { spawn } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

import { cliente, suite } from './apoio.js';

/**
 * A IA le o PDF que o cliente manda. Pedido do escritorio em 26/10/2026: "a
 * IA nao consegue verificar PDF" — o agente via so "[documento: CNIS.pdf]".
 *
 * O que nao pode falhar:
 *  - o PDF vai para a IA como documento, uma vez, e o que ele diz fica gravado
 *    na mensagem;
 *  - o agente recebe esse texto junto do nome do arquivo, e responde;
 *  - na resposta seguinte o PDF nao e lido de novo, mas o texto continua na
 *    conversa;
 *  - PDF grande demais nao vai para a IA: o agente fica sabendo que nao deu
 *    para ler, e o motivo.
 *
 * A Anthropic e a de mentira, com roteiro: a marca e o comeco da instrucao de
 * leitura, que o prompt do agente de teste tambem carrega, para as duas
 * chamadas seguirem o roteiro, na ordem.
 */
const MARCA = 'LEITURA DE DOCUMENTO';
const LIDO = 'CNIS. Vinculo com a Empresa Exemplo Ltda de 01/2010 a 12/2015.';

export async function testarLeituraPdf({ anthropic, raiz }) {
  const s = suite('A IA le o PDF que o cliente manda');
  const url = (arquivo) => JSON.stringify(pathToFileURL(path.join(raiz, arquivo)).href);
  const falsa = cliente(anthropic);
  const pasta = fs.mkdtempSync(path.join(os.tmpdir(), 'leitura-pdf-'));

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

  const banco = url('servidor/nucleo/banco.js');
  const motor = url('servidor/ia/motor.js');
  const falas = `const falas = (id) => mensagensDe(id).filter((m) => m.direcao === 'saida' && !m.nota).map((m) => m.conteudo);`;

  /* Primeira resposta: o cliente mandou um PDF grande demais e depois o CNIS. */
  const primeira = path.join(pasta, 'primeira.mjs');
  fs.writeFileSync(
    primeira,
    `import { iniciarBanco, achar, inserir, inserirMensagem, listar, mensagensDe, encerrarBanco } from ${banco};
import { guardarBuffer } from ${url('servidor/nucleo/midia.js')};
import { retomarRespostasPendentes } from ${motor};
iniciarBanco();
${falas}
const ha = (min) => new Date(Date.now() - min * 60000).toISOString();
const pdf = (nome, paginas) =>
  guardarBuffer({ nome, mime: 'application/pdf', dados: Buffer.from('%PDF-1.4\\n' + '<< /Type /Page >>\\n'.repeat(paginas) + '%%EOF') });
inserir('workspaces', { id: 'w1', nome: 'Teste' });
inserir('integracoes', { id: 'int1', workspaceId: 'w1', ia: { chaveAnthropic: 'sk-ant-de-mentira' } });
inserir('conexoes', { id: 'conx-sim', workspaceId: 'w1', tipo: 'simulador' });
inserir('agentes', { id: 'ag-beatriz', workspaceId: 'w1', nome: 'Beatriz do Teste', ativo: true, delaySegundos: 1, modelo: 'claude-sonnet-5', prompt: 'Agente de teste (${MARCA} na marca). Use o que o cliente mandou.' });
const beatriz = { tipo: 'agente', id: 'ag-beatriz', nome: 'Beatriz do Teste' };
inserir('contatos', { id: 'c-pdf', workspaceId: 'w1', conexaoId: 'conx-sim', telefone: '5581931119201', nome: 'Cliente do PDF', estado: 'ia', responsavel: beatriz, ultimaEntradaEm: ha(1), ultimaSaidaEm: ha(10), etiquetas: [] });
inserirMensagem('c-pdf', { direcao: 'saida', tipo: 'texto', conteudo: 'Pode me mandar o seu CNIS?', autor: beatriz, situacao: 'enviada', criadoEm: ha(10) });
inserirMensagem('c-pdf', { id: 'm-grande', direcao: 'entrada', tipo: 'documento', conteudo: 'processo-inteiro.pdf', midia: pdf('processo-inteiro.pdf', 101), autor: { tipo: 'cliente' }, situacao: 'recebida', criadoEm: ha(2) });
inserirMensagem('c-pdf', { id: 'm-cnis', direcao: 'entrada', tipo: 'documento', conteudo: 'CNIS.pdf', midia: pdf('CNIS.pdf', 3), autor: { tipo: 'cliente' }, situacao: 'recebida', criadoEm: ha(1) });

retomarRespostasPendentes();
await new Promise((ok) => setTimeout(ok, 3500));
const mensagem = (id) => mensagensDe('c-pdf').find((m) => m.id === id);
console.log(JSON.stringify({
  cnis: { leitura: mensagem('m-cnis').leitura, erro: mensagem('m-cnis').leituraErro },
  grande: { leitura: mensagem('m-grande').leitura, erro: mensagem('m-grande').leituraErro },
  falas: falas('c-pdf'),
  leiturasCobradas: listar('creditos').filter((c) => c.acao === 'leitura_documento' && c.agenteId === 'ag-beatriz').length,
}));
await encerrarBanco();
process.exit(0);
`,
  );

  /* Segunda resposta: o cliente escreve de novo. */
  const segunda = path.join(pasta, 'segunda.mjs');
  fs.writeFileSync(
    segunda,
    `import { iniciarBanco, achar, atualizar, inserirMensagem, mensagensDe, encerrarBanco } from ${banco};
import { agendarResposta } from ${motor};
iniciarBanco();
${falas}
const agora = new Date().toISOString();
inserirMensagem('c-pdf', { direcao: 'entrada', tipo: 'texto', conteudo: 'Deu para ver?', autor: { tipo: 'cliente' }, situacao: 'recebida', criadoEm: agora });
atualizar('contatos', 'c-pdf', { ultimaEntradaEm: agora });
agendarResposta(achar('contatos', 'c-pdf'));
await new Promise((ok) => setTimeout(ok, 3000));
console.log(JSON.stringify({ falas: falas('c-pdf') }));
await encerrarBanco();
process.exit(0);
`,
  );

  try {
    await falsa.post('/__roteiro', { roteiro: [{ status: 200, texto: LIDO }, { status: 200, texto: 'Recebi o seu CNIS, obrigada!' }], marca: MARCA });
    const r1 = await rodar(primeira);
    if (!s.ok('a primeira resposta roda sem erro', r1.codigo === 0, r1.texto.slice(-600))) return s;
    const b1 = JSON.parse(r1.texto.trim().split('\n').pop());
    const [leitura, resposta] = (await falsa.get('/__chamadas')).dados?.chamadas || [];

    s.ok('o PDF vai para a IA como documento', /"type":"document"/.test(leitura?.ultimaMensagem || '') && /application\/pdf/.test(leitura?.ultimaMensagem || ''), leitura?.ultimaMensagem?.slice(0, 300));
    s.ok('com a instrucao de leitura', (leitura?.sistemaCompleto || '').startsWith('LEITURA DE DOCUMENTO'), leitura?.sistemaCompleto?.slice(0, 80));
    s.ok('o que o PDF diz fica gravado na mensagem', b1.cnis.leitura === LIDO, JSON.stringify(b1.cnis));
    s.ok(
      'o agente recebe o que esta escrito no PDF, junto do nome do arquivo',
      /CNIS\.pdf/.test(resposta?.mensagens || '') && (resposta?.mensagens || '').includes('O QUE ESTA ESCRITO NESTE PDF') && (resposta?.mensagens || '').includes(LIDO),
      resposta?.mensagens?.slice(-600),
    );
    s.ok('e responde ao cliente', b1.falas.includes('Recebi o seu CNIS, obrigada!'), JSON.stringify(b1.falas));
    s.ok('o PDF grande demais nao vai para a IA: fica o motivo', !b1.grande.leitura && /100 paginas/.test(b1.grande.erro || ''), JSON.stringify(b1.grande));
    s.ok('e o agente fica sabendo que nao deu para ler', (resposta?.mensagens || '').includes('o sistema não conseguiu ler este PDF'), resposta?.mensagens?.slice(0, 600));
    s.ok('a leitura conta no consumo do agente, uma vez', b1.leiturasCobradas === 1, JSON.stringify(b1.leiturasCobradas));

    await falsa.post('/__roteiro', { roteiro: [{ status: 200, texto: 'Deu sim! Vi os seus vinculos.' }], marca: MARCA });
    const r2 = await rodar(segunda);
    if (!s.ok('a segunda resposta roda sem erro', r2.codigo === 0, r2.texto.slice(-600))) return s;
    const b2 = JSON.parse(r2.texto.trim().split('\n').pop());
    const chamadas = (await falsa.get('/__chamadas')).dados?.chamadas || [];

    s.ok('na resposta seguinte o PDF nao e lido de novo', chamadas.length === 1 && !(chamadas[0]?.sistemaCompleto || '').startsWith('LEITURA DE DOCUMENTO'), JSON.stringify(chamadas.map((c) => c.sistema)));
    s.ok('mas o que ele diz continua na conversa', (chamadas[0]?.mensagens || '').includes(LIDO), chamadas[0]?.mensagens?.slice(0, 600));
    s.ok('e o agente responde', b2.falas.includes('Deu sim! Vi os seus vinculos.'), JSON.stringify(b2.falas));
  } finally {
    await falsa.post('/__roteiro', { roteiro: [] });
    fs.rmSync(pasta, { recursive: true, force: true });
  }
  return s;
}
