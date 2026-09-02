import { api, enviarArquivo } from '../api.js';
import { campoComDica, dica, paginacao, previaDaMidia } from '../componentes.js';
import { acharConexao, acharEtiqueta, estado, opcoesResponsavel, ouvir, recarregar } from '../estado.js';
import {
  areaTexto,
  avatar,
  aviso,
  botao,
  campo,
  confirmar,
  dataHora,
  el,
  entradaTexto,
  icone,
  limpar,
  modal,
  numero,
  plural,
  quando,
  selecao,
  selo,
  telefone,
  vazio,
} from '../ui.js';

/**
 * Tela de atendimento. Tres visualizacoes sobre a mesma base, cada uma com a
 * sua rota: conversas (o dia a dia), contatos (tabela para filtrar, ordenar e
 * exportar) e kanban (o funil em movimento).
 *
 * Quem troca de visualizacao e o menu lateral, nao um alternador dentro da
 * tela. Assim cada visualizacao tem endereco proprio, o voltar do navegador
 * funciona e o menu mostra onde a pessoa esta.
 */

const ABAS = [
  { id: 'ia', rotulo: 'IA' },
  { id: 'ativos', rotulo: 'Ativos' },
  { id: 'pendentes', rotulo: 'Pendentes' },
  { id: 'grupos', rotulo: 'Grupos' },
  { id: 'arquivados', rotulo: 'Arquivados' },
];

/* Linhas por pagina na tabela de contatos, ate a pessoa escolher outro tamanho. */
const POR_PAGINA_CONTATOS = 25;

/**
 * Teto de contatos pedidos de uma vez para a tabela.
 *
 * A rota GET /api/contatos filtra, ordena por ultima mensagem e corta no
 * limite pedido, mas nao pagina. Entao a pagina e recortada aqui no navegador,
 * sobre a lista que chegou. Quando a base passar de alguns milhares de
 * contatos isso precisa virar paginacao de servidor, com pagina, tamanho e
 * ordem indo na query e o total voltando junto: carregar a base inteira para
 * desenhar 25 linhas para de ser aceitavel bem antes disso.
 */
const LIMITE_CONTATOS = 1000;

/* Quantos cartoes cada coluna do kanban desenha antes de resumir o resto. */
const CARTOES_POR_COLUNA = 50;

/**
 * De onde sai o valor de comparacao de cada coluna ordenavel da tabela.
 * Texto compara por localeCompare, numero compara por subtracao.
 */
const ORDENACAO_CONTATOS = {
  nome: (contato) => (contato.nome || '').trim(),
  status: (contato) => contato.status?.nome || '',
  ultimaMensagem: (contato) => (contato.ultimaMensagemEm ? Date.parse(contato.ultimaMensagemEm) : 0),
};

/**
 * Rotulo do painel de propriedades com a explicacao atras do icone de ajuda.
 *
 * O conceito nao ocupa mais uma linha fixa embaixo do controle. Esta e a tela
 * que fica aberta o dia inteiro: a explicacao e lida uma vez, na primeira
 * semana, e depois so rouba altura da conversa.
 *
 * Existe alem de campoComDica() porque a coluna da direita nao monta campo:
 * ela empilha `.propriedade`, um <div> com o rotulo em <span> e o controle
 * solto. O <span> de fora e o rotulo que o tema ja desenha, e o de dentro
 * existe porque `.propriedade > span` diz display block e ganha de qualquer
 * utilitaria. E o de dentro que alinha o texto com o icone.
 */
function rotuloComDica(texto, ajuda) {
  return el('span', {}, [
    el('span', { class: 'linha' }, [document.createTextNode(texto), dica(ajuda, { assunto: texto })]),
  ]);
}

/*
 * Rascunho por conversa.
 *
 * A tela se redesenha inteira a cada evento do servidor, e o compositor nasce
 * de novo junto. Sem esta guarda, bastava outro atendente mudar o status de
 * outra conversa, ou o agente de IA mover qualquer lead no funil, para o texto
 * que estava sendo escrito desaparecer no meio da frase. Trocar de conversa
 * para conferir um dado e voltar tinha o mesmo efeito.
 *
 * Fica em memoria, e nao em disco: rascunho de mensagem para cliente e coisa
 * da sessao, e gravar conversa de cliente no navegador criaria um lugar a mais
 * onde esse dado existe.
 */
const RASCUNHOS = new Map();

export async function paginaAtendimento({ parametros, visualizacao = 'conversas' }) {
  const filtro = {
    aba: 'ia',
    busca: '',
    status: '',
    departamento: '',
    responsavel: '',
    etiqueta: '',
    conexao: '',
  };

  let contatos = [];
  let contagens = {};
  /* Quantos existem no filtro, antes do corte do limite. */
  let totalNoServidor = 0;
  /* Quantos existem em cada status, tambem contados antes do corte. */
  let totalPorStatus = {};
  let selecionadoId = parametros[0] || null;
  const marcados = new Set();

  /* Estado da tabela de contatos. Sobrevive ao redesenho vindo do servidor. */
  let paginaContatos = 1;
  let porPaginaContatos = POR_PAGINA_CONTATOS;
  let ordemContatos = { coluna: 'ultimaMensagem', direcao: 'decrescente' };
  let areaContatos = null;

  const container = el('div', { class: 'atendimento' });

  /* Referencias da conversa aberta agora. Trocadas a cada redesenho. */
  const vivo = { indicador: null, painel: null, contatoId: null, recarregar: null };

  /**
   * "O agente esta escrevendo" e estado, nao pintura.
   *
   * A tela se redesenha a cada evento do servidor, e o evento de digitando
   * costuma chegar no meio de um redesenho. Guardando ate quando vale, quem
   * desenha decide se mostra, e o indicador sobrevive a reconstrucao da tela.
   */
  let digitandoAte = 0;
  let fimDoDigitando = null;

  const digitando = () => Date.now() < digitandoAte;

  const pararDigitando = () => {
    digitandoAte = 0;
    if (vivo.indicador) vivo.indicador.style.display = 'none';
    if (fimDoDigitando) clearTimeout(fimDoDigitando);
  };

  async function buscar() {
    const resposta = await api.get('/api/contatos', {
      ...filtro,
      aba: visualizacao === 'conversas' ? filtro.aba : 'todas',
      comMensagem: visualizacao === 'contatos' ? undefined : 'true',
      limite: visualizacao === 'contatos' ? LIMITE_CONTATOS : 400,
    });
    contatos = resposta.contatos;
    contagens = resposta.contagens;
    totalNoServidor = resposta.total ?? resposta.contatos.length;
    totalPorStatus = resposta.porStatus || {};
  }

  async function desenhar() {
    await buscar();
    limpar(container);

    // A largura das colunas sai toda do tema, pelo nome da classe. Escrita no
    // atributo style, ela vencia a media query de 1180px: abaixo dessa largura
    // a terceira coluna sumia mas a grade continuava reservando os 300px dela,
    // e sobrava uma faixa vazia na direita.
    if (visualizacao === 'conversas') {
      container.className = 'atendimento';
      container.append(colunaLista(), colunaConversa(), colunaPropriedades());
    } else {
      container.className = 'atendimento coluna-unica';
      container.append(visualizacao === 'kanban' ? montarKanban() : montarTabela());
    }
  }

  /* ---------------- Filtros ---------------- */

  function abrirFiltros() {
    const corpo = el('div');
    const campos = [
      ['status', 'Status', estado.status.map((s) => ({ valor: s.id, rotulo: s.nome }))],
      [
        'departamento',
        'Departamento',
        [
          { valor: 'sem-departamento', rotulo: 'Sem departamento' },
          ...estado.departamentos.map((d) => ({ valor: d.id, rotulo: d.nome })),
        ],
      ],
      ['etiqueta', 'Etiqueta', estado.etiquetas.map((e) => ({ valor: e.id, rotulo: e.nome }))],
      ['conexao', 'Conexao', estado.conexoes.map((c) => ({ valor: c.id, rotulo: c.nome }))],
      [
        'responsavel',
        'Responsavel',
        [
          { valor: 'nenhum', rotulo: 'Sem responsavel' },
          ...estado.agentes.map((a) => ({ valor: a.id, rotulo: `IA · ${a.nome}` })),
          ...estado.membros.map((m) => ({ valor: m.id, rotulo: `Equipe · ${m.usuario?.nome}` })),
        ],
      ],
      ['origem', 'Origem', estado.origens.map((o) => ({ valor: o.id, rotulo: o.nome }))],
    ];

    const controles = {};
    for (const [chave, rotulo, opcoes] of campos) {
      controles[chave] = selecao([{ valor: '', rotulo: 'Todos' }, ...opcoes], filtro[chave] || '');
      corpo.append(campo(rotulo, controles[chave]));
    }

    modal({
      titulo: 'Filtrar conversas',
      corpo,
      confirmar: 'Aplicar',
      aoConfirmar: async () => {
        for (const chave of Object.keys(controles)) filtro[chave] = controles[chave].value;
        await desenhar();
      },
    });
  }

  /* ---------------- Coluna 1: lista ---------------- */

  function colunaLista() {
    const busca = entradaTexto(filtro.busca, { type: 'search', placeholder: 'Buscar nome ou numero…' });
    let temporizador = null;
    busca.addEventListener('input', () => {
      clearTimeout(temporizador);
      temporizador = setTimeout(async () => {
        filtro.busca = busca.value;
        await buscar();
        atualizarLista();
      }, 260);
    });

    const abas = el('div', { class: 'abas' });
    for (const aba of ABAS) {
      abas.append(
        el('button', { class: filtro.aba === aba.id ? 'ativo' : '', aoClick: async () => {
          filtro.aba = aba.id;
          await desenhar();
        } }, [
          document.createTextNode(aba.rotulo),
          el('span', { class: 'conta', texto: String(contagens[aba.id] ?? 0) }),
        ]),
      );
    }

    const filtrosAtivos = Object.entries(filtro).filter(
      ([chave, valor]) => valor && !['aba', 'busca'].includes(chave),
    ).length;

    const corpo = el('div', { class: 'coluna-corpo' });

    const coluna = el('div', { class: 'coluna' }, [
      el('div', { class: 'coluna-cabecalho' }, [
        el('div', { class: 'linha-botoes mb-2' }, [
          el('div', { class: 'flexivel' }, [busca]),
          botao(filtrosAtivos ? String(filtrosAtivos) : '', {
            icone: 'filtros',
            titulo: 'Filtros',
            aoClicar: abrirFiltros,
          }),
          botao('', { icone: 'mais', titulo: 'Nova conversa', aoClicar: abrirNovaConversa }),
        ]),
        abas,
      ]),
      corpo,
    ]);

    function atualizarLista() {
      limpar(corpo);
      if (!contatos.length) {
        corpo.append(vazio('Nenhuma conversa aqui', 'Conecte um WhatsApp ou use o simulador.'));
        return;
      }
      for (const contato of contatos) corpo.append(itemConversa(contato));
    }

    atualizarLista();
    return coluna;
  }

  /**
   * Linha da conversa.
   *
   * E um <button> e nao um <div> com aoClick: esta lista e a navegacao
   * principal da tela, e num div sem tabindex nem role quem usa teclado ou
   * leitor de tela nao conseguia abrir conversa nenhuma. O estilo neutro que
   * devolve o botao a aparencia de linha esta em .item-conversa, no tema.css.
   */
  function itemConversa(contato) {
    const responsavel = contato.responsavel;
    const ativo = contato.id === selecionadoId;
    const item = el('button', {
      type: 'button',
      class: `item-conversa ${ativo ? 'ativo' : ''}`.trim(),
      'aria-current': ativo ? 'true' : null,
      /* O nome do status vai no title: a cor sozinha nao carrega significado
         para quem nao a distingue, e a lista nao tem espaco para o rotulo. */
      title: contato.status ? contato.status.nome : null,
      estilo: { '--marca-status': contato.status?.cor || 'transparent' },
      aoClick: async () => {
        selecionadoId = contato.id;
        history.replaceState(null, '', `#/atendimento/${contato.id}`);
        await desenhar();
      },
    }, [
      avatar(contato),
      el('div', { class: 'dados' }, [
        el('div', { class: 'topo-item' }, [
          el('div', { class: 'nome', texto: contato.nome }),
          el('div', { class: 'quando', texto: quando(contato.ultimaMensagemEm) }),
        ]),
        /* Previa, marcador de IA e contador dividem a segunda linha. Empilhados,
           cada um custava uma linha inteira da lista. */
        el('div', { class: 'linha-previa' }, [
          el('div', { class: 'previa', texto: contato.previa || telefone(contato.telefone) }),
          /* Do responsavel sobra so o caso que muda a decisao: quem esta com a
             IA, ninguem precisa atender agora. O nome de quem atende repetia em
             toda linha e vive no painel da direita. */
          responsavel?.tipo === 'agente' ? el('span', { class: 'marca-ia', texto: 'IA' }) : null,
          contato.naoLidas ? el('span', { class: 'nao-lidas', texto: String(contato.naoLidas) }) : null,
        ]),
      ]),
    ]);
    return item;
  }

  /* ---------------- Coluna 2: conversa ---------------- */

  function colunaConversa() {
    const contato = contatos.find((c) => c.id === selecionadoId) || contatos[0];
    if (!contato) {
      // Este e o primeiro painel de quem abre o sistema sem nenhuma conversa.
      // Sem a segunda linha ele nao diz como sair dali.
      return el('div', { class: 'conversa' }, [vazio('Escolha uma conversa', 'Ou mande uma mensagem pelo simulador.')]);
    }
    selecionadoId = contato.id;

    const painelMensagens = el('div', { class: 'mensagens' });
    const compositor = montarCompositor(contato);

    const cabecalho = el('div', { class: 'conversa-cabecalho' }, [
      avatar(contato),
      // Mesmo ritmo da lista de conversas: nome em --t-md peso 600, telefone
      // em --t-xs fraco. Antes o nome herdava o corpo e o telefone tinha
      // 11,5px escritos na mao.
      el('div', { class: 'flexivel encolhe' }, [
        el('div', { class: 't-md peso-600', texto: contato.nome }),
        el('div', { class: 't-xs c-fraco', texto: telefone(contato.telefone) }),
      ]),
      contato.estado === 'pendente'
        ? botao('Aceitar atendimento', {
            tipo: 'principal',
            pequeno: true,
            aoClicar: async () => {
              await api.post(`/api/contatos/${contato.id}/aceitar`);
              aviso('Conversa aceita. Ela esta em Ativos.', 'sucesso');
              await desenhar();
            },
          })
        : null,
      botao('', { icone: 'atualizar', titulo: 'Reiniciar a conversa (/restart)', pequeno: true, aoClicar: () =>
        confirmar(
          'Reiniciar esta conversa?',
          'Apaga o historico, zera as variaveis e devolve a conversa ao agente padrao da conexao.',
          async () => {
            await api.post(`/api/contatos/${contato.id}/restart`);
            aviso('Conversa reiniciada.', 'sucesso');
            await desenhar();
          },
          'Reiniciar',
        ) }),
      botao('', { icone: 'contrato', titulo: 'Gerar resumo', pequeno: true, aoClicar: () => abrirResumo(contato) }),
      botao('', { icone: 'conexoes', titulo: 'Unificar conversas', pequeno: true, aoClicar: () => abrirUnificar(contato) }),
      botao('', {
        icone: contato.estado === 'arquivado' ? 'atualizar' : 'ok',
        titulo: contato.estado === 'arquivado' ? 'Reabrir' : 'Arquivar',
        pequeno: true,
        aoClicar: async () => {
          await api.post(`/api/contatos/${contato.id}/arquivar`, { arquivar: contato.estado !== 'arquivado' });
          await desenhar();
        },
      }),
      estado.sessao.papel === 'administrador'
        ? botao('', {
            icone: 'lixo',
            titulo: 'Excluir a conversa definitivamente (LGPD)',
            pequeno: true,
            aoClicar: () =>
              confirmar(
                `Excluir a conversa de ${contato.nome}?`,
                'Some tudo: mensagens, arquivos, agendamentos, contratos e registros de consumo. Nao tem como desfazer. Para tirar da fila sem apagar, use Arquivar.',
                async () => {
                  await api.delete(`/api/contatos/${contato.id}`);
                  selecionadoId = null;
                  aviso('Conversa excluida.', 'sucesso');
                  await desenhar();
                },
                'Excluir definitivamente',
              ),
          })
        : null,
    ]);

    /*
     * Filtro rapido da conversa: tudo, so o que foi marcado com estrela, so as
     * notas da equipe.
     *
     * Ele nao vai para o painel da direita, e sim para cima da propria conversa.
     * O que se procura com ele (o numero do beneficio que o cliente mandou na
     * semana passada) precisa aparecer no balao, com a data e quem escreveu em
     * volta; numa lista separada, o trecho chega sem o contexto que o explica.
     *
     * O estado vive fora de carregarMensagens para sobreviver ao redesenho que
     * cada mensagem nova dispara.
     */
    let recorte = 'todas';

    const filtroDaConversa = el('div', { class: 'recorte-conversa', role: 'group', 'aria-label': 'Filtrar mensagens' });
    const RECORTES = [
      { valor: 'todas', rotulo: 'Todas' },
      { valor: 'favoritas', rotulo: 'Favoritas', simbolo: 'estrela' },
      { valor: 'notas', rotulo: 'Notas' },
    ];
    for (const opcao of RECORTES) {
      const alvo = el(
        'button',
        { type: 'button', class: opcao.valor === recorte ? 'ativo' : '', 'aria-pressed': String(opcao.valor === recorte) },
        [opcao.simbolo ? icone(opcao.simbolo, 12) : null, el('span', { texto: opcao.rotulo })].filter(Boolean),
      );
      alvo.addEventListener('click', () => {
        if (recorte === opcao.valor) return;
        recorte = opcao.valor;
        for (const irmao of filtroDaConversa.children) {
          const ligado = irmao === alvo;
          irmao.classList.toggle('ativo', ligado);
          irmao.setAttribute('aria-pressed', String(ligado));
        }
        carregarMensagens();
      });
      filtroDaConversa.append(alvo);
    }

    async function carregarMensagens() {
      const { mensagens } = await api.get(`/api/contatos/${contato.id}/mensagens`);
      limpar(painelMensagens);

      const visiveis =
        recorte === 'favoritas'
          ? mensagens.filter((m) => m.favorita)
          : recorte === 'notas'
            ? mensagens.filter((m) => m.nota)
            : mensagens;

      /* Contador no proprio botao: sem ele, quem clica em Favoritas e nao ve
         nada nao sabe se marcou zero mensagens ou se o filtro falhou. */
      const quantas = { favoritas: mensagens.filter((m) => m.favorita).length, notas: mensagens.filter((m) => m.nota).length };
      for (const [indice, opcao] of RECORTES.entries()) {
        if (opcao.valor === 'todas') continue;
        const texto = filtroDaConversa.children[indice].querySelector('span');
        const total = quantas[opcao.valor];
        texto.textContent = total ? `${opcao.rotulo} ${total}` : opcao.rotulo;
      }

      if (!visiveis.length) {
        // Sem a segunda linha, o painel vazio se le como falha de carregamento.
        painelMensagens.append(
          recorte === 'todas'
            ? vazio('Sem mensagens', 'A conversa foi criada, mas nada foi trocado ainda.')
            : vazio(
                recorte === 'favoritas' ? 'Nenhuma mensagem favoritada' : 'Nenhuma nota interna',
                recorte === 'favoritas'
                  ? 'Clique na estrela ao lado da hora de uma mensagem para guardar o que importa neste caso.'
                  : 'Use o botao "Nota interna" no campo de escrita para deixar um recado visivel so para a equipe.',
              ),
        );
      }
      for (const mensagem of visiveis) painelMensagens.append(balao(mensagem));
      // O indicador vive no fim da lista e precisa voltar a cada redesenho dela.
      painelMensagens.append(aviso3Pontos);
      painelMensagens.scrollTop = painelMensagens.scrollHeight;
      if (contato.naoLidas) api.post(`/api/contatos/${contato.id}/ler`).catch(() => {});
    }

    // O agente agrupa mensagens antes de responder. Sem sinal nenhum na tela,
    // o atendente acha que travou e assume a conversa no meio do raciocinio.
    const aviso3Pontos = el('div', { class: 'digitando', estilo: { display: digitando() ? 'inline-flex' : 'none' } }, [
      el('span'),
      el('span'),
      el('span'),
    ]);

    // A tela se redesenha a cada evento do servidor, entao guardamos aqui o
    // indicador vivo. Os ouvintes ficam no nivel da pagina e sempre olham para
    // esta referencia, nunca para um elemento ja descartado.
    vivo.indicador = aviso3Pontos;
    vivo.painel = painelMensagens;
    vivo.contatoId = contato.id;
    vivo.recarregar = carregarMensagens;

    carregarMensagens();

    return el('div', { class: 'conversa' }, [cabecalho, filtroDaConversa, painelMensagens, compositor]);
  }

  /**
   * A estrela de uma mensagem.
   *
   * Fica no rodape do balao, junto da hora, e nao aparece so no hover: numa
   * conversa longa, o que ja esta marcado precisa ser visivel enquanto se
   * rola, senao a marcacao nao serve de nada.
   *
   * Nota interna nao leva estrela. Ela ja e o lugar de guardar o que importa,
   * e a lista da direita mostra as duas coisas juntas de qualquer jeito.
   */
  function estrelaDa(mensagem) {
    if (mensagem.nota) return null;

    const marcada = Boolean(mensagem.favorita);
    const alvo = el('button', {
      type: 'button',
      class: `estrela${marcada ? ' marcada' : ''}`,
      title: marcada
        ? `Favoritada por ${mensagem.favoritaPor?.nome || 'alguem da equipe'}`
        : 'Marcar como importante',
      'aria-pressed': marcada ? 'true' : 'false',
      'aria-label': marcada ? 'Desmarcar mensagem' : 'Marcar mensagem como importante',
    }, [icone(marcada ? 'estrela-cheia' : 'estrela', 13)]);

    alvo.addEventListener('click', async (evento) => {
      evento.stopPropagation();
      /* Trava o botao durante o pedido. Sem isso, dois cliques rapidos mandam
         dois toggles e a mensagem volta ao estado inicial, parecendo que o
         clique nao funcionou. */
      if (alvo.disabled) return;
      alvo.disabled = true;
      try {
        await api.post(`/api/contatos/${mensagem.contatoId}/mensagens/${mensagem.id}/favorita`);
        await vivo.recarregar?.();
      } catch (erro) {
        aviso(erro.message, 'erro');
        alvo.disabled = false;
      }
    });

    return alvo;
  }

  function balao(mensagem) {
    const classes = ['balao'];
    if (mensagem.nota) classes.push('nota');
    else if (mensagem.direcao === 'saida') classes.push('saida');
    if (mensagem.situacao === 'erro') classes.push('erro');

    const autor = mensagem.autor?.nome;
    const mostraAutor = mensagem.direcao !== 'entrada' && autor;

    return el('div', { class: classes.join(' ') }, [
      mensagem.nota ? el('div', { class: 'balao-autor', texto: `Nota interna · ${autor || 'equipe'}` }) : null,
      !mensagem.nota && mostraAutor ? el('div', { class: 'balao-autor', texto: autor }) : null,
      el('div', { texto: mensagem.conteudo || (mensagem.midia ? `[${mensagem.tipo}] ${mensagem.midia.nome || ''}` : '') }),
      previaDaMidia(mensagem.midia, { compacta: true }),
      mensagem.transcricao
        ? el('div', {
            class: 't-xs c-suave mt-1',
            // O italico e a unica coisa que sobra no atributo style deste
            // balao: nao existe utilitaria de estilo de fonte.
            estilo: { fontStyle: 'italic' },
            texto: 'Transcrito automaticamente do audio.',
          })
        : null,
      el('div', { class: 'balao-rodape' }, [
        estrelaDa(mensagem),
        document.createTextNode(dataHora(mensagem.criadoEm)),
        mensagem.origemAutomacao ? selo(mensagem.origemAutomacao === 'followup' ? 'follow-up' : 'agendada', '') : null,
        mensagem.situacao === 'erro'
          ? selo(`erro ${mensagem.erro?.codigo || ''}`.trim(), 'erro')
          : mensagem.direcao === 'saida'
            ? document.createTextNode(mensagem.situacao || '')
            : null,
      ]),
      mensagem.situacao === 'erro' && mensagem.erro?.mensagem
        ? el('div', { class: 't-xs mt-1 c-erro', texto: mensagem.erro.mensagem })
        : null,
    ]);
  }

  function montarCompositor(contato) {
    const texto = areaTexto(RASCUNHOS.get(contato.id) || '', {
      placeholder: 'Escreva a mensagem… (/ para template)',
    });
    let ehNota = false;
    let agendarPara = null;

    const alternarNota = botao('Nota interna', {
      pequeno: true,
      aoClicar: () => {
        ehNota = !ehNota;
        alternarNota.classList.toggle('principal', ehNota);
        texto.placeholder = ehNota ? 'Nota visivel so para a equipe…' : 'Escreva a mensagem… (/ para template)';
      },
    });

    const rotuloAgenda = el('span', { class: 'selo', estilo: { display: 'none' } });

    let anexo = null;
    // .selo-clicavel devolve o cursor de mao ao selo que responde ao clique.
    // A regra deveria morar em web/css/tema.css, logo abaixo do bloco .selo.
    // O display continua no atributo style porque e estado de execucao: o
    // selo so aparece depois que o arquivo sobe.
    const rotuloAnexo = el('span', {
      class: 'selo ouro selo-clicavel',
      estilo: { display: 'none' },
      title: 'Clique para remover',
    });
    rotuloAnexo.addEventListener('click', () => {
      anexo = null;
      rotuloAnexo.style.display = 'none';
    });

    const seletorArquivo = el('input', {
      type: 'file',
      estilo: { display: 'none' },
      accept: 'image/*,video/mp4,video/webm,audio/*,application/pdf',
    });
    seletorArquivo.addEventListener('change', async () => {
      const arquivo = seletorArquivo.files[0];
      if (!arquivo) return;
      try {
        anexo = await enviarArquivo(arquivo);
        rotuloAnexo.textContent = `anexo: ${anexo.nome}`;
        rotuloAnexo.style.display = 'inline-flex';
      } catch (erro) {
        aviso(erro.message, 'erro');
      }
      seletorArquivo.value = '';
    });

    const enviar = async () => {
      const conteudo = texto.value.trim();
      if (!conteudo && !anexo) return;
      try {
        await api.post(`/api/contatos/${contato.id}/mensagens`, {
          conteudo,
          midia: anexo,
          nota: ehNota,
          agendarPara,
        });
        texto.value = '';
        /* Enviou, entao o rascunho cumpriu o papel. Deixado no mapa, ele
           voltaria sozinho no proximo desenho, como se a mensagem nao tivesse
           saido. */
        RASCUNHOS.delete(contato.id);
        texto.style.height = 'auto';
        anexo = null;
        agendarPara = null;
        rotuloAnexo.style.display = 'none';
        rotuloAgenda.style.display = 'none';
      } catch (erro) {
        aviso(erro.message, 'erro');
      }
    };

    /*
     * O campo cresce com o texto ate um teto.
     *
     * Preso em duas linhas, escrever a explicacao de um beneficio virava
     * digitar dentro de uma fresta com barra de rolagem propria, sem enxergar
     * o que ja foi escrito. O teto existe para o compositor nao engolir a
     * conversa: passando dele, volta a rolar por dentro.
     */
    const ajustarAltura = () => {
      texto.style.height = 'auto';
      texto.style.height = Math.min(texto.scrollHeight, 200) + 'px';
    };

    texto.addEventListener('input', () => {
      /* Rascunho vazio nao ocupa lugar no mapa: sem isso, abrir uma conversa e
         desistir de escrever deixaria entrada morta para sempre. */
      if (texto.value) RASCUNHOS.set(contato.id, texto.value);
      else RASCUNHOS.delete(contato.id);
      ajustarAltura();
    });
    /* Ajusta ja na montagem, para o rascunho restaurado aparecer inteiro. */
    queueMicrotask(ajustarAltura);

    texto.addEventListener('keydown', (evento) => {
      if (evento.key === 'Enter' && !evento.shiftKey) {
        evento.preventDefault();
        enviar();
      }
      if (evento.key === '/' && !texto.value) {
        evento.preventDefault();
        abrirSeletorTemplate(contato, texto);
      }
    });

    const avisoJanela =
      acharConexao(contato.conexaoId)?.tipo === 'oficial' && !contato.janelaAberta
        ? el('div', {
            class: 'aviso-janela',
            texto:
              'Janela de 24 horas fechada. Fora dela a Meta so aceita template aprovado, escolha um pelo botao de templates.',
          })
        : null;

    return el('div', { class: 'compositor' }, [
      avisoJanela,
      texto,
      seletorArquivo,
      el('div', { class: 'linha-botoes mt-2' }, [
        alternarNota,
        botao('Anexar', { pequeno: true, icone: 'anexar', titulo: 'Imagem, video, audio ou PDF (ate 16 MB)', aoClicar: () => seletorArquivo.click() }),
        botao('Template', { pequeno: true, icone: 'templates', aoClicar: () => abrirSeletorTemplate(contato, texto) }),
        botao('Agendar', {
          pequeno: true,
          icone: 'relogio',
          aoClicar: () =>
            abrirAgendamento((iso, rotulo) => {
              agendarPara = iso;
              rotuloAgenda.textContent = `agendada para ${rotulo}`;
              rotuloAgenda.style.display = 'inline-flex';
            }),
        }),
        contato.responsavel?.tipo === 'agente'
          ? botao('Assumir conversa', {
              pequeno: true,
              aoClicar: async () => {
                await api.patch(`/api/contatos/${contato.id}`, {
                  responsavel: { tipo: 'membro', id: estado.sessao.membro.id },
                });
                aviso('Voce assumiu a conversa. A IA parou de responder.', 'sucesso');
                await desenhar();
              },
            })
          : null,
        rotuloAnexo,
        rotuloAgenda,
        el('div', { class: 'flexivel' }),
        botao('Enviar', { tipo: 'principal', icone: 'enviar', pequeno: true, aoClicar: enviar }),
      ]),
    ]);
  }

  function abrirSeletorTemplate(contato, campoTexto) {
    const lista = el('div', { class: 'lista-simples' });
    for (const template of estado.templates) {
      lista.append(
        el('div', { class: 'lista-item' }, [
          el('div', { class: 'corpo' }, [
            el('div', { class: 'titulo', texto: `/${template.atalho} · ${template.nome}` }),
            el('div', { class: 'desc', texto: (template.conteudo || '').slice(0, 120) }),
          ]),
          botao('Inserir', {
            pequeno: true,
            aoClicar: () => {
              campoTexto.value = template.conteudo.replace(/\{\{nome\}\}/g, contato.nome);
              document.querySelector('.cortina')?.remove();
              campoTexto.focus();
            },
          }),
          botao('Enviar', {
            pequeno: true,
            tipo: 'principal',
            aoClicar: async () => {
              await api.post(`/api/contatos/${contato.id}/mensagens`, { templateId: template.id });
              document.querySelector('.cortina')?.remove();
            },
          }),
        ]),
      );
    }
    modal({ titulo: 'Enviar template', corpo: lista, largo: true });
  }

  function abrirAgendamento(aoEscolher) {
    const entrada = el('input', { type: 'datetime-local' });
    const atalhos = el('div', { class: 'linha-botoes mb-3' }, [
      botao('Daqui a 1 hora', { pequeno: true, aoClicar: () => definir(60) }),
      botao('Daqui a 24 horas', { pequeno: true, aoClicar: () => definir(1440) }),
      botao('Amanha 9h', {
        pequeno: true,
        aoClicar: () => {
          const data = new Date();
          data.setDate(data.getDate() + 1);
          data.setHours(9, 0, 0, 0);
          aplicar(data);
        },
      }),
    ]);

    function definir(minutos) {
      aplicar(new Date(Date.now() + minutos * 60000));
    }
    function aplicar(data) {
      const local = new Date(data.getTime() - data.getTimezoneOffset() * 60000);
      entrada.value = local.toISOString().slice(0, 16);
    }

    modal({
      titulo: 'Agendar mensagem',
      corpo: el('div', {}, [
        atalhos,
        // A diferenca entre mensagem agendada e follow-up e conceito, e conceito
        // mora atras do icone: quem agenda a decima mensagem nao precisa reler.
        campoComDica(
          'Data e hora',
          entrada,
          'A mensagem sai sozinha no horario marcado. Diferente do follow-up, ela nao e cancelada quando o status muda.',
        ),
      ]),
      confirmar: 'Marcar',
      aoConfirmar: () => {
        if (!entrada.value) throw new Error('Escolha a data e a hora.');
        const data = new Date(entrada.value);
        aoEscolher(data.toISOString(), data.toLocaleString('pt-BR'));
      },
    });
  }

  function abrirResumo(contato) {
    const modo = selecao(
      [
        { valor: 'simples', rotulo: 'Resumo simples (todo o historico)' },
        { valor: 'detalhado', rotulo: 'Resumo detalhado (com periodo e instrucao)' },
      ],
      'simples',
    );
    const de = el('input', { type: 'date' });
    const ate = el('input', { type: 'date' });
    const instrucao = areaTexto('', { placeholder: 'O que voce quer que o resumo destaque?' });
    const extras = el('div', { estilo: { display: 'none' } }, [
      el('div', { class: 'grade g2' }, [campo('De', de), campo('Ate', ate)]),
      campo('Instrucao', instrucao),
    ]);
    modo.addEventListener('change', () => {
      extras.style.display = modo.value === 'detalhado' ? 'block' : 'none';
    });

    modal({
      titulo: 'Resumo da conversa',
      corpo: el('div', {}, [campo('Tipo', modo), extras]),
      confirmar: 'Gerar resumo',
      aoConfirmar: async () => {
        await api.post(`/api/contatos/${contato.id}/resumo`, {
          modo: modo.value,
          de: de.value ? new Date(de.value).toISOString() : null,
          ate: ate.value ? new Date(`${ate.value}T23:59:59`).toISOString() : null,
          instrucao: instrucao.value || null,
        });
        aviso('Resumo gravado como nota interna.', 'sucesso');
      },
    });
  }

  function abrirUnificar(contato) {
    const destino = selecao(
      contatos.filter((c) => c.id !== contato.id).map((c) => ({ valor: c.id, rotulo: `${c.nome} · ${telefone(c.telefone)}` })),
      '',
    );
    modal({
      titulo: 'Unificar conversas',
      corpo: el('div', {}, [
        // O que sobra e a consequencia da acao, que ninguem pode deixar de ler
        // antes de confirmar. Para que serve unificar esta no LEIA-ME.
        el('p', { class: 'cartao-ajuda', texto: `Todo o historico de ${contato.nome} vai para a conversa escolhida, e esta aqui deixa de existir.` }),
        campo('Conversa de destino', destino),
      ]),
      confirmar: 'Unificar',
      aoConfirmar: async () => {
        if (!destino.value) throw new Error('Escolha a conversa de destino.');
        await api.post(`/api/contatos/${contato.id}/unificar`, { destinoId: destino.value });
        selecionadoId = destino.value;
        aviso('Conversas unificadas.', 'sucesso');
        await desenhar();
      },
    });
  }

  function abrirNovaConversa() {
    const nome = entradaTexto('');
    const numero = entradaTexto('', { placeholder: '32988112233' });
    const conexao = selecao(estado.conexoes.map((c) => ({ valor: c.id, rotulo: c.nome })), estado.conexoes[0]?.id);
    modal({
      titulo: 'Nova conversa',
      corpo: el('div', {}, [
        campo('Nome', nome),
        // O formato ja esta no exemplo dentro do campo. O que o exemplo nao
        // mostra, que o 55 entra sozinho, cabe atras do icone.
        campoComDica('WhatsApp', numero, 'Com DDD. O DDI 55 e colocado sozinho.'),
        campo('Conexao', conexao),
      ]),
      confirmar: 'Criar',
      aoConfirmar: async () => {
        if (!numero.value.trim()) throw new Error('Informe o numero.');
        const contato = await api.post('/api/contatos', {
          nome: nome.value.trim(),
          telefone: numero.value.trim(),
          conexaoId: conexao.value,
        });
        selecionadoId = contato.id;
        await desenhar();
      },
    });
  }

  /* ---------------- Coluna 3: propriedades ---------------- */

  function colunaPropriedades() {
    const contato = contatos.find((c) => c.id === selecionadoId);
    if (!contato) return el('div', { class: 'coluna' });

    const salvar = async (mudancas) => {
      await api.patch(`/api/contatos/${contato.id}`, mudancas);
      await desenhar();
    };

    const responsavelAtual = contato.responsavel ? `${contato.responsavel.tipo}:${contato.responsavel.id}` : '';

    const etiquetas = el('div', { class: 'linha-botoes' });
    for (const etiqueta of estado.etiquetas) {
      const marcada = (contato.etiquetas || []).includes(etiqueta.id);
      etiquetas.append(
        el('button', {
          class: `selo selo-clicavel ${marcada ? 'ouro' : ''}`.trim(),
          texto: etiqueta.nome,
          aoClick: async () => {
            const atuais = new Set(contato.etiquetas || []);
            if (marcada) atuais.delete(etiqueta.id);
            else atuais.add(etiqueta.id);
            await salvar({ etiquetas: [...atuais] });
          },
        }),
      );
    }

    /*
     * Variavel preenchida fica a vista; variavel em branco fica atras de um
     * botao que diz quantas sao.
     *
     * Sao os dados que o agente coleta durante a entrevista: CPF, renda,
     * doenca, laudo. No comeco de toda conversa estao todos vazios, e os onze
     * campos ocupavam 903px, mais da metade do painel inteiro. Quem abria uma
     * conversa nova rolava duas telas de caixa vazia para chegar no historico.
     *
     * Conforme o agente coleta, o bloco cresce com dado de verdade.
     */
    const preenchidas = el('div', { class: 'lista-simples' });
    const embranco = el('div', { class: 'lista-simples', hidden: true });
    let quantasVazias = 0;

    for (const variavel of estado.variaveis) {
      const valor = (contato.variaveis || {})[variavel.chave] || '';
      const entrada = entradaTexto(valor, { placeholder: '-' });
      entrada.addEventListener('change', async () => {
        await salvar({ variaveis: { ...(contato.variaveis || {}), [variavel.chave]: entrada.value } });
      });
      if (valor.trim()) {
        preenchidas.append(campo(variavel.nome, entrada));
      } else {
        quantasVazias += 1;
        embranco.append(campo(variavel.nome, entrada));
      }
    }

    const variaveis = el('div', {}, [preenchidas]);
    if (quantasVazias) {
      const abrir = botao(
        quantasVazias === 1 ? '1 campo em branco' : `${quantasVazias} campos em branco`,
        {
          pequeno: true,
          aoClicar: () => {
            const fechado = embranco.hasAttribute('hidden');
            embranco.toggleAttribute('hidden', !fechado);
            abrir.setAttribute('aria-expanded', fechado ? 'true' : 'false');
          },
        },
      );
      abrir.setAttribute('aria-expanded', 'false');
      variaveis.append(abrir, embranco);
    }

    const arquivos = el('div', { class: 'lista-simples' });
    for (const arquivo of contato.arquivos || []) {
      arquivos.append(
        el('div', { class: 'lista-item' }, [
          el('div', { class: 'corpo' }, [
            el('div', { class: 'titulo', texto: arquivo.nome }),
            el('div', { class: 'desc', texto: `${(arquivo.tamanho / 1024).toFixed(0)} KB · ${dataHora(arquivo.criadoEm)}` }),
          ]),
        ]),
      );
    }
    const seletorArquivo = el('input', { type: 'file', estilo: { display: 'none' } });
    seletorArquivo.addEventListener('change', async () => {
      const arquivo = seletorArquivo.files[0];
      if (!arquivo) return;
      const leitor = new FileReader();
      leitor.onload = async () => {
        await api.post(`/api/contatos/${contato.id}/arquivos`, {
          nome: arquivo.name,
          conteudoBase64: leitor.result,
          tipo: arquivo.type.startsWith('image') ? 'imagem' : 'documento',
        });
        aviso('Arquivo guardado na nuvem da conversa.', 'sucesso');
        await desenhar();
      };
      leitor.readAsDataURL(arquivo);
    });

    return el('div', { class: 'coluna' }, [
      el('div', { class: 'coluna-cabecalho' }, [
        // O mesmo par de nome e telefone do cabecalho da conversa, no mesmo
        // ritmo: --t-md peso 600 em cima, --t-xs fraco embaixo.
        el('div', { class: 'linha' }, [
          avatar(contato),
          el('div', { class: 'encolhe' }, [
            el('div', { class: 't-md peso-600', texto: contato.nome }),
            el('div', { class: 't-xs c-fraco', texto: telefone(contato.telefone) }),
          ]),
        ]),
      ]),
      el('div', { class: 'coluna-corpo' }, [
        el('div', { class: 'propriedade' }, [
          el('span', { texto: 'Responsavel' }),
          selecao(opcoesResponsavel(), responsavelAtual, {
            aoChange: async (evento) => {
              const valor = evento.target.value;
              if (!valor) return salvar({ responsavel: null });
              const [tipo, id] = valor.split(':');
              return salvar({ responsavel: { tipo, id } });
            },
          }),
        ]),
        el('div', { class: 'propriedade' }, [
          rotuloComDica('Status', 'Mudar o status troca o departamento e dispara a sequencia de follow-up.'),
          selecao(
            [{ valor: '', rotulo: 'Sem status' }, ...estado.status.map((s) => ({ valor: s.id, rotulo: s.nome }))],
            contato.statusId || '',
            { aoChange: (evento) => salvar({ statusId: evento.target.value }) },
          ),
        ]),
        el('div', { class: 'propriedade' }, [
          el('span', { texto: 'Departamento' }),
          selecao(
            [{ valor: '', rotulo: 'Sem departamento' }, ...estado.departamentos.map((d) => ({ valor: d.id, rotulo: d.nome }))],
            contato.departamentoId || '',
            { aoChange: (evento) => salvar({ departamentoId: evento.target.value }) },
          ),
        ]),
        el('div', { class: 'propriedade' }, [el('span', { texto: 'Etiquetas' }), etiquetas]),
        el('div', { class: 'propriedade' }, [
          el('span', { texto: 'Origem' }),
          selecao(
            [{ valor: '', rotulo: 'Nao identificada' }, ...estado.origens.map((o) => ({ valor: o.id, rotulo: o.nome }))],
            contato.origemId || '',
            { aoChange: (evento) => salvar({ origemId: evento.target.value }) },
          ),
        ]),
        el('div', { class: 'propriedade' }, [
          el('span', { texto: 'Modo audio' }),
          el('label', { class: 'linha t-md' }, [
            (() => {
              // A largura cheia do tema vale para campo de texto, select e
              // textarea. Caixa de marcar nunca esteve na lista, entao o
              // width: auto escrito aqui nao fazia nada.
              const caixa = el('input', { type: 'checkbox' });
              caixa.checked = Boolean(contato.modoAudio);
              caixa.addEventListener('change', () => salvar({ modoAudio: caixa.checked }));
              return caixa;
            })(),
            'Responder em audio',
          ]),
        ]),
        el('div', { class: 'propriedade' }, [el('span', { texto: 'Variaveis' }), variaveis]),
        el('div', { class: 'propriedade' }, [
          el('span', { texto: 'Nuvem da conversa' }),
          arquivos,
          seletorArquivo,
          botao('Guardar arquivo', { pequeno: true, aoClicar: () => seletorArquivo.click() }),
        ]),
        el('div', { class: 'propriedade' }, [
          el('span', { texto: 'Historico' }),
          botao('Ver logs da conversa', { pequeno: true, aoClicar: () => abrirLogs(contato) }),
        ]),
      ]),
    ]);
  }

  async function abrirLogs(contato) {
    const logs = await api.get(`/api/contatos/${contato.id}/logs`);
    const lista = el('div', { class: 'lista-simples' });
    if (!logs.length) lista.append(el('div', { class: 'vazio', texto: 'Nenhum registro ainda.' }));
    for (const log of logs) {
      lista.append(
        el('div', { class: 'lista-item' }, [
          el('div', { class: 'corpo' }, [
            el('div', { class: 'titulo', texto: log.descricao }),
            el('div', { class: 'desc', texto: `${dataHora(log.criadoEm)} · ${log.autor?.nome || 'sistema'}` }),
          ]),
          selo(log.tipo, ''),
        ]),
      );
    }
    modal({ titulo: `Historico de ${contato.nome}`, corpo: lista, largo: true });
  }

  /* ---------------- Visualizacao: tabela de contatos ---------------- */

  /**
   * Lista ordenada pela coluna escolhida.
   *
   * A copia antes do sort nao e cerimonia: sort mexe no proprio vetor, e
   * contatos e a mesma lista que a coluna de conversas e o kanban leem.
   */
  function contatosOrdenados() {
    const valorDe = ORDENACAO_CONTATOS[ordemContatos.coluna];
    if (!valorDe) return contatos;
    const sinal = ordemContatos.direcao === 'crescente' ? 1 : -1;
    return [...contatos].sort((a, b) => {
      const primeiro = valorDe(a);
      const segundo = valorDe(b);
      if (typeof primeiro === 'string') {
        return primeiro.localeCompare(segundo, 'pt-BR', { sensitivity: 'base' }) * sinal;
      }
      return (primeiro - segundo) * sinal;
    });
  }

  /**
   * Cabecalho de coluna que ordena. O clique alterna crescente e decrescente
   * na propria coluna e leva a ordem para outra quando muda de coluna.
   *
   * A seta apagada nas colunas que nao estao ordenando e o unico sinal de que
   * elas tambem respondem ao clique. Ela e decorativa, quem anuncia a ordem
   * para o leitor de tela e o aria-sort do proprio th.
   */
  function cabecalhoOrdenavel(rotulo, chave) {
    const ativa = ordemContatos.coluna === chave;
    const crescente = ativa && ordemContatos.direcao === 'crescente';
    // A ordenacao acontece aqui no navegador, sobre o que chegou. Com a base
    // cortada no limite, "Nome crescente" mostra os primeiros nomes das mais
    // recentes, e nao os primeiros nomes da base: o titulo do cabecalho diz
    // isso, para o numero na tela nao ser lido como o do escritorio inteiro.
    const cortada = totalNoServidor > contatos.length;

    // O conjunto de icones tem uma seta so, deitada, a mesma que a paginacao
    // usa virada. Um quarto de volta e ela vira o indicador de direcao.
    const seta = icone('voltar', 12);

    // .cabecalho-ordenavel devolve o th ao desenho de cabecalho: o botao perde
    // moldura, fundo e espaco proprios e herda a fonte da tabela. A direcao da
    // seta e o apagado de quem nao esta ordenando saem do aria-sort do th, no
    // tema: o desenho e o que o leitor de tela anuncia passam a ser a mesma
    // informacao, em vez de duas que podem se desencontrar.
    const gatilho = el('button', {
      type: 'button',
      class: `cabecalho-ordenavel ${ativa ? 'ativa' : ''}`.trim(),
      title: cortada
        ? `Ordenar por ${rotulo.toLowerCase()}. A ordem vale so sobre os ${numero(contatos.length)} contatos carregados.`
        : `Ordenar por ${rotulo.toLowerCase()}`,
      aoClick: () => {
        ordemContatos = ativa
          ? { coluna: chave, direcao: crescente ? 'decrescente' : 'crescente' }
          : { coluna: chave, direcao: chave === 'ultimaMensagem' ? 'decrescente' : 'crescente' };
        // Reordenar com a pessoa parada na pagina 4 mostra um pedaco do meio
        // da lista nova, que nao e o que ela pediu ao clicar no cabecalho.
        paginaContatos = 1;
        pintarContatos();
      },
    }, [document.createTextNode(rotulo), seta]);

    return el('th', { 'aria-sort': ativa ? (crescente ? 'ascending' : 'descending') : 'none' }, [gatilho]);
  }

  /**
   * Rodape com o total e a navegacao entre paginas.
   *
   * paginacao() oferece 10, 20, 50 e 100 por pagina, e o padrao daqui e 25.
   * Sem a opcao na lista o seletor mostrava 10 com a tabela exibindo 25
   * linhas, entao ela entra na posicao certa enquanto faltar.
   */
  function rodapeContatos(total, paginas) {
    const rodape = paginacao({
      pagina: paginaContatos,
      paginas,
      total,
      porPagina: porPaginaContatos,
      // Com a base cortada no limite, o rodape e a faixa de aviso logo acima
      // mostravam dois numeros diferentes no mesmo lugar. O rotulo diz de qual
      // dos dois este e.
      rotulo: totalNoServidor > contatos.length ? 'contatos carregados' : 'contatos',
      aoMudar: (nova) => {
        paginaContatos = nova;
        pintarContatos();
      },
      aoMudarTamanho: (tamanho) => {
        porPaginaContatos = tamanho;
        paginaContatos = 1;
        pintarContatos();
      },
    });

    const seletor = rodape.querySelector('select');
    if (seletor) {
      const opcoes = [...seletor.options];
      if (!opcoes.some((opcao) => Number(opcao.value) === porPaginaContatos)) {
        const seguinte = opcoes.find((opcao) => Number(opcao.value) > porPaginaContatos);
        seletor.insertBefore(
          el('option', { value: String(porPaginaContatos), texto: String(porPaginaContatos) }),
          seguinte || null,
        );
      }
      seletor.value = String(porPaginaContatos);
    }
    return rodape;
  }

  function montarTabela() {
    // .area-tabela e a moldura rolavel da visualizacao de contatos, no lugar
    // dos 18px de respiro escritos na mao. A regra deveria morar em
    // web/css/tema.css, no bloco de Atendimento.
    areaContatos = el('div', { class: 'area-tabela' });
    pintarContatos();
    return areaContatos;
  }

  /**
   * Redesenha so a tabela. Trocar de pagina ou de ordem nao muda o filtro, e
   * ir ao servidor de novo por isso custaria a lista inteira a cada clique.
   */
  function pintarContatos() {
    if (!areaContatos) return;
    limpar(areaContatos);

    const barraTopo = el('div', { class: 'linha-botoes mb-3' }, [
      botao('Filtros', { pequeno: true, icone: 'filtros', aoClicar: abrirFiltros }),
      botao('Exportar CSV', { pequeno: true, aoClicar: exportar }),
      botao('Exportar conversas', { pequeno: true, titulo: 'Historico em texto, para treinar agente', aoClicar: abrirExportacaoHistorico }),
      botao('Importar planilha', { pequeno: true, aoClicar: abrirImportacao }),
    ]);

    if (!contatos.length) {
      areaContatos.append(
        barraTopo,
        vazio('Nenhum contato aqui', 'Afrouxe os filtros ou importe uma planilha.'),
      );
      return;
    }

    const contadorMassa = el('span', { class: 'selo ouro', texto: plural(marcados.size, 'selecionada', 'selecionadas') });
    // O display continua no atributo style: a barra aparece e some conforme a
    // pessoa marca linha, e isso e estado, nao desenho.
    const barraMassa = el('div', {
      class: 'linha-botoes mb-3',
      estilo: { display: marcados.size ? 'flex' : 'none' },
    }, [
      contadorMassa,
      botao('Status', { pequeno: true, aoClicar: () => acaoMassa('status') }),
      botao('Departamento', { pequeno: true, aoClicar: () => acaoMassa('departamento') }),
      botao('Responsavel', { pequeno: true, aoClicar: () => acaoMassa('responsavel') }),
      botao('Etiquetas', { pequeno: true, aoClicar: () => acaoMassa('etiquetas') }),
      botao('Conexao', { pequeno: true, aoClicar: () => acaoMassa('conexao') }),
      botao('Arquivar', { pequeno: true, aoClicar: () => acaoMassa('arquivar') }),
    ]);

    const lista = contatosOrdenados();
    const paginas = Math.max(1, Math.ceil(lista.length / porPaginaContatos));
    if (paginaContatos > paginas) paginaContatos = paginas;
    const inicio = (paginaContatos - 1) * porPaginaContatos;

    const corpo = el('tbody');
    for (const contato of lista.slice(inicio, inicio + porPaginaContatos)) {
      const caixa = el('input', {
        type: 'checkbox',
        'aria-label': `Selecionar ${contato.nome}`,
      });
      caixa.checked = marcados.has(contato.id);
      caixa.addEventListener('change', () => {
        if (caixa.checked) marcados.add(contato.id);
        else marcados.delete(contato.id);
        barraMassa.style.display = marcados.size ? 'flex' : 'none';
        contadorMassa.textContent = plural(marcados.size, 'selecionada', 'selecionadas');
      });

      corpo.append(
        el('tr', {}, [
          el('td', {}, [caixa]),
          el('td', {}, [
            // O endereco ja e a rota da conversa: o link leva para la sozinho,
            // sem a tabela precisar saber trocar de visualizacao.
            el('a', { href: `#/atendimento/${contato.id}`, texto: contato.nome }),
          ]),
          el('td', { texto: telefone(contato.telefone) }),
          el('td', {}, [contato.status ? selo(contato.status.nome, '', contato.status.cor) : '-']),
          el('td', { texto: contato.departamento?.nome || '-' }),
          el('td', { texto: contato.responsavel?.nome || '-' }),
          el('td', { texto: contato.origem?.nome || '-' }),
          el('td', { texto: quando(contato.ultimaMensagemEm) || '-' }),
        ]),
      );
    }

    areaContatos.append(barraTopo);

    // O corte do limite precisa aparecer: uma tabela que diz 1.000 contatos
    // quando existem 4.000 faz a pessoa concluir coisa errada da base.
    if (totalNoServidor > contatos.length) {
      areaContatos.append(
        el('div', {
          class: 'alerta-caixa mb-3',
          texto: `Vieram os ${numero(contatos.length)} contatos com mensagem mais recente, de ${numero(totalNoServidor)} no filtro. Estreite os filtros para alcancar o restante.`,
        }),
      );
    }

    areaContatos.append(
      barraMassa,
      // .cartao-tabela e o cartao que encaixa uma tabela: ela vai ate a borda
      // e so o rodape de paginacao recebe respiro, em .rodape-tabela.
      // .col-selecao e a largura da coluna da caixa de marcar. As tres regras
      // deveriam morar em web/css/tema.css, junto das regras de tabela.
      el('div', { class: 'cartao cartao-tabela' }, [
        el('div', { class: 'tabela-rolagem' }, [
          el('table', {}, [
            el('thead', {}, [
              el('tr', {}, [
                el('th', { class: 'col-selecao' }, [el('span', { class: 'apenas-leitor', texto: 'Selecionar' })]),
                cabecalhoOrdenavel('Nome', 'nome'),
                el('th', { texto: 'WhatsApp' }),
                cabecalhoOrdenavel('Status', 'status'),
                el('th', { texto: 'Departamento' }),
                el('th', { texto: 'Responsavel' }),
                el('th', { texto: 'Origem' }),
                cabecalhoOrdenavel('Ultima mensagem', 'ultimaMensagem'),
              ]),
            ]),
            corpo,
          ]),
        ]),
        el('div', { class: 'rodape-tabela' }, [rodapeContatos(lista.length, paginas)]),
      ]),
    );
  }

  function acaoMassa(tipo) {
    const ids = [...marcados];
    if (!ids.length) return;

    if (tipo === 'arquivar') {
      confirmar('Arquivar conversas?', `${plural(ids.length, 'conversa sera arquivada', 'conversas serao arquivadas')}. Elas voltam para Pendentes se o cliente escrever.`, async () => {
        await api.post('/api/contatos/acoes-em-massa', { ids, acao: 'arquivar' });
        marcados.clear();
        await desenhar();
      });
      return;
    }

    if (tipo === 'etiquetas') {
      const modoEtiqueta = selecao(
        [
          { valor: 'etiquetas-adicionar', rotulo: 'Adicionar (mantem as existentes)' },
          { valor: 'etiquetas-remover', rotulo: 'Remover apenas as escolhidas' },
          { valor: 'etiquetas-definir', rotulo: 'Definir (substitui todas)' },
        ],
        'etiquetas-adicionar',
      );
      const escolhidas = new Set();
      const lista = el('div', { class: 'linha-botoes' });
      for (const etiqueta of estado.etiquetas) {
        const b = el('button', { class: 'selo selo-clicavel', texto: etiqueta.nome });
        b.addEventListener('click', () => {
          if (escolhidas.has(etiqueta.id)) escolhidas.delete(etiqueta.id);
          else escolhidas.add(etiqueta.id);
          b.classList.toggle('ouro', escolhidas.has(etiqueta.id));
        });
        lista.append(b);
      }
      modal({
        titulo: `Etiquetas em ${plural(ids.length, 'conversa', 'conversas')}`,
        corpo: el('div', {}, [campo('Modo', modoEtiqueta), el('div', { class: 'campo' }, [el('span', { texto: 'Etiquetas' }), lista])]),
        confirmar: 'Aplicar',
        aoConfirmar: async () => {
          await api.post('/api/contatos/acoes-em-massa', { ids, acao: modoEtiqueta.value, valor: [...escolhidas] });
          marcados.clear();
          await desenhar();
        },
      });
      return;
    }

    const opcoes = {
      status: estado.status.map((s) => ({ valor: s.id, rotulo: s.nome })),
      departamento: [{ valor: '', rotulo: 'Sem departamento' }, ...estado.departamentos.map((d) => ({ valor: d.id, rotulo: d.nome }))],
      responsavel: opcoesResponsavel(),
      conexao: estado.conexoes.map((c) => ({ valor: c.id, rotulo: c.nome })),
    }[tipo];

    const escolha = selecao(opcoes, '');
    modal({
      titulo: `Alterar ${tipo} em ${plural(ids.length, 'conversa', 'conversas')}`,
      // O aviso de que a acao nao dispara follow-up muda o que a pessoa esta
      // prestes a confirmar e continua na caixa. O porque da trava e conceito,
      // e aparecia inteiro a cada troca de status em lote: vai para o balao.
      balao:
        tipo === 'status'
          ? dica('A trava existe para uma planilha inteira nao cair na fila de envio de uma vez, o que derruba o numero.', {
              assunto: 'a acao em massa',
            })
          : null,
      corpo: el('div', {}, [
        campo(tipo[0].toUpperCase() + tipo.slice(1), escolha),
        tipo === 'status'
          ? el('div', { class: 'alerta-caixa', texto: 'Acao em massa nao dispara follow-up.' })
          : null,
      ]),
      confirmar: 'Aplicar',
      aoConfirmar: async () => {
        await api.post('/api/contatos/acoes-em-massa', { ids, acao: tipo, valor: escolha.value });
        marcados.clear();
        await desenhar();
      },
    });
  }

  async function exportar() {
    const { csv, total } = await api.get('/api/contatos-exportar');
    const blob = new Blob([`﻿${csv}`], { type: 'text/csv;charset=utf-8' });
    const link = el('a', { href: URL.createObjectURL(blob), download: `contatos-correia-${new Date().toISOString().slice(0, 10)}.csv` });
    link.click();
    aviso(`${total} contatos exportados.`, 'sucesso');
  }

  /**
   * Exporta o historico em texto. E o material de treino do agente: a receita
   * da propria auditoria e pegar atendimentos exemplares e usa-los como
   * referencia ao escrever o prompt.
   */
  function abrirExportacaoHistorico() {
    const escolhidos = new Set();
    const listaStatus = el('div', { class: 'linha-botoes' });
    for (const status of estado.status) {
      const b = el('button', { class: 'selo selo-clicavel', texto: status.nome });
      b.addEventListener('click', () => {
        if (escolhidos.has(status.id)) escolhidos.delete(status.id);
        else escolhidos.add(status.id);
        b.classList.toggle('ouro', escolhidos.has(status.id));
      });
      listaStatus.append(b);
    }

    const limite = entradaTexto('20', { type: 'number', min: '1', max: '200' });
    const anonimizar = el('input', { type: 'checkbox' });
    anonimizar.checked = true;

    modal({
      titulo: 'Exportar conversas',
      // A primeira frase da caixa diz o que escolher agora e fica visivel. A
      // segunda e o criterio por tras da escolha, lido uma vez: vai no balao.
      balao: dica('Vale mais a qualidade que a quantidade: dez conversas exemplares ensinam mais o agente do que duzentas medianas.', {
        assunto: 'a exportacao de conversas',
      }),
      largo: true,
      corpo: el('div', {}, [
        el('div', { class: 'dica mb-3' }, [
          el('div', { texto: 'Escolha os atendimentos que deram certo: lead bem qualificado, objecao contornada, contrato fechado.' }),
        ]),
        // Mesma montagem de campoComDica: o <span> de fora e o rotulo que o
        // tema desenha e o de dentro alinha o texto com o icone. O helper nao
        // serve aqui porque a lista de status e um bloco de botoes, e nao um
        // controle unico com id para o <label for>.
        el('div', { class: 'campo' }, [
          el('span', {}, [
            el('span', { class: 'linha' }, [
              'Filtrar por status',
              dica('Sem selecionar nada, traz as conversas mais recentes de qualquer status.', {
                assunto: 'o filtro por status',
              }),
            ]),
          ]),
          listaStatus,
        ]),
        campo('Quantas conversas', limite),
        // .campo-marcar e o campo que e uma caixa de marcar: rotulo ao lado da
        // caixa, e nao acima dela. Precisa de regra propria porque label.campo
        // ja diz display block e ganharia de uma utilitaria. A regra deveria
        // morar em web/css/tema.css, logo abaixo de label.campo.
        el('label', { class: 'campo campo-marcar' }, [
          anonimizar,
          el('span', { class: 't-md', texto: 'Trocar nome e telefone por "LEAD 1", "LEAD 2"…' }),
        ]),
      ]),
      confirmar: 'Exportar',
      aoConfirmar: async () => {
        const resultado = await api.post('/api/historico-exportar', {
          statusIds: [...escolhidos],
          limite: Number(limite.value) || 20,
          anonimizar: anonimizar.checked,
        });
        if (!resultado.total) throw new Error('Nenhuma conversa com mensagens no filtro escolhido.');
        const blob = new Blob([resultado.texto], { type: 'text/plain;charset=utf-8' });
        const link = el('a', {
          href: URL.createObjectURL(blob),
          download: `conversas-correia-${new Date().toISOString().slice(0, 10)}.txt`,
        });
        link.click();
        aviso(`${resultado.total} conversas exportadas.`, 'sucesso');
      },
    });
  }

  function abrirImportacao() {
    const conexao = selecao(estado.conexoes.map((c) => ({ valor: c.id, rotulo: c.nome })), estado.conexoes[0]?.id);
    const area = areaTexto('', { placeholder: 'nome;telefone;status;origem;observacao' });
    const seletor = el('input', { type: 'file', accept: '.csv,.txt' });
    seletor.addEventListener('change', () => {
      const arquivo = seletor.files[0];
      if (!arquivo) return;
      const leitor = new FileReader();
      leitor.onload = () => {
        area.value = leitor.result;
      };
      leitor.readAsText(arquivo, 'utf-8');
    });

    modal({
      titulo: 'Importar contatos',
      // O formato das colunas e o "nao dispara follow-up" mudam o que a pessoa
      // faz agora e ficam na caixa. O porque da regra e conceito: vai no balao.
      balao: dica('Sem essa trava, uma planilha inteira cairia na fila de envio de uma vez, o que derruba o numero.', {
        assunto: 'a importacao de contatos',
      }),
      largo: true,
      corpo: el('div', {}, [
        el('div', { class: 'dica' }, [
          el('div', { html: 'Colunas aceitas: <strong>nome</strong> e <strong>telefone</strong> (obrigatorias), status, origem e observacao. O telefone vai com DDD; o DDI 55 entra sozinho.' }),
          el('div', { class: 'mt-2', texto: 'Importar nao dispara follow-up.' }),
        ]),
        campo('WhatsApp que fica com estes contatos', conexao),
        campo('Arquivo CSV', seletor),
        campo('Ou cole aqui', area),
      ]),
      confirmar: 'Importar',
      aoConfirmar: async () => {
        if (!area.value.trim()) throw new Error('Envie o arquivo ou cole o conteudo.');
        const resultado = await api.post('/api/contatos-importar', { conexaoId: conexao.value, csv: area.value });
        aviso(`${resultado.importados} importados, ${resultado.atualizados} atualizados, ${resultado.ignorados.length} ignorados.`, 'sucesso');
        await desenhar();
      },
    });
  }

  /* ---------------- Visualizacao: kanban ---------------- */

  function montarKanban() {
    // .area-kanban e a coluna que empilha a faixa de aviso e o quadro. Ela
    // tambem cuida do respiro do aviso e da altura do quadro, que antes
    // estavam escritos aqui em tres atributos style. A regra deveria morar em
    // web/css/tema.css, junto do bloco Kanban.
    const area = el('div', { class: 'area-kanban' });

    // O corte do lote precisa aparecer aqui tambem. A tabela de Contatos ja
    // avisava; o quadro nao, entao a coluna mostrava a contagem do que coube na
    // resposta como se fosse a do escritorio inteiro.
    if (totalNoServidor > contatos.length) {
      area.append(
        el('div', {
          class: 'alerta-caixa',
          texto: `O quadro desenha as ${numero(contatos.length)} conversas com mensagem mais recente, de ${numero(totalNoServidor)} no filtro. O numero no alto de cada coluna e o total de verdade.`,
        }),
      );
    }

    // O quadro tem height 100% no CSS. Dentro da coluna flex ele vira o item
    // que cresce, senao a faixa de aviso rouba altura e a rolagem some. Quem
    // faz esse acerto agora e a regra .area-kanban > .kanban.
    const quadro = el('div', { class: 'kanban' });
    const colunas = [
      { id: '', nome: 'Sem status', cor: 'var(--texto-fraco)' },
      ...estado.status.map((s) => ({ id: s.id, nome: s.nome, cor: s.cor })),
    ];

    for (const coluna of colunas) {
      const daColuna = contatos.filter((c) => (c.statusId || '') === coluna.id);
      // A soma que o dado permite e a das mensagens esperando resposta. E ela
      // que separa a coluna cheia da coluna parada: cem conversas fechadas nao
      // pedem nada, tres conversas com cliente esperando pedem hoje.
      const naoLidas = daColuna.reduce((soma, c) => soma + (c.naoLidas || 0), 0);
      const lista = el('div', { class: 'kanban-lista' });

      for (const contato of daColuna.slice(0, CARTOES_POR_COLUNA)) {
        // Botao, e nao div: o draggable continua valendo em button, e a
        // abertura da conversa passa a funcionar pelo Tab e pelo Enter. Mover
        // de coluna sem mouse continua sendo pelo seletor de Status no painel
        // da conversa, que e o mesmo campo que o arrasto grava.
        const cartaoContato = el('button', {
          type: 'button',
          class: 'kanban-cartao',
          draggable: 'true',
          title: `Abrir a conversa de ${contato.nome}`,
          aoDragstart: (evento) => {
            evento.dataTransfer.setData('text/plain', contato.id);
            cartaoContato.classList.add('arrastando');
          },
          aoDragend: () => cartaoContato.classList.remove('arrastando'),
          aoClick: () => {
            location.hash = `#/atendimento/${contato.id}`;
          },
        }, [
          el('div', { class: 't-md peso-600', texto: contato.nome }),
          el('div', { class: 't-xs c-fraco mt-1', texto: telefone(contato.telefone) }),
          el('div', { class: 'marcas linha-p quebra mt-2' }, [
            contato.responsavel ? selo(contato.responsavel.nome, 'ouro') : null,
            ...(contato.etiquetas || []).slice(0, 2).map((id) => {
              const etiqueta = acharEtiqueta(id);
              return etiqueta ? selo(etiqueta.nome, '', etiqueta.cor) : null;
            }),
          ]),
        ]);
        lista.append(cartaoContato);
      }

      // O total vem do servidor, contado sobre o filtro inteiro. daColuna so
      // enxerga o lote que coube na resposta, entao usa-lo como contagem fazia
      // a coluna mentir sempre que a base passasse do limite pedido.
      const totalDaColuna = totalPorStatus[coluna.id] ?? daColuna.length;
      const naoDesenhadas = Math.max(0, totalDaColuna - Math.min(daColuna.length, CARTOES_POR_COLUNA));

      // Coluna com centenas de cartoes trava a rolagem, e ninguem arrasta o de
      // numero duzentos: o excedente vira uma linha de contagem no fim.
      if (naoDesenhadas) {
        lista.append(
          // .kanban-mais e a linha de contagem do que nao coube na coluna. A
          // regra deveria morar em web/css/tema.css, junto do bloco Kanban.
          el('div', {
            class: 'kanban-mais',
            title: 'Abra Contatos e filtre por este status para ver a lista inteira.',
            texto: `mais ${plural(naoDesenhadas, 'conversa neste status', 'conversas neste status')}`,
          }),
        );
      }

      // Os dois selos nao encolhem: quem cede espaco no cabecalho estreito e o
      // nome da coluna, que tem reticencias, e nao o numero, que ficaria
      // cortado. Quem segura isso agora e a regra
      // .kanban-coluna > header .selo, em web/css/tema.css.
      const contagem = selo(numero(totalDaColuna), '');
      contagem.title = 'Conversas nesta coluna, contadas no servidor';
      const somaNaoLidas = naoLidas ? selo(plural(naoLidas, 'nao lida', 'nao lidas'), 'ouro') : null;
      if (somaNaoLidas) {
        // A soma sai das conversas que chegaram, e nao do filtro inteiro: a
        // resposta so traz nao lidas do que veio. Com o lote cortado, o rotulo
        // diz isso em vez de deixar o numero passar por total.
        somaNaoLidas.title =
          totalNoServidor > contatos.length
            ? 'Mensagens sem resposta somadas nas conversas carregadas desta coluna'
            : 'Mensagens sem resposta somadas nesta coluna';
      }

      const colunaNo = el('div', { class: 'kanban-coluna' }, [
        el('header', {}, [
          el('span', { class: 'ponto', estilo: { background: coluna.cor } }),
          el('span', { class: 'flexivel encolhe cortar', texto: coluna.nome }),
          contagem,
          somaNaoLidas,
        ]),
        lista,
      ]);

      colunaNo.addEventListener('dragover', (evento) => {
        evento.preventDefault();
        colunaNo.classList.add('alvo');
      });
      colunaNo.addEventListener('dragleave', () => colunaNo.classList.remove('alvo'));
      colunaNo.addEventListener('drop', async (evento) => {
        evento.preventDefault();
        colunaNo.classList.remove('alvo');
        const contatoId = evento.dataTransfer.getData('text/plain');
        if (!contatoId || !coluna.id) return;
        await api.patch(`/api/contatos/${contatoId}`, { statusId: coluna.id });
        aviso('Status alterado. A sequencia de follow-up deste status comecou.', 'sucesso');
        await desenhar();
      });

      quadro.append(colunaNo);
    }

    area.append(quadro);
    return area;
  }

  /* ---------------- Tempo real ---------------- */

  ouvir('digitando', (dados) => {
    if (!document.body.contains(container) || dados.contatoId !== vivo.contatoId) return;
    digitandoAte = dados.ate || Date.now() + 15000;
    if (vivo.indicador) {
      vivo.indicador.style.display = 'inline-flex';
      if (vivo.painel) vivo.painel.scrollTop = vivo.painel.scrollHeight;
    }
    if (fimDoDigitando) clearTimeout(fimDoDigitando);
    // Some sozinho se a resposta nao vier: indicador preso mente para o atendente.
    fimDoDigitando = setTimeout(pararDigitando, Math.max(2000, digitandoAte - Date.now() + 8000));
  });

  ouvir('mensagem', (dados) => {
    if (!document.body.contains(container) || dados.contatoId !== vivo.contatoId) return;
    pararDigitando();
    if (vivo.recarregar) vivo.recarregar();
  });

  ouvir('contato', async () => {
    if (!document.body.contains(container)) return;
    await desenhar();
  });
  ouvir('contatos', async () => {
    if (!document.body.contains(container)) return;
    await desenhar();
  });

  await desenhar();
  return container;
}
