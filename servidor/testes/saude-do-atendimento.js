import { spawn } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

import { suite } from './apoio.js';

/**
 * A saude do atendimento (nucleo/saude-do-atendimento.js), que /api/saude
 * mostra por escritorio. Pedido do escritorio em 28/10/2026: auditoria do que
 * impede o atendimento de andar.
 *
 * O que nao pode falhar: conta quem esta esperando resposta na aba certa e na
 * faixa de tempo certa; acha a conversa presa na IA com agente desligado e a
 * conversa com pessoa que saiu da equipe; conta as falhas anotadas nos logs
 * por periodo; agrupa os motivos SEM o telefone do cliente; e conta os
 * agendamentos atrasados e com erro.
 */
export async function testarSaudeDoAtendimento({ raiz }) {
  const s = suite('A saude do atendimento conta o que esta parado e o que falhou');
  const url = (arquivo) => JSON.stringify(pathToFileURL(path.join(raiz, arquivo)).href);
  const pasta = fs.mkdtempSync(path.join(os.tmpdir(), 'saude-atendimento-'));
  const script = path.join(pasta, 'saude.mjs');
  fs.writeFileSync(
    script,
    `import { iniciarBanco, inserir, encerrarBanco } from ${url('servidor/nucleo/banco.js')};
import { saudeDoAtendimento } from ${url('servidor/nucleo/saude-do-atendimento.js')};
iniciarBanco();
const AGORA = Date.parse('2026-10-28T12:00:00.000Z');
const ha = (min) => new Date(AGORA - min * 60 * 1000).toISOString();
inserir('workspaces', { id: 'w1', nome: 'Correia Advogados' });
inserir('membros', { id: 'm1', workspaceId: 'w1', usuarioId: 'u1', papel: 'atendente', ativo: true });
inserir('membros', { id: 'm2', workspaceId: 'w1', usuarioId: 'u2', papel: 'atendente', ativo: false });
inserir('agentes', { id: 'ag-ligado', workspaceId: 'w1', nome: 'Eduarda', ativo: true });
inserir('agentes', { id: 'ag-desligado', workspaceId: 'w1', nome: 'Andreia', ativo: false });
inserir('conexoes', { id: 'cx1', workspaceId: 'w1', tipo: 'qrcode', nome: 'WhatsApp', estado: 'conectado' });
inserir('conexoes', { id: 'cx-sim', workspaceId: 'w1', tipo: 'simulador', nome: 'Chat de teste' });
const contato = (id, campos) => inserir('contatos', { id, workspaceId: 'w1', conexaoId: 'cx1', nome: id, estado: 'ativo', ...campos });
const ia = { tipo: 'agente', id: 'ag-ligado', nome: 'Eduarda' };
const pessoa = { tipo: 'membro', id: 'm1', nome: 'Pessoa' };

contato('ia-esperando-5min', { responsavel: ia, estado: 'ia', ultimaEntradaEm: ha(5), ultimaSaidaEm: ha(30) });
contato('ia-respondida', { responsavel: ia, estado: 'ia', ultimaEntradaEm: ha(10), ultimaSaidaEm: ha(8) });
contato('ia-desligado-esperando-3h', { responsavel: { tipo: 'agente', id: 'ag-desligado', nome: 'Andreia' }, estado: 'ia', ultimaEntradaEm: ha(180) });
contato('ia-agente-apagado', { responsavel: { tipo: 'agente', id: 'ag-sumiu', nome: 'X' }, estado: 'ia', ultimaEntradaEm: ha(10), ultimaSaidaEm: ha(5) });
contato('ativo-esperando-2dias', { responsavel: pessoa, aceitoPor: 'm1', ultimaEntradaEm: ha(48 * 60) });
contato('ativo-pessoa-saiu', { responsavel: { tipo: 'membro', id: 'm2', nome: 'Saiu' }, aceitoPor: 'm2', ultimaEntradaEm: ha(20), ultimaSaidaEm: ha(10) });
contato('pendente-sem-ninguem-50min', { estado: 'pendente', ultimaEntradaEm: ha(50) });
contato('concluida-esperando', { estado: 'arquivado', responsavel: pessoa, ultimaEntradaEm: ha(5) });
contato('grupo-esperando', { grupo: true, ultimaEntradaEm: ha(5) });

inserir('logs', { workspaceId: 'w1', contatoId: 'ia-esperando-5min', tipo: 'erro_envio', descricao: 'Falha ao enviar: jid 5581999990000@s.whatsapp.net nao existe', criadoEm: ha(60) });
inserir('logs', { workspaceId: 'w1', contatoId: 'ia-esperando-5min', tipo: 'erro_envio', descricao: 'Falha ao enviar: jid 5581988880000@s.whatsapp.net nao existe', criadoEm: ha(30) });
inserir('logs', { workspaceId: 'w1', contatoId: 'ia-esperando-5min', tipo: 'erro_ia', descricao: 'Falha do agente: 529 overloaded', criadoEm: ha(3 * 24 * 60) });
inserir('logs', { workspaceId: 'w1', contatoId: 'ia-esperando-5min', tipo: 'erro_ia', descricao: 'Falha do agente: antiga', criadoEm: ha(10 * 24 * 60) });
inserir('logs', { workspaceId: 'w1', contatoId: null, tipo: 'reativacao', descricao: 'nao e falha', criadoEm: ha(5) });

inserir('agendamentos', { contatoId: 'ia-esperando-5min', estado: 'pendente', quando: ha(60) });
inserir('agendamentos', { contatoId: 'ia-esperando-5min', estado: 'pendente', quando: ha(-60) });
inserir('agendamentos', { contatoId: 'ativo-esperando-2dias', estado: 'erro', erro: 'Template 5581977770000 removido' });
inserir('agendamentos', { contatoId: 'ativo-esperando-2dias', estado: 'enviado', enviadoEm: ha(120) });
inserir('agendamentos', { contatoId: 'ativo-esperando-2dias', estado: 'enviado', enviadoEm: ha(10 * 24 * 60) });
inserir('agendamentos', { contatoId: 'ia-esperando-5min', estado: 'cancelado', motivoCancelamento: 'status alterado', atualizadoEm: ha(30) });
inserir('agendamentos', { contatoId: 'ia-esperando-5min', estado: 'cancelado', motivoCancelamento: 'status alterado', atualizadoEm: ha(40) });

inserir('status', { id: 'st-qualificado', workspaceId: 'w1', nome: 'Qualificado', followups: [{ minutos: 60 }, { minutos: 1440 }] });
inserir('status', { id: 'st-analise', workspaceId: 'w1', nome: 'Em análise', followups: [] });
inserir('status', { id: 'st-vazio', workspaceId: 'w1', nome: 'Coluna vazia', followups: [] });
contato('na-analise', { statusId: 'st-analise', estado: 'arquivado' });
contato('qualificado', { statusId: 'st-qualificado', responsavel: ia, estado: 'ia' });

console.log(JSON.stringify(saudeDoAtendimento('w1', AGORA)));
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
    const e = b.esperandoResposta;

    s.ok(
      'conta quem espera resposta na aba certa, fora concluida e grupo',
      e.ia.total === 2 && e.ativos.total === 1 && e.pendentes.total === 1,
      JSON.stringify(e),
    );
    s.ok(
      'e na faixa de tempo certa, com a mais antiga de cada aba',
      e.ia.ate15min === 1 && e.ia.ate4h === 1 && e.ativos.maisDe24h === 1 && e.pendentes.ate1h === 1 && e.ativos.maisAntigaHaMin === 2880,
      JSON.stringify(e),
    );
    s.ok(
      'acha a conversa na IA com agente desligado ou apagado, e quantas delas esperam resposta',
      b.naIaComAgenteDesligado === 2 && b.naIaComAgenteDesligadoEsperando === 1,
      JSON.stringify([b.naIaComAgenteDesligado, b.naIaComAgenteDesligadoEsperando]),
    );
    s.ok('acha a conversa com pessoa que saiu da equipe', b.comPessoaForaDaEquipe === 1, String(b.comPessoaForaDaEquipe));
    s.ok('conta a pendente sem ninguem', b.pendentesSemNinguem === 1, String(b.pendentesSemNinguem));
    s.ok(
      'conta as falhas por periodo, so dos tipos de falha',
      b.falhas.erro_envio.em24h === 2 && b.falhas.erro_ia.em24h === 0 && b.falhas.erro_ia.em7dias === 1 && !('reativacao' in b.falhas),
      JSON.stringify(b.falhas),
    );
    const motivoDeEnvio = b.motivosDeErroDeEnvio[0];
    s.ok(
      'junta o mesmo motivo de envio, sem o telefone do cliente',
      b.motivosDeErroDeEnvio.length === 1 && motivoDeEnvio.vezes === 2 && !/\d{6,}/.test(JSON.stringify(b)),
      JSON.stringify(b.motivosDeErroDeEnvio),
    );
    s.ok('motivo da IA so dos ultimos 7 dias', b.motivosDeErroDaIa.length === 1 && b.motivosDeErroDaIa[0].motivo === '529 overloaded', JSON.stringify(b.motivosDeErroDaIa));
    s.ok(
      'agendamentos: pendentes, atrasados e com erro',
      b.agendamentos.pendentes === 2 && b.agendamentos.atrasados === 1 && b.agendamentos.comErro === 1,
      JSON.stringify(b.agendamentos),
    );
    const a = b.agendamentos;
    s.ok(
      'follow-up: quantos por estado, enviados na semana, o ultimo envio e o proximo',
      a.porEstado.enviado === 2 && a.porEstado.cancelado === 2 && a.enviadosEm7dias === 1 && Boolean(a.ultimoEnviadoEm) && Boolean(a.proximoEm),
      JSON.stringify(a),
    );
    s.ok('e por que foram cancelados na semana', a.motivosDeCancelamentoEm7dias[0]?.motivo === 'status alterado' && a.motivosDeCancelamentoEm7dias[0]?.vezes === 2, JSON.stringify(a.motivosDeCancelamentoEm7dias));
    const porStatus = Object.fromEntries(b.followupPorStatus.map((x) => [x.status, x]));
    s.ok(
      'por status: quantos passos de follow-up e quantas conversas, sem a coluna vazia',
      porStatus.Qualificado?.passos === 2 && porStatus.Qualificado?.conversas === 1 && porStatus['Em análise']?.passos === 0 && porStatus['Em análise']?.concluidas === 1 && !porStatus['Coluna vazia'],
      JSON.stringify(b.followupPorStatus),
    );
    s.ok(
      'o numero de verdade aparece com o estado e a ultima mensagem de cliente; o simulador nao',
      b.conexoes.length === 1 && b.conexoes[0].estado === 'conectado' && Boolean(b.conexoes[0].ultimaMensagemDeClienteEm),
      JSON.stringify(b.conexoes),
    );
  } finally {
    fs.rmSync(pasta, { recursive: true, force: true });
  }
  return s;
}
