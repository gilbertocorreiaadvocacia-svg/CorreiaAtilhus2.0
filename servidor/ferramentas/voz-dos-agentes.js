import { atualizar, encerrarBanco, iniciarBanco, inserir, listar } from '../nucleo/banco.js';
import { normalizar, novoId } from '../nucleo/util.js';

/**
 * Poe a voz para funcionar nos agentes: `npm run voz-dos-agentes` simula, e
 * `-- --aplicar` grava. COM O SISTEMA PARADO.
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

const REGRA_COMPLETA = `CANAL DE VOZ: se o cliente disser que não sabe ler, que não consegue ler mensagens ou que tem dificuldade para ler, use @ativaraudio e passe a falar com frases curtas e palavras simples; se pedir para voltar a escrever, use @desativaraudio. Não ofereça nem incentive áudio a quem escreve normalmente.`;
const REGRA_VOLTAR = `Se o cliente pedir para voltar ao texto, use @desativaraudio.`;

const VOZES_PADRAO = [
  { nome: 'Acolhedora', descricao: 'Feminina, suave e um pouco mais devagar. Para quem escuta com mais atencao.', vozBase: 'shimmer', velocidade: 0.95 },
  { nome: 'Clara', descricao: 'Feminina, jovem e clara.', vozBase: 'nova', velocidade: 1 },
];

const ehAvaliacao = (a) => normalizar(a.nome).startsWith('avaliacao');

async function principal() {
  await iniciarBanco();
  const workspace = listar('workspaces')[0];
  if (!workspace) {
    console.error('Nenhum workspace na base.');
    process.exit(1);
  }
  const w = workspace.id;
  console.log(`Voz dos agentes - ${workspace.nome}`);
  console.log(APLICAR ? 'MODO APLICAR: sera gravado.' : 'MODO SIMULACAO: nada sera gravado. Use --aplicar depois de conferir.');

  /* 1. Vozes ----------------------------------------------------------- */
  console.log('\n1. Vozes cadastradas');
  let vozes = listar('vozes', { workspaceId: w });
  let criadas = 0;
  if (vozes.length) {
    console.log(`  o escritorio ja tem ${vozes.length} voz(es) (${vozes.map((v) => v.nome).join(', ')}): nao cadastro nenhuma.`);
  } else {
    for (const v of VOZES_PADRAO) {
      console.log(`  [${APLICAR ? 'feito' : 'simulado'}] cadastrar "${v.nome}" (${v.vozBase}, velocidade ${v.velocidade})`);
      if (APLICAR) inserir('vozes', { id: novoId('voz'), workspaceId: w, ...v });
      criadas += 1;
    }
    vozes = listar('vozes', { workspaceId: w });
  }
  const padrao = vozes.find((v) => normalizar(v.nome) === 'acolhedora') || vozes[0] || null;

  /* 2 e 3. Agentes ----------------------------------------------------- */
  console.log('\n2. Voz e regra de voz nos agentes que atendem cliente');
  let comVoz = 0;
  let comRegra = 0;
  for (const agente of listar('agentes', { workspaceId: w })) {
    if (agente.ativo === false || ehAvaliacao(agente)) continue;
    const mudancas = {};
    const acoes = [];

    if (!agente.vozId && (padrao || !APLICAR)) {
      acoes.push(`voz ${padrao?.nome || 'Acolhedora'}`);
      if (padrao) mudancas.vozId = padrao.id;
      comVoz += 1;
    }

    const prompt = String(agente.prompt || '');
    const temLigar = /@ativaraudio/i.test(prompt);
    const temDesligar = /@desativaraudio/i.test(prompt);
    if (!temLigar) {
      mudancas.prompt = `${prompt.trimEnd()}\n\n${REGRA_COMPLETA}`;
      acoes.push('regra de voz');
      comRegra += 1;
    } else if (!temDesligar) {
      mudancas.prompt = `${prompt.trimEnd()}\n\n${REGRA_VOLTAR}`;
      acoes.push('regra de voltar ao texto');
      comRegra += 1;
    }

    if (!acoes.length) continue;
    console.log(`  [${APLICAR ? 'feito' : 'simulado'}] ${agente.nome}: ${acoes.join(' + ')}`);
    if (APLICAR && Object.keys(mudancas).length) atualizar('agentes', agente.id, mudancas);
  }
  if (!comVoz && !comRegra) console.log('  nenhum agente precisa de ajuste: ja estava feito.');

  console.log('\n---------------------------------------------');
  console.log(`vozes cadastradas: ${criadas} | agentes com voz escolhida: ${comVoz} | prompts com regra acrescentada: ${comRegra}`);
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
