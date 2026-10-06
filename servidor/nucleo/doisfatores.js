import crypto from 'node:crypto';
import { conferirSenha, hashSenha } from './util.js';

/**
 * Segundo fator por aplicativo autenticador (TOTP, RFC 6238).
 *
 * Construido com node:crypto, sem dependencia nenhuma, como o resto do sistema.
 * O codigo de seis digitos que o Google Authenticator / Authy mostram e um
 * HMAC-SHA1 do segredo com o relogio dividido em passos de 30 segundos, cortado
 * para seis digitos. O servidor guarda o mesmo segredo e refaz a conta: se bate,
 * quem entra tem o celular que foi pareado na adesao.
 *
 * O segredo nunca sai do servidor depois da adesao (ver `limpar` em sessao.js).
 * Ele viaja UMA vez, na hora de parear com o app, e dai em diante so o codigo
 * de seis digitos vai e volta.
 *
 * Nada aqui inventa cripto: base32 e o alfabeto da RFC 4648, o HMAC e o do
 * node, e os vetores de teste da RFC 6238 provam a conta (ver testes/doisfatores).
 */

const PASSO = 30; // segundos por janela, o padrao que todo app usa
const DIGITOS = 6;
const ALFABETO32 = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';

/** Segredo novo, em base32 (o formato que os apps aceitam digitado ou por QR). */
export function gerarSegredo(bytes = 20) {
  return base32Codificar(crypto.randomBytes(bytes));
}

function base32Codificar(buffer) {
  let bits = 0;
  let valor = 0;
  let saida = '';
  for (const byte of buffer) {
    valor = (valor << 8) | byte;
    bits += 8;
    while (bits >= 5) {
      saida += ALFABETO32[(valor >>> (bits - 5)) & 31];
      bits -= 5;
    }
  }
  if (bits > 0) saida += ALFABETO32[(valor << (5 - bits)) & 31];
  return saida;
}

function base32Decodificar(texto) {
  const limpo = String(texto).toUpperCase().replace(/[^A-Z2-7]/g, '');
  let bits = 0;
  let valor = 0;
  const bytes = [];
  for (const ch of limpo) {
    const indice = ALFABETO32.indexOf(ch);
    if (indice < 0) continue;
    valor = (valor << 5) | indice;
    bits += 5;
    if (bits >= 8) {
      bytes.push((valor >>> (bits - 8)) & 0xff);
      bits -= 8;
    }
  }
  return Buffer.from(bytes);
}

/** O codigo de 6 digitos de um instante. `emSegundos` permite testar um tempo fixo. */
export function codigoDe(segredoBase32, emSegundos = Date.now() / 1000, passo = PASSO, digitos = DIGITOS) {
  const contador = Math.floor(emSegundos / passo);
  const buffer = Buffer.alloc(8);
  /* Contador de 64 bits, big-endian. Em 8 bytes cabe ate 2^53 com seguranca
     pelo writeUInt32; os 32 bits de cima ficam zerados por decadas. */
  buffer.writeUInt32BE(Math.floor(contador / 2 ** 32), 0);
  buffer.writeUInt32BE(contador >>> 0, 4);

  const hmac = crypto.createHmac('sha1', base32Decodificar(segredoBase32)).update(buffer).digest();
  const deslocamento = hmac[hmac.length - 1] & 0x0f;
  const binario =
    ((hmac[deslocamento] & 0x7f) << 24) |
    ((hmac[deslocamento + 1] & 0xff) << 16) |
    ((hmac[deslocamento + 2] & 0xff) << 8) |
    (hmac[deslocamento + 3] & 0xff);
  return String(binario % 10 ** digitos).padStart(digitos, '0');
}

/**
 * Confere um codigo digitado, aceitando a janela vizinha.
 *
 * A folga de uma janela para cada lado (±30s) cobre o relogio do celular um
 * pouco adiantado ou atrasado e o segundo em que a pessoa aperta Enter bem na
 * virada. Mais que isso alargaria a porta sem necessidade.
 *
 * Comparacao em tempo constante: devolver mais rapido quando os primeiros
 * digitos batem entrega, aos poucos, qual era o codigo certo.
 */
export function conferirCodigo(segredoBase32, codigo, janela = 1, emSegundos = Date.now() / 1000) {
  const limpo = String(codigo || '').replace(/\D/g, '');
  if (limpo.length !== DIGITOS) return false;
  for (let i = -janela; i <= janela; i += 1) {
    const esperado = codigoDe(segredoBase32, emSegundos + i * PASSO);
    const a = Buffer.from(esperado);
    const b = Buffer.from(limpo);
    if (a.length === b.length && crypto.timingSafeEqual(a, b)) return true;
  }
  return false;
}

/**
 * O endereco otpauth:// que vira QR e tambem serve digitado.
 *
 * O rotulo tras o emissor e a conta ("Correia Advogados:fulano@..."), e o
 * parametro issuer repete o emissor: os apps mostram os dois, e sem o issuer o
 * mesmo email em dois sistemas vira duas linhas iguais e indistinguiveis.
 */
export function uriOtpauth({ segredo, conta, emissor = 'Correia Advogados' }) {
  const rotulo = encodeURIComponent(`${emissor}:${conta}`);
  const params = new URLSearchParams({
    secret: segredo,
    issuer: emissor,
    algorithm: 'SHA1',
    digits: String(DIGITOS),
    period: String(PASSO),
  });
  return `otpauth://totp/${rotulo}?${params.toString()}`;
}

/** O segredo em grupos de 4, para quem vai DIGITAR no app em vez de ler o QR. */
export function segredoLegivel(segredoBase32) {
  return segredoBase32.replace(/(.{4})/g, '$1 ').trim();
}
