import { PORTA } from '../config.js';
import { encerrarBanco, iniciarBanco } from '../nucleo/banco.js';
import { ligarNumerosDasAreas } from '../nucleo/agentes-por-escritorio.js';

/**
 * Liga cada numero de WhatsApp das areas ao agente de entrada da area
 * (Eduarda no Previdenciario, AG01 no Trabalhista), direto na base desta
 * maquina. So numero sem responsavel padrao; o que muda vai antes para
 * dados/copias-de-agentes.
 *
 * Uso (COM O SERVIDOR PARADO):
 *   node servidor/ferramentas/ligar-numeros-das-areas.js
 *
 * Imprime so nomes de escritorio, de numero e de agente.
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
  const ligados = ligarNumerosDasAreas();
  if (!ligados.length) console.log('Nenhum numero de area estava sem responsavel. Nada mudou.');
  for (const l of ligados) console.log(`${l.escritorio}: "${l.numero}" (${l.tipo}) agora e atendido por ${l.agente} (copia ${l.copia})`);
  await encerrarBanco();
  process.exit(0);
}

principal().catch((erro) => {
  console.error(`Falhou: ${erro.message}`);
  process.exit(1);
});
