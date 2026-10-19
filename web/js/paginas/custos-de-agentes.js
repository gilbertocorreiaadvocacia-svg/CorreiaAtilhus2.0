import { api } from '../api.js';
import { cartaoComDica, seletorPeriodo } from '../componentes.js';
import { el, limpar, numero, selo } from '../ui.js';

/**
 * Custos por agente: quanto credito cada agente consumiu no periodo, quantas
 * vezes ele respondeu e o tempo medio de cada resposta.
 *
 * A mesma base (GET /api/agentes/custos, servidor/nucleo/creditos.js:
 * custoPorAgente) ja existia desde o rastreio de credito por agente — essa
 * tela e so a visao de ranking que faltava, para alem do detalhe por lead ja
 * mostrado em Atendimento.
 */
export async function paginaCustosDeAgentes() {
  const container = el('div');
  let filtro = { de: null, ate: null };

  async function carregar() {
    const linhas = await api.get('/api/agentes/custos', filtro);
    limpar(container);

    const lista = el('div', { class: 'lista-simples' });
    for (const linha of linhas) {
      lista.append(
        el('div', { class: 'lista-item' }, [
          el('div', { class: 'corpo' }, [
            el('div', { class: 'titulo', texto: linha.agenteNome }),
            el('div', {
              class: 'desc',
              texto: `${numero(linha.chamadas)} resposta${linha.chamadas === 1 ? '' : 's'}${linha.duracaoMediaMs ? ` · ${duracaoCurta(linha.duracaoMediaMs)} em media` : ''}`,
            }),
          ]),
          selo(`${numero(linha.custo)} créditos`, 'ouro'),
        ]),
      );
    }
    if (!linhas.length) {
      lista.append(
        el('div', { class: 'vazio' }, [
          el('strong', { texto: 'Nenhum custo no período' }),
          el('div', { texto: 'Nenhum agente gerou crédito na janela escolhida.' }),
        ]),
      );
    }

    container.append(
      cartaoComDica(
        { titulo: 'Custo por agente', conceito: 'Quanto crédito cada agente consumiu, do mais caro para o mais barato — processamento de IA, áudio, imagem e transferências entre agentes.' },
        lista,
      ),
    );
  }

  const seletor = seletorPeriodo({
    aoAplicar: async (faixa) => {
      filtro = faixa;
      await carregar();
    },
  });

  await carregar();

  return el('div', {}, [el('div', { class: 'linha-botoes mb-4' }, [seletor]), container]);
}

function duracaoCurta(ms) {
  const segundos = ms / 1000;
  if (segundos < 60) return `${segundos.toFixed(1)}s`;
  return `${(segundos / 60).toFixed(1)}min`;
}
