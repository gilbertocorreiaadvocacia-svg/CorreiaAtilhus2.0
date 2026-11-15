import { REGRA_DA_SENHA, REGRA_DA_SENHA_26_10_A_15_11, REGRA_DA_SENHA_ATE_26_10 } from '../ia/pacotes.js';
import { atualizar, listar } from './banco.js';
import { normalizar } from './util.js';

/**
 * Senha do gov.br e do Meu INSS (C-TL1, 15/11/2026, autorizado pelo
 * Dr. Gilberto): o escritorio nao pede nem aceita essa senha pelo WhatsApp.
 *
 * Historia: em 26/10/2026 o escritorio pediu para tirar dos agentes o aviso
 * "nunca compartilhe sua senha do gov.br", e o roteiro de auxilio-acidente
 * passou a pedir a senha como documento obrigatorio. A senha ficava em texto
 * aberto na conversa, no volume da VPS e no historico mandado a IA. Agora o
 * caminho e o seguro: o proprio cliente entra no Meu INSS com orientacao,
 * cadastra o escritorio como representante (procurador) ou marca atendimento
 * com uma pessoa da equipe.
 *
 * O comportamento sai pela regra que todo agente recebe em montarSistema
 * (ia/motor.js). Aqui ficam: a troca dos textos antigos nos agentes ja
 * instalados (roda na subida) e a lista, pelo nome, dos agentes cujo prompt
 * escrito a mao ainda pede a senha (aparece no /api/saude, para alguem
 * corrigir na tela — frase escrita a mao nao se apaga por adivinhacao).
 */

/* Trechos exatos que vieram dos pacotes e que saem dos agentes ja instalados. */
export const TROCAS_DA_SENHA_DO_GOV = [
  [REGRA_DA_SENHA_ATE_26_10, REGRA_DA_SENHA],
  [REGRA_DA_SENHA_26_10_A_15_11, REGRA_DA_SENHA],
  ['RG e CPF (ou CNH); senha do INSS ou GOV; CAT;', 'RG e CPF (ou CNH); CAT;'],
  [
    'SENHA DO GOV: nunca repita a senha em mensagem, resumo ou nota.',
    'SENHA DO GOV OU DO MEU INSS: não peça e não aceite. Se o cliente mandar, não repita o valor em mensagem, resumo ou nota; diga que ele não deve mandar senha por aqui e ofereça o caminho seguro: ele mesmo entra no Meu INSS com a nossa orientação, ou cadastra o escritório como representante (procurador) no Meu INSS, ou marcamos um atendimento com uma pessoa da equipe.',
  ],
  ['RG, CPF (ou CNH) e senha do INSS são obrigatórios.', 'RG e CPF (ou CNH) são obrigatórios.'],
];

/** Troca os textos antigos da senha do gov.br pelos novos, em todo agente de todo escritorio. Roda na subida. */
export function atualizarRegraDaSenhaDoGov() {
  let trocados = 0;
  for (const agente of listar('agentes')) {
    const prompt = String(agente.prompt || '');
    let novo = prompt;
    for (const [antigo, atual] of TROCAS_DA_SENHA_DO_GOV) {
      if (novo.includes(antigo)) novo = novo.split(antigo).join(atual);
    }
    if (novo === prompt) continue;
    atualizar('agentes', agente.id, { prompt: novo });
    trocados += 1;
  }
  return trocados;
}

/* "Nunca peca", "nao aceite", "nao envie"... : frase que recusa a senha. */
const RECUSA = /(nao|nunca|jamais) (peca|pedir|aceite|aceitar|envie|enviar|mande|mandar|solicite|solicitar)|nao deve (mandar|enviar|passar)/;
/* "Peca", "me envie", "solicite", "obrigatorio": frase que pede a senha. */
const PEDE = /\b(peca|pedir|pede|solicite|solicitar|envie|enviar|mande|mandar|passe|passar|informe|informar|forneca|fornecer)\b|obrigatori|um de cada vez|documentos/;

/** Ha no prompt uma frase que pede ao cliente a senha do gov.br ou do Meu INSS? */
export function pedeSenhaDoGov(prompt) {
  return normalizar(prompt)
    .replace(/gov\.br/g, 'govbr')
    .split(/[.!?\n]+/)
    .some((frase) => frase.includes('senha') && /gov|inss/.test(frase) && PEDE.test(frase) && !RECUSA.test(frase));
}

/** Os agentes do escritorio cujo prompt ainda pede a senha do gov.br, pelo nome (para /api/saude). */
export function agentesQuePedemSenhaDoGov(workspaceId) {
  return listar('agentes', { workspaceId })
    .filter((agente) => pedeSenhaDoGov(agente.prompt))
    .map((agente) => agente.nome);
}
