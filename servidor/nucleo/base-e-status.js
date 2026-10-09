import { atualizar, inserir, listar } from './banco.js';
import { normalizar, novoId } from './util.js';

/**
 * O miolo de `npm run base-e-status`, extraido para poder rodar tambem no
 * boot do servidor (ver servidor/index.js) alem da ferramenta de linha de
 * comando (servidor/ferramentas/base-e-status.js) — a mesma logica, dois
 * chamadores. Documentacao completa do que isto faz esta na ferramenta.
 *
 * Achado de 08/10/2026, reconferindo o diagnostico de 29/09: esta funcao so
 * olhava listar('workspaces')[0] — o workspace geral, sem agente trabalhista
 * nenhum — e por isso o Trabalhista de verdade nunca foi corrigido, mesmo com
 * a ferramenta pronta havia dias. Mesmo defeito que ja tinha sido achado e
 * corrigido em vozes-dos-agentes.js.
 */

const NOME_ITEM_TRABALHISTA = 'Quebra de objeções · Trabalhista (rascunho)';

const CONTEUDO_TRABALHISTA = [
  '[RASCUNHO gerado em 08/10/2026 para destravar o atendimento — revisar com um advogado antes de confiar. De proposito, o texto evita numero, percentual ou prazo que o escritorio nao confirmou.]',
  '',
  'OBJECAO: "Quanto custa? Preciso pagar alguma coisa agora?"',
  'RESPOSTA: Nao ha nenhum custo hoje para a consulta inicial. Os honorarios e a forma de pagamento ficam combinados no contrato, antes de qualquer cobranca.',
  '',
  'OBJECAO: "Vou pensar / depois eu respondo."',
  'RESPOSTA: Sem problema. Causa trabalhista tem prazo para entrar com a acao (prescricao), entao quanto antes o escritorio avaliar o caso, melhor. Posso te mandar mais informacoes para ler com calma?',
  '',
  'OBJECAO: "Ja tenho advogado."',
  'RESPOSTA: Entendo. Nesse caso nao seguimos, para nao atrapalhar o trabalho do colega. Se precisar de uma segunda opiniao no futuro, estamos a disposicao.',
  '',
  'OBJECAO: "E se eu perder o processo?"',
  'RESPOSTA: Antes de entrar com a acao, o escritorio avalia as chances do caso e conversa com voce sobre elas. Nao ha garantia de resultado em processo judicial nenhum.',
  '',
  'OBJECAO: "Voce e robo?"',
  'RESPOSTA: Sou a assistente virtual do escritorio e faco a triagem inicial. Assim que os dados estiverem completos, um advogado assume a conversa.',
].join('\n');

const ehPerda = (s) => ['desistencia', 'desqualificado'].includes(s.tipo) || normalizar(s.nome) === 'nao qualificado';

/**
 * `aplicar: false` so relata o que faria. `log`, se passado, recebe cada
 * linha do relatorio; sem ele roda calado e devolve so os totais.
 */
export function processarBaseEStatus({ aplicar = false, log = () => {}, departamento = 'Comercial' } = {}) {
  let desvinculados = 0;
  let rascunhosCriados = 0;
  let vinculadosAoRascunho = 0;
  let ajustados = 0;

  for (const workspace of listar('workspaces')) {
    const w = workspace.id;
    const agentesTrabalhistas = listar('agentes', { workspaceId: w }).filter((a) => a.area === 'trabalhista');

    /*
     * 1. Base previdenciaria nos agentes trabalhistas ----------------------
     *
     * O nome do rascunho tambem comeca com "Quebra de objec..." (de
     * proposito, para ficar claro que e o substituto dela) — sem excluir o
     * proprio rascunho da busca, a segunda rodada o achava como se fosse o
     * item previdenciario, desvinculava e revinculava em seguida: dado final
     * igual, mas `atualizadoEm` mudava e a rodada deixava de ser idempotente
     * de verdade (achado em 09/10/2026, rodando duas vezes em sequencia).
     */
    const item = listar('conhecimento', { workspaceId: w }).find(
      (k) => k.nome !== NOME_ITEM_TRABALHISTA && normalizar(k.nome).startsWith('quebra de objec'),
    );
    if (item) {
      for (const agente of agentesTrabalhistas) {
        if (!(agente.conhecimentoIds || []).includes(item.id)) continue;
        log(`  [${aplicar ? 'feito' : 'simulado'}] ${workspace.nome}: desvincular "${item.nome}" de ${agente.nome}`);
        if (aplicar) atualizar('agentes', agente.id, { conhecimentoIds: agente.conhecimentoIds.filter((id) => id !== item.id) });
        desvinculados += 1;
      }
    }

    /* 2. Rascunho trabalhista no lugar dela -------------------------------- */
    if (agentesTrabalhistas.length) {
      let rascunho = listar('conhecimento', { workspaceId: w }).find((k) => k.nome === NOME_ITEM_TRABALHISTA);
      if (!rascunho) {
        log(`  [${aplicar ? 'feito' : 'simulado'}] ${workspace.nome}: criar "${NOME_ITEM_TRABALHISTA}"`);
        if (aplicar) {
          rascunho = inserir('conhecimento', {
            id: novoId('kb'),
            workspaceId: w,
            nome: NOME_ITEM_TRABALHISTA,
            descricao: 'Rascunho gerado para o atendimento nao ficar sem resposta. Revisar com um advogado.',
            conteudo: CONTEUDO_TRABALHISTA,
            arquivos: [],
          });
        }
        rascunhosCriados += 1;
      }
      for (const agente of agentesTrabalhistas) {
        if (rascunho && (agente.conhecimentoIds || []).includes(rascunho.id)) continue;
        log(`  [${aplicar ? 'feito' : 'simulado'}] ${workspace.nome}: vincular "${NOME_ITEM_TRABALHISTA}" a ${agente.nome}`);
        if (aplicar && rascunho) atualizar('agentes', agente.id, { conhecimentoIds: [...(agente.conhecimentoIds || []), rascunho.id] });
        vinculadosAoRascunho += 1;
      }
    }

    /* 3. Status de saida sem departamento ---------------------------------- */
    const dep = listar('departamentos', { workspaceId: w }).find((x) => normalizar(x.nome) === normalizar(departamento));
    if (!dep) continue;
    for (const s of listar('status', { workspaceId: w })) {
      if (s.departamentoId || !ehPerda(s)) continue;
      log(`  [${aplicar ? 'feito' : 'simulado'}] ${workspace.nome}: "${s.nome}" passa para ${dep.nome}`);
      if (aplicar) atualizar('status', s.id, { departamentoId: dep.id });
      ajustados += 1;
    }
  }

  return { desvinculados, rascunhosCriados, vinculadosAoRascunho, ajustados };
}
