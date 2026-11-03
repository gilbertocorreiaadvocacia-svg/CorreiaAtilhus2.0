import { atualizar, inserir, listar } from './banco.js';
import { agora, normalizar, novoId } from './util.js';

/**
 * A sequencia do status "Follow up" (pedidos do escritorio, 03/11/2026).
 *
 * Primeiro pedido: "quando eu coloco em Follow up, deveria ficar mandando os
 * follow-ups". O status nasce sem nenhum passo (nucleo/seed.js: "Retomar depois:
 * aguardando um retorno combinado"), e o escritorio o usa para empurrar conversas de
 * volta ao contato: sem passos, nada saia. Foi instalada a cadencia dos outros
 * status (versao 1: fu1 em 1 h, fu2 em 24 h e fu3 em 72 h, sem desistir).
 *
 * Segundo pedido, no mesmo dia, com a cadencia e os textos que o escritorio quer
 * (versao 2):
 *   - a primeira mensagem 30 minutos depois de a conversa entrar no status;
 *   - a segunda, 2 dias depois da primeira;
 *   - a terceira, 3 dias depois da segunda;
 *   - a quarta, 5 dias depois da terceira;
 *   - e, se NINGUEM respondeu em momento nenhum, manda a quinta mensagem (o aviso de
 *     que vai encerrar o acompanhamento) e desqualifica.
 *
 * Os cinco textos sao os que o escritorio escreveu, na ordem, e entram como templates
 * proprios (followup1 a followup5), sem tocar em fu1, fu2 e fu3 — que os outros status
 * continuam usando.
 *
 * O motor conta cada passo a partir da ENTRADA no status (ou da ultima resposta do
 * lead), nao do passo anterior (automacao/followup.js), entao os intervalos viram
 * tempos acumulados: 30 min, 2 dias e 30 min, 5 dias e 30 min e 10 dias e 30 min.
 *
 * A quinta mensagem e a desqualificacao NAO saem na hora em que a quarta sai: esperam
 * um dia para o lead poder responder a ela (esperaMinutos no ultimo passo). Passado
 * esse dia, so se o cliente nao respondeu a sequencia inteira, o aviso de encerramento
 * sai e o lead e desqualificado — status Desqualificado do escritorio, conversa concluida
 * e sem responsavel, como a desistencia dos outros status. Escritorio sem o status
 * Desqualificado recebe as quatro mensagens e nenhuma desistencia.
 *
 * Vale so para quem ENTRA no status daqui em diante: as conversas que ja estao la nao
 * recebem nada de uma vez (mandar para todas, num WhatsApp comum, derruba o numero).
 *
 * Uma vez por escritorio e por versao (workspace.followUpPadraoVersao). Troca o que
 * esta la so se for exatamente o que esta propria arrumacao instalou (a versao 1) —
 * nunca o que a equipe configurou ou esvaziou de proposito.
 */
export const VERSAO_DA_SEQUENCIA = 2;

/* Os textos do escritorio, na ordem. [nome] do pedido e {{nome}} no sistema. */
export const TEXTOS_DO_FOLLOW_UP = [
  { atalho: 'followup1', nome: 'Follow up 1 - retomada', conteudo: 'Conseguiu pensar melhor? Podemos seguir com seu atendimento?' },
  { atalho: 'followup2', nome: 'Follow up 2 - disponibilidade', conteudo: 'Olá! Estamos à disposição para te ajudar. Vamos dar continuidade?' },
  { atalho: 'followup3', nome: 'Follow up 3 - valores', conteudo: 'Oi! Ficou alguma dúvida sobre os valores que você pode ter direito a receber? 💰' },
  { atalho: 'followup4', nome: 'Follow up 4 - pergunta rápida', conteudo: 'Oi! Posso te fazer uma pergunta rápida sobre seu atendimento?' },
  {
    atalho: 'followup5',
    nome: 'Follow up 5 - encerramento',
    conteudo: 'Oi, {{nome}}! Como não consegui seu retorno, vou encerrar nosso acompanhamento por enquanto. Quando precisar, estaremos à disposição! 😊',
  },
];

const UM_DIA = 24 * 60;
/* Intervalos entre uma mensagem e a seguinte: a primeira depois de 30 minutos. */
export const INTERVALOS_EM_MINUTOS = [30, 2 * UM_DIA, 3 * UM_DIA, 5 * UM_DIA];
export const ESPERA_ANTES_DE_DESQUALIFICAR_EM_MINUTOS = UM_DIA;

/** Os minutos de cada passo, contados desde a entrada no status. */
export const MINUTOS_ACUMULADOS = INTERVALOS_EM_MINUTOS.reduce((acc, intervalo) => [...acc, (acc.at(-1) || 0) + intervalo], []);

/* O que a versao 1 instalou: so isso, sem mexer, pode ser trocado. */
function ehAVersao1(passos, templates) {
  const esperado = [
    ['fu1', 60],
    ['fu2', 60 * 24],
    ['fu3', 60 * 24 * 3],
  ];
  if (passos.length !== esperado.length) return false;
  return passos.every((passo, i) => {
    const template = templates.find((t) => t.id === passo.templateId);
    return template && normalizar(template.atalho) === esperado[i][0] && Number(passo.minutos) === esperado[i][1] && !passo.desistir;
  });
}

/** Garante os cinco templates do escritorio; o que ja existe com o mesmo atalho fica como esta. */
function garantirOsTextos(workspaceId) {
  const existentes = listar('templates', { workspaceId });
  return TEXTOS_DO_FOLLOW_UP.map((texto) => {
    const feito = existentes.find((t) => normalizar(t.atalho) === texto.atalho);
    if (feito) return feito;
    return inserir('templates', {
      id: novoId('tpl'),
      workspaceId,
      nome: texto.nome,
      atalho: texto.atalho,
      conteudo: texto.conteudo,
      midia: null,
      categoriaMeta: 'utilidade',
      aprovacaoMeta: { solicitada: false, situacao: 'nao_solicitada' },
    });
  });
}

export function garantirSequenciaNoStatusFollowUp() {
  const relato = { instalados: 0, atualizados: 0, jaTinham: 0, semDesqualificado: 0 };
  for (const workspace of listar('workspaces')) {
    const versao = workspace.followUpPadraoVersao || (workspace.followUpPadraoEm ? 1 : 0);
    if (versao >= VERSAO_DA_SEQUENCIA) continue;

    const todosOsStatus = listar('status', { workspaceId: workspace.id });
    const status = todosOsStatus.find((s) => normalizar(s.nome).replace(/[-_\s]+/g, ' ') === 'follow up');
    if (!status) continue;

    const atuais = status.followups || [];
    /* Sem passos: instala so se nunca houve esta arrumacao (senao a equipe tirou de proposito).
       Com passos: troca so o que a propria versao 1 instalou. */
    const podeTrocar = versao === 0 ? atuais.length === 0 : ehAVersao1(atuais, listar('templates', { workspaceId: workspace.id }));
    if (!podeTrocar) {
      atualizar('workspaces', workspace.id, { followUpPadraoVersao: VERSAO_DA_SEQUENCIA, followUpPadraoEm: workspace.followUpPadraoEm || agora() });
      relato.jaTinham += 1;
      continue;
    }

    const textos = garantirOsTextos(workspace.id);
    const desqualificado =
      todosOsStatus.find((s) => s.tipo === 'desqualificado' && normalizar(s.nome) === 'desqualificado') ||
      todosOsStatus.find((s) => s.tipo === 'desqualificado');
    if (!desqualificado) relato.semDesqualificado += 1;

    const mensagens = textos.slice(0, MINUTOS_ACUMULADOS.length);
    const encerramento = textos[textos.length - 1];
    const passos = mensagens.map((template, i) => ({
      id: novoId('fup'),
      templateId: template.id,
      minutos: MINUTOS_ACUMULADOS[i],
      desistir:
        i === mensagens.length - 1 && desqualificado
          ? {
              ativo: true,
              statusId: desqualificado.id,
              responsavel: null,
              arquivar: true,
              esperaMinutos: ESPERA_ANTES_DE_DESQUALIFICAR_EM_MINUTOS,
              templateId: encerramento.id,
            }
          : null,
    }));
    atualizar('status', status.id, { followups: passos });
    atualizar('workspaces', workspace.id, { followUpPadraoVersao: VERSAO_DA_SEQUENCIA, followUpPadraoEm: workspace.followUpPadraoEm || agora() });
    if (versao === 0) relato.instalados += 1;
    else relato.atualizados += 1;
  }
  return relato;
}
