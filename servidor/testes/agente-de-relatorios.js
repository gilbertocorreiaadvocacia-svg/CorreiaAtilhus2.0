import { spawn } from 'node:child_process';
import fs from 'node:fs';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

import { cliente, suite } from './apoio.js';

/**
 * O agente de relatorios e as contas do fim de semana (03/11/2026): "quantos
 * leads entraram e foram atendidos, quantos foram qualificados e
 * desqualificados, com estatisticas".
 *
 * O que nao pode falhar:
 *  - o fim de semana e o de SAO PAULO: quem escreveu sabado as 23h30 entrou no
 *    sabado, nao no domingo (o instante ISO cai no dia seguinte, em UTC);
 *  - lead que entrou e o que o CLIENTE iniciou no periodo: fora historico
 *    importado, grupo e conversa aberta pela equipe;
 *  - atendido e ter recebido resposta; nota interna, envio que falhou e o video
 *    automatico de boas-vindas nao contam, e o tempo ate a resposta nao termina
 *    no video;
 *  - qualificado e a conversa que CHEGOU a etapa no periodo (conta conversa, nao
 *    evento; vale para antiga e nova); evento de importacao nao conta;
 *  - todo numero do texto da IA existe nas contas: texto com numero inventado e
 *    descartado, e o relatorio sai com o texto padrao e o aviso;
 *  - sem IA (credito, chave) o relatorio sai do mesmo jeito;
 *  - um relatorio por vez por escritorio;
 *  - toda segunda a partir das 7h, um relatorio por fim de semana, so para quem
 *    tem o agente ligado e teve movimento, e so dono/administrador e avisado;
 *  - so dono e administrador veem e geram.
 *
 * A Anthropic e a de mentira, criada aqui: a n-esima chamada devolve a n-esima
 * resposta da lista.
 */

const TEXTO_BOM = `## Resumo
Entraram 8 leads novos no fim de semana de 31/10 e 01/11, e 5 foram atendidos (62,5%). Foram 3 conversas qualificadas e 1 desqualificada no período.

## Qualificação
- Dos leads novos, 2 estão qualificados ou além (25%).

## Velocidade do atendimento
- Mediana de 3 minutos. 9 em cada 10 leads atendidos receberam a primeira resposta em até 35 minutos.

## Pontos de atenção
- 3 leads novos ainda não receberam resposta.`;

const TEXTO_COM_NUMERO_INVENTADO = `## Resumo
Entraram 77 leads novos no fim de semana, e 5 foram atendidos (62,5%). Foi um fim de semana forte, com 3 conversas qualificadas e 1 desqualificada no período.

## Velocidade do atendimento
- Mediana de 3 minutos até a primeira resposta, bem abaixo do que se espera.`;

export async function testarAgenteDeRelatorios({ raiz }) {
  const s = suite('O agente de relatórios conta o fim de semana e escreve sem inventar número');
  const url = (arquivo) => JSON.stringify(pathToFileURL(path.join(raiz, arquivo)).href);
  const pasta = fs.mkdtempSync(path.join(os.tmpdir(), 'agente-relatorios-'));
  const script = path.join(pasta, 'relatorio.mjs');

  const pedidos = [];
  const respostas = [
    { texto: TEXTO_BOM },
    { texto: TEXTO_COM_NUMERO_INVENTADO },
    { erro: 'Your credit balance is too low to access the Anthropic API. Please go to Plans & Billing to upgrade or purchase credits.' },
    { texto: TEXTO_BOM },
  ];
  const iaFalsa = http.createServer((req, res) => {
    const pedacos = [];
    req.on('data', (p) => pedacos.push(p));
    req.on('end', () => {
      let corpo = {};
      try {
        corpo = JSON.parse(Buffer.concat(pedacos).toString('utf8'));
      } catch {}
      pedidos.push(corpo);
      const resposta = respostas[pedidos.length - 1] || { texto: TEXTO_BOM };
      res.setHeader('content-type', 'application/json');
      res.setHeader('connection', 'close');
      if (resposta.erro) {
        res.statusCode = 400;
        res.end(JSON.stringify({ type: 'error', error: { type: 'invalid_request_error', message: resposta.erro } }));
        return;
      }
      res.end(JSON.stringify({ id: 'msg_teste', type: 'message', role: 'assistant', model: 'claude-sonnet-5', content: [{ type: 'text', text: resposta.texto }], stop_reason: 'end_turn', usage: { input_tokens: 10, output_tokens: 8 } }));
    });
  });
  await new Promise((ok) => iaFalsa.listen(0, '127.0.0.1', ok));

  fs.writeFileSync(
    script,
    `import { iniciarBanco, inserir, inserirMensagem, mensagensDe, atualizar, listar, encerrarBanco } from ${url('servidor/nucleo/banco.js')};
import { estatisticasDoPeriodo, periodoDe, sabadoDoFimDeSemana, somarDias, diaDe, textoDasContas } from ${url('servidor/nucleo/relatorio-do-fim-de-semana.js')};
import { gerarRelatorio, conferirNumeros, verificarRelatoriosSemanais, configDoAgenteDeRelatorios, salvarConfigDoAgenteDeRelatorios, estaGerando, resumoPublicoDoAgente } from ${url('servidor/ia/agente-de-relatorios.js')};
iniciarBanco();
const espera = (ms) => new Promise((ok) => setTimeout(ok, ms));
const resultado = {};
/* O Brasil nao tem horario de verao desde 2019: -03:00 o ano todo. */
const brt = (dia, hora, segundos = 0) => new Date(dia + 'T' + hora + ':' + String(segundos).padStart(2, '0') + '-03:00').toISOString();
const AGORA = new Date('2026-11-03T13:00:00-03:00'); // terca-feira
const SAB = '2026-10-31';
const DOM = '2026-11-01';
const MON = '2026-11-02';
const IA = { tipo: 'agente', id: 'ag1', nome: 'Eduarda' };
const ANA = { tipo: 'membro', id: 'm1', nome: 'Dra. Ana' };

/* ---------- o escritorio ---------- */
inserir('workspaces', { id: 'w1', nome: 'Correia', horarioComercial: { fuso: 'America/Sao_Paulo', dias: { 0: null, 1: { de: '08:00', ate: '18:00' }, 2: { de: '08:00', ate: '18:00' }, 3: { de: '08:00', ate: '18:00' }, 4: { de: '08:00', ate: '18:00' }, 5: { de: '08:00', ate: '18:00' }, 6: null } } });
inserir('integracoes', { id: 'int1', workspaceId: 'w1', ia: { chaveAnthropic: 'sk-ant-teste' } });
for (const [id, papel] of [['dono', 'owner'], ['admin', 'admin'], ['atende', 'atendente']]) {
  inserir('usuarios', { id: 'u-' + id, nome: id });
  inserir('membros', { id: 'm-' + id, workspaceId: 'w1', usuarioId: 'u-' + id, papel });
}
inserir('conexoes', { id: 'cx1', workspaceId: 'w1', nome: 'Comercial', tipo: 'simulador' });
for (const [id, tipo, nome] of [['st-nova', 'nova', 'Nova conversa'], ['st-analise', 'analise', 'Análise'], ['st-qualificado', 'qualificado', 'Qualificado'], ['st-proposta', 'proposta', 'Proposta'], ['st-desqualificado', 'desqualificado', 'Desqualificado'], ['st-recusada', 'recusada', 'Recusada']]) {
  inserir('status', { id, workspaceId: 'w1', nome, tipo });
}

let telefone = 5581900000000;
function contato(id, extra = {}) {
  telefone += 1;
  return inserir('contatos', { id, workspaceId: 'w1', conexaoId: 'cx1', telefone: String(telefone), nome: id, estado: 'ia', responsavel: { ...IA }, statusId: 'st-nova', etiquetas: [], ...extra });
}
function msg(contatoId, quando, direcao, extra = {}) {
  return inserirMensagem(contatoId, { workspaceId: 'w1', direcao, tipo: 'texto', conteudo: 'x', criadoEm: quando, autor: direcao === 'entrada' ? { tipo: 'cliente', nome: contatoId } : { ...IA }, ...(direcao === 'saida' ? { situacao: 'enviada' } : {}), ...extra });
}
function etapa(contatoId, quando, tipo, autor = IA) {
  return inserir('logs', { workspaceId: 'w1', contatoId, tipo: 'status', descricao: 'Status: x -> ' + tipo, autor, dados: { statusId: 'st-' + tipo, tipo, anteriorId: null }, criadoEm: quando });
}
function falha(contatoId, quando, tipo, descricao) {
  return inserir('logs', { workspaceId: 'w1', contatoId, tipo, descricao, criadoEm: quando });
}

/* ---------- os leads do fim de semana (sab 31/10 e dom 01/11) ---------- */
contato('A1', { criadoEm: brt(SAB, '10:00'), statusId: 'st-qualificado' });
msg('A1', brt(SAB, '10:00'), 'entrada'); msg('A1', brt(SAB, '10:00', 30), 'saida');
etapa('A1', brt(SAB, '10:05'), 'qualificado', IA);

/* Sabado 23h30 em Sao Paulo = domingo 02h30 em UTC: tem de contar no sabado. */
contato('A2', { criadoEm: brt(SAB, '23:30'), statusId: 'st-desqualificado', estado: 'arquivado', responsavel: { ...ANA } });
msg('A2', brt(SAB, '23:30'), 'entrada'); msg('A2', brt(SAB, '23:40'), 'saida', { autor: { ...ANA } });
etapa('A2', brt(DOM, '09:00'), 'desqualificado', ANA);

contato('A3', { criadoEm: brt(DOM, '08:00') });
msg('A3', brt(DOM, '08:00'), 'entrada', { tipo: 'audio' });
falha('A3', brt(DOM, '08:00', 5), 'erro_ia', 'Falha da IA: Your credit balance is too low');
/* Evento de importacao nao conta como qualificacao. */
etapa('A3', brt(SAB, '12:00'), 'qualificado', { tipo: 'sistema', nome: 'Importacao LiderHub' });

/* 23h30 de domingo; a resposta so vem na segunda, depois do fim do periodo. */
contato('A4', { criadoEm: brt(DOM, '23:30'), statusId: 'st-analise' });
msg('A4', brt(DOM, '23:30'), 'entrada'); msg('A4', brt(MON, '00:05'), 'saida');

/* O video de boas-vindas sai 2 s depois do oi; a resposta de verdade, aos 3 minutos. */
contato('A5', { criadoEm: brt(SAB, '14:00'), statusId: 'st-proposta', boasVindasEnviadasEm: brt(SAB, '14:00', 2), boasVindasTemplateId: 'tpl-bv' });
msg('A5', brt(SAB, '14:00'), 'entrada');
msg('A5', brt(SAB, '14:00', 2), 'saida', { tipo: 'video', templateId: 'tpl-bv' });
msg('A5', brt(SAB, '14:03'), 'saida');
etapa('A5', brt(DOM, '10:00'), 'proposta', ANA);

/* So uma nota interna da equipe: ninguem respondeu o cliente. */
contato('A6', { criadoEm: brt(SAB, '15:00'), estado: 'pendente', responsavel: null });
msg('A6', brt(SAB, '15:00'), 'entrada'); msg('A6', brt(SAB, '15:05'), 'saida', { nota: true, autor: { ...ANA } });

/* O envio falhou: o cliente nao recebeu nada. */
contato('A7', { criadoEm: brt(SAB, '16:00') });
msg('A7', brt(SAB, '16:00'), 'entrada'); msg('A7', brt(SAB, '16:00', 10), 'saida', { situacao: 'erro', erro: { mensagem: 'sem conexao' } });
falha('A7', brt(SAB, '16:00', 10), 'erro_envio', 'Falha ao enviar: sem conexao');

contato('A8', { criadoEm: brt(DOM, '12:00'), statusId: 'st-recusada', estado: 'ativo', aceitoPor: 'm1', responsavel: { ...ANA } });
msg('A8', brt(DOM, '12:00'), 'entrada'); msg('A8', brt(DOM, '12:02'), 'saida');
etapa('A8', brt(DOM, '12:30'), 'recusada', ANA);

/* ---------- o que NAO e lead novo do fim de semana ---------- */
/* Sexta 23h30 (= sabado 02h30 UTC): entrou na sexta; volta a falar no sabado = retorno. */
contato('B1', { criadoEm: brt('2026-10-30', '23:30') });
msg('B1', brt('2026-10-30', '23:30'), 'entrada'); msg('B1', brt('2026-10-30', '23:31'), 'saida'); msg('B1', brt(SAB, '11:00'), 'entrada'); msg('B1', brt(SAB, '11:01'), 'saida', { situacao: 'enviada' });
/* Segunda 00h10: ja e o periodo seguinte. */
contato('B2', { criadoEm: brt(MON, '00:10') }); msg('B2', brt(MON, '00:10'), 'entrada');
/* Historico importado do celular: criado no fim de semana, mensagens antigas. */
contato('B3', { criadoEm: brt(SAB, '12:00'), importado: true }); msg('B3', brt('2026-08-10', '10:00'), 'entrada');
/* Aberta pela equipe, sem nenhuma mensagem do cliente. */
contato('B4', { criadoEm: brt(SAB, '13:00') }); msg('B4', brt(SAB, '13:00'), 'saida', { autor: { ...ANA } });
/* Grupo. */
contato('B5', { criadoEm: brt(SAB, '09:00'), grupo: true }); msg('B5', brt(SAB, '09:00'), 'entrada');
/* Conversa antiga que volta a falar e avanca de etapa. */
contato('B6', { criadoEm: brt('2026-09-01', '10:00'), statusId: 'st-proposta' });
msg('B6', brt(SAB, '09:00'), 'entrada'); msg('B6', brt(SAB, '09:02'), 'saida');
etapa('B6', brt(SAB, '09:30'), 'qualificado', IA); etapa('B6', brt(DOM, '11:00'), 'proposta', ANA);
/* Fora do periodo: nao entra em nada. */
falha('A3', brt(MON, '09:00'), 'erro_ia', 'Falha da IA: de novo, mas na segunda');

inserir('contratos', { id: 'k1', workspaceId: 'w1', contatoId: 'A1', situacao: 'assinado', assinadoEm: brt(DOM, '15:00'), criadoEm: brt('2026-10-30', '10:00') });
inserir('contratos', { id: 'k2', workspaceId: 'w1', contatoId: 'A5', situacao: 'aguardando', criadoEm: brt(SAB, '16:00') });
inserir('agendamentos', { id: 'f1', workspaceId: 'w1', contatoId: 'A3', tipo: 'followup', estado: 'enviado', enviadoEm: brt(SAB, '17:00') });
inserir('agendamentos', { id: 'f2', workspaceId: 'w1', contatoId: 'A3', tipo: 'followup', estado: 'erro', enviadoEm: brt(SAB, '17:00') });

/* ---------- o fim de semana anterior (24 e 25/10), para a comparacao ---------- */
contato('P1', { criadoEm: brt('2026-10-24', '10:00'), statusId: 'st-qualificado' });
msg('P1', brt('2026-10-24', '10:00'), 'entrada'); msg('P1', brt('2026-10-24', '10:01'), 'saida');
etapa('P1', brt('2026-10-24', '10:05'), 'qualificado', IA);
contato('P2', { criadoEm: brt('2026-10-25', '09:00') }); msg('P2', brt('2026-10-25', '09:00'), 'entrada');

/* ultimaEntradaEm / ultimaSaidaEm como o sistema os mantem. */
for (const c of listar('contatos', { workspaceId: 'w1' })) {
  const lista = mensagensDe(c.id).filter((m) => !m.nota);
  const entradas = lista.filter((m) => m.direcao === 'entrada').map((m) => m.criadoEm).sort();
  const saidas = lista.filter((m) => m.direcao === 'saida').map((m) => m.criadoEm).sort();
  atualizar('contatos', c.id, { ultimaEntradaEm: entradas.at(-1) || null, ultimaSaidaEm: saidas.at(-1) || null, ultimaMensagemEm: lista.map((m) => m.criadoEm).sort().at(-1) || c.criadoEm });
}

/* ================================ O PERIODO ================================ */
resultado.periodo = {
  sabadoDaTerca: sabadoDoFimDeSemana(new Date('2026-11-03T13:00:00-03:00')),
  sabadoDaSegundaCedo: sabadoDoFimDeSemana(new Date('2026-11-02T00:30:00-03:00')),
  sabadoDaSexta: sabadoDoFimDeSemana(new Date('2026-11-06T22:00:00-03:00')),
  sabadoDoSabado: sabadoDoFimDeSemana(new Date('2026-11-07T10:00:00-03:00')),
  sabadoDoDomingo: sabadoDoFimDeSemana(new Date('2026-11-08T23:50:00-03:00')),
  viraOMes: somarDias('2026-10-31', 1),
  voltaOAno: somarDias('2026-01-01', -1),
  sabadoNoUtc: diaDe(new Date(brt(SAB, '23:30'))),
};
const completo = periodoDe({ de: SAB, ate: DOM }, AGORA);
const emCurso = periodoDe({ de: SAB, ate: DOM }, new Date('2026-10-31T20:00:00-03:00'));
resultado.janela = { parcial: completo.parcial, emCursoParcial: emCurso.parcial, rotulo: completo.rotulo, dias: completo.dias.map((d) => d.rotulo), inicio: completo.inicio, fim: completo.fim };
const erroDe = (f) => { try { f(); return null; } catch (e) { return e.periodoInvalido ? 'invalido' : 'outro:' + e.message; } };
resultado.erros = {
  futuro: erroDe(() => periodoDe({ de: '2026-11-14', ate: '2026-11-15' }, AGORA)),
  invertido: erroDe(() => periodoDe({ de: DOM, ate: SAB }, AGORA)),
  formato: erroDe(() => periodoDe({ de: 'ontem', ate: 'hoje' }, AGORA)),
  longo: erroDe(() => periodoDe({ de: '2026-08-01', ate: '2026-10-31' }, AGORA)),
};

/* ================================ AS CONTAS ================================ */
const e = await estatisticasDoPeriodo('w1', { de: SAB, ate: DOM }, { agora: AGORA });
resultado.e = e;
resultado.texto = textoDasContas(e);

const vazio = await estatisticasDoPeriodo('w1', { de: '2026-09-05', ate: '2026-09-06' }, { agora: AGORA });
resultado.vazio = { semMovimento: vazio.semMovimento, texto: textoDasContas(vazio) };

/* ============================ A CONFERENCIA ============================ */
resultado.conferencia = {
  certo: conferirNumeros('Entraram 8 leads, 5 atendidos (62,5%). Mediana de 3 minutos.', e).ok,
  arredondado: conferirNumeros('Quase 63% foram atendidos.', e).ok,
  data: conferirNumeros('No fim de semana de 31/10 e 01/11/2026, entraram 8 leads.', e).ok,
  marcador: conferirNumeros('1. Entraram 8 leads\\n2) Foram 5 atendidos', e).ok,
  inventado: conferirNumeros('Entraram 77 leads.', e),
  decimalInventado: conferirNumeros('Foram 45,5% atendidos.', e),
  milhar: conferirNumeros('Foram 1.234 mensagens.', e),
};

/* ============================= O AGENTE ============================= */
const instrucao = 'Compare sempre com a meta de 50 leads por semana.';
resultado.config = {
  padrao: configDoAgenteDeRelatorios('w1'),
  depois: salvarConfigDoAgenteDeRelatorios('w1', { instrucoes: '  ' + instrucao + '  ' }),
  longa: salvarConfigDoAgenteDeRelatorios('w1', { instrucoes: 'x'.repeat(5000) }).instrucoes.length,
};
salvarConfigDoAgenteDeRelatorios('w1', { instrucoes: instrucao });

const ger = (extra = {}) => gerarRelatorio({ workspaceId: 'w1', de: SAB, ate: DOM, agora: AGORA, ...extra });
const antesDosCreditos = listar('creditos', { acao: 'relatorio_ia' }).length;

/* 1. A IA escreve um texto cujos numeros existem. */
const r1 = await ger({ geradoPor: { tipo: 'membro', id: 'm-admin', nome: 'admin' } });
resultado.r1 = { usouIa: r1.usouIa, texto: r1.texto, aviso: r1.avisoDaIa, origem: r1.origem, id: r1.id, geradoPor: r1.geradoPor, creditos: listar('creditos', { acao: 'relatorio_ia' }).length - antesDosCreditos };

/* 2. A IA inventa um numero: o texto dela e descartado. */
const r2 = await ger();
resultado.r2 = { usouIa: r2.usouIa, textoIgualAoPadrao: r2.texto === textoDasContas(r2.estatisticas), aviso: r2.avisoDaIa, creditos: listar('creditos', { acao: 'relatorio_ia' }).length - antesDosCreditos };

/* 3. A IA esta sem credito: sai o texto padrao, sem erro. */
const r3 = await ger();
resultado.r3 = { usouIa: r3.usouIa, textoIgualAoPadrao: r3.texto === textoDasContas(r3.estatisticas), aviso: r3.avisoDaIa };

/* 4. Dois pedidos ao mesmo tempo: o segundo e recusado, o primeiro conclui. */
const primeiro = ger();
const segundo = ger().then(() => 'passou', (erro) => (erro.ocupado ? 'ocupado' : 'outro:' + erro.message));
resultado.lock = { duranteOPrimeiro: estaGerando('w1'), segundo: await segundo };
await primeiro;
resultado.lock.depois = estaGerando('w1');

/* 5. Sem chave: texto padrao com o aviso. */
inserir('workspaces', { id: 'w3', nome: 'Sem IA' });
inserir('contatos', { id: 'S1', workspaceId: 'w3', conexaoId: 'cx3', telefone: '5581911111111', nome: 'S1', estado: 'ia', criadoEm: brt(SAB, '10:00'), etiquetas: [] });
inserirMensagem('S1', { workspaceId: 'w3', direcao: 'entrada', tipo: 'texto', conteudo: 'oi', criadoEm: brt(SAB, '10:00'), autor: { tipo: 'cliente', nome: 'S1' } });
const r5 = await gerarRelatorio({ workspaceId: 'w3', de: SAB, ate: DOM, agora: AGORA });
resultado.r5 = { usouIa: r5.usouIa, aviso: r5.avisoDaIa, novos: r5.estatisticas.leads.novos };

/* Quantos relatorios o w1 guardou ate aqui. */
resultado.guardados = listar('relatoriosDoAgente', { workspaceId: 'w1' }).length;
resultado.publico = resumoPublicoDoAgente('w1');
resultado.publicoSemTexto = !JSON.stringify(resumoPublicoDoAgente('w1')).includes('Entraram');

/* ======================== A SEGUNDA-FEIRA, 7H ======================== */
/* w4 tem movimento e o agente ligado; w5 tem movimento mas o agente desligado;
   w6 nao teve nada; w1 ja tem o relatorio desse fim de semana. */
for (const [id, extra] of [['w4', {}], ['w5', { agenteDeRelatorios: { automatico: false } }], ['w6', {}]]) {
  inserir('workspaces', { id, nome: 'Escritório ' + id, ...extra });
  inserir('usuarios', { id: 'u-' + id + '-adm', nome: id });
  inserir('membros', { id: 'm-' + id + '-adm', workspaceId: id, usuarioId: 'u-' + id + '-adm', papel: 'admin' });
  inserir('usuarios', { id: 'u-' + id + '-at', nome: id });
  inserir('membros', { id: 'm-' + id + '-at', workspaceId: id, usuarioId: 'u-' + id + '-at', papel: 'atendente' });
}
for (const w of ['w4', 'w5']) {
  inserir('contatos', { id: 'L-' + w, workspaceId: w, conexaoId: 'cx-' + w, telefone: '55819' + (w === 'w4' ? '22222222' : '33333333'), nome: 'L', estado: 'ia', criadoEm: brt(SAB, '11:00'), etiquetas: [] });
  inserirMensagem('L-' + w, { workspaceId: w, direcao: 'entrada', tipo: 'texto', conteudo: 'oi', criadoEm: brt(SAB, '11:00'), autor: { tipo: 'cliente', nome: 'L' } });
}
const jaTinha = listar('relatoriosDoAgente').length;
const cedo = await verificarRelatoriosSemanais(new Date('2026-11-02T05:00:00-03:00'));
const sabadoAgora = await verificarRelatoriosSemanais(new Date('2026-11-07T10:00:00-03:00'));
const domingoAgora = await verificarRelatoriosSemanais(new Date('2026-11-08T10:00:00-03:00'));
const segunda = await verificarRelatoriosSemanais(new Date('2026-11-02T07:30:00-03:00'));
const denovo = await verificarRelatoriosSemanais(new Date('2026-11-02T08:00:00-03:00'));
const avisos = (membro) => listar('notificacoes', { membroId: membro }).filter((n) => /relatório do fim de semana/.test(n.titulo));
resultado.segunda = {
  cedo: cedo.length,
  sabado: sabadoAgora.length,
  domingo: domingoAgora.length,
  geradosNaSegunda: segunda.map((r) => ({ w: r.workspaceId, origem: r.origem, de: r.periodo.de, ate: r.periodo.ate, parcial: r.periodo.parcial })),
  denovo: denovo.length,
  totalNovos: listar('relatoriosDoAgente').length - jaTinha,
  avisoAdmin: avisos('m-w4-adm').length,
  avisoAtendente: avisos('m-w4-at').length,
  textoDoAviso: avisos('m-w4-adm')[0]?.texto,
  w5Desligado: listar('relatoriosDoAgente', { workspaceId: 'w5' }).length,
  w6SemMovimento: listar('relatoriosDoAgente', { workspaceId: 'w6' }).length,
};
/* Na quarta, quem nao tinha ainda ganha (o servidor estava fora na segunda). */
inserir('workspaces', { id: 'w7', nome: 'Escritório w7' });
inserir('contatos', { id: 'L-w7', workspaceId: 'w7', conexaoId: 'cx-w7', telefone: '5581944444444', nome: 'L', estado: 'ia', criadoEm: brt(DOM, '20:00'), etiquetas: [] });
inserirMensagem('L-w7', { workspaceId: 'w7', direcao: 'entrada', tipo: 'texto', conteudo: 'oi', criadoEm: brt(DOM, '20:00'), autor: { tipo: 'cliente', nome: 'L' } });
resultado.quarta = (await verificarRelatoriosSemanais(new Date('2026-11-04T09:00:00-03:00'))).map((r) => r.workspaceId);

/* O limite de historico. */
for (let i = 0; i < 30; i += 1) inserir('relatoriosDoAgente', { id: 'velho' + i, workspaceId: 'w3', geradoEm: new Date(2026, 0, i + 1).toISOString(), periodo: {}, texto: 'x', estatisticas: {} });
await gerarRelatorio({ workspaceId: 'w3', de: SAB, ate: DOM, agora: AGORA });
resultado.aparado = listar('relatoriosDoAgente', { workspaceId: 'w3' }).length;

console.log(JSON.stringify(resultado));
await encerrarBanco();
await espera(300);
process.exit(0);
`,
  );

  try {
    const r = await new Promise((resolve) => {
      const p = spawn(process.execPath, [script], {
        env: { ...process.env, CORREIA_DADOS: pasta, CORREIA_ANTHROPIC_URL: `http://127.0.0.1:${iaFalsa.address().port}`, ANTHROPIC_API_KEY: '', OPENAI_API_KEY: '' },
        stdio: ['ignore', 'pipe', 'pipe'],
      });
      let texto = '';
      p.stdout.on('data', (d) => (texto += d));
      p.stderr.on('data', (d) => (texto += d));
      p.on('close', (codigo) => resolve({ codigo, texto }));
    });
    if (!s.ok('o escritório de teste roda sem erro', r.codigo === 0, r.texto.slice(-1200))) return s;
    const b = JSON.parse(r.texto.trim().split('\n').pop());
    const e = b.e;

    /* ---- O período ---- */
    s.ok(
      'o fim de semana a que o relatório se refere: de segunda a sexta é o que passou; sábado e domingo, o que está em curso',
      b.periodo.sabadoDaTerca === '2026-10-31' && b.periodo.sabadoDaSegundaCedo === '2026-10-31' && b.periodo.sabadoDaSexta === '2026-10-31' && b.periodo.sabadoDoSabado === '2026-11-07' && b.periodo.sabadoDoDomingo === '2026-11-07',
      JSON.stringify(b.periodo),
    );
    s.ok('somar dias vira o mês e o ano', b.periodo.viraOMes === '2026-11-01' && b.periodo.voltaOAno === '2025-12-31');
    s.ok('sábado 23h30 em São Paulo é sábado (em UTC já seria domingo)', b.periodo.sabadoNoUtc === '2026-10-31');
    s.ok(
      'o período vai de sábado 00h a domingo 23h59 de São Paulo, e se já acabou não é parcial',
      b.janela.inicio === '2026-10-31T03:00:00.000Z' && b.janela.fim === '2026-11-02T02:59:59.999Z' && b.janela.parcial === false && b.janela.emCursoParcial === true,
      JSON.stringify(b.janela),
    );
    s.ok('o rótulo diz sábado e domingo, e há um rótulo por dia', /sábado 31\/10 e domingo 01\/11\/2026/.test(b.janela.rotulo) && b.janela.dias.join('|') === 'sáb 31/10|dom 01/11', JSON.stringify(b.janela));
    s.ok(
      'período que ainda não começou, invertido, em formato errado ou longo demais é recusado com erro de período',
      Object.values(b.erros).every((x) => x === 'invalido'),
      JSON.stringify(b.erros),
    );

    /* ---- Os leads ---- */
    const l = e.leads;
    s.ok('entraram 8 leads: fora o histórico importado, o grupo, a conversa da equipe e os que entraram na sexta e na segunda', l.novos === 8 && l.criadosPelaEquipe === 1, JSON.stringify(l));
    s.ok('5 foram atendidos (62,5%) e 3 ficaram sem resposta: nota interna, envio que falhou e cliente sem resposta não contam', l.atendidos === 5 && l.atendidosPct === 62.5 && l.semResposta === 3, JSON.stringify(l));
    s.ok('quem respondeu primeiro: a IA a 4, a equipe a 1', l.primeiraRespostaPor.ia === 4 && l.primeiraRespostaPor.pessoa === 1 && l.primeiraRespostaPor.sistema === 0, JSON.stringify(l.primeiraRespostaPor));
    s.ok('dos 3 sem resposta, 2 têm falha da IA ou do envio registrada', l.semRespostaPorFalha === 2, String(l.semRespostaPorFalha));
    const t = l.primeiraResposta;
    s.ok(
      'tempo até a primeira resposta: mediana de 3 minutos, p90 de 35 minutos; o vídeo de boas-vindas (2 s) não encurta a conta, a resposta dada na segunda conta',
      t.amostras === 5 && t.medianaSeg === 180 && t.medianaTxt === '3 minutos' && t.p90Seg === 2100 && t.p90Txt === '35 minutos' && t.ate1minPct === 20 && t.ate5minPct === 60,
      JSON.stringify(t),
    );
    s.ok('todos os 8 chegaram fora do horário comercial, e 5 foram atendidos (4 pela IA)', l.foraDoHorario?.novos === 8 && l.foraDoHorario.atendidos === 5 && l.foraDoHorario.atendidosPorIa === 4, JSON.stringify(l.foraDoHorario));
    s.ok('10 conversas falaram no período, 2 delas antigas que voltaram (a que entrou na sexta e a de setembro)', l.conversasAtivas === 10 && l.retornos === 2, JSON.stringify(l));

    /* ---- Qualificação ---- */
    const q = e.qualificacao;
    s.ok(
      'qualificados no período: 3 conversas (2 leads novos e 1 antiga); quem passou por Qualificado e Proposta conta uma vez; a importação não conta',
      q.qualificados.total === 3 && q.qualificados.deLeadsNovos === 2 && q.qualificados.deConversasAntigas === 1 && q.qualificados.porEtapa.qualificado === 2 && q.qualificados.porEtapa.proposta === 2 && q.qualificados.porEtapa.sucesso === 0,
      JSON.stringify(q.qualificados),
    );
    s.ok(
      'quem qualificou: a IA a 2 (a Eduarda) e a equipe a 1',
      q.qualificados.porAutor[0]?.nome === 'Eduarda' && q.qualificados.porAutor[0].quantidade === 2 && q.qualificados.porAutor[0].classe === 'ia' && q.qualificados.porAutor[1]?.nome === 'Dra. Ana' && q.qualificados.porAutor[1].quantidade === 1,
      JSON.stringify(q.qualificados.porAutor),
    );
    s.ok('desqualificados no período: 1, um lead novo; recusada à parte', q.desqualificados.total === 1 && q.desqualificados.deLeadsNovos === 1 && q.outrosEncerramentos.recusada === 1 && q.outrosEncerramentos.desistencia === 0, JSON.stringify({ d: q.desqualificados, o: q.outrosEncerramentos }));
    s.ok('dos leads novos, hoje 2 estão qualificados ou além (25%) e 1 desqualificado (12,5%)', q.dosLeadsNovosHoje.qualificados === 2 && q.dosLeadsNovosHoje.qualificadosPct === 25 && q.dosLeadsNovosHoje.desqualificados === 1 && q.dosLeadsNovosHoje.desqualificadosPct === 12.5, JSON.stringify(q.dosLeadsNovosHoje));
    const et = e.etapaDosLeadsNovos;
    s.ok('onde os 8 leads novos estão por etapa, somando 8', et.nova === 3 && et.analise === 1 && et.qualificado === 1 && et.proposta === 1 && et.desqualificado === 1 && et.recusada === 1 && Object.values(et).reduce((a, x) => a + x, 0) === 8, JSON.stringify(et));
    const on = e.ondeEstaoOsLeadsNovos;
    s.ok('e onde estão agora: 5 com a IA, 1 esperando a equipe, 1 em atendimento, 1 concluído', on.comIa === 5 && on.aguardandoHumano === 1 && on.emAtendimento === 1 && on.concluidos === 1, JSON.stringify(on));

    /* ---- Dia, hora, mensagens ---- */
    const [sab, dom] = e.porDia;
    s.ok('sábado: 5 leads, 3 atendidos, 2 qualificados; domingo: 3 leads, 2 atendidos, 1 qualificado, 1 desqualificado (23h30 de sábado fica no sábado)',
      sab.novos === 5 && sab.atendidos === 3 && sab.qualificados === 2 && sab.desqualificados === 0 && dom.novos === 3 && dom.atendidos === 2 && dom.qualificados === 1 && dom.desqualificados === 1,
      JSON.stringify(e.porDia));
    s.ok('o horário de maior entrada é 23h (2 leads, sábado e domingo)', e.picoDeEntrada?.hora === 23 && e.picoDeEntrada.novos === 2 && e.porHora.length === 24 && e.porHora.reduce((a, x) => a + x.novos, 0) === 8, JSON.stringify(e.picoDeEntrada));
    s.ok('mensagens: 10 recebidas (1 áudio) e 8 enviadas (6 da IA, 2 da equipe), sem nota nem envio que falhou, e sem a resposta de segunda 00h05', e.mensagens.recebidas === 10 && e.mensagens.audiosRecebidos === 1 && e.mensagens.enviadas === 8 && e.mensagens.enviadasPorIa === 6 && e.mensagens.enviadasPorPessoas === 2, JSON.stringify(e.mensagens));
    s.ok('contrato assinado no período: 1; criado: 1; follow-up enviado: 1 (o que deu erro não conta)', e.contratos.assinados === 1 && e.contratos.criados === 1 && e.followups.enviados === 1, JSON.stringify({ c: e.contratos, f: e.followups }));
    s.ok('falhas do período: 1 da IA e 1 de envio, sem a de segunda; o motivo vem sem número comprido', e.falhas.erro_ia === 1 && e.falhas.erro_envio === 1 && e.falhas.total === 2 && e.falhas.motivos.length === 2, JSON.stringify(e.falhas));
    s.ok('por canal: tudo WhatsApp; por número: tudo no Comercial', e.porCanal[0]?.nome === 'WhatsApp' && e.porCanal[0].novos === 8 && e.porNumero[0]?.nome === 'Comercial' && e.porNumero[0].atendidos === 5, JSON.stringify({ c: e.porCanal, n: e.porNumero }));
    s.ok('quem respondeu primeiro, por nome: Eduarda 4, Dra. Ana 1', e.quemRespondeuPrimeiro[0]?.nome === 'Eduarda' && e.quemRespondeuPrimeiro[0].atendidos === 4 && e.quemRespondeuPrimeiro[1]?.atendidos === 1, JSON.stringify(e.quemRespondeuPrimeiro));
    s.ok('no momento: 3 conversas esperando resposta, todas há mais de 1 hora (as do histórico antigo e as do fim de semana anterior não entram)',e.noMomento.esperandoResposta === 3 && e.noMomento.esperandoHaMaisDe1h === 3, JSON.stringify(e.noMomento));

    /* ---- Comparação ---- */
    const c = e.comparacao;
    s.ok(
      'a comparação é com o fim de semana de 24 e 25/10: 2 leads, 1 atendido, 1 qualificado, mediana de 1 minuto',
      c.periodoAnterior.de === '2026-10-24' && c.periodoAnterior.ate === '2026-10-25' && c.anterior.novos === 2 && c.anterior.atendidos === 1 && c.anterior.qualificados === 1 && c.anterior.desqualificados === 0 && c.anterior.medianaSeg === 60,
      JSON.stringify(c),
    );
    s.ok('e a variação: +6 leads (300%), +4 atendidos, +2 qualificados, +1 desqualificado sem base de porcentagem', c.variacao.novos.diferenca === 6 && c.variacao.novos.pct === 300 && c.variacao.atendidos.diferenca === 4 && c.variacao.qualificados.diferenca === 2 && c.variacao.desqualificados.diferenca === 1 && c.variacao.desqualificados.pct === null, JSON.stringify(c.variacao));
    s.ok('a atenção aponta os 3 sem resposta e as falhas', e.atencao.length >= 2 && /3 leads novos ainda não receberam resposta/.test(e.atencao[0]) && e.amostraPequena === true, JSON.stringify(e.atencao));

    /* ---- O texto das contas ---- */
    s.ok(
      'o texto padrão traz as contas em frases, com a comparação',
      /Entraram 8 leads novos, e 5 \(62,5%\) foram atendidos: a IA respondeu primeiro a 4, a equipe a 1/.test(b.texto) &&
        /Qualificados no período: 3 \(2 leads novos e 1 de conversas anteriores\)/.test(b.texto) &&
        /Desqualificados no período: 1 \(1 lead novo e 0 de conversas anteriores\)/.test(b.texto) &&
        /mediana de 3 minutos/.test(b.texto) && /## Comparação com fim de semana: sábado 24\/10/.test(b.texto) && /amostra é pequena/.test(b.texto),
      b.texto,
    );
    s.ok('escritório sem movimento: o relatório diz isso em vez de zerar tudo', b.vazio.semMovimento === true && /Não houve lead novo/.test(b.vazio.texto), JSON.stringify(b.vazio));

    /* ---- A conferência de números ---- */
    const cf = b.conferencia;
    s.ok('número que existe passa, arredondado passa, data passa, marcador de lista passa', cf.certo && cf.arredondado && cf.data && cf.marcador, JSON.stringify(cf));
    s.ok('número inventado reprova e é apontado; decimal inventado e milhar inventado também', cf.inventado.ok === false && cf.inventado.estranhos.includes(77) && cf.decimalInventado.ok === false && cf.milhar.ok === false, JSON.stringify(cf));

    /* ---- O agente ---- */
    s.ok('a configuração nasce ligada, grava a instrução sem os espaços das pontas e corta o excesso', b.config.padrao.automatico === true && b.config.padrao.instrucoes === '' && b.config.depois.instrucoes === 'Compare sempre com a meta de 50 leads por semana.' && b.config.longa === 2000, JSON.stringify(b.config));
    s.ok(
      'o texto da IA com números que existem é guardado como está, e lança o custo',
      b.r1.usouIa === true && b.r1.texto.startsWith('## Resumo') && b.r1.aviso === null && b.r1.origem === 'manual' && b.r1.geradoPor?.nome === 'admin' && b.r1.creditos === 1,
      JSON.stringify(b.r1),
    );
    s.ok(
      'o texto da IA com número inventado é descartado: entra o texto padrão, com o aviso, sem custo',
      b.r2.usouIa === false && b.r2.textoIgualAoPadrao === true && /77/.test(b.r2.aviso || '') && b.r2.creditos === 1,
      JSON.stringify(b.r2),
    );
    s.ok('IA sem crédito: o relatório sai com o texto padrão e diz por quê', b.r3.usouIa === false && b.r3.textoIgualAoPadrao === true && /A IA não respondeu/.test(b.r3.aviso || '') && /credit balance/.test(b.r3.aviso || ''), JSON.stringify(b.r3));
    s.ok('sem chave de IA: texto padrão e aviso, e os números são os mesmos', b.r5.usouIa === false && /não está configurada/.test(b.r5.aviso || '') && b.r5.novos === 1, JSON.stringify(b.r5));
    s.ok('um relatório por vez por escritório: o segundo pedido é recusado enquanto o primeiro roda', b.lock.duranteOPrimeiro === true && b.lock.segundo === 'ocupado' && b.lock.depois === false, JSON.stringify(b.lock));

    const primeiro = pedidos[0];
    const sistema = String(primeiro?.system?.map?.((x) => x.text).join('\n') ?? primeiro?.system ?? '');
    const usuario = JSON.stringify(primeiro?.messages || []);
    s.ok('o pedido à IA leva as regras, a instrução do escritório e as contas em JSON, sem as definições', /NÃO TÊM EXCEÇÃO/.test(sistema) && /meta de 50 leads/.test(sistema) && /\\"novos\\":8/.test(usuario) && !/definicoes/.test(usuario), sistema.slice(0, 200));
    s.ok('cada relatório gerado fica guardado (4 do escritório até aqui)', b.guardados === 4, String(b.guardados));
    s.ok(
      'o resumo público (/api/saude) tem só contagens e datas: ligado, quantos, e o último com período, origem, se usou IA e os números; nada do texto',
      b.publico.automatico === true && b.publico.total === 4 && b.publico.ultimo?.de === '2026-10-31' && b.publico.ultimo.ate === '2026-11-01' && b.publico.ultimo.origem === 'manual' && b.publico.ultimo.novos === 8 && b.publico.ultimo.atendidos === 5 && b.publico.ultimo.qualificados === 3 && b.publico.ultimo.desqualificados === 1 && b.publicoSemTexto === true,
      JSON.stringify(b.publico),
    );

    /* ---- Toda segunda ---- */
    const sg = b.segunda;
    s.ok('antes das 7h de segunda, no sábado e no domingo, nada é gerado sozinho', sg.cedo === 0 && sg.sabado === 0 && sg.domingo === 0, JSON.stringify(sg));
    s.ok(
      'segunda às 7h30 gera um relatório só, para quem tem o agente ligado e teve movimento (não para quem já tem, desligou ou ficou parado)',
      sg.geradosNaSegunda.length === 1 && sg.geradosNaSegunda[0].w === 'w4' && sg.geradosNaSegunda[0].origem === 'automatico' && sg.geradosNaSegunda[0].de === '2026-10-31' && sg.geradosNaSegunda[0].ate === '2026-11-01' && sg.geradosNaSegunda[0].parcial === false && sg.w5Desligado === 0 && sg.w6SemMovimento === 0,
      JSON.stringify(sg),
    );
    s.ok('passando de novo no mesmo dia não gera outro', sg.denovo === 0 && sg.totalNovos === 1, JSON.stringify(sg));
    s.ok('o administrador é avisado no sino, com os números; o atendente não', sg.avisoAdmin === 1 && sg.avisoAtendente === 0 && /^1 lead novo, 0 atendidos, 0 qualificados e 0 desqualificados/.test(sg.textoDoAviso || ''), String(sg.textoDoAviso));
    s.ok('na quarta, o escritório que o servidor não pegou na segunda ganha o relatório do fim de semana', JSON.stringify(b.quarta) === JSON.stringify(['w7']), JSON.stringify(b.quarta));
    s.ok('o histórico guarda os 26 mais recentes e apaga os mais antigos', b.aparado === 26, String(b.aparado));
  } finally {
    iaFalsa.closeAllConnections?.();
    await new Promise((ok) => iaFalsa.close(ok));
    fs.rmSync(pasta, { recursive: true, force: true });
  }
  return s;
}

/**
 * As rotas do agente de relatorios, na base compartilhada: so dono e
 * administrador veem e geram; o periodo mal formado volta 400.
 */
export async function testarRotasDoAgenteDeRelatorios({ base }) {
  const s = suite('As rotas do agente de relatórios respeitam quem pode');
  const dono = cliente(base);
  await dono.entrar();
  const inicio = (await dono.get('/api/sessao/eu')).dados?.workspace?.id;

  const painel = await dono.get('/api/relatorios/agente');
  const d = painel.dados || {};
  const sabado = (dia) => new Date(`${dia}T12:00:00Z`).getUTCDay() === 6;
  s.ok('o dono vê o agente: ligado por padrão, oito fins de semana para escolher, o padrão é um sábado', painel.status === 200 && d.permitido === true && d.config?.automatico === true && d.opcoes?.length === 8 && sabado(d.padrao?.de), JSON.stringify(d).slice(0, 300));

  const config = await dono.put('/api/relatorios/agente/config', { automatico: false, instrucoes: 'Seja breve.' });
  s.ok('muda a configuração e ela fica', config.status === 200 && config.dados?.automatico === false && (await dono.get('/api/relatorios/agente')).dados?.config?.instrucoes === 'Seja breve.', JSON.stringify(config.dados));
  await dono.put('/api/relatorios/agente/config', { automatico: true, instrucoes: '' });

  const gerado = await dono.post('/api/relatorios/agente/gerar', {});
  const r = gerado.dados || {};
  s.ok('gera o relatório do último fim de semana, com as contas e um texto', gerado.status === 200 && r.periodo?.de === d.padrao.de && r.periodo?.ate === d.padrao.ate && typeof r.texto === 'string' && r.texto.length > 40 && r.estatisticas?.leads && r.origem === 'manual' && r.geradoPor?.tipo === 'membro', JSON.stringify(r).slice(0, 300));

  const lido = await dono.get(`/api/relatorios/agente/${r.id}`);
  s.ok('abre o relatório pelo id', lido.status === 200 && lido.dados?.id === r.id);
  const lista = (await dono.get('/api/relatorios/agente')).dados;
  s.ok('o histórico traz o resumo, sem as contas inteiras, e o último inteiro em "atual"', lista.historico?.some((x) => x.id === r.id && x.novos !== undefined && x.estatisticas === undefined) && lista.atual?.id && lista.atual.estatisticas, JSON.stringify(lista.historico?.[0]));

  s.ok('período que não começou, invertido ou longo demais volta 400', (await dono.post('/api/relatorios/agente/gerar', { de: '2099-01-01', ate: '2099-01-02' })).status === 400 && (await dono.post('/api/relatorios/agente/gerar', { de: '2026-03-02', ate: '2026-03-01' })).status === 400 && (await dono.post('/api/relatorios/agente/gerar', { de: '2026-01-01', ate: '2026-12-31' })).status === 400 && (await dono.post('/api/relatorios/agente/gerar', { de: 'ontem' })).status === 400);
  s.ok('relatório que não existe volta 404', (await dono.get('/api/relatorios/agente/nao-existe')).status === 404);

  /* Quem tem visao limitada nao ve nem gera. */
  const email = 'atendente-relatorio@correia.adv.br';
  await dono.post('/api/membros', { email, nome: 'Atendente do Relatório', senha: 'senha-de-teste-123', papel: 'atendente' });
  const atendente = cliente(base);
  await atendente.entrar(email, 'senha-de-teste-123');
  const visao = await atendente.get('/api/relatorios/agente');
  s.ok('o atendente recebe permitido:false (a tela não mostra o cartão), sem as contas', visao.status === 200 && visao.dados?.permitido === false && visao.dados?.atual === undefined, JSON.stringify(visao.dados));
  s.ok('e não gera, não abre, não muda a configuração e não apaga', (await atendente.post('/api/relatorios/agente/gerar', {})).status === 403 && (await atendente.get(`/api/relatorios/agente/${r.id}`)).status === 403 && (await atendente.put('/api/relatorios/agente/config', { automatico: false })).status === 403 && (await atendente.delete(`/api/relatorios/agente/${r.id}`)).status === 403);

  const apagou = await dono.delete(`/api/relatorios/agente/${r.id}`);
  s.ok('o dono apaga o relatório', apagou.status === 200 && (await dono.get(`/api/relatorios/agente/${r.id}`)).status === 404);

  for (const m of (await dono.get('/api/membros')).dados || []) {
    if (m.usuario?.email === email) await dono.delete(`/api/membros/${m.id}`);
  }
  if (inicio) await dono.post('/api/sessao/workspace', { workspaceId: inicio });
  return s;
}
