import { listar } from './banco.js';

/**
 * Como o atendimento esta andando, em numeros, para /api/saude.
 *
 * Pedido do escritorio em 28/10/2026: "uma auditoria completa de cada modulo
 * ... o que faz impedir e dar continuidade ao atendimento". O diagnostico de
 * nucleo/diagnostico.js olha a CONFIGURACAO (chave, numero, template); este
 * olha o que esta acontecendo com as conversas: quem esta esperando resposta,
 * ha quanto tempo e em qual aba, conversa presa com agente desligado ou com
 * pessoa que saiu da equipe, e as falhas de envio, da IA e da conexao que o
 * sistema ja anota nos logs.
 *
 * A rota de saude e aberta: so contagens, datas e o motivo da falha com todo
 * numero comprido trocado por "#" (o erro do WhatsApp pode trazer o telefone
 * do cliente). Nenhum nome de cliente, de pessoa ou de agente.
 */

const MINUTO = 60 * 1000;
const FAIXAS = [
  ['ate15min', 15 * MINUTO],
  ['ate1h', 60 * MINUTO],
  ['ate4h', 4 * 60 * MINUTO],
  ['ate24h', 24 * 60 * MINUTO],
];

/* Mesma regra de abaDe (rotas/atendimento.js), sem os grupos, que ficam fora. */
function abaDe(contato) {
  if (contato.estado === 'arquivado') return 'concluidos';
  if (contato.responsavel?.tipo === 'agente') return 'ia';
  if (contato.aceitoPor) return 'ativos';
  return 'pendentes';
}

/* A ultima mensagem e do cliente, e ninguem respondeu depois dela (a mesma conta de whatsapp/envio.js). */
const esperandoResposta = (c) => Boolean(c.ultimaEntradaEm) && (!c.ultimaSaidaEm || c.ultimaSaidaEm < c.ultimaEntradaEm);

function faixaDe(ms) {
  for (const [nome, limite] of FAIXAS) if (ms <= limite) return nome;
  return 'maisDe24h';
}

const semNumeros = (texto) => String(texto || '').replace(/\d{6,}/g, '#').slice(0, 140);

/* Quantas vezes cada motivo apareceu, os mais frequentes primeiro. */
function motivos(logs, prefixo) {
  const contagem = new Map();
  for (const log of logs) {
    const motivo = semNumeros(String(log.descricao || '').replace(prefixo, '').trim()) || 'sem detalhe';
    const atual = contagem.get(motivo) || { motivo, vezes: 0, ultimaEm: null };
    atual.vezes += 1;
    if (!atual.ultimaEm || log.criadoEm > atual.ultimaEm) atual.ultimaEm = log.criadoEm;
    contagem.set(motivo, atual);
  }
  return [...contagem.values()].sort((a, b) => b.vezes - a.vezes).slice(0, 6);
}

const TIPOS_DE_FALHA = ['erro_envio', 'erro_ia', 'cadeia', 'passagem_prometida', 'conexao_desconectado', 'conexao_erro', 'conexao_recuperacao'];

export function saudeDoAtendimento(workspaceId, agora = Date.now()) {
  const contatos = listar('contatos', { workspaceId }).filter((c) => !c.grupo && !c.idCanal);
  const agentes = new Map(listar('agentes', { workspaceId }).map((a) => [a.id, a]));
  const membros = new Map(listar('membros', { workspaceId }).map((m) => [m.id, m]));

  const vazio = () => ({ total: 0, ate15min: 0, ate1h: 0, ate4h: 0, ate24h: 0, maisDe24h: 0, maisAntigaHaMin: 0 });
  const esperando = { ia: vazio(), ativos: vazio(), pendentes: vazio() };
  let naIaComAgenteDesligado = 0;
  let naIaComAgenteDesligadoEsperando = 0;
  let comPessoaForaDaEquipe = 0;
  let pendentesSemNinguem = 0;

  for (const contato of contatos) {
    const aba = abaDe(contato);
    if (aba === 'concluidos') continue;

    if (esperandoResposta(contato)) {
      const ms = Math.max(0, agora - Date.parse(contato.ultimaEntradaEm));
      const grupo = esperando[aba];
      grupo.total += 1;
      grupo[faixaDe(ms)] += 1;
      grupo.maisAntigaHaMin = Math.max(grupo.maisAntigaHaMin, Math.round(ms / MINUTO));
    }

    if (contato.responsavel?.tipo === 'agente') {
      const agente = agentes.get(contato.responsavel.id);
      if (!agente || !agente.ativo) {
        naIaComAgenteDesligado += 1;
        if (esperandoResposta(contato)) naIaComAgenteDesligadoEsperando += 1;
      }
    } else if (contato.responsavel?.tipo === 'membro') {
      const membro = membros.get(contato.responsavel.id);
      if (!membro || membro.ativo === false) comPessoaForaDaEquipe += 1;
    } else if (aba === 'pendentes') {
      pendentesSemNinguem += 1;
    }
  }

  const logs = listar('logs', { workspaceId }).filter((l) => TIPOS_DE_FALHA.includes(l.tipo));
  const desde = (ms) => new Date(agora - ms).toISOString();
  const umDia = desde(24 * 60 * MINUTO);
  const seteDias = desde(7 * 24 * 60 * MINUTO);
  const falhas = {};
  for (const tipo of TIPOS_DE_FALHA) {
    const doTipo = logs.filter((l) => l.tipo === tipo);
    falhas[tipo] = {
      em24h: doTipo.filter((l) => l.criadoEm >= umDia).length,
      em7dias: doTipo.filter((l) => l.criadoEm >= seteDias).length,
      ultimaEm: doTipo.length ? doTipo[doTipo.length - 1].criadoEm : null,
    };
  }
  const recentes = logs.filter((l) => l.criadoEm >= seteDias);

  const agendamentos = listar('agendamentos').filter((a) => contatos.some((c) => c.id === a.contatoId));
  const agendamentosAtrasados = agendamentos.filter((a) => a.estado === 'pendente' && a.quando && Date.parse(a.quando) < agora - 15 * MINUTO).length;
  const agendamentosComErro = agendamentos.filter((a) => a.estado === 'erro');

  const conexoes = listar('conexoes', { workspaceId })
    .filter((c) => c.tipo !== 'simulador')
    .map((conexao) => {
      const ultimaDoCliente = contatos
        .filter((c) => c.conexaoId === conexao.id && c.ultimaEntradaEm)
        .reduce((maior, c) => (c.ultimaEntradaEm > maior ? c.ultimaEntradaEm : maior), '');
      return { tipo: conexao.tipo, estado: conexao.estado || null, ultimaMensagemDeClienteEm: ultimaDoCliente || null };
    });

  return {
    esperandoResposta: esperando,
    naIaComAgenteDesligado,
    naIaComAgenteDesligadoEsperando,
    comPessoaForaDaEquipe,
    pendentesSemNinguem,
    falhas,
    motivosDeErroDeEnvio: motivos(recentes.filter((l) => l.tipo === 'erro_envio'), 'Falha ao enviar:'),
    motivosDeErroDaIa: motivos(recentes.filter((l) => l.tipo === 'erro_ia'), 'Falha do agente:'),
    agendamentos: {
      pendentes: agendamentos.filter((a) => a.estado === 'pendente').length,
      atrasados: agendamentosAtrasados,
      comErro: agendamentosComErro.length,
      motivosDeErro: motivos(agendamentosComErro.map((a) => ({ descricao: a.erro, criadoEm: a.atualizadoEm || a.criadoEm })), ''),
    },
    conexoes,
  };
}
