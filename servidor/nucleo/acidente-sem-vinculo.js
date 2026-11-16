import { atualizar, listar } from './banco.js';

/**
 * Sem vinculo na epoca do acidente, quem decide e uma pessoa.
 *
 * Relato do escritorio em 16/11/2026: "a IA de auxilio-acidente continua o
 * atendimento ao cliente que diz que nao estava trabalhando na epoca do
 * acidente; corrija para que, tendo essa informacao, ela passe a um humano".
 *
 * O QUE ELA FAZIA
 *
 * O roteiro do agente "#02 Segurado" seguia sozinho por uma arvore inteira:
 * carteira nos 12 meses anteriores, trabalhador avulso, segurado especial
 * rural, documento da atividade, periodo de graca de 24 ou 36 meses, dez anos
 * de contribuicao. Cada galho com a sua pergunta, e no fim dela uma proposta
 * ou uma desqualificacao — decididas por um modelo.
 *
 * E a resposta "nao estava trabalhando" e exatamente a que NAO se decide por
 * arvore: as saidas existem (periodo de graca, segurado especial), mas sao
 * julgamento juridico, caso a caso, com prova. Um bot que percorre isso sozinho
 * ou promete contrato que o INSS vai negar, ou dispensa quem tinha direito.
 *
 * O QUE PASSA A FAZER
 *
 * Para na hora e passa para uma PESSOA, por @responsavel "distribuir" (rodizio
 * por carga, ver ia/mencoes.js). O conhecimento juridico nao se perde: ele sai
 * da arvore e entra no resumo da passagem, como a lista do que o advogado
 * precisa conferir.
 *
 * POR QUE UMA MIGRACAO
 *
 * Agente que ja existe guarda o PROPRIO roteiro no banco: a instalacao copia o
 * texto do pacote uma vez e nunca mais sobrescreve (ver nucleo/agentes-por-
 * escritorio.js). Corrigir ia/pacotes/ vale para escritorio novo e nao mudaria
 * nada no que esta no ar — que e onde o cliente esta sendo atendido errado.
 *
 * So troca o texto EXATO que o proprio sistema escreveu. Roteiro que a equipe
 * reescreveu nao casa e fica como esta: mexer no que um agente fala com o
 * cliente sozinho so vale nas frases cujo inicio e fim eu conheco.
 */

/* A marca de que a troca ja foi feita. Frase do proprio texto novo, nao um
   comentario escondido: ela faz sentido para quem ler o roteiro. */
const MARCA = 'PARE A ANÁLISE E PASSE PARA UMA PESSOA';

const ARVORE_ANTIGA = `NÃO TINHA: pergunte Você teve carteira assinada nos 12 meses anteriores ao [acidente/sintomas]? Teve, siga para SEQUELA OU NEXO.`;

const PASSAR_PARA_PESSOA = `NÃO ESTAVA TRABALHANDO NA ÉPOCA (não tinha carteira assinada, estava desempregado, parado, "sem trabalhar", "fora do mercado", trabalhando sem registro ou por conta): PARE A ANÁLISE E PASSE PARA UMA PESSOA. Esta é a única resposta que decide o caso sozinha, e ela NÃO é sua para decidir.

NÃO pergunte mais nada, NÃO desqualifique, NÃO fale de período de graça, NÃO fale de segurado especial, NÃO faça proposta e NÃO gere contrato. Diga ao cliente: Entendi! Esse ponto é importante e quem vai analisar é um advogado da nossa equipe, que já continua com você por aqui. E passe com @responsavel para "distribuir".

No resumo_para_proximo escreva o que a pessoa precisa conferir, porque o caso pode ser viável por caminhos que só um advogado avalia: carteira assinada nos 12 meses anteriores ao acidente; trabalhador avulso por sindicato; segurado especial (rural, pescador) e se há documento da atividade — contrato de parceria ou arrendamento, nota do produtor, declaração do sindicato rural, carteira de pescador, INCRA/ITR, escritura em nome da família; e período de graça (24 meses, ou 36 meses com 10 anos de contribuição e prova de desemprego). Diga também a data do acidente e quando ele parou de trabalhar, se já souber.`;

/*
 * Os galhos que saem junto.
 *
 * Todos pendiam do "NÃO TINHA": com a passagem na hora, nenhum deles e mais
 * alcancavel. Texto morto dentro de um roteiro nao e inofensivo — o modelo le
 * tudo, e instrucao que contradiz a de cima e a melhor forma de ele voltar a
 * fazer o que acabou de ser proibido. Cada um e casado pelo COMECO da linha,
 * ate o fim do paragrafo, para nao depender de pontuacao no meio.
 */
const GALHOS_MORTOS = [
  'NÃO TEVE nos 12 meses:',
  'TRABALHADOR RURAL OU SEGURADO ESPECIAL (bloqueio):',
  'TEM O DOCUMENTO ou consegue pegar:',
  'PERÍODO DE GRAÇA:',
  'TEM DOCUMENTOS de que parou de trabalhar:',
  'CONTRIBUIU 10 ANOS mas NÃO tem documentos:',
];

/* A linha das REGRAS que mandava "nao prossiga" em vez de passar. */
const REGRA_ANTIGA = 'sem carteira nem contribuição, NÃO prossiga), sequela e laudo.';
const REGRA_NOVA =
  'sequela e laudo. Disse que NÃO estava trabalhando na época do acidente: não é "não prossiga" — é PASSAR PARA UMA PESSOA com @responsavel "distribuir", sem mais perguntas.';

/** Tira um paragrafo inteiro que comece por `inicio`. */
function semOParagrafo(texto, inicio) {
  const i = texto.indexOf(inicio);
  if (i < 0) return texto;
  const fim = texto.indexOf('\n\n', i);
  return fim < 0 ? texto.slice(0, i).trimEnd() : texto.slice(0, i) + texto.slice(fim + 2);
}

/** O roteiro corrigido, ou o mesmo texto quando nao ha o que trocar. */
export function comPassagemParaPessoa(prompt) {
  if (typeof prompt !== 'string' || !prompt) return prompt;
  if (prompt.includes(MARCA)) return prompt;
  if (!prompt.includes(ARVORE_ANTIGA)) return prompt;

  let saida = prompt.replace(ARVORE_ANTIGA, PASSAR_PARA_PESSOA);
  for (const galho of GALHOS_MORTOS) saida = semOParagrafo(saida, galho);
  if (saida.includes(REGRA_ANTIGA)) saida = saida.replace(REGRA_ANTIGA, REGRA_NOVA);
  return saida;
}

export function passarAcidenteSemVinculoParaPessoa() {
  let mudados = 0;
  for (const agente of listar('agentes')) {
    const prompt = comPassagemParaPessoa(agente.prompt);
    if (prompt !== agente.prompt) {
      atualizar('agentes', agente.id, { prompt });
      mudados += 1;
    }
  }
  return mudados;
}
