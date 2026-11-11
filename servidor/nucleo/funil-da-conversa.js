import { achar, listar } from './banco.js';
import { ordenarPor } from './util.js';

/**
 * O funil de UMA conversa: quando ela entrou em cada coluna do Kanban.
 *
 * Pedido do escritorio em 10/11/2026: "onde tem as informacoes dos clientes,
 * abaixo do resumo, quero que tenha esse funil, a etapa do funil [...] e
 * conforme o agente vai atendendo, ele vai automaticamente preenchendo".
 *
 * NAO HA ETAPA NOVA PARA GUARDAR, e e de proposito: a escada e as colunas do
 * Kanban de hoje (colecao `status`), decisao do escritorio na mesma conversa —
 * "as colunas do meu Kanban de hoje". Renomear ou criar coluna muda o funil
 * junto, sem lista paralela para alguem esquecer de atualizar.
 *
 * E o histórico tambem ja estava gravado. Todo caminho que mexe no status
 * grava o mesmo log `tipo: 'status'`, com `{ statusId, tipo, anteriorId }` nos
 * dados e a data em `criadoEm`:
 *
 *   - automacao/followup.js (aplicarStatus): a pessoa no Kanban e a IA;
 *   - whatsapp/recebimento.js: o status de entrada, quando a conversa nasce;
 *   - rotas/atendimento.js: a importacao de planilha.
 *
 * Este modulo so le esses logs e responde a pergunta que a lateral faz. Nada
 * aqui escreve.
 *
 * O PONTO DELICADO e a coluna que nao existe mais: unificar colunas
 * (rotas/automacoes.js) apaga o status e deixa os logs antigos apontando para
 * um id morto. O `dados` do log nao guarda o nome, entao para esses — e so
 * para esses — o nome sai da descricao, que as tres gravacoes escrevem no
 * mesmo formato ("Status: X -> Y"). Para as colunas vivas o nome vem sempre do
 * registro, que e o nome de agora; para a coluna morta sobra o nome que ela
 * tinha na epoca, que e a unica coisa verdadeira que ainda da para dizer.
 */

/** O nome depois da flecha, da descricao do log. So para coluna ja apagada. */
function nomeNaDescricao(descricao) {
  const partes = String(descricao || '').split('->');
  const nome = partes.length > 1 ? partes[partes.length - 1].trim() : '';
  return nome || null;
}

/**
 * Os passos de status desta conversa, do mais antigo para o mais novo.
 *
 * Le os logs filtrando por tipo no banco, e nao `logsDe()`: aquele devolve os
 * 200 ultimos logs de TODO tipo, e numa conversa movimentada (mensagem, mídia,
 * follow-up, transferencia) as trocas de coluna ficariam de fora da janela. As
 * trocas sao poucas por conversa; os logs em volta sao muitos.
 */
export function passosDoFunil(contatoId) {
  const logs = ordenarPor(listar('logs', { contatoId, tipo: 'status' }), 'criadoEm', 'asc');
  return logs
    .map((log) => {
      const statusId = log.dados?.statusId || null;
      if (!statusId) return null;
      const status = achar('status', statusId);
      return {
        em: log.criadoEm,
        statusId,
        nome: status?.nome || nomeNaDescricao(log.descricao) || 'Coluna removida',
        cor: status?.cor || null,
        /* A coluna ainda esta no funil do escritorio? A escada da lateral so
           acende degrau que existe; o resto vive no historico. */
        viva: Boolean(status),
        deId: log.dados?.anteriorId || null,
        autor: log.autor || null,
      };
    })
    .filter(Boolean);
}

/**
 * O funil da conversa, pronto para a lateral desenhar.
 *
 * `etapas` responde pela escada (quando a conversa chegou em cada coluna) e
 * `historico` pela lista de baixo (a sequencia, com quem moveu). A escada em si
 * — quais colunas, em que ordem — e montada na tela, que ja tem a lista de
 * status na ordem do Kanban; repetir essa ordem aqui seria uma segunda
 * verdade para o escritorio manter.
 */
export function funilDaConversa(contato) {
  const passos = passosDoFunil(contato.id);

  /* Por coluna: a primeira vez que entrou, a ultima, e quantas vezes. Voltar
     para uma coluna acontece (objecao respondida, contrato que trava na
     assinatura), e a lateral mostra a ultima entrada — e o "ha N dias" que
     interessa a quem atende e o da passagem de agora, nao o da estreia. */
  const etapas = {};
  for (const passo of passos) {
    const atual = etapas[passo.statusId];
    if (atual) {
      atual.ultimaEm = passo.em;
      atual.vezes += 1;
    } else {
      etapas[passo.statusId] = { primeiraEm: passo.em, ultimaEm: passo.em, vezes: 1 };
    }
  }

  /*
   * Desde quando esta na coluna de agora.
   *
   * O log e a fonte boa: ele marca a entrada, e e o mesmo instante que
   * `statusAlteradoEm` guarda. O campo do contato entra como reserva porque
   * nasceu depois (aplicarStatus) — conversa que nao mudou de coluna desde
   * entao nao o tem. Sem nenhum dos dois fica nulo, e a tela nao mostra data
   * nenhuma: melhor nao dizer do que dizer data inventada.
   */
  const atualDesde = (contato.statusId ? etapas[contato.statusId]?.ultimaEm : null) || contato.statusAlteradoEm || null;

  return {
    statusId: contato.statusId || null,
    atualDesde,
    etapas,
    historico: passos,
  };
}
