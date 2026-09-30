import { atualizar, encerrarBanco, iniciarBanco, listar } from '../nucleo/banco.js';
import { analisarPrompt } from '../ia/mencoes.js';

/**
 * Conserta os atalhos quebrados nos prompts dos agentes.
 *
 * Rode `npm run consertar-mencoes` (simula) e depois
 * `npm run consertar-mencoes -- --aplicar`. SEMPRE COM O SISTEMA PARADO: ela
 * mexe nos arquivos de dados, e o servidor no ar sobrescreveria a correcao no
 * primeiro salvamento.
 *
 * O QUE ACONTECEU
 *
 * Cinco agentes citavam @bemvindo, @videoproposta, @contratoassinado e
 * @documentos. Os templates foram apagados, o sistema limpou tudo o que
 * apontava para eles e deixou os prompts intactos. Dali em diante a ferramenta
 * nem chegava a ser oferecida ao modelo: ele seguia a instrucao no vazio e, o
 * que e pior, costumava ANUNCIAR que tinha enviado. "Ja te mandei o video", e
 * nada saiu.
 *
 * COMO CADA UM FOI RESOLVIDO, E POR QUE
 *
 * @bemvindo -> @boas-vindas. E o mesmo template, renomeado: "Ola! Seja muito
 * bem-vindo(a)! Assista ao nosso video de boas-vindas." Aqui nao se perde
 * nada, so se reaponta.
 *
 * Os outros quatro nao tem equivalente. Existem @propostatrabalhista e
 * @propostaauxacidente, mas nenhum serve para BPC/LOAS nem para incapacidade
 * em geral — mandar a proposta de auxilio-acidente para quem pede
 * auxilio-doenca seria trocar um defeito silencioso por um defeito barulhento.
 *
 * Entao a mencao SAI e a frase e refeita para o agente fazer a mesma coisa com
 * as palavras dele, ou para nao prometer o que nao pode cumprir:
 *
 *   - Nas duas triagens, o envio do video sai e a transferencia fica. Quem
 *     apresenta a proposta e o agente de proposta, que recebe a conversa na
 *     linha seguinte: a etapa nao se perde, ela volta para o dono dela.
 *   - No fechamento, o agente confirma a assinatura com uma frase propria em
 *     vez de disparar um template que nao existe. O cliente continua recebendo
 *     a confirmacao.
 *   - No pos-venda, o agente para de prometer o envio de documentos que ele
 *     nao tem, e passa a avisar o responsavel. Prometer e nao cumprir custa
 *     mais caro do que dizer que vai verificar.
 *
 * NAO INVENTEI TEXTO DE TEMPLATE. Mensagem de proposta e de contrato e a voz
 * do escritorio falando com o cliente sobre dinheiro e prazo; recriar esses
 * templates e decisao de quem responde por eles. Se o escritorio preferir ter
 * os templates de volta, e so cria-los com estes atalhos e reverter a
 * mudanca — a frase original fica anotada aqui embaixo.
 */

const APLICAR = process.argv.includes('--aplicar');

/**
 * Cada conserto aponta o MENOR trecho que identifica o lugar sem ambiguidade.
 *
 * Trecho curto e proposital: o prompt e texto vivo, alguem pode ter ajustado
 * uma virgula desde que este arquivo foi escrito, e uma ancora longa falharia
 * por causa da virgula. O que nao pode e adivinhar: se a ancora nao aparecer
 * exatamente uma vez, o conserto e recusado e reclama, em vez de escrever no
 * lugar errado.
 */
const CONSERTOS = [
  {
    porque: 'o template existe, so foi renomeado',
    de: '@bemvindo',
    para: '@boas-vindas',
  },
  {
    porque: 'nao ha video de proposta; quem apresenta a proposta e o agente de proposta, na linha seguinte',
    de: ', envie @videoproposta e transfira',
    para: ' e transfira',
  },
  {
    porque: 'o agente confirma a assinatura com as palavras dele, em vez de um template que nao existe',
    de: 'envie @contratoassinado, altere',
    para: 'avise o cliente, em uma frase sua, que o contrato esta assinado, altere',
  },
  {
    porque: 'o agente nao tem esse material: em vez de prometer o envio, avisa o responsavel',
    de: 'Se pedir documentos, envie @documentos.',
    para: 'Se pedir documentos, nao prometa envio: diga que vai pedir a copia para a equipe e use @notificar para avisar o responsavel.',
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

  console.log(`Conserto dos atalhos - ${workspace.nome}`);
  console.log(
    APLICAR
      ? 'MODO APLICAR: os prompts serao gravados.'
      : 'MODO SIMULACAO: nada sera gravado. Use --aplicar depois de conferir.',
  );

  let mexidos = 0;
  let recusados = 0;

  for (const agente of listar('agentes', { workspaceId: w })) {
    const original = String(agente.prompt || '');
    const quebradasAntes = analisarPrompt(original, w).invalidas;
    if (!quebradasAntes.length) continue;

    console.log(`\n--- ${agente.nome} ---`);
    console.log(`  quebradas: ${quebradasAntes.map((m) => `@${m}`).join(', ')}`);

    let novo = original;
    for (const conserto of CONSERTOS) {
      /* So mexe no que este agente realmente cita: a ancora do @documentos nao
         tem o que fazer no prompt da triagem. */
      const vezes = contar(novo, conserto.de);
      if (vezes === 0) continue;
      if (vezes > 1) {
        console.log(`  [RECUSADO] "${conserto.de}" aparece ${vezes} vezes: nao da para saber qual. Corrija na tela.`);
        recusados += 1;
        continue;
      }
      novo = novo.replace(conserto.de, conserto.para);
      console.log(`  [ok] ${conserto.porque}`);
      console.log(`       de:   ...${conserto.de}...`);
      console.log(`       para: ...${conserto.para}...`);
    }

    if (novo === original) {
      console.log('  [RECUSADO] nenhuma ancora conferiu. O prompt mudou desde que este conserto foi escrito.');
      console.log('             Corrija na tela de Agentes, ou me diga o texto atual.');
      recusados += 1;
      continue;
    }

    const quebradasDepois = analisarPrompt(novo, w).invalidas;
    console.log(
      `  sobram: ${quebradasDepois.length ? quebradasDepois.map((m) => `@${m}`).join(', ') : 'nenhuma'}`,
    );

    if (APLICAR) atualizar('agentes', agente.id, { prompt: novo });
    mexidos += 1;
  }

  console.log('\n---------------------------------------------');
  console.log(`agentes consertados: ${mexidos}`);
  if (recusados) console.log(`recusados (nao mexi): ${recusados}`);

  /* A conferencia final le a base de novo: e a mesma pergunta que o Painel de
     Saude faz, feita pelo mesmo codigo. */
  const aindaQuebrados = listar('agentes', { workspaceId: w })
    .filter((a) => a.ativo !== false)
    .map((a) => ({ nome: a.nome, invalidas: analisarPrompt(a.prompt || '', w).invalidas }))
    .filter((a) => a.invalidas.length);

  if (APLICAR) {
    console.log(
      aindaQuebrados.length
        ? `\nAINDA QUEBRADOS: ${aindaQuebrados.map((a) => `${a.nome} (${a.invalidas.join(', ')})`).join('; ')}`
        : '\nNenhum agente no ar cita atalho inexistente.',
    );
    await encerrarBanco();
    console.log('Pronto. Suba o sistema de novo.');
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
