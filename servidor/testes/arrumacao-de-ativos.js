import { spawn } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

import { suite } from './apoio.js';

/**
 * A arrumacao de Ativos (concluirHistoricoParado, em
 * whatsapp/importar-historico.js). Pedido do escritorio em 26/10/2026:
 * "pode fazer, nao desorganize, que nao ocorra regressao".
 *
 * O que nao pode falhar: so a conversa do historico do celular, em Ativos,
 * sem mensagem ha mais de 30 dias e que ja existia na aprovacao vai para
 * Concluidos, com o motivo anotado; recente, com a IA, pendente, grupo, a que
 * nao veio do historico e a importada depois ficam onde estavam; roda uma
 * vez so; e a concluida reabre sozinha quando o cliente escreve.
 */
export async function testarArrumacaoDeAtivos({ raiz }) {
  const s = suite('A arrumacao de Ativos conclui so o historico parado do celular');
  const url = (arquivo) => JSON.stringify(pathToFileURL(path.join(raiz, arquivo)).href);
  const pasta = fs.mkdtempSync(path.join(os.tmpdir(), 'arrumacao-ativos-'));
  const script = path.join(pasta, 'arrumar.mjs');
  fs.writeFileSync(
    script,
    `import { iniciarBanco, achar, inserir, listar, encerrarBanco } from ${url('servidor/nucleo/banco.js')};
import { concluirHistoricoParado } from ${url('servidor/whatsapp/importar-historico.js')};
import { receberMensagem } from ${url('servidor/whatsapp/recebimento.js')};
iniciarBanco();
const dias = (n) => new Date(Date.now() - n * 24 * 60 * 60 * 1000).toISOString();
inserir('workspaces', { id: 'w1', nome: 'Correia Advogados' });
inserir('usuarios', { id: 'u1', nome: 'Pessoa do Escritorio' });
inserir('membros', { id: 'm1', workspaceId: 'w1', usuarioId: 'u1', papel: 'atendente', ativo: true });
inserir('conexoes', { id: 'conx-1', workspaceId: 'w1', tipo: 'qrcode', nome: 'WhatsApp' });
const pessoa = { tipo: 'membro', id: 'm1', nome: 'Pessoa do Escritorio' };
const ativo = (id, campos) =>
  inserir('contatos', { id, workspaceId: 'w1', conexaoId: 'conx-1', telefone: '', nome: id, importado: true, estado: 'ativo', responsavel: pessoa, aceitoPor: 'm1', criadoEm: '2026-10-20T12:00:00.000Z', ultimaMensagemEm: dias(40), etiquetas: [], ...campos });

ativo('c-parado', { telefone: '5581931110701' });
ativo('c-sem-data', { ultimaMensagemEm: null });
ativo('c-recente', { ultimaMensagemEm: dias(5) });
ativo('c-com-a-ia', { estado: 'ia', responsavel: { tipo: 'agente', id: 'ag-1', nome: 'Eduarda' }, aceitoPor: null });
ativo('c-nao-importado', { importado: false });
ativo('c-grupo', { grupo: true });
ativo('c-pendente', { estado: 'pendente', aceitoPor: null });
ativo('c-importado-depois', { criadoEm: '2026-11-01T12:00:00.000Z' });

const concluidas = concluirHistoricoParado();
const estados = Object.fromEntries(listar('contatos').map((c) => [c.id, c.estado]));
const anotada = listar('logs').some((l) => l.contatoId === 'c-parado' && l.tipo === 'arquivo' && /30 dias/.test(l.descricao));

ativo('c-chegou-depois-da-arrumacao', {});
const deNovo = concluirHistoricoParado();

await receberMensagem({ workspaceId: 'w1', conexao: achar('conexoes', 'conx-1'), telefone: '5581931110701', nome: 'c-parado', conteudo: 'Oi, voltei' });
console.log(JSON.stringify({ concluidas, estados, anotada, deNovo, depoisDeEscrever: achar('contatos', 'c-parado').estado, marcado: Boolean(achar('workspaces', 'w1').historicoParadoConcluidoEm) }));
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
      'o historico do celular parado ha mais de 30 dias (ou sem data) vai para Concluidos',
      b.concluidas === 2 && b.estados['c-parado'] === 'arquivado' && b.estados['c-sem-data'] === 'arquivado',
      JSON.stringify({ concluidas: b.concluidas, estados: b.estados }),
    );
    s.ok(
      'recente, com a IA, pendente, grupo, nao importado e importado depois ficam onde estavam',
      b.estados['c-recente'] === 'ativo' &&
        b.estados['c-com-a-ia'] === 'ia' &&
        b.estados['c-pendente'] === 'pendente' &&
        b.estados['c-grupo'] === 'ativo' &&
        b.estados['c-nao-importado'] === 'ativo' &&
        b.estados['c-importado-depois'] === 'ativo',
      JSON.stringify(b.estados),
    );
    s.ok('cada conversa concluida fica com o motivo anotado', b.anotada);
    s.ok('roda uma vez so: o que aparece depois da arrumacao nao e concluido', b.deNovo === 0 && b.marcado, JSON.stringify({ deNovo: b.deNovo, marcado: b.marcado }));
    s.ok('a conversa concluida reabre sozinha quando o cliente escreve', b.depoisDeEscrever !== 'arquivado', JSON.stringify(b.depoisDeEscrever));
  } finally {
    fs.rmSync(pasta, { recursive: true, force: true });
  }
  return s;
}

/**
 * A segunda arrumacao (concluirHistoricoSoDoCelular, em
 * whatsapp/importar-historico.js). Pedido do escritorio em 27/10/2026: "pode
 * fazer, contando que nao desorganize".
 *
 * O que nao pode falhar: so a conversa do historico do celular, em Ativos,
 * que ninguem mexeu pelo sistema vai para Concluidos, com o motivo anotado e
 * a mesma pessoa responsavel; qualquer sinal de uso (resposta pela tela,
 * mensagem nova, nota, nao lida, aceite, transferencia, etiqueta, nome
 * escrito a mao) a deixa em Ativos; roda uma vez so; e reabre sozinha quando
 * o cliente escreve.
 */
export async function testarArrumacaoDoHistoricoSoDoCelular({ raiz }) {
  const s = suite('A segunda arrumacao de Ativos conclui so o historico do celular sem uso no sistema');
  const url = (arquivo) => JSON.stringify(pathToFileURL(path.join(raiz, arquivo)).href);
  const pasta = fs.mkdtempSync(path.join(os.tmpdir(), 'arrumacao-celular-'));
  const script = path.join(pasta, 'arrumar.mjs');
  fs.writeFileSync(
    script,
    `import { iniciarBanco, achar, inserir, inserirMensagem, listar, mensagensDe, encerrarBanco } from ${url('servidor/nucleo/banco.js')};
import { concluirHistoricoSoDoCelular } from ${url('servidor/whatsapp/importar-historico.js')};
import { receberMensagem } from ${url('servidor/whatsapp/recebimento.js')};
iniciarBanco();
const dias = (n) => new Date(Date.now() - n * 24 * 60 * 60 * 1000).toISOString();
inserir('workspaces', { id: 'w1', nome: 'Correia Advogados' });
inserir('usuarios', { id: 'u1', nome: 'Pessoa do Escritorio' });
inserir('membros', { id: 'm1', workspaceId: 'w1', usuarioId: 'u1', papel: 'atendente', ativo: true });
inserir('conexoes', { id: 'conx-1', workspaceId: 'w1', tipo: 'qrcode', nome: 'WhatsApp' });
const pessoa = { tipo: 'membro', id: 'm1', nome: 'Pessoa do Escritorio' };
const ativo = (id, campos) =>
  inserir('contatos', { id, workspaceId: 'w1', conexaoId: 'conx-1', telefone: '', nome: id, importado: true, estado: 'ativo', responsavel: pessoa, aceitoPor: 'm1', naoLidas: 0, ultimaMensagemEm: dias(3), etiquetas: [], ...campos });
const mensagem = (contatoId, campos) =>
  inserirMensagem(contatoId, { id: contatoId + '-' + mensagensDe(contatoId).length, workspaceId: 'w1', direcao: 'entrada', tipo: 'texto', conteudo: 'oi', criadoEm: dias(3), ...campos });

ativo('c-so-do-celular', { telefone: '5581931110801' });
mensagem('c-so-do-celular', { importada: true });
mensagem('c-so-do-celular', { importada: true, direcao: 'saida', autor: { tipo: 'membro', nome: 'Pelo celular' } });
ativo('c-sem-mensagem', {});
ativo('c-respondida-pela-tela', {});
mensagem('c-respondida-pela-tela', { importada: true });
mensagem('c-respondida-pela-tela', { direcao: 'saida', autor: { tipo: 'membro', id: 'm1', nome: 'Pessoa do Escritorio' } });
ativo('c-cliente-escreveu-depois', {});
mensagem('c-cliente-escreveu-depois', { importada: true });
mensagem('c-cliente-escreveu-depois', {});
ativo('c-com-nota', {});
mensagem('c-com-nota', { direcao: 'interna', nota: true, conteudo: 'ligar amanha' });
ativo('c-nao-lida', { naoLidas: 2 });
ativo('c-aceita', { aceitoEm: dias(10) });
ativo('c-transferida', { atribuidoEm: dias(10) });
ativo('c-etiquetada', { etiquetas: ['bpc'] });
ativo('c-com-situacao', { statusId: 'st-1' });
ativo('c-renomeada', { nome: 'Maria (cliente)', nomeOrigem: 'manual' });
ativo('c-com-a-ia', { estado: 'ia', responsavel: { tipo: 'agente', id: 'ag-1', nome: 'Eduarda' }, aceitoPor: null });
ativo('c-nao-importada', { importado: false });
ativo('c-grupo', { grupo: true });
ativo('c-pendente', { estado: 'pendente', aceitoPor: null });

const concluidas = concluirHistoricoSoDoCelular();
const estados = Object.fromEntries(listar('contatos').map((c) => [c.id, c.estado]));
const anotada = listar('logs').some((l) => l.contatoId === 'c-so-do-celular' && l.tipo === 'arquivo' && /ninguem mexeu/.test(l.descricao));
const mesmaPessoa = achar('contatos', 'c-so-do-celular').responsavel?.id === 'm1';

ativo('c-chegou-depois-da-arrumacao', {});
const deNovo = concluirHistoricoSoDoCelular();

await receberMensagem({ workspaceId: 'w1', conexao: achar('conexoes', 'conx-1'), telefone: '5581931110801', nome: 'c-so-do-celular', conteudo: 'Oi, voltei' });
console.log(JSON.stringify({ concluidas, estados, anotada, mesmaPessoa, deNovo, depoisDeEscrever: achar('contatos', 'c-so-do-celular').estado, marcado: Boolean(achar('workspaces', 'w1').historicoSoDoCelularConcluidoEm) }));
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
      'a conversa do celular que ninguem mexeu pelo sistema vai para Concluidos',
      b.concluidas === 2 && b.estados['c-so-do-celular'] === 'arquivado' && b.estados['c-sem-mensagem'] === 'arquivado',
      JSON.stringify({ concluidas: b.concluidas, estados: b.estados }),
    );
    const usadas = [
      'c-respondida-pela-tela',
      'c-cliente-escreveu-depois',
      'c-com-nota',
      'c-nao-lida',
      'c-aceita',
      'c-transferida',
      'c-etiquetada',
      'c-com-situacao',
      'c-renomeada',
    ];
    s.ok(
      'qualquer sinal de uso no sistema deixa a conversa em Ativos',
      usadas.every((id) => b.estados[id] === 'ativo'),
      JSON.stringify(Object.fromEntries(usadas.map((id) => [id, b.estados[id]]))),
    );
    s.ok(
      'com a IA, pendente, grupo e nao importada ficam onde estavam',
      b.estados['c-com-a-ia'] === 'ia' && b.estados['c-pendente'] === 'pendente' && b.estados['c-grupo'] === 'ativo' && b.estados['c-nao-importada'] === 'ativo',
      JSON.stringify(b.estados),
    );
    s.ok('cada conversa concluida fica com o motivo anotado e a mesma pessoa responsavel', b.anotada && b.mesmaPessoa);
    s.ok('roda uma vez so: o que aparece depois da arrumacao nao e concluido', b.deNovo === 0 && b.marcado, JSON.stringify({ deNovo: b.deNovo, marcado: b.marcado }));
    s.ok('a conversa concluida reabre sozinha quando o cliente escreve', b.depoisDeEscrever !== 'arquivado', JSON.stringify(b.depoisDeEscrever));
  } finally {
    fs.rmSync(pasta, { recursive: true, force: true });
  }
  return s;
}
