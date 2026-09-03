import { api } from './api.js';
import {
  carregarBasico,
  carregarNotificacoes,
  carregarSessao,
  conectarEventos,
  definirTema,
  estado,
  ouvir,
  tema,
} from './estado.js';
import { avatar, aviso, botao, campo, el, entradaTexto, icone, limpar, modal, selecao, selo } from './ui.js';

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
import { paginaPosVenda } from './paginas/posvenda.js';
import { paginaAgendamentos } from './paginas/agendamentos.js';
import { paginaTarefas } from './paginas/tarefas.js';
import { paginaConexoes } from './paginas/conexoes.js';
import { paginaConfiguracoes } from './paginas/configuracoes.js';
import { paginaSimulador } from './paginas/simulador.js';

const raiz = document.getElementById('raiz');

/**
 * Conversas, Contatos e Kanban sao a mesma tela vista de tres jeitos, entao as
 * tres rotas apontam para paginaAtendimento e so mudam o campo visualizacao.
 * Duplicar a tela seria duplicar filtro, acao em massa e painel da conversa.
 */
const PAGINAS = {
  inicio: { titulo: 'Inicio', montar: paginaInicio },
  dashboard: { titulo: 'Dashboard', montar: paginaDashboard },
  /* Tela separada, e nao uma aba dentro do dashboard: as duas respondem
     perguntas diferentes (quantos fecharam / o que esta parado), tem filtros
     diferentes e quem abre uma raramente quer a outra no mesmo minuto. */
  posvenda: { titulo: 'Pos-venda', montar: paginaPosVenda },
  conexoes: { titulo: 'Conexoes de WhatsApp', montar: paginaConexoes },

  atendimento: { titulo: 'Conversas', montar: paginaAtendimento, cheia: true, visualizacao: 'conversas' },
  contatos: { titulo: 'Contatos', montar: paginaAtendimento, cheia: true, visualizacao: 'contatos' },
  kanban: { titulo: 'Kanban', montar: paginaAtendimento, cheia: true, visualizacao: 'kanban' },

  agentes: { titulo: 'Agentes de IA', montar: paginaAgentes, cheia: true },
  conhecimento: { titulo: 'Base de conhecimento', montar: paginaConhecimento },
  templates: { titulo: 'Templates', montar: paginaTemplates },
  vozes: { titulo: 'Vozes', montar: paginaVozes },
  integracoes: { titulo: 'Integracoes', montar: paginaIntegracoes },

  tarefas: { titulo: 'Tarefas', montar: paginaTarefas },
  agendamentos: { titulo: 'Central de agendamentos', montar: paginaAgendamentos },
  simulador: { titulo: 'Simulador de WhatsApp', montar: paginaSimulador },
  configuracoes: { titulo: 'Configuracoes', montar: paginaConfiguracoes },
};

/**
 * Barra lateral.
 *
 * Item solto tem rota. Item com a lista itens e um grupo que abre e fecha, e o
 * cabecalho dele nao navega para lugar nenhum.
 *
 * O icone do item de dentro so aparece na barra estreita de 64px, onde o rotulo
 * some e sem desenho a linha ficaria em branco. Com a barra larga, o recuo e a
 * linha guia ja mostram a hierarquia, entao o icone ali seria so ruido.
 */
const MENU = [
  { rota: 'inicio', rotulo: 'Inicio', icone: 'inicio' },
  /* As duas telas de metrica ficam juntas e no mesmo nivel. Pos-venda dentro de
     Dashboard esconderia a segunda atras de um clique, e ela e a que o juridico
     abre todo dia; Dashboard e a que o comercial abre. Nenhuma e submenu da
     outra. */
  { rota: 'dashboard', rotulo: 'Dashboard', icone: 'painel' },
  { rota: 'posvenda', rotulo: 'Pos-venda', icone: 'contrato' },
  { rota: 'conexoes', rotulo: 'Conexoes', icone: 'conexoes' },
  {
    rotulo: 'Atendimento',
    icone: 'conversas',
    itens: [
      { rota: 'atendimento', rotulo: 'Conversas', icone: 'atendimento' },
      { rota: 'contatos', rotulo: 'Contatos', icone: 'usuarios' },
      { rota: 'kanban', rotulo: 'Kanban', icone: 'filtros' },
    ],
  },
  {
    rotulo: 'Automacoes',
    icone: 'raio',
    itens: [
      { rota: 'agentes', rotulo: 'Agentes', icone: 'agentes' },
      { rota: 'conhecimento', rotulo: 'Base de conhecimento', icone: 'pasta' },
      { rota: 'templates', rotulo: 'Templates', icone: 'templates' },
      { rota: 'vozes', rotulo: 'Vozes', icone: 'pessoa' },
      { rota: 'integracoes', rotulo: 'Integracoes', icone: 'abrir' },
    ],
  },
  { rota: 'tarefas', rotulo: 'Tarefas', icone: 'ok' },
  { rota: 'agendamentos', rotulo: 'Agendamentos', icone: 'agenda' },
  { rota: 'simulador', rotulo: 'Simulador', icone: 'simulador' },
  { rota: 'configuracoes', rotulo: 'Configuracoes', icone: 'ajustes' },
];

const CHAVE_MENU = 'correiatendimentos:menu-aberto';

/* O mesmo ponto de quebra da barra estreita em css/tema.css. Abaixo dele a
   lateral vira uma faixa de 64px e o rotulo do item some. */
const BARRA_ESTREITA = window.matchMedia('(max-width: 860px)');

function chaveDoGrupo(grupo) {
  return grupo.rotulo.toLowerCase().replace(/[^a-z0-9]+/g, '-');
}

function grupoDaRota(rota) {
  return MENU.find((item) => item.itens && item.itens.some((filho) => filho.rota === rota)) || null;
}

function gruposAbertos() {
  const guardado = localStorage.getItem(CHAVE_MENU);
  // Nada guardado e primeiro acesso: os grupos comecam abertos, senao metade
  // das telas nasce escondida atras de um clique que ninguem sabe que existe.
  // Depois que a pessoa abre ou fecha um grupo, vale so o que ela deixou.
  if (guardado === null) return new Set(MENU.filter((item) => item.itens).map(chaveDoGrupo));
  try {
    const lista = JSON.parse(guardado);
    return new Set(Array.isArray(lista) ? lista : []);
  } catch {
    return new Set();
  }
}

function guardarGruposAbertos(conjunto) {
  localStorage.setItem(CHAVE_MENU, JSON.stringify([...conjunto]));
}

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
/* Barra lateral                                                       */
/* ------------------------------------------------------------------ */

let menuNo = null;

/** Cabecalho e lista de cada grupo, para abrir sem redesenhar o menu. */
const controlesDeGrupo = new Map();

/**
 * Abrir e fechar e so estado: o aria-expanded do cabecalho e o hidden da lista.
 * O desenho (realce, foco, recuo, fio guia e o giro da seta) esta todo em
 * css/tema.css, nas classes menu-grupo-botao, menu-grupo-itens e
 * menu-grupo-seta. Estilo inline aqui deixava aquele CSS morto e ainda fazia o
 * item de dentro do grupo desenhar no tamanho do item solto.
 */
function aplicarGrupo(chave, aberto) {
  const controle = controlesDeGrupo.get(chave);
  if (!controle) return;
  controle.cabecalho.setAttribute('aria-expanded', aberto ? 'true' : 'false');
  controle.lista.hidden = !aberto;
}

function itemDoMenu(item, dentroDeGrupo, estreita) {
  return el(
    'a',
    {
      href: `#/${item.rota}`,
      dataset: { rota: item.rota },
      title: estreita ? item.rotulo : null,
    },
    [!dentroDeGrupo || estreita ? icone(item.icone) : null, el('span', { texto: item.rotulo })],
  );
}

function montarGrupo(grupo, abertos, estreita) {
  const chave = chaveDoGrupo(grupo);

  // Na faixa de 64px nao ha rotulo para clicar nem espaco para a seta, entao o
  // grupo vira uma secao separada por um fio e os itens ficam sempre a vista.
  // Um grupo fechado ali esconderia rotas sem deixar nenhum jeito de abrir.
  if (estreita) {
    const faixa = el('div', {
      role: 'group',
      'aria-label': grupo.rotulo,
      class: 'menu-faixa',
    });
    for (const item of grupo.itens) faixa.append(itemDoMenu(item, true, estreita));
    return faixa;
  }

  const aberto = abertos.has(chave);
  const idCabecalho = `menu-grupo-${chave}`;
  const idLista = `menu-itens-${chave}`;

  // 16px porque e o tamanho que .menu-grupo-botao svg aplica: passar outro aqui
  // so criaria diferenca entre o que o codigo diz e o que a tela desenha.
  const seta = icone('voltar', 16);
  seta.setAttribute('class', 'menu-grupo-seta');

  const cabecalho = el(
    'button',
    {
      type: 'button',
      class: 'menu-grupo-botao',
      id: idCabecalho,
      'aria-expanded': aberto ? 'true' : 'false',
      'aria-controls': idLista,
    },
    [icone(grupo.icone), el('span', { texto: grupo.rotulo }), seta],
  );

  // A linha guia sai debaixo do icone do cabecalho e desce por todos os itens:
  // e ela que diz onde o grupo comeca e onde termina, sem precisar de moldura.
  const lista = el('div', {
    class: 'menu-grupo-itens',
    id: idLista,
    role: 'group',
    'aria-labelledby': idCabecalho,
  });
  for (const item of grupo.itens) lista.append(itemDoMenu(item, true, estreita));

  cabecalho.addEventListener('click', () => {
    const abertosAgora = gruposAbertos();
    const abrindo = !abertosAgora.has(chave);
    if (abrindo) abertosAgora.add(chave);
    else abertosAgora.delete(chave);
    guardarGruposAbertos(abertosAgora);
    aplicarGrupo(chave, abrindo);
  });

  controlesDeGrupo.set(chave, { cabecalho, lista });
  aplicarGrupo(chave, aberto);

  return el('div', {}, [cabecalho, lista]);
}

function marcarRotaAtiva(rota) {
  for (const link of document.querySelectorAll('.menu a')) {
    link.classList.toggle('ativo', link.dataset.rota === rota);
  }
}

/** Entrar por link direto ou pelo sino nao pode cair num grupo fechado. */
function abrirGrupoDaRota(rota) {
  const grupo = grupoDaRota(rota);
  if (!grupo) return;
  const chave = chaveDoGrupo(grupo);
  const abertos = gruposAbertos();
  if (abertos.has(chave)) return;
  abertos.add(chave);
  guardarGruposAbertos(abertos);
  aplicarGrupo(chave, true);
}

function montarMenu() {
  if (!menuNo) return;
  limpar(menuNo);
  controlesDeGrupo.clear();

  const abertos = gruposAbertos();
  const estreita = BARRA_ESTREITA.matches;

  // Configuracoes fica para todo mundo. Escondendo o item, o papel Suporte
  // perdia junto Minha conta, Seguranca e Aparencia, que sao secoes de perfil:
  // quem recebeu senha inicial do administrador nao tinha por onde troca-la. O
  // que o papel alcanca e filtrado dentro da tela, em paginas/configuracoes.js.
  for (const item of MENU) {
    if (item.itens) {
      menuNo.append(montarGrupo(item, abertos, estreita));
      continue;
    }
    menuNo.append(itemDoMenu(item, false, estreita));
  }

  const rota = rotaAtual();
  abrirGrupoDaRota(rota);
  marcarRotaAtiva(rota);
}

/* Funcao com nome, e nao closure nova a cada montagem: addEventListener ignora
   o mesmo par de evento e funcao, entao trocar de workspace nao empilha
   ouvintes de midia que redesenham o menu varias vezes. */
function aoMudarAmbiente() {
  montarMenu();
}

/* ------------------------------------------------------------------ */
/* Estrutura do aplicativo                                             */
/* ------------------------------------------------------------------ */

let areaConteudo = null;
let tituloTopo = null;
let subtituloTopo = null;
let acoesTopo = null;

function montarEstrutura() {
  limpar(raiz);
  const escolhido = tema();
  if (escolhido) document.documentElement.dataset.tema = escolhido;

  const usuario = estado.sessao.usuario;

  const seletorWorkspace =
    estado.sessao.workspaces.length > 1
      ? seletorDeVarios()
      : el('div', { class: 'seletor-workspace unico' }, [
          icone('pasta', 15),
          el('span', { texto: estado.sessao.workspace?.nome || 'Escritorio' }),
        ]);

  function seletorDeVarios() {
    return estado.sessao.workspaces.length > 1
      ? el('div', { class: 'seletor-workspace' }, [
          selecao(
            estado.sessao.workspaces.map((w) => ({ valor: w.id, rotulo: w.nome })),
            estado.sessao.workspace.id,
            {
              aoChange: async (evento) => {
                await api.post('/api/sessao/workspace', { workspaceId: evento.target.value });
                await iniciarApp();
              },
            },
          ),
        ])
      : null;
  }

  menuNo = el('nav', { class: 'menu', 'aria-label': 'Areas do sistema' });

  const sino = botao('', { icone: 'sino', titulo: 'Notificacoes', aoClicar: abrirNotificacoes });
  const contadorSino = el('span', { class: 'nao-lidas', estilo: { display: 'none' } });
  const caixaSino = el('div', { class: 'linha-p caixa-sino' }, [sino, contadorSino]);

  const atualizarSino = () => {
    const naoLidas = estado.notificacoes.filter((n) => !n.lida).length;
    contadorSino.textContent = naoLidas > 99 ? '99+' : String(naoLidas);
    contadorSino.style.display = naoLidas ? 'grid' : 'none';
  };
  ouvir('notificacoes', atualizarSino);

  tituloTopo = el('h1', { texto: '' });
  subtituloTopo = el('div', { class: 'subtitulo', texto: '' });
  /* Faixa de controles da propria tela, na mesma linha do titulo. Filtro que
     vale para a tela inteira pertence ao cabeco dela, e nao a um cartao dentro
     do conteudo: dentro do conteudo ele empurra o primeiro dado para baixo e
     rola junto com a pagina, sumindo justo quando se quer trocar o recorte. */
  acoesTopo = el('div', { class: 'topo-acoes' });
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

  raiz.append(
    el('div', { class: 'app' }, [
      /* Barra global: identidade, escritorio e as acoes que valem para o
         sistema inteiro. Ela atravessa a largura toda, por cima da lateral,
         porque nada dela pertence a uma tela especifica. */
      el('header', { class: 'barra-global' }, [
        el('div', { class: 'marca' }, [
          el('img', { src: 'assets/logo.png', alt: '' }),
          el('div', { class: 'marca-texto' }, [
            el('strong', { texto: 'CorreiaAtilhus2.0' }),
            el('span', { texto: 'Correia Advogados Associados' }),
          ]),
        ]),
        seletorWorkspace,
        el('div', { class: 'espaco' }),
        buscaGlobal(),
        alternarTema,
        caixaSino,
        el('div', { class: 'quem-topo' }, [
          avatar(usuario),
          el('div', { class: 'quem' }, [
            el('strong', { texto: usuario.nome }),
            el('span', { texto: estado.sessao.papeis[estado.sessao.papel]?.nome || estado.sessao.papel }),
          ]),
          botao('', {
            icone: 'sair',
            titulo: 'Sair do sistema',
            pequeno: true,
            aoClicar: async () => {
              await api.post('/api/sessao/sair');
              telaEntrada();
            },
          }),
        ]),
      ]),
      el('div', { class: 'corpo' }, [
        el('aside', { class: 'lateral' }, [menuNo]),
        el('div', { class: 'principal' }, [
          el('header', { class: 'topo' }, [
            el('div', { class: 'topo-identidade' }, [tituloTopo, subtituloTopo]),
            acoesTopo,
            el('div', { class: 'espaco' }),
          ]),
          areaConteudo,
        ]),
      ]),
    ]),
  );

  montarMenu();
  BARRA_ESTREITA.addEventListener('change', aoMudarAmbiente);

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
    lista.append(
      el('div', { class: notificacao.lida ? 'lista-item lida' : 'lista-item' }, [
        el('div', { class: 'corpo' }, [
          el('div', { class: 'titulo', texto: notificacao.titulo }),
          el('div', { class: 'desc', texto: notificacao.texto || '' }),
        ]),
        notificacao.lida ? selo('lida', '') : null,
        notificacao.contatoId
          ? botao('Abrir', {
              pequeno: true,
              aoClicar: () => {
                location.hash = `#/atendimento/${notificacao.contatoId}`;
                document.querySelector('.cortina')?.remove();
              },
            })
          : null,
      ]),
    );
  }

  modal({
    titulo: 'Notificacoes',
    corpo: lista,
    confirmar: 'Marcar todas como lidas',
    aoConfirmar: async () => {
      await api.post('/api/notificacoes/ler', {});
      await carregarNotificacoes();
    },
  });
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

function definirSubtitulo(texto) {
  if (subtituloTopo) subtituloTopo.textContent = texto || '';
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
    placeholder: 'Buscar conversa ou numero',
    'aria-label': 'Buscar conversa ou numero',
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
      lista.append(el('div', { class: 'busca-vazio', texto: 'Nenhuma conversa com esse nome ou numero' }));
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
  if (!acoesTopo) return;
  limpar(acoesTopo);
  for (const no of nos.flat()) if (no) acoesTopo.append(no);
}

async function desenharRota() {
  const partes = partesDaRota();
  const nome = PAGINAS[partes[0]] ? partes[0] : ROTA_PADRAO;
  const pagina = PAGINAS[nome];

  abrirGrupoDaRota(nome);
  marcarRotaAtiva(nome);

  // O topo mostra o caminho: o titulo e a tela, o subtitulo e o grupo em que
  // ela mora. Quem chegou por link direto ve de onde a tela veio.
  const grupo = grupoDaRota(nome);
  tituloTopo.textContent = pagina.titulo;
  definirSubtitulo(grupo ? grupo.rotulo : '');
  /* Cada tela repovoa as proprias acoes. Limpar aqui evita que o filtro de uma
     fique no cabecalho da seguinte. */
  limpar(acoesTopo);

  areaConteudo.className = pagina.cheia ? 'conteudo sem-respiro' : 'conteudo';
  limpar(areaConteudo);
  areaConteudo.append(esqueletoDe(nome));

  try {
    const conteudo = await pagina.montar({
      parametros: partes.slice(1),
      visualizacao: pagina.visualizacao,
      navegar: (r) => (location.hash = `#/${r}`),
      definirAcoes: definirAcoesDoTopo,
    });
    limpar(areaConteudo);
    areaConteudo.append(conteudo);
  } catch (erro) {
    limpar(areaConteudo);
    areaConteudo.append(
      el('div', { class: 'vazio' }, [el('strong', { texto: 'Nao consegui abrir esta tela' }), el('div', { texto: erro.message })]),
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
