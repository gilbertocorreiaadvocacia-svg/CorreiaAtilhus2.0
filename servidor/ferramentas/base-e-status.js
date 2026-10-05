import { atualizar, encerrarBanco, iniciarBanco, listar } from '../nucleo/banco.js';
import { normalizar } from '../nucleo/util.js';

/**
 * Dois acertos que o diagnostico de 29/09 apontou: `npm run base-e-status`
 * simula, e `-- --aplicar` grava. COM O SISTEMA PARADO.
 *
 * 1. A BASE PREVIDENCIARIA NOS AGENTES TRABALHISTAS
 *
 * Os oito agentes trabalhistas consultavam o item "Quebra de objecoes", escrito
 * em logica previdenciaria: "o escritorio so recebe se o BENEFICIO for
 * concedido", "e se o INSS negar?". Cliente de causa trabalhista que perguntasse
 * quanto custa podia ouvir isso, e nao descreve uma reclamatoria.
 *
 * O AG06 ja traz a proposta trabalhista no proprio prompt (honorarios de 35%)
 * e uma secao #OBJECOES, entao o item nao cobria nada que ele nao cobrisse
 * melhor. Desvincular, e nao apagar: o item continua na base para a cadeia
 * previdenciaria, que ainda o usa, e o vinculo volta em um clique na tela do
 * agente.
 *
 * Os prompts citam apenas @biblioteca, de forma generica, e nunca o item pelo
 * nome: tirar o vinculo nao deixa instrucao apontando para o vazio.
 *
 * Nao escrevi uma "Quebra de objecoes" trabalhista no lugar. Resposta sobre
 * honorario e a voz do escritorio sobre dinheiro; isso e texto do advogado.
 *
 * 2. STATUS SEM DEPARTAMENTO
 *
 * Desistencia, Desqualificado e Nao Qualificado nao tinham departamento, e
 * conversa que cai neles ficava sem dono (o departamento da conversa segue o
 * do status). Recebem o Comercial, que e o dono de todas as outras colunas do
 * funil. Conversa que JA esta nesses status nao e mexida: so as proximas.
 */

const APLICAR = process.argv.includes('--aplicar');
const DEPARTAMENTO = (process.argv.find((a) => a.startsWith('--departamento=')) || '--departamento=Comercial').split('=')[1];

const ehPerda = (s) => ['desistencia', 'desqualificado'].includes(s.tipo) || normalizar(s.nome) === 'nao qualificado';

async function principal() {
  await iniciarBanco();
  const workspace = listar('workspaces')[0];
  if (!workspace) {
    console.error('Nenhum workspace na base.');
    process.exit(1);
  }
  const w = workspace.id;

  console.log(`Base e status - ${workspace.nome}`);
  console.log(APLICAR ? 'MODO APLICAR: sera gravado.' : 'MODO SIMULACAO: nada sera gravado. Use --aplicar depois de conferir.');

  /* 1. Base previdenciaria nos agentes trabalhistas -------------------- */
  console.log('\n1. "Quebra de objecoes" nos agentes trabalhistas');
  const item = listar('conhecimento', { workspaceId: w }).find((k) => normalizar(k.nome).startsWith('quebra de objec'));
  let desvinculados = 0;
  if (!item) {
    console.log('  o item "Quebra de objecoes" nao existe nesta base: nada a fazer.');
  } else {
    for (const agente of listar('agentes', { workspaceId: w })) {
      if (agente.area !== 'trabalhista') continue;
      if (!(agente.conhecimentoIds || []).includes(item.id)) continue;
      console.log(`  [${APLICAR ? 'feito' : 'simulado'}] desvincular de ${agente.nome}`);
      if (APLICAR) {
        atualizar('agentes', agente.id, { conhecimentoIds: agente.conhecimentoIds.filter((id) => id !== item.id) });
      }
      desvinculados += 1;
    }
    if (!desvinculados) console.log('  nenhum agente trabalhista esta vinculado: ja estava feito.');
    const quemMais = listar('agentes', { workspaceId: w }).filter(
      (a) => a.area !== 'trabalhista' && (a.conhecimentoIds || []).includes(item.id),
    );
    console.log(`  o item continua na base e vinculado a ${quemMais.length} agente(s) da cadeia previdenciaria.`);
  }

  /* 2. Status de saida sem departamento -------------------------------- */
  console.log(`\n2. Status de saida sem departamento -> ${DEPARTAMENTO}`);
  const dep = listar('departamentos', { workspaceId: w }).find((x) => normalizar(x.nome) === normalizar(DEPARTAMENTO));
  let ajustados = 0;
  if (!dep) {
    console.log(`  [RECUSADO] nao existe departamento "${DEPARTAMENTO}".`);
  } else {
    for (const s of listar('status', { workspaceId: w })) {
      if (s.departamentoId || !ehPerda(s)) continue;
      const naColuna = listar('contatos', { workspaceId: w }).filter((c) => c.statusId === s.id).length;
      console.log(`  [${APLICAR ? 'feito' : 'simulado'}] "${s.nome}" passa para ${dep.nome} (${naColuna} conversa(s) ja nela, nao alterada(s))`);
      if (APLICAR) atualizar('status', s.id, { departamentoId: dep.id });
      ajustados += 1;
    }
    if (!ajustados) console.log('  nenhum status de saida sem departamento: ja estava feito.');
  }

  console.log('\n---------------------------------------------');
  console.log(`vinculos removidos: ${desvinculados} | status ajustados: ${ajustados}`);
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
