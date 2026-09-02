import { achar, atualizar, inserir, listar, registrarLog, removerOnde } from '../nucleo/banco.js';
import { emitir } from '../nucleo/eventos.js';
import { agora, aplicarVariaveis, novoId } from '../nucleo/util.js';
import { enviarMensagem } from '../whatsapp/envio.js';
import { horarioComercialDe, proximoHorarioValido } from './horario.js';

/**
 * O status e o gatilho de tudo. Trocou de status: cancela a sequencia antiga e
 * agenda a nova. Lead respondeu: reagenda o que ainda nao saiu, contando de
 * novo a partir da resposta. Chegou ao fim sem resposta: desiste do lead,
 * troca o status, tira o responsavel e arquiva.
 */

export function agendamentosPendentes(contatoId) {
  return listar('agendamentos', { contatoId, estado: 'pendente' });
}

export function cancelarFollowups(contatoId, motivo = 'status alterado') {
  const pendentes = agendamentosPendentes(contatoId).filter((a) => a.tipo === 'followup');
  for (const agendamento of pendentes) {
    atualizar('agendamentos', agendamento.id, { estado: 'cancelado', motivoCancelamento: motivo });
  }
  return pendentes.length;
}

/** Cria a sequencia do status, ja respeitando o horario comercial. */
export function agendarFollowupsDoStatus(contato, status) {
  const sequencia = status?.followups || [];
  if (!sequencia.length) return 0;

  const horario = horarioComercialDe(contato.workspaceId);
  const base = Date.now();
  let criados = 0;

  sequencia.forEach((passo, indice) => {
    const previsto = new Date(base + Number(passo.minutos || 0) * 60000);
    const quando = proximoHorarioValido(previsto, horario);
    inserir('agendamentos', {
      id: novoId('agd'),
      workspaceId: contato.workspaceId,
      contatoId: contato.id,
      conexaoId: contato.conexaoId,
      tipo: 'followup',
      passoId: passo.id,
      statusOrigemId: status.id,
      indice,
      templateId: passo.templateId,
      minutos: passo.minutos,
      desistir: passo.desistir || null,
      quando: quando.toISOString(),
      previstoPara: previsto.toISOString(),
      estado: 'pendente',
    });
    criados += 1;
  });

  return criados;
}

/**
 * Aplica um status a conversa. Puxa o departamento junto, inclusive limpando,
 * quando o status nao tem departamento, e dispara a sequencia de follow-up.
 */
export async function aplicarStatus(contato, status, autor, { dispararFollowups = true } = {}) {
  const anterior = contato.statusId ? achar('status', contato.statusId) : null;

  atualizar('contatos', contato.id, {
    statusId: status.id,
    departamentoId: status.departamentoId || null,
    statusAlteradoEm: agora(),
  });
  contato.statusId = status.id;
  contato.departamentoId = status.departamentoId || null;

  registrarLog(
    contato.workspaceId,
    contato.id,
    'status',
    `Status: ${anterior?.nome || 'sem status'} -> ${status.nome}`,
    autor,
    { statusId: status.id, tipo: status.tipo || 'nenhum', anteriorId: anterior?.id || null },
  );

  cancelarFollowups(contato.id, 'status alterado');
  if (dispararFollowups) agendarFollowupsDoStatus(contato, status);

  // Devolve o resultado para a Meta, para o anuncio otimizar por contrato
  // fechado e nao por conversa iniciada. Falha aqui nunca trava o atendimento.
  if (status.tipo && status.tipo !== 'nenhum') {
    import('../integracoes/meta-conversoes.js')
      .then(({ enviarConversao }) =>
        enviarConversao({ workspaceId: contato.workspaceId, contato, tipoStatus: status.tipo }),
      )
      .catch(() => {});
  }

  emitir(contato.workspaceId, 'contato', { contatoId: contato.id });
  return contato;
}

/**
 * Lead respondeu: cada follow-up que ainda nao saiu volta a contar a partir de
 * agora. O que ja foi enviado nao se repete.
 */
export function reagendarFollowups(contato) {
  const horario = horarioComercialDe(contato.workspaceId);
  const base = Date.now();
  let reagendados = 0;

  for (const agendamento of agendamentosPendentes(contato.id)) {
    if (agendamento.tipo !== 'followup') continue;
    const previsto = new Date(base + Number(agendamento.minutos || 0) * 60000);
    const quando = proximoHorarioValido(previsto, horario);
    atualizar('agendamentos', agendamento.id, {
      quando: quando.toISOString(),
      previstoPara: previsto.toISOString(),
      reagendadoEm: agora(),
    });
    reagendados += 1;
  }
  return reagendados;
}

/** Fim da sequencia sem resposta: desiste, troca o status e arquiva. */
async function desistirDoLead(contato, desistir) {
  const status = desistir.statusId ? achar('status', desistir.statusId) : null;

  if (status) {
    await aplicarStatus(contato, status, { tipo: 'sistema', nome: 'Follow-up' });
  }

  const mudancas = { estado: desistir.arquivar === false ? contato.estado : 'arquivado' };
  if (desistir.responsavel === null || desistir.responsavel === 'nenhum') {
    mudancas.responsavel = null;
  } else if (desistir.responsavel) {
    mudancas.responsavel = desistir.responsavel;
    mudancas.estado = desistir.responsavel.tipo === 'agente' ? 'ia' : mudancas.estado;
  }

  atualizar('contatos', contato.id, mudancas);
  registrarLog(contato.workspaceId, contato.id, 'desistencia', 'Lead marcado como desistencia ao fim da sequencia de follow-up');
  emitir(contato.workspaceId, 'contato', { contatoId: contato.id });
}

/** Envia um agendamento que venceu, follow-up ou mensagem marcada a mao. */
export async function dispararAgendamento(agendamento) {
  const contato = achar('contatos', agendamento.contatoId);
  if (!contato) {
    atualizar('agendamentos', agendamento.id, { estado: 'cancelado', motivoCancelamento: 'contato removido' });
    return;
  }

  const conexao = achar('conexoes', contato.conexaoId);
  let conteudo = agendamento.conteudo || '';
  let midia = agendamento.midia || null;

  if (agendamento.templateId) {
    const template = achar('templates', agendamento.templateId);
    if (!template) {
      atualizar('agendamentos', agendamento.id, { estado: 'cancelado', motivoCancelamento: 'template removido' });
      return;
    }
    conteudo = aplicarVariaveis(template.conteudo, { nome: contato.nome, ...(contato.variaveis || {}) });
    midia = template.midia || null;
  }

  await enviarMensagem({
    contato,
    conexao,
    tipo: midia ? midia.tipo : 'texto',
    conteudo,
    midia,
    templateId: agendamento.templateId || null,
    autor: { tipo: 'sistema', nome: agendamento.tipo === 'followup' ? 'Follow-up' : 'Mensagem agendada' },
    origemAutomacao: agendamento.tipo,
  });

  atualizar('agendamentos', agendamento.id, { estado: 'enviado', enviadoEm: agora() });

  if (agendamento.desistir?.ativo) {
    await desistirDoLead(contato, agendamento.desistir);
  }
}

let laco = null;

/** Laco unico do servidor: a cada tique, envia o que venceu. */
export function iniciarAgendador(intervalo) {
  if (laco) return;
  laco = setInterval(async () => {
    const limite = new Date().toISOString();
    const vencidos = listar('agendamentos', { estado: 'pendente' }).filter((a) => a.quando <= limite);
    for (const agendamento of vencidos) {
      try {
        await dispararAgendamento(agendamento);
      } catch (erro) {
        atualizar('agendamentos', agendamento.id, {
          estado: 'erro',
          erro: erro.message,
        });
      }
    }
  }, intervalo);
  if (typeof laco.unref === 'function') laco.unref();
}

export function pararAgendador() {
  if (laco) clearInterval(laco);
  laco = null;
}

/**
 * Saude do numero: muita mensagem concentrada no mesmo dia e o caminho mais
 * curto para bloqueio. Verde ate 40, amarelo ate 80, vermelho acima disso.
 */
export function saudeDoDia(quantidade) {
  if (quantidade <= 40) return 'saudavel';
  if (quantidade <= 80) return 'risco';
  return 'critico';
}

export function limparAgendamentosDoContato(contatoId) {
  return removerOnde('agendamentos', { contatoId });
}
