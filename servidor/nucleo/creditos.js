import { CUSTO } from '../config.js';
import { FUSO, partesEm } from '../automacao/horario.js';
import { inserir, listar } from './banco.js';
import { novoId } from './util.js';

/**
 * Registro de consumo. Aqui o credito nao e cobranca, e a unidade que permite
 * enxergar quanto cada conversa custou de processamento e onde o funil esta
 * gastando demais, como no painel de consumo descrito na auditoria.
 *
 * `agenteId` so vem preenchido quando quem gastou foi um agente de IA (a
 * maioria das chamadas); credito de outra origem (ex.: teste de conexao)
 * segue sem. E o que permite "Qualidade e custos dos agentes" separar o
 * gasto por agente sem reprocessar nada do que ja foi gravado antes dele
 * existir — credito antigo so nao entra na conta por agente.
 */
export function lancar(workspaceId, contatoId, acao, quantidade, detalhe = null, agenteId = null) {
  if (!quantidade) return null;
  return inserir('creditos', {
    id: novoId('crd'),
    workspaceId,
    contatoId,
    acao,
    quantidade: Number(quantidade.toFixed ? quantidade.toFixed(2) : quantidade),
    detalhe,
    agenteId,
  });
}

export function custoDaMencao(tipo) {
  switch (tipo) {
    case 'biblioteca':
      return CUSTO.mencaoBiblioteca;
    case 'gerarcontrato':
      return CUSTO.mencaoContrato;
    case 'calendario':
      return CUSTO.mencaoCalendario;
    case 'personalizado':
      return CUSTO.mencaoPersonalizada;
    default:
      return CUSTO.mencaoLeve;
  }
}

/**
 * Quanto ESTE lead consumiu no mes corrente — o numero que aparece ao vivo no
 * painel da conversa, conforme ele vai conversando. Pedido do escritorio em
 * 13/10/2026: diferente de consumoDoWorkspace, que varre o workspace inteiro
 * para o dashboard (uso esporadico, uma vez por abertura do painel), este sai
 * direto no painel de CADA conversa aberta, entao o filtro ja entra pelo
 * contatoId (listar() so compara igualdade — nucleo/banco.js) em vez de somar
 * o workspace inteiro e descartar o resto.
 */
export function creditosMesDoContato(contatoId, referencia = new Date()) {
  const inicioDoMes = new Date(referencia.getFullYear(), referencia.getMonth(), 1).toISOString();
  const total = listar('creditos', { contatoId })
    .filter((l) => l.criadoEm >= inicioDoMes)
    .reduce((soma, l) => soma + l.quantidade, 0);
  return Number(total.toFixed(2));
}

/**
 * O mesmo periodo de `creditosMesDoContato`, mas separado por agente —
 * pedido do escritorio em 19/10/2026: ver, em cada lead, quanto cada agente
 * que passou pela conversa gastou, nao so o total. Credito sem agenteId
 * (de antes de 19/10/2026, ou de uma acao sem agente) nao entra aqui, mas
 * continua contando no total de creditosMesDoContato.
 */
export function creditosPorAgenteDoContato(contatoId, referencia = new Date()) {
  const inicioDoMes = new Date(referencia.getFullYear(), referencia.getMonth(), 1).toISOString();
  const porAgente = new Map();
  for (const l of listar('creditos', { contatoId })) {
    if (!l.agenteId || l.criadoEm < inicioDoMes) continue;
    porAgente.set(l.agenteId, (porAgente.get(l.agenteId) || 0) + l.quantidade);
  }
  return [...porAgente.entries()]
    .map(([agenteId, custo]) => ({ agenteId, custo: Number(custo.toFixed(2)) }))
    .sort((a, b) => b.custo - a.custo);
}

/**
 * `contatosPermitidos` e um Set de ids de conversa. Quando vem preenchido, o
 * consumo so soma o que saiu das conversas que a pessoa pode abrir: a lista de
 * quem mais consumiu carrega o nome do cliente, e nome de cliente de
 * departamento alheio nao pode aparecer aqui.
 */
export function consumoDoWorkspace(workspaceId, { de = null, ate = null, contatosPermitidos = null } = {}) {
  let lancamentos = listar('creditos', { workspaceId });
  if (de) lancamentos = lancamentos.filter((l) => l.criadoEm >= de);
  if (ate) lancamentos = lancamentos.filter((l) => l.criadoEm <= ate);
  if (contatosPermitidos) {
    lancamentos = lancamentos.filter((l) => !l.contatoId || contatosPermitidos.has(l.contatoId));
  }

  const total = lancamentos.reduce((soma, l) => soma + l.quantidade, 0);
  const porAcao = {};
  const porContato = {};
  const porDia = {};

  for (const l of lancamentos) {
    porAcao[l.acao] = (porAcao[l.acao] || 0) + l.quantidade;
    if (l.contatoId) porContato[l.contatoId] = (porContato[l.contatoId] || 0) + l.quantidade;
    const dia = String(l.criadoEm).slice(0, 10);
    porDia[dia] = (porDia[dia] || 0) + l.quantidade;
  }

  const conversas = Object.keys(porContato).length;

  return {
    total: Number(total.toFixed(2)),
    conversas,
    mediaPorConversa: conversas ? Number((total / conversas).toFixed(1)) : 0,
    referenciaPorConversa: 70,
    porAcao,
    porDia,
    topContatos: Object.entries(porContato)
      .sort((a, b) => b[1] - a[1])
      .slice(0, 10)
      .map(([contatoId, quantidade]) => ({ contatoId, quantidade: Number(quantidade.toFixed(2)) })),
  };
}

/**
 * Custo, chamadas e duracao media por agente, num periodo — a base da tela
 * "Qualidade e custos dos agentes".
 *
 * "Chamada" e uma chamada de IA de verdade (acao 'processamento_ia'), uma
 * por volta do modelo; os demais tipos de credito (mencao, audio, leitura de
 * imagem...) entram so no custo total do agente, nao no numero de chamadas
 * nem na duracao media — nao tem duracao propria, e contar como chamada
 * infla o numero sem dizer quantas vezes o modelo foi de fato chamado.
 */
export function custoPorAgente(workspaceId, { de = null, ate = null, contatosPermitidos = null } = {}) {
  let lancamentos = listar('creditos', { workspaceId }).filter((l) => l.agenteId);
  if (de) lancamentos = lancamentos.filter((l) => l.criadoEm >= de);
  if (ate) lancamentos = lancamentos.filter((l) => l.criadoEm <= ate);
  if (contatosPermitidos) {
    lancamentos = lancamentos.filter((l) => !l.contatoId || contatosPermitidos.has(l.contatoId));
  }

  const porAgente = new Map();
  const de_ = (agenteId) => {
    if (!porAgente.has(agenteId)) {
      porAgente.set(agenteId, { agenteId, custo: 0, chamadas: 0, somaDuracaoMs: 0 });
    }
    return porAgente.get(agenteId);
  };

  for (const l of lancamentos) {
    const registro = de_(l.agenteId);
    registro.custo += l.quantidade;
    if (l.acao === 'processamento_ia') {
      registro.chamadas += 1;
      if (Number.isFinite(l.detalhe?.duracaoMs)) registro.somaDuracaoMs += l.detalhe.duracaoMs;
    }
  }

  return [...porAgente.values()].map((r) => ({
    agenteId: r.agenteId,
    custo: Number(r.custo.toFixed(2)),
    chamadas: r.chamadas,
    duracaoMediaMs: r.chamadas ? Math.round(r.somaDuracaoMs / r.chamadas) : null,
  }));
}

/**
 * Chave do agrupamento temporal, no fuso do escritorio. Mesma logica de
 * painel.js (rota /api/dashboard): duplicada aqui de proposito, em vez de
 * virar um helper compartilhado — mexer na rota de maior trafego do sistema
 * so para emprestar 12 linhas de bucketing para uma tela nova e um risco
 * maior do que vale a pena.
 */
function chaveDoPeriodo(iso, agrupamento) {
  const data = new Date(iso);
  const p = partesEm(data, FUSO);
  const mes = String(p.mes).padStart(2, '0');
  if (agrupamento === 'mensal') return `${p.ano}-${mes}`;
  if (agrupamento === 'trimestral') return `${p.ano}-T${Math.floor((p.mes - 1) / 3) + 1}`;
  if (agrupamento === 'semanal') {
    const domingo = partesEm(new Date(data.getTime() - p.diaSemana * 86400000), FUSO);
    return `${domingo.ano}-${String(domingo.mes).padStart(2, '0')}-${String(domingo.dia).padStart(2, '0')}`;
  }
  return `${p.ano}-${mes}-${String(p.dia).padStart(2, '0')}`;
}

/**
 * Evolucao do custo por agente no tempo — a base do grafico "Desempenho dos
 * agentes de IA" do Dashboard. Pedido do escritorio em 20/10/2026: nao so o
 * total do periodo (ja respondido por custoPorAgente), e sim como cada
 * agente andou ao longo dele.
 *
 * `serieCustos` tem uma linha por periodo, com uma chave por agente que teve
 * algum gasto EM ALGUM periodo da janela — agente sem gasto num periodo
 * especifico entra com 0 nesse periodo, nao fica faltando.
 */
export function evolucaoDeCustoPorAgente(workspaceId, { de = null, ate = null, agrupamento = 'diario', contatosPermitidos = null } = {}) {
  let lancamentos = listar('creditos', { workspaceId }).filter((l) => l.agenteId);
  if (de) lancamentos = lancamentos.filter((l) => l.criadoEm >= de);
  if (ate) lancamentos = lancamentos.filter((l) => l.criadoEm <= ate);
  if (contatosPermitidos) {
    lancamentos = lancamentos.filter((l) => !l.contatoId || contatosPermitidos.has(l.contatoId));
  }

  const custoTotalPorAgente = new Map();
  const porPeriodo = new Map();
  for (const l of lancamentos) {
    custoTotalPorAgente.set(l.agenteId, (custoTotalPorAgente.get(l.agenteId) || 0) + l.quantidade);
    const periodo = chaveDoPeriodo(l.criadoEm, agrupamento);
    if (!porPeriodo.has(periodo)) porPeriodo.set(periodo, new Map());
    const doPeriodo = porPeriodo.get(periodo);
    doPeriodo.set(l.agenteId, (doPeriodo.get(l.agenteId) || 0) + l.quantidade);
  }

  const agentes = [...custoTotalPorAgente.entries()]
    .map(([agenteId, custoTotal]) => ({ agenteId, custoTotal: Number(custoTotal.toFixed(2)) }))
    .sort((a, b) => b.custoTotal - a.custoTotal);

  const periodos = [...porPeriodo.keys()].sort();
  const serieCustos = periodos.map((periodo) => {
    const doPeriodo = porPeriodo.get(periodo);
    const linha = { periodo };
    for (const agenteId of custoTotalPorAgente.keys()) {
      linha[agenteId] = Number((doPeriodo.get(agenteId) || 0).toFixed(2));
    }
    return linha;
  });

  return { periodos, agentes, serieCustos };
}
