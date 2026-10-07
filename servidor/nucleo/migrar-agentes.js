import { atualizar, listar, remover } from './banco.js';

/**
 * Reorganizacao dos agentes dos pacotes (07/10/2026): destrava a Beatriz,
 * limpa os nomes e a pasta do Trabalhista, tira o "Agente 26" repetido.
 *
 * Fonte unica para a migracao automatica (chamada no boot, index.js) e para a
 * ferramenta manual (ferramentas/reorganizar-agentes.js, que so acrescenta o
 * modo simular/aplicar na linha de comando). Ver o cabecalho da ferramenta
 * para o raciocinio completo de cada renome.
 *
 * Idempotente: rodar de novo, com os nomes ja certos, nao muda nada.
 */
export const RENOMES_DE_AGENTES = [
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

export const PASTA_TRABALHISTA_DE = 'Agentes Trabalhista + Auxilio acidente';
export const PASTA_TRABALHISTA_PARA = 'Trabalhista';

function contar(texto, agulha) {
  let n = 0;
  let de = texto.indexOf(agulha);
  while (de >= 0) {
    n += 1;
    de = texto.indexOf(agulha, de + agulha.length);
  }
  return n;
}

/** O que mudaria, sem gravar — para a ferramenta simular e para o boot decidir se ha algo a fazer. */
export function planoDeReorganizacao() {
  const porWorkspace = [];
  for (const workspace of listar('workspaces')) {
    const agentes = listar('agentes', { workspaceId: workspace.id });
    if (!agentes.length) continue;
    const renomeiam = RENOMES_DE_AGENTES.filter((r) => agentes.some((a) => a.nome === r.de));
    const pastaAqui = agentes.some((a) => a.pasta === PASTA_TRABALHISTA_DE);
    if (!renomeiam.length && !pastaAqui) continue;
    porWorkspace.push({ workspace, renomeiam, pastaAqui, agentes });
  }
  const sobras = listar('agentes').filter((a) => a.nome === 'Agente 26' && a.ativo === false && a.pasta === 'Sem pasta');
  return { porWorkspace, sobras };
}

/** Aplica o plano. Devolve a contagem do que mudou, para o chamador logar. */
export function migrarNomesDeAgentes() {
  const { porWorkspace, sobras } = planoDeReorganizacao();
  let renomeados = 0;
  let referencias = 0;
  let pastas = 0;

  for (const { renomeiam, pastaAqui, agentes } of porWorkspace) {
    for (const { de, para } of renomeiam) {
      const agente = agentes.find((a) => a.nome === de);
      atualizar('agentes', agente.id, { nome: para });
      renomeados += 1;
    }
    for (const agente of agentes) {
      const original = String(agente.prompt || '');
      let novo = original;
      for (const { de, para } of RENOMES_DE_AGENTES) {
        const vezes = contar(novo, `@${de}`);
        if (!vezes) continue;
        novo = novo.split(`@${de}`).join(`@${para}`);
        referencias += vezes;
      }
      if (novo !== original) atualizar('agentes', agente.id, { prompt: novo });
    }
    if (pastaAqui) {
      for (const agente of agentes.filter((a) => a.pasta === PASTA_TRABALHISTA_DE)) {
        atualizar('agentes', agente.id, { pasta: PASTA_TRABALHISTA_PARA });
        pastas += 1;
      }
    }
  }

  for (const agente of sobras) remover('agentes', agente.id);

  return { renomeados, referencias, pastas, removidos: sobras.length };
}
