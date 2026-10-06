import { codigoDe } from '../nucleo/doisfatores.js';

/**
 * O minimo para escrever um teste aqui.
 *
 * Nao ha framework de teste porque nao ha dependencia nenhuma no projeto, e
 * comecar a ter uma por causa da suite seria trocar a coisa que faz o sistema
 * abrir com dois cliques por conforto de quem escreve teste. O que um teste
 * precisa de verdade sao tres coisas: um cliente HTTP que guarde o cookie da
 * sessao, um jeito de afirmar, e um jeito de esperar.
 */

/*
 * O segredo de segundo fator do admin de teste.
 *
 * O segundo fator e obrigatorio, entao entrar() precisa completar o passo do
 * codigo. Em vez de desligar a trava nos testes (o que deixaria o caminho real
 * sem prova), a semente liga o admin com ESTE segredo (ver CORREIA_2FA_SEMENTE
 * em seed.js), e entrar() calcula o codigo a partir dele, como o app faria.
 * executar.js passa o mesmo valor ao servidor pelo ambiente.
 */
export const SEGREDO_2FA_TESTE = 'JBSWY3DPEHPK3PXPJBSWY3DPEHPK3PXP';

/** Cliente HTTP com sessao. Uma instancia por suite, para nao dividirem cookie. */
export function cliente(base) {
  let cookie = '';

  async function chamar(caminho, { metodo = 'GET', corpo = null, cabecalhos = {} } = {}) {
    const resposta = await fetch(`${base}${caminho}`, {
      method: metodo,
      headers: {
        ...(corpo ? { 'Content-Type': 'application/json' } : {}),
        ...(cookie ? { Cookie: cookie } : {}),
        ...cabecalhos,
      },
      body: corpo ? JSON.stringify(corpo) : undefined,
    });

    /* getSetCookie so existe do Node 19.7 em diante. O sistema declara suporte
       ao 18, e um teste que quebra na versao minima nao testa nada. */
    const definidos = resposta.headers.getSetCookie?.() ||
      [resposta.headers.get('set-cookie')].filter(Boolean);
    if (definidos.length) cookie = definidos.map((c) => c.split(';')[0]).join('; ');

    const texto = await resposta.text();
    let dados;
    try {
      dados = texto ? JSON.parse(texto) : null;
    } catch {
      dados = texto;
    }
    return { status: resposta.status, dados, texto };
  }

  /*
   * Entra completando o segundo fator.
   *
   * O admin de teste ja nasce pareado (seed.js), entao a senha certa leva ao
   * passo do codigo: calculamos o codigo do segredo conhecido e concluimos. A
   * assinatura antiga (so email/senha) continua valendo para quem chama, e um
   * segredo diferente cobre o caso de testar outra conta ja pareada.
   */
  async function entrar(email = 'admin@correia.adv.br', senha = 'correia2026', segredo = SEGREDO_2FA_TESTE) {
    const r = await chamar('/api/sessao/entrar', { metodo: 'POST', corpo: { email, senha } });
    if (r.dados?.etapa === 'codigo') {
      return chamar('/api/sessao/2fa/entrar', {
        metodo: 'POST',
        corpo: { desafio: r.dados.desafio, codigo: codigoDe(segredo) },
      });
    }
    if (r.dados?.etapa === 'adesao') {
      /* Conta ainda sem app pareado: conclui a adesao com o segredo que o
         servidor acabou de propor. */
      return chamar('/api/sessao/2fa/confirmar', {
        metodo: 'POST',
        corpo: { desafio: r.dados.desafio, codigo: codigoDe(r.dados.segredo) },
      });
    }
    return r;
  }

  return {
    get: (c, o) => chamar(c, o),
    post: (c, corpo, o) => chamar(c, { ...o, metodo: 'POST', corpo }),
    patch: (c, corpo, o) => chamar(c, { ...o, metodo: 'PATCH', corpo }),
    delete: (c, o) => chamar(c, { ...o, metodo: 'DELETE' }),
    entrar,
    /* O passo cru do login, para o teste do proprio segundo fator afirmar o que
       vem antes do codigo. */
    entrarSenha: (email = 'admin@correia.adv.br', senha = 'correia2026') =>
      chamar('/api/sessao/entrar', { metodo: 'POST', corpo: { email, senha } }),
  };
}

/**
 * Coletor de resultados de uma suite.
 *
 * `ok(titulo, condicao)` em vez de lancar excecao: um teste que para no
 * primeiro erro esconde os outros nove, e numa suite de integracao a lista
 * inteira do que passou e do que falhou e o que diz onde esta o problema.
 */
export function suite(nome) {
  const resultados = [];
  return {
    nome,
    resultados,
    ok(titulo, condicao, detalhe = '') {
      resultados.push({ titulo, passou: Boolean(condicao), detalhe });
      return Boolean(condicao);
    },
    passou: () => resultados.every((r) => r.passou),
  };
}

export const esperar = (ms) => new Promise((r) => setTimeout(r, ms));

/**
 * Espera um endereco comecar a responder.
 *
 * O servidor sobe em alguns instantes e o tempo varia com a maquina. Sem esta
 * espera, a suite falhava na primeira chamada em maquina lenta e passava em
 * maquina rapida, que e a pior especie de teste: o que reprova sem motivo.
 */
export async function esperarNoAr(url, { tentativas = 40, intervalo = 250 } = {}) {
  for (let i = 0; i < tentativas; i += 1) {
    try {
      const resposta = await fetch(url);
      if (resposta.ok) return true;
    } catch {
      /* ainda subindo */
    }
    await esperar(intervalo);
  }
  return false;
}
