import { encerrarBanco, iniciarBanco, listar } from '../nucleo/banco.js';
import { analisarPrompt } from '../ia/mencoes.js';
import { PASTA_TRABALHISTA_DE, PASTA_TRABALHISTA_PARA, migrarNomesDeAgentes, planoDeReorganizacao } from '../nucleo/migrar-agentes.js';

/**
 * Reorganiza os agentes ja instalados para acompanhar os pacotes
 * (servidor/ia/pacotes/*.js), depois do ajuste de nomes de 07/10/2026.
 *
 * Desde essa data a MESMA correcao roda sozinha toda vez que o sistema sobe
 * (servidor/index.js chama nucleo/migrar-agentes.js no boot): clicar em
 * Implantar no EasyPanel ja basta, sem precisar deste comando. Esta ferramenta
 * fica para quem quer ver o simular/aplicar na mao, ou rodar sem reiniciar o
 * servico. SEMPRE COM O SISTEMA PARADO: ela mexe nos arquivos de dados, e o
 * servidor no ar sobrescreveria a correcao no primeiro salvamento.
 *
 * O QUE MUDA, E POR QUE
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
 * para o outro (@responsavel para @Nome). Por isso cada renome tambem troca
 * "@NomeAntigo" por "@NomeNovo" em TODOS os prompts do mesmo escritorio — sem
 * isso a passagem de bastao quebraria silenciosamente.
 */

const APLICAR = process.argv.includes('--aplicar');

async function principal() {
  await iniciarBanco();

  console.log(
    APLICAR
      ? 'MODO APLICAR: os dados serao gravados.'
      : 'MODO SIMULACAO: nada sera gravado. Use --aplicar depois de conferir.',
  );

  const { porWorkspace, sobras } = planoDeReorganizacao();

  for (const { workspace, renomeiam, pastaAqui, agentes } of porWorkspace) {
    console.log(`\n--- ${workspace.nome} ---`);
    for (const { de, para } of renomeiam) console.log(`  [renomeia] "${de}" -> "${para}"`);
    if (pastaAqui) {
      for (const agente of agentes.filter((a) => a.pasta === PASTA_TRABALHISTA_DE)) {
        console.log(`  [pasta] ${agente.nome}: "${PASTA_TRABALHISTA_DE}" -> "${PASTA_TRABALHISTA_PARA}"`);
      }
    }
  }
  for (const agente of sobras) {
    const workspace = listar('workspaces').find((w) => w.id === agente.workspaceId);
    console.log(`\n[remove] "Agente 26" (${workspace?.nome || agente.workspaceId})`);
  }

  const resultado = APLICAR ? migrarNomesDeAgentes() : null;

  console.log('\n---------------------------------------------');
  if (resultado) {
    console.log(`agentes renomeados: ${resultado.renomeados}`);
    console.log(`referencias @ atualizadas: ${resultado.referencias}`);
    console.log(`pastas corrigidas: ${resultado.pastas}`);
    console.log(`"Agente 26" removidos: ${resultado.removidos}`);
  } else {
    const totalRenomeiam = porWorkspace.reduce((soma, w) => soma + w.renomeiam.length, 0);
    console.log(`agentes a renomear: ${totalRenomeiam}`);
    console.log(`"Agente 26" a remover: ${sobras.length}`);
  }

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
