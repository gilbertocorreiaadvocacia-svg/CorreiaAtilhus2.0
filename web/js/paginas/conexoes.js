import { api } from '../api.js';
import { estado, opcoesResponsavel, podeConfigurar, recarregar } from '../estado.js';
import { campoComDica, dica, gaveta, menuAcoes, paginacao } from '../componentes.js';
import {
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
  quando,
  selecao,
  selo,
  telefone,
  vazio,
} from '../ui.js';

/**
 * Conexoes de WhatsApp.
 *
 * A tela e uma TABELA, e nao uma grade de cartoes. O escritorio trabalha com
 * varios numeros de proposito (um comercial, que corre risco, e um de
 * pos-venda, que nunca pode cair), e as duas perguntas do dia a dia sao "qual
 * numero caiu?" e "qual manda para qual departamento?". As duas se respondem
 * varrendo uma coluna com o olho; empilhadas em cartao, cada resposta custava
 * ler o cartao inteiro de cada numero.
 *
 * O detalhe de um numero mora em um painel lateral com abas, e nao na linha:
 * credencial, evento e configuracao sao muita coisa para caber em uma linha de
 * tabela, e sao coisas que se olha uma de cada vez.
 */

/* As colunas que podem ser escondidas. `chave` e o que fica gravado no
   navegador de quem escolheu; `fixa` marca a que nunca some, porque uma tabela
   de conexoes sem o nome da conexao nao e uma tabela de nada. */
const COLUNAS = [
  { chave: 'conexao', rotulo: 'Conexao', fixa: true },
  { chave: 'statusPadrao', rotulo: 'Status padrao' },
  { chave: 'departamento', rotulo: 'Departamento' },
  { chave: 'responsavel', rotulo: 'Responsavel' },
  { chave: 'situacao', rotulo: 'Situacao' },
];

const CHAVE_COLUNAS = 'correia.conexoes.colunas';
const CHAVE_POR_PAGINA = 'correia.conexoes.porPagina';

/**
 * Preferencia de tela, e nao dado do escritorio: quem esconde a coluna de
 * departamento esconde para si, no seu computador. Por isso vai para o
 * navegador e nao para o banco. Leitura defensiva porque navegador com dados
 * de site bloqueados lanca no proprio acesso ao localStorage.
 */
function lerPreferencia(chave, padrao) {
  try {
    const bruto = localStorage.getItem(chave);
    return bruto === null ? padrao : JSON.parse(bruto);
  } catch {
    return padrao;
  }
}

function gravarPreferencia(chave, valor) {
  try {
    localStorage.setItem(chave, JSON.stringify(valor));
  } catch {
    /* Sem espaco ou sem permissao, a tela continua funcionando na sessao. */
  }
}

export async function paginaConexoes({ definirAcoes } = {}) {
  const container = el('div');

  let filtro = '';
  let pagina = 1;
  let porPagina = Number(lerPreferencia(CHAVE_POR_PAGINA, 10)) || 10;
  let visiveis = new Set(
    lerPreferencia(
      CHAVE_COLUNAS,
      COLUNAS.map((c) => c.chave),
    ),
  );
  /* A coluna fixa volta sozinha se alguem apagar a preferencia na mao. */
  visiveis.add('conexao');

  definirAcoes?.([
    botao('Docs', { icone: 'abrir', aoClicar: abrirDocumentacao }),
    podeConfigurar()
      ? botao('Nova conexao', { tipo: 'principal', icone: 'mais', aoClicar: () => editar(null, desenhar) })
      : null,
  ]);

  async function desenhar() {
    const conexoes = await recarregar('conexoes');
    limpar(container);

    if (!conexoes.length) {
      container.append(
        vazio(
          'Nenhuma conexao',
          'Crie uma conexao em modo simulador para rodar o funil inteiro hoje, sem chip.',
          podeConfigurar() ? botao('Nova conexao', { tipo: 'principal', icone: 'mais', aoClicar: () => editar(null, desenhar) }) : null,
          'conexoes',
        ),
      );
      return;
    }

    const alvo = filtro.trim().toLowerCase();
    const filtradas = alvo
      ? conexoes.filter((c) =>
          [c.nome, c.numero, c.tipo].some((campoTexto) => String(campoTexto || '').toLowerCase().includes(alvo)),
        )
      : conexoes;

    const paginas = Math.max(1, Math.ceil(filtradas.length / porPagina));
    if (pagina > paginas) pagina = paginas;
    const daPagina = filtradas.slice((pagina - 1) * porPagina, pagina * porPagina);

    container.append(barraDeFiltros(), tabela(daPagina, filtradas.length === conexoes.length && !alvo));

    container.append(
      paginacao({
        pagina,
        paginas,
        total: filtradas.length,
        porPagina,
        rotulo: 'conexoes',
        aoMudar: (nova) => {
          pagina = nova;
          desenhar();
        },
        aoMudarTamanho: (novo) => {
          porPagina = novo;
          pagina = 1;
          gravarPreferencia(CHAVE_POR_PAGINA, novo);
          desenhar();
        },
      }),
    );
  }

  function barraDeFiltros() {
    const busca = entradaTexto(filtro, { type: 'search', placeholder: 'Pesquisar conexoes...' });
    busca.addEventListener('input', () => {
      filtro = busca.value;
      pagina = 1;
      desenhar();
      /* Redesenhar troca o campo por um novo: sem devolver o foco e o cursor,
         quem digita a segunda letra digita fora do campo. */
      const novo = container.querySelector('input[type="search"]');
      if (novo) {
        novo.focus();
        novo.setSelectionRange(novo.value.length, novo.value.length);
      }
    });

    return el('div', { class: 'conexoes-barra' }, [busca, seletorDeColunas()]);
  }

  function seletorDeColunas() {
    return menuAcoes(
      COLUNAS.map((coluna) => ({
        rotulo: coluna.rotulo,
        marcado: visiveis.has(coluna.chave),
        aoClicar: () => {
          /* A coluna do nome nao se desliga: tabela de conexoes sem o nome da
             conexao nao responde nenhuma das perguntas por que ela existe. */
          if (coluna.fixa) {
            aviso('A coluna Conexao nao pode ser escondida.', '');
            return;
          }
          if (visiveis.has(coluna.chave)) visiveis.delete(coluna.chave);
          else visiveis.add(coluna.chave);
          gravarPreferencia(CHAVE_COLUNAS, [...visiveis]);
          desenhar();
        },
      })),
      { rotulo: 'Escolher colunas', texto: 'Colunas', iconeGatilho: 'filtros' },
    );
  }

  /* A ordem so pode ser arrastada quando a lista mostrada e a lista inteira:
     arrastar a terceira linha de uma busca filtrada, ou da segunda pagina,
     significaria mover para uma posicao que a pessoa nao esta vendo. */
  function tabela(linhas, podeOrdenar) {
    const corpo = el('tbody');

    for (const conexao of linhas) {
      corpo.append(linhaDaConexao(conexao, podeOrdenar && podeConfigurar()));
    }

    return el('div', { class: 'tabela-rolagem' }, [
      el('table', {}, [
        el('thead', {}, [
          el('tr', {}, [
            el('th', { class: 'conexao-alca', 'aria-label': 'Ordem' }),
            ...COLUNAS.filter((c) => visiveis.has(c.chave)).map((c) => el('th', { texto: c.rotulo.toUpperCase() })),
            el('th', { class: 'conexoes-acoes', 'aria-label': 'Acoes' }),
          ]),
        ]),
        corpo,
      ]),
    ]);
  }

  function linhaDaConexao(conexao, arrastavel) {
    const conectada = conexao.estado === 'conectado';
    const status = estado.status.find((s) => s.id === conexao.statusPadraoId);
    const departamento = estado.departamentos.find((d) => d.id === conexao.departamentoPadraoId);
    const responsavel = descreverResponsavel(conexao.responsavelPadrao);

    const celulas = {
      conexao: el('td', {}, [
        el('div', { class: 'conexao-identidade' }, [
          avatar({ nome: conexao.nome }, 32),
          el('div', {}, [
            el('div', { class: 'nome', texto: conexao.nome }),
            conexao.numero ? el('div', { class: 'numero', texto: telefone(conexao.numero) }) : null,
          ]),
        ]),
      ]),
      statusPadrao: el('td', {}, [status ? selo(status.nome, '', status.cor) : el('span', { class: 'c-fraco', texto: '-' })]),
      departamento: el('td', {}, [
        departamento ? selo(departamento.nome, '', departamento.cor) : el('span', { class: 'c-fraco', texto: '-' }),
      ]),
      responsavel: el('td', {}, [
        responsavel
          ? el('div', { class: 'conexao-identidade' }, [
              avatar({ nome: responsavel.nome }, 24),
              el('span', { texto: responsavel.nome }),
              responsavel.tipo === 'agente' ? selo('IA', 'ouro') : null,
            ])
          : el('span', { class: 'c-fraco', texto: '-' }),
      ]),
      situacao: el('td', {}, [selo(conectada ? 'Conectado' : 'Desconectado', conectada ? 'sucesso' : 'erro')]),
    };

    const linha = el('tr', { tabindex: '0' }, [
      el('td', { class: 'conexao-alca' }, arrastavel ? [icone('opcoes', 14)] : []),
      ...COLUNAS.filter((c) => visiveis.has(c.chave)).map((c) => celulas[c.chave]),
      el('td', { class: 'conexoes-acoes' }, [
        menuAcoes([
          { rotulo: 'Ver detalhes', icone: 'abrir', aoClicar: () => abrirDetalhes(conexao, desenhar) },
          podeConfigurar() ? { rotulo: 'Configurar', icone: 'ajustes', aoClicar: () => editar(conexao, desenhar) } : null,
          { rotulo: 'Testar conexao', icone: 'atualizar', aoClicar: () => testar(conexao, desenhar) },
          conexao.tipo === 'oficial'
            ? { rotulo: 'Copiar URL do webhook', icone: 'copiar', aoClicar: () => copiarWebhook(conexao) }
            : null,
          podeConfigurar() ? { separador: true } : null,
          podeConfigurar()
            ? { rotulo: 'Excluir', icone: 'lixo', perigo: true, aoClicar: () => excluir(conexao, desenhar) }
            : null,
        ]),
      ]),
    ]);

    /* A linha inteira abre o painel: o alvo de clique de uma linha de tabela e
       a linha, nao um link escondido dentro dela. O menu de acoes cancela a
       propagacao para o clique nele nao abrir o painel junto. */
    linha.addEventListener('click', (evento) => {
      if (evento.target.closest('.menu-acoes')) return;
      abrirDetalhes(conexao, desenhar);
    });
    linha.addEventListener('keydown', (evento) => {
      if (evento.key === 'Enter') abrirDetalhes(conexao, desenhar);
    });

    if (arrastavel) prepararArrasto(linha, conexao, desenhar);
    return linha;
  }

  await desenhar();
  return container;
}

/* ------------------------------------------------------------------ */
/* Arrastar para reordenar                                             */
/* ------------------------------------------------------------------ */

/**
 * A ordem das conexoes e do escritorio, nao de quem arrastou: ela vai para o
 * servidor e vale para todo mundo. O numero que o comercial usa o dia inteiro
 * fica no alto porque alguem decidiu isso, uma vez.
 *
 * Salva a lista inteira, e nao "mova daqui para ali": com duas pessoas
 * arrastando ao mesmo tempo, um deslocamento relativo sobre uma lista que ja
 * mudou embaralha as duas.
 */
function prepararArrasto(linha, conexao, recarregarTela) {
  linha.draggable = true;
  linha.dataset.conexaoId = conexao.id;

  linha.addEventListener('dragstart', (evento) => {
    evento.dataTransfer.effectAllowed = 'move';
    evento.dataTransfer.setData('text/plain', conexao.id);
    linha.classList.add('conexao-arrastando');
  });

  linha.addEventListener('dragend', () => {
    linha.classList.remove('conexao-arrastando');
    for (const outra of linha.parentElement?.children || []) outra.classList.remove('conexao-alvo');
  });

  linha.addEventListener('dragover', (evento) => {
    evento.preventDefault();
    evento.dataTransfer.dropEffect = 'move';
    linha.classList.add('conexao-alvo');
  });

  linha.addEventListener('dragleave', () => linha.classList.remove('conexao-alvo'));

  linha.addEventListener('drop', async (evento) => {
    evento.preventDefault();
    linha.classList.remove('conexao-alvo');

    const arrastadoId = evento.dataTransfer.getData('text/plain');
    if (!arrastadoId || arrastadoId === conexao.id) return;

    const corpo = linha.parentElement;
    const arrastado = corpo.querySelector(`[data-conexao-id="${arrastadoId}"]`);
    if (!arrastado) return;

    /* Solto na metade de cima, entra antes; na de baixo, depois. Sem isso nao
       da para mandar nada para o fim da lista. */
    const area = linha.getBoundingClientRect();
    const antes = evento.clientY < area.top + area.height / 2;
    corpo.insertBefore(arrastado, antes ? linha : linha.nextSibling);

    const ids = [...corpo.children].map((l) => l.dataset.conexaoId).filter(Boolean);
    try {
      await api.post('/api/conexoes/ordenar', { ids });
      aviso('Ordem das conexoes salva.', 'sucesso');
    } catch (erro) {
      aviso(erro.message, 'erro');
    }
    await recarregarTela();
  });
}

/* ------------------------------------------------------------------ */
/* Painel de detalhes                                                  */
/* ------------------------------------------------------------------ */

/**
 * Cinco abas, na ordem em que a duvida aparece: o que este numero e (Geral),
 * ele esta bem? (Saude), o que aconteceu com ele (Logs), como ele esta
 * configurado (Configuracoes) e o que da para fazer com ele (Acoes).
 */
function abrirDetalhes(conexao, recarregarTela) {
  const corpoAba = el('div', { class: 'mt-4' });
  const abas = ['Geral', 'Saude', 'Logs', 'Configuracoes', 'Acoes'];
  const botoes = new Map();

  function trocar(nome) {
    for (const [chave, b] of botoes) b.classList.toggle('ativo', chave === nome);
    limpar(corpoAba);
    if (nome === 'Geral') corpoAba.append(abaGeral(conexao, () => trocar('Logs')));
    if (nome === 'Saude') corpoAba.append(abaSaude(conexao));
    if (nome === 'Logs') corpoAba.append(abaLogs(conexao));
    if (nome === 'Configuracoes') corpoAba.append(abaConfiguracoes(conexao, painel, recarregarTela));
    if (nome === 'Acoes') corpoAba.append(abaAcoes(conexao, painel, recarregarTela));
  }

  const barraAbas = el(
    'div',
    { class: 'abas' },
    abas.map((nome) => {
      const b = el('button', { type: 'button', texto: nome });
      b.addEventListener('click', () => trocar(nome));
      botoes.set(nome, b);
      return b;
    }),
  );

  const painel = gaveta({
    titulo: 'Detalhes da conexao',
    larga: true,
    rotuloCancelar: 'Fechar',
    corpo: [barraAbas, corpoAba],
  });

  trocar('Geral');
  return painel;
}

function abaGeral(conexao, irParaLogs) {
  const conectada = conexao.estado === 'conectado';
  const status = estado.status.find((s) => s.id === conexao.statusPadraoId);
  const departamento = estado.departamentos.find((d) => d.id === conexao.departamentoPadraoId);
  const responsavel = descreverResponsavel(conexao.responsavelPadrao);

  return el('div', {}, [
    el('div', { class: 'conexao-cabecalho' }, [
      avatar({ nome: conexao.nome }, 56),
      el('div', { class: 'nome' }, [conexao.nome]),
      conexao.numero ? el('div', { class: 'numero', texto: telefone(conexao.numero) }) : null,
      selo(conexao.tipo === 'oficial' ? 'API Oficial (Meta)' : 'Simulador', conexao.tipo === 'oficial' ? 'ouro' : 'info'),
    ]),

    el('div', { class: 'conexao-estado' }, [
      el('div', { class: 'rotulo' }, [
        el('span', { class: 'ponto', estilo: { background: conectada ? 'var(--sucesso)' : 'var(--erro)' } }),
        document.createTextNode(conectada ? 'Conectado' : 'Desconectado'),
      ]),
      botao('Ver eventos', { pequeno: true, aoClicar: irParaLogs }),
    ]),

    conexao.conectadoEm
      ? el('div', { class: 'lista-simples mt-3' }, [
          linhaDado('Ultima verificacao', `${quando(conexao.conectadoEm)} (${dataHora(conexao.conectadoEm)})`),
          conexao.qualidade ? linhaDado('Qualidade do numero', conexao.qualidade) : null,
        ])
      : null,

    subtitulo(
      'Classes padrao',
      'Aplicadas no instante em que alguem escreve pela primeira vez para este numero.',
    ),
    el('div', { class: 'conexao-bloco' }, [
      el('div', { class: 'item' }, [
        icone('filtros', 14),
        status ? selo(status.nome, '', status.cor) : el('span', { class: 'c-fraco', texto: 'Sem status padrao' }),
      ]),
      el('div', { class: 'item' }, [
        icone('pasta', 14),
        departamento
          ? selo(departamento.nome, '', departamento.cor)
          : el('span', { class: 'c-fraco', texto: 'Sem departamento padrao' }),
      ]),
    ]),

    subtitulo('Responsavel padrao'),
    el('div', { class: 'conexao-bloco' }, [
      el('div', { class: 'item' }, [
        icone('usuarios', 14),
        responsavel
          ? el('span', { class: 'conexao-identidade' }, [
              avatar({ nome: responsavel.nome }, 24),
              el('span', { texto: responsavel.nome }),
              responsavel.tipo === 'agente' ? selo('IA', 'ouro') : null,
            ])
          : el('span', { class: 'c-fraco', texto: 'Nenhum' }),
      ]),
      el('p', {
        class: 'ajuda',
        texto: responsavel
          ? 'Toda conversa nova neste numero ja nasce com este responsavel. Sem responsavel padrao, a conversa fica em Pendentes ate alguem assumir, ou ate uma palavra-chave de agente ativar sozinha.'
          : 'Sem responsavel padrao, a conversa nova fica em Pendentes ate alguem assumir. A palavra-chave de agente continua valendo, mas so na primeira mensagem da conversa.',
      }),
    ]),
  ]);
}

function abaSaude(conexao) {
  const faltando = credenciaisFaltando(conexao);

  if (conexao.tipo !== 'oficial') {
    return el('div', {}, [
      el('div', { class: 'alerta-caixa' }, [
        el('div', { texto: 'Conexao em modo simulador.' }),
        el('div', {
          class: 'mt-1',
          texto: 'Nada sai desta maquina: a mensagem e gravada e aparece na tela como enviada. Nao ha numero real para adoecer, entao nao ha saude a medir aqui.',
        }),
      ]),
    ]);
  }

  return el('div', {}, [
    faltando.length
      ? el('div', { class: `alerta-caixa mb-3 ${faltando.some((f) => f.bloqueia) ? 'erro' : ''}`.trim() }, [
          el('div', { texto: `Falta configurar: ${faltando.map((f) => f.rotulo).join(', ')}.` }),
          el('div', {
            class: 'mt-1',
            texto: faltando.some((f) => f.bloqueia)
              ? 'Sem isso o numero nao envia nem recebe.'
              : 'Sem a chave secreta, o webhook aceita evento de qualquer origem.',
          }),
        ])
      : null,

    el('div', { class: 'lista-simples' }, [
      linhaDado('Situacao', conexao.estado === 'conectado' ? 'Conectado' : 'Desconectado'),
      linhaDado('Qualidade na Meta', conexao.qualidade || 'sem nota ainda'),
      conexao.nomeExibicao ? linhaDado('Nome de exibicao', conexao.nomeExibicao) : null,
      conexao.conectadoEm ? linhaDado('Ultima verificacao', dataHora(conexao.conectadoEm)) : null,
      conexao.ultimoErro ? linhaDado('Ultimo erro', conexao.ultimoErro) : null,
    ]),

    subtitulo(
      'URL do webhook',
      'Cole no painel da Meta, em WhatsApp > Configuracao > Webhook, junto com o token de verificacao.',
    ),
    el('div', { class: 'mono quebra-palavra', texto: `${location.origin}/webhook/${conexao.id}` }),

    el('div', { class: 'alerta-caixa mt-4' }, [
      el('div', { texto: 'A qualidade e do NUMERO, e nao do escritorio.' }),
      el('div', {
        class: 'mt-1',
        texto: 'Quando a Meta rebaixa a nota, ela derruba junto todas as campanhas ligadas neste numero. E por isso que a fila de envio se confere toda segunda, na Central de agendamentos, antes de o dia virar critico.',
      }),
    ]),
  ]);
}

function abaLogs(conexao) {
  const lista = el('div', {}, [el('div', { class: 'c-fraco', texto: 'Carregando os eventos...' })]);

  api
    .get(`/api/conexoes/${conexao.id}/eventos`)
    .then((eventos) => {
      limpar(lista);
      if (!eventos.length) {
        lista.append(
          el('div', { class: 'c-fraco' }, [
            el('div', { texto: 'Nenhum evento registrado neste numero ainda.' }),
            el('div', {
              class: 'mt-1',
              texto: 'Aparecem aqui: criacao, teste de credencial, queda, volta e mudanca de qualidade avisada pela Meta.',
            }),
          ]),
        );
        return;
      }
      for (const evento of eventos) {
        lista.append(
          el('div', { class: 'conexao-evento' }, [
            el('span', { class: 'quando', texto: dataHora(evento.em) }),
            el('span', { texto: evento.descricao }),
          ]),
        );
      }
    })
    .catch((erro) => {
      limpar(lista);
      lista.append(el('div', { class: 'alerta-caixa erro', texto: `Nao consegui ler os eventos: ${erro.message}` }));
    });

  return lista;
}

function abaConfiguracoes(conexao, painel, recarregarTela) {
  if (!podeConfigurar()) {
    return el('div', { class: 'c-fraco', texto: 'So administrador e gerente configuram conexao.' });
  }

  const { campos, salvar } = formulario(conexao, {
    aoSalvar: async () => {
      painel.fechar();
      await recarregarTela();
    },
  });

  /* O botao fica DENTRO da aba, e nao no rodape da gaveta: o rodape e o mesmo
     para as cinco abas, e um "Salvar" parado ali enquanto alguem le a aba Logs
     e um botao que nao se sabe o que salva. */
  const salvarBotao = botao('Salvar alteracoes', {
    tipo: 'principal',
    aoClicar: async () => {
      salvarBotao.disabled = true;
      try {
        await salvar();
      } catch (erro) {
        aviso(erro.message, 'erro');
      } finally {
        salvarBotao.disabled = false;
      }
    },
  });

  return el('div', {}, [...campos, el('div', { class: 'linha-botoes mt-4' }, [salvarBotao])]);
}

function abaAcoes(conexao, painel, recarregarTela) {
  return el('div', { class: 'lista-simples' }, [
    acao(
      'Testar conexao',
      'Pergunta a Meta se as credenciais ainda respondem e atualiza a situacao e a qualidade.',
      botao('Testar', { aoClicar: () => testar(conexao, recarregarTela) }),
    ),
    conexao.tipo === 'oficial'
      ? acao(
          'Copiar URL do webhook',
          'O endereco que a Meta chama a cada mensagem recebida e a cada mudanca de entrega.',
          botao('Copiar', { icone: 'copiar', aoClicar: () => copiarWebhook(conexao) }),
        )
      : null,
    podeConfigurar()
      ? acao(
          'Excluir conexao',
          'So e possivel se nenhuma conversa estiver ligada a este numero. Migre-as antes.',
          botao('Excluir', {
            tipo: 'perigo',
            aoClicar: () =>
              excluir(conexao, async () => {
                painel.fechar();
                await recarregarTela();
              }),
          }),
        )
      : null,
  ]);
}

function acao(titulo, texto, controle) {
  return el('div', { class: 'conexao-bloco' }, [
    el('div', { class: 'linha-botoes' }, [el('strong', { texto: titulo }), controle]),
    el('p', { class: 'ajuda', texto }),
  ]);
}

/* ------------------------------------------------------------------ */
/* Acoes                                                               */
/* ------------------------------------------------------------------ */

async function testar(conexao, recarregarTela) {
  try {
    const resultado = await api.post(`/api/conexoes/${conexao.id}/testar`);
    aviso(
      resultado.ok ? `Conexao respondendo. ${resultado.numero || resultado.mensagem || ''}`.trim() : resultado.erro,
      resultado.ok ? 'sucesso' : 'erro',
    );
  } catch (erro) {
    aviso(erro.message, 'erro');
  }
  await recarregarTela();
}

function copiarWebhook(conexao) {
  const url = `${location.origin}/webhook/${conexao.id}`;
  navigator.clipboard
    ?.writeText(url)
    .then(() => aviso('URL do webhook copiada.', 'sucesso'))
    .catch(() => aviso(`Copie a mao: ${url}`, ''));
}

function excluir(conexao, depois) {
  confirmar(
    `Excluir ${conexao.nome}?`,
    'So e possivel se nenhuma conversa estiver ligada a esta conexao.',
    async () => {
      await api.delete(`/api/conexoes/${conexao.id}`);
      aviso('Conexao excluida.', 'sucesso');
      await depois();
    },
    'Excluir',
  );
}

function abrirDocumentacao() {
  gaveta({
    titulo: 'Como funcionam as conexoes',
    rotuloCancelar: 'Fechar',
    corpo: [
      el('h3', { class: 'cartao-titulo', texto: 'Os dois numeros do escritorio' }),
      el('p', {
        html: 'O escritorio deve trabalhar com <strong>no minimo dois numeros</strong>: um comercial, que faz proposta e follow-up, e um de pos-venda, que fala com quem ja assinou.',
      }),
      el('p', {
        texto: 'O comercial e o que corre risco: se for restringido, o relacionamento com os clientes antigos continua intacto no outro chip. Nunca perca o numero de pos-venda.',
      }),

      el('h3', { class: 'cartao-titulo mt-4', texto: 'Simulador' }),
      el('p', {
        texto: 'Funciona hoje, sem chip. Roda o funil inteiro, agente, mencao, follow-up e contrato, para testar antes de ligar em producao. Nada sai desta maquina.',
      }),

      el('h3', { class: 'cartao-titulo mt-4', texto: 'API Oficial (Cloud API da Meta)' }),
      el('p', {
        texto: 'Numero de verdade, com conferencia de assinatura no webhook, janela de 24 horas, template aprovado, status de entrega e alerta de qualidade do numero.',
      }),
      el('p', {
        texto: 'Precisa de cinco credenciais do painel da Meta: ID do numero, ID da conta (WABA), token de acesso, chave secreta do app e token de verificacao. O token do painel expira em 24 horas, entao gere um token de usuario do sistema.',
      }),

      el('h3', { class: 'cartao-titulo mt-4', texto: 'Toda conversa nova' }),
      el('p', {
        texto: 'Cada conexao define o que acontece quando alguem escreve pela primeira vez: status padrao, departamento padrao e responsavel padrao, que normalmente e o agente de triagem.',
      }),

      el('h3', { class: 'cartao-titulo mt-4', texto: 'A janela de 24 horas' }),
      el('p', {
        texto: 'Na API Oficial, passadas 24 horas da ultima mensagem do cliente, a Meta so aceita template aprovado. Fora disso o envio volta com o erro 131047, e a mensagem aparece na conversa com o erro visivel em vez de sumir.',
      }),
    ],
  });
}

/* ------------------------------------------------------------------ */
/* Formulario                                                          */
/* ------------------------------------------------------------------ */

/**
 * Os campos da conexao. Mora numa funcao propria porque serve aos dois
 * caminhos: a gaveta de "Nova conexao" e a aba Configuracoes do painel de
 * detalhes. Duplicar onze campos em dois lugares e garantir que um dia eles
 * divirjam.
 */
function formulario(conexao, { aoSalvar }) {
  const novo = !conexao;
  const nome = entradaTexto(conexao?.nome || '');
  const tipo = selecao(
    [
      { valor: 'simulador', rotulo: 'Simulador (funciona hoje, sem chip)' },
      { valor: 'oficial', rotulo: 'API Oficial da Meta (Cloud API)' },
    ],
    conexao?.tipo || 'simulador',
  );
  const numero = entradaTexto(conexao?.numero || '');

  const statusPadrao = selecao(
    [{ valor: '', rotulo: 'Sem status' }, ...estado.status.map((s) => ({ valor: s.id, rotulo: s.nome }))],
    conexao?.statusPadraoId || '',
  );
  const departamentoPadrao = selecao(
    [{ valor: '', rotulo: 'Sem departamento' }, ...estado.departamentos.map((d) => ({ valor: d.id, rotulo: d.nome }))],
    conexao?.departamentoPadraoId || '',
  );
  const responsavelPadrao = selecao(
    opcoesResponsavel(),
    conexao?.responsavelPadrao ? `${conexao.responsavelPadrao.tipo}:${conexao.responsavelPadrao.id}` : '',
  );

  const phoneNumberId = entradaTexto(conexao?.oficial?.phoneNumberId || '');
  const wabaId = entradaTexto(conexao?.oficial?.wabaId || '');
  const token = entradaTexto('', {
    type: 'password',
    placeholder: conexao?.oficial?.token ? 'guardado; deixe em branco para manter' : '',
  });
  const appSecret = entradaTexto(conexao?.oficial?.appSecret || '', { type: 'password' });
  const verifyToken = entradaTexto(conexao?.oficial?.verifyToken || '');

  /* O display fica inline de proposito: ele acompanha o valor do campo Tipo em
     tempo de execucao, e trocar por classe mudaria o comportamento do bloco. */
  const blocoOficial = el('div', { estilo: { display: tipo.value === 'oficial' ? 'block' : 'none' } }, [
    subtitulo(
      'Credenciais da Cloud API',
      'No painel da Meta: WhatsApp > Configuracao. O token do painel expira em 24 horas, entao gere um token de usuario do sistema.',
    ),
    conexao
      ? el('div', { class: 'mono mt-2 mb-3 quebra-palavra', texto: `Webhook: ${location.origin}/webhook/${conexao.id}` })
      : null,
    campo('ID do numero de telefone', phoneNumberId),
    campo('ID da conta WhatsApp Business (WABA)', wabaId),
    campo('Token de acesso', token),
    campo('Chave secreta do app', appSecret, 'Confere a assinatura de cada evento. Sem ela, quem descobrir a URL manda evento falso.'),
    campo('Token de verificacao', verifyToken, 'Mesmo valor no campo "Verificar token" do painel da Meta.'),
  ]);

  tipo.addEventListener('change', () => {
    blocoOficial.style.display = tipo.value === 'oficial' ? 'block' : 'none';
  });

  async function salvar() {
    if (!nome.value.trim()) throw new Error('De um nome a conexao.');
    const [tipoResp, idResp] = responsavelPadrao.value ? responsavelPadrao.value.split(':') : [null, null];
    const dados = {
      nome: nome.value.trim(),
      tipo: tipo.value,
      numero: numero.value.trim(),
      statusPadraoId: statusPadrao.value || null,
      departamentoPadraoId: departamentoPadrao.value || null,
      responsavelPadrao: tipoResp ? { tipo: tipoResp, id: idResp } : null,
    };
    if (tipo.value === 'oficial') {
      dados.oficial = {
        phoneNumberId: phoneNumberId.value.trim(),
        wabaId: wabaId.value.trim(),
        appSecret: appSecret.value.trim(),
        verifyToken: verifyToken.value.trim(),
      };
      /* Campo em branco significa "mantenha o que ja esta guardado". Mandando
         a string vazia, salvar o nome da conexao apagaria o token do numero. */
      if (token.value.trim()) dados.oficial.token = token.value.trim();
    }
    if (novo) await api.post('/api/conexoes', dados);
    else await api.patch(`/api/conexoes/${conexao.id}`, dados);
    aviso('Conexao salva.', 'sucesso');
    await aoSalvar();
  }

  const campos = [
    campo('Nome', nome),
    campoComDica('Tipo', tipo, 'Simulador funciona sem chip. Oficial precisa das credenciais da Meta.'),
    campo('Numero', numero),
    subtitulo('Padroes de toda conversa nova', 'Aplicados no momento em que alguem escreve pela primeira vez para este numero.'),
    campo('Status padrao', statusPadrao),
    campo('Departamento padrao', departamentoPadrao),
    campo('Responsavel padrao', responsavelPadrao, 'Normalmente o agente de triagem.'),
    blocoOficial,
  ];

  return { campos, salvar };
}

/**
 * Gaveta de criacao e de configuracao vinda do menu da linha. A aba
 * Configuracoes usa os mesmos campos, mas com o botao dentro dela.
 */
function editar(conexao, recarregarTela) {
  const { campos, salvar } = formulario(conexao, { aoSalvar: recarregarTela });
  gaveta({
    titulo: conexao ? `Configurar ${conexao.nome}` : 'Nova conexao',
    corpo: campos,
    confirmar: 'Salvar',
    aoConfirmar: salvar,
  });
}

/* ------------------------------------------------------------------ */
/* Apoio                                                               */
/* ------------------------------------------------------------------ */

function linhaDado(rotulo, valor) {
  return el('div', { class: 'linha-dado' }, [el('span', { texto: rotulo }), el('span', { texto: String(valor) })]);
}

function subtitulo(texto, balao) {
  return el('h3', { class: 'cartao-titulo mt-4' }, [texto, balao ? dica(balao, { assunto: texto }) : null]);
}

/** Nome e natureza de quem recebe as conversas novas deste numero. */
function descreverResponsavel(responsavel) {
  if (!responsavel?.id) return null;
  if (responsavel.tipo === 'agente') {
    const agente = estado.agentes.find((a) => a.id === responsavel.id);
    return agente ? { nome: agente.nome, tipo: 'agente' } : null;
  }
  const membro = estado.membros.find((m) => m.id === responsavel.id);
  return membro ? { nome: membro.usuario?.nome || 'Membro', tipo: 'membro' } : null;
}

/**
 * Credencial que ainda falta na Cloud API. O token chega mascarado da rota
 * ('***' quando existe, vazio quando nao), entao da para avisar que falta sem
 * nunca trazer o valor de verdade para a tela.
 *
 * A chave secreta do app nao impede o envio, so deixa o webhook aceitar evento
 * de qualquer origem, por isso ela entra na lista sem marcar bloqueio.
 */
function credenciaisFaltando(conexao) {
  if (conexao.tipo !== 'oficial') return [];
  const oficial = conexao.oficial || {};
  const faltas = [];
  if (!oficial.phoneNumberId) faltas.push({ rotulo: 'ID do numero', bloqueia: true });
  if (!oficial.token) faltas.push({ rotulo: 'token de acesso', bloqueia: true });
  if (!oficial.verifyToken) faltas.push({ rotulo: 'token de verificacao', bloqueia: true });
  if (!oficial.appSecret) faltas.push({ rotulo: 'chave secreta do app', bloqueia: false });
  return faltas;
}
