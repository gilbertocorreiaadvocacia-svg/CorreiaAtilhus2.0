import { REGRA_DA_SENHA, REGRA_DA_SENHA_ATE_26_10 } from '../ia/pacotes.js';
import { atualizar, listar } from './banco.js';
import { normalizar } from './util.js';

/**
 * Pedido do escritorio em 26/10/2026, com o print de uma conversa de
 * auxilio-acidente: o cliente mandou a senha do gov.br e o agente respondeu
 * "nunca compartilhe sua senha do gov.br com ninguem, nem com a equipe. Nao
 * precisamos dela para nada" — num roteiro que pede essa senha como documento
 * obrigatorio. "Quero que tire de todos os agentes o que fala que nao pode
 * compartilhar a senha do gov."
 *
 * O comportamento sai pela regra que todo agente recebe em montarSistema
 * (ia/motor.js). Aqui fica o texto: o que veio do pacote Civel sai dos agentes
 * ja instalados, e o que o escritorio escreveu a mao aparece no /api/saude,
 * pelo nome do agente, para alguem apagar na tela — frase escrita a mao nao se
 * apaga por adivinhacao.
 */

/** Troca a regra antiga do Civel pela nova, em todo agente de todo escritorio. Roda na subida. */
export function tirarAvisoDaSenhaDoGov() {
  let trocados = 0;
  for (const agente of listar('agentes')) {
    const prompt = String(agente.prompt || '');
    if (!prompt.includes(REGRA_DA_SENHA_ATE_26_10)) continue;
    atualizar('agentes', agente.id, { prompt: prompt.split(REGRA_DA_SENHA_ATE_26_10).join(REGRA_DA_SENHA) });
    trocados += 1;
  }
  return trocados;
}

/* "Nunca compartilhe", "nao precisamos", "nunca peca", "nao envie"... */
const PROIBE = /compartilh|nao precis|(nao|nunca|jamais) (peca|pedir|envie|enviar|mande|mandar|passe|passar|forneca|fornecer|informe|informar)/;

/** Ha no prompt uma frase dizendo ao cliente para nao passar a senha do gov.br (ou do INSS), ou que ela nao e necessaria? */
export function avisaParaNaoPassarASenhaDoGov(prompt) {
  return normalizar(prompt)
    .replace(/gov\.br/g, 'govbr')
    .split(/[.!?\n]+/)
    .some((frase) => frase.includes('senha') && /gov|inss/.test(frase) && PROIBE.test(frase));
}

/** Os agentes do escritorio que ainda tem um aviso desses no prompt, pelo nome (para /api/saude). */
export function agentesComAvisoDaSenhaDoGov(workspaceId) {
  return listar('agentes', { workspaceId })
    .filter((agente) => avisaParaNaoPassarASenhaDoGov(agente.prompt))
    .map((agente) => agente.nome);
}
