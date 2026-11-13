import { atualizar, listar } from './banco.js';

/**
 * O agente para de dar boas-vindas depois da recepcao automatica.
 *
 * Pedido do escritorio em 13/11/2026, pela SEGUNDA vez: "tem alguns agentes que
 * esta enviando ola, duas mensagens de bem-vindo duas vezes".
 *
 * A primeira correcao (ver nucleo/boas-vindas-automaticas.js) tratou dois
 * TEMPLATES de recepcao saindo na mesma conversa, e isso ficou resolvido. Nao
 * era o caso todo. O que sobrou e outro:
 *
 *   1. a recepcao automatica sai sozinha e cumprimenta o cliente;
 *   2. o agente responde e cumprimenta DE NOVO, com o proprio texto
 *      ("Ola! Sou a Eduarda, da equipe do escritorio...").
 *
 * A segunda saudacao nao e template nenhum: e o modelo seguindo o proprio
 * roteiro, que manda se apresentar com todas as letras —
 *
 *     "Isso acontece SEMPRE [...] voce nunca pula a apresentacao"
 *
 * — enquanto o contexto so pedia para nao repetir o TEMPLATE. Entre as duas
 * instrucoes, o roteiro ganhava, e com razao: era a mais enfatica das duas.
 *
 * POR QUE UMA MIGRACAO, E NAO SO ARRUMAR O PACOTE
 *
 * Agente que ja existe guarda o PROPRIO roteiro no banco: a instalacao copia o
 * texto do pacote uma vez e nunca mais o sobrescreve (nucleo/agentes-por-
 * escritorio.js so mexe em ativo, area e pasta). Corrigir ia/pacotes/ vale para
 * escritorio novo e nao muda nada no escritorio que esta no ar hoje — que e
 * justamente onde o cliente esta recebendo dois "ola".
 *
 * O QUE ELA TOCA, E O QUE NAO TOCA
 *
 * So o roteiro que manda se apresentar SEMPRE, reconhecido pelas frases que o
 * proprio sistema escreveu. Nele, a excecao entra logo depois da frase. Roteiro
 * que a equipe escreveu com outras palavras nao casa com nenhuma e fica como
 * esta — e nesse caso quem segura a repeticao e a instrucao de contexto em
 * ia/motor.js, que vale para todo agente.
 *
 * Idempotente: a excecao carrega uma marca, e rodar de novo nao escreve duas.
 */

/* A marca que diz "esta excecao ja esta aqui". Fica dentro do proprio texto que
   o agente le, sem parecer codigo: e uma frase que faz sentido para o modelo. */
const MARCA = 'RECEPÇÃO DO ESCRITÓRIO JÁ FOI ENVIADA';

const EXCECAO = `

EXCEÇÃO ÚNICA: se o contexto desta conversa disser que a ${MARCA}, o cliente já foi cumprimentado e já sabe de que escritório é — então NÃO se apresente e NÃO cumprimente de novo. Onde você escreveria a apresentação, escreva só a passagem ou a pergunta do que ele precisa. Duas boas-vindas seguidas fazem o escritório parecer um robô travado.`;

/*
 * As frases do sistema que mandam cumprimentar sempre. Comparadas inteiras, e
 * nao por pedaco: pedaco solto ("se apresentando") apareceria no meio de um
 * roteiro que a equipe escreveu e a excecao entraria no lugar errado.
 */
const GATILHOS = [
  'Isso acontece SEMPRE, mesmo quando o assunto já veio na própria primeira mensagem do lead — você nunca pula a apresentação.',
  'Exemplo: Olá! Seja bem-vindo(a) ao nosso escritório. Faço parte da equipe do Correia Advogados Associados. Como posso ajudá-lo(a) hoje?',
];

/** Poe a excecao logo depois da frase que manda cumprimentar sempre. */
export function comExcecaoDaRecepcao(prompt) {
  if (typeof prompt !== 'string' || !prompt) return prompt;
  if (prompt.includes(MARCA)) return prompt;
  const gatilho = GATILHOS.find((frase) => prompt.includes(frase));
  if (!gatilho) return prompt;
  return prompt.replace(gatilho, gatilho + EXCECAO);
}

export function pararDeRepetirARecepcao() {
  let mudados = 0;
  for (const agente of listar('agentes')) {
    const prompt = comExcecaoDaRecepcao(agente.prompt);
    if (prompt !== agente.prompt) {
      atualizar('agentes', agente.id, { prompt });
      mudados += 1;
    }
  }
  return mudados;
}
