/**
 * Cor de status, departamento e etiqueta guardada como TOKEN, e nao como hex.
 *
 * O hex gravado no banco nao sabe em que tema vai ser desenhado. O mesmo
 * #5B8DEF que servia no fundo preto some no fundo branco, e era por isso que a
 * mesma bolinha ficava legivel num tema e sumia no outro. Guardando
 * `var(--serie-3)` quem resolve a cor e a folha de estilo, no momento de
 * pintar, ja sabendo qual tema esta em uso.
 *
 * A migracao so mexe no que veio da semeadura original. Cor escolhida a mao
 * pelo escritorio fica como esta: trocar a escolha de alguem sem avisar seria
 * pior do que a incoerencia que estamos consertando.
 */

/* Os nove hex da semeadura antiga, e o degrau da rampa que cada um vira.
   A ordem segue o funil: quanto mais claro o degrau, mais cedo a etapa. */
export const DA_SEMEADURA_ANTIGA = {
  '#5b8def': 'var(--serie-1)', // Nova conversa
  '#c9a961': 'var(--serie-2)', // Em triagem, Comercial, BPC/LOAS
  '#d9a441': 'var(--serie-3)', // Qualificado, Financeiro
  '#e9dcb0': 'var(--serie-4)', // Proposta enviada, Assinatura pendente
  '#6fbf73': 'var(--sucesso)', // Contrato assinado, Pos-venda
  '#8fa9c9': 'var(--serie-6)', // Documentacao, Processo em andamento
  '#8a8070': 'var(--serie-5)', // Desqualificado
  '#c7563f': 'var(--erro)', //   Proposta recusada, Urgente
  '#7a5c4a': 'var(--serie-8)', // Desistencia
};

/** As colecoes cujo campo `cor` e desenhado na interface. */
const COLECOES_COM_COR = ['status', 'departamentos', 'etiquetas', 'origens'];

/**
 * Troca as cores da semeadura antiga pelos tokens, uma vez.
 *
 * Roda a cada partida do servidor de proposito: e barato, e idempotente, e
 * assim uma base criada antes desta versao se acerta sozinha na primeira vez
 * que subir, sem ninguem precisar rodar nada a mao.
 */
export function migrarCoresParaTokens({ listar, atualizar }) {
  let trocadas = 0;

  for (const colecao of COLECOES_COM_COR) {
    for (const registro of listar(colecao)) {
      const cor = registro?.cor;
      if (typeof cor !== 'string') continue;

      const token = DA_SEMEADURA_ANTIGA[cor.trim().toLowerCase()];
      if (!token) continue;

      atualizar(colecao, registro.id, { cor: token });
      trocadas += 1;
    }
  }

  return trocadas;
}
