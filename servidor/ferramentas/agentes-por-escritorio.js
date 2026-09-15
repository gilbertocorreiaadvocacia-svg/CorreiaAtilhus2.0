import { PORTA } from '../config.js';
import { encerrarBanco, iniciarBanco, listar } from '../nucleo/banco.js';
import { separarPorEscritorio } from '../nucleo/agentes-por-escritorio.js';

/**
 * Leva os agentes de cada area para o seu escritorio, direto na base desta
 * maquina: o mesmo que o botao "Separar por escritorio" da tela de Agentes.
 *
 * Uso (COM O SERVIDOR PARADO; no Windows, windows/agentes-por-escritorio.cmd):
 *   node servidor/ferramentas/agentes-por-escritorio.js
 *   node servidor/ferramentas/agentes-por-escritorio.js --apagar-outros
 *   node servidor/ferramentas/agentes-por-escritorio.js --origem <id do workspace>
 *
 * --apagar-outros tira tambem do escritorio geral os agentes que nao sao de
 * area nenhuma (o que estava com eles fica esperando uma pessoa). Tudo o que
 * sai vai antes para dados/copias-de-agentes.
 *
 * Parado pelo mesmo motivo de workspaces-por-area.js: o servidor guarda a base
 * na memoria e grava por cima do que esta ferramenta escrevesse. Imprime so
 * nomes de escritorio e contagens.
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

  const relato = separarPorEscritorio({ origemId, apagarOutros: process.argv.includes('--apagar-outros') });
  for (const e of relato.escritorios) {
    console.log(
      `${e.nome}: ${e.agentes} agentes ligados${e.criadoAgora ? ' (escritorio criado agora)' : ''}${e.removidos ? `, ${e.removidos} antigos sairam (copia ${e.copia})` : ''}`,
    );
  }
  console.log(
    `Escritorio geral: ${relato.removidosDaqui.length} agentes sairam${relato.copia ? ` (copia ${relato.copia})` : ''}, ${relato.reatribuidos.conversas} conversas e ${relato.reatribuidos.numeros} numeros ficaram sem agente, ${relato.ficamNoGeral} agente do geral (desligado).`,
  );

  await encerrarBanco();
  process.exit(0);
}

principal().catch((erro) => {
  console.error(`Falhou: ${erro.message}`);
  process.exit(1);
});
