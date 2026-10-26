import { spawn } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

import { cliente, suite } from './apoio.js';

/**
 * Passagem de verdade. Pedido do escritorio em 24/10/2026: "quando o agente
 * disser que vai encaminhar para outro agente, o outro manda mensagem em
 * seguida, se apresentando e pedindo para contar os detalhes — tem conversa
 * em que ele disse que ia repassar e nao repassou".
 *
 * O que nao pode falhar:
 *  - todo agente tem a ferramenta de passar a conversa, cite o prompt
 *    @responsavel ou nao (o pos-venda dizia "transfira" so em texto);
 *  - o agente que escreve "ja vou te encaminhar" sem passar ganha uma volta
 *    para passar de verdade, e a promessa solta nao sai;
 *  - quem recebe se apresenta e pede os detalhes na primeira fala, e so nela,
 *    quando o cliente foi avisado da passagem — a passagem calada, dentro de
 *    uma equipe, continua calada;
 *  - um agente de area passa para a equipe sem area (a Eduarda passando o
 *    trabalhista para a equipe trabalhista do escritorio geral);
 *  - a conversa que ja ficou parada numa promessa dessas segue sozinha quando
 *    o sistema sobe (retomarRespostasPendentes, no boot), por ate 7 dias, se
 *    ninguem da equipe respondeu depois do aviso.
 *
 * A Anthropic e a de mentira, com roteiro (ver encadeamento.js).
 */
const MARCA = 'MARCA-DA-SUITE-DE-PASSAGEM';
const TELEFONE = (sufixo) => `558193111${String(sufixo).padStart(4, '0')}`;

export async function testarPassagemDeVerdade({ base, anthropic, raiz }) {
  const s = suite('Agente que avisa que vai passar a conversa passa de verdade, e quem recebe se apresenta');
  const api = cliente(base);
  await api.entrar();
  const falsa = cliente(anthropic);
  const roteiro = (itens) => falsa.post('/__roteiro', { roteiro: itens, marca: MARCA });
  const registro = async () => (await falsa.get('/__chamadas')).dados;

  const simulador = ((await api.get('/api/conexoes')).dados || []).find((c) => c.tipo === 'simulador');
  if (!s.ok('ha conexao de simulador', Boolean(simulador))) return s;
  await api.patch('/api/integracoes', { ia: { chaveAnthropic: 'sk-ant-de-mentira' } });

  const criarAgente = async (nome, prompt) => {
    const agente = (await api.post('/api/agentes', { nome })).dados;
    await api.patch(`/api/agentes/${agente.id}`, { delaySegundos: 60, area: 'previdenciario', prompt });
    return agente;
  };
  /* Sem @responsavel no prompt, de proposito: era o caso do pos-venda. */
  const recepcao = await criarAgente('Recepcao da Passagem', `${MARCA}. Descubra o assunto e diga que a especialista vai continuar.`);
  const especialista = await criarAgente('Especialista da Passagem', `${MARCA}. Cuide do auxilio-acidente.`);

  const conversa = async (id) => (await api.get(`/api/contatos/${id}`)).dados;
  const falasDe = async (id) => {
    const d = (await api.get(`/api/contatos/${id}/mensagens`)).dados;
    return (Array.isArray(d) ? d : d?.mensagens || []).filter((m) => m.direcao === 'saida' && !m.nota);
  };
  const contatoId = (
    await api.post('/api/simulador/mensagem', {
      conexaoId: simulador.id,
      agenteId: recepcao.id,
      telefone: TELEFONE(1),
      nome: 'Cliente da Passagem',
      conteudo: 'Quero saber do auxilio-acidente',
    })
  ).dados?.contatoId;
  if (!s.ok('cria a conversa com a recepcao', Boolean(contatoId))) return s;

  /* ---------------- Prometeu sem passar: ganha a volta e passa ---------------- */

  const PROMESSA = 'Isso quem cuida e a nossa especialista, ja vou te encaminhar.';
  const TRANSICAO = 'Ja te encaminho para a nossa especialista!';
  const APRESENTACAO = 'Oi! Sou a Especialista da Passagem. Me conta os detalhes do seu caso.';
  await roteiro([
    { status: 200, texto: PROMESSA },
    {
      status: 200,
      texto: '',
      chamadas: [
        {
          nome: 'transferir_conversa',
          argumentos: { destino: 'Especialista da Passagem', resumo_para_proximo: 'Quer saber do auxilio-acidente.', mensagem_de_transicao: TRANSICAO },
        },
      ],
    },
    { status: 200, texto: APRESENTACAO },
  ]);
  await api.post(`/api/agentes/${recepcao.id}/responder-agora`, { contatoId });

  const bateu = await registro();
  s.ok(
    'agente sem @responsavel no prompt tem a ferramenta de passar a conversa',
    (bateu.chamadas[0]?.ferramentas || []).includes('transferir_conversa'),
    JSON.stringify(bateu.chamadas[0]?.ferramentas),
  );
  s.ok('prometeu sem passar: ganha uma volta, e quem recebe responde em seguida (3 chamadas)', bateu.total === 3, `chamadas: ${bateu.total}`);
  s.ok(
    'na volta extra o agente le que prometeu a passagem sem fazer',
    /conversa vai ser passada adiante/.test(bateu.chamadas[1]?.ultimaMensagem || ''),
    bateu.chamadas[1]?.ultimaMensagem,
  );
  s.ok('a conversa fica com a especialista', (await conversa(contatoId))?.responsavel?.id === especialista.id, JSON.stringify((await conversa(contatoId))?.responsavel));
  s.ok(
    'quem recebe e mandado se apresentar e pedir os detalhes',
    /VOCE ACABOU DE RECEBER ESTA CONVERSA[^\n]*apresente-se[^\n]*detalhes/.test(bateu.chamadas[2]?.sistemaCompleto || ''),
  );
  const falas = await falasDe(contatoId);
  const texto = falas.map((m) => `${m.autor?.nome}: ${m.conteudo}`).join(' | ');
  s.ok('a promessa solta nao sai para o cliente', !falas.some((m) => m.conteudo === PROMESSA), texto);
  s.ok('sai o aviso de transicao da recepcao', falas.some((m) => m.autor?.id === recepcao.id && m.conteudo === TRANSICAO), texto);
  s.ok('e logo depois a especialista se apresenta', falas.some((m) => m.autor?.id === especialista.id && m.conteudo === APRESENTACAO), texto);

  /* ---------------- Na fala seguinte, nao se apresenta de novo ---------------- */

  await roteiro([{ status: 200, texto: 'Certo, e quando foi o acidente?' }]);
  await api.post(`/api/agentes/${especialista.id}/responder-agora`, { contatoId });
  const seguinte = (await registro()).chamadas[0]?.sistemaCompleto || '';
  s.ok(
    'na fala seguinte ela segue sem se apresentar de novo',
    seguinte.includes('nao se apresente de novo') && !seguinte.includes('VOCE ACABOU DE RECEBER'),
  );

  /* ---------------- Promessa com a passagem junto: nada muda ---------------- */

  const outro = (
    await api.post('/api/simulador/mensagem', { conexaoId: simulador.id, agenteId: recepcao.id, telefone: TELEFONE(2), nome: 'Outro', conteudo: 'Oi' })
  ).dados?.contatoId;
  await roteiro([
    {
      status: 200,
      texto: 'Vou te passar para a nossa especialista.',
      chamadas: [{ nome: 'transferir_conversa', argumentos: { destino: 'Especialista da Passagem', resumo_para_proximo: 'Lead novo.' } }],
    },
    { status: 200, texto: 'Oi, sou a especialista!' },
  ]);
  await api.post(`/api/agentes/${recepcao.id}/responder-agora`, { contatoId: outro });
  const junto = await registro();
  s.ok('quando a passagem vem junto com a promessa, nao ha volta extra (2 chamadas)', junto.total === 2, `chamadas: ${junto.total}`);
  /* A fala normal nao sai quando a passagem e para agente: o cliente nao foi avisado de nada. */
  const calada = junto.chamadas[1]?.sistemaCompleto || '';
  s.ok(
    'passagem calada (o cliente nao foi avisado): quem recebe segue sem se apresentar',
    calada.includes('Continue de onde ele parou') && !calada.includes('VOCE ACABOU DE RECEBER'),
  );

  /* ---------------- De uma area para a equipe sem area ---------------- */

  /* O caso de 24/10/2026: a Eduarda (previdenciario) passando o
     trabalhista para a equipe trabalhista do escritorio geral, que mora sem area. */
  const semArea = (await api.post('/api/agentes', { nome: 'Equipe Sem Area' })).dados;
  await api.patch(`/api/agentes/${semArea.id}`, { delaySegundos: 60, prompt: `${MARCA}. Cuide do trabalhista.` });
  const demitida = (
    await api.post('/api/simulador/mensagem', {
      conexaoId: simulador.id,
      agenteId: recepcao.id,
      telefone: TELEFONE(3),
      nome: 'Cliente Trabalhista',
      conteudo: 'Fui demitida e nao recebi nada',
    })
  ).dados?.contatoId;
  await roteiro([
    {
      status: 200,
      texto: '',
      chamadas: [
        {
          nome: 'transferir_conversa',
          argumentos: {
            destino: 'Equipe Sem Area',
            resumo_para_proximo: 'Demitida, nao recebeu as verbas.',
            mensagem_de_transicao: 'Isso quem cuida e a nossa equipe trabalhista, ja vou te encaminhar.',
          },
        },
      ],
    },
    { status: 200, texto: 'Oi! Aqui e da equipe trabalhista. Me conta os detalhes do que aconteceu?' },
  ]);
  await api.post(`/api/agentes/${recepcao.id}/responder-agora`, { contatoId: demitida });
  const daDemitida = await registro();
  s.ok(
    'o agente de uma area enxerga a equipe sem area como destino',
    (daDemitida.chamadas[0]?.destinos || []).includes('Equipe Sem Area'),
    JSON.stringify(daDemitida.chamadas[0]?.destinos),
  );
  s.ok('e a passagem para ela nao e recusada', (await conversa(demitida))?.responsavel?.id === semArea.id, JSON.stringify((await conversa(demitida))?.responsavel));
  s.ok('avisado o cliente, a equipe que recebe se apresenta', /VOCE ACABOU DE RECEBER ESTA CONVERSA/.test(daDemitida.chamadas[1]?.sistemaCompleto || ''));

  /* ---------------- Ficou parada numa promessa: o boot retoma ---------------- */

  const pasta = fs.mkdtempSync(path.join(os.tmpdir(), 'passagem-parada-'));
  const url = (arquivo) => pathToFileURL(path.join(raiz, arquivo)).href;
  const montar = path.join(pasta, 'montar.mjs');
  fs.writeFileSync(
    montar,
    `import { iniciarBanco, inserir, inserirMensagem, encerrarBanco } from ${JSON.stringify(url('servidor/nucleo/banco.js'))};
iniciarBanco();
const ha = (min) => new Date(Date.now() - min * 60000).toISOString();
const DIA = 24 * 60;
inserir('workspaces', { id: 'w1', nome: 'Teste' });
inserir('integracoes', { id: 'int1', workspaceId: 'w1', ia: { chaveAnthropic: 'sk-ant-de-mentira' } });
inserir('conexoes', { id: 'conx-sim', workspaceId: 'w1', tipo: 'simulador' });
inserir('agentes', { id: 'ag-rec', workspaceId: 'w1', nome: 'Recepcao Parada', ativo: true, delaySegundos: 1, modelo: 'claude-sonnet-5', area: 'previdenciario', prompt: '${MARCA}. Recepcao.' });
inserir('agentes', { id: 'ag-esp', workspaceId: 'w1', nome: 'Especialista Parada', ativo: true, delaySegundos: 1, modelo: 'claude-sonnet-5', area: 'previdenciario', prompt: '${MARCA}. Especialista.' });
const rec = { tipo: 'agente', id: 'ag-rec', nome: 'Recepcao Parada' };
/* Parada ha 3 dias: a correcao foi ao ar dias depois do pedido, e 48 horas nao bastavam. */
inserir('contatos', { id: 'c-parado', workspaceId: 'w1', conexaoId: 'conx-sim', telefone: '5581931110001', nome: 'Parado', estado: 'ia', responsavel: rec, ultimaEntradaEm: ha(3 * DIA + 10), ultimaSaidaEm: ha(3 * DIA + 9), etiquetas: [] });
inserirMensagem('c-parado', { direcao: 'entrada', tipo: 'texto', conteudo: 'Quero saber do auxilio-acidente', autor: { tipo: 'cliente' }, situacao: 'recebida', criadoEm: ha(3 * DIA + 10) });
inserirMensagem('c-parado', { direcao: 'saida', tipo: 'texto', conteudo: 'Ja vou te encaminhar para a nossa especialista.', autor: rec, situacao: 'enviada', criadoEm: ha(3 * DIA + 9) });
/* Alguem da equipe respondeu pelo celular depois do aviso: esta com gente. */
inserir('contatos', { id: 'c-com-gente', workspaceId: 'w1', conexaoId: 'conx-sim', telefone: '5581931110003', nome: 'Com Gente', estado: 'ia', responsavel: rec, ultimaEntradaEm: ha(10), ultimaSaidaEm: ha(5), etiquetas: [] });
inserirMensagem('c-com-gente', { direcao: 'entrada', tipo: 'texto', conteudo: 'Fui demitido', autor: { tipo: 'cliente' }, situacao: 'recebida', criadoEm: ha(10) });
inserirMensagem('c-com-gente', { direcao: 'saida', tipo: 'texto', conteudo: 'Ja vou te encaminhar para a nossa especialista.', autor: rec, situacao: 'enviada', criadoEm: ha(9) });
inserirMensagem('c-com-gente', { direcao: 'saida', tipo: 'texto', conteudo: 'Oi, aqui e do escritorio, ja estou vendo o seu caso.', autor: { tipo: 'membro', nome: 'Pelo celular' }, situacao: 'enviada', criadoEm: ha(5) });
/* Parada ha mais de 7 dias: fica como esta. */
inserir('contatos', { id: 'c-antigo', workspaceId: 'w1', conexaoId: 'conx-sim', telefone: '5581931110004', nome: 'Antigo', estado: 'ia', responsavel: rec, ultimaEntradaEm: ha(8 * DIA + 10), ultimaSaidaEm: ha(8 * DIA + 9), etiquetas: [] });
inserirMensagem('c-antigo', { direcao: 'entrada', tipo: 'texto', conteudo: 'Quero saber do BPC', autor: { tipo: 'cliente' }, situacao: 'recebida', criadoEm: ha(8 * DIA + 10) });
inserirMensagem('c-antigo', { direcao: 'saida', tipo: 'texto', conteudo: 'Ja vou te encaminhar para a nossa especialista.', autor: rec, situacao: 'enviada', criadoEm: ha(8 * DIA + 9) });
inserir('contatos', { id: 'c-esperando', workspaceId: 'w1', conexaoId: 'conx-sim', telefone: '5581931110002', nome: 'Esperando', estado: 'ia', responsavel: rec, ultimaEntradaEm: ha(10), ultimaSaidaEm: ha(9), etiquetas: [] });
inserirMensagem('c-esperando', { direcao: 'entrada', tipo: 'texto', conteudo: 'Oi', autor: { tipo: 'cliente' }, situacao: 'recebida', criadoEm: ha(10) });
inserirMensagem('c-esperando', { direcao: 'saida', tipo: 'texto', conteudo: 'Qual e o seu nome completo?', autor: rec, situacao: 'enviada', criadoEm: ha(9) });
await encerrarBanco();
`,
  );
  const retomar = path.join(pasta, 'retomar.mjs');
  fs.writeFileSync(
    retomar,
    `import { iniciarBanco, achar, mensagensDe, encerrarBanco } from ${JSON.stringify(url('servidor/nucleo/banco.js'))};
import { retomarRespostasPendentes } from ${JSON.stringify(url('servidor/ia/motor.js'))};
iniciarBanco();
const resultado = retomarRespostasPendentes();
await new Promise((ok) => setTimeout(ok, 3500));
const falas = (id) => mensagensDe(id).filter((m) => m.direcao === 'saida' && !m.nota).map((m) => ({ autor: m.autor?.id, conteudo: m.conteudo }));
console.log(JSON.stringify({ resultado, parado: achar('contatos', 'c-parado').responsavel, falasParado: falas('c-parado'), falasEsperando: falas('c-esperando'), falasComGente: falas('c-com-gente'), falasAntigo: falas('c-antigo') }));
await encerrarBanco();
process.exit(0);
`,
  );
  const rodar = (arquivo) =>
    new Promise((resolve) => {
      const p = spawn(process.execPath, [arquivo], {
        env: { ...process.env, CORREIA_DADOS: pasta, CORREIA_ANTHROPIC_URL: anthropic },
        stdio: ['ignore', 'pipe', 'pipe'],
      });
      let saida = '';
      p.stdout.on('data', (d) => (saida += d));
      p.stderr.on('data', (d) => (saida += d));
      p.on('close', (codigo) => resolve({ codigo, saida }));
    });

  try {
    const m = await rodar(montar);
    if (!s.ok('a base da conversa parada foi montada', m.codigo === 0, m.saida.slice(-400))) return s;
    await roteiro([
      {
        status: 200,
        texto: '',
        chamadas: [{ nome: 'transferir_conversa', argumentos: { destino: 'Especialista Parada', resumo_para_proximo: 'Quer saber do auxilio-acidente.' } }],
      },
      { status: 200, texto: 'Oi! Sou a Especialista Parada. Me conta os detalhes do seu caso.' },
    ]);
    const r = await rodar(retomar);
    if (!s.ok('a retomada roda sem erro', r.codigo === 0, r.saida.slice(-600))) return s;
    const b = JSON.parse(r.saida.trim().split('\n').pop());
    const parada = await registro();

    s.ok('a conversa parada na promessa ha 3 dias e retomada (e so ela)', b.resultado.retomados === 1, JSON.stringify(b.resultado));
    s.ok('a que alguem da equipe respondeu depois do aviso fica com a equipe', b.falasComGente.length === 2, JSON.stringify(b.falasComGente));
    s.ok('a parada ha mais de 7 dias fica como esta', b.falasAntigo.length === 1, JSON.stringify(b.falasAntigo));
    s.ok(
      'o agente le que avisou da passagem e ela nao aconteceu',
      /a passagem nao aconteceu/.test(parada.chamadas[0]?.ultimaMensagem || ''),
      parada.chamadas[0]?.ultimaMensagem,
    );
    s.ok('a conversa passa para a especialista', b.parado?.id === 'ag-esp', JSON.stringify(b.parado));
    s.ok(
      'a especialista sabe que o cliente foi avisado e esta esperando',
      /VOCE ACABOU DE RECEBER ESTA CONVERSA/.test(parada.chamadas[1]?.sistemaCompleto || ''),
    );
    s.ok(
      'e a especialista se apresenta, pedindo os detalhes',
      b.falasParado.some((f) => f.autor === 'ag-esp' && /Me conta os detalhes/.test(f.conteudo)),
      JSON.stringify(b.falasParado),
    );
    s.ok('a conversa que so esperava o cliente responder nao ganha mensagem nova', b.falasEsperando.length === 1, JSON.stringify(b.falasEsperando));
  } finally {
    fs.rmSync(pasta, { recursive: true, force: true });
  }

  /* ---------------- Limpeza ---------------- */

  await falsa.post('/__roteiro', { roteiro: [] });
  await api.patch('/api/integracoes', { ia: { chaveAnthropic: null } });
  for (const id of [contatoId, outro, demitida]) await api.delete(`/api/contatos/${id}`);
  for (const agente of [recepcao, especialista, semArea]) await api.delete(`/api/agentes/${agente.id}`);
  return s;
}
