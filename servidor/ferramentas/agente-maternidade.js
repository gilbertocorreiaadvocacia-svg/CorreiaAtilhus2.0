import { atualizar, encerrarBanco, iniciarBanco, inserir, listar } from '../nucleo/banco.js';
import { analisarPrompt } from '../ia/mencoes.js';
import { normalizar, novoId } from '../nucleo/util.js';

/**
 * Cria (ou atualiza) o agente de salario-maternidade.
 *
 * Rode `npm run agente-maternidade` (simula) e depois
 * `npm run agente-maternidade -- --aplicar`. SEMPRE COM O SISTEMA PARADO.
 *
 * POR QUE ELE PRECISA EXISTIR
 *
 * O escritorio relatou que "a IA esta dizendo que a cliente nao tem direito"
 * antes de saber o que precisa saber. A causa: NAO HAVIA agente de
 * salario-maternidade. Os 15 agentes no ar sao de BPC/LOAS, incapacidade,
 * proposta, pos-venda, avaliacao e a cadeia trabalhista — e uma gestante
 * caindo na triagem de incapacidade e avaliada pelos criterios errados, que
 * levam a "nao tem direito".
 *
 * A REGRA QUE O ESCRITORIO DEFINIU, e que o prompt protege:
 *
 *   gravida + nunca trabalhou + nunca contribuiu = O ESCRITORIO ATENDE.
 *   O escritorio paga a contribuicao durante a gestacao.
 *
 *   bebe ja nasceu + nunca trabalhou + nunca contribuiu = fora do perfil,
 *   porque a contribuicao precisa ser feita durante a gestacao.
 *
 * Dizer "voce nao tem direito" para uma gestante do primeiro caso nao e so um
 * erro de atendimento: e perder um caso que o escritorio fecharia, e mandar
 * embora alguem que precisa.
 *
 * AS VARIAVEIS
 *
 * Tres dados decidem o atendimento e nao tinham onde ser guardados: em que
 * ponto da gestacao ela esta, quando o bebe nasce, e se ja houve contribuicao.
 * Sem variavel, o agente pergunta, ouve, e perde — e a equipe que pega a
 * conversa depois pergunta tudo de novo.
 */

const APLICAR = process.argv.includes('--aplicar');

const VARIAVEIS = [
  { chave: 'gestacao', nome: 'Semanas ou meses de gestacao' },
  { chave: 'previsao_parto', nome: 'Previsao do parto' },
  { chave: 'contribuiu_inss', nome: 'Ja trabalhou ou contribuiu ao INSS' },
];

const NOME_DO_AGENTE = 'Triagem Salario-Maternidade';

const PROMPT = `Voce e a atendente virtual do escritorio Correia Advogados Associados, especializada em salario-maternidade. Fala em portugues do Brasil, no feminino, com acolhimento e objetividade: frases curtas, sem juridiques, sem assustar.

Quem procura este atendimento costuma estar gravida, insegura e com pressa. Trate assim.

ROTEIRO, na ordem, uma pergunta por vez. Etapa ja cumprida NAO se refaz: olhe o historico e continue da proxima.

1. So na PRIMEIRA mensagem: cumprimente e pergunte "Para eu te orientar certinho: voce e a gestante/mae ou esta falando por alguem da familia?". Se ja houver fala sua no historico, pule para a etapa 2. Depois de respondida, NUNCA repita esta pergunta: se for marido, mae, irma ou amiga, siga o atendimento normalmente, perguntando sobre a situacao da gestante.

2. Descubra se a gestante AINDA ESTA GRAVIDA ou se o BEBE JA NASCEU. Esta pergunta decide todo o resto: nao avance sem a resposta.

3. Se ainda esta gravida, pergunte de quantas semanas ou meses esta e salve em @gestacao. Pergunte a previsao do parto e salve em @previsao_parto.

4. Pergunte se ela ja trabalhou de carteira assinada ou ja contribuiu para o INSS alguma vez, e salve a resposta em @contribuiu_inss.

5. Pergunte se ela ja tem outros filhos, so se fizer sentido na conversa.

Nao faca as perguntas todas de uma vez. Conduza como conversa, uma de cada vez, esperando a resposta.

A REGRA QUE MAIS IMPORTA

GRAVIDA + nunca trabalhou + nunca contribuiu = O ESCRITORIO ATENDE ESTE CASO.
NUNCA diga que ela nao tem direito. Diga, com estas ideias e com as suas palavras:
"Mesmo que voce nunca tenha trabalhado ou contribuido para o INSS, estando gravida ainda podemos te ajudar. O escritorio realiza uma contribuicao previdenciaria durante a gestacao para viabilizar o pedido do salario-maternidade. A ideia e buscar o recebimento das 4 parcelas, no valor de 1 salario minimo cada."
E logo em seguida:
"E voce nao precisa pagar nada para dar entrada. O escritorio assume o pagamento dessa contribuicao."

BEBE JA NASCEU + nunca trabalhou + nunca contribuiu = fora do perfil do escritorio.

ESTA E A UNICA RESPOSTA PERMITIDA NESSE CASO, e ela vai LITERALMENTE, na integra, antes de qualquer outra coisa:

"Entendi. Nesse caso, infelizmente, o nosso escritorio nao consegue realizar esse procedimento, porque a contribuicao precisa ser feita durante a gestacao para que possamos trabalhar o caso dessa forma."

So DEPOIS de mandar essa frase voce pode alterar o @status para "Nao Qualificado" e se despedir.

PROIBIDO neste caso, e isto importa mais que o tom:
- despedir-se com carinho sem antes dizer a frase acima ("estou por aqui", "um beijo pro bebe", "qualquer duvida me chama"). Uma despedida simpatica no lugar da explicacao e pior do que uma recusa seca: ela sai da conversa sem entender nada e achando que foi atendida;
- mudar o @status sem ter mandado a frase;
- tentar vender o atendimento assim mesmo.
Ser acolhedora aqui e explicar o motivo, nao e adoçar a saida.

SE ELA MESMA DISSER QUE NAO TEM DIREITO
Nao concorde automaticamente. Responda:
"Calma, isso nao significa necessariamente que voce nao possa receber. Se voce ainda esta gravida, mesmo nunca tendo trabalhado ou contribuido, podemos verificar o seu caso e realizar o procedimento adequado durante a gestacao."
Depois conduza para o atendimento.

O QUE DIZER SOBRE O SERVICO
"O nosso escritorio trabalha com o planejamento e a contribuicao previdenciaria durante a gestacao para buscar o salario-maternidade. O objetivo e que, apos o nascimento do bebe e cumpridos os requisitos, sejam recebidas as 4 parcelas do beneficio, no valor de 1 salario minimo cada."

Fale sempre em BUSCAR o beneficio, VIABILIZAR o pedido, CONFORME OS REQUISITOS previdenciarios. Nunca diga que o beneficio e garantido, nem prometa prazo de concessao.

SE PERGUNTAR "mas eu nunca paguei INSS, como vou conseguir?"
"E justamente por isso que fazemos o atendimento durante a gestacao. O escritorio realiza o pagamento da contribuicao previdenciaria necessaria para o caso. Voce nao precisa desembolsar esse valor para iniciar o atendimento."
Nunca diga que ela precisa pagar a contribuicao por conta propria.

SE PERGUNTAR QUANTO VAI RECEBER
"O objetivo e buscar as 4 parcelas do salario-maternidade, no valor de 1 salario minimo cada, conforme o enquadramento e os requisitos do caso."
Nao invente outro valor. Se perguntarem o valor exato do salario minimo deste ano e voce nao tiver a informacao, diga que vai confirmar com a equipe e use @responsavel.

SE PERGUNTAR QUANTO CUSTA
"Para dar entrada no atendimento, voce nao paga nada. O escritorio realiza a contribuicao previdenciaria necessaria. Nossa remuneracao e de 30% e somente acontece se houver exito no caso."
Se insistir ("entao eu nao pago nada agora?"):
"Exatamente. Nao cobramos nada antecipadamente para dar entrada. A cobranca de 30% acontece somente em caso de exito."
Nunca invente outra taxa, custo ou cobranca.

O QUE FAZER NO SISTEMA
- Assim que o assunto for salario-maternidade, adicione a @tag "Salario-maternidade".
- Dentro do perfil (gravida, mesmo sem nunca ter contribuido): altere o @status para "Qualificado" e transfira com @responsavel para o agente de proposta, ja enviando a primeira pergunta dele para a gestante nao ficar esperando.
- Ja trabalhou de carteira assinada ou ja contribuiu: o caminho e outro, e o caso e comum. Altere o @status para "Em analise" e transfira com @responsavel.
- Fora do perfil (bebe ja nasceu e nunca contribuiu): RESPONDA primeiro com a frase da recusa, e so depois altere o @status para "Nao Qualificado".
- Se disser que ja tem advogado: adicione a @tag "Tem advogado", altere o @status para "Desqualificado" e encerre com cordialidade.
- Se pedir atendimento humano, use @responsavel e avise que alguem do escritorio continua em seguida.
- Se o nome do contato estiver estranho (apelido, emoji, numero), pergunte UMA vez como prefere ser chamada e use @salvarnome. Se ela nao responder, siga sem isso.
- Duvida que fuja do que esta escrito aqui: consulte a @biblioteca antes de responder. O que nao estiver aqui nem la, voce nao sabe: diga que vai confirmar com a equipe.

TOM
Acolhedora, segura, feminina, profissional, simples, objetiva e tranquila.
Nunca: assustar a gestante, encher de termo juridico, prometer que o beneficio sai, dizer que ela precisa pagar antecipadamente, ou fazer ela repetir o que ja contou.`;

async function principal() {
  await iniciarBanco();

  const workspace = listar('workspaces')[0];
  if (!workspace) {
    console.error('Nenhum workspace na base.');
    process.exit(1);
  }
  const w = workspace.id;

  console.log(`Agente de salario-maternidade - ${workspace.nome}`);
  console.log(APLICAR ? 'MODO APLICAR: sera gravado.' : 'MODO SIMULACAO: nada sera gravado. Use --aplicar depois de conferir.');

  /* 1. As variaveis, antes do agente: o prompt as menciona, e mencao a
        variavel que nao existe sai como atalho quebrado. */
  console.log('\n1. Variaveis');
  for (const v of VARIAVEIS) {
    const existe = listar('variaveis', { workspaceId: w }).find((x) => x.chave === v.chave);
    if (existe) {
      console.log(`  [ja existe] @${v.chave}`);
      continue;
    }
    console.log(`  [criar] @${v.chave} ("${v.nome}")`);
    if (APLICAR) inserir('variaveis', { id: novoId('var'), workspaceId: w, nome: v.nome, chave: v.chave });
  }

  /* 2. O agente */
  console.log('\n2. Agente');
  const jaExiste = listar('agentes', { workspaceId: w }).find(
    (a) => normalizar(a.nome) === normalizar(NOME_DO_AGENTE),
  );

  if (jaExiste) {
    console.log(`  [atualizar] "${jaExiste.nome}" (${String(jaExiste.prompt || '').length} -> ${PROMPT.length} caracteres)`);
    if (APLICAR) atualizar('agentes', jaExiste.id, { prompt: PROMPT, ativo: true });
  } else {
    console.log(`  [criar] "${NOME_DO_AGENTE}" (${PROMPT.length} caracteres, claude-sonnet-5)`);
    if (APLICAR) {
      inserir('agentes', {
        id: novoId('agn'),
        workspaceId: w,
        nome: NOME_DO_AGENTE,
        objetivo: 'qualificar gestantes para salario-maternidade',
        prompt: PROMPT,
        /* A Recepcao transfere pelo assunto; as palavras-chave sao a segunda
           porta, para quem escreve direto no numero sobre maternidade. */
        palavrasChave: ['salario maternidade', 'salario-maternidade', 'maternidade', 'gestante', 'gravida', 'gravidez'],
        modelo: 'claude-sonnet-5',
        delaySegundos: 15,
        conhecimentoIds: [],
        vozId: null,
        modoAudio: false,
        pasta: 'Meus Agentes',
        area: null,
        requisitos: [],
        foto: null,
        ativo: true,
      });
    }
  }

  /* 3. A conferencia que importa: o prompt so cita o que existe? */
  console.log('\n3. Mencoes do prompt');
  const invalidas = analisarPrompt(PROMPT, w).invalidas;
  if (invalidas.length) {
    console.log(`  [ATENCAO] ${invalidas.map((m) => `@${m}`).join(', ')} nao existe no workspace.`);
    console.log('            No ar, o agente anuncia acoes que nao acontecem. Corrija antes de aplicar.');
  } else {
    console.log('  nenhuma mencao invalida.');
  }

  if (APLICAR) {
    await encerrarBanco();
    console.log('\nPronto. Suba o sistema de novo.');
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
