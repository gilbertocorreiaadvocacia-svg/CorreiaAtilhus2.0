import { api } from '../api.js';
import { estado, ouvir } from '../estado.js';
import { cartaoComDica, dica, seletorPeriodo } from '../componentes.js';
import { funilBarras, graficoEvolucao, legenda, miniLinha, rosca, sankeyPorOrigem } from '../graficos.js';
import { aviso, botao, campo, cartao, el, icone, limpar, modal, numero, selecao, selo, vazio } from '../ui.js';

/**
 * Dashboard. A tela responde tres perguntas, nesta ordem: quanto
 * entrou e quanto avancou no periodo, como isso variou no tempo e onde o funil
 * vaza, e como a carteira esta dividida agora.
 *
 * Os cartoes seguem os tipos de status, e por isso a tela avisa quando um tipo
 * ficou sem status encaixado: sem esse encaixe o cartao fica zerado sem
 * explicacao e a conta do funil sai errada.
 */

/* Paleta de apoio para categoria sem cor cadastrada. A mesma ordem do servidor,
   para a fatia nao trocar de cor entre a rosca e a lista completa.

   Token de tema, e nao hex: com o valor fixo, a serie Proposta (creme) sobre o
   cartao branco do tema claro ficava em 1,3:1 e a linha sumia da tela. Os
   valores dos dois temas estao em web/css/tema.css. */
const PALETA = [
  'var(--serie-1)',
  'var(--serie-2)',
  'var(--serie-3)',
  'var(--serie-4)',
  'var(--serie-5)',
  'var(--serie-6)',
  'var(--serie-7)',
  'var(--serie-8)',
];
const COR_SEM_CATEGORIA = 'var(--texto-fraco)';

/** Perdas nao e um tipo unico: e a soma dos tres desfechos negativos. */
const CHAVES_PERDA = ['desqualificado', 'recusada', 'desistencia'];

/* A cor acompanha o funil, do degrau mais claro da rampa ao ouro da marca, e
   so entao muda de familia nos dois desfechos: jade fecha, terracota perde.
   Assim os seis numeros do topo se leem como uma escada, e nao como seis cores
   sorteadas. A ordem anterior comecava no meio da rampa e terminava no degrau
   mais escuro, que apagava justamente o numero de Proposta. */
const CARTOES = [
  { chave: 'nova', nome: 'Nova conversa', icone: 'conversas', corPadrao: 'var(--serie-1)', sentido: 1 },
  { chave: 'analise', nome: 'Analise', icone: 'lupa', corPadrao: 'var(--serie-2)', sentido: 1 },
  { chave: 'qualificado', nome: 'Qualificado', icone: 'ok', corPadrao: 'var(--serie-3)', sentido: 1 },
  { chave: 'proposta', nome: 'Proposta', icone: 'templates', corPadrao: 'var(--serie-4)', sentido: 1 },
  { chave: 'sucesso', nome: 'Sucesso', icone: 'contrato', corPadrao: 'var(--sucesso)', sentido: 1 },
  /* Aqui subir e ruim. Sem este sinal, uma alta de perdas sairia pintada de
     verde, que e o oposto do que aconteceu. */
  { chave: 'perdas', nome: 'Perdas', icone: 'fechar', corPadrao: 'var(--erro)', sentido: -1 },
];

/* Todas as series de tipo no mesmo grafico. So a de novas ganha area: com oito
   areas empilhadas nada mais se le. */
const SERIES_EVOLUCAO = [
  { chave: 'nova', nome: 'Nova conversa', cor: 'var(--serie-1)' },
  { chave: 'analise', nome: 'Analise', cor: 'var(--serie-2)' },
  { chave: 'qualificado', nome: 'Qualificado', cor: 'var(--serie-3)' },
  { chave: 'proposta', nome: 'Proposta', cor: 'var(--serie-4)' },
  { chave: 'sucesso', nome: 'Sucesso', cor: 'var(--sucesso)' },
  { chave: 'desqualificado', nome: 'Desqualificado', cor: 'var(--serie-5)' },
  { chave: 'recusada', nome: 'Recusada', cor: 'var(--serie-7)' },
  { chave: 'desistencia', nome: 'Desistencia', cor: 'var(--serie-8)' },
];

const ETAPAS_FUNIL = ['nova', 'analise', 'qualificado', 'proposta', 'sucesso'];

/* As quatro divisoes da carteira de agora. "Por departamento" nao precisa de
   uma linha embaixo dizendo que divide por departamento, entao so sobra
   `conceito` onde ha o que o titulo nao diz, e mesmo esse vai para dentro de
   dica(). `onde` fica para o caso raro de haver conversa na carteira e mesmo
   assim nenhuma cair na divisao: ai o caminho do cadastro e o que resolve.
   A antiga frase de espera ("o que vai aparecer aqui") saiu: com a carteira
   vazia, dizer o que a rosca mostraria e explicar a tela para quem ja esta nela. */
const ROSCAS = [
  {
    chave: 'status',
    titulo: 'Por status',
    icone: 'raio',
    onde: 'Configuracoes > Status',
  },
  {
    chave: 'departamento',
    titulo: 'Por departamento',
    icone: 'pasta',
    onde: 'Configuracoes > Classes',
  },
  {
    chave: 'etiqueta',
    titulo: 'Por etiqueta',
    icone: 'filtros',
    conceito: 'Assunto marcado na conversa. Uma conversa pode carregar mais de uma etiqueta.',
    onde: 'Configuracoes > Classes',
  },
  {
    chave: 'responsavel',
    titulo: 'Por responsavel',
    icone: 'usuarios',
    onde: 'Configuracoes > Membros',
  },
];

const NOME_DO_AGRUPAMENTO = {
  diario: 'dia',
  semanal: 'semana',
  mensal: 'mes',
  trimestral: 'trimestre',
};

export async function paginaDashboard({ definirAcoes = () => {} } = {}) {
  const container = el('div');
  const corpo = el('div');

  const hoje = new Date();
  const trintaDias = new Date(hoje.getTime() - 29 * 86400000);

  const filtro = {
    de: paraIso(trintaDias),
    ate: paraIso(hoje),
    modo: 'evento',
    agrupamento: agrupamentoParaAJanela(paraIso(trintaDias), paraIso(hoje)),
    /* Lista, e nao valor unico: a comparacao entre duas campanhas na mesma
       janela e o uso principal deste filtro. Vira texto separado por virgula
       na hora de montar a URL. */
    origens: [],
    conexao: '',
    etiqueta: '',
  };

  /** Dois modos de leitura do mesmo periodo: contagem ou percentual de avanco. */
  let modoAnalise = 'periodo';
  let dados = null;
  let falha = '';
  /* Trocar de filtro depressa dispara pedidos que voltam fora de ordem. So o
     ultimo pedido tem direito de desenhar. */
  let sequencia = 0;
  let temporizadorEsqueleto = null;

  function pararEsqueleto() {
    if (temporizadorEsqueleto === null) return;
    clearTimeout(temporizadorEsqueleto);
    temporizadorEsqueleto = null;
  }

  /**
   * Enquanto o pedido nao volta, quem troca de esqueleto e so o miolo: a barra
   * de filtros fica montada fora dele e nao pisca, entao o periodo escolhido
   * continua a vista e o foco do teclado nao cai para o body.
   *
   * O esqueleto ainda espera um instante antes de aparecer. Resposta rapida e a
   * regra, e trocar os graficos por blocos cinza a cada clique de filtro fazia
   * a area inteira lampejar sem necessidade.
   */
  function agendarEsqueleto(meu) {
    pararEsqueleto();
    corpo.setAttribute('aria-busy', 'true');
    temporizadorEsqueleto = setTimeout(() => {
      temporizadorEsqueleto = null;
      if (meu !== sequencia) return;
      limpar(corpo);
      corpo.append(esqueletoDosGraficos());
    }, ATRASO_ESQUELETO);
  }

  /*
   * A resposta anterior, em texto, para comparar com a proxima.
   *
   * A atualizacao automatica dispara a cada mudanca de status no escritorio, e
   * a maioria delas nao mexe em nenhum numero desta janela: status trocado em
   * conversa de fora do periodo, ou de origem que o filtro nao inclui. Repintar
   * assim mesmo apagaria o balao aberto e o lugar da rolagem de quem esta
   * lendo, sem trocar um digito na tela.
   */
  let ultimaResposta = '';

  /**
   * @param {{silencioso?: boolean}} opcoes  Em silencioso nao mostra esqueleto
   *   nem alarme de falha: quem pediu foi o servidor, e nao a pessoa. Uma falha
   *   de rede num pedido que ninguem pediu nao deve tomar a tela; os numeros de
   *   segundos atras seguem valendo ate o proximo evento.
   */
  async function carregar({ silencioso = false } = {}) {
    const meu = (sequencia += 1);
    if (!silencioso) agendarEsqueleto(meu);
    try {
      // As duas datas vao no formato AAAA-MM-DD. O servidor converte para o
      // instante correspondente em Sao Paulo; montar o T00:00Z aqui puxava tres
      // horas do dia anterior.
      /* O servidor le `origem` como lista separada por virgula. Vazio some da
         URL, senao "origem=" chegaria como filtro de origem nenhuma. */
      const { origens, ...resto } = filtro;
      const painel = await api.get('/api/dashboard', { ...resto, origem: origens.join(',') });
      if (meu !== sequencia) return;

      const assinatura = JSON.stringify(painel);
      if (silencioso && assinatura === ultimaResposta) return;
      ultimaResposta = assinatura;

      dados = normalizarPainel(painel);
      falha = '';
      pintar();
    } catch (erro) {
      if (meu !== sequencia) return;
      if (silencioso) return;
      /* O numero antigo nao pode ficar na tela com o filtro novo em cima dele:
         quem olhasse leria o periodo de antes achando que era o de agora. */
      falha = erro.message;
      aviso(erro.message, 'erro');
      pintar();
    }
  }

  function pintar() {
    pararEsqueleto();
    corpo.removeAttribute('aria-busy');
    limpar(corpo);

    if (falha) {
      const repetir = botao('Tentar de novo', { pequeno: true, icone: 'atualizar', aoClicar: () => carregar() });
      repetir.classList.add('mt-3');
      // A mensagem do servidor as vezes chega sem ponto final, e a frase
      // seguinte grudava nela.
      const recado = falha.endsWith('.') ? falha : `${falha}.`;
      corpo.append(
        vazio('Nao consegui carregar os numeros', `${recado} Os filtros continuam como voce deixou.`, repetir),
      );
      return;
    }
    if (!dados) return;

    const partes = [
      avisoDeTipos(dados),
      secaoEventos(dados, filtro),
      secaoGargalos(dados),
      secaoPerformance(dados, filtro, modoAnalise, (valor) => {
        modoAnalise = valor;
        pintar();
      }),
      secaoDistribuicao(dados, filtro),
      rodapeDoConsumo(),
    ];
    for (const parte of partes) {
      if (parte) corpo.append(parte);
    }
  }

  /* A barra de filtros e montada uma vez so: refazer o dashboard inteiro a cada
     troca roubaria o foco do campo que a pessoa acabou de usar. */
  function barraFiltros() {
    const modo = grupoAlternado({
      rotulo: 'Modo de leitura',
      valor: filtro.modo,
      opcoes: [
        {
          valor: 'evento',
          rotulo: 'Evento',
          ajuda: 'Conta o que aconteceu dentro do periodo, mesmo em conversa que comecou antes.',
        },
        {
          valor: 'cohort',
          rotulo: 'Cohort',
          ajuda: 'So conversas iniciadas dentro do periodo, acompanhadas ate onde chegaram.',
        },
      ],
      aoTrocar: (valor) => {
        filtro.modo = valor;
        carregar();
      },
    });


    const origem = selecaoMultipla('Todas as origens', estado.origens, filtro.origens, (valores) => {
      filtro.origens = valores;
      carregar();
    });
    const conexao = selecaoDeFiltro('Todas as conexoes', estado.conexoes, filtro.conexao, (valor) => {
      filtro.conexao = valor;
      carregar();
    });
    const etiqueta = selecaoDeFiltro('Todas as etiquetas', estado.etiquetas, filtro.etiqueta, (valor) => {
      filtro.etiqueta = valor;
      carregar();
    });

    const agrupamento = selecao(
      [
        { valor: 'diario', rotulo: 'Diario' },
        { valor: 'semanal', rotulo: 'Semanal' },
        { valor: 'mensal', rotulo: 'Mensal' },
        { valor: 'trimestral', rotulo: 'Trimestral' },
      ],
      filtro.agrupamento,
      {
        aoChange: (evento) => {
          filtro.agrupamento = evento.target.value;
          carregar();
        },
      },
    );

    const periodo = seletorPeriodo({
      de: filtro.de,
      ate: filtro.ate,
      aoAplicar: ({ de, ate }) => {
        filtro.de = de || '';
        filtro.ate = ate || '';
        carregar();
      },
    });

    /*
     * Os seis controles vao para o cabecalho da tela, na mesma linha do titulo.
     *
     * Como cartao dentro do conteudo eles gastavam 150px de altura antes de
     * qualquer numero aparecer, e rolavam junto com a pagina: quem descia para
     * ver o funil perdia o filtro de vista. No cabecalho eles ficam sempre no
     * mesmo lugar e nao tomam nada da area util.
     */
    return [modo, periodo, origem, conexao, etiqueta, agrupamento];
  }

  /* Tempo real ---------------------------------------------------------
   *
   * O painel reflete o estado das conversas, e status muda o dia inteiro: pelo
   * agente de IA, pelo atendente ao lado, pelo retorno da ZapSign. Sem ouvir
   * nada, quem deixa o dashboard aberto na parede da sala le o numero da hora
   * em que abriu ate alguem apertar F5.
   *
   * Tres cuidados, e cada um existe por um motivo diferente:
   *
   * 1. Espera antes de buscar. Uma importacao de planilha ou um mutirao de
   *    triagem dispara dezenas de eventos em poucos segundos; sem a espera
   *    seriam dezenas de pedidos e dezenas de repinturas seguidas.
   *
   * 2. Nada acontece com a aba escondida. O painel que fica aberto numa aba de
   *    fundo a semana inteira nao deve conversar com o servidor sozinho. Ao
   *    voltar a vista, ele busca uma vez e se acerta.
   *
   * 3. A inscricao se desfaz quando a tela sai do documento. O ouvinte que fica
   *    para tras nao quebra nada, mas somaria um a cada visita ao dashboard
   *    durante o expediente.
   */
  let esperaDoEvento = null;
  let pendenteDeVolta = false;

  function pedirAtualizacao() {
    if (document.hidden) {
      pendenteDeVolta = true;
      return;
    }
    clearTimeout(esperaDoEvento);
    esperaDoEvento = setTimeout(() => carregar({ silencioso: true }), ESPERA_TEMPO_REAL);
  }

  function aoVoltarAVista() {
    if (document.hidden || !pendenteDeVolta) return;
    pendenteDeVolta = false;
    pedirAtualizacao();
  }

  document.addEventListener('visibilitychange', aoVoltarAVista);

  const desinscrever = ['contato', 'contatos'].map((evento) =>
    ouvir(evento, () => {
      if (!document.body.contains(container)) {
        clearTimeout(esperaDoEvento);
        document.removeEventListener('visibilitychange', aoVoltarAVista);
        for (const parar of desinscrever) parar();
        return;
      }
      pedirAtualizacao();
    }),
  );

  definirAcoes(barraFiltros());
  container.append(corpo);
  await carregar();
  return container;
}

/* Resposta do servidor ----------------------------------------------- */

/**
 * Tudo que a tela le do painel passa por aqui primeiro.
 *
 * A resposta chega sem campo mais vezes do que parece: workspace recem-criado,
 * filtro que nao casou com nada, servidor de uma versao anterior. Com o valor
 * padrao espalhado por cada grafico, bastava um deles esquecer a defesa para a
 * tela toda cair num "cannot read properties of undefined". Daqui para baixo,
 * lista e sempre lista e objeto e sempre objeto.
 */
function normalizarPainel(bruto) {
  const painel = bruto ?? {};
  const cards = painel.cards ?? {};
  const base = painel.base ?? {};
  const distribuicao = painel.distribuicao ?? {};
  const lista = (valor) => (Array.isArray(valor) ? valor : []);

  return {
    modo: painel.modo || 'evento',
    cards,
    /* A base de todo percentual vem do servidor com o nome do que ela
       representa. Em cohort sao as conversas nascidas no periodo; em evento sao
       as que tiveram movimento nele, que e o unico denominador que fecha com um
       numerador contado por evento. */
    base: {
      total: Number(base.total ?? cards.nova?.total) || 0,
      rotulo: base.rotulo || 'novas do periodo',
    },
    statusPorTipo: painel.statusPorTipo ?? {},
    distribuicao: {
      status: lista(distribuicao.status),
      departamento: lista(distribuicao.departamento),
      etiqueta: lista(distribuicao.etiqueta),
      responsavel: lista(distribuicao.responsavel),
    },
    serieConversas: lista(painel.serieConversas),
    /* Os graficos desenham serieConversas. serieEventos vem na mesma resposta e
       fica normalizada junto, para quem for ler nao ter de defender de novo. */
    serieEventos: lista(painel.serieEventos),
    porOrigem: lista(painel.porOrigem),
    /* Conversao por etapa com a faixa de referencia junto. Sem a faixa, "8,6%
       de Sucesso" nao diz a quem le se e bom ou ruim. */
    conversoes: lista(painel.conversoes),
    gargalos: painel.gargalos ?? null,
    tiposSemStatus: lista(painel.tiposSemStatus),
    totalConversas: Number(painel.totalConversas) || 0,
  };
}

/* Carregamento -------------------------------------------------------- */

/* Espera antes de trocar o conteudo pelo esqueleto. Abaixo disso a resposta
   costuma chegar antes, e o piscar custaria mais do que a espera. */
const ATRASO_ESQUELETO = 180;

/* Espera entre o ultimo evento do servidor e a busca dos numeros novos.
   Quatro segundos porque a rajada tipica de uma triagem cabe dentro dela: o
   painel busca uma vez, no fim, em vez de uma vez por conversa movida. */
const ESPERA_TEMPO_REAL = 4000;

/** Esqueleto com a forma das tres secoes, para nada saltar quando o dado chega. */
function esqueletoDosGraficos() {
  // A altura de cada bloco vem do mesmo token que o cartao de verdade usa, e
  // nao de um numero escrito aqui. Com o numero dos dois lados, os dois saiam
  // do lugar assim que um grafico mudasse de tamanho, e a tela voltava a
  // saltar no momento em que o dado chegasse, que e o que o esqueleto existe
  // para evitar.
  const bloco = (altura) => el('div', { class: `esqueleto esqueleto-cartao ${altura}` });
  const titulo = () => el('div', { class: 'esqueleto esqueleto-linha esqueleto-titulo' });

  return el('div', { 'aria-hidden': 'true' }, [
    el('section', { class: 'secao-painel' }, [
      titulo(),
      el('div', { class: 'metricas' }, CARTOES.map(() => bloco('altura-metrica'))),
    ]),
    el('section', { class: 'secao-painel' }, [
      titulo(),
      el('div', { class: 'grade' }, [bloco('altura-evolucao'), bloco('altura-funil'), bloco('altura-sankey')]),
    ]),
    el('section', { class: 'secao-painel' }, [
      titulo(),
      el('div', { class: 'grade-roscas' }, ROSCAS.map(() => bloco('altura-rosca'))),
    ]),
  ]);
}

/* Filtros ------------------------------------------------------------ */

function selecaoDeFiltro(rotuloVazio, itens, valor, aoTrocar) {
  const lista = Array.isArray(itens) ? itens : [];
  return selecao(
    [{ valor: '', rotulo: rotuloVazio }, ...lista.map((item) => ({ valor: item.id, rotulo: item.nome }))],
    valor,
    { aoChange: (evento) => aoTrocar(evento.target.value) },
  );
}

/**
 * Filtro que aceita mais de um item, para a barra do topo.
 *
 * A doc do funil chama a comparacao entre origens de "extremamente relevante
 * para metrificar campanha", e com um <select> so dava para ver uma origem por
 * vez: comparar Facebook com Instagram virava trocar o filtro e anotar o numero
 * no papel. Aqui as duas entram juntas na mesma janela.
 *
 * O botao mostra o estado por extenso enquanto cabe (uma escolha) e passa a
 * contar a partir de duas: "Anuncio Facebook, Anuncio Instagram, Indicacao"
 * estouraria a largura da barra e empurraria os outros filtros para a linha de
 * baixo a cada clique.
 */
function selecaoMultipla(rotuloVazio, itens, escolhidos, aoTrocar) {
  const lista = Array.isArray(itens) ? itens : [];
  const marcados = new Set(escolhidos);

  const rotulo = el('span');
  const gatilho = el(
    'button',
    { type: 'button', class: 'filtro-multiplo-alvo', 'aria-haspopup': 'true', 'aria-expanded': 'false' },
    /* A setinha e desenhada no CSS, como a do <select> nativo ao lado: o
       conjunto de icones nao tem chevron, e acrescentar um so por causa deste
       controle deixaria dois desenhos de seta convivendo na mesma barra. */
    [rotulo, el('span', { class: 'filtro-multiplo-seta', 'aria-hidden': 'true' })],
  );

  const painel = el('div', { class: 'filtro-multiplo-painel', role: 'group', 'aria-label': rotuloVazio });
  const caixa = el('div', { class: 'filtro-multiplo' }, [gatilho, painel]);

  function textoDoBotao() {
    if (!marcados.size) return rotuloVazio;
    if (marcados.size === 1) {
      const unico = lista.find((item) => marcados.has(item.id));
      return unico ? unico.nome : rotuloVazio;
    }
    return `${marcados.size} de ${lista.length}`;
  }

  function pintarRotulo() {
    rotulo.textContent = textoDoBotao();
    gatilho.classList.toggle('ativo', marcados.size > 0);
  }

  function avisar() {
    pintarRotulo();
    aoTrocar([...marcados]);
  }

  /* "Todas" limpa a selecao em vez de marcar tudo. Marcar as cinco daria o
     mesmo resultado, mas deixaria o botao escrito "5 de 5" quando o estado real
     e "sem filtro", e a barra pareceria filtrada sem estar. */
  const todas = el('label', { class: 'filtro-multiplo-item' }, [
    el('input', { type: 'checkbox', checked: marcados.size === 0 }),
    el('span', { texto: rotuloVazio }),
  ]);
  todas.querySelector('input').addEventListener('change', () => {
    marcados.clear();
    for (const entrada of painel.querySelectorAll('input')) entrada.checked = false;
    todas.querySelector('input').checked = true;
    avisar();
  });
  painel.append(todas, el('div', { class: 'filtro-multiplo-risco' }));

  for (const item of lista) {
    const entrada = el('input', { type: 'checkbox', value: item.id });
    entrada.checked = marcados.has(item.id);
    entrada.addEventListener('change', () => {
      if (entrada.checked) marcados.add(item.id);
      else marcados.delete(item.id);
      todas.querySelector('input').checked = marcados.size === 0;
      avisar();
    });
    painel.append(el('label', { class: 'filtro-multiplo-item' }, [entrada, el('span', { texto: item.nome })]));
  }

  function fechar() {
    if (!caixa.classList.contains('aberto')) return;
    caixa.classList.remove('aberto');
    gatilho.setAttribute('aria-expanded', 'false');
    document.removeEventListener('pointerdown', aoClicarFora, true);
    document.removeEventListener('keydown', aoTeclar, true);
  }

  /* Fecha ao clicar fora e no Esc. Sem os dois, o painel ficava aberto por cima
     dos graficos ate alguem clicar de novo no proprio botao. Os ouvintes vivem
     so enquanto o painel esta aberto, e nao ficam pendurados no documento. */
  function aoClicarFora(evento) {
    if (!caixa.contains(evento.target)) fechar();
  }
  function aoTeclar(evento) {
    if (evento.key !== 'Escape') return;
    fechar();
    gatilho.focus();
  }

  gatilho.addEventListener('click', () => {
    if (caixa.classList.contains('aberto')) {
      fechar();
      return;
    }
    caixa.classList.add('aberto');
    gatilho.setAttribute('aria-expanded', 'true');
    document.addEventListener('pointerdown', aoClicarFora, true);
    document.addEventListener('keydown', aoTeclar, true);
  });

  pintarRotulo();
  return caixa;
}

function grupoAlternado({ opcoes, valor, aoTrocar, rotulo }) {
  /* O arredondamento das pontas, a sobreposicao de 1px entre os botoes e a
     altura de controle ficam em .grupo-alternado, no CSS. */
  const grupo = el('div', { role: 'group', 'aria-label': rotulo, class: 'grupo-alternado' });
  let atual = valor;

  /* Os botoes sao criados uma vez e so trocam de estado. Recriar o grupo
     inteiro dentro do proprio clique tirava do DOM o botao que acabara de ser
     acionado, e o foco do teclado caia para o body: quem alterna pelo teclado
     perdia o lugar na tela a cada troca. */
  const botoes = opcoes.map((opcao) => {
    const alvo = botao(opcao.rotulo, {
      pequeno: true,
      titulo: opcao.ajuda || null,
      aoClicar: () => {
        if (String(opcao.valor) === String(atual)) return;
        atual = opcao.valor;
        pintar();
        aoTrocar(opcao.valor);
      },
    });
    grupo.append(alvo);
    return { opcao, alvo };
  });

  /* O botao escolhido ganha .principal, e o CSS usa essa mesma classe para
     trazer a borda dele para a frente da do vizinho. */
  function pintar() {
    for (const { opcao, alvo } of botoes) {
      const ativo = String(opcao.valor) === String(atual);
      alvo.classList.toggle('principal', ativo);
      alvo.setAttribute('aria-pressed', ativo ? 'true' : 'false');
    }
  }

  pintar();
  return grupo;
}

/* Estado vazio -------------------------------------------------------- */

/**
 * Agrupamento que cabe na janela pedida.
 *
 * Barra por dia em trinta dias, para o volume deste escritorio, da uma coluna
 * cheia e vinte e nove vazias: honesto, mas ilegivel. A regra abaixo mira
 * sempre entre seis e quinze colunas, que e a faixa em que o olho compara
 * altura sem contar. Quem quiser o dia a dia continua trocando no filtro.
 */
function agrupamentoParaAJanela(de, ate) {
  const dias = Math.round((new Date(ate) - new Date(de)) / 86400000) + 1;
  if (dias <= 16) return 'diario';
  if (dias <= 120) return 'semanal';
  if (dias <= 730) return 'mensal';
  return 'trimestral';
}

/**
 * Rotulo curto do eixo. Em diario e semanal o ano nao cabe nem interessa: o
 * periodo inteiro esta na barra de filtros logo acima. Em mensal e trimestral
 * o ano volta, porque ai a serie pode atravessar a virada.
 */
function rotuloDoPeriodo(chave, agrupamento) {
  const bruto = String(chave || '');
  if (agrupamento === 'mensal') {
    const [ano, mes] = bruto.split('-');
    return mes ? `${mes}/${ano.slice(2)}` : bruto;
  }
  if (agrupamento === 'trimestral') return bruto.replace('-', ' ');
  const [, mes, dia] = bruto.split('-');
  return dia ? `${dia}/${mes}` : bruto;
}

/** AAAA-MM-DD -> DD/MM/AAAA, sem passar por Date para nao pegar fuso. */
function paraBr(iso) {
  const [ano, mes, dia] = String(iso || '').split('-');
  return dia ? `${dia}/${mes}/${ano}` : '';
}

function faixaEmTexto(filtro) {
  if (filtro.de && filtro.ate) return `entre ${paraBr(filtro.de)} e ${paraBr(filtro.ate)}`;
  if (filtro.de) return `a partir de ${paraBr(filtro.de)}`;
  if (filtro.ate) return `ate ${paraBr(filtro.ate)}`;
  return 'no periodo escolhido';
}

function enumerar(itens) {
  if (itens.length < 2) return itens[0] || '';
  return `${itens.slice(0, -1).join(', ')} e ${itens[itens.length - 1]}`;
}

/** Os filtros que recortam a carteira, fora o periodo. Nomes dos ativos agora. */
function recortesLigados(filtro) {
  const ativos = [];
  if (filtro.origens?.length) ativos.push('origem');
  if (filtro.conexao) ativos.push('conexao');
  if (filtro.etiqueta) ativos.push('etiqueta');
  return ativos;
}

/**
 * A saida do estado vazio muda conforme o que o proprio usuario ligou. Com
 * recorte ativo, o caminho curto e desligar o filtro; sem ele, so resta mexer
 * no periodo. Dizer as duas coisas sempre seria dizer nenhuma.
 */
function comoSairDoVazio(filtro) {
  const ativos = recortesLigados(filtro);
  if (ativos.length) {
    return `Ha filtro de ${enumerar(ativos)} ligado na barra. Volte para "todas" ou amplie o periodo.`;
  }
  return 'Amplie o periodo na barra. Se nada aparecer, ainda nao houve conversa.';
}

/* Secao A e F -------------------------------------------------------- */

function secao(titulo, extra, ...filhos) {
  return el('section', { class: 'secao-painel' }, [
    titulo ? el('h2', {}, [titulo, extra || null]) : null,
    ...filhos,
  ]);
}

function avisoDeTipos(dados) {
  const tipos = dados.tiposSemStatus;
  if (!tipos.length) return null;

  /* Aviso de estado, e nao explicacao: diz qual tipo ficou sem status, o que
     isso faz com o numero e onde arrumar. O porque completo ja esta na dica do
     proprio cartao zerado. */
  return el('div', { class: 'cartao mb-4' }, [
    el('div', { class: 'alerta-caixa' }, [
      el('strong', { texto: 'Falta encaixar os status. ' }),
      document.createTextNode(
        `Sem status marcado como ${tipos.join(', ')}, estes cartoes ficam em zero e o funil sai errado. Encaixe em Configuracoes > Status.`,
      ),
    ]),
  ]);
}

/* Secao B, eventos por status ---------------------------------------- */

/** Sucesso e perdas tem cor semantica propria; o resto herda a cor do tipo. */
/**
 * Poe o icone da secao num quadrado arredondado, a esquerda do titulo.
 *
 * Fica aqui e nao no cartaoComDica porque so a faixa de distribuicao usa esse
 * tratamento: espalhar quadrado de icone por todo cartao devolveria o ruido
 * que o painel levou uma reforma inteira para perder.
 */
function marcarCabeco(caixa, nomeDoIcone) {
  if (!nomeDoIcone) return;
  const cabeca = caixa.querySelector('.cartao-titulo');
  if (!cabeca) return;
  cabeca.prepend(el('span', { class: 'marca-icone' }, [icone(nomeDoIcone, 16)]));
}

function corDoCartao(definicao, card) {
  if (definicao.chave === 'sucesso') return 'var(--sucesso)';
  if (definicao.chave === 'perdas') return 'var(--erro)';
  return card?.cor || definicao.corPadrao;
}

function chavesDeStatus(chave) {
  return chave === 'perdas' ? CHAVES_PERDA : [chave];
}

function statusDoCartao(statusPorTipo, chave) {
  return chavesDeStatus(chave).flatMap((item) =>
    Array.isArray(statusPorTipo?.[item]) ? statusPorTipo[item] : [],
  );
}

/* Sem a chave no mapa nao da para dizer que ninguem encaixou o tipo: pode ser
   que o servidor simplesmente nao classifique aquele cartao por status. */
function temInformacaoDeStatus(statusPorTipo, chave) {
  return chavesDeStatus(chave).some((item) => Array.isArray(statusPorTipo?.[item]));
}

function percentualDoCartao(card, totalNovas) {
  if (typeof card?.percentual === 'number') return card.percentual;
  const base = Number(totalNovas) || 0;
  if (!base) return 0;
  return Number((((Number(card?.total) || 0) / base) * 100).toFixed(1));
}

function secaoEventos(dados, filtro) {
  const { cards, statusPorTipo, base } = dados;

  /* Seis cartoes zerados lado a lado nao informam nada e ainda parecem defeito.
     Quando o periodo nao teve movimento nenhum, a secao troca os zeros por uma
     frase que diz o que fazer em seguida. */
  const semMovimento =
    !base.total && CARTOES.every((definicao) => !(Number(cards[definicao.chave]?.total) || 0));
  if (semMovimento) {
    return secao(
      'Eventos por status',
      null,
      cartao(
        null,
        null,
        vazio(
          'Nenhuma conversa se mexeu neste periodo',
          `Nada entrou nem mudou de status ${faixaEmTexto(filtro)}. ${comoSairDoVazio(filtro)}`,
        ),
      ),
    );
  }

  const grade = el(
    'div',
    { class: 'metricas' },
    CARTOES.map((definicao) =>
      cartaoDeEvento(definicao, cards[definicao.chave] ?? {}, statusPorTipo, base, dados.modo),
    ),
  );

  /* O denominador vive aqui, uma vez. Antes cada um dos seis cartoes repetia
     "das conversas com movimento no periodo": a mesma informacao seis vezes,
     ocupando mais linha do que o proprio numero que ela explicava. */
  return secao(
    'Eventos por status',
    el('span', { class: 'secao-nota', texto: '% sobre ' + numero(base.total) + ' ' + base.rotulo }),
    grade,
  );
}

function cartaoDeEvento(definicao, card, statusPorTipo, base, modo) {
  const cor = corDoCartao(definicao, card);
  const marca = icone(definicao.icone, 15);
  marca.style.color = cor;

  const mini = miniLinha(card.serie, { cor });
  const percentual =
    definicao.chave === 'nova' && modo === 'cohort'
      ? 'base'
      : numero(percentualDoCartao(card, base.total)) + '%';

  return el('div', { class: 'metrica', estilo: { '--metrica-cor': cor } }, [
    el('div', { class: 'metrica-topo' }, [
      marca,
      el('span', { class: 'nome', texto: definicao.nome }),
      dica(explicacaoDoCartao(definicao, card, statusPorTipo, base)),
    ]),
    el('div', { class: 'metrica-numeros' }, [
      el('div', { class: 'valor', texto: numero(Number(card.total) || 0) }),
    ]),
    /* Percentual, tempo e comparacao dividem uma linha so. Empilhados, cada um
       empurrava a minilinha para baixo e os seis cartoes ficavam de alturas
       diferentes conforme tivessem ou nao tempo medio. */
    el('div', { class: 'metrica-apoio' }, [
      el('span', { class: 'variacao', texto: percentual }),
      card.tempoMedio
        ? el('span', { class: 'metrica-tempo' }, [
            icone('relogio', 12),
            document.createTextNode(card.tempoMedio),
          ])
        : null,
      comparacao(definicao, card),
    ]),
    mini ? el('div', { class: 'metrica-mini' }, [mini]) : null,
  ]);
}

/**
 * Quanto mudou desde o periodo anterior.
 *
 * E o que transforma o numero em informacao: 14 conversas nao diz nada sozinho,
 * "14, tres a mais que antes" diz. Some quando o servidor nao tem passado para
 * comparar, porque uma alta contra o nada seria alta inventada.
 */
function comparacao(definicao, card) {
  const antes = card?.anterior;
  if (antes === null || antes === undefined) return null;

  const agora = Number(card.total) || 0;
  const delta = agora - Number(antes);
  if (!delta) {
    return el('span', { class: 'delta c-suave', texto: 'igual ao periodo anterior' });
  }

  const bom = delta * (definicao.sentido || 1) > 0;
  return el('span', {
    class: 'delta',
    estilo: { color: bom ? 'var(--sucesso)' : 'var(--erro)' },
    texto: (delta > 0 ? '+' : '') + numero(delta) + ' vs. anterior',
  });
}

function explicacaoDoCartao(definicao, card, statusPorTipo, base) {
  /* Pilha: o respiro entre os paragrafos sai do gap, e cada um deles fica sem
     margem propria, senao a ultima linha do balao ganha uma folga que as outras
     nao tem. */
  const caixa = el('div', { class: 'pilha' }, [
    el('p', {
      class: 'sem-margem',
      texto: `${numero(Number(card.total) || 0)} conversas chegaram a ${definicao.nome} no periodo. Cada conversa conta uma vez so, no primeiro evento do tipo.`,
    }),

  ]);

  const lista = statusDoCartao(statusPorTipo, definicao.chave);
  if (lista.length) {
    caixa.append(
      el('p', {
        class: 'sem-margem c-suave',
        texto: 'Entram neste cartao os status do escritorio:',
      }),
      el(
        'div',
        { class: 'linha quebra' },
        lista.map((item) => selo(item.nome, '', item.cor || COR_SEM_CATEGORIA)),
      ),
    );
  } else if (temInformacaoDeStatus(statusPorTipo, definicao.chave)) {
    caixa.append(
      el('p', {
        class: 'sem-margem c-alerta',
        texto: `Nenhum status do escritorio foi marcado como ${definicao.nome}, e por isso este cartao fica em zero. Abra Configuracoes > Status para encaixar.`,
      }),
    );
  }

  return caixa;
}

/* Secao B2, onde o funil vaza ----------------------------------------- */

/**
 * O diagnostico do funil, em texto.
 *
 * Os cartoes acima dizem quanto; esta secao diz onde e o que fazer. Ela vem
 * logo depois deles de proposito: quem abre o painel quer a conclusao antes da
 * evidencia, e os graficos abaixo sustentam o que aqui esta afirmado.
 *
 * Quando nao ha gargalo, a secao aparece assim mesmo, dizendo que nao ha. O
 * silencio seria ambiguo: nao daria para distinguir funil saudavel de recurso
 * que nao rodou.
 */
function secaoGargalos(dados) {
  const diagnostico = dados.gargalos;
  if (!diagnostico) return null;

  /* A explicacao mora no titulo da secao, e nao em cada cartao: os tres estados
     possiveis (sem dado, sem gargalo, com gargalo) sao lidos da mesma forma, e
     repetir a mesma dica em cada um seria dizer tres vezes a mesma coisa. */
  const ajuda = dica(
    'Cada etapa e comparada com a anterior, e nao com o total. Dizer que Proposta esta em 4% das novas nao revela se o problema e a proposta ou a qualificacao antes dela; a passagem de uma etapa para a proxima isola o degrau exato. A faixa esperada de cada passagem sai da referencia de mercado mostrada sob o funil.',
    { assunto: 'o diagnostico do funil' },
  );

  if (!diagnostico.possivel) {
    return secao(
      'Onde o funil vaza',
      ajuda,
      el('div', { class: 'cartao' }, [el('p', { class: 'sem-margem c-suave', texto: diagnostico.motivo })]),
    );
  }

  if (!diagnostico.achados.length) {
    return secao(
      'Onde o funil vaza',
      ajuda,
      el('div', { class: 'cartao' }, [
        el('strong', { texto: 'Nenhum degrau abaixo do esperado.' }),
        el('p', {
          class: 'c-suave',
          texto:
            'Todas as passagens do funil ficaram dentro ou acima da faixa de referencia no periodo. Isso nao quer dizer que nao ha o que melhorar: quer dizer que nenhuma etapa esta perdendo conversa fora do normal.',
        }),
      ]),
    );
  }

  return secao(
    'Onde o funil vaza',
    /* O contador evita que o segundo achado passe despercebido quando o
       primeiro ja encheu a largura da tela. */
    el('span', {}, [
      el('span', { class: 'contagem-secao', texto: String(diagnostico.achados.length) }),
      ajuda,
    ]),
    el('div', { class: 'cartao' }, [
      el('div', { class: 'lista-gargalos' }, diagnostico.achados.map((achado) => cartaoDeGargalo(achado))),
    ]),
  );
}

/**
 * Um degrau com problema.
 *
 * A ordem da linha e deliberada: primeiro o que acontece, depois o quanto, e so
 * entao o que fazer. Comecar pela acao faria a tela mandar mexer no prompt sem
 * antes mostrar por que.
 */
function cartaoDeGargalo(achado) {
  const critico = achado.gravidade === 'critico';

  const numeros = [
    el('b', { class: critico ? 'c-erro' : 'c-alerta', texto: `${achado.real}%` }),
    achado.esperado !== null
      ? el('span', { class: 'c-fraco', texto: `esperado ~${achado.esperado}%` })
      : null,
    el('span', { class: 'c-fraco', texto: achado.detalhe }),
  ].filter(Boolean);

  return el('div', { class: `gargalo ${critico ? 'gargalo-critico' : ''}`.trim() }, [
    el('div', { class: 'gargalo-etapa' }, [
      el('span', { class: 'gargalo-marca' }),
      el('span', { class: 'c-fraco', texto: achado.etapa }),
    ]),
    el('strong', { texto: achado.titulo }),
    el('div', { class: 'gargalo-numeros' }, numeros),
    el('p', { class: 'c-suave', texto: achado.acao }),
    achado.onde ? el('span', { class: 'gargalo-onde c-fraco', texto: `Ajuste em ${achado.onde}` }) : null,
  ]);
}

/* Secao C, performance ------------------------------------------------ */

function secaoPerformance(dados, filtro, modoAnalise, aoTrocarModo) {
  /* Sem titulo: "Analise de performance" e rotulo de ferramenta de BI, e nao
     diz nada que os tres graficos abaixo nao digam melhor pelo proprio nome. */
  return secao(
    null,
    null,
    cartaoEvolucao(dados, filtro, modoAnalise, aoTrocarModo),
    cartaoFunil(dados, filtro),
    cartaoPorOrigem(dados, filtro),
  );
}

/* Em "Conversoes" cada etapa vira percentual sobre as novas do periodo: e assim
   que se ve se o funil piorou ou se apenas entrou menos gente. */
function emPercentual(serie) {
  return serie.map((linha) => {
    const base = Number(linha.nova) || 0;
    const convertida = { periodo: linha.periodo };
    for (const item of SERIES_EVOLUCAO) {
      const valor = Number(linha[item.chave]) || 0;
      convertida[item.chave] = base ? Number(((valor / base) * 100).toFixed(1)) : 0;
    }
    return convertida;
  });
}

function cartaoEvolucao(dados, filtro, modoAnalise, aoTrocarModo) {
  /* serieConversas, e nao serieEventos: e a contagem que fecha com os cards.
     Com a serie de eventos, uma conversa que oscilou cinco vezes entre Analise
     e Qualificado somava cinco no grafico e um na mini linha do cartao, e nao
     havia como saber qual dos dois numeros era o certo. */
  const serie = dados.serieConversas;
  const temEvento = serie.some((linha) =>
    SERIES_EVOLUCAO.some((item) => (Number(linha[item.chave]) || 0) > 0),
  );

  const alternador = el('div', { class: 'mb-3' }, [
    grupoAlternado({
      rotulo: 'Leitura da evolucao',
      valor: modoAnalise,
      opcoes: [
        { valor: 'periodo', rotulo: 'Por periodo', ajuda: 'Contagem de eventos em cada periodo.' },
        { valor: 'conversoes', rotulo: 'Conversoes', ajuda: 'Percentual de cada etapa sobre as novas do periodo.' },
      ],
      aoTrocar: aoTrocarModo,
    }),
  ]);

  /* Como cada leitura conta a conversa e conceito: vai na dica do titulo, e nao
     numa linha fixa em cima do grafico. */
  const leitura =
    modoAnalise === 'conversoes'
      ? 'Percentual de cada etapa sobre as novas conversas daquele periodo. Separa queda de funil de queda de volume.'
      : `Contagem por ${NOME_DO_AGRUPAMENTO[filtro.agrupamento] || 'periodo'}, com cada conversa contando uma vez por etapa.`;

  const conceito = leitura + ' Aponte para uma barra para ver o detalhe do periodo.';

  const caixa = cartaoComDica({ titulo: 'Evolucao no periodo', conceito }, alternador);

  if (!temEvento) {
    /* Sem serie, o grafico sairia como uma moldura vazia com os eixos zerados.
       A frase diz o que aconteceu e o que fazer para sair daqui. */
    caixa.append(
      vazio(
        'Nada para desenhar nesta linha do tempo',
        `Nenhuma conversa nova e nenhum avanco de status ${faixaEmTexto(filtro)}. ${comoSairDoVazio(filtro)}`,
      ),
    );
    return caixa;
  }

  const linhas = modoAnalise === 'conversoes' ? emPercentual(serie) : serie;
  /* O eixo do grafico e o rotulo do periodo ja em pt-BR: a serie chega com a
     data em ISO, que ninguem le de relance. */
  const periodos = linhas.map((linha) => ({ ...linha, rotulo: rotuloDoPeriodo(linha.periodo, filtro.agrupamento) }));
  caixa.append(
    graficoEvolucao({
      serie: linhas,
      series: SERIES_EVOLUCAO,
      altura: 300,
      percentual: modoAnalise === 'conversoes',
      rotulo: modoAnalise === 'conversoes' ? 'Conversoes no periodo' : 'Evolucao no periodo',
    }),
    legenda(SERIES_EVOLUCAO),
  );
  return caixa;
}

/**
 * Funil montado com os totais do periodo. As perdas do periodo sao repartidas
 * entre as etapas na proporcao da queda de cada uma: nao existe registro de em
 * qual etapa cada perda aconteceu, e o que da para afirmar com honestidade e
 * onde o funil encolheu. O texto do cartao avisa isso.
 */
function montarFunil(dados) {
  const cards = dados.cards;
  const serie = dados.serieConversas;

  const totalDe = (chave) => {
    const doCartao = Number(cards[chave]?.total);
    if (Number.isFinite(doCartao) && doCartao > 0) return doCartao;
    return serie.reduce((soma, linha) => soma + (Number(linha[chave]) || 0), 0);
  };

  const valores = {};
  for (const chave of ETAPAS_FUNIL) valores[chave] = totalDe(chave);
  const perdas = totalDe('perdas');

  const ultimaColuna = ETAPAS_FUNIL.length - 1;
  const etapas = ETAPAS_FUNIL.map((chave, indice) => {
    const definicao = CARTOES.find((item) => item.chave === chave);
    return {
      id: chave,
      nome: definicao.nome,
      cor: corDoCartao(definicao, cards[chave]),
      coluna: indice,
      valor: valores[chave],
    };
  });
  /* Perdas divide a ultima coluna com Sucesso: as duas sao desfecho, e nao uma
     etapa depois da outra. */
  etapas.push({ id: 'perdas', nome: 'Perdas', cor: 'var(--erro)', coluna: ultimaColuna, valor: perdas });

  /* O rateio das perdas por etapa saiu daqui junto com o Sankey. Ele repartia
     o total de perdas na proporcao da queda de cada etapa, o que era estimativa
     e nao registro: o log guarda que a conversa se perdeu, nao onde. O funil de
     barras mostra so o que se sabe. */
  return { etapas };
}

function rodapeDePerdas(dados) {
  const serie = dados.serieConversas;
  const motivos = [
    { chave: 'desqualificado', nome: 'Desqualificado', cor: 'var(--serie-5)' },
    { chave: 'recusada', nome: 'Recusada', cor: 'var(--serie-7)' },
    { chave: 'desistencia', nome: 'Desistencia', cor: 'var(--serie-8)' },
  ]
    .map((motivo) => ({
      ...motivo,
      total: serie.reduce((soma, linha) => soma + (Number(linha[motivo.chave]) || 0), 0),
    }))
    .filter((motivo) => motivo.total > 0);

  if (!motivos.length) return null;

  return el('div', { class: 'rosca-legenda' }, [
    el('span', { texto: 'Perdas por motivo' }),
    ...motivos.map((motivo) =>
      el('span', {}, [
        el('span', { class: 'ponto', estilo: { background: motivo.cor } }),
        document.createTextNode(motivo.nome),
        el('b', { texto: numero(motivo.total) }),
      ]),
    ),
  ]);
}

/**
 * A faixa de conversao esperada em cada etapa, sob o funil.
 *
 * Sem ela o painel devolve numeros sem regua: "8,6% de Sucesso" nao diz a quem
 * le se o mes foi bom. Com a faixa ao lado, diz.
 *
 * A faixa e media de mercado, e nao meta do escritorio. O previdenciario tem
 * ciclo mais longo que a media, e por isso o texto do cartao chama isso de
 * referencia, e a etapa acima da faixa nao ganha selo de aprovacao: so a
 * palavra "acima", sem cor de comemoracao.
 */
function rodapeDeReferencia(dados) {
  const etapas = dados.conversoes.filter((item) => item.referencia && item.tipo !== 'nova');
  if (!etapas.length) return null;

  const linhas = etapas.map((etapa) => {
    const { min, max } = etapa.referencia;
    const valor = Number(etapa.percentual) || 0;
    const faixa = min === max ? `${numero(min)}%` : `${numero(min)}-${numero(max)}%`;

    /* Tres posicoes, e a do meio nao ganha cor: estar dentro do esperado e o
       estado normal, e pintar o normal de verde faria a tela comemorar seis
       vezes por dia. So o que sai da faixa merece um sinal. */
    let classe = 'c-fraco';
    let posicao = 'dentro';
    if (valor < min) {
      classe = 'c-alerta';
      posicao = 'abaixo';
    } else if (valor > max) {
      classe = 'c-suave';
      posicao = 'acima';
    }

    return el('span', { class: 'referencia-item' }, [
      el('span', { class: 'ponto', estilo: { background: etapa.cor } }),
      el('span', { class: 'c-suave', texto: etapa.nome }),
      el('b', { texto: `${numero(valor)}%` }),
      el('span', { class: classe, texto: `${posicao} de ${faixa}` }),
    ]);
  });

  return el('div', { class: 'rosca-legenda referencia-faixa' }, [
    el('span', { texto: 'Referencia de mercado' }),
    ...linhas,
  ]);
}

function cartaoFunil(dados, filtro) {
  const { etapas } = montarFunil(dados);
  const grafico = funilBarras(etapas);

  if (grafico) {
    const caixa = cartaoComDica(
      {
        titulo: 'Do primeiro contato ao contrato',
        conceito:
          'O comprimento da barra e o volume de conversas, e todas partem da mesma origem. O contorno tracejado a frente de cada barra e a queda para a etapa seguinte. Perdas aparece a parte, com o total do periodo: o registro guarda quantas se perderam, nao em que etapa cada uma parou.',
      },
      el('div', { class: 'tabela-rolagem' }, [grafico]),
    );
    const regua = rodapeDeReferencia(dados);
    if (regua) caixa.append(regua);
    const rodape = rodapeDePerdas(dados);
    if (rodape) caixa.append(rodape);
    return caixa;
  }

  /* Sem etapa encadeada nao ha funil para desenhar. O caminho da origem ate o
     desfecho responde a mesma pergunta por outro lado, entao a tela troca o
     grafico em vez de mostrar um retangulo vazio. */
  const origens = dados.porOrigem.filter((item) => Number(item.novas) > 0);
  const diagrama = origens.length
    ? sankeyPorOrigem(origens, { altura: Math.max(220, origens.length * 54), rotulo: 'Da origem ao desfecho' })
    : null;

  if (diagrama) {
    /* A primeira frase fala do estado de agora, e por isso continua a vista:
       sem ela, quem procura o funil nao entende por que achou outro grafico no
       lugar dele. Como se le a faixa e conceito, e fica na dica. */
    return cartaoComDica(
      {
        titulo: 'Da origem ao desfecho',
        ajuda: 'Sem etapa encadeada no periodo para desenhar o funil.',
        conceito: 'O caminho de cada origem ate o desfecho: a espessura da faixa e o volume de leads.',
      },
      el('div', { class: 'tabela-rolagem' }, [diagrama]),
    );
  }

  /* Duas etapas seguidas com volume e o minimo para existir uma faixa. Sem
     isso, a frase precisa separar as duas causas possiveis: ou o periodo nao
     teve avanco, ou os status nunca foram encaixados nos tipos e o funil nao
     enxerga o avanco que houve. */
  return cartao(
    'Do primeiro contato ao contrato',
    null,
    vazio(
      'Sem funil para desenhar',
      `Nenhuma conversa passou de uma etapa para a seguinte ${faixaEmTexto(filtro)}. Confira o encaixe em Configuracoes > Status. ${comoSairDoVazio(filtro)}`,
    ),
  );
}

/* O mesmo conceito nas duas saidas do cartao, com tabela ou sem ela. De onde a
   origem vem tambem e conceito, e por isso desceu do estado vazio para ca. */
const CONCEITO_ORIGEM =
  'Onde se ve qual anuncio gera contrato, e nao apenas conversa. A origem chega sozinha pelo anuncio ou pelo link de campanha, e pode ser corrigida na propria conversa.';

function cartaoPorOrigem(dados, filtro) {
  const linhas = dados.porOrigem
    .filter((origem) => Number(origem.novas) > 0)
    .sort((a, b) => b.novas - a.novas);

  /* A tabela some quando nao ha origem, e a pergunta "de onde vem o cliente"
     fica sem resposta na tela. Melhor manter o cartao e explicar o que falta
     para ele encher. */
  if (!linhas.length) {
    return cartaoComDica(
      { titulo: 'Por origem', conceito: CONCEITO_ORIGEM },
      vazio(
        'Nenhuma conversa com origem registrada',
        `Nenhuma conversa ${faixaEmTexto(filtro)} esta ligada a uma origem cadastrada. A lista fica em Configuracoes > Classes.`,
      ),
    );
  }

  const corpo = el('tbody');
  for (const origem of linhas) {
    corpo.append(
      el('tr', {}, [
        el('td', { texto: origem.nome }),
        el('td', { texto: numero(origem.novas) }),
        el('td', { texto: numero(origem.qualificados) }),
        el('td', { texto: numero(origem.propostas) }),
        el('td', {}, [el('strong', { texto: numero(origem.sucessos) })]),
        el('td', { texto: numero(origem.perdas) }),
        el('td', {
          // numero() para a virgula do pt-BR: sem ela esta era a unica celula
          // da linha com separador decimal de ponto.
          texto: origem.novas
            ? `${numero(Number(((origem.sucessos / origem.novas) * 100).toFixed(1)))}%`
            : '0%',
        }),
      ]),
    );
  }

  return cartaoComDica(
    { titulo: 'Por origem', conceito: CONCEITO_ORIGEM },
    el('div', { class: 'tabela-rolagem' }, [
      el('table', { class: 'tabela-densa' }, [
        el('thead', {}, [
          el('tr', {}, [
            el('th', { texto: 'Origem' }),
            el('th', { texto: 'Novas' }),
            el('th', { texto: 'Qualificados' }),
            el('th', { texto: 'Propostas' }),
            el('th', { texto: 'Contratos' }),
            el('th', { texto: 'Perdas' }),
            el('th', { texto: 'Conversao' }),
          ]),
        ]),
        corpo,
      ]),
    ]),
  );
}

/* Secao D, distribuicao atual ---------------------------------------- */

function secaoDistribuicao(dados, filtro) {
  const total = dados.totalConversas;
  const grade = el(
    'div',
    { class: 'grade-roscas' },
    ROSCAS.map((divisao) => cartaoDeRosca(divisao, dados.distribuicao[divisao.chave], filtro, total)),
  );

  return secao('Distribuicao atual', total ? selo(`${numero(total)} conversas`, 'ouro') : null, grade);
}

function normalizarFatias(itens) {
  return (Array.isArray(itens) ? itens : [])
    .map((item, indice) => ({
      nome: item.nome || 'Sem nome',
      cor: item.cor || PALETA[indice % PALETA.length],
      total: Number(item.total) || 0,
    }))
    .filter((item) => item.total > 0)
    .sort((a, b) => b.total - a.total);
}

function cartaoDeRosca(divisao, itens, filtro, totalDaCarteira) {
  const lista = normalizarFatias(itens);
  /* Dentro da .grade-roscas os cartoes ficam lado a lado, e o empilhamento
     vertical do .cartao + .cartao desalinharia a fileira. Quem desliga esse
     empilhamento e a propria grade, no CSS. */
  const caixa = cartaoComDica({ titulo: divisao.titulo, conceito: divisao.conceito });
  marcarCabeco(caixa, divisao.icone);

  const grafico = rosca(
    lista.map((item) => ({ nome: item.nome, valor: item.total, cor: item.cor })),
    { rotulo: divisao.titulo },
  );

  if (!grafico) {
    /* Lista sem barra nenhuma sairia como um retangulo vazio, que se le como
       carregamento travado. No lugar dela, o motivo e a saida. Esta secao olha a carteira de
       agora, entao mexer no periodo aqui nao muda nada, e mandar ampliar o
       periodo levaria a pessoa para o lado errado.

       Os tres casos sao diferentes de verdade, e a frase precisa acertar qual e:
       com conversa na carteira e o anel vazio, o problema esta no cadastro desta
       divisao, e nao na falta de conversa. */
    const ativos = recortesLigados(filtro);
    let motivo;
    if (totalDaCarteira) {
      motivo = `Nenhuma das ${numero(totalDaCarteira)} conversas da carteira caiu nesta divisao. Confira o que esta cadastrado em ${divisao.onde}.`;
    } else if (ativos.length) {
      motivo = `Nenhuma conversa passa pelo filtro de ${enumerar(ativos)} ligado na barra. Volte para "todas" para ver a carteira inteira.`;
    } else {
      motivo = 'Nenhuma conversa visivel para voce na carteira.';
    }
    caixa.append(vazio('Nada para dividir aqui', motivo));
    return caixa;
  }

  caixa.append(grafico);

  /* A rosca mostra a proporcao, e nao o nome de cada fatia. As duas maiores vao
     escritas embaixo, com o valor, porque sao as que respondem a pergunta na
     maioria das vezes. O resto fica a um clique. */
  const total = lista.reduce((soma, item) => soma + item.total, 0);
  caixa.append(
    el(
      'div',
      { class: 'rosca-legenda' },
      lista.slice(0, 2).map((item) =>
        el('span', {}, [
          el('span', { class: 'ponto', estilo: { background: item.cor } }),
          document.createTextNode(item.nome),
          el('b', { texto: numero(item.total) }),
        ]),
      ),
    ),
  );

  const abrir = botao(`Ver tudo, ${lista.length}`, {
    pequeno: true,
    aoClicar: () => abrirListaCompleta(divisao.titulo, lista, total),
  });
  abrir.classList.add('rosca-ver-tudo');
  caixa.append(abrir);

  return caixa;
}

function abrirListaCompleta(titulo, lista, total) {
  const maior = lista[0]?.total || 1;
  const corpo = el(
    'div',
    {},
    lista.map((item) =>
      el('div', { class: 'mb-3' }, [
        el('div', { class: 'linha mb-2 t-sm' }, [
          el('span', { class: 'ponto', estilo: { background: item.cor } }),
          el('span', { class: 'flexivel encolhe', texto: item.nome }),
          el('strong', { class: 'num', texto: numero(item.total) }),
          el('span', {
            class: 'c-fraco valor-percentual',
            texto: `${numero(total ? Number(((item.total / total) * 100).toFixed(1)) : 0)}%`,
          }),
        ]),
        el('div', { class: 'barra' }, [
          el('div', { estilo: { width: `${Math.max(2, (item.total / maior) * 100)}%`, background: item.cor } }),
        ]),
      ]),
    ),
  );

  modal({ titulo, corpo });
}

/* Rodape -------------------------------------------------------------- */

/**
 * O consumo de creditos morava no fim desta tela e mudou para Configuracoes >
 * Consumo. Quem procurava o numero aqui precisa achar o caminho novo, senao
 * conclui que o dado sumiu do sistema. A linha e discreta de proposito: ela
 * atende quem esta procurando, sem competir com o funil.
 *
 * Link de verdade, e nao botao: quem quiser abre em outra aba, e o endereco
 * aparece na barra de status antes do clique. O sublinhado dele vem de
 * .rodape-nota a, porque cor sozinha nao e sinal suficiente de link dentro de
 * uma frase.
 */
function rodapeDoConsumo() {
  return el('p', { class: 'rodape-nota' }, [
    icone('raio', 14),
    document.createTextNode('Consumo de creditos de IA:'),
    el('a', { href: '#/configuracoes/consumo', texto: 'Configuracoes > Consumo' }),
  ]);
}

/* Data -> AAAA-MM-DD pelos campos locais. toISOString converte para UTC e, a
   noite, devolve o dia seguinte. */
function paraIso(data) {
  const mes = String(data.getMonth() + 1).padStart(2, '0');
  const dia = String(data.getDate()).padStart(2, '0');
  return `${data.getFullYear()}-${mes}-${dia}`;
}
