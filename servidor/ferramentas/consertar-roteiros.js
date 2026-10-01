import { atualizar, encerrarBanco, iniciarBanco, listar } from '../nucleo/banco.js';

/**
 * Conserta o roteiro que faz o agente repetir a si mesmo.
 *
 * Rode `npm run consertar-roteiros` (simula) e depois
 * `npm run consertar-roteiros -- --aplicar`. SEMPRE COM O SISTEMA PARADO: ela
 * mexe nos arquivos de dados, e o servidor no ar sobrescreveria a correcao no
 * primeiro salvamento.
 *
 * O QUE ACONTECEU
 *
 * O escritorio relatou que a Recepcao repetia a mesma coisa a cada mensagem do
 * cliente. A primeira causa foi o modo degradado, sem chave de IA. Resolvida a
 * chave, o sintoma continuou — e conversando com o agente numa copia dos dados
 * de producao ele reenviou o template de boas-vindas no quarto turno.
 *
 * NAO ERA FALTA DE MEMORIA. O historico chega inteiro ao modelo, com o texto
 * dele proprio visivel. Sao tres frases do roteiro que se somam:
 *
 * 1. "nao pule etapas" + "Cumprimente PELO NOME" — sem saber o nome, o agente
 *    conclui que nao cumpriu a etapa 1 e refaz a etapa do zero, template
 *    junto. Toda mensagem do cliente reinicia a conversa.
 *
 * 2. A regra do nome "estranho" manda perguntar como prefere ser chamado. Na
 *    base do escritorio a maior parte das conversas veio da importacao do
 *    celular COM O TELEFONE NO LUGAR DO NOME, entao essa regra dispara quase
 *    sempre — e alimenta o laco da etapa 1.
 *
 * 3. "transfira para o agente da area" nao diz quais agentes existem. No teste
 *    ele mandou um lead de INSS para o agente de Avaliacao, que e a pesquisa
 *    de satisfacao. O cliente pedia ajuda e recebeu "de 1 a 5, que nota voce
 *    da para o nosso atendimento?".
 *
 * 4. O ASSUNTO JA DITO. A gestante que escreve "quero salario-maternidade"
 *    ouvia "qual assunto voce precisa resolver?". Perguntar o que a pessoa
 *    acabou de dizer e o jeito mais rapido de ela desistir de falar com a gente.
 *
 * 5. O DESTINO NOVO. Ganhou agente proprio para salario-maternidade (npm run
 *    agente-maternidade), e a Recepcao so conhecia "previdenciario ou
 *    trabalhista". Sem citar o agente, ela mandava a gestante para a triagem
 *    de incapacidade — que avalia pelos criterios errados e foi de onde veio o
 *    "voce nao tem direito".
 *
 * O QUE ESTA FERRAMENTA NAO FAZ
 *
 * Nao escolhe para qual agente vai cada assunto previdenciario ou trabalhista.
 * Isso e desenho do funil do escritorio, nao conserto de defeito. Ela so
 * impede a transferencia para agente de avaliacao e pos-venda, que e errada em
 * qualquer desenho (sao agentes de DEPOIS do atendimento), e liga o assunto
 * que o escritorio pediu de forma explicita: salario-maternidade.
 *
 * E pode rodar quantas vezes quiser: o que ja foi aplicado e reconhecido e
 * pulado.
 */

const APLICAR = process.argv.includes('--aplicar');

/**
 * Cada conserto aponta o MENOR trecho que identifica o lugar sem ambiguidade,
 * e e RECUSADO se a ancora nao aparecer exatamente uma vez. Prompt e texto
 * vivo: escrever no lugar errado e pior do que nao escrever.
 */
const CONSERTOS = [
  {
    agente: 'Recepcao',
    porque: 'etapa ja cumprida nao se refaz — era isso que reenviava as boas-vindas',
    de: 'ROTEIRO OBRIGATORIO, siga na ordem, nao pule etapas mesmo que o lead pergunte outra coisa antes:\n1. Cumprimente pelo nome e envie @boas-vindas.',
    para:
      'ROTEIRO OBRIGATORIO, na ordem, uma etapa por vez, mesmo que o lead pergunte outra coisa antes. ' +
      'Etapa ja cumprida NAO se refaz: olhe o historico e continue da proxima.\n' +
      '1. So na PRIMEIRA mensagem da conversa: cumprimente e envie @boas-vindas. ' +
      'Use o nome se o contexto do sistema trouxer um; se nao trouxer, cumprimente sem nome e siga assim mesmo. ' +
      'Se ja houver qualquer fala sua no historico, pule direto para a etapa 2.',
  },
  {
    agente: 'Recepcao',
    porque: 'o lead de atendimento nao pode cair na pesquisa de satisfacao',
    /* Outro conserto, mais abaixo, reescreve a MESMA frase depois deste. Quando
       ele ja rodou, o texto que este deixou nao existe mais — e sem isto a
       segunda rodada acusaria "nao achei" sobre algo que foi feito. */
    ouJaTem: ['agente de TRIAGEM da area (previdenciario, trabalhista ou salario-maternidade)'],
    de: '3. Conforme a resposta, transfira com @responsavel para o agente da area e ja envie a primeira pergunta dele, para o lead nao ficar esperando.',
    para:
      '3. Conforme a resposta, transfira com @responsavel para o agente de TRIAGEM da area (previdenciario ou trabalhista) ' +
      'e ja envie a primeira pergunta dele, para o lead nao ficar esperando. ' +
      'Nunca transfira para agente de avaliacao nem de pos-venda: eles atendem DEPOIS, e nao no comeco.',
  },
  {
    agente: 'Recepcao',
    porque: 'perguntar o nome uma vez, e nao a cada mensagem',
    de: '- Se o nome do contato estiver estranho (apelido, emoji, numero), pergunte como prefere ser chamado e use @salvarnome.',
    para:
      '- Se o nome do contato estiver estranho (apelido, emoji, numero), pergunte UMA vez como prefere ser chamado e use @salvarnome. ' +
      'Se ele nao responder o nome, siga o roteiro sem ele: nao pergunte de novo e nao deixe de avancar por causa disso.',
  },
  {
    agente: 'Recepcao',
    porque: 'quem ja disse o assunto nao e perguntado de novo — a gestante que escreve "quero salario-maternidade" ouvia "qual assunto voce precisa resolver?"',
    de: '2. Pergunte: "Qual assunto voce precisa resolver: beneficio do INSS, questao trabalhista ou outro?"',
    para:
      '2. Pergunte: "Qual assunto voce precisa resolver: beneficio do INSS, questao trabalhista ou outro?" ' +
      'Se o lead ja disse o assunto na propria mensagem, NAO pergunte: va direto para a etapa 3.',
  },
  {
    agente: 'Recepcao',
    porque: 'o salario-maternidade tem agente proprio (Triagem Salario-Maternidade) e a Recepcao precisa saber que ele existe',
    de: '(previdenciario ou trabalhista) e ja envie a primeira pergunta dele, para o lead nao ficar esperando.',
    para:
      '(previdenciario, trabalhista ou salario-maternidade) e ja envie a primeira pergunta dele, para o lead nao ficar esperando. ' +
      'Se o assunto for salario-maternidade, gravidez, gestante ou bebe, o destino e sempre @Triagem Salario-Maternidade.',
  },
];

function contar(texto, agulha) {
  let n = 0;
  let de = texto.indexOf(agulha);
  while (de >= 0) {
    n += 1;
    de = texto.indexOf(agulha, de + agulha.length);
  }
  return n;
}

async function principal() {
  await iniciarBanco();

  const workspace = listar('workspaces')[0];
  if (!workspace) {
    console.error('Nenhum workspace na base.');
    process.exit(1);
  }
  const w = workspace.id;

  console.log(`Conserto dos roteiros - ${workspace.nome}`);
  console.log(
    APLICAR
      ? 'MODO APLICAR: os prompts serao gravados.'
      : 'MODO SIMULACAO: nada sera gravado. Use --aplicar depois de conferir.',
  );

  const agentes = listar('agentes', { workspaceId: w });
  let mexidos = 0;
  let recusados = 0;

  for (const nomeAgente of [...new Set(CONSERTOS.map((c) => c.agente))]) {
    const agente = agentes.find((a) => a.nome.toLowerCase().includes(nomeAgente.toLowerCase()));
    if (!agente) {
      console.log(`\n--- ${nomeAgente} ---\n  [RECUSADO] agente nao existe nesta base.`);
      recusados += 1;
      continue;
    }

    console.log(`\n--- ${agente.nome} ---`);
    const original = String(agente.prompt || '');
    let novo = original;

    for (const conserto of CONSERTOS.filter((c) => c.agente === nomeAgente)) {
      /* Ferramenta que cresce com o tempo precisa saber o que ja fez: sem isto,
         rodar de novo reclamaria de cada conserto antigo — "nao achei", porque
         o texto que ele procurava ja foi trocado — e enterraria o aviso que
         importa no meio de ruido. */
      if ([conserto.para, ...(conserto.ouJaTem || [])].some((texto) => novo.includes(texto))) {
        console.log(`  [ja aplicado] ${conserto.porque.split(' — ')[0]}`);
        continue;
      }
      const vezes = contar(novo, conserto.de);
      if (vezes === 0) {
        console.log(`  [RECUSADO] nao achei: "${conserto.de.slice(0, 60)}..."`);
        console.log('             O prompt mudou desde que este conserto foi escrito. Corrija na tela de Agentes.');
        recusados += 1;
        continue;
      }
      if (vezes > 1) {
        console.log(`  [RECUSADO] "${conserto.de.slice(0, 40)}..." aparece ${vezes} vezes: nao da para saber qual.`);
        recusados += 1;
        continue;
      }
      novo = novo.replace(conserto.de, conserto.para);
      console.log(`  [ok] ${conserto.porque}`);
    }

    if (novo === original) {
      console.log('  nada mudou neste agente.');
      continue;
    }

    console.log(`  prompt: ${original.length} -> ${novo.length} caracteres`);
    if (APLICAR) atualizar('agentes', agente.id, { prompt: novo });
    mexidos += 1;
  }

  console.log('\n---------------------------------------------');
  console.log(`agentes consertados: ${mexidos}`);
  if (recusados) console.log(`consertos recusados (nao mexi): ${recusados}`);

  if (APLICAR) {
    await encerrarBanco();
    console.log('\nPronto. Suba o sistema de novo.');
  } else {
    console.log('\nNada foi gravado. Confira acima e rode de novo com --aplicar.');
  }
  process.exit(0);
}

principal().catch((erro) => {
  console.error('\nO conserto parou:', erro.message);
  console.error(erro.stack);
  process.exit(1);
});
