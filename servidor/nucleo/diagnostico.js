import { listar, registrarLog } from './banco.js';
import { normalizar } from './util.js';
import { analisarPrompt, notificar } from '../ia/mencoes.js';
import { chavesDoWorkspace } from '../ia/provedores.js';

/**
 * Diagnostico embutido: o sistema conta o que esta quebrado nele mesmo.
 *
 * Em 29/09/2026 uma auditoria externa levou meia hora para descobrir que os
 * agentes nunca pensaram (faltava a chave da IA), que o numero entrava lead sem
 * status e que cinco agentes citavam atalhos inexistentes. O sistema sabia de
 * tudo isso e nao falou nada: cada defeito estava visivel em uma tela
 * diferente, e nenhum deles gritava.
 *
 * Este modulo junta as mesmas perguntas que o auditor fez e devolve a lista de
 * achados, com severidade e o lugar de corrigir. A tela de Saude mostra; o
 * aviso de modo degradado (abaixo) grita quando o pior deles acontece.
 */

const SEVERIDADES = { critica: 0, alta: 1, media: 2, baixa: 3 };

/** Tipos de status que existem justamente para tirar a conversa do funil. */
const TIPOS_DE_PERDA = ['desqualificado', 'recusada', 'desistencia'];

export function diagnosticar(workspaceId) {
  const achados = [];
  const anotar = (severidade, id, titulo, detalhe, onde) =>
    achados.push({ id, titulo, detalhe, severidade, onde });

  const chaves = chavesDoWorkspace(workspaceId);
  const conexoes = listar('conexoes', { workspaceId });
  const agentes = listar('agentes', { workspaceId });
  const status = listar('status', { workspaceId });
  const contatos = listar('contatos', { workspaceId });
  const membros = listar('membros', { workspaceId });
  const origens = listar('origens', { workspaceId });

  const ligados = agentes.filter((a) => a.ativo !== false);
  const reais = conexoes.filter((c) => c.tipo !== 'simulador');

  /* 1. O defeito que derruba tudo o mais: sem chave, o agente nao le o cliente. */
  if (!chaves.anthropic && ligados.length) {
    anotar(
      'critica',
      'ia-sem-chave',
      'Os agentes estao sem inteligencia artificial',
      `${ligados.length} agentes estao ligados, mas sem a chave em Integracoes eles repetem frases fixas do roteiro em vez de ler o que o cliente escreveu. Enquanto isso, mover no funil, etiquetar, transferir e enviar template nao acontecem.`,
      '#/integracoes',
    );
  }

  /* 2. Audio que chega e ignorado sem a chave de transcricao. */
  if (!chaves.openai) {
    anotar(
      'alta',
      'audio-sem-chave',
      'Audio do cliente nao e transcrito',
      'Sem a chave de transcricao em Integracoes, o audio que o cliente manda no WhatsApp chega e e ignorado pelo agente.',
      '#/integracoes',
    );
  }

  /* 3. A causa silenciosa da fila sem status: a conexao nasce sem padrao. */
  const semPadrao = reais.filter((c) => !c.statusPadraoId || !c.departamentoPadraoId);
  if (semPadrao.length) {
    anotar(
      'alta',
      'conexao-sem-padrao',
      'Numero sem status ou departamento padrao',
      `${semPadrao.map((c) => c.nome).join(', ')}: todo lead novo entra sem classificacao, o Kanban nao recebe cartao e o funil fica parado.`,
      '#/conexoes',
    );
  }

  /* 4. Numero fora do ar nao recebe nada. */
  const fora = reais.filter((c) => c.estado !== 'conectado');
  if (fora.length) {
    anotar(
      'alta',
      'conexao-fora',
      'Numero desconectado',
      `${fora.map((c) => c.nome).join(', ')} nao esta conectado. Mensagem que chegar agora pode nao entrar no sistema.`,
      '#/conexoes',
    );
  }

  /* 5. Mencao invalida: o agente manda o sistema fazer algo que nao existe. */
  const comInvalida = [];
  for (const agente of ligados) {
    const { invalidas } = analisarPrompt(agente.prompt || '', workspaceId);
    if (invalidas.length) comInvalida.push(`${agente.nome} (${invalidas.join(', ')})`);
  }
  if (comInvalida.length) {
    anotar(
      'alta',
      'mencao-invalida',
      'Agente cita atalho que nao existe',
      `${comInvalida.join('; ')}. A acao simplesmente nao acontece, e nada aparece na conversa explicando por que.`,
      '#/agentes',
    );
  }

  /* 6. Agente ligado que nenhum canal usa e ninguem chama: configuracao viva
        que nao atende ninguem. */
  const primarios = new Set(
    conexoes.map((c) => (c.responsavelPadrao?.tipo === 'agente' ? c.responsavelPadrao.id : null)).filter(Boolean),
  );
  /* O proprio prompt nao conta: agente que escreve o proprio nome nas
     instrucoes continua sem porta de entrada, e contar isso como "alguem o
     chama" esconderia exatamente o agente esquecido que se quer achar. */
  const orfaos = ligados.filter((a) => {
    if (primarios.has(a.id)) return false;
    const chamadoPorOutro = ligados.some(
      (outro) => outro.id !== a.id && normalizar(outro.prompt || '').includes(normalizar(a.nome)),
    );
    return !chamadoPorOutro;
  });
  if (orfaos.length) {
    anotar(
      'media',
      'agente-sem-canal',
      'Agente ligado que nao atende ninguem',
      `${orfaos.map((a) => a.nome).join(', ')}: nenhum numero o usa como responsavel e nenhum outro agente o chama. Ligue-o a um canal ou desligue-o.`,
      '#/agentes',
    );
  }

  /* 7. Sem follow-up, o lead que para de responder morre em silencio. */
  const comFollow = status.filter((s) => (s.followups || []).length);
  if (status.length && !comFollow.length) {
    anotar(
      'media',
      'sem-followup',
      'Nenhuma coluna tem follow-up',
      'Nao existe cadencia de retomada: quem parou de responder fica parado para sempre, sem ninguem cobrar.',
      '#/configuracoes/status',
    );
  }

  /* 8. Colunas com o mesmo nome fragmentam qualquer relatorio. */
  const porNome = new Map();
  for (const s of status) {
    const chave = normalizar(s.nome);
    porNome.set(chave, (porNome.get(chave) || 0) + 1);
  }
  const repetidos = [...porNome.entries()].filter(([, n]) => n > 1);
  if (repetidos.length) {
    anotar(
      'media',
      'status-repetido',
      'Colunas repetidas no funil',
      `${repetidos.map(([nome, n]) => `"${nome}" aparece ${n} vezes`).join('; ')}. Quem classificar divide o mesmo grupo, e o relatorio sai partido.`,
      '#/configuracoes/status',
    );
  }

  /* 9. Origem repetida impede saber o custo por canal. */
  const origensPorNome = new Map();
  for (const o of origens) {
    const chave = normalizar(o.nome);
    origensPorNome.set(chave, (origensPorNome.get(chave) || 0) + 1);
  }
  if ([...origensPorNome.values()].some((n) => n > 1)) {
    anotar('baixa', 'origem-repetida', 'Origens de trafego repetidas', 'Ha origens com o mesmo nome; o custo por lead por canal fica impossivel de apurar.', '#/configuracoes/classes');
  }

  /*
   * 10. A IA promete passar para uma pessoa. A pessoa existe?
   *
   * A primeira versao deste achado dizia que a transferencia "nao cai em
   * ninguem". Estava errado: sortearResponsavel (ia/mencoes.js) distribui
   * entre TODOS os membros ativos, inclusive administrador. Ou seja, cai —
   * cai sempre no dono do escritorio.
   *
   * O problema real nao e a conversa se perder, e o funil inteiro desaguar em
   * quem nao esta ali para atender. Vale dizer isso, e nao a outra coisa: um
   * diagnostico que exagera e um diagnostico em que ninguem confia da segunda
   * vez.
   */
  const atendentes = membros.filter((m) => m.papel !== 'administrador' && m.ativo !== false);
  const ativos = membros.filter((m) => m.ativo !== false);
  if (!atendentes.length && ativos.length) {
    anotar(
      'alta',
      'sem-atendente',
      'Toda transferencia cai no administrador',
      `O agente promete que "alguem do escritorio continua", e a conversa e distribuida entre ${ativos.length === 1 ? 'o unico membro ativo, que e administrador' : `os ${ativos.length} membros ativos, todos administradores`}. Nao ha fila de atendimento: o funil inteiro desagua em quem administra o sistema.`,
      '#/configuracoes/membros',
    );
  }
  if (!ativos.length) {
    anotar(
      'critica',
      'sem-membro',
      'Nao ha nenhum membro ativo',
      'A transferencia para uma pessoa nao tem em quem cair, e a conversa fica parada sem dono.',
      '#/configuracoes/membros',
    );
  }

  /* 11. Funil parado: a foto que resume o estrago. */
  const semStatus = contatos.filter((c) => !c.statusId).length;
  if (contatos.length >= 20 && semStatus / contatos.length > 0.5) {
    const porcento = Math.round((semStatus / contatos.length) * 100);
    anotar(
      'alta',
      'conversas-sem-status',
      'A maior parte das conversas esta sem status',
      `${semStatus} de ${contatos.length} conversas (${porcento}%) nao estao em nenhuma coluna. O funil inteiro esta parado.`,
      '#/kanban',
    );
  }

  /* 12. Status fora do funil sem dono. Perda tem dono nulo de proposito; o
        resto, nao. */
  const semDepartamento = status.filter((s) => !s.departamentoId && !TIPOS_DE_PERDA.includes(s.tipo));
  if (semDepartamento.length) {
    anotar(
      'baixa',
      'status-sem-departamento',
      'Coluna sem departamento',
      `${semDepartamento.map((s) => s.nome).join(', ')}: a conversa que cair nelas fica sem dono.`,
      '#/configuracoes/status',
    );
  }

  achados.sort((a, b) => SEVERIDADES[a.severidade] - SEVERIDADES[b.severidade]);
  return {
    verificadoEm: new Date().toISOString(),
    achados,
    resumo: {
      critica: achados.filter((a) => a.severidade === 'critica').length,
      alta: achados.filter((a) => a.severidade === 'alta').length,
      media: achados.filter((a) => a.severidade === 'media').length,
      baixa: achados.filter((a) => a.severidade === 'baixa').length,
    },
  };
}

/*
 * O aviso do modo degradado.
 *
 * Era o buraco central do diagnostico: o agente respondia frase fixa e NADA
 * registrava isso. Quem lia a conversa via uma resposta robotica sem entender
 * por que. Agora cada conversa carrega a explicacao, e os administradores
 * recebem UM aviso por dia — o suficiente para saber, pouco para nao virar
 * ruido que se aprende a ignorar.
 */
const avisadoEm = new Map();

/*
 * O atalho quebrado, dito na conversa.
 *
 * Quando o prompt manda usar @videoproposta e o template nao existe, a
 * ferramenta nem e oferecida ao modelo: ele segue a instrucao do texto, anuncia
 * que enviou, e nao enviou nada. Quem abre a conversa depois le uma promessa
 * cumprida pela metade sem nenhuma pista do porque.
 *
 * O aviso entra UMA vez por conversa. Repetir a cada mensagem afogaria a
 * propria conversa naquilo que se quer que a pessoa leia.
 */
const mencaoAvisada = new Set();

export function avisarMencaoInvalida(contato, agente, invalidas) {
  if (!invalidas?.length) return;
  const chave = `${contato.id}:${agente.id}`;
  if (mencaoAvisada.has(chave)) return;
  mencaoAvisada.add(chave);

  registrarLog(
    contato.workspaceId,
    contato.id,
    'ia',
    `${agente.nome} cita ${invalidas.map((m) => `@${m}`).join(', ')}, que nao existe no workspace: essa parte das instrucoes nao e executada, e o agente pode anunciar que fez.`,
    { tipo: 'sistema', nome: 'Sistema' },
  );
}

export function avisarModoDegradado(contato, agente) {
  registrarLog(
    contato.workspaceId,
    contato.id,
    'ia',
    `${agente.nome} respondeu pelo roteiro fixo: falta a chave de inteligencia artificial em Integracoes.`,
    { tipo: 'sistema', nome: 'Sistema' },
  );

  const hoje = new Date().toISOString().slice(0, 10);
  if (avisadoEm.get(contato.workspaceId) === hoje) return;
  avisadoEm.set(contato.workspaceId, hoje);

  for (const membro of listar('membros', { workspaceId: contato.workspaceId })) {
    if (membro.papel !== 'administrador') continue;
    notificar(
      contato.workspaceId,
      membro.id,
      'ia',
      'Os agentes estao respondendo sem inteligencia artificial',
      'Sem a chave em Integracoes, eles repetem uma frase fixa em vez de ler o cliente. Cadastre a chave para religar o atendimento.',
      contato.id,
    );
  }
}
