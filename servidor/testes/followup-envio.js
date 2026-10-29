import { spawn } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

import { suite } from './apoio.js';

/**
 * O envio do follow-up (automacao/followup.js). Achados da auditoria de
 * 28/10/2026, corrigidos em 29/10 junto do pedido "os follow-ups nao estao
 * sendo enviados".
 *
 * O que nao pode falhar: follow-up que o WhatsApp recusa fica com erro, e nao
 * "enviado" — e o ultimo passo NAO desiste do lead nem o arquiva; com o envio
 * lento (o servico demora mais que o tique do agendador), o mesmo follow-up
 * sai UMA vez so; e o que sai bem continua saindo e desistindo como antes.
 */
export async function testarFollowupEnvio({ raiz }) {
  const s = suite('Follow-up: falha nao conta como enviado, e nada sai em dobro');
  const url = (arquivo) => JSON.stringify(pathToFileURL(path.join(raiz, arquivo)).href);
  const pasta = fs.mkdtempSync(path.join(os.tmpdir(), 'followup-envio-'));
  const script = path.join(pasta, 'followup.mjs');
  fs.writeFileSync(
    script,
    `import http from 'node:http';
import { iniciarBanco, achar, inserir, listar, mensagensDe, encerrarBanco } from ${url('servidor/nucleo/banco.js')};
import { iniciarAgendador, pararAgendador } from ${url('servidor/automacao/followup.js')};
iniciarBanco();

/* Uma Evolution de mentira, lenta: cada envio leva 250 ms. O numero que
   termina em 99 e recusado. */
const recebidos = [];
const servico = http.createServer((req, res) => {
  let corpo = '';
  req.on('data', (d) => (corpo += d));
  req.on('end', () => {
    const dados = JSON.parse(corpo || '{}');
    recebidos.push(dados.number);
    setTimeout(() => {
      if (String(dados.number).endsWith('99')) {
        res.writeHead(400, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ message: 'numero recusado' }));
        return;
      }
      res.writeHead(201, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ key: { id: 'ID-' + recebidos.length } }));
    }, 250);
  });
});
await new Promise((r) => servico.listen(0, '127.0.0.1', r));
const porta = servico.address().port;

const ha = (min) => new Date(Date.now() - min * 60 * 1000).toISOString();
inserir('workspaces', { id: 'w1', nome: 'Correia Advogados' });
inserir('conexoes', { id: 'cx1', workspaceId: 'w1', tipo: 'qrcode', nome: 'WhatsApp', estado: 'conectado', qrcode: { servidor: 'http://127.0.0.1:' + porta, chave: 'chave-de-teste', instancia: 'teste' } });
inserir('status', { id: 'st-desistencia', workspaceId: 'w1', nome: 'Desistencia', tipo: 'desistencia' });
inserir('templates', { id: 'tpl-fu', workspaceId: 'w1', nome: 'Follow-up', atalho: 'fu3', conteudo: 'Oi {{nome}}, ainda tem interesse?' });
const pessoa = { tipo: 'membro', id: 'm1', nome: 'Pessoa' };
inserir('contatos', { id: 'c-ok', workspaceId: 'w1', conexaoId: 'cx1', telefone: '5581900000011', nome: 'Ana', estado: 'ativo', responsavel: pessoa, aceitoPor: 'm1' });
inserir('contatos', { id: 'c-recusado', workspaceId: 'w1', conexaoId: 'cx1', telefone: '5581900000099', nome: 'Bia', estado: 'ativo', responsavel: pessoa, aceitoPor: 'm1' });
const desistir = { ativo: true, statusId: 'st-desistencia', responsavel: null, arquivar: true };
inserir('agendamentos', { id: 'ag-ok', workspaceId: 'w1', contatoId: 'c-ok', tipo: 'followup', templateId: 'tpl-fu', minutos: 60, desistir, quando: ha(1), estado: 'pendente' });
inserir('agendamentos', { id: 'ag-recusado', workspaceId: 'w1', contatoId: 'c-recusado', tipo: 'followup', templateId: 'tpl-fu', minutos: 60, desistir, quando: ha(1), estado: 'pendente' });

/* Tique de 20 ms contra envio de 250 ms: sem a trava, cada agendamento sairia varias vezes. */
iniciarAgendador(20);
await new Promise((r) => setTimeout(r, 1500));
pararAgendador();

const ag = (id) => achar('agendamentos', id);
const ct = (id) => achar('contatos', id);
console.log(JSON.stringify({
  enviosAoServico: recebidos.length,
  mensagensOk: mensagensDe('c-ok').filter((m) => m.origemAutomacao === 'followup').length,
  ok: { estado: ag('ag-ok').estado, contato: ct('c-ok').estado, status: ct('c-ok').statusId },
  recusado: { estado: ag('ag-recusado').estado, erro: ag('ag-recusado').erro || null, contato: ct('c-recusado').estado, status: ct('c-recusado').statusId || null },
  desistencias: listar('logs').filter((l) => l.tipo === 'desistencia').map((l) => l.contatoId),
}));
servico.close();
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

    s.ok('com envio lento, cada follow-up sai uma vez so', b.enviosAoServico === 2 && b.mensagensOk === 1, JSON.stringify(b));
    s.ok(
      'o que saiu conta como enviado e desiste do lead, como antes',
      b.ok.estado === 'enviado' && b.ok.contato === 'arquivado' && b.ok.status === 'st-desistencia',
      JSON.stringify(b.ok),
    );
    s.ok('o que o WhatsApp recusou fica com erro, e nao como enviado', b.recusado.estado === 'erro' && Boolean(b.recusado.erro), JSON.stringify(b.recusado));
    s.ok(
      'e o lead que nao recebeu nada nao e desistido nem arquivado',
      b.recusado.contato === 'ativo' && !b.recusado.status && !b.desistencias.includes('c-recusado'),
      JSON.stringify({ recusado: b.recusado, desistencias: b.desistencias }),
    );
  } finally {
    fs.rmSync(pasta, { recursive: true, force: true });
  }
  return s;
}
