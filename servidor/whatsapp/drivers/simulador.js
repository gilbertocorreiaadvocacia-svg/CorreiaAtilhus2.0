/**
 * Driver do simulador.
 *
 * Nao existe rede aqui, e e esse o ponto: a mensagem e gravada, aparece na
 * conversa como enviada e o funil inteiro roda, agente, mencao, follow-up e
 * contrato, sem chip, sem credencial e sem risco de mandar mensagem de teste
 * para o WhatsApp de um cliente de verdade.
 *
 * E tambem a rede de seguranca do sistema: quando o `tipo` da conexao esta
 * errado ou vazio, e para ca que driverDa() manda. Um caminho que nao envia
 * nada e o unico padrao seguro para um cadastro que ninguem entende.
 */
export const driverSimulador = {
  id: 'simulador',
  nome: 'Simulador',
  descricao: 'Funciona hoje, sem chip. Nada sai desta maquina.',
  precisaCredenciais: false,

  async enviar() {
    /* Sem idExterno de proposito: id externo e o numero de protocolo do
       provedor, e aqui nao houve provedor nenhum. Inventar um faria a tela de
       entrega mostrar "aguardando confirmacao" para sempre. */
    return { idExterno: null };
  },

  async testar() {
    return { ok: true, mensagem: 'Modo simulador ativo. Nada sai desta maquina.' };
  },

  async marcarLida() {
    /* No simulador, lida e um estado local: nao ha ninguem do outro lado para
       receber a confirmacao. */
  },
};
