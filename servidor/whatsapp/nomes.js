/**
 * Quem pode dar nome a uma conversa, e quem pode trocar o nome de quem.
 *
 * O nome de uma conversa chega por quatro caminhos, e eles NAO valem igual:
 *
 *   manual   alguem do escritorio escreveu (na tela, no cadastro, no CSV).
 *            Ninguem mexe: "Maria Souza - BPC do filho" vale mais do que
 *            qualquer coisa que o WhatsApp saiba.
 *   agenda   o nome salvo na agenda do celular do escritorio. E o que a equipe
 *            reconhece, porque e o que ela ve no proprio WhatsApp.
 *   perfil   o nome que a PESSOA poe no perfil dela ("Mari 🌸", "Deus e fiel").
 *            Serve enquanto nao ha coisa melhor.
 *   (vazio)  so o numero, ou nada.
 *
 * A agenda passa por cima do perfil, e a agenda nova passa por cima da antiga
 * (o escritorio renomeou o contato no celular). O perfil so preenche o que
 * esta vazio. Nada passa por cima do manual.
 *
 * Conversa de antes deste campo existir nao tem origem gravada, e o nome dela
 * pode ter sido escrito a mao — entao e tratada como manual, com uma excecao: a
 * que veio da importacao do historico, cujo nome so pode ter saido do perfil.
 */

export const SEM_IDENTIFICACAO = 'Conversa sem identificacao';

/** Nome que so esta ocupando o lugar: o proprio numero, o codigo @lid, nada. */
export function nomeEhProvisorio(contato) {
  const nome = String(contato?.nome || '').trim();
  if (!nome || nome === SEM_IDENTIFICACAO) return true;
  if (contato.telefone && nome === contato.telefone) return true;
  if (contato.lid && nome === String(contato.lid).split('@')[0]) return true;
  return false;
}

/** O nome atual desta conversa pode ser trocado por um vindo de `origemNova`? */
export function podeTrocarNome(contato, origemNova) {
  if (nomeEhProvisorio(contato)) return true;
  const atual = contato.nomeOrigem || (contato.importado ? 'perfil' : 'manual');
  if (atual === 'manual') return false;
  if (origemNova === 'agenda') return true;
  return false;
}

/** Nome que nao e nome: vazio, ou o numero que a Evolution poe no lugar. */
export function nomeValido(nome, jid = '') {
  const texto = String(nome || '').trim();
  if (!texto) return '';
  if (jid && texto === String(jid).split('@')[0]) return '';
  return texto;
}
