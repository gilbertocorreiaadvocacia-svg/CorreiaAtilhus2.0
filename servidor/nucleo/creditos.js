import { CUSTO } from '../config.js';
import { inserir, listar } from './banco.js';
import { novoId } from './util.js';

/**
 * Registro de consumo. Aqui o credito nao e cobranca, e a unidade que permite
 * enxergar quanto cada conversa custou de processamento e onde o funil esta
 * gastando demais, como no painel de consumo descrito na auditoria.
 */
export function lancar(workspaceId, contatoId, acao, quantidade, detalhe = null) {
  if (!quantidade) return null;
  return inserir('creditos', {
    id: novoId('crd'),
    workspaceId,
    contatoId,
    acao,
    quantidade: Number(quantidade.toFixed ? quantidade.toFixed(2) : quantidade),
    detalhe,
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
