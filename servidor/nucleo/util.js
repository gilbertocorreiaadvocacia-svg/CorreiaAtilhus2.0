import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';

/** Identificador curto, ordenavel pelo tempo, facil de ler em log. */
export function novoId(prefixo = '') {
  const tempo = Date.now().toString(36);
  const acaso = crypto.randomBytes(5).toString('hex');
  return `${prefixo ? prefixo + '_' : ''}${tempo}${acaso}`;
}

export function agora() {
  return new Date().toISOString();
}

export function garantirPasta(caminho) {
  fs.mkdirSync(caminho, { recursive: true });
}

/**
 * Grava em arquivo temporario e so entao renomeia. Se a luz cair no meio da
 * escrita, o arquivo antigo continua intacto, nunca sobra um JSON pela metade.
 */
export function gravarAtomico(caminho, texto) {
  garantirPasta(path.dirname(caminho));
  const temporario = `${caminho}.${process.pid}.tmp`;
  fs.writeFileSync(temporario, texto, 'utf8');
  fs.renameSync(temporario, caminho);
}

export function lerJson(caminho, padrao) {
  try {
    const bruto = fs.readFileSync(caminho, 'utf8');
    return JSON.parse(bruto);
  } catch {
    return padrao;
  }
}

const ACENTOS = /[̀-ͯ]/g;

export function slug(texto = '') {
  return String(texto)
    .normalize('NFD')
    .replace(ACENTOS, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

/** Remove acento e caixa, usado em busca e em palavra-chave de agente. */
export function normalizar(texto = '') {
  return String(texto)
    .normalize('NFD')
    .replace(ACENTOS, '')
    .toLowerCase()
    .trim();
}

/**
 * Telefone no formato que a Meta aceita: DDI + DDD + numero, so digitos.
 * Numero brasileiro sem DDI ganha o 55 na frente.
 */
export function normalizarTelefone(entrada = '') {
  let digitos = String(entrada).replace(/\D+/g, '');
  if (!digitos) return '';
  if (digitos.length <= 11) digitos = `55${digitos}`;
  return digitos;
}

export function formatarTelefone(numero = '') {
  const d = String(numero).replace(/\D+/g, '');
  if (d.length < 12) return numero;
  const ddi = d.slice(0, 2);
  const ddd = d.slice(2, 4);
  const resto = d.slice(4);
  const meio = resto.length > 8 ? resto.slice(0, 5) : resto.slice(0, 4);
  const fim = resto.length > 8 ? resto.slice(5) : resto.slice(4);
  return `+${ddi} (${ddd}) ${meio}-${fim}`;
}

export function hashSenha(senha, salParam) {
  const sal = salParam || crypto.randomBytes(16).toString('hex');
  const derivado = crypto.scryptSync(String(senha), sal, 64).toString('hex');
  return `${sal}:${derivado}`;
}

export function conferirSenha(senha, guardado) {
  if (!guardado || !guardado.includes(':')) return false;
  const [sal] = guardado.split(':');
  const tentativa = hashSenha(senha, sal);
  const a = Buffer.from(tentativa);
  const b = Buffer.from(guardado);
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}

/** Troca {{variavel}} pelo valor correspondente, deixando em branco o que faltar. */
export function aplicarVariaveis(texto = '', valores = {}) {
  return String(texto).replace(/\{\{\s*([\w.-]+)\s*\}\}/g, (todo, chave) => {
    const valor = valores[chave] ?? valores[normalizar(chave)];
    return valor === undefined || valor === null ? '' : String(valor);
  });
}

export function minutosParaTexto(minutos) {
  if (minutos < 60) return `${minutos} min`;
  if (minutos < 60 * 24) {
    const horas = minutos / 60;
    return `${Number.isInteger(horas) ? horas : horas.toFixed(1)} h`;
  }
  const dias = minutos / (60 * 24);
  return `${Number.isInteger(dias) ? dias : dias.toFixed(1)} dias`;
}

export function clonar(valor) {
  return valor === undefined ? valor : JSON.parse(JSON.stringify(valor));
}

export function ordenarPor(lista, campo, direcao = 'asc') {
  const fator = direcao === 'desc' ? -1 : 1;
  return [...lista].sort((a, b) => {
    const x = a?.[campo];
    const y = b?.[campo];
    if (x === y) return 0;
    if (x === undefined || x === null) return 1;
    if (y === undefined || y === null) return -1;
    return x > y ? fator : -fator;
  });
}
