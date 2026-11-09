import { spawn } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

import { suite } from './apoio.js';

/**
 * A desistencia que ESPERA depois da ultima mensagem do follow-up
 * (automacao/followup.js: dispararAgendamento e processarDesistenciasPrevistas),
 * 03/11/2026: "depois, se nao tiver nenhuma resposta, desqualifica".
 *
 * Ate aqui o ultimo passo desistia do lead NA HORA em que a ultima mensagem saia: o
 * lead nao tinha tempo de responder a ela, e quem tinha respondido no meio da
 * sequencia era desqualificado do mesmo jeito. Agora, com `esperaMinutos` no ultimo
 * passo, o lead espera; e so e desqualificado se nao respondeu em momento nenhum.
 *
 * O que nao pode falhar:
 *  - a ultima mensagem sai e o lead NAO e desistido na hora: fica marcado para depois,
 *    visivel, e nada acontece antes do prazo;
 *  - no prazo, sem nenhuma resposta: vai para o status de desistencia, concluida e sem
 *    responsavel;
 *  - se o cliente respondeu em qualquer ponto DEPOIS que a sequencia comecou, nao e
 *    desqualificado (e o motivo fica no historico); resposta de ANTES da sequencia nao
 *    conta;
 *  - mudar o status da conversa cancela a espera (e, por seguranca, o prazo confere o
 *    status de novo); contrato em andamento tambem a evita;
 *  - sem espera no ultimo passo (todos os status de antes), continua desistindo na hora.
 */
export async function testarDesistenciaDoFollowUp({ raiz }) {
  const s = suite('A desistência do follow-up espera, e só desqualifica quem não respondeu');
  const url = (arquivo) => JSON.stringify(pathToFileURL(path.join(raiz, arquivo)).href);
  const pasta = fs.mkdtempSync(path.join(os.tmpdir(), 'desistencia-followup-'));
  const script = path.join(pasta, 'desistencia.mjs');

  fs.writeFileSync(
    script,
    `import { iniciarBanco, achar, inserir, listar, atualizar, mensagensDe, encerrarBanco } from ${url('servidor/nucleo/banco.js')};
import { aplicarStatus, dispararAgendamento, processarDesistenciasPrevistas, agendamentosPendentes, iniciarAgendador, pararAgendador } from ${url('servidor/automacao/followup.js')};
iniciarBanco();
const resultado = {};
const DIA = 24 * 60 * 60 * 1000;

inserir('workspaces', { id: 'w1', nome: 'Geral' });
inserir('conexoes', { id: 'cx1', workspaceId: 'w1', tipo: 'simulador', nome: 'Sim' });
for (const a of ['fu1', 'fu2', 'fu3']) inserir('templates', { id: 'tpl-' + a, workspaceId: 'w1', nome: a, atalho: a, conteudo: 'Ola {{nome}} ' + a });
inserir('templates', { id: 'tpl-final', workspaceId: 'w1', nome: 'encerramento', atalho: 'followup5', conteudo: 'Oi, {{nome}}! Como nao consegui seu retorno, vou encerrar nosso acompanhamento.' });
inserir('status', { id: 'st-desq', workspaceId: 'w1', nome: 'Desqualificado', tipo: 'desqualificado', followups: [] });
inserir('status', { id: 'st-qual', workspaceId: 'w1', nome: 'Qualificado', tipo: 'qualificado', followups: [] });
/* O status com a sequencia de 4 mensagens e a desistencia com espera de 1 dia. */
const passos = (desistir) => ['fu1', 'fu2', 'fu2', 'fu3'].map((a, i, todos) => ({ id: 'p' + i, templateId: 'tpl-' + a, minutos: [30, 2910, 7230, 14430][i], desistir: i === todos.length - 1 ? desistir : null }));
inserir('status', { id: 'st-fu', workspaceId: 'w1', nome: 'Follow up', tipo: 'nenhum', followups: passos({ ativo: true, statusId: 'st-desq', responsavel: null, arquivar: true, esperaMinutos: 1440, templateId: 'tpl-final' }) });
/* Aviso de encerramento SEM dias de espera: sai na hora (no proximo tique), depois de conferir que ninguem respondeu.
   Pedido do escritorio em 09/11/2026: so o status chamado "Follow up" dispara follow-up automatico — os tres
   status deste teste (acima e abaixo) tem esse nome de proposito, so para exercitar o algoritmo em configuracoes
   diferentes; sao isolados nesta base de teste descartavel, sem conflito de nome entre eles. */
inserir('status', { id: 'st-so-aviso', workspaceId: 'w1', nome: 'Follow up', tipo: 'nenhum', followups: passos({ ativo: true, statusId: 'st-desq', responsavel: null, arquivar: true, templateId: 'tpl-final' }) });
/* O de antes: desiste na hora, sem espera. */
inserir('status', { id: 'st-antigo', workspaceId: 'w1', nome: 'Follow up', tipo: 'nenhum', followups: passos({ ativo: true, statusId: 'st-desq', responsavel: null, arquivar: true }) });

let numero = 5581900000000;
const lead = (id, extra = {}) => { numero += 1; return inserir('contatos', { id, workspaceId: 'w1', conexaoId: 'cx1', telefone: String(numero), nome: id, estado: 'pendente', responsavel: { tipo: 'membro', id: 'm1', nome: 'Ana' }, statusId: null, etiquetas: [], ...extra }); };
const entrar = async (id, statusId = 'st-fu') => aplicarStatus(achar('contatos', id), achar('status', statusId), { tipo: 'membro', nome: 'Ana' });
/* Sai as quatro mensagens, na ordem, como o relogio faria. */
const enviarTodas = async (id) => { for (const a of agendamentosPendentes(id).sort((x, y) => x.indice - y.indice)) await dispararAgendamento(achar('agendamentos', a.id)); };
const estadoDe = (id) => { const c = achar('contatos', id); return { status: c.statusId, estado: c.estado, responsavel: c.responsavel, prevista: Boolean(c.desistenciaPrevista) }; };
const logs = (id, tipo) => listar('logs', { contatoId: id, tipo }).map((l) => l.descricao);

/* A. Ninguem respondeu: as quatro saem, o lead NAO e desistido na hora, e e desqualificado no prazo. */
lead('A'); await entrar('A');
await enviarTodas('A');
const apos = achar('contatos', 'A');
resultado.A = {
  enviadas: listar('agendamentos', { contatoId: 'A', estado: 'enviado' }).length,
  naHora: estadoDe('A'),
  espera: Math.round((Date.parse(apos.desistenciaPrevista?.em) - Date.now()) / 60000),
  agendada: logs('A', 'desistencia_agendada').length,
};
const antesDoPrazo = await processarDesistenciasPrevistas(Date.now() + 12 * 60 * 60 * 1000);
resultado.A.antesDoPrazo = { feitas: antesDoPrazo.length, ...estadoDe('A') };
const noPrazo = await processarDesistenciasPrevistas(Date.now() + 25 * 60 * 60 * 1000);
resultado.A.noPrazo = { feitas: noPrazo, ...estadoDe('A'), statusTipo: achar('status', achar('contatos', 'A').statusId)?.tipo, log: logs('A', 'desistencia').length };
const avisosDe = (id) => mensagensDe(id).filter((m) => m.direcao === 'saida' && m.templateId === 'tpl-final');
resultado.A.aviso = avisosDe('A').map((m) => ({ texto: m.conteudo, situacao: m.situacao, autor: m.autor?.nome }));
resultado.A.todasAsMensagens = mensagensDe('A').filter((m) => m.direcao === 'saida').length;

/* B. O cliente respondeu DEPOIS que a sequencia comecou (mesmo que no meio): nao e desqualificado. */
lead('B'); await entrar('B');
await new Promise((ok) => setTimeout(ok, 20));
atualizar('contatos', 'B', { ultimaEntradaEm: new Date().toISOString() });
await enviarTodas('B');
const fb = await processarDesistenciasPrevistas(Date.now() + 25 * 60 * 60 * 1000);
resultado.B = { feitas: fb.includes('B'), ...estadoDe('B'), motivo: logs('B', 'desistencia_evitada'), avisos: avisosDe('B').length };

/* C. Resposta de ANTES da sequencia nao conta: e desqualificado. */
lead('C', { ultimaEntradaEm: new Date(Date.now() - 30 * DIA).toISOString() }); await entrar('C');
await enviarTodas('C');
const fc = await processarDesistenciasPrevistas(Date.now() + 25 * 60 * 60 * 1000);
resultado.C = { feitas: fc.includes('C'), status: achar('contatos', 'C').statusId, estado: achar('contatos', 'C').estado };

/* D. Mudar o status durante a espera cancela. */
lead('D'); await entrar('D'); await enviarTodas('D');
resultado.D = { antes: estadoDe('D').prevista };
await aplicarStatus(achar('contatos', 'D'), achar('status', 'st-qual'), { tipo: 'membro', nome: 'Ana' });
resultado.D.logoDepois = estadoDe('D').prevista;
const fd = await processarDesistenciasPrevistas(Date.now() + 25 * 60 * 60 * 1000);
resultado.D.depois = { feitas: fd.includes('D'), ...estadoDe('D') };
/* E, por seguranca, o prazo confere o status de novo, mesmo se a marca sobrar. */
lead('E'); await entrar('E'); await enviarTodas('E');
atualizar('contatos', 'E', { statusId: 'st-qual' });
const fe = await processarDesistenciasPrevistas(Date.now() + 25 * 60 * 60 * 1000);
resultado.E = { feitas: fe.includes('E'), status: achar('contatos', 'E').statusId, motivo: logs('E', 'desistencia_evitada') };

/* F. Contrato em andamento evita. */
lead('F'); await entrar('F'); await enviarTodas('F');
inserir('contratos', { id: 'k1', workspaceId: 'w1', contatoId: 'F', situacao: 'link_enviado' });
const ff = await processarDesistenciasPrevistas(Date.now() + 25 * 60 * 60 * 1000);
resultado.F = { feitas: ff.includes('F'), status: achar('contatos', 'F').statusId, motivo: logs('F', 'desistencia_evitada'), avisos: avisosDe('F').length };

/* G. Sem espera no ultimo passo (como todos os status de antes): desiste na hora, e nada fica marcado. */
lead('G'); await entrar('G', 'st-antigo'); await enviarTodas('G');
resultado.G = { status: achar('contatos', 'G').statusId, estado: achar('contatos', 'G').estado, prevista: Boolean(achar('contatos', 'G').desistenciaPrevista) };

/* I. O relogio do servidor (o laco do agendador) tambem confere a desistencia que chegou na hora. */
lead('I'); await entrar('I'); await enviarTodas('I');
atualizar('contatos', 'I', { desistenciaPrevista: { ...achar('contatos', 'I').desistenciaPrevista, em: new Date(Date.now() - 1000).toISOString() } });
iniciarAgendador(50);
await new Promise((ok) => setTimeout(ok, 500));
pararAgendador();
resultado.I = { status: achar('contatos', 'I').statusId, estado: achar('contatos', 'I').estado, prevista: Boolean(achar('contatos', 'I').desistenciaPrevista) };

/* J. O aviso de encerramento NAO sai (a conversa nao tem conexao): o lead nao e desqualificado calado.
   Tenta de novo em duas horas, tres vezes; so depois desqualifica, sem o aviso, e diz isso no historico. */
lead('J', { conexaoId: 'cx-que-nao-existe' }); await entrar('J');
const prevJ = { em: new Date(Date.now() - 1000).toISOString(), desistir: achar('status', 'st-fu').followups.at(-1).desistir, sequenciaIniciadaEm: new Date(Date.now() - 20 * DIA).toISOString(), statusOrigemId: 'st-fu' };
atualizar('contatos', 'J', { desistenciaPrevista: prevJ });
const agoraJ = Date.now();
await processarDesistenciasPrevistas(agoraJ);
const j1 = { ...estadoDe('J'), tentativas: achar('contatos', 'J').desistenciaPrevista?.tentativas, em: Math.round((Date.parse(achar('contatos', 'J').desistenciaPrevista?.em) - agoraJ) / 60000) };
await processarDesistenciasPrevistas(agoraJ + 3 * 60 * 60 * 1000);
const j2 = { ...estadoDe('J'), tentativas: achar('contatos', 'J').desistenciaPrevista?.tentativas };
await processarDesistenciasPrevistas(agoraJ + 6 * 60 * 60 * 1000);
resultado.J = { j1, j2, fim: { ...estadoDe('J'), statusTipo: achar('status', achar('contatos', 'J').statusId)?.tipo }, adiada: logs('J', 'desistencia_adiada').length, semAviso: logs('J', 'desistencia_sem_aviso').length };

/* K. Aviso sem dias de espera: nada de desistir calado; o aviso sai e o lead e desqualificado no proximo tique. */
lead('K'); await entrar('K', 'st-so-aviso'); await enviarTodas('K');
const prevK = Boolean(achar('contatos', 'K').desistenciaPrevista);
const statusK0 = achar('contatos', 'K').statusId;
await processarDesistenciasPrevistas(Date.now() + 5000);
resultado.K = { previstaAposAUltima: prevK, statusAntes: statusK0, statusDepois: achar('contatos', 'K').statusId, avisos: avisosDe('K').length };
lead('K2'); await entrar('K2', 'st-so-aviso');
await new Promise((ok) => setTimeout(ok, 20));
atualizar('contatos', 'K2', { ultimaEntradaEm: new Date().toISOString() });
await enviarTodas('K2');
await processarDesistenciasPrevistas(Date.now() + 5000);
resultado.K2 = { status: achar('contatos', 'K2').statusId, avisos: avisosDe('K2').length };

/* H. Um tique do relogio so, de novo: nada a repetir. */
const repete = await processarDesistenciasPrevistas(Date.now() + 40 * 60 * 60 * 1000);
resultado.H = { feitas: repete.length };

console.log(JSON.stringify(resultado));
await encerrarBanco();
await new Promise((ok) => setTimeout(ok, 300));
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
    if (!s.ok('o escritório de teste roda sem erro', r.codigo === 0, r.texto.slice(-1200))) return s;
    const b = JSON.parse(r.texto.trim().split('\n').pop());

    s.ok(
      'as quatro mensagens saem e o lead NÃO é desistido na hora: continua no status, e fica marcado para daqui a um dia',
      b.A.enviadas === 4 && b.A.naHora.status === 'st-fu' && b.A.naHora.estado === 'pendente' && b.A.naHora.prevista === true && b.A.espera >= 1438 && b.A.espera <= 1441 && b.A.agendada === 1,
      JSON.stringify(b.A),
    );
    s.ok('antes do prazo nada acontece', b.A.antesDoPrazo.feitas === 0 && b.A.antesDoPrazo.status === 'st-fu' && b.A.antesDoPrazo.prevista === true, JSON.stringify(b.A.antesDoPrazo));
    s.ok(
      'no prazo, sem nenhuma resposta: vai para Desqualificado, concluída e sem responsável, uma vez só',
      b.A.noPrazo.feitas.length === 1 && b.A.noPrazo.status === 'st-desq' && b.A.noPrazo.statusTipo === 'desqualificado' && b.A.noPrazo.estado === 'arquivado' && b.A.noPrazo.responsavel === null && b.A.noPrazo.prevista === false && b.A.noPrazo.log === 1,
      JSON.stringify(b.A.noPrazo),
    );
    s.ok(
      'se o cliente respondeu depois que a sequência começou, mesmo no meio, NÃO é desqualificado, e o motivo fica no histórico',
      b.B.feitas === false && b.B.status === 'st-fu' && b.B.estado === 'pendente' && b.B.prevista === false && b.B.motivo.some((m) => /respondeu/.test(m)),
      JSON.stringify(b.B),
    );
    s.ok('resposta de ANTES da sequência não conta: é desqualificado', b.C.feitas === true && b.C.status === 'st-desq' && b.C.estado === 'arquivado', JSON.stringify(b.C));
    s.ok(
      'mudar o status durante a espera cancela a desqualificação',
      b.D.antes === true && b.D.logoDepois === false && b.D.depois.feitas === false && b.D.depois.status === 'st-qual' && b.D.depois.prevista === false && b.D.depois.estado === 'pendente',
      JSON.stringify(b.D),
    );
    s.ok('e, por segurança, o prazo confere o status de novo mesmo se a marca sobrar', b.E.feitas === false && b.E.status === 'st-qual' && b.E.motivo.some((m) => /status/.test(m)), JSON.stringify(b.E));
    s.ok('contrato em andamento evita a desqualificação', b.F.feitas === false && b.F.status === 'st-fu' && b.F.motivo.some((m) => /contrato/.test(m)), JSON.stringify(b.F));
    s.ok(
      'sem espera no último passo (os status de antes) continua desistindo na hora, sem marcar nada',
      b.G.status === 'st-desq' && b.G.estado === 'arquivado' && b.G.prevista === false,
      JSON.stringify(b.G),
    );
    s.ok('o relógio do servidor (o laço do agendador) também confere a desistência que chegou na hora', b.I.status === 'st-desq' && b.I.estado === 'arquivado' && b.I.prevista === false, JSON.stringify(b.I));
    s.ok(
      'o aviso de encerramento sai com o nome do cliente, antes de desqualificar, e é a única mensagem depois da sequência',
      b.A.aviso.length === 1 && b.A.aviso[0].texto === 'Oi, A! Como nao consegui seu retorno, vou encerrar nosso acompanhamento.' && b.A.aviso[0].situacao !== 'erro' && b.A.aviso[0].autor === 'Follow-up' && b.A.todasAsMensagens === 5,
      JSON.stringify({ aviso: b.A.aviso, total: b.A.todasAsMensagens }),
    );
    s.ok('quem respondeu não recebe o aviso de encerramento (nem o contrato em andamento)', b.B.avisos === 0 && b.F.avisos === 0, JSON.stringify({ B: b.B.avisos, F: b.F.avisos }));
    s.ok(
      'se o aviso não sai, o lead não é desqualificado calado: tenta de novo em duas horas, até três vezes, e só então desqualifica, dizendo isso no histórico',
      b.J.j1.status === 'st-fu' && b.J.j1.prevista === true && b.J.j1.tentativas === 1 && b.J.j1.em >= 118 && b.J.j1.em <= 122 && b.J.j2.status === 'st-fu' && b.J.j2.tentativas === 2 && b.J.fim.status === 'st-desq' && b.J.fim.statusTipo === 'desqualificado' && b.J.fim.estado === 'arquivado' && b.J.adiada === 2 && b.J.semAviso === 1,
      JSON.stringify(b.J),
    );
    s.ok(
      'aviso de encerramento sem dias de espera: o lead não é desistido calado no ato da quarta mensagem; no tique seguinte o aviso sai e ele é desqualificado, e quem respondeu não recebe nada',
      b.K.previstaAposAUltima === true && b.K.statusAntes === 'st-so-aviso' && b.K.statusDepois === 'st-desq' && b.K.avisos === 1 && b.K2.status === 'st-so-aviso' && b.K2.avisos === 0,
      JSON.stringify({ K: b.K, K2: b.K2 }),
    );
    s.ok('um tique a mais não repete nada', b.H.feitas === 0, JSON.stringify(b.H));
  } finally {
    fs.rmSync(pasta, { recursive: true, force: true });
  }
  return s;
}
