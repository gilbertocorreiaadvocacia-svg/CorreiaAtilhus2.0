import { spawn } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

import { cliente, suite } from './apoio.js';

/**
 * Quem assume a conversa fica com ela. Pedido do escritorio em 26/10/2026:
 * "quando a Leticia tenta assumir a conversa ela nao consegue".
 *
 * O que nao pode falhar:
 *  - escolher a si mesmo como responsavel pela lista (acao em massa) assume,
 *    igual ao botao da conversa;
 *  - a conversa dada a uma pessoa por outra fica com ela por 24 horas, sem a
 *    varredura devolver para a IA antes de ela aceitar;
 *  - se a pessoa assume enquanto a IA escreve, a resposta que estava sendo
 *    escrita nao sai, e a passagem que vinha junto nao leva a conversa de
 *    volta para a IA.
 *
 * A Anthropic e a de mentira: a demora da resposta e a janela em que a pessoa
 * assume. Roda num processo a parte, com tempo limite de IA maior que o do
 * servidor de teste.
 */
const MARCA = 'MARCA-DA-SUITE-DE-ASSUMIR';

export async function testarAssumirConversa({ base, anthropic, raiz }) {
  const s = suite('Quem assume a conversa fica com ela');
  const api = cliente(base);
  await api.entrar();

  /* ---------------- Pela lista, escolhendo a si mesmo ---------------- */

  const eu = (await api.get('/api/sessao/eu')).dados?.membro;
  const simulador = ((await api.get('/api/conexoes')).dados || []).find((c) => c.tipo === 'simulador');
  const contato = (await api.post('/api/contatos', { conexaoId: simulador?.id, telefone: '5581931119401', nome: 'Cliente da Lista' })).dados;
  if (!s.ok('conversa criada', Boolean(eu?.id && contato?.id), JSON.stringify({ eu, contato }))) return s;
  await api.post('/api/contatos/acoes-em-massa', { acao: 'responsavel', valor: `membro:${eu.id}`, ids: [contato.id] });
  const pelaLista = (await api.get(`/api/contatos/${contato.id}`)).dados;
  s.ok(
    'escolher a si mesmo pela lista assume a conversa',
    pelaLista?.responsavel?.id === eu.id && pelaLista?.estado === 'ativo' && pelaLista?.aceitoPor === eu.id,
    JSON.stringify({ responsavel: pelaLista?.responsavel, estado: pelaLista?.estado, aceitoPor: pelaLista?.aceitoPor }),
  );
  await api.delete(`/api/contatos/${contato.id}`);

  /* ---------------- Atribuida por outra pessoa, e assumida no meio da resposta ---------------- */

  const url = (arquivo) => JSON.stringify(pathToFileURL(path.join(raiz, arquivo)).href);
  const falsa = cliente(anthropic);
  const pasta = fs.mkdtempSync(path.join(os.tmpdir(), 'assumir-conversa-'));
  const script = path.join(pasta, 'assumir.mjs');
  fs.writeFileSync(
    script,
    `import { iniciarBanco, achar, atualizar, inserir, inserirMensagem, mensagensDe, encerrarBanco } from ${url('servidor/nucleo/banco.js')};
import { executarAgente } from ${url('servidor/ia/motor.js')};
import { pessoaCuidandoAgora } from ${url('servidor/ia/escolher-agente.js')};
import { reatribuirPendentes } from ${url('servidor/automacao/reatribuir-pendentes.js')};
iniciarBanco();
const ha = (min) => new Date(Date.now() - min * 60000).toISOString();
inserir('workspaces', { id: 'w1', nome: 'Teste' });
inserir('integracoes', { id: 'int1', workspaceId: 'w1', ia: { chaveAnthropic: 'sk-ant-de-mentira' } });
inserir('conexoes', { id: 'conx-sim', workspaceId: 'w1', tipo: 'simulador' });
inserir('usuarios', { id: 'u-atendente', nome: 'Atendente Teste' });
inserir('membros', { id: 'm-atendente', workspaceId: 'w1', usuarioId: 'u-atendente', papel: 'atendente' });
inserir('agentes', { id: 'ag-a', workspaceId: 'w1', nome: 'Agente A', ativo: true, objetivo: 'recepcionar', delaySegundos: 60, modelo: 'claude-sonnet-5', prompt: '${MARCA}. Atenda.' });
inserir('agentes', { id: 'ag-b', workspaceId: 'w1', nome: 'Agente B', ativo: true, delaySegundos: 60, modelo: 'claude-sonnet-5', prompt: '${MARCA}. Outro.' });
const agenteA = { tipo: 'agente', id: 'ag-a', nome: 'Agente A' };
const atendente = { tipo: 'membro', id: 'm-atendente', nome: 'Atendente Teste' };

/* A IA esta escrevendo quando a pessoa assume. */
inserir('contatos', { id: 'c-meio', workspaceId: 'w1', conexaoId: 'conx-sim', telefone: '5581931119402', nome: 'Meio', estado: 'ia', responsavel: agenteA, ultimaEntradaEm: ha(1), etiquetas: [] });
inserirMensagem('c-meio', { direcao: 'entrada', tipo: 'texto', conteudo: 'Oi, preciso de ajuda', autor: { tipo: 'cliente' }, situacao: 'recebida', criadoEm: ha(1) });
const corrida = executarAgente('c-meio');
await new Promise((ok) => setTimeout(ok, 500));
atualizar('contatos', 'c-meio', { responsavel: atendente, estado: 'ativo', aceitoPor: 'm-atendente', aceitoEm: new Date().toISOString() });
await corrida;

/* Dada a ela por outra pessoa, ainda sem aceitar: ha 30 minutos e ha 25 horas. */
for (const [id, minutos] of [['c-atribuida', 30], ['c-atribuida-ontem', 25 * 60]]) {
  inserir('contatos', { id, workspaceId: 'w1', conexaoId: 'conx-sim', telefone: '558193111' + (minutos === 30 ? '9403' : '9404'), nome: id, estado: 'pendente', responsavel: atendente, aceitoPor: null, atribuidoEm: ha(minutos), ultimaEntradaEm: ha(minutos + 1), etiquetas: [] });
}
const cuidando = { recente: pessoaCuidandoAgora(achar('contatos', 'c-atribuida')), ontem: pessoaCuidandoAgora(achar('contatos', 'c-atribuida-ontem')) };
reatribuirPendentes();

const meio = achar('contatos', 'c-meio');
console.log(JSON.stringify({
  meio: { responsavel: meio.responsavel, estado: meio.estado },
  falasDaIa: mensagensDe('c-meio').filter((m) => m.direcao === 'saida' && m.autor?.tipo === 'agente').map((m) => m.conteudo),
  cuidando,
  atribuida: achar('contatos', 'c-atribuida').responsavel,
  atribuidaOntem: achar('contatos', 'c-atribuida-ontem').responsavel,
}));
await encerrarBanco();
process.exit(0);
`,
  );

  try {
    await falsa.post('/__roteiro', {
      roteiro: [
        {
          status: 200,
          demora: 1500,
          texto: 'Resposta que ja estava sendo escrita.',
          chamadas: [{ nome: 'transferir_conversa', argumentos: { destino: 'Agente B', resumo_para_proximo: 'Quer ajuda.' } }],
        },
      ],
      marca: MARCA,
    });
    const r = await new Promise((resolve) => {
      const p = spawn(process.execPath, [script], {
        env: { ...process.env, CORREIA_DADOS: pasta, CORREIA_ANTHROPIC_URL: anthropic, CORREIA_IA_TEMPO_LIMITE: '10000' },
        stdio: ['ignore', 'pipe', 'pipe'],
      });
      let texto = '';
      p.stdout.on('data', (d) => (texto += d));
      p.stderr.on('data', (d) => (texto += d));
      p.on('close', (codigo) => resolve({ codigo, texto }));
    });
    if (!s.ok('o escritorio de teste roda sem erro', r.codigo === 0, r.texto.slice(-600))) return s;
    const b = JSON.parse(r.texto.trim().split('\n').pop());
    const chamadas = (await falsa.get('/__chamadas')).dados?.total;

    s.ok('a IA estava mesmo escrevendo quando a pessoa assumiu', chamadas === 1, JSON.stringify(chamadas));
    s.ok('a resposta que estava sendo escrita nao sai', b.falasDaIa.length === 0, JSON.stringify(b.falasDaIa));
    s.ok(
      'e a passagem que vinha junto nao leva a conversa de volta para a IA',
      b.meio.responsavel?.id === 'm-atendente' && b.meio.estado === 'ativo',
      JSON.stringify(b.meio),
    );
    s.ok('a conversa dada a uma pessoa ha 30 minutos fica com ela', b.cuidando.recente && b.atribuida?.id === 'm-atendente', JSON.stringify({ cuidando: b.cuidando, atribuida: b.atribuida }));
    s.ok('passadas 24 horas sem ela aceitar, volta para a IA', !b.cuidando.ontem && b.atribuidaOntem?.tipo === 'agente', JSON.stringify(b.atribuidaOntem));
  } finally {
    await falsa.post('/__roteiro', { roteiro: [] });
    fs.rmSync(pasta, { recursive: true, force: true });
  }
  return s;
}
