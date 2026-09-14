import { PORTA } from '../config.js';
import { encerrarBanco, iniciarBanco, listar } from '../nucleo/banco.js';
import { criarWorkspacesPorArea } from '../nucleo/workspaces-por-area.js';

/**
 * Cria os workspaces Previdenciario e Trabalhista direto na base desta maquina.
 *
 * Uso (COM O SERVIDOR PARADO):
 *   node servidor/ferramentas/workspaces-por-area.js
 *   node servidor/ferramentas/workspaces-por-area.js --origem <id do workspace>
 *
 * Por que parado: o servidor guarda a base na memoria e grava por cima do
 * arquivo na proxima mudanca — o que esta ferramenta escrevesse com ele no ar
 * seria apagado em segundos. Por isso ela confere a porta antes de abrir a base.
 *
 * A mesma coisa existe pela tela (POST /api/workspaces/por-area, so
 * administrador); esta porta e para quem nao quer, ou nao pode, entrar com a
 * senha. Imprime so nomes e contagens: nenhuma chave.
 */

async function servidorNoAr() {
  try {
    const resposta = await fetch(`http://127.0.0.1:${PORTA}/api/saude`, { signal: AbortSignal.timeout(1500) });
    return resposta.ok;
  } catch {
    return false;
  }
}

async function principal() {
  if (await servidorNoAr()) {
    console.error(`O servidor esta no ar na porta ${PORTA}. Pare o servidor antes: com ele ligado, o que esta ferramenta gravar seria sobrescrito.`);
    process.exit(1);
  }

  iniciarBanco();

  const indice = process.argv.indexOf('--origem');
  const semArea = listar('workspaces').filter((w) => !w.area);
  const origemId = indice > -1 ? process.argv[indice + 1] : semArea.length === 1 ? semArea[0].id : null;
  if (!origemId) {
    console.error('Ha mais de um workspace sem area. Diga qual e a origem: --origem <id>');
    for (const w of semArea) console.error(`  ${w.id}  ${w.nome}`);
    process.exit(1);
  }

  const relato = criarWorkspacesPorArea({ baseWorkspaceId: origemId });
  for (const item of relato) {
    const detalhe = item.situacao === 'criado'
      ? ` | agentes ${item.agentes} (desligados) | bases ${item.bases} | membros ${item.membros} | numero por QR Code pronto para ler`
      : '';
    console.log(`${item.nome}: ${item.situacao}${detalhe}`);
  }

  await encerrarBanco();
  process.exit(0);
}

principal().catch((erro) => {
  console.error(`Falhou: ${erro.message}`);
  process.exit(1);
});
