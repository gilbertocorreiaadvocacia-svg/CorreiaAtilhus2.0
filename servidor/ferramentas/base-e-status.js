import { encerrarBanco, iniciarBanco, listar } from '../nucleo/banco.js';
import { processarBaseEStatus } from '../nucleo/base-e-status.js';

/**
 * Dois acertos que o diagnostico de 29/09 apontou: `npm run base-e-status`
 * simula, e `-- --aplicar` grava. COM O SISTEMA PARADO.
 *
 * Desde 08/10/2026 o mesmo ajuste (processarBaseEStatus, em
 * nucleo/base-e-status.js) tambem roda sozinho a cada vez que o servidor
 * sobe (ver servidor/index.js) — um "Implantar" comum ja basta. Esta
 * ferramenta continua util para conferir antes (simulacao) ou para forcar
 * fora do boot.
 *
 * 1. A BASE PREVIDENCIARIA NOS AGENTES TRABALHISTAS
 *
 * Os agentes trabalhistas consultavam o item "Quebra de objecoes", escrito
 * em logica previdenciaria: "o escritorio so recebe se o BENEFICIO for
 * concedido", "e se o INSS negar?". Cliente de causa trabalhista que perguntasse
 * quanto custa podia ouvir isso, e nao descreve uma reclamatoria.
 *
 * Desvincula, e nao apaga: o item continua na base para a cadeia
 * previdenciaria, que ainda o usa.
 *
 * No lugar dela, cria (uma vez por escritorio) um RASCUNHO de quebra de
 * objecoes trabalhista — generico de proposito, sem numero, percentual ou
 * prazo, com aviso para revisar com um advogado antes de confiar. E melhor
 * que o agente ficar sem nenhuma resposta, mas nao substitui o texto do
 * escritorio.
 *
 * 2. STATUS SEM DEPARTAMENTO
 *
 * Status de saida (Desistencia, Desqualificado, Nao Qualificado) sem
 * departamento deixava a conversa sem dono (o departamento da conversa segue
 * o do status). Recebem o Comercial, dono de todas as outras colunas do
 * funil. Conversa que JA esta nesses status nao e mexida: so as proximas.
 */

const APLICAR = process.argv.includes('--aplicar');
const DEPARTAMENTO = (process.argv.find((a) => a.startsWith('--departamento=')) || '--departamento=Comercial').split('=')[1];

async function principal() {
  await iniciarBanco();
  const workspaces = listar('workspaces');
  if (!workspaces.length) {
    console.error('Nenhum workspace na base.');
    process.exit(1);
  }

  console.log(APLICAR ? 'MODO APLICAR: sera gravado.' : 'MODO SIMULACAO: nada sera gravado. Use --aplicar depois de conferir.');
  console.log(`Departamento de saida: ${DEPARTAMENTO}\n`);

  const { desvinculados, rascunhosCriados, vinculadosAoRascunho, ajustados } = processarBaseEStatus({
    aplicar: APLICAR,
    departamento: DEPARTAMENTO,
    log: console.log,
  });

  console.log('\n---------------------------------------------');
  console.log(
    `vinculos previdenciarios removidos: ${desvinculados} | rascunhos trabalhistas criados: ${rascunhosCriados} | agentes vinculados ao rascunho: ${vinculadosAoRascunho} | status ajustados: ${ajustados}`,
  );
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
