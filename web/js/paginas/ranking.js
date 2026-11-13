import { api } from '../api.js';
import { seletorPeriodo } from '../componentes.js';
import { avatar, botao, cartao, el, faixa, limpar, numero, plural, selo, vazio } from '../ui.js';

/**
 * Ranking: quem fecha mais casos, e com que qualidade.
 *
 * Pedido do escritorio em 13/11/2026. Sao duas qualidades, nas palavras dele:
 * o caso fechado "com a documentacao completa e com as informacoes do caso
 * completo", e o fechado "com as documentacoes basicas".
 *
 * A tela mostra a POSICAO e os PONTOS, mas o que ela quer que se leia e a
 * COLUNA DO MEIO: quantos daqueles fechamentos vieram completos. Um ranking que
 * so conta quantidade premia quem fecha rapido e deixa a papelada para tras, e
 * e exatamente isso que o escritorio quis evitar ao pedir "por qualidade".
 *
 * O servidor decide tudo (nucleo/ranking.js); aqui so se desenha.
 */

const iso = (data) => {
  const mes = String(data.getMonth() + 1).padStart(2, '0');
  const dia = String(data.getDate()).padStart(2, '0');
  return `${data.getFullYear()}-${mes}-${dia}`;
};

/* O mes corrente: e o recorte de quem pergunta "como estamos este mes". */
function mesAtual() {
  const hoje = new Date();
  return { de: iso(new Date(hoje.getFullYear(), hoje.getMonth(), 1)), ate: iso(hoje) };
}

const NOME_DA_FALTA = { documento: 'Documento', dado: 'Dado' };

export async function paginaRanking({ definirAcoes = () => {} } = {}) {
  const raiz = el('div');
  const corpo = el('div');
  let filtro = mesAtual();
  let dados = null;

  const seletor = seletorPeriodo({
    de: filtro.de,
    ate: filtro.ate,
    aoAplicar: (f) => {
      filtro = { de: f.de || '', ate: f.ate || '' };
      carregar();
    },
  });
  definirAcoes(seletor);

  async function carregar() {
    limpar(corpo);
    corpo.append(el('div', { class: 'painel-bloco t-sm c-fraco', texto: 'Carregando…' }));
    try {
      dados = await api.get('/api/ranking', { de: filtro.de, ate: filtro.ate });
      pintar();
    } catch (erro) {
      limpar(corpo);
      corpo.append(vazio('Não consegui carregar o ranking', erro.message, botao('Tentar de novo', { aoClicar: carregar })));
    }
  }

  /* A tabela de posicoes. `rotuloDeQuem` muda entre pessoa e agente porque a
     mesma tabela serve aos dois, e chamar um agente de "pessoa" na coluna seria
     mentira na tela. */
  function tabela(linhas, rotuloDeQuem) {
    if (!linhas.length) {
      return vazio('Ninguém pontuou neste período', 'Assim que um caso entrar na coluna de contrato fechado, ele aparece aqui.');
    }
    const cabecalho = el('tr', {}, [
      el('th', { class: 'ranking-posicao', texto: '#' }),
      el('th', { texto: rotuloDeQuem }),
      el('th', { class: 'n', title: 'Casos fechados com toda a documentação e os dados que o tipo de caso exige', texto: 'Completos' }),
      el('th', { class: 'n', title: 'Casos fechados em que faltou documento ou dado', texto: 'Básicos' }),
      el('th', { class: 'n', texto: 'Fechados' }),
      el('th', { class: 'n', texto: 'Pontos' }),
    ]);

    const maior = linhas[0]?.pontos || 1;
    const corpoTabela = linhas.map((linha) => {
      /* A barra atras do nome mostra a distancia para o primeiro: numa lista de
         numeros, a diferenca entre 31 e 28 pontos nao salta, e e ela que diz se
         a disputa esta acirrada ou decidida. */
      const proporcao = Math.max(4, Math.round((linha.pontos / maior) * 100));
      return el('tr', { class: linha.posicao <= 3 ? 'ranking-podio' : '' }, [
        el('td', { class: 'ranking-posicao', texto: String(linha.posicao) }),
        el('td', {}, [
          el('span', { class: 'ranking-quem' }, [
            avatar({ id: linha.id, nome: linha.nome }, 26),
            el('span', { class: 'cortar', texto: linha.nome }),
          ]),
          el('span', { class: 'ranking-barra', estilo: { '--parte': `${proporcao}%` }, 'aria-hidden': 'true' }),
        ]),
        el('td', { class: 'n' }, [linha.completos ? selo(String(linha.completos), 'sucesso') : el('span', { class: 'c-fraco', texto: '–' })]),
        el('td', { class: 'n' }, [linha.basicos ? selo(String(linha.basicos), '') : el('span', { class: 'c-fraco', texto: '–' })]),
        el('td', { class: 'n', texto: numero(linha.fechados) }),
        el('td', { class: 'n forte', texto: numero(linha.pontos) }),
      ]);
    });

    return el('div', { class: 'tabela-rolagem' }, [
      el('table', { class: 'tabela tabela-ranking' }, [el('thead', {}, [cabecalho]), el('tbody', {}, corpoTabela)]),
    ]);
  }

  function pintar() {
    limpar(corpo);
    const { totais, pontos, pessoas, agentes, faltas } = dados;

    /*
     * O aviso da regua.
     *
     * Enquanto o escritorio nao conferir a lista de exigencias, o que separa
     * "completo" de "basico" e um palpite do sistema — e um ranking que julga
     * gente por regua que ninguem conferiu nao pode parecer oficial. O aviso
     * sai sozinho assim que alguem salvar a lista.
     */
    if (!dados.reguaConferida) {
      corpo.append(
        faixa(
          'A régua do que é um caso "completo" ainda é a sugestão do sistema. Confira a lista de documentos e dados de cada tipo de caso em Configurações → Ranking antes de usar estes números para cobrar alguém.',
          { tipo: 'alerta', iconeNome: 'alerta' },
        ),
      );
    }

    corpo.append(
      el('div', { class: 'metricas mb-4' }, [
        el('div', { class: 'metrica metrica-sem-linha', estilo: { '--metrica-cor': 'var(--ouro)' } }, [
          el('div', { class: 'metrica-topo' }, [el('span', { class: 'nome', texto: 'Fechados no período' })]),
          el('div', { class: 'metrica-numeros' }, [el('div', { class: 'valor', texto: numero(totais.fechados) })]),
          el('div', { class: 'rotulo', texto: `${plural(totais.completos, 'completo', 'completos')} e ${plural(totais.basicos, 'básico', 'básicos')}` }),
        ]),
        el('div', { class: 'metrica metrica-sem-linha', estilo: { '--metrica-cor': 'var(--sucesso)' } }, [
          el('div', { class: 'metrica-topo' }, [el('span', { class: 'nome', texto: 'Completos' })]),
          el('div', { class: 'metrica-numeros' }, [
            el('div', { class: 'valor', texto: totais.fechados ? `${Math.round((totais.completos / totais.fechados) * 100)}%` : '–' }),
          ]),
          el('div', { class: 'rotulo', texto: 'dos fechamentos vieram com tudo' }),
        ]),
        el('div', { class: 'metrica metrica-sem-linha' }, [
          el('div', { class: 'metrica-topo' }, [el('span', { class: 'nome', texto: 'Valendo' })]),
          el('div', { class: 'metrica-numeros' }, [el('div', { class: 'valor', texto: `${pontos.completo} / ${pontos.basico}` })]),
          el('div', { class: 'rotulo', texto: 'pontos por completo e por básico' }),
          totais.semAtribuicao
            ? el('div', { class: 'nota', texto: `${plural(totais.semAtribuicao, 'fechamento não pontuou', 'fechamentos não pontuaram')}: sem registro de quem fechou` })
            : null,
        ]),
      ]),
    );

    corpo.append(cartao('Ranking da equipe', 'Quem fechou, e quantos vieram completos.', tabela(pessoas, 'Pessoa')));

    if (agentes.length) {
      corpo.append(
        el('div', { class: 'mt-4' }, [
          cartao(
            'Por agente de IA',
            'O agente que conduziu o atendimento até o fechamento. Não disputa com a equipe: é o mesmo caso visto do outro lado.',
            tabela(agentes, 'Agente'),
          ),
        ]),
      );
    }

    /* O que mais falta: e com isto que se melhora a qualidade, em vez de so
       cobrar o numero de quem ficou atras. */
    if (faltas.length) {
      corpo.append(
        el('div', { class: 'mt-4' }, [
          cartao(
            'O que mais faltou',
            'Nos casos fechados como básicos, no período.',
            el(
              'div',
              { class: 'lista-simples' },
              faltas.map((falta) =>
                el('div', { class: 'lista-item' }, [
                  el('div', { class: 'corpo' }, [
                    el('div', { class: 'titulo', texto: falta.nome }),
                    el('div', { class: 'desc', texto: NOME_DA_FALTA[falta.tipo] || falta.tipo }),
                  ]),
                  selo(plural(falta.vezes, 'caso', 'casos'), ''),
                ]),
              ),
            ),
          ),
        ]),
      );
    }

    if (totais.semTipoDeCaso) {
      corpo.append(
        el('p', { class: 'rodape-nota mt-2' }, [
          document.createTextNode(
            `${plural(totais.semTipoDeCaso, 'caso foi fechado', 'casos foram fechados')} sem tipo de caso marcado. Sem o tipo não dá para exigir documento nenhum, então contam como básicos.`,
          ),
        ]),
      );
    }
  }

  raiz.append(corpo);
  await carregar();
  return raiz;
}
