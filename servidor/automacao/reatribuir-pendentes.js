import { achar, atualizar, listar, mensagensDe, registrarLog } from '../nucleo/banco.js';
import { emitir } from '../nucleo/eventos.js';
import { agendarResposta, agentePorPalavraChave } from '../ia/motor.js';
import { ligarNumerosDasAreas } from '../nucleo/agentes-por-escritorio.js';

/**
 * Toda conversa pendente (sem agente) volta a ter o agente padrao da
 * conexao — normalmente a Triagem da area. Pedido do escritorio em
 * 19/10/2026: "toda mensagem nova vai para os agentes; se for uma conversa
 * antiga, o agente deve ler e, conforme o beneficio, vai atender".
 *
 * Pedido do escritorio em 23/10/2026: so trocar responsavel/estado nao
 * bastava — "quero que os agentes atendam de verdade". Uma conversa que ja
 * tinha mensagem do cliente esperando ficava com o responsavel certo por
 * dentro, mas o cliente continuava sem ver resposta nenhuma ate escrever de
 * novo (e muitos nao escrevem de novo, so desistem). Agora, depois de
 * reatribuir, chama agendarResposta (ia/motor.js) para o agente responder
 * de verdade, no mesmo delay configurado nele — o agente ja monta o
 * contexto a partir do historico INTEIRO da conversa (mensagensDe), entao
 * ja le tudo e roteia pelo beneficio certo sozinho, pelas mesmas regras do
 * prompt de Triagem que ja usa para lead novo.
 *
 * Escopo (decidido com o escritorio): TODA conversa pendente, de qualquer
 * origem — inclusive as que um agente tirou da IA de proposito
 * (desativar_ia, transferencia para pessoa). Uma decisao explicita anterior
 * pode ser revertida por isto; e intencional.
 *
 * Qual agente ganha a conversa (pedido do escritorio em 23/10/2026 —
 * "atendido 100% pelo agente com beneficio determinado, por palavra-chave"):
 * primeiro tenta achar o especialista pelo que o cliente ja escreveu
 * (agentePorPalavraChave, sobre o historico inteiro da conversa — ela pode
 * ter ficado pendente antes de mencionar o beneficio); so cai no agente
 * padrao da conexao quando nenhuma palavra-chave bate.
 *
 * So nao mexe quando nao ha para onde mandar: grupo (sem fluxo de agente
 * individual), nenhuma palavra-chave bateu E conexao sem agente padrao
 * configurado, ou o agente escolhido (por palavra-chave ou padrao) esta
 * desligado.
 */
export function reatribuirPendentes() {
  let reativados = 0;
  for (const contato of listar('contatos', { estado: 'pendente' })) {
    if (contato.grupo) continue;
    const conexao = achar('conexoes', contato.conexaoId);

    const textoDoCliente = mensagensDe(contato.id)
      .filter((m) => m.direcao === 'entrada' && m.conteudo)
      .map((m) => m.conteudo)
      .join(' ');
    const porPalavraChave = textoDoCliente
      ? agentePorPalavraChave(contato.workspaceId, textoDoCliente, contato.area || conexao?.area)
      : null;

    const agente =
      porPalavraChave || (conexao?.responsavelPadrao?.tipo === 'agente' ? achar('agentes', conexao.responsavelPadrao.id) : null);
    if (!agente?.ativo) continue;

    atualizar('contatos', contato.id, {
      responsavel: { tipo: 'agente', id: agente.id, nome: agente.nome },
      estado: 'ia',
      aceitoPor: null,
    });
    registrarLog(
      contato.workspaceId,
      contato.id,
      'reativacao',
      porPalavraChave
        ? `Reatribuido ao agente ${agente.nome} por palavra-chave (fila de pendentes)`
        : `Reatribuido ao agente ${agente.nome} (fila de pendentes)`,
    );
    emitir(contato.workspaceId, 'contato', { contatoId: contato.id });
    agendarResposta(contato);
    reativados += 1;
  }
  return { reativados };
}

let laco = null;

/*
 * Antes de reatribuir, religa todo numero de area sem responsavel padrao ao
 * agente de entrada (Triagem) da area dele — a mesma coisa que
 * ligarNumerosDasAreas ja faz, so que ate 23/10/2026 so rodava por um
 * script de linha de comando, com o servidor PARADO (ferramentas/
 * ligar-numeros-das-areas.js), o que na pratica significa que nunca
 * rodava: ninguem desliga o sistema soh para rodar um script de manutencao.
 * Pedido do escritorio em 23/10/2026: "quero que todos os pendentes vão
 * para a IA, com seus devidos agentes em relação ao benefício" — sem isto,
 * um numero novo sem responsavel padrao configurado (ex.: uma conexao de
 * anuncio recem-criada) ficava pendente para sempre, mesmo com a
 * reatribuicao rodando, porque nao havia para quem reatribuir.
 *
 * So mexe em numero sem responsavel, e so quando o agente de entrada da
 * area existe e esta ativo — nao inventa agente nem area (ver a funcao, em
 * nucleo/agentes-por-escritorio.js). Guarda copia de toda conexao que
 * mudar em dados/copias-de-agentes antes de gravar.
 */
function varrerFila() {
  ligarNumerosDasAreas();
  reatribuirPendentes();
}

/** Varre a fila na hora (cuida do estoque atual) e dali em diante de tempos em tempos. */
export function iniciarReatribuicaoDePendentes(intervalo) {
  if (laco) return;
  varrerFila();
  laco = setInterval(varrerFila, intervalo);
  if (typeof laco.unref === 'function') laco.unref();
}

export function pararReatribuicaoDePendentes() {
  if (laco) clearInterval(laco);
  laco = null;
}
