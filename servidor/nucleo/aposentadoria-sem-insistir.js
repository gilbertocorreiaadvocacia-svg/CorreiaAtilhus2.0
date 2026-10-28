import { APOSENTADORIA_SEM_RESPOSTA } from '../ia/pacotes/auxilio-acidente.js';
import { atualizar, listar } from './banco.js';
import { agora, normalizar } from './util.js';

/**
 * Pedido do escritorio em 28/10/2026: "que se o cliente nao responder sobre
 * se recebe aposentadoria ou nao, pode continuar o atendimento. Pois ela esta
 * insistindo e o cliente ja explicando o caso." A pergunta e da triagem do
 * auxilio-acidente (a Beatriz, no pacote): o roteiro so tinha os caminhos
 * RECEBE e NAO RECEBE, e o cliente que pulava a pergunta ficava preso nela.
 *
 * O pacote ja traz a regra (APOSENTADORIA_SEM_RESPOSTA). Aqui ela entra nos
 * agentes ja instalados: logo depois do caminho NAO RECEBE quando o texto e o
 * do pacote, e no fim do prompt quando o escritorio reescreveu o roteiro.
 * Uma vez por agente (aposentadoriaSemInsistirEm): quem apagar a regra na
 * tela nao a ve voltar no reinicio seguinte. So agente do auxilio-acidente
 * (nome ou pasta) que PERGUNTA da aposentadoria — o BPC tambem pergunta, mas
 * la aposentadoria desqualifica, e ninguem pediu para mudar.
 */

const NAO_RECEBE = 'NÃO RECEBE: falou de acidente, siga para ACIDENTE. Falou de doença do trabalho, siga para DOENÇA. Não identificou: Você sofreu acidente ou doença do trabalho?';

const doAuxilioAcidente = (agente) => normalizar(`${agente.nome || ''} ${agente.pasta || ''}`).includes('acidente');
const perguntaDaAposentadoria = (prompt) => /aposentadoria\s*\?/.test(normalizar(prompt));

export function aposentadoriaSemInsistir() {
  let mudados = 0;
  for (const agente of listar('agentes')) {
    const prompt = String(agente.prompt || '');
    if (agente.aposentadoriaSemInsistirEm || !doAuxilioAcidente(agente) || !perguntaDaAposentadoria(prompt)) continue;
    const novo = prompt.includes(APOSENTADORIA_SEM_RESPOSTA)
      ? prompt
      : prompt.includes(NAO_RECEBE)
        ? prompt.replace(NAO_RECEBE, `${NAO_RECEBE}\n\n${APOSENTADORIA_SEM_RESPOSTA}`)
        : `${prompt.trimEnd()}\n\n${APOSENTADORIA_SEM_RESPOSTA}`;
    atualizar('agentes', agente.id, { prompt: novo, aposentadoriaSemInsistirEm: agora() });
    if (novo !== prompt) mudados += 1;
  }
  return mudados;
}

/** Os agentes do auxilio-acidente que perguntam da aposentadoria, e se ja tem a regra (para /api/saude). */
export function aposentadoriaNosAgentes(workspaceId) {
  return listar('agentes', { workspaceId })
    .filter((agente) => doAuxilioAcidente(agente) && perguntaDaAposentadoria(agente.prompt))
    .map((agente) => ({ agente: agente.nome, semInsistir: String(agente.prompt || '').includes(APOSENTADORIA_SEM_RESPOSTA) }));
}
