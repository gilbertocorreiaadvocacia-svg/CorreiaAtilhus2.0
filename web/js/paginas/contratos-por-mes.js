import { api } from '../api.js';
import { COR_SEM_SERIE, PALETA_SERIES, graficoEvolucao, legenda } from '../graficos.js';
import { botao, cartao, el, limpar, numero, plural, selecao, vazio } from '../ui.js';

/**
 * Contratos fechados por agente de IA, mes a mes.
 *
 * Pedido do escritorio em 11/11/2026: "quero que todo mes mostre quantos
 * contratos foram fechados pelos agentes, quero graficos e estatistica".
 *
 * "Fechado" e CONTRATO ASSINADO, e o credito vai para o agente que pediu o
 * contrato — a mesma definicao da tabela "Por agente de IA" logo abaixo nesta
 * tela, escolhida pelo escritorio. Duas contagens diferentes de "contrato
 * fechado" na mesma pagina seriam duas verdades brigando. Quem decide o recorte
 * e o servidor (servidor/nucleo/contratos-por-mes.js), inclusive o mes, que sai
 * no fuso do escritorio e nao no UTC.
 *
 * PERIODO PROPRIO, de proposito: a barra do topo tem um seletor de datas que
 * manda nas duas tabelas de baixo, e o padrao dele sao 30 dias — um grafico
 * mensal com um mes e meio de dado nao diz nada. Aqui a conta anda por meses
 * fechados, e quem quiser mais ou menos mexe no seletor deste bloco.
 */

/* Quantos meses a pessoa pode pedir. O servidor tem o proprio teto (36). */
const OPCOES_DE_MESES = [
  { valor: '6', rotulo: '6 meses' },
  { valor: '12', rotulo: '12 meses' },
  { valor: '24', rotulo: '24 meses' },
];

const MESES_CURTOS = ['jan', 'fev', 'mar', 'abr', 'mai', 'jun', 'jul', 'ago', 'set', 'out', 'nov', 'dez'];

/** "2026-11" -> "nov/26". Mesma forma curta que o eixo do grafico usa. */
function mesCurto(periodo) {
  const [ano, mes] = String(periodo || '').split('-');
  const i = Number(mes) - 1;
  return MESES_CURTOS[i] ? `${MESES_CURTOS[i]}/${String(ano).slice(2)}` : periodo || '';
}

/** "2026-11" -> "novembro de 2026", para texto corrido e leitor de tela. */
function mesPorExtenso(periodo) {
  const [ano, mes] = String(periodo || '').split('-');
  const nomes = ['janeiro', 'fevereiro', 'março', 'abril', 'maio', 'junho', 'julho', 'agosto', 'setembro', 'outubro', 'novembro', 'dezembro'];
  const i = Number(mes) - 1;
  return nomes[i] ? `${nomes[i]} de ${ano}` : periodo || '';
}

/**
 * Um cartao de numero, no mesmo formato do painel (.metrica).
 *
 * A variacao sai como SINAL NO TEXTO ("+18%", "−7%", "igual"), que e como o
 * relatorio do agente ja escreve (sinal(), em relatorio-do-agente.js) e nao
 * depende de cor nem de icone: quem nao separa verde de vermelho le igual. O
 * menos e o sinal tipografico U+2212, e nao o hifen, para alinhar com o
 * algarismo tabular do cartao.
 */
function cartaoDeNumero({ nome, valor, rotulo, nota, cor, variacao }) {
  const numeros = [el('div', { class: 'valor', texto: valor })];
  if (variacao !== null && variacao !== undefined) {
    const texto = variacao === 0 ? 'igual ao mês anterior' : `${variacao > 0 ? '+' : '−'}${Math.abs(variacao)}% sobre o mês anterior`;
    numeros.push(el('span', { class: 'variacao', texto }));
  }
  return el('div', { class: 'metrica metrica-sem-linha', estilo: cor ? { '--metrica-cor': cor } : null }, [
    el('div', { class: 'metrica-topo' }, [el('span', { class: 'nome', texto: nome })]),
    el('div', { class: 'metrica-numeros' }, numeros),
    rotulo ? el('div', { class: 'rotulo', texto: rotulo }) : null,
    nota ? el('div', { class: 'nota', texto: nota }) : null,
  ]);
}

export function blocoContratosPorMes() {
  const raiz = el('div', { class: 'mb-4' });
  const corpo = el('div');
  let meses = '12';
  let dados = null;

  const seletor = selecao(OPCOES_DE_MESES, meses, {
    'aria-label': 'Quantos meses mostrar',
    aoChange: (ev) => {
      meses = ev.target.value;
      carregar();
    },
  });

  async function carregar() {
    limpar(corpo);
    corpo.append(el('div', { class: 'painel-bloco t-sm c-fraco', texto: 'Carregando…' }));
    try {
      dados = await api.get('/api/relatorios/contratos-por-mes', { meses });
      pintar();
    } catch (erro) {
      limpar(corpo);
      corpo.append(vazio('Não consegui carregar os contratos por mês', erro.message, botao('Tentar de novo', { aoClicar: carregar })));
    }
  }

  /* As series do grafico: uma por agente com linha propria, mais o balde
     "Outros agentes" quando a cauda existe. A cor sai da posicao na lista, que
     e a ordem por total — e a mesma paleta do painel. */
  function seriesDoGrafico() {
    const series = dados.comLinhaPropria.map((agente, i) => ({
      chave: agente.id,
      nome: agente.nome,
      cor: PALETA_SERIES[i % PALETA_SERIES.length],
    }));
    if (dados.outros) {
      series.push({ chave: '__outros', nome: `Outros ${plural(dados.outros.quantidade, 'agente', 'agentes')}`, cor: COR_SEM_SERIE });
    }
    return series;
  }

  /*
   * A tabela: uma linha por agente, uma coluna por mes, e a estatistica do
   * agente no fim. Rola na horizontal dentro do proprio cartao (.tabela-rolagem)
   * — com 24 meses nenhuma tela comporta tudo, e encolher a coluna faria o
   * numero sumir. O nome do agente fica preso na primeira coluna, senao quem
   * rola ate dezembro perde de vista de quem e a linha.
   */
  function tabelaMensal() {
    const { meses: janela, agentes, semAgente, totais } = dados;

    const cabecalho = el('tr', {}, [
      el('th', { class: 'coluna-presa', texto: 'Agente' }),
      ...janela.map((m) => el('th', { class: 'n', title: mesPorExtenso(m), texto: mesCurto(m) })),
      el('th', { class: 'n', texto: 'Total' }),
      el('th', { class: 'n', title: 'Média por mês no período', texto: 'Média' }),
      el('th', { class: 'n', title: 'Fatia do total do escritório', texto: 'Fatia' }),
    ]);

    const linhas = agentes.map((agente) =>
      el('tr', {}, [
        el('th', { scope: 'row', class: 'coluna-presa', texto: agente.nome }),
        ...janela.map((m) => {
          const valor = agente.porMes[m] || 0;
          const ehMelhor = agente.melhorMes?.periodo === m && valor > 0;
          return el('td', {
            class: `n${valor ? '' : ' zero'}${ehMelhor ? ' melhor' : ''}`,
            title: ehMelhor ? `Melhor mês deste agente: ${mesPorExtenso(m)}` : null,
            texto: valor ? numero(valor) : '–',
          });
        }),
        el('td', { class: 'n forte', texto: numero(agente.total) }),
        el('td', { class: 'n', texto: numero(agente.mediaMensal) }),
        el('td', { class: 'n c-fraco', texto: `${agente.fatia}%` }),
      ]),
    );

    /* Contrato sem agente (criado a mao): entra como linha de apoio, e nao
       sumindo, senao a soma das linhas nao bate com o total do escritorio e
       quem confere acha que o relatorio perdeu contrato. */
    if (semAgente.total) {
      linhas.push(
        el('tr', { class: 'apoio' }, [
          el('th', { scope: 'row', class: 'coluna-presa', texto: 'Criado à mão (sem agente)' }),
          ...janela.map((m) => el('td', { class: `n${semAgente.porMes[m] ? '' : ' zero'}`, texto: semAgente.porMes[m] ? numero(semAgente.porMes[m]) : '–' })),
          el('td', { class: 'n forte', texto: numero(semAgente.total) }),
          el('td', { class: 'n' }),
          el('td', { class: 'n' }),
        ]),
      );
    }

    const rodape = el('tr', { class: 'total' }, [
      el('th', { scope: 'row', class: 'coluna-presa', texto: 'Total do mês' }),
      ...janela.map((m) => {
        const linha = dados.serie.find((l) => l.periodo === m);
        return el('td', { class: 'n forte', texto: numero(linha?.__total || 0) });
      }),
      el('td', { class: 'n forte', texto: numero(totais.total) }),
      el('td', { class: 'n forte', texto: numero(totais.mediaMensal) }),
      el('td', { class: 'n' }),
    ]);

    return el('div', { class: 'tabela-rolagem' }, [
      el('table', { class: 'tabela tabela-mensal' }, [
        el('thead', {}, [cabecalho]),
        el('tbody', {}, linhas),
        el('tfoot', {}, [rodape]),
      ]),
    ]);
  }

  function pintar() {
    limpar(corpo);
    escreverLegenda();
    const { totais } = dados;

    if (!totais.total) {
      corpo.append(
        vazio(
          'Nenhum contrato assinado nestes meses',
          totais.foraDaJanela
            ? `Há ${plural(totais.foraDaJanela, 'contrato assinado', 'contratos assinados')} antes deste período. Aumente a janela no seletor acima.`
            : 'Assim que o primeiro contrato for assinado, ele aparece aqui no mês dele.',
        ),
      );
      return;
    }

    /* Os quatro numeros do escritorio. O do mes corrente leva a nota de que o
       mes ainda esta correndo: comparar o dia 3 com um mes inteiro e o engano
       que este tipo de cartao produz sozinho. */
    corpo.append(
      el('div', { class: 'metricas mb-4' }, [
        cartaoDeNumero({
          nome: 'No período',
          valor: numero(totais.total),
          rotulo: `${plural(totais.total, 'contrato assinado', 'contratos assinados')} em ${dados.meses.length} meses`,
          nota: totais.foraDaJanela ? `${numero(totais.foraDaJanela)} antes deste período` : null,
          cor: 'var(--ouro)',
        }),
        cartaoDeNumero({
          nome: 'Média por mês',
          valor: numero(totais.mediaMensal),
          /* plural() ja traz o numero junto ("6 agentes"): somar outro na
             frente escrevia "6 6 agentes fecharam contrato". */
          rotulo: `${plural(totais.agentesQueFecharam, 'agente fechou', 'agentes fecharam')} contrato`,
        }),
        cartaoDeNumero({
          nome: 'Melhor mês',
          valor: totais.melhorMes ? numero(totais.melhorMes.quantidade) : '–',
          rotulo: totais.melhorMes ? mesPorExtenso(totais.melhorMes.periodo) : 'Sem contrato no período',
        }),
        cartaoDeNumero({
          nome: 'Mês atual',
          valor: numero(totais.mesAtual),
          variacao: totais.variacao,
          rotulo: mesPorExtenso(dados.mesAtual),
          nota: `O mês ainda está correndo. Mês anterior: ${numero(totais.mesAnterior)}.`,
        }),
      ]),
    );

    const series = seriesDoGrafico();
    const grafico = series.length
      ? graficoEvolucao({ serie: dados.serie, series, altura: 280, rotulo: 'Contratos assinados por agente, mês a mês' })
      : null;

    corpo.append(
      cartao(
        'Contratos por agente, mês a mês',
        'Cada linha é um agente de IA.',
        grafico
          ? el('div', {}, [grafico, legenda(series)])
          : vazio('Nada para desenhar', 'Nenhum contrato assinado tem agente associado neste período.'),
      ),
    );

    corpo.append(el('div', { class: 'mt-4' }, [cartao('Número por mês', 'A mesma contagem do gráfico, para conferir e copiar.', tabelaMensal())]));
  }

  /*
   * O cabecalho DIZ de que periodo o bloco fala, e o seletor fica aqui dentro.
   *
   * A tela tem dois periodos ao mesmo tempo (este, em meses, e o do bloco de
   * baixo, em datas). Enquanto um dos controles morava na barra do topo, nada
   * dizia qual numero obedecia a qual: dava para ler "152" aqui e "16" logo
   * abaixo sem entender por que diferem. Cada bloco agora carrega o proprio
   * controle e a propria legenda.
   */
  const legendaDoPeriodo = el('p', { class: 'bloco-legenda' });
  function escreverLegenda() {
    const janela = dados?.meses || [];
    legendaDoPeriodo.textContent = janela.length
      ? `Últimos ${janela.length} meses — de ${mesPorExtenso(janela[0])} a ${mesPorExtenso(janela[janela.length - 1])}. Conta o contrato no mês em que o cliente assinou.`
      : 'Conta o contrato no mês em que o cliente assinou.';
  }
  escreverLegenda();

  raiz.append(
    el('div', { class: 'bloco-cabeca' }, [
      el('div', { class: 'bloco-cabeca-texto' }, [
        el('h2', { class: 'cartao-titulo', texto: 'Contratos fechados pelos agentes' }),
        legendaDoPeriodo,
      ]),
      seletor,
    ]),
    corpo,
  );
  carregar();
  /* `dados` para o PDF da pagina poder imprimir o mesmo que esta na tela, sem
     buscar de novo e correr o risco de imprimir outro recorte. */
  return { no: raiz, dados: () => dados };
}
