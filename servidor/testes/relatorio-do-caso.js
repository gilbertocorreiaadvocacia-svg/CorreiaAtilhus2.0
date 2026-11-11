import { spawn } from 'node:child_process';
import { createRequire } from 'node:module';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

import { suite } from './apoio.js';

/**
 * O relatorio do caso num PDF so (nucleo/relatorio-do-caso.js).
 *
 * Pedido do escritorio em 11/11/2026: "um botao em que ao clicar ele vai fazer
 * o relatorio do caso, com todos os dados do cliente e com suas
 * documentacoes".
 *
 * O QUE NAO PODE FALHAR, e por que cada um importa:
 *
 *  - os documentos entram DE VERDADE, com as paginas deles. E a diferenca
 *    entre este relatorio e a ficha impressa, que so listava os nomes;
 *  - um anexo quebrado NAO derruba o relatorio inteiro, e nao some calado:
 *    vai escrito na ultima pagina. Um documento que falha em silencio e o pior
 *    desfecho aqui — quem protocola confia no PDF e descobre a falta no balcao;
 *  - nome de cliente com acento e emoji nao quebra a geracao. As fontes padrao
 *    do PDF nao tem esses caracteres, e pdf-lib LANCA quando encontra um;
 *  - o PDF sai valido (comeca com %PDF e da para reabrir e contar as paginas).
 *
 * Roda em processo separado, com pasta propria de dados e de arquivos: o
 * relatorio le arquivo do disco, e isso precisa de uma arvore controlada.
 */
export async function testarRelatorioDoCaso({ raiz }) {
  const s = suite('Relatorio do caso num PDF so');
  const url = (arquivo) => JSON.stringify(pathToFileURL(path.join(raiz, arquivo)).href);
  /* O script roda de uma pasta temporaria, e o Node resolve `pdf-lib` a partir
     do arquivo, nao do cwd: de la ele nao acha o node_modules do projeto.
     Entao o caminho vai resolvido daqui, igual aos modulos do sistema. */
  const pdfLib = JSON.stringify(pathToFileURL(createRequire(path.join(raiz, 'package.json')).resolve('pdf-lib')).href);
  const pasta = fs.mkdtempSync(path.join(os.tmpdir(), 'relatorio-caso-'));
  const arquivos = path.join(pasta, 'arquivos', 'c1');
  fs.mkdirSync(arquivos, { recursive: true });

  /* Um PDF de duas paginas e uma imagem, feitos aqui com a mesma biblioteca
     que o relatorio usa: assim o teste nao depende de nenhum binario guardado
     no repositorio. */
  const preparar = path.join(pasta, 'preparar.mjs');
  fs.writeFileSync(
    preparar,
    `import fs from 'node:fs';
import { PDFDocument } from ${pdfLib};
const pdf = await PDFDocument.create();
pdf.addPage([300, 400]).drawText('CNIS pagina 1', { x: 20, y: 350, size: 12 });
pdf.addPage([300, 400]).drawText('CNIS pagina 2', { x: 20, y: 350, size: 12 });
fs.writeFileSync(${JSON.stringify(path.join(arquivos, 'cnis.pdf'))}, await pdf.save());

/* PNG 2x2 minimo, montado pela propria pdf-lib para nao guardar binario aqui. */
const comImagem = await PDFDocument.create();
const png = await comImagem.embedPng(Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAIAAAACCAYAAABytg0kAAAAFElEQVR4nGP8z8DwnwEJMCFzBgcHAFPqAwoAC8+bAAAAAElFTkSuQmCC',
  'base64',
));
fs.writeFileSync(${JSON.stringify(path.join(arquivos, 'rg.png'))}, Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAIAAAACCAYAAABytg0kAAAAFElEQVR4nGP8z8DwnwEJMCFzBgcHAFPqAwoAC8+bAAAAAElFTkSuQmCC',
  'base64',
));
/* Um arquivo que NAO e PDF, com nome de PDF: e o anexo quebrado do teste. */
fs.writeFileSync(${JSON.stringify(path.join(arquivos, 'laudo.pdf'))}, 'isto nao e um pdf');
console.log('preparado', png ? '' : '');
`,
  );

  const script = path.join(pasta, 'relatorio.mjs');
  fs.writeFileSync(
    script,
    `import { PDFDocument } from ${pdfLib};
import { iniciarBanco, inserir, encerrarBanco } from ${url('servidor/nucleo/banco.js')};
import { relatorioDoCaso } from ${url('servidor/nucleo/relatorio-do-caso.js')};
iniciarBanco();

inserir('workspaces', { id: 'w1', nome: 'Correia' });
inserir('agentes', { id: 'ag1', workspaceId: 'w1', nome: 'Triagem BPC/LOAS' });
inserir('etiquetas', { id: 'et1', workspaceId: 'w1', nome: 'BPC/LOAS', cor: 'var(--serie-3)' });
inserir('contatos', {
  id: 'c1',
  workspaceId: 'w1',
  /* Acento e emoji de proposito: as fontes padrao do PDF nao tem os dois, e
     pdf-lib lanca quando encontra um caractere fora da tabela. */
  nome: 'Conceição Araújo 🌟',
  telefone: '5581980001234',
  etiquetas: ['et1'],
  variaveis: { cpf: '12345678909', endereco: 'Rua das Flores, 10, Timbaúba-PE', nascimento: '12/03/1975', vazio: '   ' },
  arquivos: [
    { id: 'a1', nome: 'CNIS.pdf', caminho: 'c1/cnis.pdf', tamanho: 10, tipo: 'documento' },
    { id: 'a2', nome: 'RG.png', caminho: 'c1/rg.png', tamanho: 10, tipo: 'documento' },
    { id: 'a3', nome: 'Laudo.pdf', caminho: 'c1/laudo.pdf', tamanho: 10, tipo: 'documento' },
    { id: 'a4', nome: 'Sumiu.pdf', caminho: 'c1/nao-existe.pdf', tamanho: 10, tipo: 'documento' },
  ],
});
inserir('contratos', {
  id: 'ct1',
  workspaceId: 'w1',
  contatoId: 'c1',
  agenteId: 'ag1',
  situacao: 'assinado',
  assinadoEm: '2026-11-10T15:00:00.000Z',
  aprovadoPor: { tipo: 'membro', id: 'm1', nome: 'Dani' },
});

/*
 * O CASO FECHADO SEM CONTRATO DA ZAPSIGN, que e a maioria neste escritorio:
 * conversa na coluna de tipo "sucesso", nenhum contrato, e o log do funil
 * dizendo quem a moveu para la. Enquanto o relatorio dependia do contrato, ele
 * simplesmente nao existia para esses casos.
 */
inserir('status', { id: 'st-sucesso', workspaceId: 'w1', nome: 'Contrato fechado', tipo: 'sucesso' });
inserir('contatos', {
  id: 'c2',
  workspaceId: 'w1',
  nome: 'Rick Sem Zapsign',
  telefone: '5582820138 86',
  statusId: 'st-sucesso',
  responsavel: { tipo: 'agente', id: 'ag1', nome: 'Triagem BPC/LOAS' },
  variaveis: { cpf: '07579533448' },
  arquivos: [{ id: 'b1', nome: 'CNIS.pdf', caminho: 'c1/cnis.pdf', tamanho: 10, tipo: 'documento' }],
});
inserir('logs', {
  workspaceId: 'w1',
  contatoId: 'c2',
  tipo: 'status',
  descricao: 'Status: Qualificado -> Contrato fechado',
  autor: { tipo: 'membro', nome: 'Milena' },
  dados: { statusId: 'st-sucesso', tipo: 'sucesso', anteriorId: null },
});

const ctx = { workspaceId: 'w1', papel: 'owner' };
const semZapsign = await relatorioDoCaso(ctx, { contatoId: 'c2' });
const fichaSemZapsign = (await import(${url('servidor/nucleo/ficha-do-contrato.js')})).fichaDoCaso(ctx, { contatoId: 'c2' });
const r = await relatorioDoCaso(ctx, 'ct1');
const relido = await PDFDocument.load(r.bytes);
const inexistente = await relatorioDoCaso(ctx, 'ct-naoexiste');

console.log(JSON.stringify({
  nome: r.nome,
  ehPdf: r.bytes.slice(0, 5).toString('latin1'),
  tamanho: r.bytes.length,
  paginas: relido.getPageCount(),
  titulo: relido.getTitle(),
  documentos: r.documentos,
  falhas: r.falhas,
  inexistente,
  semZapsign: {
    nome: semZapsign?.nome,
    ehPdf: semZapsign?.bytes.slice(0, 5).toString('latin1'),
    paginas: (await PDFDocument.load(semZapsign.bytes)).getPageCount(),
    documentos: semZapsign?.documentos,
  },
  fichaSemZapsign: {
    temZapsign: fichaSemZapsign?.contrato?.temZapsign,
    situacao: fichaSemZapsign?.contrato?.situacao,
    fechadoEm: Boolean(fichaSemZapsign?.contrato?.assinadoEm),
    aprovadoPor: fichaSemZapsign?.contrato?.aprovadoPor,
    agente: fichaSemZapsign?.contrato?.agente?.nome,
  },
}));
await encerrarBanco();
process.exit(0);
`,
  );

  try {
    const rodar = (arquivo) =>
      new Promise((resolve) => {
        const p = spawn(process.execPath, [arquivo], {
          cwd: raiz,
          env: { ...process.env, CORREIA_DADOS: pasta },
          stdio: ['ignore', 'pipe', 'pipe'],
        });
        let texto = '';
        p.stdout.on('data', (d) => (texto += d));
        p.stderr.on('data', (d) => (texto += d));
        p.on('close', (codigo) => resolve({ codigo, texto }));
      });

    const preparado = await rodar(preparar);
    if (!s.ok('os documentos de teste foram criados', preparado.codigo === 0, preparado.texto.slice(-400))) return s;

    const r = await rodar(script);
    if (!s.ok('o relatorio roda sem erro', r.codigo === 0, r.texto.slice(-800))) return s;
    const b = JSON.parse(r.texto.trim().split('\n').pop());

    s.ok('sai um PDF de verdade', b.ehPdf === '%PDF-', b.ehPdf);
    s.ok('que da para reabrir e contar as paginas', b.paginas > 0, String(b.paginas));

    /*
     * 1 pagina de relatorio + 2 do CNIS + 1 da imagem + 1 do aviso de falhas.
     * O numero exato importa: se o CNIS entrasse so como nome, daria 3 — e e
     * exatamente o defeito que este relatorio existe para resolver.
     */
    s.ok('o PDF anexado entra com as paginas dele, e nao so com o nome', b.paginas === 5, `${b.paginas} paginas`);

    s.ok('o nome do arquivo sai limpo, sem acento nem emoji', b.nome === 'Conceicao-Araujo-caso.pdf', b.nome);
    /* O titulo MANTEM o acento: "Conceicao" cabe na tabela do PDF e e o nome
       da pessoa. O que nao pode sobrar e o emoji virado em "??" pendurado no
       fim, que faz o documento parecer corrompido. */
    s.ok(
      'o titulo mantem o acento e nao fica com sobra de emoji',
      b.titulo === 'Relatorio do caso - Conceição Araújo',
      b.titulo || '',
    );

    /* As duas falhas: o arquivo que nao e PDF e o que sumiu do disco. */
    const porNome = Object.fromEntries((b.falhas || []).map((f) => [f.nome, f.motivo]));
    s.ok('o anexo quebrado nao derruba o relatorio', b.paginas === 5 && b.falhas.length === 2, JSON.stringify(b.falhas));
    s.ok('o arquivo que sumiu do disco e apontado', /nao esta mais no disco|não está mais no disco/.test(porNome['Sumiu.pdf'] || ''), porNome['Sumiu.pdf'] || '(nada)');
    s.ok('e o que nao e PDF de verdade tambem', Boolean(porNome['Laudo.pdf']), porNome['Laudo.pdf'] || '(nada)');
    s.ok('os quatro anexos sao contados, inclusive os que falharam', b.documentos === 4, String(b.documentos));

    s.ok('contrato que nao existe devolve nulo, e nao um PDF vazio', b.inexistente === null, JSON.stringify(b.inexistente));

    /* ---- O caso fechado SEM contrato da ZapSign ---- */
    s.ok(
      'o caso fechado sem contrato da ZapSign tambem gera relatorio',
      b.semZapsign?.ehPdf === '%PDF-' && b.semZapsign?.nome === 'Rick-Sem-Zapsign-caso.pdf',
      JSON.stringify(b.semZapsign),
    );
    s.ok(
      'e os documentos dele entram do mesmo jeito (1 relatorio + 2 do CNIS)',
      b.semZapsign?.paginas === 3 && b.semZapsign?.documentos === 1,
      JSON.stringify(b.semZapsign),
    );
    s.ok('a ficha marca que nao ha contrato da ZapSign', b.fichaSemZapsign?.temZapsign === false, JSON.stringify(b.fichaSemZapsign));
    s.ok(
      'quem fechou sai do historico do funil, que e o unico registro que existe',
      b.fichaSemZapsign?.aprovadoPor?.nome === 'Milena' && b.fichaSemZapsign?.aprovadoPor?.moveuAColuna === true,
      JSON.stringify(b.fichaSemZapsign?.aprovadoPor),
    );
    s.ok(
      'e o agente que conduziu vem do responsavel da conversa',
      b.fichaSemZapsign?.agente === 'Triagem BPC/LOAS',
      String(b.fichaSemZapsign?.agente),
    );
    s.ok('a data do fechamento vem da entrada na coluna', b.fichaSemZapsign?.fechadoEm === true, JSON.stringify(b.fichaSemZapsign));
  } finally {
    fs.rmSync(pasta, { recursive: true, force: true });
  }
  return s;
}
