import { api } from '../api.js';
import { seletorPeriodo } from '../componentes.js';
import { aviso, botao, cartao, el, limpar, numero, plural, selo, vazio } from '../ui.js';
import { pintarAgenteDeRelatorios } from './relatorio-do-agente.js';
import { blocoContratosPorMes } from './contratos-por-mes.js';

/**
 * Relatorios: quantos contratos os agentes e as pessoas fecharam.
 *
 * "Fechado" e contrato ASSINADO em todos os blocos desta tela — uma definicao
 * so, senao dois numeros diferentes na mesma pagina viram duas verdades.
 *
 * Tres blocos, nesta ordem (arrumada a pedido do escritorio em 11/11/2026):
 *
 *   1. os agentes mes a mes (contratos-por-mes.js), que e o acompanhamento de
 *      sempre e tem periodo proprio, em meses;
 *   2. quem fechou no periodo escolhido: duas tabelas, nao uma — a pessoa que
 *      aprovou e mandou o link, e o agente de IA que conduziu. O mesmo
 *      contrato tem as duas maos, e somar tudo num balde so contaria em dobro
 *      (ver servidor/rotas/relatorios.js);
 *   3. o relatorio do fim de semana, escrito pela IA (relatorio-do-agente.js).
 *
 * CADA BLOCO DIZ DE QUE PERIODO FALA e carrega o proprio controle. Na barra do
 * topo ficam so as saidas, planilha e PDF, que valem para a pagina inteira e
 * levam o que a tela esta mostrando.
 */
export async function paginaRelatorios({ definirAcoes = () => {} } = {}) {
  /*
   * A ORDEM DOS BLOCOS e a ordem da pergunta que o escritorio faz ao abrir a
   * tela (arrumada a pedido dele em 11/11/2026):
   *
   *   1. os agentes, mes a mes — o acompanhamento de sempre;
   *   2. quem fechou no periodo escolhido — a conferencia pontual;
   *   3. o relatorio do fim de semana, escrito pela IA — leitura de segunda.
   *
   * Antes o relatorio da IA abria a tela e empurrava os numeros para baixo, e
   * o seletor de datas morava na barra do topo valendo so para o bloco 2 —
   * com o bloco 1 tendo periodo proprio, em meses. Dava para ler dois totais
   * diferentes na mesma tela sem nada explicando a diferenca. Agora CADA BLOCO
   * CARREGA O PROPRIO CONTROLE E DIZ DE QUE PERIODO FALA; na barra do topo
   * ficam so as saidas (planilha e PDF), que valem para a pagina inteira.
   */
  const raiz = el('div');
  const mensal = blocoContratosPorMes();
  const areaDoAgente = el('div');
  const container = el('div', { class: 'mb-4' });
  raiz.append(mensal.no, container, areaDoAgente);

  const hoje = new Date();
  const trintaDias = new Date(hoje.getTime() - 29 * 24 * 60 * 60 * 1000);
  let filtro = { de: iso(trintaDias), ate: iso(hoje) };
  let ultimo = null;

  const seletor = seletorPeriodo({
    de: filtro.de,
    ate: filtro.ate,
    aoAplicar: (f) => {
      filtro = { de: f.de || '', ate: f.ate || '' };
      carregar();
    },
  });
  const botaoPlanilha = botao('Planilha', { icone: 'baixo', pequeno: true, aoClicar: baixarPlanilha });
  const botaoPdf = botao('PDF', { icone: 'contrato', pequeno: true, aoClicar: imprimirPdf });
  definirAcoes(botaoPlanilha, botaoPdf);

  async function carregar() {
    limpar(container);
    container.append(el('div', { class: 'painel-bloco t-sm c-fraco', texto: 'Carregando…' }));
    try {
      ultimo = await api.get('/api/relatorios/contratos', { de: filtro.de, ate: filtro.ate });
      pintar(ultimo);
    } catch (erro) {
      limpar(container);
      container.append(vazio('Nao consegui carregar o relatorio', erro.message, botao('Tentar de novo', { aoClicar: carregar })));
    }
  }

  function tabela(titulo, ajuda, grupo, rotuloColuna) {
    const linhas = grupo.lista.map((x) =>
      el('div', { class: 'lista-item' }, [
        el('div', { class: 'corpo' }, [el('div', { class: 'titulo', texto: x.nome })]),
        /* plural() ja escreve o numero ("5 contratos"): o numero() na frente
           fazia o selo sair "5 5 contratos" nas duas tabelas. */
        selo(plural(x.quantidade, 'contrato', 'contratos'), 'ouro'),
      ]),
    );
    if (grupo.semAtribuicao) {
      linhas.push(
        el('div', { class: 'lista-item' }, [
          el('div', { class: 'corpo' }, [el('div', { class: 'titulo c-suave', texto: rotuloColuna })]),
          selo(plural(grupo.semAtribuicao, 'contrato', 'contratos'), ''),
        ]),
      );
    }
    const corpo = linhas.length ? el('div', { class: 'lista-simples' }, linhas) : vazio('Nada no periodo', 'Nenhum contrato assinado aqui ainda.');
    return cartao(titulo, ajuda, corpo);
  }

  /** "de 13/10/2026 a 11/11/2026", ou o que o seletor estiver dizendo. */
  function periodoEmTexto(periodo) {
    if (periodo.de && periodo.ate) return `de ${brData(periodo.de)} a ${brData(periodo.ate)}`;
    if (periodo.de) return `a partir de ${brData(periodo.de)}`;
    if (periodo.ate) return `até ${brData(periodo.ate)}`;
    return 'em todo o período';
  }

  function pintar(dados) {
    limpar(container);
    container.append(
      el('div', { class: 'bloco-cabeca' }, [
        el('div', { class: 'bloco-cabeca-texto' }, [
          el('h2', { class: 'cartao-titulo', texto: 'Quem fechou no período escolhido' }),
          el('p', {
            class: 'bloco-legenda',
            texto: `Contratos assinados ${periodoEmTexto(dados.periodo)}. O mesmo contrato aparece nas duas listas: a pessoa que aprovou e o agente que conduziu.`,
          }),
        ]),
        seletor,
      ]),
      /* .metrica/.valor/.rotulo sao as classes que existem no tema; antes este
         cartao pedia .metrica-cartao/.metrica-valor/.metrica-rotulo, que nunca
         foram escritas no tema.css — o total saia sem estilo nenhum, como texto
         solto. Mesma forma do painel e do bloco mensal logo acima. */
      el('div', { class: 'metricas mb-4' }, [
        el('div', { class: 'metrica metrica-sem-linha', estilo: { '--metrica-cor': 'var(--ouro)' } }, [
          el('div', { class: 'metrica-topo' }, [el('span', { class: 'nome', texto: 'Neste período' })]),
          el('div', { class: 'metrica-numeros' }, [el('div', { class: 'valor', texto: numero(dados.total) })]),
          el('div', { class: 'rotulo', texto: `${plural(dados.total, 'contrato assinado', 'contratos assinados')}` }),
        ]),
      ]),
      el('div', { class: 'grade g2' }, [
        tabela('Por pessoa', 'Quem conferiu a ficha e enviou o link de assinatura.', dados.porPessoa, 'Aprovado pelo sistema'),
        tabela('Por agente de IA', 'O agente que pediu o contrato e conduziu o atendimento.', dados.porAgente, 'Criado a mão (sem agente)'),
      ]),
    );
  }

  async function baixarPlanilha() {
    try {
      const { csv } = await api.get('/api/relatorios/contratos.csv', { de: filtro.de, ate: filtro.ate });
      const blob = new Blob([`﻿${csv}`], { type: 'text/csv;charset=utf-8' });
      const link = el('a', { href: URL.createObjectURL(blob), download: `contratos-correia-${iso(hoje)}.csv` });
      link.click();
      URL.revokeObjectURL(link.href);
      aviso('Planilha baixada.', 'sucesso');
    } catch (erro) {
      aviso(`Nao consegui gerar a planilha: ${erro.message}`, 'erro');
    }
  }

  /**
   * A tabela de meses no papel: uma linha por agente, uma coluna por mes.
   *
   * Sai do mesmo `dados` que o bloco da tela desenhou (mensal.dados()), e nao
   * de uma busca nova: assim o papel e a tela mostram o mesmo recorte, mesmo
   * que alguem troque o seletor de meses entre uma coisa e outra.
   */
  function tabelaMensalEmHtml(m) {
    if (!m || !m.totais?.total) return '';
    const totalDoMes = (mes) => m.serie.find((l) => l.periodo === mes)?.__total || 0;
    const celulas = (valores) => valores.map((v) => `<td class="n">${v}</td>`).join('');
    const linha = (nome, valores, classe = '') =>
      `<tr${classe ? ` class="${classe}"` : ''}><td>${escapar(nome)}</td>${celulas(valores)}</tr>`;
    return `
      <h2>Contratos por agente, mês a mês</h2>
      <div class="sub">${escapar(mesPorExtensoCurto(m.meses[0]))} a ${escapar(mesPorExtensoCurto(m.meses[m.meses.length - 1]))}</div>
      <table class="mensal">
        <thead><tr><th>Agente</th>${m.meses.map((x) => `<th class="n">${escapar(mesCurtoPdf(x))}</th>`).join('')}<th class="n">Total</th></tr></thead>
        <tbody>
          ${m.agentes.map((a) => linha(a.nome, [...m.meses.map((mes) => a.porMes[mes] || 0), a.total])).join('')}
          ${m.semAgente.total ? linha('Criado à mão (sem agente)', [...m.meses.map((mes) => m.semAgente.porMes[mes] || 0), m.semAgente.total], 'fraco') : ''}
        </tbody>
        <tfoot>${linha('Total do mês', [...m.meses.map(totalDoMes), m.totais.total])}</tfoot>
      </table>`;
  }

  /*
   * PDF sem dependencia nova: abre uma janela so com o relatorio, com o timbre
   * do escritorio, e chama a impressao do navegador — de onde a pessoa salva
   * como PDF ou manda para a impressora. Monta a partir do ULTIMO carregado,
   * para o papel bater com a tela.
   *
   * Leva os DOIS blocos, na ordem da tela. Ate 11/11/2026 saia so o recorte por
   * periodo: quem imprimia depois de olhar o mes a mes recebia um papel que nao
   * tinha o que ele acabara de ler, com um total diferente e sem explicacao.
   */
  function imprimirPdf() {
    if (!ultimo) return;
    const mensal12 = mensal.dados();
    const periodo = ultimo.periodo.de || ultimo.periodo.ate ? `${brData(ultimo.periodo.de) || 'início'} a ${brData(ultimo.periodo.ate) || 'hoje'}` : 'Todo o período';
    const bloco = (titulo, grupo, rotuloSem) => `
      <h2>${escapar(titulo)}</h2>
      <table>
        <thead><tr><th>Nome</th><th class="n">Contratos</th></tr></thead>
        <tbody>
          ${grupo.lista.map((x) => `<tr><td>${escapar(x.nome)}</td><td class="n">${x.quantidade}</td></tr>`).join('')}
          ${grupo.semAtribuicao ? `<tr class="fraco"><td>${escapar(rotuloSem)}</td><td class="n">${grupo.semAtribuicao}</td></tr>` : ''}
          ${!grupo.lista.length && !grupo.semAtribuicao ? '<tr><td colspan="2" class="fraco">Nenhum contrato no período.</td></tr>' : ''}
        </tbody>
      </table>`;
    const html = `<!doctype html><html lang="pt-BR"><head><meta charset="utf-8">
      <title>Contratos fechados — Correia Advogados</title>
      <style>
        * { box-sizing: border-box; }
        body { font: 14px/1.5 -apple-system, Segoe UI, Roboto, sans-serif; color: #141414; margin: 32px; }
        header { display: flex; align-items: center; gap: 16px; border-bottom: 2px solid #141414; padding-bottom: 12px; margin-bottom: 20px; }
        header img { height: 48px; width: auto; flex: none; }
        h1 { font-size: 20px; margin: 0; }
        .sub { color: #555; margin-top: 4px; }
        .total { font-size: 32px; font-weight: 700; margin: 8px 0 24px; }
        h2 { font-size: 15px; margin: 24px 0 8px; }
        table { width: 100%; border-collapse: collapse; }
        th, td { text-align: left; padding: 8px 10px; border-bottom: 1px solid #ddd; }
        th.n, td.n { text-align: right; width: 120px; }
        thead th { background: #f3f3f3; }
        .fraco td { color: #888; }
        /* A tabela de meses tem ate 25 colunas: fonte menor e respiro curto,
           senao ela estoura a largura do papel e o navegador corta a direita. */
        table.mensal { font-size: 11px; }
        table.mensal th, table.mensal td { padding: 4px 5px; }
        table.mensal th.n, table.mensal td.n { width: auto; }
        tfoot td { font-weight: 700; border-top: 2px solid #141414; }
        footer { margin-top: 32px; color: #999; font-size: 12px; }
        @media print {
          body { margin: 0; }
          /* O recorte por periodo comeca em folha nova: os dois blocos falam de
             periodos diferentes, e emendados na mesma pagina seriam lidos como
             continuacao um do outro. */
          .quebra { break-before: page; }
          table { break-inside: avoid; }
        }
      </style></head><body>
      <header>
        <img src="${location.origin}/assets/logo.png" alt="" onerror="this.remove()">
        <div>
          <h1>Correia Advogados — Contratos fechados</h1>
          <div class="sub">Contratos assinados · gerado em ${brData(iso(new Date()))}</div>
        </div>
      </header>
      ${tabelaMensalEmHtml(mensal12)}
      <h2 class="quebra">Quem fechou de ${escapar(periodo)}</h2>
      <div class="total">${ultimo.total} ${ultimo.total === 1 ? 'contrato assinado' : 'contratos assinados'}</div>
      ${bloco('Por pessoa (quem aprovou e enviou)', ultimo.porPessoa, 'Aprovado pelo sistema')}
      ${bloco('Por agente de IA (quem conduziu)', ultimo.porAgente, 'Criado à mão (sem agente)')}
      <footer>Gerado em ${brData(iso(new Date()))} pelo Atilhus Chat.</footer>
      </body></html>`;

    const janela = window.open('', '_blank');
    if (!janela) {
      aviso('O navegador bloqueou a janela de impressão. Permita pop-ups para gerar o PDF.', 'erro');
      return;
    }
    janela.document.write(html);
    janela.document.close();
    janela.focus();
    /* Um respiro para a janela renderizar antes do dialogo de impressao. */
    setTimeout(() => janela.print(), 300);
  }

  pintarAgenteDeRelatorios(areaDoAgente).catch(() => {});
  await carregar();
  return raiz;
}

function iso(data) {
  const mes = String(data.getMonth() + 1).padStart(2, '0');
  const dia = String(data.getDate()).padStart(2, '0');
  return `${data.getFullYear()}-${mes}-${dia}`;
}

/* "2026-11" -> "nov/26" e "novembro de 2026". Iguais aos do bloco da tela
   (contratos-por-mes.js), repetidos aqui porque o PDF monta HTML cru, fora do
   DOM, e nao tem como reaproveitar a montagem de elemento de la. */
const MESES_PDF = ['jan', 'fev', 'mar', 'abr', 'mai', 'jun', 'jul', 'ago', 'set', 'out', 'nov', 'dez'];
const MESES_PDF_LONGO = ['janeiro', 'fevereiro', 'março', 'abril', 'maio', 'junho', 'julho', 'agosto', 'setembro', 'outubro', 'novembro', 'dezembro'];

function mesCurtoPdf(periodo) {
  const [ano, mes] = String(periodo || '').split('-');
  const i = Number(mes) - 1;
  return MESES_PDF[i] ? `${MESES_PDF[i]}/${String(ano).slice(2)}` : periodo || '';
}

function mesPorExtensoCurto(periodo) {
  const [ano, mes] = String(periodo || '').split('-');
  const i = Number(mes) - 1;
  return MESES_PDF_LONGO[i] ? `${MESES_PDF_LONGO[i]} de ${ano}` : periodo || '';
}

function brData(iso) {
  if (!iso) return '';
  const [a, m, d] = String(iso).slice(0, 10).split('-');
  return d && m && a ? `${d}/${m}/${a}` : '';
}

function escapar(texto) {
  return String(texto || '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
}
