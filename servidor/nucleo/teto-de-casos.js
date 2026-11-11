import { achar, listar } from './banco.js';

/**
 * Teto de casos em aberto por pessoa.
 *
 * Pedido do escritorio em 11/11/2026: impedir que alguem assuma varios casos
 * para si e feche contrato atras de meta, tirando dos colegas.
 *
 * O QUE CONTA COMO "CASO EM ABERTO": conversa que a pessoa ASSUMIU
 * (`aceitoPor`) e que ainda nao foi concluida (`estado !== 'arquivado'`). E
 * exatamente a aba "Ativos" dela no atendimento (abaDe, rotas/atendimento.js),
 * e nao "tudo o que ela ja atendeu": o teto e sobre o que esta na mao agora.
 *
 * Conversa que a IA conduz nao entra — ninguem a "pegou" — e conversa
 * concluida sai da conta sozinha quando a pessoa termina o atendimento, que e
 * justamente como ela libera espaco para pegar a proxima.
 *
 * NASCE DESLIGADO, e isso e deliberado. Um teto que ja chega valendo
 * bloquearia gente no dia da implantacao, no meio de atendimento, sem ninguem
 * ter pedido numero nenhum. Sem configurar, `tetoDoMembro` devolve null e
 * `conferir` libera tudo — o escritorio liga quando quiser e escolhendo o
 * numero.
 *
 * ONDE PEGA: no momento de APROVAR O CONTRATO (integracoes/zapsign.js), que e
 * o passo que fecha e conta para a meta. Nao no momento de assumir a conversa:
 * barrar ali deixaria cliente escrevendo sem ninguem poder atender, que e um
 * estrago maior do que o problema.
 */

/** A configuracao do escritorio: { padrao, porMembro: { [membroId]: n } }. */
export function tetoDoEscritorio(workspaceId) {
  const workspace = achar('workspaces', workspaceId);
  const cfg = workspace?.tetoDeCasos || {};
  return {
    padrao: Number.isFinite(Number(cfg.padrao)) && Number(cfg.padrao) > 0 ? Number(cfg.padrao) : null,
    porMembro: cfg.porMembro && typeof cfg.porMembro === 'object' ? cfg.porMembro : {},
  };
}

/**
 * O teto desta pessoa, ou null quando ela nao tem.
 *
 * O ajuste individual vence o padrao, inclusive para TIRAR o teto de alguem:
 * gravar 0 no membro quer dizer "esta pessoa nao tem limite", e nao "esta
 * pessoa nao pode nada". E o caso do socio que fecha o que aparecer.
 */
export function tetoDoMembro(workspaceId, membroId) {
  if (!membroId) return null;
  const { padrao, porMembro } = tetoDoEscritorio(workspaceId);
  const individual = porMembro[membroId];
  if (individual !== undefined && individual !== null && individual !== '') {
    const n = Number(individual);
    return Number.isFinite(n) && n > 0 ? n : null;
  }
  return padrao;
}

/** Quantas conversas esta pessoa tem na mao agora. */
export function casosEmAberto(workspaceId, membroId) {
  if (!membroId) return 0;
  return listar('contatos', { workspaceId }).filter((c) => c.aceitoPor === membroId && c.estado !== 'arquivado').length;
}

/**
 * Pode fechar? Devolve sempre os numeros, para a tela poder mostrar quanto
 * falta mesmo quando esta liberado.
 */
export function conferirTeto(workspaceId, membroId) {
  const teto = tetoDoMembro(workspaceId, membroId);
  const abertos = casosEmAberto(workspaceId, membroId);
  if (!teto) return { teto: null, abertos, excedeu: false, pode: true };
  return { teto, abertos, excedeu: abertos > teto, pode: abertos <= teto };
}

/** A frase que a pessoa le quando e barrada. Diz o numero e como sair disso. */
export function motivoDoBloqueio({ teto, abertos }) {
  return (
    `Você tem ${abertos} ${abertos === 1 ? 'caso em aberto' : 'casos em aberto'} e o seu limite é ${teto}. ` +
    'Conclua um atendimento para liberar espaço, ou peça a um administrador para ajustar o seu limite.'
  );
}

/** Como a situacao de cada pessoa aparece para o administrador e no /api/saude. */
export function casosPorPessoa(workspaceId) {
  const { padrao, porMembro } = tetoDoEscritorio(workspaceId);
  return listar('membros', { workspaceId })
    .map((membro) => {
      const usuario = membro.usuarioId ? achar('usuarios', membro.usuarioId) : null;
      const teto = tetoDoMembro(workspaceId, membro.id);
      const abertos = casosEmAberto(workspaceId, membro.id);
      return {
        membroId: membro.id,
        nome: usuario?.nome || 'Sem nome',
        papel: membro.papel,
        teto,
        /* `proprio` separa quem tem ajuste individual de quem herda o padrao:
           sem isso, a tela de ajuste nao sabe qual campo veio preenchido. */
        proprio: porMembro[membro.id] !== undefined ? porMembro[membro.id] : null,
        abertos,
        excedeu: Boolean(teto) && abertos > teto,
      };
    })
    .sort((a, b) => b.abertos - a.abertos || a.nome.localeCompare(b.nome, 'pt-BR'));
}


