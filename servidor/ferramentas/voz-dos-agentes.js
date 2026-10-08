import { encerrarBanco, iniciarBanco, listar } from '../nucleo/banco.js';
import { processarVozes } from '../nucleo/vozes-dos-agentes.js';

/**
 * Poe a voz para funcionar nos agentes: `npm run voz-dos-agentes` simula, e
 * `-- --aplicar` grava. COM O SISTEMA PARADO.
 *
 * Desde 08/10/2026 o mesmo ajuste (processarVozes, em nucleo/vozes-dos-
 * agentes.js) tambem roda sozinho a cada vez que o servidor sobe (ver
 * servidor/index.js) — um "Implantar" comum ja basta, sem precisar de
 * terminal na VPS. Esta ferramenta continua util para conferir antes
 * (simulacao) ou para forcar fora do boot.
 *
 * O QUE JA EXISTIA
 *
 * O sistema ja fala: o motor gera o audio da resposta quando a conversa esta
 * com o modo audio ligado, a tela de Vozes tem o botao Ouvir, e a mencao
 * @ativaraudio liga o modo na conversa. O que faltava era configuracao:
 * nenhuma voz cadastrada, nenhum agente com voz escolhida, e so os oito
 * trabalhistas sabiam ligar o audio. Os agentes que recebem o cliente na
 * porta (Recepcao, triagens, proposta, pos-venda) nao tinham a regra, entao
 * quem diz "nao sei ler" ouvia a mesma resposta escrita.
 *
 * O QUE ELA FAZ
 *
 * 1. Cadastra duas vozes, se o escritorio nao tem nenhuma: "Acolhedora"
 *    (shimmer, um pouco mais devagar, para quem escuta com dificuldade) e
 *    "Clara" (nova). Quem ja cadastrou voz propria nao recebe nada.
 * 2. Escolhe a Acolhedora para todo agente que atende cliente e ainda nao tem
 *    voz. Agente com voz escolhida nao muda.
 * 3. Acrescenta ao fim do prompt do agente que atende cliente a regra do
 *    CANAL DE VOZ: quando o cliente disser que nao sabe ler (ou tiver
 *    dificuldade), liga o audio e passa a falar em frases curtas; quando
 *    pedir texto, desliga. So onde a regra ainda nao esta: prompt que ja cita
 *    @ativaraudio e @desativaraudio nao e tocado.
 *
 * Agentes de Avaliacao (a pesquisa de satisfacao) ficam de fora: nao e
 * atendimento, e falar a nota em audio so custaria dinheiro.
 *
 * O audio SO SAI com a chave da OpenAI cadastrada em Integracoes. Sem ela, o
 * agente que ligar o modo audio continua respondendo em texto, sem erro.
 *
 * Idempotente: rodar de novo nao duplica voz nem regra.
 */

const APLICAR = process.argv.includes('--aplicar');

async function principal() {
  await iniciarBanco();
  const workspaces = listar('workspaces');
  if (!workspaces.length) {
    console.error('Nenhum workspace na base.');
    process.exit(1);
  }
  console.log(APLICAR ? 'MODO APLICAR: sera gravado.' : 'MODO SIMULACAO: nada sera gravado. Use --aplicar depois de conferir.');

  /* Cada workspace e um escritorio a parte, com as proprias vozes e os
     proprios agentes (ver nucleo/banco.js: tudo escopado por workspaceId).
     A versao antiga so olhava listar('workspaces')[0] — o workspace geral,
     quase sem agente de atendimento — e nunca chegava nos agentes reais de
     Previdenciario, Trabalhista e Civel, cada um no seu proprio workspace. */
  const { totalCriadas, totalComVoz, totalComRegra } = processarVozes({ aplicar: APLICAR, log: console.log });

  console.log('\n---------------------------------------------');
  console.log(`vozes cadastradas: ${totalCriadas} | agentes com voz escolhida: ${totalComVoz} | prompts com regra acrescentada: ${totalComRegra}`);
  if (APLICAR) {
    await encerrarBanco();
    console.log('\nPronto. Suba o sistema de novo. Falta cadastrar a chave da OpenAI em Integracoes para o audio sair.');
  } else {
    console.log('\nNada foi gravado. Confira acima e rode de novo com --aplicar.');
  }
  process.exit(0);
}

principal().catch((erro) => {
  console.error('\nParou:', erro.message);
  console.error(erro.stack);
  process.exit(1);
});
