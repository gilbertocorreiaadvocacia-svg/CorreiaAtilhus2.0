import { FUSO, partesEm } from '../automacao/horario.js';
import { inserir, listar } from './banco.js';
import { novoId } from './util.js';

/**
 * Quanto tempo uma conversa esperou pela resposta — a base do grafico "Tempo
 * de resposta" do Dashboard. Pedido do escritorio em 20/10/2026.
 *
 * Nao da para calcular isso relendo as mensagens de cada contato na hora: elas
 * ficam um arquivo por contato no disco (nucleo/banco.js), carregado sob
 * demanda, e reabrir arquivo por arquivo a cada atualizacao do Dashboard e
 * exatamente o padrao de leitura que o proprio banco.js avisa para evitar. Por
 * isso, diferente do costume de nao acrescentar escrita nova: aqui um registro
 * pequeno, por resposta, no momento em que ela sai, e mais barato do que
 * reconstruir o historico depois.
 */
export function registrarTempoResposta(workspaceId, contatoId, esperaMs, agenteId = null) {
  if (!Number.isFinite(esperaMs) || esperaMs <= 0) return null;
  return inserir('temposResposta', {
    id: novoId('tpr'),
    workspaceId,
    contatoId,
    agenteId,
    esperaMs: Math.round(esperaMs),
  });
}

/** Mesma logica de chaveamento por periodo de nucleo/creditos.js — ver o
    comentario la sobre por que fica duplicada em vez de virar um helper so. */
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

function mediana(valores) {
  if (!valores.length) return 0;
  const ordenados = [...valores].sort((a, b) => a - b);
  const meio = Math.floor(ordenados.length / 2);
  return ordenados.length % 2 ? ordenados[meio] : (ordenados[meio - 1] + ordenados[meio]) / 2;
}

/**
 * Evolucao do tempo de resposta no periodo, em minutos. Mediana, e nao media:
 * a distribuicao e bimodal (resposta de IA rapida contra buraco noturno ou
 * troca para humano), e a media seria puxada pelos poucos casos extremos,
 * escondendo o tempo que representa o dia a dia normal.
 */
export function evolucaoDoTempoResposta(workspaceId, { de = null, ate = null, agrupamento = 'diario', contatosPermitidos = null } = {}) {
  let registros = listar('temposResposta', { workspaceId });
  if (de) registros = registros.filter((r) => r.criadoEm >= de);
  if (ate) registros = registros.filter((r) => r.criadoEm <= ate);
  if (contatosPermitidos) {
    registros = registros.filter((r) => !r.contatoId || contatosPermitidos.has(r.contatoId));
  }

  const porPeriodo = new Map();
  for (const r of registros) {
    const periodo = chaveDoPeriodo(r.criadoEm, agrupamento);
    if (!porPeriodo.has(periodo)) porPeriodo.set(periodo, []);
    porPeriodo.get(periodo).push(r.esperaMs / 60000);
  }

  const periodos = [...porPeriodo.keys()].sort();
  const serie = periodos.map((periodo) => {
    const minutos = porPeriodo.get(periodo);
    return {
      periodo,
      medianaMin: Number(mediana(minutos).toFixed(1)),
      mediaMin: Number((minutos.reduce((a, b) => a + b, 0) / minutos.length).toFixed(1)),
      amostras: minutos.length,
    };
  });

  return { serie, amostraTotal: registros.length };
}
