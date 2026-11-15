/**
 * C-TL1 (15/11/2026): o que o agente oferece quando o cliente manda, ou quer
 * mandar, a senha do gov.br ou do Meu INSS. O escritorio nao recebe essa
 * senha pelo WhatsApp. Fica num arquivo so para a regra de todo agente
 * (ia/motor.js) e a regra do pacote (ia/pacotes.js) dizerem a mesma coisa.
 */
export const CAMINHO_SEGURO_DO_MEU_INSS =
  'ele mesmo entra no Meu INSS e nós orientamos o passo a passo; ou ele cadastra o escritório como representante (procurador) no Meu INSS; ou marcamos um atendimento com uma pessoa da equipe';
