import { achar, atualizar, inserir, listar, registrarLog, removerOnde } from '../nucleo/banco.js';
import { emitir } from '../nucleo/eventos.js';
import { agora, aplicarVariaveis, novoId } from '../nucleo/util.js';
import { enviarMensagem } from '../whatsapp/envio.js';
import { FUSO, horarioComercialDe, proximoHorarioValido } from './horario.js';
import { contratoAbertoDe } from '../nucleo/contratos.js';
import { disparar } from '../nucleo/ganchos.js';

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
  /* A desistencia que ficou esperando depois da ultima mensagem faz parte da mesma
     sequencia: mudou o status, ela nao vale mais (um lead que a equipe moveu nao
     pode ser desqualificado por um relogio de antes). */
  if (achar('contatos', contatoId)?.desistenciaPrevista) atualizar('contatos', contatoId, { desistenciaPrevista: null });
  return pendentes.length;
}

/**
 * Espaco entre as primeiras mensagens quando varias conversas entram na
 * sequencia juntas. Mandar o lote todo no mesmo minuto e o que derruba o numero
 * (30 s e o minimo recomendado, ver /api/agendamentos/reagendar).
 */
export const ESPACO_ENTRE_INICIOS_EM_SEGUNDOS = 45;

/** Ha follow-up a sair, ou uma desqualificacao esperando depois da ultima mensagem? */
export function temFollowupEmAndamento(contato) {
  if (agendamentosPendentes(contato.id).some((a) => a.tipo === 'followup')) return true;
  return Boolean(achar('contatos', contato.id)?.desistenciaPrevista);
}

/**
 * Cria a sequencia do status, ja respeitando o horario comercial.
 *
 * `atrasoMs` empurra a sequencia inteira: e como um lote se espalha, cada conversa
 * comecando alguns segundos depois da anterior.
 */
export function agendarFollowupsDoStatus(contato, status, { atrasoMs = 0 } = {}) {
  const sequencia = status?.followups || [];
  if (!sequencia.length) return 0;

  const horario = horarioComercialDe(contato.workspaceId);
  const base = Date.now() + atrasoMs;
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
 * Comeca a sequencia do status em uma conversa que JA esta nele.
 *
 * A sequencia so nascia na TROCA de status. Conversa que ja estava em "Follow up"
 * quando a sequencia foi configurada (ou que entrou la antes) ficava para sempre
 * sem nada agendado: escolher o mesmo status de novo nao muda nada, e a aba "O que
 * ainda vai ser enviado" mostrava "Nada agendado" sem jeito de comecar. Aqui e uma
 * ordem explicita de uma pessoa, entao nao vale para a IA reafirmando o status
 * (isso reiniciaria o relogio a toda reafirmacao, ver aplicarStatus).
 *
 * Nao mexe em quem ja tem follow-up a sair: nao reinicia o relogio de ninguem.
 */
export function iniciarFollowupDoStatus(contato, status, { atrasoMs = 0, autor = null } = {}) {
  if (!(status?.followups || []).length) return { criados: 0, motivo: 'sem-passos' };
  if (temFollowupEmAndamento(contato)) return { criados: 0, motivo: 'em-andamento' };
  const criados = agendarFollowupsDoStatus(contato, status, { atrasoMs });
  if (criados) {
    registrarLog(
      contato.workspaceId,
      contato.id,
      'followup_iniciado',
      `Follow-up iniciado em ${status.nome}: ${criados} ${criados === 1 ? 'mensagem programada' : 'mensagens programadas'}`,
      autor,
    );
  }
  return { criados, motivo: criados ? null : 'sem-passos' };
}

/**
 * Aplica um status a conversa. Puxa o departamento junto, inclusive limpando,
 * quando o status nao tem departamento, e dispara a sequencia de follow-up.
 *
 * `reiniciar`: a pessoa escolheu este status de novo de proposito (acao em massa).
 * Se a conversa ja estava nele e nao tem follow-up a sair, a sequencia comeca.
 * `atrasoMs`: empurra a sequencia, para um lote sair espalhado.
 */
export async function aplicarStatus(contato, status, autor, { dispararFollowups = true, reiniciar = false, atrasoMs = 0 } = {}) {
  const anterior = contato.statusId ? achar('status', contato.statusId) : null;
  /* O momento e o passo DENTRO do status: o de uma etapa nao vale na outra. */
  const trocouDeStatus = anterior?.id !== status.id;

  atualizar('contatos', contato.id, {
    statusId: status.id,
    departamentoId: status.departamentoId || null,
    statusAlteradoEm: agora(),
    ...(trocouDeStatus ? { momento: null } : {}),
  });
  contato.statusId = status.id;
  contato.departamentoId = status.departamentoId || null;
  if (trocouDeStatus) contato.momento = null;

  registrarLog(
    contato.workspaceId,
    contato.id,
    'status',
    `Status: ${anterior?.nome || 'sem status'} -> ${status.nome}`,
    autor,
    { statusId: status.id, tipo: status.tipo || 'nenhum', anteriorId: anterior?.id || null },
  );

  /*
   * So reinicia a sequencia de follow-up numa troca de VERDADE.
   *
   * O agente de IA tem uma ferramenta para alterar status, e reafirma o
   * mesmo status mais de uma vez na mesma negociacao (o roteiro manda
   * confirmar "Qualificado" de novo depois de responder uma objecao, por
   * exemplo) — isso nao e uma transicao nova. Antes, cada reafirmacao
   * cancelava e recriava os tres passos do zero, e o relogio reiniciava
   * toda vez: o "faz tempo que paramos" acabava disparando de novo sempre
   * que a conversa ficava quieta depois de uma dessas reafirmacoes, nao so
   * na troca real de etapa. O escritorio pediu para o follow-up parar de
   * mandar mensagem toda hora, e essa recriacao escondida era a causa.
   */
  if (trocouDeStatus) {
    cancelarFollowups(contato.id, 'status alterado');
    if (dispararFollowups) agendarFollowupsDoStatus(contato, status, { atrasoMs });
  } else if (reiniciar && dispararFollowups) {
    iniciarFollowupDoStatus(contato, status, { atrasoMs, autor });
  }

  /*
   * Entrou numa coluna do tipo "Sucesso" (a que o escritorio chama de
   * "Contrato fechado", ou uma renomeada com o mesmo papel): manda para o
   * Atilhus Juri, em A validar. Pedido do escritorio em 06/11/2026 — ate
   * aqui so ia quem assinava um contrato pelo ZapSign DAQUI; a maioria das
   * conversas que chegam a esta coluna nunca passou por la (fechadas na
   * mao, importadas do historico antigo). integracoes/atilhus-juri.js
   * decide sozinho se ja existe um contrato assinado cuidando disto, e nao
   * manda duas vezes. So numa troca de verdade: reafirmar o mesmo status
   * nao reabre o caso no Juri, do mesmo jeito que nao reinicia o follow-up
   * acima. Sem await, igual a Meta e ao TikTok logo abaixo: o Juri pode
   * levar ate 30s para responder, e isso nao pode travar quem arrastou o
   * cartao no Kanban esperando a tela atualizar.
   */
  if (trocouDeStatus && status.tipo === 'sucesso' && !contato.grupo) {
    disparar('status_contrato_fechado', { workspaceId: contato.workspaceId, contatoId: contato.id }).catch(() => {});
  }

  // Devolve o resultado para a Meta, para o anuncio otimizar por contrato
  // fechado e nao por conversa iniciada. Falha aqui nunca trava o atendimento.
  if (status.tipo && status.tipo !== 'nenhum') {
    import('../integracoes/meta-conversoes.js')
      .then(({ enviarConversao }) =>
        enviarConversao({ workspaceId: contato.workspaceId, contato, tipoStatus: status.tipo }),
      )
      .catch(() => {});
    /* O mesmo para o TikTok, so com lead que veio de la. */
    import('../integracoes/tiktok-eventos.js')
      .then(({ enviarEventoTikTok }) =>
        enviarEventoTikTok({ workspaceId: contato.workspaceId, contato, tipoStatus: status.tipo }),
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

  const enviada = await enviarMensagem({
    contato,
    conexao,
    tipo: midia ? midia.tipo : 'texto',
    conteudo,
    midia,
    templateId: agendamento.templateId || null,
    autor: { tipo: 'sistema', nome: agendamento.tipo === 'followup' ? 'Follow-up' : 'Mensagem agendada' },
    origemAutomacao: agendamento.tipo,
  });

  /* enviarMensagem nao lanca: a falha volta na propria mensagem. Ate
     29/10/2026 o follow-up que falhava contava como enviado e, no ultimo
     passo, ainda desistia do lead e o arquivava — sem o cliente ter recebido
     nada (achado na auditoria de 28/10). */
  if (enviada?.situacao === 'erro') {
    atualizar('agendamentos', agendamento.id, { estado: 'erro', erro: enviada.erro?.mensagem || 'falha no envio' });
    return;
  }

  atualizar('agendamentos', agendamento.id, { estado: 'enviado', enviadoEm: agora() });

  if (agendamento.desistir?.ativo) {
    /* Quem esta com o contrato na mao nao desistiu: arquivar agora tiraria da
       fila justamente o cliente que esta a um toque de assinar. */
    if (contratoAbertoDe(contato.id)) {
      registrarLog(
        contato.workspaceId,
        contato.id,
        'desistencia_evitada',
        'Fim da sequencia de follow-up sem desistencia: ha contrato em andamento',
      );
    } else if (Number(agendamento.desistir.esperaMinutos) > 0 || agendamento.desistir.templateId) {
      /* Com espera, o lead tem tempo de responder a ULTIMA mensagem antes de ser
         desqualificado, e so e desqualificado se nao respondeu em momento nenhum da
         sequencia (processarDesistenciasPrevistas). */
      const previsto = new Date(Date.now() + (Number(agendamento.desistir.esperaMinutos) || 0) * 60000);
      /* Com mensagem de encerramento, ela respeita o horario comercial, como todo follow-up. */
      const em = (agendamento.desistir.templateId ? proximoHorarioValido(previsto, horarioComercialDe(contato.workspaceId)) : previsto).toISOString();
      atualizar('contatos', contato.id, {
        desistenciaPrevista: {
          em,
          desistir: agendamento.desistir,
          sequenciaIniciadaEm: agendamento.criadoEm,
          statusOrigemId: agendamento.statusOrigemId || null,
        },
      });
      registrarLog(
        contato.workspaceId,
        contato.id,
        'desistencia_agendada',
        'Ultima mensagem do follow-up enviada: se o cliente nao responder ate ' + new Date(em).toLocaleString('pt-BR', { timeZone: FUSO }) + ', ' + (agendamento.desistir.templateId ? 'o aviso de encerramento sai e ' : '') + 'o lead sera desqualificado',
      );
      emitir(contato.workspaceId, 'contato', { contatoId: contato.id });
    } else {
      await desistirDoLead(contato, agendamento.desistir);
    }
  }
}

/**
 * A desistencia que esperou depois da ultima mensagem chegou na hora.
 *
 * So desiste se NADA aconteceu no meio: o status continua o da sequencia, nao ha
 * contrato em andamento e o cliente nao escreveu em momento nenhum desde que a
 * sequencia comecou ("se nao tiver nenhuma resposta, desqualifica"). Qualquer
 * resposta, em qualquer ponto, livra o lead: ele passa a ser da equipe e da IA, e
 * um lead que respondeu nao e um lead que sumiu.
 */
const TENTATIVAS_DO_ENCERRAMENTO = 3;
const REPETICAO_DO_ENCERRAMENTO_MS = 2 * 60 * 60 * 1000;

export async function processarDesistenciasPrevistas(agoraMs = Date.now()) {
  const feitas = [];
  for (const contato of listar('contatos')) {
    const prevista = contato.desistenciaPrevista;
    if (!prevista || Date.parse(prevista.em) > agoraMs) continue;
    /* Limpa antes: se algo falhar, nao repete a cada tique. */
    atualizar('contatos', contato.id, { desistenciaPrevista: null });

    const evitar = (motivo) => registrarLog(contato.workspaceId, contato.id, 'desistencia_evitada', 'O lead nao foi desqualificado: ' + motivo);
    if (prevista.statusOrigemId && contato.statusId !== prevista.statusOrigemId) {
      evitar('o status da conversa mudou durante a espera');
      continue;
    }
    if (contratoAbertoDe(contato.id)) {
      evitar('ha contrato em andamento');
      continue;
    }
    if (contato.ultimaEntradaEm && prevista.sequenciaIniciadaEm && contato.ultimaEntradaEm > prevista.sequenciaIniciadaEm) {
      evitar('o cliente respondeu durante a sequencia');
      continue;
    }
    /* O aviso de encerramento sai ANTES de desqualificar, e so se ninguem respondeu. Se ele nao
       sair (conexao fora, por exemplo), o lead nao e desqualificado calado: tenta de novo em
       duas horas, ate TENTATIVAS_DO_ENCERRAMENTO vezes; depois disso desqualifica sem o aviso. */
    const aviso = prevista.desistir.templateId ? achar('templates', prevista.desistir.templateId) : null;
    if (aviso) {
      const enviada = await enviarMensagem({
        contato,
        conexao: achar('conexoes', contato.conexaoId),
        tipo: aviso.midia ? aviso.midia.tipo : 'texto',
        conteudo: aplicarVariaveis(aviso.conteudo, { nome: contato.nome, ...(contato.variaveis || {}) }),
        midia: aviso.midia || null,
        templateId: aviso.id,
        autor: { tipo: 'sistema', nome: 'Follow-up' },
        origemAutomacao: 'followup',
      });
      if (enviada?.situacao === 'erro') {
        const tentativas = (prevista.tentativas || 0) + 1;
        const motivo = enviada.erro?.mensagem || 'falha no envio';
        if (tentativas < TENTATIVAS_DO_ENCERRAMENTO) {
          atualizar('contatos', contato.id, { desistenciaPrevista: { ...prevista, tentativas, em: new Date(agoraMs + REPETICAO_DO_ENCERRAMENTO_MS).toISOString() } });
          registrarLog(contato.workspaceId, contato.id, 'desistencia_adiada', 'A mensagem de encerramento nao saiu (' + motivo + '): nova tentativa em duas horas');
          continue;
        }
        registrarLog(contato.workspaceId, contato.id, 'desistencia_sem_aviso', 'A mensagem de encerramento nao saiu depois de ' + tentativas + ' tentativas (' + motivo + '): o lead foi desqualificado sem ela');
      }
    }
    await desistirDoLead(contato, prevista.desistir);
    feitas.push(contato.id);
  }
  return feitas;
}

let laco = null;
let rodando = false;

/**
 * Laco unico do servidor: a cada tique, envia o que venceu.
 *
 * Um tique por vez. Ate 29/10/2026 o tique seguinte comecava com o anterior
 * ainda enviando (o envio de video leva ate 60 s, e o tique e de 15 s),
 * relistava o mesmo agendamento ainda 'pendente' e o mandava de novo: o
 * cliente recebia o mesmo follow-up duas ou tres vezes (auditoria de 28/10).
 */
export function iniciarAgendador(intervalo) {
  if (laco) return;
  laco = setInterval(async () => {
    if (rodando) return;
    rodando = true;
    try {
      const limite = new Date().toISOString();
      const vencidos = listar('agendamentos', { estado: 'pendente' }).filter((a) => a.quando <= limite);
      for (const agendamento of vencidos) {
        /* Cancelado ou reagendado enquanto o anterior da lista enviava. */
        const atual = achar('agendamentos', agendamento.id);
        if (atual?.estado !== 'pendente' || atual.quando > new Date().toISOString()) continue;
        try {
          await dispararAgendamento(atual);
        } catch (erro) {
          atualizar('agendamentos', agendamento.id, {
            estado: 'erro',
            erro: erro.message,
          });
        }
      }
      try {
        await processarDesistenciasPrevistas();
      } catch (erro) {
        console.error('[follow-up] desistencia prevista falhou:', erro.message);
      }
    } finally {
      rodando = false;
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
