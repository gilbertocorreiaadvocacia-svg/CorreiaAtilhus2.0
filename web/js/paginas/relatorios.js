import { api } from '../api.js';
import { seletorPeriodo } from '../componentes.js';
import { aviso, botao, cartao, el, limpar, numero, plural, selo, vazio } from '../ui.js';

/**
 * Relatorios: quantos contratos cada pessoa e cada agente de IA fecharam.
 *
 * "Fechado" e contrato ASSINADO. Duas tabelas, nao uma: a pessoa que aprovou e
 * mandou o link, e o agente de IA que conduziu — o mesmo contrato tem as duas
 * maos, e somar tudo num balde so contaria em dobro (ver servidor/rotas/
 * relatorios.js). Baixa em planilha para trabalhar os numeros e em PDF para
 * imprimir ou enviar.
 */
export async function paginaRelatorios({ definirAcoes = () => {} } = {}) {
  const container = el('div');

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
  definirAcoes(seletor, botaoPlanilha, botaoPdf);

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
        selo(`${numero(x.quantidade)} ${plural(x.quantidade, 'contrato', 'contratos')}`, 'ouro'),
      ]),
    );
    if (grupo.semAtribuicao) {
      linhas.push(
        el('div', { class: 'lista-item' }, [
          el('div', { class: 'corpo' }, [el('div', { class: 'titulo c-suave', texto: rotuloColuna })]),
          selo(`${numero(grupo.semAtribuicao)} ${plural(grupo.semAtribuicao, 'contrato', 'contratos')}`, ''),
        ]),
      );
    }
    const corpo = linhas.length ? el('div', { class: 'lista-simples' }, linhas) : vazio('Nada no periodo', 'Nenhum contrato assinado aqui ainda.');
    return cartao(titulo, ajuda, corpo);
  }

  function pintar(dados) {
    limpar(container);
    container.append(
      el('div', { class: 'metricas g1 mb-4' }, [
        el('div', { class: 'metrica-cartao' }, [
          el('div', { class: 'metrica-valor', texto: numero(dados.total) }),
          el('div', { class: 'metrica-rotulo', texto: `${plural(dados.total, 'contrato assinado', 'contratos assinados')} no período` }),
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

  /*
   * PDF sem dependencia nova: abre uma janela so com o relatorio, com o timbre
   * do escritorio, e chama a impressao do navegador — de onde a pessoa salva
   * como PDF ou manda para a impressora. Monta a partir do ULTIMO carregado,
   * para o papel bater com a tela.
   */
  function imprimirPdf() {
    if (!ultimo) return;
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
        footer { margin-top: 32px; color: #999; font-size: 12px; }
        @media print { body { margin: 0; } }
      </style></head><body>
      <header>
        <img src="${location.origin}/assets/logo.png" alt="" onerror="this.remove()">
        <div>
          <h1>Correia Advogados — Contratos fechados</h1>
          <div class="sub">Contratos assinados · ${escapar(periodo)}</div>
        </div>
      </header>
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

  await carregar();
  return container;
}

function iso(data) {
  const mes = String(data.getMonth() + 1).padStart(2, '0');
  const dia = String(data.getDate()).padStart(2, '0');
  return `${data.getFullYear()}-${mes}-${dia}`;
}

function brData(iso) {
  if (!iso) return '';
  const [a, m, d] = String(iso).slice(0, 10).split('-');
  return d && m && a ? `${d}/${m}/${a}` : '';
}

function escapar(texto) {
  return String(texto || '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
}
