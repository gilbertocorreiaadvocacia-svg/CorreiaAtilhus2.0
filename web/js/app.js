import { api } from './api.js';
import {
  acharConexao,
  carregarBasico,
  carregarNotificacoes,
  carregarSessao,
  conectarEventos,
  definirTema,
  escolherNumero,
  estado,
  numeroEscolhido,
  ouvir,
  podeConfigurar,
  tema,
} from './estado.js';
import { avatar, aviso, botao, campo, dataHora, el, entradaTexto, icone, limpar, modal, selo, telefone } from './ui.js';
import {
  definirSistema,
  definirSom,
  pedirPermissao,
  permissaoDoSistema,
  sistemaLigado,
  somLigado,
  tocar,
} from './avisos.js';

import { paginaInicio } from './paginas/inicio.js';

/* O sistema abre na fila de conversas, e nao num resumo.
   Quem senta nesta tela senta para atender, e o primeiro clique de todo dia
   era sair do resumo e ir para a fila. O Inicio continua existindo, porque e o
   unico lugar que avisa risco de bloqueio do numero e agente mal configurado,
   mas deixou de ser a porta de entrada. */
const ROTA_PADRAO = 'atendimento';
import { paginaAtendimento } from './paginas/atendimento.js';
import { paginaAgentes } from './paginas/agentes.js';
import { paginaConhecimento } from './paginas/conhecimento.js';
import { paginaTemplates } from './paginas/templates.js';
import { paginaVozes } from './paginas/vozes.js';
import { paginaIntegracoes } from './paginas/integracoes.js';
import { paginaDashboard } from './paginas/dashboard.js';
import { paginaAgendamentos } from './paginas/agendamentos.js';
import { paginaTarefas } from './paginas/tarefas.js';
import { paginaConexoes } from './paginas/conexoes.js';
import { paginaConfiguracoes } from './paginas/configuracoes.js';
import { moduloAgentes } from './paginas/modulo-agentes.js';
import { paginaContratos } from './paginas/contratos.js';

const raiz = document.getElementById('raiz');

/**
 * Conversas, Contatos e Kanban sao a mesma tela vista de tres jeitos, entao as
 * tres rotas apontam para paginaAtendimento e so mudam o campo visualizacao.
 * Duplicar a tela seria duplicar filtro, acao em massa e painel da conversa.
 */
const PAGINAS = {
  inicio: { titulo: 'Início', montar: paginaInicio },
  dashboard: { titulo: 'Dashboard', montar: paginaDashboard },
  conexoes: { titulo: 'Conexões', subtitulo: 'Gerencie suas conexões com canais de comunicação.', montar: paginaConexoes },

  /* Conversas nao tem cabeca de tela: a fila comeca logo abaixo da barra de cima. */
  atendimento: { titulo: 'Conversas', montar: paginaAtendimento, cheia: true, semCabeca: true, visualizacao: 'conversas' },
  contatos: { titulo: 'Contatos', montar: paginaAtendimento, cheia: true, visualizacao: 'contatos' },
  kanban: { titulo: 'Funil', montar: paginaAtendimento, cheia: true, visualizacao: 'kanban' },
  contratos: { titulo: 'Contratos', montar: paginaContratos, cheia: true },

  /* Agentes, Base de conhecimento e Chat de teste sao abas do mesmo modulo
     (paginas/modulo-agentes.js). As tres rotas continuam existindo. */
  agentes: { titulo: 'Agentes de IA', montar: moduloAgentes('agentes'), cheia: true },
  conhecimento: { titulo: 'Base de conhecimento', montar: moduloAgentes('conhecimento') },
  templates: { titulo: 'Templates', montar: paginaTemplates },
  vozes: { titulo: 'Vozes', montar: paginaVozes },
  integracoes: { titulo: 'Integrações', montar: paginaIntegracoes },

  tarefas: { titulo: 'Tarefas', montar: paginaTarefas },
  agendamentos: { titulo: 'Central de agendamentos', montar: paginaAgendamentos },
  simulador: { titulo: 'Chat de teste', montar: moduloAgentes('simulador') },
  configuracoes: { titulo: 'Configurações', montar: paginaConfiguracoes },
};

/**
 * A barra de icones.
 *
 * Tres grupos, na ordem em que o dia acontece: o que se abre para comecar
 * (Inicio, Dashboard), o que se atende (conversas, contatos, funil, tarefas,
 * agendamentos) e o que se configura para o atendimento andar sozinho
 * (agentes, templates, vozes, numeros, integracoes). Configuracoes fica no pe,
 * junto de quem esta logado.
 *
 * Os grupos nao abrem nem fecham. Na faixa de 64px nao ha rotulo para clicar,
 * e grupo fechado esconderia rota sem deixar jeito de abrir. O nome de cada
 * icone aparece ao lado dele, ao passar o mouse ou chegar pelo Tab.
 *
 * `contador` liga o icone a um numero contado no servidor (ver
 * atualizarContadoresDaBarra).
 */
const BARRA = [
  [
    { rota: 'inicio', rotulo: 'Início', icone: 'inicio' },
    { rota: 'dashboard', rotulo: 'Dashboard', icone: 'painel' },
  ],
  [
    {
      rota: 'atendimento',
      rotulo: 'Conversas',
      icone: 'conversas',
      contador: { chave: 'pendentes', tipo: 'alerta', rotulo: 'esperando alguém' },
    },
    { rota: 'contatos', rotulo: 'Contatos', icone: 'usuarios' },
    { rota: 'kanban', rotulo: 'Funil', icone: 'filtros' },
    {
      rota: 'contratos',
      rotulo: 'Contratos',
      icone: 'contrato',
      contador: { chave: 'conferir', tipo: 'ouro', rotulo: 'para conferir' },
    },
    { rota: 'tarefas', rotulo: 'Tarefas', icone: 'ok' },
    { rota: 'agendamentos', rotulo: 'Agendamentos', icone: 'agenda' },
  ],
  [
    { rota: 'agentes', rotulo: 'Agentes', icone: 'agentes' },
    { rota: 'templates', rotulo: 'Templates', icone: 'templates' },
    { rota: 'vozes', rotulo: 'Vozes', icone: 'pessoa' },
    { rota: 'conexoes', rotulo: 'Conexões', icone: 'conexoes' },
    { rota: 'integracoes', rotulo: 'Integrações', icone: 'abrir' },
  ],
];

const CONFIGURACOES = { rota: 'configuracoes', rotulo: 'Configurações', icone: 'ajustes' };

/* Telas que moram dentro de outra na barra: abrir uma delas acende o icone de
   quem as contem (Base de conhecimento e Chat de teste sao abas de Agentes). */
const DENTRO_DE = { conhecimento: 'agentes', simulador: 'agentes' };
const itemDoMenuDa = (rota) => DENTRO_DE[rota] || rota;

/* ------------------------------------------------------------------ */
/* Entrada                                                             */
/* ------------------------------------------------------------------ */

function telaEntrada(mensagemInicial) {
  limpar(raiz);

  const email = entradaTexto('', { type: 'email', placeholder: 'voce@correia.adv.br', autocomplete: 'username' });
  const senha = entradaTexto('', { type: 'password', autocomplete: 'current-password' });
  // role="alert" porque a falha de login e a unica resposta que a tela da, e
  // sem ele o leitor de tela nao anuncia nada depois do Enter.
  const erro = el('div', {
    class: 'selo erro mb-3',
    role: 'alert',
    'aria-live': 'assertive',
    // So o display continua inline: ele e estado de execucao, o aviso aparece
    // quando a tentativa falha.
    estilo: { display: 'none' },
  });

  const entrar = async (evento) => {
    evento?.preventDefault();
    erro.style.display = 'none';
    try {
      await api.post('/api/sessao/entrar', { email: email.value.trim(), senha: senha.value });
      await iniciarApp();
    } catch (falha) {
      erro.textContent = falha.message;
      erro.style.display = 'inline-flex';
    }
  };

  // O Entrar e submit, e nao um botao com onclick: formulario com dois campos e
  // nenhum submit nao dispara submit no Enter, entao apertar Enter na senha nao
  // fazia nada. Com type="submit" o caminho e um so, o aoSubmit acima.
  const formulario = el('form', { aoSubmit: entrar }, [
    campo('E-mail', email),
    campo('Senha', senha),
    erro,
    botao('Entrar', { tipo: 'principal', submeter: true }),
  ]);

  raiz.append(
    el('div', { class: 'entrada' }, [
      el('div', { class: 'entrada-cartao' }, [
        el('img', { src: 'assets/logo.png', alt: 'Correia Advogados Associados' }),
        el('h1', { texto: 'CorreiaAtilhus2.0' }),
        el('p', { texto: 'Correia Advogados Associados' }),
        formulario,
        mensagemInicial
          ? el('div', { class: 'entrada-dica', html: mensagemInicial })
          : el('div', {
              class: 'entrada-dica',
              html: 'Primeiro acesso: <strong>admin@correia.adv.br</strong><br />senha <strong>correia2026</strong>',
            }),
      ]),
    ]),
  );
  email.focus();
}

/* ------------------------------------------------------------------ */
/* Barra de icones                                                     */
/* ------------------------------------------------------------------ */

let barraNo = null;

/**
 * O nome do icone, ao lado dele.
 *
 * Um balao so, preso ao documento e posicionado pela caixa do icone. Um
 * pseudo-elemento dentro da barra seria cortado: a lista de icones rola por
 * dentro quando a janela e baixa (notebook de 768px), e o que rola corta o que
 * passa da borda.
 */
let dicaDaBarra = null;

function mostrarDica(alvo) {
  if (!dicaDaBarra) {
    dicaDaBarra = el('div', { class: 'dica-barra', 'aria-hidden': 'true', hidden: true });
    document.body.append(dicaDaBarra);
  }
  const caixa = alvo.getBoundingClientRect();
  dicaDaBarra.textContent = alvo.dataset.rotulo;
  dicaDaBarra.style.top = `${Math.round(caixa.top + caixa.height / 2)}px`;
  dicaDaBarra.style.left = `${Math.round(caixa.right + 10)}px`;
  dicaDaBarra.hidden = false;
}

function esconderDica() {
  if (dicaDaBarra) dicaDaBarra.hidden = true;
}

function itemDaBarra(item) {
  const link = el(
    'a',
    {
      class: 'rail-item',
      href: `#/${item.rota}`,
      dataset: { rota: item.rota, rotulo: item.rotulo },
      'aria-label': item.rotulo,
    },
    [icone(item.icone, 20)],
  );
  if (item.contador) {
    link.append(
      el('span', {
        class: `rail-conta ${item.contador.tipo}`,
        dataset: { contador: item.contador.chave, rotulo: item.contador.rotulo },
        'aria-hidden': 'true',
        hidden: true,
      }),
    );
  }
  link.addEventListener('pointerenter', () => mostrarDica(link));
  link.addEventListener('pointerleave', esconderDica);
  link.addEventListener('focus', () => mostrarDica(link));
  link.addEventListener('blur', esconderDica);
  link.addEventListener('click', esconderDica);
  return link;
}

/**
 * Quem esta logado, no pe da barra, com a saida do sistema.
 *
 * Nome e papel moravam na barra de cima. Na faixa de 64px sobra o rosto, e o
 * resto abre num painel ao lado: sair do sistema e gesto de fim de dia, e nao
 * precisa de lugar fixo na tela.
 */
function menuDaPessoa() {
  const usuario = estado.sessao.usuario;
  const papel = estado.sessao.papeis[estado.sessao.papel]?.nome || estado.sessao.papel;

  const gatilho = el(
    'button',
    {
      type: 'button',
      class: 'rail-eu',
      'aria-haspopup': 'menu',
      'aria-expanded': 'false',
      'aria-label': `${usuario.nome}, ${papel}`,
    },
    [avatar(usuario, 32)],
  );

  const painel = el('div', { class: 'rail-eu-painel', role: 'menu', hidden: true }, [
    el('div', { class: 'rail-eu-quem' }, [el('strong', { texto: usuario.nome }), el('span', { texto: papel })]),
    el(
      'button',
      {
        type: 'button',
        class: 'rail-eu-opcao',
        role: 'menuitem',
        aoClick: async () => {
          fechar();
          await api.post('/api/sessao/sair');
          telaEntrada();
        },
      },
      [icone('sair', 15), 'Sair do sistema'],
    ),
  ]);

  const fora = (evento) => {
    if (!painel.contains(evento.target) && !gatilho.contains(evento.target)) fechar();
  };
  const teclas = (evento) => {
    if (evento.key !== 'Escape') return;
    fechar();
    gatilho.focus();
  };
  function fechar() {
    painel.hidden = true;
    gatilho.setAttribute('aria-expanded', 'false');
    document.removeEventListener('mousedown', fora);
    document.removeEventListener('keydown', teclas);
  }

  gatilho.addEventListener('click', () => {
    if (!painel.hidden) return fechar();
    /* Fixo na tela, e nao preso a barra: a barra rola por dentro e cortaria o
       painel. Abre para cima, a partir do pe do avatar. */
    const caixa = gatilho.getBoundingClientRect();
    painel.style.left = `${Math.round(caixa.right + 10)}px`;
    painel.style.bottom = `${Math.round(window.innerHeight - caixa.bottom)}px`;
    painel.hidden = false;
    gatilho.setAttribute('aria-expanded', 'true');
    painel.querySelector('button')?.focus();
    document.addEventListener('mousedown', fora);
    document.addEventListener('keydown', teclas);
  });

  return [gatilho, painel];
}

function montarBarra() {
  if (!barraNo) return;
  limpar(barraNo);

  const grupos = el('div', { class: 'rail-grupos' });
  BARRA.forEach((grupo, indice) => {
    if (indice) grupos.append(el('span', { class: 'rail-fio', 'aria-hidden': 'true' }));
    grupos.append(el('div', { class: 'rail-grupo', role: 'group' }, grupo.map(itemDaBarra)));
  });
  /* Com a lista rolando, o balao ficaria apontando para onde o icone estava. */
  grupos.addEventListener('scroll', esconderDica, { passive: true });

  barraNo.append(
    el('a', { class: 'rail-marca', href: `#/${ROTA_PADRAO}`, 'aria-label': 'Correia Advogados: abrir as conversas' }, [
      el('img', { src: 'assets/logo.png', alt: '' }),
    ]),
    grupos,
    el('div', { class: 'rail-fim' }, [itemDaBarra(CONFIGURACOES), ...menuDaPessoa()]),
  );

  marcarRotaAtiva(rotaAtual());
  atualizarContadoresDaBarra();
}

function marcarRotaAtiva(rota) {
  const daBarra = itemDoMenuDa(rota);
  for (const link of document.querySelectorAll('.rail-item')) {
    const ativo = link.dataset.rota === daBarra;
    link.classList.toggle('ativo', ativo);
    if (ativo) link.setAttribute('aria-current', 'page');
    else link.removeAttribute('aria-current');
  }
}

/**
 * Os numeros da barra.
 *
 * Contados no servidor pela mesma listagem da fila: pedindo um item so, o que
 * interessa e a contagem por aba que vem junto. Refeitos quando chega evento
 * de conversa, com um intervalo curto no meio: numa rajada de mensagens, uma
 * consulta so.
 */
let relogioDosContadores = null;

function atualizarContadoresDaBarra() {
  clearTimeout(relogioDosContadores);
  relogioDosContadores = setTimeout(async () => {
    const [conversas, contratos] = await Promise.allSettled([
      api.get('/api/contatos', { comMensagem: 'true', limite: 1 }),
      api.get('/api/contratos'),
    ]);
    /* O numero e informacao a mais: se uma consulta falhar, o icone continua
       levando para a tela, so sem o contador. */
    if (conversas.status === 'fulfilled') pintarContador('pendentes', conversas.value?.contagens?.pendentes || 0);
    if (contratos.status === 'fulfilled') {
      pintarContador('conferir', (contratos.value || []).filter((c) => c.situacao === 'em_conferencia').length);
    }
  }, 400);
}

function pintarContador(chave, valor) {
  for (const conta of document.querySelectorAll(`.rail-conta[data-contador="${chave}"]`)) {
    conta.textContent = valor > 99 ? '99+' : String(valor);
    conta.hidden = !valor;
    /* O numero fica colado no icone; quem usa leitor de tela o ouve no nome do link. */
    const link = conta.closest('.rail-item');
    if (!link) continue;
    link.setAttribute('aria-label', valor ? `${link.dataset.rotulo}, ${valor} ${conta.dataset.rotulo}` : link.dataset.rotulo);
  }
}

/* ------------------------------------------------------------------ */
/* Estrutura do aplicativo                                             */
/* ------------------------------------------------------------------ */

let areaConteudo = null;
let cabecaTela = null;
let tituloTela = null;
let subtituloTela = null;
let acoesTela = null;
let principalDoTopo = null;

/**
 * Em que escritorio e em qual numero de WhatsApp a pessoa esta.
 *
 * Os dois moravam longe um do outro: o escritorio na barra global, o numero na
 * barra da fila de Conversas. Juntos no canto da barra de cima, eles dizem de
 * onde e tudo o que a tela mostra, em qualquer tela.
 *
 * Trocar de escritorio recarrega o sistema. Trocar de numero so muda o recorte
 * das conversas, e estado.escolherNumero avisa quem precisa saber.
 */
let contasPorNumero = {};
let repintarContexto = () => {};

function seletorDeContexto() {
  const pontoDe = (conexao) =>
    el('span', {
      class: `contexto-ponto ${!conexao ? 'todos' : conexao.estado === 'conectado' ? 'ligado' : 'desligado'}`,
      title: !conexao ? null : conexao.estado === 'conectado' ? 'Conectado' : 'Desconectado',
    });
  const numeroDe = (conexao) =>
    conexao.tipo === 'simulador' ? 'número de teste' : conexao.numero ? telefone(conexao.numero) : 'ainda sem número';

  const gatilho = el('button', {
    type: 'button',
    class: 'contexto-gatilho',
    'aria-haspopup': 'listbox',
    'aria-expanded': 'false',
    title: 'Escritório e número de WhatsApp',
  });
  const lista = el('div', { class: 'contexto-lista', hidden: true });
  const caixa = el('div', { class: 'contexto' }, [gatilho, lista]);

  function pintarGatilho() {
    const escolhida = acharConexao(numeroEscolhido());
    /* Alguem esperando em OUTRO numero: o selo avisa sem precisar abrir. */
    const esperandoEmOutros = escolhida
      ? estado.conexoes
          .filter((c) => c.id !== escolhida.id)
          .reduce((soma, c) => soma + (contasPorNumero[c.id]?.naoLidas || 0), 0)
      : 0;
    limpar(gatilho).append(
      ...[
        pontoDe(escolhida),
        el('span', { class: 'contexto-texto' }, [
          el('strong', { texto: estado.sessao.workspace?.nome || 'Escritório' }),
          el('span', { texto: escolhida ? escolhida.nome : 'Todos os números' }),
        ]),
        esperandoEmOutros
          ? el('span', { class: 'conta canal', title: 'Conversas por ler em outros números', texto: String(esperandoEmOutros) })
          : null,
        el('span', { class: 'contexto-seta' }, [icone('voltar', 12)]),
      ].filter(Boolean),
    );
  }

  const opcaoDeNumero = (conexao) => {
    const contas = conexao ? contasPorNumero[conexao.id] : null;
    const ativa = (conexao?.id || '') === numeroEscolhido();
    return el(
      'button',
      {
        type: 'button',
        role: 'option',
        'aria-selected': ativa ? 'true' : 'false',
        class: `contexto-opcao${ativa ? ' ativo' : ''}`,
        aoClick: () => {
          fechar();
          if (!ativa) escolherNumero(conexao?.id || '');
        },
      },
      [
        pontoDe(conexao),
        el('span', { class: 'contexto-texto' }, [
          el('strong', { texto: conexao ? conexao.nome : 'Todos os números' }),
          el('span', { texto: conexao ? numeroDe(conexao) : 'As conversas de todos os números' }),
        ]),
        contas?.naoLidas ? el('span', { class: 'conta canal', title: 'Conversas por ler', texto: String(contas.naoLidas) }) : null,
        ativa ? icone('ok', 14) : null,
      ],
    );
  };

  const opcaoDeEscritorio = (workspace) => {
    const atual = workspace.id === estado.sessao.workspace?.id;
    return el(
      'button',
      {
        type: 'button',
        role: 'option',
        'aria-selected': atual ? 'true' : 'false',
        class: `contexto-opcao${atual ? ' ativo' : ''}`,
        aoClick: async () => {
          fechar();
          if (atual) return;
          await api.post('/api/sessao/workspace', { workspaceId: workspace.id });
          await iniciarApp();
        },
      },
      [
        el('span', { class: 'contexto-icone' }, [icone('predio', 14)]),
        el('span', { class: 'contexto-texto' }, [el('strong', { texto: workspace.nome })]),
        atual ? icone('ok', 14) : null,
      ],
    );
  };

  const fora = (evento) => {
    if (!caixa.contains(evento.target)) fechar();
  };
  const teclas = (evento) => {
    if (evento.key !== 'Escape') return;
    fechar();
    gatilho.focus();
  };
  function fechar() {
    lista.hidden = true;
    gatilho.setAttribute('aria-expanded', 'false');
    document.removeEventListener('mousedown', fora);
    document.removeEventListener('keydown', teclas);
  }

  gatilho.addEventListener('click', () => {
    if (!lista.hidden) return fechar();
    limpar(lista);
    if (estado.sessao.workspaces.length > 1) {
      lista.append(el('div', { class: 'contexto-grupo', texto: 'Escritório' }), ...estado.sessao.workspaces.map(opcaoDeEscritorio));
    }
    lista.append(
      el('div', { class: 'contexto-grupo', texto: 'Número de WhatsApp' }),
      opcaoDeNumero(null),
      ...estado.conexoes.map(opcaoDeNumero),
    );
    if (podeConfigurar()) {
      lista.append(
        el(
          'button',
          {
            type: 'button',
            class: 'contexto-rodape',
            aoClick: () => {
              fechar();
              location.hash = '#/conexoes';
            },
          },
          [icone('mais', 14), 'Conectar outro número'],
        ),
      );
    }
    lista.hidden = false;
    gatilho.setAttribute('aria-expanded', 'true');
    lista.querySelector('[aria-selected="true"]')?.focus();
    document.addEventListener('mousedown', fora);
    document.addEventListener('keydown', teclas);
  });

  repintarContexto = pintarGatilho;
  pintarGatilho();
  return caixa;
}

/* Funcoes com nome, e nao closures novas a cada montagem: ouvir() guarda num
   Set, e registrar a mesma funcao de novo ao trocar de escritorio nao duplica. */
function aoMudarNumero() {
  repintarContexto();
}

function aoContarPorNumero(contas) {
  contasPorNumero = contas || {};
  repintarContexto();
}

function montarEstrutura() {
  limpar(raiz);
  const escolhido = tema();
  if (escolhido) document.documentElement.dataset.tema = escolhido;

  barraNo = el('nav', { class: 'rail', 'aria-label': 'Áreas do sistema' });

  const sino = botao('', { icone: 'sino', titulo: 'Notificações', aoClicar: abrirNotificacoes });
  const contadorSino = el('span', { class: 'nao-lidas', estilo: { display: 'none' } });
  const caixaSino = el('div', { class: 'linha-p caixa-sino' }, [sino, contadorSino]);

  const atualizarSino = () => {
    const naoLidas = estado.notificacoes.filter((n) => !n.lida).length;
    contadorSino.textContent = naoLidas > 99 ? '99+' : String(naoLidas);
    contadorSino.style.display = naoLidas ? 'grid' : 'none';
  };
  ouvir('notificacoes', atualizarSino);

  tituloTela = el('h1', { texto: '' });
  subtituloTela = el('span', { class: 'subtitulo', texto: '' });
  /* Faixa de controles da propria tela, na mesma linha do titulo. Filtro que
     vale para a tela inteira pertence ao cabeco dela, e nao a um cartao dentro
     do conteudo: dentro do conteudo ele empurra o primeiro dado para baixo e
     rola junto com a pagina, sumindo justo quando se quer trocar o recorte. */
  acoesTela = el('div', { class: 'topo-acoes' });
  cabecaTela = el('header', { class: 'cabeca-tela' }, [
    el('div', { class: 'cabeca-identidade' }, [tituloTela, subtituloTela]),
    acoesTela,
  ]);
  /* A acao principal da tela (Nova conversa, Novo agente) fica no canto da
     barra de cima, no mesmo lugar em toda tela que tem uma. */
  principalDoTopo = el('div', { class: 'barra-topo-principal' });
  areaConteudo = el('main', { class: 'conteudo' });

  // O icone mostra para onde o clique leva, nao o estado atual: quem esta no
  // escuro ve o sol porque e o sol que vai receber.
  const alternarTema = botao('', { icone: 'sol', titulo: '' });
  const ajustarBotaoTema = () => {
    const claro = document.documentElement.dataset.tema === 'claro';
    limpar(alternarTema).append(icone(claro ? 'lua' : 'sol', 15));
    alternarTema.title = claro ? 'Mudar para o tema escuro' : 'Mudar para o tema claro';
  };
  alternarTema.addEventListener('click', () => {
    definirTema(document.documentElement.dataset.tema === 'claro' ? 'escuro' : 'claro');
    ajustarBotaoTema();
  });
  ajustarBotaoTema();
  alternarTema.classList.add('botao-barra');
  sino.classList.add('botao-barra');

  raiz.append(
    el('div', { class: 'app' }, [
      barraNo,
      el('div', { class: 'area-principal' }, [
        /* Barra de cima: o que vale para o sistema inteiro, mais a acao
           principal da tela aberta no canto. */
        el('header', { class: 'barra-topo' }, [
          seletorDeContexto(),
          buscaGlobal(),
          el('div', { class: 'espaco' }),
          alternarTema,
          caixaSino,
          principalDoTopo,
        ]),
        cabecaTela,
        areaConteudo,
      ]),
    ]),
  );

  montarBarra();
  atualizarSino();
}

function abrirNotificacoes() {
  const lista = el('div', { class: 'lista-simples' });
  if (!estado.notificacoes.length) {
    lista.append(el('div', { class: 'vazio', texto: 'Nada por aqui ainda.' }));
  }
  // A notificacao ja lida ganha uma classe de estado e um selo, nunca opacidade
  // no item inteiro: com opacity 0.6 no container, a descricao em
  // --texto-suave caia de 7,5:1 para cerca de 3,4:1 e reprovava o contraste.
  for (const notificacao of estado.notificacoes.slice(0, 40)) {
    const linha = el('div', { class: notificacao.lida ? 'lista-item lida' : 'lista-item' }, [
      el('div', { class: 'corpo' }, [
        el('div', { class: 'titulo', texto: notificacao.titulo }),
        el('div', { class: 'desc', texto: notificacao.texto || '' }),
        /* Quando aconteceu. Sem isto, "Nova mensagem de Maria" nao dizia se era
           de agora ou de terca, e a lista inteira se lia como igualmente
           urgente. */
        el('div', { class: 't-xs c-fraco', texto: dataHora(notificacao.criadoEm) }),
      ]),
      notificacao.lida ? selo('lida', '') : null,
      /* Marcar uma so. So havia "marcar todas", entao quem queria limpar um
         aviso resolvido tinha de apagar junto os que ainda nao tinha visto. */
      notificacao.lida
        ? null
        : botao('', {
            icone: 'ok',
            titulo: 'Marcar esta como lida',
            pequeno: true,
            aoClicar: async () => {
              await api.post('/api/notificacoes/ler', { ids: [notificacao.id] });
              await carregarNotificacoes();
              linha.classList.add('lida');
            },
          }),
      notificacao.contatoId
        ? botao('Abrir', {
            pequeno: true,
            aoClicar: () => {
              location.hash = `#/atendimento/${notificacao.contatoId}`;
              document.querySelector('.cortina')?.remove();
            },
          })
        : null,
    ]);
    lista.append(linha);
  }

  modal({
    titulo: 'Notificações',
    corpo: el('div', {}, [controlesDeAviso(), lista]),
    confirmar: 'Marcar todas como lidas',
    aoConfirmar: async () => {
      await api.post('/api/notificacoes/ler', {});
      await carregarNotificacoes();
    },
  });
}

/**
 * Como esta pessoa quer ser avisada, neste navegador.
 *
 * Fica no proprio painel do sino, e nao em Configuracoes, porque e aqui que a
 * pergunta aparece: quem abre isto ou quer ver o que chegou, ou esta incomodado
 * com a forma como chegou.
 *
 * As duas escolhas valem so neste navegador, e o texto diz isso. Sao coisas de
 * maquina, nao de conta: a permissao de notificacao ja e por navegador, e a
 * mesma pessoa pode querer som na mesa e silencio no notebook da audiencia.
 */
function controlesDeAviso() {
  const bloco = el('div', { class: 'controles-aviso mb-3' });

  const caixaSom = el('input', { type: 'checkbox' });
  caixaSom.checked = somLigado();
  caixaSom.addEventListener('change', () => {
    definirSom(caixaSom.checked);
    /* Toca ao ligar: e a unica forma de saber como e o som antes de precisar
       dele, e confirma que o audio do navegador nao esta bloqueado. */
    if (caixaSom.checked) tocar();
  });

  const caixaSistema = el('input', { type: 'checkbox' });
  const estadoPermissao = el('div', { class: 't-xs c-fraco' });

  const atualizarPermissao = () => {
    const permissao = permissaoDoSistema();
    caixaSistema.checked = sistemaLigado() && permissao === 'granted';
    caixaSistema.disabled = permissao === 'indisponivel' || permissao === 'denied';
    estadoPermissao.textContent =
      permissao === 'indisponivel'
        ? 'Este navegador nao faz notificacao do sistema.'
        : permissao === 'denied'
          ? 'O navegador bloqueou as notificacoes deste site. Para liberar, use o cadeado na barra de endereco.'
          : 'Aparece so quando o sistema nao esta na sua frente.';
  };

  caixaSistema.addEventListener('change', async () => {
    if (!caixaSistema.checked) {
      definirSistema(false);
      atualizarPermissao();
      return;
    }
    /* O pedido de permissao precisa nascer de um clique. Por isso ele mora
       aqui, no change da caixa, e nao no carregamento da tela: pedido feito no
       boot e recusado pelo navegador sem nem mostrar a caixa de dialogo, e
       gasta a unica chance que existe. */
    const resposta = await pedirPermissao();
    definirSistema(resposta === 'granted');
    if (resposta !== 'granted') aviso('O navegador nao liberou as notificacoes.', 'alerta');
    atualizarPermissao();
  });

  atualizarPermissao();

  bloco.append(
    el('div', { class: 'cartao-titulo', texto: 'Como avisar' }),
    el('label', { class: 'linha t-md' }, [caixaSom, 'Tocar um som quando chegar aviso']),
    el('label', { class: 'linha t-md mt-2' }, [caixaSistema, 'Mostrar notificacao do sistema']),
    estadoPermissao,
    el('div', { class: 't-xs c-fraco mt-2', texto: 'As duas escolhas valem so neste navegador.' }),
  );
  return bloco;
}

/* ------------------------------------------------------------------ */
/* Roteamento                                                          */
/* ------------------------------------------------------------------ */

function partesDaRota() {
  return (location.hash.replace(/^#\/?/, '') || ROTA_PADRAO).split('/');
}

function rotaAtual() {
  const primeira = partesDaRota()[0];
  return PAGINAS[primeira] ? primeira : ROTA_PADRAO;
}

/**
 * Esqueleto de carregamento com a forma da tela que vem.
 *
 * Um "Carregando" centralizado nao diz nada e ainda faz a pagina saltar quando
 * o conteudo real chega. O esqueleto ja ocupa o espaco certo, entao nada pula.
 */
function esqueletoDe(rota) {
  // A largura de cada linha continua no atributo style: ela e a porcentagem que
  // desenha a forma irregular do texto que esta chegando, e nao uma medida do
  // sistema. Todo o resto, respiro, altura e arranjo, saiu para o tema.
  const linha = (largura) => el('div', { class: 'esqueleto esqueleto-linha', estilo: { width: largura } });
  const bloco = () => el('div', { class: 'esqueleto esqueleto-bloco' });

  if (rota === 'atendimento' || rota === 'agentes') {
    return el('div', { class: 'atendimento sem-painel' }, [
      el('div', { class: 'coluna esqueleto-rota' }, [
        linha('60%'),
        bloco(),
        bloco(),
        bloco(),
        bloco(),
      ]),
      el('div', { class: 'conversa esqueleto-rota' }, [
        linha('35%'),
        linha('80%'),
        linha('55%'),
        linha('70%'),
      ]),
    ]);
  }

  // O Kanban chega em colunas, entao o esqueleto tambem: com o esqueleto de
  // lista, a tela reorganizava tudo na horizontal quando o quadro aparecia.
  if (rota === 'kanban') {
    return el(
      'div',
      { class: 'esqueleto-colunas' },
      Array.from({ length: 4 }, () =>
        el('div', { class: 'flexivel encolhe' }, [linha('55%'), bloco(), bloco(), bloco()]),
      ),
    );
  }

  if (rota === 'contatos') {
    return el('div', { class: 'esqueleto-rota' }, [linha('40%'), bloco(), bloco(), bloco(), bloco(), bloco()]);
  }

  return el('div', { class: 'esqueleto-painel' }, [
    el(
      'div',
      { class: 'metricas mb-4' },
      Array.from({ length: 4 }, () => el('div', { class: 'esqueleto esqueleto-metrica' })),
    ),
    el('div', { class: 'cartao' }, [linha('30%'), linha('90%'), linha('75%'), linha('85%')]),
  ]);
}

/**
 * Controles da tela no cabecalho, ao lado do titulo.
 *
 * Quem chama e a propria tela, depois de montar os controles. A troca de rota
 * limpa sozinha.
 */
/**
 * Busca rapida da barra global.
 *
 * Procura conversa por nome ou numero e leva direto para ela. Existe porque a
 * alternativa era abrir Conversas, achar o filtro e digitar la: tres passos
 * para uma coisa que se faz dezenas de vezes por dia, sempre que um cliente
 * liga perguntando do processo.
 *
 * O atalho e Ctrl+K, ou Cmd+K no Mac.
 */
function buscaGlobal() {
  const campo = el('input', {
    type: 'search',
    class: 'busca-campo',
    placeholder: 'Buscar conversa ou número',
    'aria-label': 'Buscar conversa ou número',
    autocomplete: 'off',
  });

  const lista = el('div', { class: 'busca-resultados', hidden: true });
  const caixa = el('div', { class: 'busca-global' }, [
    icone('lupa', 15),
    campo,
    el('kbd', { class: 'busca-atalho', texto: atalhoDaBusca() }),
    lista,
  ]);

  const fechar = () => {
    lista.setAttribute('hidden', '');
    limpar(lista);
  };

  const abrir = (contatos) => {
    limpar(lista);
    if (!contatos.length) {
      lista.append(el('div', { class: 'busca-vazio', texto: 'Nenhuma conversa com esse nome ou número' }));
    } else {
      for (const contato of contatos) {
        const item = el('button', { type: 'button', class: 'busca-item' }, [
          el('strong', { texto: contato.nome || 'Sem nome' }),
          el('span', { texto: contato.telefone || '' }),
        ]);
        /* mousedown e nao click: o blur do campo dispara antes do click e
           fecharia a lista debaixo do dedo. */
        item.addEventListener('mousedown', (evento) => {
          evento.preventDefault();
          campo.value = '';
          fechar();
          location.hash = `#/atendimento/${contato.id}`;
        });
        lista.append(item);
      }
    }
    lista.removeAttribute('hidden');
  };

  /* Uma letra por vez viraria uma consulta por tecla. O intervalo espera a
     pessoa parar de digitar, e o contador descarta resposta atrasada que
     chegasse depois de uma busca mais nova. */
  let relogio = null;
  let consulta = 0;
  campo.addEventListener('input', () => {
    clearTimeout(relogio);
    const termo = campo.value.trim();
    if (termo.length < 2) {
      fechar();
      return;
    }
    const minha = ++consulta;
    relogio = setTimeout(async () => {
      try {
        const resposta = await api.get('/api/contatos', { busca: termo, limite: 6 });
        if (minha !== consulta) return;
        abrir(resposta.itens || resposta.contatos || []);
      } catch {
        if (minha === consulta) fechar();
      }
    }, 250);
  });

  campo.addEventListener('keydown', (evento) => {
    if (evento.key === 'Escape') {
      campo.value = '';
      fechar();
      campo.blur();
    }
  });
  campo.addEventListener('blur', () => setTimeout(fechar, 120));

  document.addEventListener('keydown', (evento) => {
    if ((evento.ctrlKey || evento.metaKey) && evento.key.toLowerCase() === 'k') {
      evento.preventDefault();
      campo.focus();
      campo.select();
    }
  });

  return caixa;
}

/** Mac escreve o atalho com o simbolo de comando; o resto do mundo, com Ctrl. */
function atalhoDaBusca() {
  return /Mac|iPhone|iPad/.test(navigator.platform || navigator.userAgent) ? '⌘K' : 'Ctrl K';
}

function definirAcoesDoTopo(...nos) {
  if (!acoesTela) return;
  limpar(acoesTela);
  for (const no of nos.flat()) if (no) acoesTela.append(no);
}

/** A acao principal da tela, no canto da barra de cima. */
function definirPrincipalDoTopo(...nos) {
  if (!principalDoTopo) return;
  limpar(principalDoTopo);
  for (const no of nos.flat()) if (no) principalDoTopo.append(no);
}

async function desenharRota() {
  const partes = partesDaRota();
  const nome = PAGINAS[partes[0]] ? partes[0] : ROTA_PADRAO;
  const pagina = PAGINAS[nome];

  marcarRotaAtiva(nome);
  esconderDica();

  tituloTela.textContent = pagina.titulo;
  subtituloTela.textContent = pagina.subtitulo || '';
  /* Tela de trabalho nao tem cabeca: a barra de cima e a propria tela ja
     dizem onde se esta, e a altura vai para o conteudo. */
  cabecaTela.hidden = Boolean(pagina.semCabeca);
  /* Cada tela repovoa as proprias acoes. Limpar aqui evita que o filtro ou o
     botao de uma fique no cabecalho da seguinte. */
  limpar(acoesTela);
  limpar(principalDoTopo);

  areaConteudo.className = pagina.cheia ? 'conteudo sem-respiro' : 'conteudo';
  limpar(areaConteudo);
  areaConteudo.append(esqueletoDe(nome));

  try {
    const conteudo = await pagina.montar({
      parametros: partes.slice(1),
      visualizacao: pagina.visualizacao,
      navegar: (r) => (location.hash = `#/${r}`),
      definirAcoes: definirAcoesDoTopo,
      definirPrincipal: definirPrincipalDoTopo,
    });
    limpar(areaConteudo);
    areaConteudo.append(conteudo);
  } catch (erro) {
    limpar(areaConteudo);
    areaConteudo.append(
      el('div', { class: 'vazio' }, [el('strong', { texto: 'Não consegui abrir esta tela' }), el('div', { texto: erro.message })]),
    );
    if (erro.codigo === 401) telaEntrada('Sua sessao expirou. Entre de novo.');
  }
}

/* ------------------------------------------------------------------ */

async function iniciarApp() {
  await carregarSessao();
  await carregarBasico();
  await carregarNotificacoes();
  montarEstrutura();
  conectarEventos();
  /* Funcoes com nome: iniciarApp roda de novo ao trocar de escritorio, e o
     mesmo ouvinte registrado outra vez nao duplica. */
  for (const evento of ['contato', 'contatos', 'mensagem']) ouvir(evento, atualizarContadoresDaBarra);
  ouvir('porConexao', aoContarPorNumero);
  ouvir('numero', aoMudarNumero);
  window.addEventListener('hashchange', desenharRota);
  await desenharRota();
}

(async () => {
  try {
    await iniciarApp();
  } catch (erro) {
    if (erro.codigo === 401) telaEntrada();
    else {
      limpar(raiz);
      raiz.append(el('div', { class: 'carregando', texto: `Nao consegui falar com o servidor: ${erro.message}` }));
    }
  }
})();

window.addEventListener('unhandledrejection', (evento) => {
  if (evento.reason?.codigo === 401) {
    telaEntrada('Sua sessao expirou. Entre de novo.');
    evento.preventDefault();
  } else if (evento.reason?.message) {
    aviso(evento.reason.message, 'erro');
  }
});
