import { achar, atualizar, listar, mensagensDe, registrarLog } from '../nucleo/banco.js';
import { emitir } from '../nucleo/eventos.js';
import { agora } from '../nucleo/util.js';
import { agendarResposta, cancelarResposta, forcarResposta } from '../ia/motor.js';
import { notificar } from '../ia/mencoes.js';
import { modeloDe, provedorDisponivel } from '../ia/provedores.js';

/**
 * A avaliacao do atendimento, pedida quando uma pessoa da equipe conclui a
 * conversa (pedido de 16/09).
 *
 * Quem pede e o agente com o objetivo "avaliar" do escritorio
 * (ia/pacotes/avaliacao.js). A conversa passa para ele e CONTINUA concluida:
 * sai da fila de quem atendeu e, se o cliente responder, reabre com o agente,
 * como qualquer conversa concluida (whatsapp/recebimento.js). O agente pergunta
 * a nota, convida TODO MUNDO para o Google e encerra com @concluiravaliacao,
 * que grava a nota e devolve a conversa a quem atendia.
 *
 * Todo mundo, e nao so quem gostou: o Google proibe pedir avaliacao so a
 * cliente satisfeito, e apaga as avaliacoes quando descobre. E o Google nao
 * aceita avaliacao publicada por terceiros: o sistema manda o link, e quem
 * escreve e o cliente, com a conta dele.
 *
 * Quando NAO pede:
 *   - sem agente de avaliacao ligado, ou sem chave de IA: o roteiro fixo nao
 *     conduz uma pesquisa;
 *   - conversa sem mensagem do cliente nos ultimos 7 dias: concluir conversa
 *     antiga, para arrumar a fila, nao pode virar mensagem para ninguem;
 *   - avaliacao ja pedida a esta conversa nos ultimos 90 dias;
 *   - "Concluir" em massa, que nao chama daqui (rotas/atendimento.js).
 */

const DIA = 24 * 60 * 60 * 1000;
const RECENTE = 7 * DIA;
const INTERVALO_ENTRE_PEDIDOS = 90 * DIA;
/* Sem resposta nesse tempo, a avaliacao se encerra e a conversa volta a quem atendia. */
const ESPERA = Number(process.env.CORREIA_AVALIACAO_ESPERA) || 2 * DIA;
const INTERVALO_DA_CONFERENCIA = Number(process.env.CORREIA_AVALIACAO_INTERVALO) || 10 * 60 * 1000;

export const OBJETIVO_AVALIACAO = 'avaliar';

export function agenteDeAvaliacao(workspaceId) {
  return listar('agentes', { workspaceId }).find((a) => a.objetivo === OBJETIVO_AVALIACAO && a.ativo) || null;
}

function porQueNaoPedir(contato, agente) {
  if (!agente) return 'sem agente de avaliacao ligado';
  if (!provedorDisponivel(agente.modelo, contato.workspaceId) || modeloDe(agente.modelo).provedor === 'regras') {
    return 'sem chave de IA';
  }
  if (contato.avaliacao?.situacao === 'pedida') return 'avaliacao em andamento';
  if (contato.responsavel?.tipo === 'agente' && contato.responsavel.id === agente.id) return 'o agente de avaliacao ja esta na conversa';
  const pedidaEm = Date.parse(contato.avaliacao?.pedidaEm || '');
  if (pedidaEm && Date.now() - pedidaEm < INTERVALO_ENTRE_PEDIDOS) return 'avaliacao pedida ha menos de 90 dias';
  if (!achar('conexoes', contato.conexaoId)) return 'conversa sem numero';

  const ultimaDoCliente = mensagensDe(contato.id)
    .filter((m) => m.direcao === 'entrada' && !m.nota)
    .reduce((maior, m) => Math.max(maior, Date.parse(m.criadoEm || '') || 0), 0);
  if (!ultimaDoCliente || Date.now() - ultimaDoCliente > RECENTE) return 'sem mensagem do cliente nos ultimos 7 dias';
  return null;
}

/** Chamado ao concluir UMA conversa. Devolve se pediu e, se nao, por que. */
export function pedirAvaliacao(contatoId, quem = { tipo: 'sistema', nome: 'Sistema' }) {
  const contato = achar('contatos', contatoId);
  if (!contato) return { pedida: false, motivo: 'conversa nao encontrada' };
  const agente = agenteDeAvaliacao(contato.workspaceId);
  const motivo = porQueNaoPedir(contato, agente);
  if (motivo) return { pedida: false, motivo };

  atualizar('contatos', contato.id, {
    avaliacao: { situacao: 'pedida', pedidaEm: agora(), agenteId: agente.id, responsavelAntes: contato.responsavel || null },
    responsavel: { tipo: 'agente', id: agente.id, nome: agente.nome },
  });
  registrarLog(contato.workspaceId, contato.id, 'avaliacao', `Avaliacao do atendimento pedida por ${agente.nome}`, quem);
  emitir(contato.workspaceId, 'contato', { contatoId: contato.id });

  /* O agente fala na hora, sem esperar o cliente: a conclusao e o gatilho. */
  forcarResposta(contato.id).catch((erro) => {
    registrarLog(contato.workspaceId, contato.id, 'erro_ia', `A avaliacao nao saiu: ${erro.message}`);
    encerrarAvaliacao(contato.id, { situacao: 'erro' });
  });
  return { pedida: true, agente: { id: agente.id, nome: agente.nome } };
}

const FRASES = {
  respondida: (nota) => `Atendimento avaliado com nota ${nota}`,
  sem_nota: () => 'Avaliacao encerrada sem nota',
  sem_resposta: () => 'Avaliacao encerrada: o cliente nao respondeu',
  interrompida: () => 'Avaliacao interrompida: a conversa foi reaberta',
  erro: () => 'A avaliacao nao foi enviada',
};

/**
 * Encerra a avaliacao em andamento e devolve a conversa a quem atendia.
 * `reabrir` e o cliente esperando resposta (assunto novo, ou mensagem que
 * ficou sem avaliacao): a conversa volta para a fila em vez de concluida.
 */
export function encerrarAvaliacao(contatoId, { situacao, nota = null, comentario = '', reabrir = false } = {}) {
  const contato = achar('contatos', contatoId);
  const pedido = contato?.avaliacao;
  if (!contato || pedido?.situacao !== 'pedida') return { erro: 'Nao ha avaliacao em andamento nesta conversa.' };

  const mudancas = {
    avaliacao: {
      ...pedido,
      situacao,
      nota: nota || null,
      comentario: String(comentario || '').trim().slice(0, 1000) || null,
      encerradaEm: agora(),
    },
  };

  /* Se alguem ja pegou a conversa no meio, ela fica com essa pessoa. */
  const comOAgente = contato.responsavel?.tipo === 'agente' && contato.responsavel.id === pedido.agenteId;
  if (comOAgente) {
    const antes = pedido.responsavelAntes;
    const aindaExiste = antes && (antes.tipo === 'membro' ? achar('membros', antes.id) : achar('agentes', antes.id));
    mudancas.responsavel = aindaExiste ? antes : null;
    mudancas.estado = reabrir ? (mudancas.responsavel?.tipo === 'agente' ? 'ia' : 'pendente') : 'arquivado';
  }

  atualizar('contatos', contato.id, mudancas);
  registrarLog(contato.workspaceId, contato.id, 'avaliacao', (FRASES[situacao] || FRASES.sem_nota)(nota), {
    tipo: 'sistema',
    nome: 'Avaliacao',
  });

  if (nota && nota <= 3) avisarNotaBaixa(contato, pedido.responsavelAntes, nota, mudancas.avaliacao.comentario);
  if (mudancas.estado === 'ia') agendarResposta(achar('contatos', contato.id));
  emitir(contato.workspaceId, 'contato', { contatoId: contato.id });
  return { ok: true, nota: nota || null };
}

/* Nota de 1 a 3 avisa quem atendeu; sem ninguem, os administradores. */
function avisarNotaBaixa(contato, atendeu, nota, comentario) {
  const destinos =
    atendeu?.tipo === 'membro' && achar('membros', atendeu.id)
      ? [atendeu.id]
      : listar('membros', { workspaceId: contato.workspaceId, papel: 'administrador' }).map((m) => m.id);
  for (const membroId of destinos) {
    notificar(
      contato.workspaceId,
      membroId,
      'avaliacao',
      `${contato.nome} deu nota ${nota} ao atendimento`,
      comentario ? `"${comentario}"` : 'Sem comentario. Vale conversar com o cliente.',
      contato.id,
    );
  }
}

/** Alguem reabriu a conversa no meio da avaliacao: ela para, e a conversa volta a quem atendia. */
export function interromperAvaliacao(contatoId) {
  if (achar('contatos', contatoId)?.avaliacao?.situacao !== 'pedida') return null;
  cancelarResposta(contatoId);
  return encerrarAvaliacao(contatoId, { situacao: 'interrompida', reabrir: true });
}

export function encerrarAvaliacoesParadas(agoraEm = Date.now()) {
  let encerradas = 0;
  for (const contato of listar('contatos')) {
    const pedido = contato.avaliacao;
    if (pedido?.situacao !== 'pedida') continue;
    if (agoraEm - (Date.parse(pedido.pedidaEm || '') || 0) < ESPERA) continue;
    /* Estado "ia" e o cliente que respondeu e ficou sem o agente encerrar. */
    encerrarAvaliacao(contato.id, { situacao: 'sem_resposta', reabrir: contato.estado === 'ia' });
    encerradas += 1;
  }
  return encerradas;
}

let laco = null;

export function iniciarAvaliacoes() {
  if (laco) return;
  laco = setInterval(() => {
    try {
      encerrarAvaliacoesParadas();
    } catch (erro) {
      console.error('[avaliacao]', erro.message);
    }
  }, INTERVALO_DA_CONFERENCIA);
  if (typeof laco.unref === 'function') laco.unref();
}
