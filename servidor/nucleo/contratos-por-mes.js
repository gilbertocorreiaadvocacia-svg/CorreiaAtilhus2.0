import { FUSO, partesEm } from '../automacao/horario.js';
import { achar, listar } from './banco.js';
import { filtrarConversasVisiveis } from './auth.js';

/**
 * Contratos fechados por agente de IA, mes a mes.
 *
 * Pedido do escritorio em 11/11/2026: "quero que todo mes mostre quantos
 * contratos foram fechados pelos agentes, quero graficos e estatistica".
 *
 * "FECHADO" E CONTRATO ASSINADO, escolha do escritorio na mesma conversa: so
 * entra quem tem `situacao === 'assinado'`, e o credito vai para o agente que
 * PEDIU o contrato (`contrato.agenteId`). E a mesma definicao que a tabela "Por
 * agente de IA" ja usava em rotas/relatorios.js — o relatorio ganhou o recorte
 * mensal, nao uma contagem nova que discordaria da de cima na mesma tela.
 *
 * A outra leitura possivel era a conversa que chegou na coluna "Contrato
 * fechado" do Kanban, que e um numero maior (entra o que o escritorio fecha na
 * mao e o que veio do historico antigo) e com atribuicao mais frouxa. Ficou de
 * fora por decisao do escritorio.
 *
 * O MES E O DO ESCRITORIO, NAO O DO UTC. `assinadoEm` e ISO em UTC, e cortar a
 * string ("2026-02-01T01:30Z".slice(0,7)) jogaria para fevereiro um contrato
 * assinado as 22h30 de 31 de janeiro em Sao Paulo. Num relatorio por periodo
 * isso passa despercebido; num relatorio MENSAL o contrato troca de mes, e os
 * dois meses da borda ficam errados todo fim de mes. Por isso o mes sai de
 * partesEm (automacao/horario.js), que e o mesmo fuso que o resto do sistema
 * usa para decidir dia.
 *
 * Respeita o que a pessoa logada pode ver (filtrarConversasVisiveis), igual ao
 * resto do relatorio: quem tem visao limitada ve a propria fatia.
 */

/** Quantos agentes ganham linha propria no grafico; o resto vira "Outros". */
export const AGENTES_NO_GRAFICO = 6;

/** Teto de meses que a rota aceita, para um `meses=99999` nao varrer a base a toa. */
export const MAXIMO_DE_MESES = 36;

/** O mes (AAAA-MM) de um instante, no fuso do escritorio. */
export function mesDe(iso, fuso = FUSO) {
  if (!iso) return null;
  const data = new Date(iso);
  if (Number.isNaN(data.getTime())) return null;
  const { ano, mes } = partesEm(data, fuso);
  return `${ano}-${String(mes).padStart(2, '0')}`;
}

/** Os N meses que terminam no mes de `fim`, do mais antigo para o mais novo. */
export function mesesAte(fim, quantidade) {
  const [ano, mes] = String(fim).split('-').map(Number);
  const lista = [];
  for (let i = quantidade - 1; i >= 0; i -= 1) {
    /* Dia 1 ao meio-dia: a conta de mes nao pode esbarrar em horario de verao
       nem em mes de 28 dias, e o Date normaliza o ano virado sozinho. */
    const d = new Date(Date.UTC(ano, mes - 1 - i, 1, 12));
    lista.push(`${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}`);
  }
  return lista;
}

/** Variacao percentual de `antes` para `agora`, arredondada. Nula quando nao da para dizer. */
function variacao(agora, antes) {
  if (!antes) return null;
  return Math.round(((agora - antes) / antes) * 100);
}

/**
 * O relatorio mensal pronto para a tela desenhar.
 *
 * Devolve a serie no formato que graficos.js espera (uma linha por mes, com uma
 * chave por agente), a lista de agentes com a estatistica de cada um, e os
 * numeros do escritorio inteiro.
 */
export function contratosPorMes(ctx, { meses = 12, fuso = FUSO } = {}) {
  const w = ctx.workspaceId;
  const quantidade = Math.min(Math.max(Number(meses) || 12, 1), MAXIMO_DE_MESES);

  const visiveis = new Set(filtrarConversasVisiveis(ctx, listar('contatos', { workspaceId: w })).map((c) => c.id));
  const assinados = listar('contratos', { workspaceId: w }).filter(
    (c) => c.situacao === 'assinado' && visiveis.has(c.contatoId) && c.assinadoEm,
  );

  const mesAtual = mesDe(new Date().toISOString(), fuso);
  const janela = mesesAte(mesAtual, quantidade);
  const dentro = new Set(janela);

  /* Um balde por agente, e um para o contrato sem agente (criado a mao). O
     agente removido continua no relatorio: apagar o agente nao desfaz o
     contrato que ele fechou, e a linha sumir mudaria o total do mes. */
  const porAgente = new Map();
  const semAgente = Object.fromEntries(janela.map((m) => [m, 0]));
  let totalSemAgente = 0;
  let total = 0;
  let foraDaJanela = 0;

  for (const contrato of assinados) {
    const mes = mesDe(contrato.assinadoEm, fuso);
    if (!mes || !dentro.has(mes)) {
      foraDaJanela += 1;
      continue;
    }
    total += 1;
    if (!contrato.agenteId) {
      semAgente[mes] += 1;
      totalSemAgente += 1;
      continue;
    }
    let agente = porAgente.get(contrato.agenteId);
    if (!agente) {
      agente = {
        id: contrato.agenteId,
        nome: achar('agentes', contrato.agenteId)?.nome || 'Agente removido',
        total: 0,
        porMes: Object.fromEntries(janela.map((m) => [m, 0])),
      };
      porAgente.set(contrato.agenteId, agente);
    }
    agente.total += 1;
    agente.porMes[mes] += 1;
  }

  /* Estatistica de cada agente. `mediaMensal` divide pela janela inteira, e nao
     so pelos meses em que ele fechou alguma coisa: o mes zerado tambem conta
     para quem compara dois agentes. */
  const agentes = [...porAgente.values()]
    .map((agente) => {
      const valores = janela.map((m) => agente.porMes[m]);
      const maior = Math.max(...valores);
      return {
        ...agente,
        mediaMensal: Number((agente.total / quantidade).toFixed(1)),
        melhorMes: maior > 0 ? { periodo: janela[valores.indexOf(maior)], quantidade: maior } : null,
        fatia: total ? Math.round((agente.total / total) * 100) : 0,
      };
    })
    .sort((a, b) => b.total - a.total || a.nome.localeCompare(b.nome, 'pt-BR'));

  /*
   * A serie do grafico: uma linha por mes, com uma chave por agente que tem
   * linha propria e `__outros` somando a cauda. Mesma forma que o painel usa
   * (web/js/paginas/dashboard.js), para graficoEvolucao desenhar sem traducao.
   */
  const comLinha = agentes.slice(0, AGENTES_NO_GRAFICO);
  const cauda = agentes.slice(AGENTES_NO_GRAFICO);
  const serie = janela.map((mes) => {
    const linha = { periodo: mes, __total: 0 };
    for (const agente of comLinha) linha[agente.id] = agente.porMes[mes];
    if (cauda.length) linha.__outros = cauda.reduce((soma, a) => soma + a.porMes[mes], 0);
    linha.__total = agentes.reduce((soma, a) => soma + a.porMes[mes], 0) + semAgente[mes];
    return linha;
  });

  const totaisPorMes = janela.map((mes) => serie.find((l) => l.periodo === mes).__total);
  const maiorMes = Math.max(0, ...totaisPorMes);
  const doMesAtual = totaisPorMes[totaisPorMes.length - 1] || 0;
  const doMesAnterior = totaisPorMes.length > 1 ? totaisPorMes[totaisPorMes.length - 2] : 0;

  return {
    meses: janela,
    mesAtual,
    /* O mes corrente ainda esta correndo: comparar o dia 3 com um mes inteiro e
       o erro classico deste tipo de cartao, e a tela avisa por causa disto. */
    mesIncompleto: true,
    serie,
    agentes,
    comLinhaPropria: comLinha.map((a) => ({ id: a.id, nome: a.nome })),
    outros: cauda.length ? { quantidade: cauda.length, total: cauda.reduce((s, a) => s + a.total, 0) } : null,
    semAgente: { total: totalSemAgente, porMes: semAgente },
    totais: {
      total,
      mediaMensal: Number((total / quantidade).toFixed(1)),
      melhorMes: maiorMes > 0 ? { periodo: janela[totaisPorMes.indexOf(maiorMes)], quantidade: maiorMes } : null,
      mesAtual: doMesAtual,
      mesAnterior: doMesAnterior,
      variacao: variacao(doMesAtual, doMesAnterior),
      agentesQueFecharam: agentes.length,
      /* Assinado antes da janela: explica a diferenca para quem compara este
         total com o da tabela de cima, que nao tem limite de meses. */
      foraDaJanela,
    },
  };
}
