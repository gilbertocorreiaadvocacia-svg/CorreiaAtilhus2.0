import { achar, atualizar, listar, registrarLog } from '../nucleo/banco.js';
import { emitir } from '../nucleo/eventos.js';

/**
 * Toda conversa pendente (sem agente) volta a ter o agente padrao da
 * conexao — normalmente a Triagem da area. Pedido do escritorio em
 * 19/10/2026: "toda mensagem nova vai para os agentes; se for uma conversa
 * antiga, o agente deve ler e, conforme o beneficio, vai atender".
 *
 * NAO manda mensagem nenhuma: so troca responsavel/estado. O agente, ao
 * responder (quando a PESSOA escrever de novo), ja monta o contexto a
 * partir do historico INTEIRO da conversa (mensagensDe, em ia/motor.js) —
 * entao ja le tudo e roteia pelo beneficio certo sozinho, pelas mesmas
 * regras do prompt de Triagem que ja usa para lead novo. Nenhuma logica de
 * classificacao nova precisa existir aqui.
 *
 * Escopo (decidido com o escritorio): TODA conversa pendente, de qualquer
 * origem — inclusive as que um agente tirou da IA de proposito
 * (desativar_ia, transferencia para pessoa). Uma decisao explicita anterior
 * pode ser revertida por isto; e intencional.
 *
 * So nao mexe quando nao ha para onde mandar: grupo (sem fluxo de agente
 * individual), conexao sem agente padrao configurado, ou agente padrao
 * desligado.
 */
export function reatribuirPendentes() {
  let reativados = 0;
  for (const contato of listar('contatos', { estado: 'pendente' })) {
    if (contato.grupo) continue;
    const conexao = achar('conexoes', contato.conexaoId);
    if (conexao?.responsavelPadrao?.tipo !== 'agente') continue;
    const agente = achar('agentes', conexao.responsavelPadrao.id);
    if (!agente?.ativo) continue;

    atualizar('contatos', contato.id, {
      responsavel: { tipo: 'agente', id: agente.id, nome: agente.nome },
      estado: 'ia',
      aceitoPor: null,
    });
    registrarLog(contato.workspaceId, contato.id, 'reativacao', `Reatribuido ao agente ${agente.nome} (fila de pendentes)`);
    emitir(contato.workspaceId, 'contato', { contatoId: contato.id });
    reativados += 1;
  }
  return { reativados };
}

let laco = null;

/** Varre a fila na hora (cuida do estoque atual) e dali em diante de tempos em tempos. */
export function iniciarReatribuicaoDePendentes(intervalo) {
  if (laco) return;
  reatribuirPendentes();
  laco = setInterval(reatribuirPendentes, intervalo);
  if (typeof laco.unref === 'function') laco.unref();
}

export function pararReatribuicaoDePendentes() {
  if (laco) clearInterval(laco);
  laco = null;
}
