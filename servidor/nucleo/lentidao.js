/**
 * O que deixa o sistema lento, em numeros, para conferir de fora (/api/saude).
 *
 * Pedido do escritorio em 26/10/2026: "faca um diagnostico completo", depois
 * de um dia de "sistema esta muito lento". O medidor do event loop ja dizia
 * QUANTO o servidor tinha travado no pior momento (4 segundos), mas nao
 * QUANDO nem em que — e sem isso nao da para separar a subida, que trava uma
 * vez por implantacao, de algo que trava no meio do atendimento.
 *
 * Duas listas curtas, so com horario, duracao e o desenho da rota
 * ("GET /api/contatos/:id", nunca o endereco com o id): nada de cliente.
 */
const GUARDADOS = 15;
const pausas = [];
const requisicoesLentas = [];

function guardar(lista, item) {
  lista.push(item);
  if (lista.length > GUARDADOS) lista.shift();
}

/** Um relogio que deveria bater a cada `intervalo` ms: quando atrasa mais que `limite`, o servidor estava preso. */
export function vigiarPausas({ intervalo = 250, limite = 500 } = {}) {
  let esperado = Date.now() + intervalo;
  const relogio = setInterval(() => {
    const agora = Date.now();
    const atraso = agora - esperado;
    if (atraso >= limite) guardar(pausas, { em: new Date(agora - atraso).toISOString(), ms: atraso });
    esperado = agora + intervalo;
  }, intervalo);
  if (typeof relogio.unref === 'function') relogio.unref();
}

/** Anota a requisicao que levou 1 segundo ou mais. Rota que chama a IA demora por natureza: o nome diz qual e. */
export function anotarRequisicao(metodo, rota, ms) {
  if (ms >= 1000) guardar(requisicoesLentas, { rota: `${metodo} ${rota}`, ms: Math.round(ms), em: new Date().toISOString() });
}

export const situacaoDaLentidao = () => ({ pausasLongas: [...pausas], requisicoesLentas: [...requisicoesLentas] });
