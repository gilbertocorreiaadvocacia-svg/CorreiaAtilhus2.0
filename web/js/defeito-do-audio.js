/**
 * Audio que ja nasceu quebrado.
 *
 * Ate 03/11/2026 o servidor guardava ~15 bytes de lixo no lugar de toda gravacao
 * feita pelo navegador (o cabecalho "audio/webm;codecs=opus" nao era entendido).
 * O arquivo existe, o tocador abre e da erro. Nao ha como recuperar: o que foi
 * gravado nao chegou a ser guardado. Um audio de verdade, mesmo de meio segundo,
 * passa de varias centenas de bytes, entao o tamanho que o sistema anotou na
 * mensagem basta para reconhecer o defeito sem pedir o arquivo ao servidor.
 */
export const MENOR_AUDIO_VALIDO_EM_BYTES = 300;

/** Verdadeiro so quando o tamanho e conhecido e pequeno demais: sem tamanho, nao acusa. */
export function audioCorrompido(midia) {
  const tamanho = Number(midia?.tamanho);
  return Number.isFinite(tamanho) && tamanho > 0 && tamanho < MENOR_AUDIO_VALIDO_EM_BYTES;
}
