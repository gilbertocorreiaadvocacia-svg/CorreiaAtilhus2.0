import { atualizar, encerrarBanco, iniciarBanco, listar, remover } from '../nucleo/banco.js';
import { analisarPrompt } from '../ia/mencoes.js';

/**
 * Reorganiza os agentes ja instalados para acompanhar os pacotes
 * (servidor/ia/pacotes/*.js), depois do ajuste de nomes de 07/10/2026.
 *
 * Rode `npm run reorganizar-agentes` (simula) e depois
 * `npm run reorganizar-agentes -- --aplicar`. SEMPRE COM O SISTEMA PARADO: ela
 * mexe nos arquivos de dados, e o servidor no ar sobrescreveria a correcao no
 * primeiro salvamento.
 *
 * O QUE MUDOU, E POR QUE
 *
 * - "#01 Triagem [aux acidente]" vira "Beatriz (Triagem)": o prompt dela ja diz
 *   "seu nome e Beatriz" para o cliente, so o nome administrativo nao mostrava
 *   isso (igual ja acontece com a Eduarda e a Andreia). So destrava o que ja
 *   existia, nao inventa persona nova.
 * - Os oito agentes do Trabalhista (AG01 a AG08) perdem o prefixo "AG0N
 *   [trab]": a pasta deles ja diz "Trabalhista", o prefixo so repetia a
 *   informacao. Nenhum deles tem persona no prompt (ao contrario do
 *   Previdenciario), entao o nome novo e so o papel na etapa.
 * - A pasta "Agentes Trabalhista + Auxilio acidente" vira "Trabalhista": nao
 *   ha nenhum agente de Auxilio-Acidente nela de verdade, o nome vinha errado.
 * - "Agente 26" (desligado, sem pasta) sai: e um rascunho de teste, sem
 *   conteudo, que ficou para tras em mais de um escritorio.
 *
 * O nome do agente e a chave que os prompts usam para passar a conversa de um
 * para o outro (@responsavel para @Nome). Por isso cada renome aqui tambem
 * troca "@NomeAntigo" por "@NomeNovo" em TODOS os prompts do mesmo escritorio
 * — sem isso a passagem de bastao quebraria silenciosamente.
 */

const APLICAR = process.argv.includes('--aplicar');

const RENOMES = [
  { de: '#01 Triagem [aux acidente]', para: 'Beatriz (Triagem)' },
  { de: 'AG01 [trab] Triagem', para: 'Triagem Trabalhista' },
  { de: 'AG02 [trab] Acidente e Doenças', para: 'Acidente e Doenças' },
  { de: 'AG03 [trab] Vínculo', para: 'Vínculo' },
  { de: 'AG04 [trab] Rescisão Indireta', para: 'Rescisão Indireta' },
  { de: 'AG05 [trab] Direito Suprimido', para: 'Direito Suprimido' },
  { de: 'AG06 [trab] Proposta e Objeções', para: 'Proposta e Objeções' },
  { de: 'AG07 [trab] Dados e Contrato', para: 'Dados e Contrato' },
  { de: 'AG08 [trab] Assinatura e Reunião', para: 'Assinatura e Reunião' },
];

const PASTA_DE = 'Agentes Trabalhista + Auxilio acidente';
const PASTA_PARA = 'Trabalhista';

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

  console.log(
    APLICAR
      ? 'MODO APLICAR: os dados serao gravados.'
      : 'MODO SIMULACAO: nada sera gravado. Use --aplicar depois de conferir.',
  );

  let renomeados = 0;
  let referenciasTrocadas = 0;
  let pastasCorrigidas = 0;

  for (const workspace of listar('workspaces')) {
    const agentes = listar('agentes', { workspaceId: workspace.id });
    if (!agentes.length) continue;

    const renomesDesteWorkspace = RENOMES.filter((r) => agentes.some((a) => a.nome === r.de));
    const pastaAqui = agentes.some((a) => a.pasta === PASTA_DE);
    if (!renomesDesteWorkspace.length && !pastaAqui) continue;

    console.log(`\n--- ${workspace.nome} ---`);

    for (const { de, para } of renomesDesteWorkspace) {
      const agente = agentes.find((a) => a.nome === de);
      console.log(`  [renomeia] "${de}" -> "${para}"`);
      if (APLICAR) atualizar('agentes', agente.id, { nome: para });
      renomeados += 1;
    }

    /* As referencias (@NomeAntigo) podem estar no prompt de QUALQUER agente
       deste escritorio, inclusive o que acabou de ser renomeado (auto-bounce) —
       por isso a troca roda sobre todos, depois dos renomes decididos acima. */
    for (const agente of agentes) {
      const original = String(agente.prompt || '');
      let novo = original;
      for (const { de, para } of RENOMES) {
        const vezes = contar(novo, `@${de}`);
        if (!vezes) continue;
        novo = novo.split(`@${de}`).join(`@${para}`);
        referenciasTrocadas += vezes;
      }
      if (novo !== original) {
        console.log(`  [prompt] ${agente.nome}: referencias atualizadas`);
        if (APLICAR) atualizar('agentes', agente.id, { prompt: novo });
      }
    }

    if (pastaAqui) {
      for (const agente of agentes.filter((a) => a.pasta === PASTA_DE)) {
        console.log(`  [pasta] ${agente.nome}: "${PASTA_DE}" -> "${PASTA_PARA}"`);
        if (APLICAR) atualizar('agentes', agente.id, { pasta: PASTA_PARA });
        pastasCorrigidas += 1;
      }
    }
  }

  /* Agente 26: sobra de teste, desligada e sem pasta, em mais de um escritorio. */
  const sobras = listar('agentes').filter((a) => a.nome === 'Agente 26' && a.ativo === false && a.pasta === 'Sem pasta');
  for (const agente of sobras) {
    const workspace = listar('workspaces').find((w) => w.id === agente.workspaceId);
    console.log(`\n[remove] "Agente 26" (${workspace?.nome || agente.workspaceId})`);
    if (APLICAR) remover('agentes', agente.id);
  }

  console.log('\n---------------------------------------------');
  console.log(`agentes renomeados: ${renomeados}`);
  console.log(`referencias @ atualizadas: ${referenciasTrocadas}`);
  console.log(`pastas corrigidas: ${pastasCorrigidas}`);
  console.log(`"Agente 26" removidos: ${sobras.length}`);

  /* A mesma pergunta do Painel de Saude, feita pelo mesmo codigo: nenhum
     agente no ar pode citar um atalho que nao existe mais. */
  if (APLICAR) {
    const aindaQuebrados = listar('agentes')
      .filter((a) => a.ativo !== false)
      .map((a) => ({ nome: a.nome, invalidas: analisarPrompt(a.prompt || '', a.workspaceId).invalidas }))
      .filter((a) => a.invalidas.length);
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
  console.error('\nA reorganizacao parou:', erro.message);
  console.error(erro.stack);
  process.exit(1);
});
