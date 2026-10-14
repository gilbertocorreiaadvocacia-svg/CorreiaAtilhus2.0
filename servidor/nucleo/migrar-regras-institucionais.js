import { PACOTES } from '../ia/pacotes.js';
import { REGRAS_INSTITUCIONAIS } from '../ia/pacotes/comum.js';
import { atualizar, listar } from './banco.js';

/**
 * Relatorio de melhorias do escritorio em 14/10/2026: encaminhamento seguro
 * para atendimento humano (nunca inventar), as tres unidades reais sem
 * prometer atendimento so onde ha unidade, atendimento a distancia sem
 * prometer que tudo e virtual, e nome do cliente nunca trava a conversa.
 *
 * pacotes.js e os arquivos de pacotes/ ja saem com REGRAS_INSTITUCIONAIS no
 * prompt de cada agente — isso vale para instalacoes NOVAS. Esta migracao e
 * para quem ja estava instalado nos tres escritorios antes desta mudanca:
 * acrescenta o mesmo texto ao FINAL do prompt de cada agente, sem apagar nada
 * do que o escritorio escreveu, e corrige frases especificas que prometiam
 * "100% online" ou mandavam insistir no nome do cliente.
 *
 * Idempotente: o cabecalho com a data em REGRAS_INSTITUCIONAIS funciona como
 * marcador — ja estando no prompt, nao acrescenta de novo. Cada patch de
 * texto so troca se achar o texto antigo exato; rodar de novo, ja corrigido,
 * nao muda nada (mesmo espirito de nucleo/migrar-agentes.js).
 */
const MARCADOR = 'REGRAS INSTITUCIONAIS (ATUALIZAÇÃO 2026-10-14)';

/* Frases especificas que prometiam atendimento "100% online"/"tudo digital"
   ou mandavam insistir no nome do cliente, com a correcao aplicada tambem no
   pacote-fonte (ver pacotes/auxilio-acidente.js e pacotes/trabalhista.js). */
export const PATCHES_DE_TEXTO = [
  {
    area: 'previdenciario',
    de: 'DISTÂNCIA ou advogado online: Claro! Hoje tudo no INSS é digital — até o juiz fala com você pelo celular. Nosso escritório é 100% online para agilizar e atender clientes de todo o Brasil. Faz sentido resolver rápido com quem é especialista, em vez de esperar alguém da sua cidade que não tem a mesma experiência nesse tipo de causa? Envie o template @oab.',
    para: 'DISTÂNCIA ou advogado online: Claro! No INSS boa parte do processo é digital, e atendemos clientes de todo o Brasil com acompanhamento on-line durante o caso. Havendo perícia ou outro ato presencial, a equipe orienta sobre o local. Faz sentido resolver rápido com quem é especialista, em vez de esperar alguém da sua cidade que não tem a mesma experiência nesse tipo de causa? Envie o template @oab.',
  },
  {
    area: 'trabalhista',
    de: 'Se houver desconfiança, objeção ou suspeita de golpe, explique com empatia que somos advogados, envie o template @oab e ao final pergunte: Podemos continuar?\n\nSe perguntar de onde é o escritório ou onde fica, diga o endereço que está nos dados do escritório e reforce que atendemos o Brasil todo online, e continue as perguntas.\n\nSe o lead disser que clicou sem querer',
    para: 'Se houver desconfiança, objeção ou suspeita de golpe, explique com empatia que somos advogados, envie o template @oab e ao final pergunte: Podemos continuar?\n\nSe o lead disser que clicou sem querer',
  },
  {
    area: 'trabalhista',
    de: 'Não aceite adiamento de resposta: diante de evasão, insista na última pergunta, justificando que temos uma fila de prioridade, sem despedida nem passividade.',
    para: 'Não aceite adiamento de resposta: diante de evasão, insista na última pergunta, justificando que temos uma fila de prioridade, sem despedida nem passividade. Excetuando o nome do cliente: nessa pergunta siga a regra NOME DO CLIENTE, abaixo, e não insista mais de uma vez.',
  },
  {
    area: 'trabalhista',
    de: 'Insista até o lead dizer o nome. Jamais considere a primeira mensagem (ex.: AD1) como nome.\n\nDepois que responder o nome, use obrigatoriamente @salvarnome, altere o @status para "Em análise", diga: [nome], como você está? Espero que bem! e envie o template @recepcaotrabalhista. Depois diga: Depois que me adicionar, me conta um resumo do seu caso? Aguarde a resposta e siga para #ACIDENTE.\n\nSe o lead já tiver falado do caso antes de dizer o nome, peça para resumir de novo com mais detalhes e siga para #ACIDENTE.',
    para: 'Sem resposta clara, pergunte de novo uma única vez de forma natural, mas NÃO insista além disso: siga o atendimento normalmente mesmo sem o nome, chamando por "você" até ele aparecer. Jamais considere a primeira mensagem (ex.: AD1) como nome.\n\nRespondendo o nome, use obrigatoriamente @salvarnome, altere o @status para "Em análise", diga: [nome], como você está? Espero que bem! e envie o template @recepcaotrabalhista. Depois diga: Depois que me adicionar, me conta um resumo do seu caso? Aguarde a resposta e siga para #ACIDENTE.\n\nSe o lead já tiver falado do caso antes de dizer o nome, siga direto para #ACIDENTE com o que ele já contou, sem pedir para resumir de novo.',
  },
  {
    area: 'trabalhista',
    de: 'Distância (advogado online, não é da minha cidade): Entendo, [nome]. Quem não está acostumado com advogado à distância acha que vai ficar sem informação ou ter problema em audiência online. Mas hoje é como Uber, banco digital ou iFood: tudo funciona no celular, e na Justiça do Trabalho já é tudo digital também, inclusive audiência. O risco não é a distância… é escolher alguém só por estar perto e acabar perdendo dinheiro que é seu por direito. Então, [nome]: você prefere alguém da sua cidade que não é especialista ou um escritório especialista que vai fazer de tudo para ganhar sua causa? e envie o template @oab.',
    para: 'Distância (advogado online, não é da minha cidade): Entendo, [nome]. Quem não está acostumado com advogado à distância acha que vai ficar sem informação ou ter problema com a audiência. Boa parte da Justiça do Trabalho já é digital, e acompanhamos grande parte do processo à distância, sempre te mantendo informado; havendo audiência presencial, a equipe orienta sobre isso. O risco não é a distância… é escolher alguém só por estar perto e acabar perdendo dinheiro que é seu por direito. Então, [nome]: você prefere alguém da sua cidade que não é especialista ou um escritório especialista que vai fazer de tudo para ganhar sua causa? e envie o template @oab.',
  },
];

/** Nomes dos agentes de atendimento (nunca pos-venda nem avaliacao) de cada area. */
function nomesDeAtendimento(area) {
  const pacote = PACOTES[area];
  if (!pacote) return [];
  return pacote.agentes.filter((a) => a.objetivo !== 'avaliar' && a.objetivo !== 'atender').map((a) => a.nome);
}

/**
 * O que mudaria, sem gravar. Uma entrada por agente: as duas acoes (corrigir
 * texto antigo e acrescentar o bloco novo) saem calculadas juntas a partir do
 * MESMO prompt atual, para uma gravar depois da outra nunca desfazer o que a
 * primeira fez.
 */
export function planoDeRegrasInstitucionais() {
  const porAgente = [];
  for (const workspace of listar('workspaces')) {
    if (!workspace.area || !PACOTES[workspace.area]) continue;
    const nomesDeAgentesDeAtendimento = new Set(nomesDeAtendimento(workspace.area));
    const patchesDaArea = PATCHES_DE_TEXTO.filter((p) => p.area === workspace.area);

    for (const agente of listar('agentes', { workspaceId: workspace.id })) {
      const original = String(agente.prompt || '');
      const patches = patchesDaArea.filter((p) => original.includes(p.de));
      const precisaAcrescentar = nomesDeAgentesDeAtendimento.has(agente.nome) && !original.includes(MARCADOR);
      if (!patches.length && !precisaAcrescentar) continue;
      porAgente.push({ workspace, agente, original, patches, precisaAcrescentar });
    }
  }
  return { porAgente };
}

/** Aplica o plano. Devolve a contagem do que mudou, para o chamador logar. */
export function aplicarRegrasInstitucionais() {
  const { porAgente } = planoDeRegrasInstitucionais();
  let acrescentados = 0;
  let corrigidos = 0;

  for (const { agente, original, patches, precisaAcrescentar } of porAgente) {
    let prompt = original;
    for (const { de, para } of patches) prompt = prompt.split(de).join(para);
    if (patches.length) corrigidos += 1;
    if (precisaAcrescentar) {
      prompt = `${prompt}\n\n${REGRAS_INSTITUCIONAIS}`;
      acrescentados += 1;
    }
    atualizar('agentes', agente.id, { prompt });
  }

  return { acrescentados, corrigidos };
}
