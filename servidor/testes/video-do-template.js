import { spawn } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

import { cliente, suite } from './apoio.js';

/**
 * O video de boas-vindas. Pedido do escritorio em 26/10/2026: "verifique se
 * ja tem o video de boas-vindas".
 *
 * O que nao pode falhar:
 *  - excluir uma conversa que recebeu o video de um template nao apaga o
 *    video do servidor (o anexo proprio da conversa continua indo embora);
 *  - o template de pacote que ainda e o texto de exemplo ganha o template de
 *    verdade do escritorio, texto e video: @bemvindo o do @boas-vindas, e o
 *    mesmo atalho de outro escritorio; o que alguem editou fica como esta, e
 *    arquivo que sumiu nao serve de fonte;
 *  - a Saude acusa o template cujo arquivo sumiu do servidor (endereco de
 *    fora nao conta), e o /api/saude mostra o que cada template leva.
 */
export async function testarVideoDoTemplate({ base, raiz }) {
  const s = suite('O video de boas-vindas chega ao cliente e nao some do servidor');
  const api = cliente(base);
  await api.entrar();

  /* ---------------- Excluir a conversa nao apaga o video do template ---------------- */

  const simulador = ((await api.get('/api/conexoes')).dados || []).find((c) => c.tipo === 'simulador');
  if (!s.ok('ha conexao de simulador', Boolean(simulador))) return s;
  const subir = async (nome, mime) =>
    (await api.post('/api/midia', { nome, mime, conteudoBase64: `data:${mime};base64,${Buffer.from(`conteudo de ${nome}`).toString('base64')}` })).dados;
  const noServidor = async (midia) => (await fetch(`${base}${midia.url}`)).status === 200;

  const video = await subir('boas-vindas-do-teste.mp4', 'video/mp4');
  const anexo = await subir('laudo-do-teste.pdf', 'application/pdf');
  const template = (await api.post('/api/templates', { nome: 'Boas-vindas (exclusao)', atalho: 'boasvindasexclusao', conteudo: 'Ola! Assista ao video.', midia: video })).dados;
  const contato = (await api.post('/api/contatos', { conexaoId: simulador.id, telefone: '5581931119101', nome: 'Cliente do Video' })).dados;
  if (!s.ok('template com video e conversa criados', Boolean(video?.url && anexo?.url && template?.id && contato?.id), JSON.stringify({ video, template, contato }))) return s;

  await api.post(`/api/contatos/${contato.id}/mensagens`, { templateId: template.id });
  await api.post(`/api/contatos/${contato.id}/mensagens`, { conteudo: 'Segue o laudo', midia: anexo });
  s.ok('antes de excluir, os dois arquivos estao no servidor', (await noServidor(video)) && (await noServidor(anexo)));
  await api.delete(`/api/contatos/${contato.id}`);
  s.ok('excluida a conversa, o video do template continua no servidor', await noServidor(video));
  s.ok('e o anexo que era so da conversa vai embora', !(await noServidor(anexo)));
  await api.delete(`/api/templates/${template.id}`);

  /* ---------------- O template de exemplo ganha o video do escritorio ---------------- */

  const url = (arquivo) => JSON.stringify(pathToFileURL(path.join(raiz, arquivo)).href);
  const pasta = fs.mkdtempSync(path.join(os.tmpdir(), 'video-do-template-'));
  const script = path.join(pasta, 'videos.mjs');
  fs.writeFileSync(
    script,
    `import { iniciarBanco, achar, inserir, listar, encerrarBanco } from ${url('servidor/nucleo/banco.js')};
import { guardarBuffer } from ${url('servidor/nucleo/midia.js')};
import { prepararEscritorio, templatesDoPacoteGanhamOArquivo } from ${url('servidor/ia/pacotes.js')};
import { diagnosticar, resumoDosTemplates } from ${url('servidor/nucleo/diagnostico.js')};
iniciarBanco();

const video = (nome) => guardarBuffer({ nome, dados: Buffer.from('video ' + nome), mime: 'video/mp4' });
const template = (id, workspaceId, atalho, conteudo, midia = null) =>
  inserir('templates', { id, workspaceId, nome: atalho, atalho, conteudo, midia, categoriaMeta: 'utilidade' });

/* O escritorio geral: o @boas-vindas do escritorio, com video, um @oab que
   alguem editou, e os templates que a instalacao criou so com o texto. */
inserir('workspaces', { id: 'w-geral', nome: 'Correia Advogados' });
template('t-boas-vindas', 'w-geral', 'boas-vindas', 'Ola! Seja muito bem-vindo(a)! Assista ao nosso video de boas-vindas.', video('boas-vindas.mp4'));
template('t-oab', 'w-geral', 'oab', 'Texto do escritorio.');
prepararEscritorio('w-geral', { templates: ['bemvindo', 'recepcaotrabalhista', 'videoproposta'] });
inserir('agentes', { id: 'ag-juliana', workspaceId: 'w-geral', nome: 'Juliana', ativo: true, prompt: 'Envie o template @bemvindo e depois o @videoproposta.' });

/* O Trabalhista tem a recepcao com video; o Previdenciario, a proposta com o
   arquivo apagado do servidor e outra com endereco de fora. */
inserir('workspaces', { id: 'w-trab', nome: 'Trabalhista', area: 'trabalhista' });
template('t-recepcao-trab', 'w-trab', 'recepcaotrabalhista', 'Recepcao do escritorio, com video.', video('recepcao.mp4'));
inserir('workspaces', { id: 'w-prev', nome: 'Previdenciario', area: 'previdenciario' });
template('t-proposta-sumiu', 'w-prev', 'videoproposta', 'Proposta do escritorio.', { tipo: 'video', url: '/midia/arquivo-que-sumiu.mp4', arquivo: 'arquivo-que-sumiu.mp4' });
template('t-de-fora', 'w-prev', 'videofora', 'Video que mora fora.', { tipo: 'video', url: 'https://exemplo.com/video.mp4' });
inserir('agentes', { id: 'ag-andreia', workspaceId: 'w-prev', nome: 'Andreia', ativo: true, prompt: 'Envie o template @videoproposta e o @videofora.' });

const doGeral = (atalho) => listar('templates', { workspaceId: 'w-geral' }).find((t) => t.atalho === atalho);
const preenchidos = templatesDoPacoteGanhamOArquivo();
const deNovo = templatesDoPacoteGanhamOArquivo();
const alertas = diagnosticar('w-prev').achados || [];
console.log(JSON.stringify({
  preenchidos,
  deNovo,
  bemvindo: doGeral('bemvindo'),
  boasVindas: achar('templates', 't-boas-vindas'),
  recepcao: doGeral('recepcaotrabalhista'),
  recepcaoTrab: achar('templates', 't-recepcao-trab'),
  proposta: doGeral('videoproposta'),
  oab: achar('templates', 't-oab'),
  sumiu: alertas.find((a) => a.id === 'template-com-arquivo-sumido') || null,
  resumo: resumoDosTemplates('w-geral'),
}));
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
    if (!s.ok('o escritorio de teste roda sem erro', r.codigo === 0, r.texto.slice(-600))) return s;
    const b = JSON.parse(r.texto.trim().split('\n').pop());

    s.ok(
      'o @bemvindo de exemplo ganha o texto e o video do @boas-vindas do escritorio',
      b.bemvindo?.conteudo === b.boasVindas?.conteudo && b.bemvindo?.midia?.url === b.boasVindas?.midia?.url,
      JSON.stringify(b.bemvindo),
    );
    s.ok(
      'a @recepcaotrabalhista de exemplo ganha a do escritorio Trabalhista',
      b.recepcao?.conteudo === b.recepcaoTrab?.conteudo && b.recepcao?.midia?.url === b.recepcaoTrab?.midia?.url,
      JSON.stringify(b.recepcao),
    );
    s.ok('arquivo que sumiu do servidor nao serve de fonte: a @videoproposta fica so com o texto', !b.proposta?.midia, JSON.stringify(b.proposta));
    s.ok('o template que alguem editou fica como esta', b.oab?.conteudo === 'Texto do escritorio.' && !b.oab?.midia, JSON.stringify(b.oab));
    s.ok('preenche os dois, e rodar de novo nao muda nada', b.preenchidos === 2 && b.deNovo === 0, JSON.stringify({ preenchidos: b.preenchidos, deNovo: b.deNovo }));
    s.ok(
      'a Saude acusa o template cujo arquivo sumiu, com o agente e o atalho',
      /Andreia/.test(b.sumiu?.detalhe || '') && /@videoproposta/.test(b.sumiu?.detalhe || ''),
      JSON.stringify(b.sumiu),
    );
    s.ok('e o video com endereco de fora nao conta como sumido', !/@videofora/.test(b.sumiu?.detalhe || ''), JSON.stringify(b.sumiu));
    s.ok(
      'o /api/saude mostra o que cada template leva e quais os agentes usam',
      b.resumo?.bemvindo === 'video, agentes usam' &&
        b.resumo?.videoproposta === 'texto, agentes usam' &&
        b.resumo?.['boas-vindas'] === 'video' &&
        b.resumo?.oab === 'texto',
      JSON.stringify(b.resumo),
    );
  } finally {
    fs.rmSync(pasta, { recursive: true, force: true });
  }
  return s;
}
