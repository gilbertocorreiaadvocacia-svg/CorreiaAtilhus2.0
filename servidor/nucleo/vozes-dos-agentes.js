import { atualizar, inserir, listar, remover } from './banco.js';
import { normalizar, novoId } from './util.js';

/**
 * O miolo de `npm run voz-dos-agentes`, extraido para poder rodar tambem no
 * boot do servidor (ver servidor/index.js) alem da ferramenta de linha de
 * comando (servidor/ferramentas/voz-dos-agentes.js) — a mesma logica, dois
 * chamadores. Documentacao completa do que isto faz esta na ferramenta.
 */

export const REGRA_COMPLETA = `CANAL DE VOZ: se o cliente disser que não sabe ler, que não consegue ler mensagens ou que tem dificuldade para ler, use @ativaraudio e passe a falar com frases curtas e palavras simples; se pedir para voltar a escrever, use @desativaraudio. Não ofereça nem incentive áudio a quem escreve normalmente.`;
export const REGRA_VOLTAR = `Se o cliente pedir para voltar ao texto, use @desativaraudio.`;

export const VOZES_PADRAO = [
  { nome: 'Acolhedora', descricao: 'Feminina, suave e um pouco mais devagar. Para quem escuta com mais atencao.', vozBase: 'shimmer', velocidade: 0.95 },
  { nome: 'Clara', descricao: 'Feminina, jovem e clara.', vozBase: 'nova', velocidade: 1 },
];

const ehAvaliacao = (a) => normalizar(a.nome).startsWith('avaliacao');

/**
 * Cadastra as vozes padrao, escolhe voz e acrescenta a regra do canal de voz
 * em todo agente de atendimento que ainda nao tem. Idempotente: rodar de novo
 * nao duplica voz nem regra (testado em servidor/testes/voz-dos-agentes.js).
 *
 * `aplicar: false` so relata o que faria, sem gravar nada.
 * `log`, se passado, recebe cada linha do relatorio (por escritorio/agente);
 * sem ele, roda calado e devolve so os totais — e o que o boot usa.
 */
export function processarVozes({ aplicar = false, log = () => {} } = {}) {
  const workspaces = listar('workspaces');
  let totalCriadas = 0;
  let totalComVoz = 0;
  let totalComRegra = 0;

  for (const workspace of workspaces) {
    const w = workspace.id;
    const agentesDoEscritorio = listar('agentes', { workspaceId: w }).filter((a) => a.ativo !== false && !ehAvaliacao(a));
    if (!agentesDoEscritorio.length) continue;

    log(`\n--- ${workspace.nome} ---`);

    let vozes = listar('vozes', { workspaceId: w });
    if (vozes.length) {
      log(`  ja tem ${vozes.length} voz(es) (${vozes.map((v) => v.nome).join(', ')}): nao cadastro nenhuma.`);
    } else {
      for (const v of VOZES_PADRAO) {
        log(`  [${aplicar ? 'feito' : 'simulado'}] cadastrar "${v.nome}" (${v.vozBase}, velocidade ${v.velocidade})`);
        if (aplicar) inserir('vozes', { id: novoId('voz'), workspaceId: w, ...v });
        totalCriadas += 1;
      }
      vozes = listar('vozes', { workspaceId: w });
    }
    const padrao = vozes.find((v) => normalizar(v.nome) === 'acolhedora') || vozes[0] || null;

    let semAjuste = true;
    for (const agente of agentesDoEscritorio) {
      const mudancas = {};
      const acoes = [];

      if (!agente.vozId && (padrao || !aplicar)) {
        acoes.push(`voz ${padrao?.nome || 'Acolhedora'}`);
        if (padrao) mudancas.vozId = padrao.id;
        totalComVoz += 1;
      }

      const prompt = String(agente.prompt || '');
      const temLigar = /@ativaraudio/i.test(prompt);
      const temDesligar = /@desativaraudio/i.test(prompt);
      if (!temLigar) {
        mudancas.prompt = `${prompt.trimEnd()}\n\n${REGRA_COMPLETA}`;
        acoes.push('regra de voz');
        totalComRegra += 1;
      } else if (!temDesligar) {
        mudancas.prompt = `${prompt.trimEnd()}\n\n${REGRA_VOLTAR}`;
        acoes.push('regra de voltar ao texto');
        totalComRegra += 1;
      }

      if (!acoes.length) continue;
      semAjuste = false;
      log(`  [${aplicar ? 'feito' : 'simulado'}] ${agente.nome}: ${acoes.join(' + ')}`);
      if (aplicar && Object.keys(mudancas).length) atualizar('agentes', agente.id, mudancas);
    }
    if (semAjuste) log('  nenhum agente precisa de ajuste: ja estava feito.');
  }

  return { totalCriadas, totalComVoz, totalComRegra };
}

/**
 * Tira voz duplicada (mesmo nome, mesma voz base, mesma velocidade) dentro
 * do mesmo escritorio — achado de 08/10/2026, reconferindo o diagnostico de
 * 29/09: clique repetido no botao de cadastrar criou ate 20 copias
 * identicas de "Voz da triagem" num so escritorio. Mantem a mais antiga (a
 * primeira da lista), remapeia quem apontava para uma copia removida, e
 * apaga as copias. Idempotente: sem duplicata, nao mexe em nada.
 */
export function deduplicarVozes() {
  let removidas = 0;
  let remapeadas = 0;

  for (const workspace of listar('workspaces')) {
    const canonicaPorAssinatura = new Map();
    const substituicoes = new Map();
    for (const voz of listar('vozes', { workspaceId: workspace.id })) {
      const assinatura = `${normalizar(voz.nome)}|${voz.vozBase}|${voz.velocidade}`;
      const canonica = canonicaPorAssinatura.get(assinatura);
      if (!canonica) {
        canonicaPorAssinatura.set(assinatura, voz);
        continue;
      }
      substituicoes.set(voz.id, canonica.id);
    }
    if (!substituicoes.size) continue;

    for (const agente of listar('agentes', { workspaceId: workspace.id })) {
      if (!agente.vozId || !substituicoes.has(agente.vozId)) continue;
      atualizar('agentes', agente.id, { vozId: substituicoes.get(agente.vozId) });
      remapeadas += 1;
    }
    for (const idDuplicada of substituicoes.keys()) {
      remover('vozes', idDuplicada);
      removidas += 1;
    }
  }

  return { removidas, remapeadas };
}
