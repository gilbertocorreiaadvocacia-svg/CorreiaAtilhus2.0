import { achar } from '../nucleo/banco.js';

/**
 * Por onde a conversa chega: WhatsApp, Instagram ou TikTok.
 *
 * O resto do sistema foi escrito para o WhatsApp, onde a pessoa E o telefone.
 * No Direct do Instagram e na DM do TikTok nao ha telefone nenhum: a pessoa e
 * uma conta (@usuario) e um codigo que a rede da para aquela conversa. A
 * conversa desses canais nasce com `canal`, `idCanal` (o codigo, que e por
 * onde a resposta volta) e `usuarioCanal` (o @), e o telefone fica vazio ate o
 * cliente dizer qual e.
 *
 * A JANELA DE RESPOSTA e a regra que mais machuca nos canais oficiais: passado
 * o prazo desde a ultima mensagem DO CLIENTE, a rede recusa o envio. Cada
 * caminho tem o seu prazo, e a tela avisa antes de alguem escrever para o
 * vazio.
 */

export const CANAIS = {
  whatsapp: { id: 'whatsapp', nome: 'WhatsApp' },
  instagram: { id: 'instagram', nome: 'Instagram' },
  tiktok: { id: 'tiktok', nome: 'TikTok' },
};

export function canalDaConexao(conexao) {
  if (conexao?.tipo === 'instagram') return 'instagram';
  if (conexao?.tipo === 'tiktok') return 'tiktok';
  return 'whatsapp';
}

/* Horas de janela por tipo de conexao. Sem entrada, nao ha janela (QR Code e
   simulador respondem quando quiserem). */
const JANELAS = { oficial: 24, instagram: 24, tiktok: 48 };

export function horasDaJanela(conexao) {
  return JANELAS[conexao?.tipo] || null;
}

/** { horas, aberta, fechaEm } da conversa, pela conexao dela. */
export function janelaDaConversa(contato, conexao = contato ? achar('conexoes', contato.conexaoId) : null) {
  const horas = horasDaJanela(conexao);
  if (!horas) return { horas: null, aberta: true, fechaEm: null };
  const ultima = Date.parse(contato?.ultimaEntradaEm || '');
  if (!Number.isFinite(ultima)) return { horas, aberta: false, fechaEm: null };
  const fecha = ultima + horas * 3600000;
  return { horas, aberta: Date.now() < fecha, fechaEm: new Date(fecha).toISOString() };
}

/** Erro padrao de janela fechada, com o codigo que a tela reconhece. */
export function erroDeJanela(conexao) {
  const horas = horasDaJanela(conexao);
  const rede = conexao?.tipo === 'tiktok' ? 'O TikTok' : conexao?.tipo === 'instagram' ? 'O Instagram' : 'A Meta';
  return Object.assign(
    new Error(`Janela de ${horas} horas fechada. ${rede} so deixa responder ate ${horas} horas depois da ultima mensagem do cliente.`),
    { codigoWhatsapp: 'janela_fechada' },
  );
}

/**
 * Corta um texto longo em pedacos que a rede aceita, sem partir palavra.
 * O Instagram recusa texto acima de 1.000 caracteres; o TikTok, de 1.000
 * tambem. A resposta do agente as vezes passa disso.
 */
export function pedacosDeTexto(texto, limite = 1000) {
  const pedacos = [];
  let resto = String(texto || '').trim();
  while (resto.length > limite) {
    let corte = resto.lastIndexOf('\n', limite);
    if (corte < limite * 0.5) corte = resto.lastIndexOf(' ', limite);
    if (corte < limite * 0.5) corte = limite;
    pedacos.push(resto.slice(0, corte).trim());
    resto = resto.slice(corte).trim();
  }
  if (resto) pedacos.push(resto);
  return pedacos;
}
