import { api } from '../api.js';
import { cartaoComDica, dica } from '../componentes.js';
import { aviso, botao, cartao, el, icone, limpar, numero, selecao, vazio } from '../ui.js';

/**
 * Dashboard de pos-venda.
 *
 * Nao e um segundo funil. Depois do contrato assinado ninguem converte para
 * lugar nenhum, e contar etapa aqui responderia uma pergunta que ninguem faz.
 * A pergunta do pos-venda e outra: **o que esta parado e o que vence**.
 *
 * Caso parado nao aparece em contagem nenhuma. Ele simplesmente nao se mexe:
 * some da caixa de entrada, some do funil, e reaparece no dia em que o cliente
 * liga perguntando. Esta tela existe para ele aparecer antes disso.
 */

/* As quatro faixas de idade, na ordem, com a cor subindo junto do problema.
   A ultima nao tem teto: e onde mora o caso esquecido, e por isso e a unica
   que usa a cor de erro. */
const CORES_FAIXA = {
  ate7: 'var(--sucesso)',
  ate30: 'var(--serie-3)',
  ate60: 'var(--alerta)',
  mais60: 'var(--erro)',
};

/* Os quatro numeros do topo. `sentido` diz se subir e bom: sem ele, uma alta
   de casos parados sairia pintada de verde. */
const CARTOES = [
  {
    chave: 'ativos',
    nome: 'Casos ativos',
    icone: 'contrato',
    cor: 'var(--sucesso)',
    conceito: 'Contratos assinados cujo atendimento ainda nao foi concluido. O caso entra aqui quando assina, e nao quando alguem lembra de mudar o departamento.',
  },
  {
    chave: 'parados',
    nome: 'Parados',
    icone: 'relogio',
    cor: 'var(--alerta)',
    conceito: 'Casos sem mudar de etapa ha mais tempo que o corte escolhido na barra. Conversa que troca "bom dia" toda semana sem sair do lugar continua parada: o que conta e o movimento de etapa.',
  },
  {
    chave: 'vencendo',
    nome: 'Prazos',
    icone: 'alerta',
    cor: 'var(--erro)',
    conceito: 'Tarefas com prazo nos proximos 7 dias, mais as que ja venceram. Vencida entra no topo: prazo que passou e mais urgente que prazo de amanha.',
  },
  {
    chave: 'semResponsavel',
    nome: 'Sem responsavel',
    icone: 'usuarios',
    cor: 'var(--serie-6)',
    conceito: 'Caso ativo que nao esta no nome de ninguem. E o que mais some, porque nao aparece na lista de nenhuma pessoa.',
  },
];

/** Corte de "parado", em dias. Sem numero certo: quem escolhe e o escritorio. */
const CORTES = [7, 15, 30, 60, 90];

export async function paginaPosVenda({ definirAcoes = () => {} } = {}) {
  const container = el('div');
  const corpo = el('div');

  const filtro = { limite: 30 };
  let dados = null;
  let falha = '';
  let sequencia = 0;

  async function carregar() {
    const meu = (sequencia += 1);
    corpo.setAttribute('aria-busy', 'true');
    try {
      const resposta = await api.get('/api/pos-venda', filtro);
      if (meu !== sequencia) return;
      dados = resposta;
      falha = '';
    } catch (erro) {
      if (meu !== sequencia) return;
      falha = erro.message;
      aviso(erro.message, 'erro');
    }
    pintar();
  }

  function pintar() {
    corpo.removeAttribute('aria-busy');
    limpar(corpo);

    if (falha) {
      const repetir = botao('Tentar de novo', { pequeno: true, icone: 'atualizar', aoClicar: () => carregar() });
      repetir.classList.add('mt-3');
      corpo.append(vazio('Nao consegui carregar os casos', `${falha.endsWith('.') ? falha : falha + '.'}`, repetir));
      return;
    }
    if (!dados) return;

    /* Sem contrato assinado nao ha pos-venda nenhum, e mostrar quatro zeros com
       tres graficos vazios se le como defeito da tela. */
    if (!dados.cards.ativos) {
      corpo.append(
        vazio(
          'Nenhum caso no pos-venda',
          'O caso entra aqui quando um status do tipo Sucesso e aplicado, ou seja, quando o contrato e assinado. Nenhuma conversa chegou la ainda.',
        ),
      );
      return;
    }

    for (const parte of [secaoCartoes(dados), secaoEtapas(dados), secaoParados(dados, filtro), secaoPrazos(dados)]) {
      if (parte) corpo.append(parte);
    }
  }

  const corte = selecao(
    CORTES.map((d) => ({ valor: String(d), rotulo: `Parado ha mais de ${d} dias` })),
    String(filtro.limite),
    {
      aoChange: (evento) => {
        filtro.limite = Number(evento.target.value);
        carregar();
      },
    },
  );

  definirAcoes([corte]);
  container.append(corpo);
  await carregar();
  return container;
}

/* Secao A, os quatro numeros ---------------------------------------- */

function secaoCartoes(dados) {
  return secao(
    'Situacao dos casos',
    null,
    el(
      'div',
      { class: 'metricas' },
      CARTOES.map((definicao) => {
        const total = Number(dados.cards[definicao.chave]) || 0;
        const marca = icone(definicao.icone, 15);
        marca.style.color = definicao.cor;
        return el('div', { class: 'metrica', estilo: { '--metrica-cor': definicao.cor } }, [
          el('div', { class: 'metrica-topo' }, [
            marca,
            el('span', { class: 'nome', texto: definicao.nome }),
            dica(definicao.conceito, { assunto: definicao.nome }),
          ]),
          el('div', { class: 'metrica-numeros' }, [el('div', { class: 'valor', texto: numero(total) })]),
        ]);
      }),
    ),
  );
}

/* Secao B, envelhecimento por etapa ---------------------------------- */

/**
 * Quanto tempo os casos estao parados em cada etapa.
 *
 * E o coracao da tela. Uma contagem simples por etapa diria "8 em Documentacao"
 * e pareceria saudavel; a mesma etapa com 6 dos 8 acima de 60 dias e outra
 * historia completamente diferente, e e essa que faz alguem agir.
 *
 * A barra e empilhada e proporcional ao total da etapa, nao ao maior total:
 * o que importa aqui e a PROPORCAO envelhecida dentro da etapa, e nao qual
 * etapa tem mais caso, que ja esta escrito ao lado em numero.
 */
function secaoEtapas(dados) {
  const linhas = dados.etapas.map((etapa) => {
    const barra = el('div', { class: 'barra-idade' });
    for (const faixa of dados.faixas) {
      const quantos = Number(etapa.faixas[faixa.chave]) || 0;
      if (!quantos) continue;
      const fatia = (quantos / etapa.total) * 100;

      /*
       * O numero vai DENTRO da faixa quando ha largura para ele.
       *
       * As quatro cores sao semanticas (verde passa a vermelho conforme
       * envelhece) e por isso ficam perto demais entre si: medidas, as
       * vizinhas dao 1,4:1, e sob daltonismo verde-vermelho caem para 1,2:1.
       * Quem nao separa essas cores via uma mancha continua. Com o numero
       * escrito, a cor vira reforco e nao a unica informacao.
       *
       * Abaixo de 14% nao cabe algarismo sem cortar; ali sobram o separador,
       * a ordem fixa e o balao ao passar o mouse.
       */
      const cabe = fatia >= 14;
      barra.append(
        el(
          'span',
          {
            class: 'pedaco-idade',
            estilo: { width: `${fatia}%`, background: CORES_FAIXA[faixa.chave] },
            title: `${quantos} ${quantos === 1 ? 'caso' : 'casos'}, ${faixa.rotulo}`,
          },
          cabe ? [el('span', { texto: String(quantos) })] : [],
        ),
      );
    }

    return el('div', { class: 'linha-etapa' }, [
      el('div', { class: 'etapa-nome' }, [
        el('span', { class: 'ponto', estilo: { background: etapa.cor } }),
        el('span', { texto: etapa.nome }),
      ]),
      barra,
      el('div', { class: 'etapa-numeros' }, [
        el('b', { texto: numero(etapa.total) }),
        el('span', { class: 'c-fraco', texto: `mais antigo ${etapa.maisAntigoDias}d` }),
      ]),
    ]);
  });

  const legenda = el(
    'div',
    { class: 'rosca-legenda' },
    dados.faixas.map((faixa) =>
      el('span', {}, [
        el('span', { class: 'ponto', estilo: { background: CORES_FAIXA[faixa.chave] } }),
        document.createTextNode(faixa.rotulo),
      ]),
    ),
  );

  const caixa = cartaoComDica(
    {
      titulo: 'Ha quanto tempo estao parados',
      conceito:
        'A barra e a proporcao dentro da propria etapa, e nao entre etapas. Oito casos em Documentacao parece saudavel; seis deles acima de 60 dias e outra historia, e e essa que a barra mostra. O tempo conta do ultimo movimento de etapa, nao da ultima mensagem.',
    },
    el('div', { class: 'lista-etapas' }, linhas),
  );
  caixa.append(legenda);

  return secao('Onde os casos estao', null, caixa);
}

/* Secao C, a lista do que resolver ----------------------------------- */

function secaoParados(dados, filtro) {
  if (!dados.parados.length) {
    return secao(
      'O que esta parado',
      null,
      el('div', { class: 'cartao' }, [
        el('strong', { texto: 'Nenhum caso parado.' }),
        el('p', {
          class: 'c-suave',
          texto: `Todos os casos ativos mudaram de etapa nos ultimos ${filtro.limite} dias. Baixe o corte na barra do topo para olhar mais de perto.`,
        }),
      ]),
    );
  }

  const lista = el(
    'div',
    { class: 'lista-simples' },
    dados.parados.map((caso) =>
      el('div', { class: 'lista-item' }, [
        el('span', { class: 'ponto', estilo: { background: caso.cor } }),
        el('div', { class: 'corpo' }, [
          el('div', { class: 'titulo', texto: caso.nome }),
          el('div', {
            class: 'desc',
            /* Etapa, responsavel e ultimo contato na mesma linha: sao as tres
               coisas que decidem o que fazer com o caso, e separadas em linhas
               a lista de 25 viraria uma pagina inteira de rolagem. */
            texto: [
              caso.etapa,
              caso.responsavel || 'sem responsavel',
              caso.ultimaMensagemDias !== null ? `ultima mensagem ha ${caso.ultimaMensagemDias}d` : 'sem mensagem',
            ].join(' · '),
          }),
        ]),
        el('span', { class: 'dias-parado', texto: `${caso.dias}d` }),
      ]),
    ),
  );

  /* A explicacao vai no titulo da secao, e nao num cartao com titulo proprio:
     "O que esta parado" ja nomeia o conteudo, e um segundo titulo dentro do
     cartao repetiria a mesma frase uma linha abaixo. */
  return secao(
    'O que esta parado',
    el('span', {}, [
      el('span', { class: 'contagem-secao', texto: String(dados.cards.parados) }),
      dica('Do mais parado para o menos, que e a ordem em que se resolve. A lista mostra os 25 primeiros.', {
        assunto: 'a lista de casos parados',
      }),
    ]),
    el('div', { class: 'cartao' }, [lista]),
  );
}

/* Secao D, prazos ---------------------------------------------------- */

function secaoPrazos(dados) {
  if (!dados.vencendo.length) return null;

  const lista = el(
    'div',
    { class: 'lista-simples' },
    dados.vencendo.map((prazo) =>
      el('div', { class: `lista-item${prazo.vencida ? ' prazo-vencido' : ''}` }, [
        el('div', { class: 'corpo' }, [
          el('div', { class: 'titulo', texto: prazo.titulo }),
          el('div', { class: 'desc', texto: prazo.contato || 'sem conversa vinculada' }),
        ]),
        el('span', {
          class: prazo.vencida ? 'dias-parado c-erro' : 'dias-parado',
          texto: prazo.vencida
            ? `vencida ha ${Math.abs(prazo.faltamDias)}d`
            : prazo.faltamDias === 0
              ? 'vence hoje'
              : `em ${prazo.faltamDias}d`,
        }),
      ]),
    ),
  );

  return secao(
    'O que vence',
    el('span', {}, [
      el('span', { class: 'contagem-secao', texto: String(dados.vencendo.length) }),
      dica(
        'Tarefas com prazo nos proximos 7 dias e as que ja venceram. Vencida vem primeiro: prazo que passou nao da mais para adiar.',
        { assunto: 'os prazos' },
      ),
    ]),
    el('div', { class: 'cartao' }, [lista]),
  );
}

function secao(titulo, extra, ...filhos) {
  return el('section', { class: 'secao-painel' }, [
    titulo ? el('h2', {}, [titulo, extra || null]) : null,
    ...filhos,
  ]);
}
