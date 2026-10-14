import { iniciarBanco, listar, atualizar, remover, encerrarBanco } from '../nucleo/banco.js';
import { instalarAgentesDaArea } from '../nucleo/agentes-por-escritorio.js';
import { PACOTES } from '../ia/pacotes.js';
import { normalizar } from '../nucleo/util.js';
import { WORKSPACES_POR_AREA } from '../nucleo/workspaces-por-area.js';

/**
 * Correcao unica (14/10/2026): dois workspaces nasceram pelo caminho
 * generico de criacao em vez do caminho de area, e viraram copia dos
 * agentes genericos do escritorio principal, repetidos entre escritorios
 * em vez do conjunto proprio de cada area. Roda com o servidor PARADO —
 * mexe direto nos arquivos de dados, o servidor no ar sobrescreveria.
 *
 * Idempotente: rodar de novo nao piora nada (agente ja certo fica como
 * esta, so acrescenta o que falta) — mas o objetivo e rodar uma vez so.
 */
iniciarBanco();

for (const alvo of WORKSPACES_POR_AREA) {
  const workspace = listar('workspaces').find(
    (w) => w.area === alvo.area || normalizar(w.nome) === normalizar(alvo.nome),
  );
  if (!workspace) {
    console.log(`sem workspace para ${alvo.area}`);
    continue;
  }

  // (a) apaga os agentes que NAO fazem parte do pacote certo dessa area
  const nomesCorretos = new Set((PACOTES[alvo.area]?.agentes || []).map((a) => normalizar(a.nome)));
  const errados = listar('agentes', { workspaceId: workspace.id }).filter((a) => !nomesCorretos.has(normalizar(a.nome)));
  for (const agente of errados) {
    const emUso = listar('contatos', { workspaceId: workspace.id }).some(
      (c) => c.responsavel?.tipo === 'agente' && c.responsavel.id === agente.id,
    );
    if (emUso) {
      console.log(`PULEI ${agente.nome} (${workspace.nome}): em uso por uma conversa`);
      continue;
    }
    remover('agentes', agente.id);
    console.log(`removido: ${agente.nome} de ${workspace.nome}`);
  }

  // (b) acerta a area do workspace
  if (workspace.area !== alvo.area) {
    atualizar('workspaces', workspace.id, { area: alvo.area });
    console.log(`area de ${workspace.nome} ajustada para ${alvo.area}`);
  }

  // (c) instala o conjunto certo (so entra o que falta)
  const resultado = instalarAgentesDaArea(workspace.id, alvo.area);
  console.log(`${workspace.nome}: ${resultado.agentesCriados} agentes criados, ${resultado.bases} bases usadas`);
}

await encerrarBanco();
console.log('\nPronto. Confira a lista de agentes de cada escritorio antes de religar o sistema.');
