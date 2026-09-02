import { api, enviarArquivo } from '../api.js';
import { campoComDica, cartaoComDica, dica, seletorDeCor, seletorPeriodo } from '../componentes.js';
import { carregarSessao, definirTema, estado, podeConfigurar, recarregar } from '../estado.js';
import {
  avatar,
  aviso,
  botao,
  campo,
  cartao,
  confirmar,
  dataHora,
  duracao,
  el,
  entradaTexto,
  icone,
  limpar,
  modal,
  numero,
  plural,
  selecao,
  selo,
  telefone,
  vazio,
} from '../ui.js';

/**
 * Configuracoes em duas colunas.
 *
 * A esquerda um indice com o que existe, a direita uma secao por vez. Tela de
 * ajuste nao se le de cima a baixo, se procura: com tudo numa pagina so, quem
 * volta para mexer em um campo perde o lugar toda vez.
 *
 * Cada secao tem rota propria em #/configuracoes/<id>, entao o endereco pode
 * ser guardado, mandado para um colega e sobrevive a um F5.
 */

/* A mesma chave que estado.js usa. Ela aparece aqui porque "seguir o sistema"
   e o unico caso em que a escolha some do localStorage, e estado.js so sabe
   gravar. */
const CHAVE_TEMA = 'correiatendimentos:tema';

/* Cor de estreia do status e do item de catalogo: o degrau da rampa que
   corresponde ao ouro da marca. Token de tema, e nao hexadecimal, para o item
   nascer legivel nos dois temas. O seletor de amostras resolve o resto. */
const COR_NOVA = 'var(--serie-2)';

const GRUPOS = [
  {
    rotulo: 'Perfil',
    itens: [
      {
        id: 'minha-conta',
        rotulo: 'Minha conta',
        descricao: 'Como voce aparece para o resto da equipe. E-mail e permissao mudam so em Membros, que ja cobra acesso de administrador.',
        montar: secaoMinhaConta,
      },
      {
        id: 'seguranca',
        rotulo: 'Seguranca',
        descricao: 'Troca de senha e aparelhos conectados nesta conta.',
        montar: secaoSeguranca,
      },
    ],
  },
  {
    rotulo: 'Escritorio',
    itens: [
      {
        id: 'escritorio',
        rotulo: 'Dados do escritorio',
        descricao: 'Os agentes consultam estes campos quando o lead pergunta endereco, OAB ou telefone. Campo em branco eles nao usam, e nao inventam.',
        montar: secaoEscritorio,
      },
      {
        id: 'status',
        rotulo: 'Status e follow-up',
        descricao:
          'O status e o gatilho de tudo: ele arrasta o departamento, dispara o follow-up e alimenta o dashboard. O tipo do status existe so para o dashboard entender o funil. Sem esse encaixe, os cards nao fecham conta.',
        montar: secaoStatus,
      },
      {
        id: 'classes',
        rotulo: 'Classes',
        descricao: 'As listas que o resto do sistema usa para classificar conversa: departamento, etiqueta, origem e variavel.',
        montar: secaoClasses,
      },
      {
        id: 'membros',
        rotulo: 'Membros',
        descricao: 'Quem entra no workspace, com que permissao e ate onde enxerga.',
        montar: secaoMembros,
      },
      {
        id: 'horario',
        rotulo: 'Horario comercial',
        descricao:
          'Limita uma coisa so: o follow-up. Dentro da janela ele sai na hora prevista; fora dela, e adiado para o proximo dia util em um minuto sorteado, para a fila nao disparar toda junta na abertura. Mensagem agendada a mao ignora o horario comercial.',
        montar: secaoHorario,
      },
      {
        id: 'api',
        rotulo: 'Chaves de API',
        descricao: 'Para ligar o sistema do escritorio, o site ou uma automacao no que acontece aqui dentro.',
        montar: secaoApi,
      },
    ],
  },
  {
    rotulo: 'Sistema',
    itens: [
      {
        id: 'aparencia',
        rotulo: 'Aparencia',
        descricao:
          'Vale so neste navegador, muda na hora e nao altera nada para o resto da equipe. O mesmo interruptor esta no alto da tela, ao lado do sino, para a troca rapida do dia a dia.',
        montar: secaoAparencia,
      },
      {
        id: 'consumo',
        rotulo: 'Consumo',
        descricao: 'Cada acao de IA consome creditos. A conta mostra qual etapa do funil esta cara demais.',
        montar: secaoConsumo,
      },
    ],
  },
];

/**
 * Vozes e Integracoes ganharam tela propria no menu de Automacoes. As secoes
 * daqui eram copias das duas, sem nenhum teste de permissao, entao foram
 * apagadas: duas telas para a mesma coisa significa corrigir tudo duas vezes.
 *
 * A rota antiga continua valendo como atalho, so que agora ela leva para a
 * tela nova, e nao para uma copia velha. Link guardado ou colado num
 * procedimento nao morre, e o destino passa a ser um so.
 */
const REDIRECIONAMENTOS = {
  vozes: '#/vozes',
  integracoes: '#/integracoes',
};

/**
 * O que cada papel alcanca.
 *
 * Perfil e Sistema sao de quem esta usando o sistema: nome, senha, aparencia e
 * o consumo, que a rota /api/consumo ja recorta pelas conversas que a pessoa
 * pode abrir. Escritorio muda o que vale para a equipe inteira, entao e so de
 * quem pode configurar. Sem esse recorte, o papel Suporte abria Membros e
 * Chaves de API pelo indice, preenchia um formulario inteiro e so descobria a
 * falta de acesso no Salvar.
 */
const GRUPOS_LIVRES = ['Perfil', 'Sistema'];

function gruposVisiveis() {
  if (podeConfigurar()) return GRUPOS;
  return GRUPOS.filter((grupo) => GRUPOS_LIVRES.includes(grupo.rotulo));
}

const SECOES = GRUPOS.flatMap((grupo) => grupo.itens.map((item) => ({ ...item, grupo: grupo.rotulo })));

function secoesVisiveis() {
  return gruposVisiveis().flatMap((grupo) => grupo.itens.map((item) => ({ ...item, grupo: grupo.rotulo })));
}

function acharSecao(id) {
  return SECOES.find((secao) => secao.id === id) || null;
}

export async function paginaConfiguracoes({ parametros }) {
  const pedida = parametros[0];

  if (REDIRECIONAMENTOS[pedida]) {
    location.replace(REDIRECIONAMENTOS[pedida]);
    return el('div', { class: 'vazio', texto: 'Abrindo a tela nova…' });
  }

  const permitidas = secoesVisiveis();
  const alvo = acharSecao(pedida);

  // 403 de secao nao e falha de tela: quem abriu um link guardado de uma area
  // que o papel dele nao alcanca cai na primeira secao permitida com um aviso,
  // em vez de perder o indice, a migalha e o caminho de volta.
  const semAcesso = Boolean(alvo) && !permitidas.some((secao) => secao.id === alvo.id);
  let atual = semAcesso || !alvo ? permitidas[0] : alvo;
  let recadoDeAcesso = semAcesso ? `${alvo.rotulo} e uma area do escritorio, so o administrador ou o gerente abre.` : '';

  const indice = el('nav', { class: 'config-indice', 'aria-label': 'Areas das configuracoes' });
  const conteudo = el('div', { class: 'config-conteudo' });
  const layout = el('div', { class: 'config-layout' }, [indice, conteudo]);

  function desenharIndice() {
    limpar(indice);
    for (const grupo of gruposVisiveis()) {
      const bloco = el('div', {}, [el('div', { class: 'config-indice-grupo', texto: grupo.rotulo })]);
      for (const item of grupo.itens) {
        const ativo = item.id === atual.id;
        const link = el('a', {
          href: `#/configuracoes/${item.id}`,
          class: ativo ? 'ativo' : '',
          texto: item.rotulo,
          'aria-current': ativo ? 'page' : null,
        });
        // O href de verdade fica: e o que faz o clique do meio abrir noutra aba
        // e o que o navegador mostra na barra de status. So o clique simples e
        // interceptado, para trocar de secao sem remontar a tela inteira.
        link.addEventListener('click', (evento) => {
          if (evento.ctrlKey || evento.metaKey || evento.shiftKey || evento.altKey) return;
          evento.preventDefault();
          irPara(item.id);
        });
        bloco.append(link);
      }
      indice.append(bloco);
    }
  }

  async function desenharConteudo(primeiraVez = false) {
    limpar(conteudo);
    conteudo.append(migalha(atual), cabecalho(atual));

    if (recadoDeAcesso) {
      conteudo.append(el('div', { class: 'alerta-caixa mb-4', texto: recadoDeAcesso }));
      recadoDeAcesso = '';
    }

    try {
      conteudo.append(await atual.montar(() => desenharConteudo()));
    } catch (erro) {
      // Na primeira montagem o erro sobe: e o app.js que sabe distinguir sessao
      // expirada de falha de leitura. Depois disso a tela ja esta de pe e
      // derrubar tudo por causa de uma secao seria pior que mostrar o motivo.
      if (primeiraVez) throw erro;
      conteudo.append(vazio('Nao consegui abrir esta secao', erro.message));
    }
  }

  async function irPara(id) {
    if (id === atual.id) return;
    atual = secoesVisiveis().find((secao) => secao.id === id) || atual;
    // replaceState em vez de trocar o hash na mao: assim o F5 volta na mesma
    // secao sem encher o historico de um passo por clique no indice.
    history.replaceState(null, '', `#/configuracoes/${atual.id}`);
    desenharIndice();
    conteudo.scrollTop = 0;
    await desenharConteudo();
  }

  desenharIndice();
  await desenharConteudo(true);
  return layout;
}

/* ------------------------------------------------------------------ */
/* Pecas da tela                                                       */
/* ------------------------------------------------------------------ */

/**
 * Seta do caminho. E o icone de voltar girado, o mesmo recurso da paginacao.
 * O giro e sempre o mesmo, entao vira classe: .seta-adiante mora em
 * web/css/tema.css, ao lado das outras setas giradas.
 */
function setaDaMigalha() {
  const seta = icone('voltar', 12);
  seta.classList.add('seta-adiante');
  return seta;
}

function migalha(secao) {
  return el('nav', { class: 'config-migalha', 'aria-label': 'Caminho' }, [
    el('a', { href: '#/configuracoes', texto: 'Configuracoes' }),
    setaDaMigalha(),
    el('span', { texto: secao.grupo }),
    setaDaMigalha(),
    el('strong', { texto: secao.rotulo }),
  ]);
}

// .titulo-secao mora em web/css/tema.css, junto do bloco de Configuracoes: e o
// titulo da secao aberta, o unico t-xl da tela.
//
// A descricao da secao virou dica ao lado do titulo. Ela responde "o que e esta
// area", pergunta que se faz na primeira visita e nunca mais, e como paragrafo
// empurrava o primeiro ajuste para baixo em toda abertura de toda secao.
function cabecalho(secao) {
  return el('header', { class: 'mb-4' }, [
    el('h2', { class: 'titulo-secao' }, [
      secao.rotulo,
      secao.descricao ? dica(secao.descricao, { largura: 360, assunto: secao.rotulo }) : null,
    ]),
  ]);
}

/** Bloco com titulo dentro de uma secao, para separar assuntos que se salvam
 *  em botoes diferentes. `ajuda` e paragrafo, entao so entra quando e aviso de
 *  estado ou dado que a pessoa vem buscar. */
function subsecao(titulo, ajuda, ...filhos) {
  return el('section', { class: 'mb-5' }, [
    titulo ? el('h3', { class: 'cartao-titulo', texto: titulo }) : null,
    ajuda ? el('p', { class: 'cartao-ajuda', texto: ajuda }) : null,
    ...filhos,
  ]);
}

/** Mesma subsecao, com a explicacao do assunto atras da dica do titulo. */
function subsecaoComDica(titulo, balao, ...filhos) {
  return el('section', { class: 'mb-5' }, [
    el('h3', { class: 'cartao-titulo' }, [titulo, dica(balao, { largura: 360, assunto: titulo })]),
    ...filhos,
  ]);
}

let contadorAjuste = 0;

/**
 * Linha de ajuste: a esquerda o nome e a explicacao, a direita o controle.
 *
 * O nome vira um <label> ligado ao campo sempre que houver um campo unico do
 * outro lado. Sem essa ligacao o leitor de tela anuncia so "caixa de texto", e
 * no mouse o clique sobre o nome deixa de levar o cursor ao campo.
 *
 * `ajuda` e o paragrafo que fica visivel embaixo do nome, e so cabe para regra
 * de preenchimento ("no minimo 8 caracteres") e aviso de estado ("sem
 * expediente"). `balao` e para o resto: o que o ajuste significa se le uma vez
 * e depois so empurra o proximo controle para baixo.
 */
function ajuste(rotulo, controle, ajuda, balao) {
  const alvo = controle.matches?.('input, select, textarea')
    ? controle
    : controle.querySelector?.('input, select, textarea');
  if (alvo && !alvo.id) alvo.id = `ajuste-${++contadorAjuste}`;

  const nome = el(alvo ? 'label' : 'span', {}, [rotulo]);
  if (alvo) nome.setAttribute('for', alvo.id);

  // A dica fica fora do <label>, e nao dentro: o nome acessivel do campo e
  // montado com o texto inteiro do rotulo, e o botao entraria nele, com o
  // leitor de tela anunciando "Nome Ajuda sobre Nome". `assunto` existe
  // justamente para o balao ser anunciado pelo ajuste de que ele fala, no lugar
  // de "Ajuda" repetido linha apos linha. .ajuste-rotulo ja e uma linha flex,
  // entao o icone encosta no nome com o respiro do tema, sem regra nova.
  const cabeca = el('div', { class: 'ajuste-rotulo' }, [
    nome,
    balao ? dica(balao, { largura: 360, assunto: rotulo }) : null,
  ]);

  return el('div', { class: 'ajuste-linha' }, [
    el('div', {}, [cabeca, ajuda ? el('p', { class: 'ajuste-ajuda', texto: ajuda }) : null]),
    el('div', { class: 'ajuste-controle' }, [controle]),
  ]);
}

function ajustes(...filhos) {
  return el('div', { class: 'ajustes-cartao' }, filhos);
}

function rodapeAjustes(...filhos) {
  return el('div', { class: 'ajustes-rodape' }, filhos);
}

/** Controle composto, para quando a direita da linha leva mais de um campo. */
function grupoControles(...filhos) {
  return el('div', { class: 'linha quebra' }, filhos);
}

function marcador(marcado) {
  const caixa = el('input', { type: 'checkbox' });
  caixa.checked = Boolean(marcado);
  return caixa;
}

/* ------------------------------------------------------------------ */
/* Minha conta                                                         */
/* ------------------------------------------------------------------ */

async function secaoMinhaConta(recarregarTela) {
  const usuario = estado.sessao.usuario;
  let foto = usuario.foto || null;

  const nome = entradaTexto(usuario.nome || '');
  const whatsapp = entradaTexto(telefone(usuario.whatsapp) || usuario.whatsapp || '', { placeholder: '55 11 91234-5678' });

  /* Foto ------------------------------------------------------------- */
  // .fixo mora em web/css/tema.css, junto das utilitarias de arranjo.
  const previa = el('div', { class: 'fixo' });
  // A previa usa o mesmo avatar() do resto do sistema, entao o que aparece aqui
  // e exatamente o que a equipe vai ver na lateral, em Membros e na conversa.
  const desenharPrevia = () => {
    limpar(previa);
    previa.append(avatar({ nome: usuario.nome, foto }, 44));
  };
  desenharPrevia();

  const seletorFoto = el('input', { type: 'file', accept: 'image/*', 'aria-label': 'Escolher foto do perfil' });
  seletorFoto.addEventListener('change', async () => {
    const arquivo = seletorFoto.files[0];
    if (!arquivo) return;
    try {
      const midia = await enviarArquivo(arquivo);
      foto = midia.url;
      desenharPrevia();
      desenharRemover();
      aviso('Foto escolhida. Salve para valer.', 'sucesso');
    } catch (erro) {
      aviso(erro.message, 'erro');
    }
    seletorFoto.value = '';
  });

  const areaRemover = el('div');
  const desenharRemover = () => {
    limpar(areaRemover);
    if (!foto) return;
    areaRemover.append(
      botao('Tirar a foto', {
        pequeno: true,
        tipo: 'perigo',
        aoClicar: () => {
          foto = null;
          desenharPrevia();
          desenharRemover();
        },
      }),
    );
  };
  desenharRemover();

  const controleFoto = el('div', { class: 'linha quebra' }, [
    previa,
    el('div', { class: 'pilha encolhe' }, [seletorFoto, areaRemover]),
  ]);

  /* E-mail ----------------------------------------------------------- */
  // .campo-travado mora em web/css/tema.css, junto dos campos: e o campo que
  // esta na tela so para ser lido e copiado.
  const email = entradaTexto(usuario.email || '', { type: 'email', readonly: true, class: 'campo-travado' });
  const copiarEmail = botao('', { icone: 'copiar', pequeno: true, titulo: 'Copiar o e-mail' });
  copiarEmail.setAttribute('aria-label', 'Copiar o e-mail');
  copiarEmail.addEventListener('click', async () => {
    try {
      await navigator.clipboard.writeText(usuario.email || '');
      aviso('E-mail copiado.', 'sucesso');
    } catch {
      aviso('Nao consegui copiar. Selecione o texto e copie a mao.', 'erro');
    }
  });
  const controleEmail = el('div', { class: 'linha' }, [el('div', { class: 'flexivel encolhe' }, [email]), copiarEmail]);

  const salvar = botao('Salvar', {
    tipo: 'principal',
    aoClicar: async () => {
      if (!nome.value.trim()) {
        aviso('Informe seu nome.', 'erro');
        return;
      }
      salvar.disabled = true;
      try {
        await api.patch('/api/perfil', { nome: nome.value.trim(), foto, whatsapp: whatsapp.value.trim() });
        await carregarSessao();
        aviso('Perfil salvo.', 'sucesso');
        await recarregarTela();
      } catch (erro) {
        aviso(erro.message, 'erro');
      } finally {
        salvar.disabled = false;
      }
    },
  });

  return el('div', {}, [
    ajustes(
      // Nenhuma das quatro e regra de preenchimento nem aviso de estado: todas
      // dizem onde aquele dado aparece depois. Vao no balao.
      ajuste('Nome', nome, null, 'E o nome que a equipe ve na conversa, na tarefa e na mencao de nota interna.'),
      ajuste('Foto', controleFoto, null, 'Aparece no lugar das iniciais. Imagem quadrada fica melhor no circulo.'),
      ajuste('WhatsApp', whatsapp, null, 'Usado para aviso interno. Nao e o numero que atende o cliente, esse fica em Conexoes.'),
      ajuste('E-mail', controleEmail, null, 'E com ele que voce entra no sistema, entao so muda em Membros.'),
      rodapeAjustes(salvar),
    ),
  ]);
}

/* ------------------------------------------------------------------ */
/* Seguranca                                                           */
/* ------------------------------------------------------------------ */

async function secaoSeguranca(recarregarTela) {
  const senhaAtual = entradaTexto('', { type: 'password', autocomplete: 'current-password' });
  const senhaNova = entradaTexto('', { type: 'password', autocomplete: 'new-password' });
  const confirmacao = entradaTexto('', { type: 'password', autocomplete: 'new-password' });

  const trocar = botao('Trocar a senha', {
    tipo: 'principal',
    aoClicar: async () => {
      // As tres conferencias sao feitas aqui antes de sair da tela porque o
      // servidor nao tem como saber o que a pessoa digitou na confirmacao, e
      // esperar a resposta para descobrir erro de digitacao e tempo perdido.
      if (!senhaAtual.value) {
        aviso('Informe a senha atual.', 'erro');
        return;
      }
      if (senhaNova.value.length < 8) {
        aviso('A senha nova precisa ter no minimo 8 caracteres.', 'erro');
        return;
      }
      if (senhaNova.value !== confirmacao.value) {
        aviso('A confirmacao nao confere com a senha nova.', 'erro');
        return;
      }

      trocar.disabled = true;
      try {
        const resultado = await api.post('/api/perfil/senha', {
          senhaAtual: senhaAtual.value,
          senhaNova: senhaNova.value,
        });
        aviso(
          resultado.sessoesEncerradas
            ? `Senha trocada. ${plural(resultado.sessoesEncerradas, 'outro acesso encerrado', 'outros acessos encerrados')}.`
            : 'Senha trocada.',
          'sucesso',
        );
        await recarregarTela();
      } catch (erro) {
        aviso(erro.message, 'erro');
      } finally {
        trocar.disabled = false;
      }
    },
  });

  const partes = [
    ajustes(
      // O porque da senha atual e conceito e vai no balao. "No minimo 8
      // caracteres" fica visivel: e a regra que o Salvar cobra.
      ajuste('Senha atual', senhaAtual, null, 'Sem ela, uma tela esquecida aberta vira conta tomada.'),
      ajuste('Senha nova', senhaNova, 'No minimo 8 caracteres.'),
      // "As duas precisam bater" era o rotulo escrito de novo com outras
      // palavras: quem le "Repita a senha nova" ja sabe. O erro de digitacao
      // continua avisado no Salvar, que e quando ele existe.
      ajuste('Repita a senha nova', confirmacao),
      rodapeAjustes(trocar),
    ),
  ];

  /* Sessoes ativas ---------------------------------------------------- */
  // O bloco so aparece se o servidor souber responder. A rota devolve quando
  // cada sessao nasceu e qual delas e a atual, nunca o token. Quem desconfia de
  // uma tela esquecida em casa ve o acesso na lista e sabe que trocar a senha
  // derruba os outros aparelhos, porque a troca encerra as demais sessoes.
  try {
    const dados = await api.get('/api/perfil/sessoes');
    const sessoes = Array.isArray(dados?.sessoes) ? dados.sessoes : [];
    const lista = el('div', { class: 'lista-simples' });

    if (sessoes.length) {
      for (const sessao of sessoes) {
        lista.append(
          el('div', { class: 'lista-item' }, [
            el('div', { class: 'corpo' }, [
              el('div', { class: 'titulo', texto: sessao.atual ? 'Este aparelho' : 'Outro aparelho' }),
              el('div', { class: 'desc', texto: sessao.criadaEm ? `Entrou em ${dataHora(sessao.criadaEm)}` : 'sem data de entrada' }),
            ]),
            sessao.atual ? selo('em uso agora', 'ouro') : null,
          ]),
        );
      }
    } else {
      lista.append(
        el('div', { class: 'lista-item' }, [
          el('div', { class: 'corpo' }, [
            el('div', { class: 'titulo', texto: 'Este aparelho' }),
            el('div', { class: 'desc', texto: 'E o unico que o servidor sabe confirmar. Os outros ele ainda nao lista.' }),
          ]),
          selo('em uso agora', 'ouro'),
        ]),
      );
    }

    partes.push(
      subsecao(
        'Aparelhos conectados',
        // O paragrafo so entra quando o servidor nao sabe listar os outros
        // acessos: isso e limitacao de estado, e a pessoa precisa saber. Com a
        // lista cheia nao ha o que explicar, cada linha ja se le sozinha.
        sessoes.length
          ? null
          : 'O sistema ainda nao lista os outros aparelhos, e trocar a senha ainda nao derruba os acessos que ja estao abertos. Em caso de suspeita, avise o administrador do escritorio.',
        cartao(null, null, lista),
      ),
    );
  } catch {
    /* Servidor sem a rota de sessoes: o bloco simplesmente nao entra. */
  }

  return el('div', {}, partes);
}

/* ------------------------------------------------------------------ */
/* Escritorio                                                          */
/* ------------------------------------------------------------------ */

async function secaoEscritorio(recarregarTela) {
  const workspace = estado.sessao.workspace;
  const empresa = workspace.empresa || {};

  const campos = {
    nomeEscritorio: entradaTexto(empresa.nomeEscritorio || ''),
    areaAtuacao: entradaTexto(empresa.areaAtuacao || ''),
    responsavel: entradaTexto(empresa.responsavel || ''),
    oab: entradaTexto(empresa.oab || ''),
    cnpj: entradaTexto(empresa.cnpj || ''),
    telefone: entradaTexto(empresa.telefone || ''),
    email: entradaTexto(empresa.email || ''),
    endereco: entradaTexto(empresa.endereco || ''),
    site: entradaTexto(empresa.site || ''),
    instagram: entradaTexto(empresa.instagram || ''),
    facebook: entradaTexto(empresa.facebook || ''),
  };

  const nomeWorkspace = entradaTexto(workspace.nome || '');

  return el('div', {}, [
    ajustes(
      // Sao doze campos numa tela so. Cada explicacao diz onde o dado vai parar
      // na conversa, que e conceito, entao todas vao para o balao do nome: como
      // paragrafo, seis delas empurravam o Salvar para bem abaixo da dobra.
      ajuste('Nome do escritorio', campos.nomeEscritorio, null, 'Como o agente se apresenta ao lead.'),
      ajuste('Area de atuacao', campos.areaAtuacao, null, 'Previdenciario, trabalhista, consumidor. Evita o agente prometer o que o escritorio nao faz.'),
      ajuste('Advogado responsavel', campos.responsavel),
      ajuste('OAB', campos.oab, null, 'Numero e seccional. E o que o lead pede quando quer conferir se o escritorio existe.'),
      ajuste('CNPJ', campos.cnpj),
      ajuste('Telefone', campos.telefone, null, 'O telefone de recado do escritorio, nao o numero que atende no WhatsApp.'),
      ajuste('E-mail', campos.email),
      ajuste('Endereco', campos.endereco, null, 'Rua, numero, bairro e cidade. Vai inteiro na resposta de quem pergunta onde fica.'),
      ajuste('Site', campos.site),
      ajuste('Instagram', campos.instagram),
      ajuste('Facebook', campos.facebook),
      ajuste('Nome do workspace', nomeWorkspace, null, 'So aparece dentro do sistema, para separar um escritorio do outro na troca de area.'),
      rodapeAjustes(
        podeConfigurar()
          ? botao('Salvar', {
              tipo: 'principal',
              aoClicar: async () => {
                const dados = {};
                for (const [chave, entrada] of Object.entries(campos)) dados[chave] = entrada.value.trim();
                await api.patch(`/api/workspaces/${workspace.id}`, { empresa: dados, nome: nomeWorkspace.value.trim() });
                await carregarSessao();
                aviso('Dados salvos.', 'sucesso');
                await recarregarTela();
              },
            })
          : null,
      ),
    ),
  ]);
}

/* ------------------------------------------------------------------ */
/* Status e follow-up                                                  */
/* ------------------------------------------------------------------ */

async function secaoStatus(recarregarTela) {
  const status = await recarregar('status');
  const tipos = estado.sessao.tiposStatus;

  const lista = el('div', { class: 'lista-simples' });
  for (const item of status) {
    const tipo = tipos.find((t) => t.id === item.tipo);
    lista.append(
      el('div', { class: 'lista-item' }, [
        // .ponto-g mora em web/css/tema.css, junto de .ponto. A cor continua
        // inline porque vem do banco.
        el('span', { class: 'ponto ponto-g', estilo: { background: item.cor } }),
        el('div', { class: 'corpo' }, [
          el('div', { class: 'titulo', texto: item.nome }),
          el('div', { class: 'desc', texto: item.descricao || 'sem descricao' }),
        ]),
        selo(tipo?.nome || 'sem tipo', item.tipo === 'nenhum' ? 'alerta' : ''),
        item.departamentoId
          ? selo(estado.departamentos.find((d) => d.id === item.departamentoId)?.nome || '-', '')
          : selo('limpa o departamento', 'alerta'),
        selo(plural((item.followups || []).length, 'follow-up', 'follow-ups'), (item.followups || []).length ? 'ouro' : ''),
        podeConfigurar() ? botao('Editar', { pequeno: true, aoClicar: () => editarStatus(item, recarregarTela) }) : null,
        podeConfigurar()
          ? botao('Excluir', {
              pequeno: true,
              tipo: 'perigo',
              aoClicar: () =>
                confirmar('Excluir status?', 'So e possivel se nenhuma conversa estiver nele.', async () => {
                  await api.delete(`/api/status/${item.id}`);
                  aviso('Status excluido.', 'sucesso');
                  await recarregarTela();
                }, 'Excluir'),
            })
          : null,
      ]),
    );
  }

  // A caixa que abria esta secao repetia palavra por palavra a descricao do
  // cabecalho, que agora esta na dica do titulo. A lista de status comeca aqui.
  return el('div', {}, [
    podeConfigurar()
      ? el('div', { class: 'linha-botoes mb-4' }, [
          botao('Novo status', { tipo: 'principal', icone: 'mais', aoClicar: () => editarStatus(null, recarregarTela) }),
        ])
      : null,
    cartao(null, null, lista),
  ]);
}

function editarStatus(status, recarregarTela) {
  const novo = !status;
  const nome = entradaTexto(status?.nome || '');
  const cor = seletorDeCor(status?.cor || COR_NOVA);
  const descricao = entradaTexto(status?.descricao || '');
  const tipo = selecao(
    estado.sessao.tiposStatus.map((t) => ({ valor: t.id, rotulo: t.nome })),
    status?.tipo || 'nenhum',
  );
  const departamento = selecao(
    [{ valor: '', rotulo: 'Nenhum (limpa o departamento da conversa)' }, ...estado.departamentos.map((d) => ({ valor: d.id, rotulo: d.nome }))],
    status?.departamentoId || '',
  );

  /* Editor da sequencia de follow-up --------------------------------- */
  const passos = [...(status?.followups || [])];
  const listaPassos = el('div', { class: 'lista-simples' });

  function desenharPassos() {
    limpar(listaPassos);
    if (!passos.length) {
      listaPassos.append(el('div', { class: 'vazio', texto: 'Nenhum follow-up neste status.' }));
    }
    passos.forEach((passo, indice) => {
      const template = selecao(
        estado.templates.map((t) => ({ valor: t.id, rotulo: t.nome })),
        passo.templateId,
        { aoChange: (evento) => (passo.templateId = evento.target.value) },
      );
      const minutos = entradaTexto(String(passo.minutos ?? 60), { type: 'number', min: '1' });
      minutos.addEventListener('change', () => (passo.minutos = Number(minutos.value)));

      const ultimo = indice === passos.length - 1;
      const desistir = marcador(passo.desistir?.ativo);
      const statusDesistencia = selecao(
        estado.status.filter((s) => s.id !== status?.id).map((s) => ({ valor: s.id, rotulo: s.nome })),
        passo.desistir?.statusId || '',
      );
      // O display fica inline porque e estado de tempo de execucao: o mesmo
      // valor e reescrito no atualizarDesistir logo abaixo.
      const blocoDesistir = el('div', { class: 'mt-2', estilo: { display: desistir.checked ? 'block' : 'none' } }, [
        campo('Status de desistencia', statusDesistencia, 'Precisa ser diferente do status atual.'),
      ]);
      const atualizarDesistir = () => {
        passo.desistir = desistir.checked
          ? { ativo: true, statusId: statusDesistencia.value, responsavel: null, arquivar: true }
          : null;
        blocoDesistir.style.display = desistir.checked ? 'block' : 'none';
      };
      desistir.addEventListener('change', atualizarDesistir);
      statusDesistencia.addEventListener('change', atualizarDesistir);

      listaPassos.append(
        // .lista-item.empilhado mora em web/css/tema.css, junto de .lista-item:
        // e o item que deixa de ser uma linha e vira um bloco com formulario.
        el('div', { class: 'lista-item empilhado' }, [
          el('div', { class: 'linha mb-2' }, [
            el('div', { class: 'avatar', texto: String(indice + 1) }),
            el('div', { class: 'flexivel' }, [el('div', { class: 'titulo', texto: `Follow-up ${indice + 1} · ${duracao(passo.minutos || 60)} depois da mudanca de status` })]),
            botao('Remover', {
              pequeno: true,
              tipo: 'perigo',
              aoClicar: () => {
                passos.splice(indice, 1);
                desenharPassos();
              },
            }),
          ]),
          el('div', { class: 'grade g2' }, [campo('Mensagem', template), campo('Minutos depois', minutos)]),
          // .marcador mora em web/css/tema.css, junto dos campos: e o rotulo
          // que fica ao lado da caixa de marcar, nao acima dela.
          ultimo ? el('label', { class: 'marcador' }, [desistir, 'Desistir do lead ao fim desta sequencia']) : null,
          ultimo ? blocoDesistir : null,
        ]),
      );
    });
  }
  desenharPassos();

  modal({
    titulo: novo ? 'Novo status' : `Editar ${status.nome}`,
    largo: true,
    corpo: el('div', {}, [
      el('div', { class: 'grade g2' }, [
        campo('Nome', nome),
        campo('Cor', cor),
        campo('Tipo (para o dashboard)', tipo),
        campo('Departamento', departamento, 'Ao aplicar o status, a conversa vai para este departamento.'),
      ]),
      campo('Descricao', descricao),
      // Como a sequencia comeca, reagenda e cancela, e o conselho de manter a
      // fila curta, sao a mesma explicacao: cabem na dica do titulo do bloco.
      el('h3', { class: 'cartao-titulo mt-4' }, [
        'Sequencia de follow-up',
        dica(
          el('div', {}, [
            el('div', { texto: 'A sequencia comeca quando a conversa entra neste status. Se o lead responder, ela e reagendada a partir da resposta. Se o status mudar, ela e cancelada.' }),
            el('div', { class: 'mt-2', texto: 'Menos follow-up costuma render mais. Sequencia longa queima o numero e aumenta denuncia.' }),
          ]),
          { assunto: 'a sequencia de follow-up' },
        ),
      ]),
      listaPassos,
      botao('Adicionar follow-up', {
        pequeno: true,
        icone: 'mais',
        aoClicar: () => {
          passos.push({ templateId: estado.templates[0]?.id, minutos: passos.length ? 1440 : 60, desistir: null });
          desenharPassos();
        },
      }),
    ]),
    confirmar: 'Salvar',
    aoConfirmar: async () => {
      if (!nome.value.trim()) throw new Error('De um nome ao status.');
      const dados = {
        nome: nome.value.trim(),
        cor: cor.value,
        descricao: descricao.value,
        tipo: tipo.value,
        departamentoId: departamento.value || null,
        followups: passos.filter((p) => p.templateId),
      };
      if (novo) await api.post('/api/status', dados);
      else await api.patch(`/api/status/${status.id}`, dados);
      aviso('Status salvo.', 'sucesso');
      await recarregarTela();
    },
  });
}

/* ------------------------------------------------------------------ */
/* Classes                                                             */
/* ------------------------------------------------------------------ */

async function secaoClasses(recarregarTela) {
  // Sao quatro cartoes lado a lado. Com um paragrafo em cada um, a primeira
  // etiqueta cadastrada aparecia depois de quatro blocos de texto: o que cada
  // lista significa foi para a dica do titulo dela.
  const bloco = (titulo, balao, chave, colecao, camposExtras) => {
    const lista = el('div', { class: 'lista-simples' });
    for (const item of estado[chave]) {
      lista.append(
        el('div', { class: 'lista-item' }, [
          item.cor ? el('span', { class: 'ponto ponto-g', estilo: { background: item.cor } }) : null,
          el('div', { class: 'corpo' }, [
            el('div', { class: 'titulo', texto: item.nome }),
            el('div', { class: 'desc', texto: descricaoDoItem(chave, item) }),
          ]),
          podeConfigurar()
            ? botao('Editar', { pequeno: true, aoClicar: () => editarClasse(chave, colecao, item, camposExtras, recarregarTela) })
            : null,
          podeConfigurar()
            ? botao('Excluir', {
                pequeno: true,
                tipo: 'perigo',
                aoClicar: () =>
                  confirmar('Excluir?', `"${item.nome}" sera removido.`, async () => {
                    await api.delete(`/api/${colecao}/${item.id}`);
                    aviso('Item excluido.', 'sucesso');
                    await recarregarTela();
                  }, 'Excluir'),
              })
            : null,
        ]),
      );
    }
    if (!estado[chave].length) lista.append(el('div', { class: 'vazio', texto: 'Nada cadastrado.' }));

    return cartaoComDica(
      { titulo, conceito: balao, largura: 360, respiro: false },
      lista,
      podeConfigurar()
        ? el('div', { class: 'mt-3' }, [
            botao('Adicionar', { pequeno: true, icone: 'mais', aoClicar: () => editarClasse(chave, colecao, null, camposExtras, recarregarTela) }),
          ])
        : null,
    );
  };

  return el('div', { class: 'grade g2' }, [
    bloco('Departamentos', 'Separam a operacao por area e limitam quem enxerga cada conversa.', 'departamentos', 'departamentos', ['cor']),
    bloco('Etiquetas', 'Multiplas por conversa. Servem para o que nao cabe no funil: urgencia, tipo de beneficio, particularidade do caso.', 'etiquetas', 'etiquetas', ['cor']),
    bloco('Origens', 'De onde o lead veio. Com palavra-chave, a origem e detectada na primeira mensagem.', 'origens', 'origens', ['palavrasChave']),
    bloco('Variaveis', 'Campos que a IA preenche sozinha durante a conversa: CPF, renda, laudo.', 'variaveis', 'variaveis', ['chave', 'descricao']),
  ]);
}

function descricaoDoItem(chave, item) {
  if (chave === 'origens') return item.palavrasChave?.length ? `palavras-chave: ${item.palavrasChave.join(', ')}` : 'sem palavra-chave';
  if (chave === 'variaveis') return `@${item.chave}${item.descricao ? ` · ${item.descricao}` : ''}`;
  return item.descricao || '';
}

function editarClasse(chave, colecao, item, extras, recarregarTela) {
  const nome = entradaTexto(item?.nome || '');
  const controles = { nome };
  const corpo = el('div', {}, [campo('Nome', nome)]);

  if (extras.includes('cor')) {
    controles.cor = seletorDeCor(item?.cor || COR_NOVA);
    corpo.append(campo('Cor', controles.cor));
  }
  if (extras.includes('chave')) {
    controles.chaveVar = entradaTexto(item?.chave || '', { placeholder: 'cpf' });
    corpo.append(campo('Chave (usada como @chave no prompt)', controles.chaveVar));
  }
  if (extras.includes('descricao')) {
    controles.descricao = entradaTexto(item?.descricao || '');
    // A frase antiga comecava com "Esta descricao e o que...", que e o molde de
    // explicacao de tela. A regra mesma cabe no balao, em oito palavras, e a
    // mesma frase estava escrita de novo na gaveta de chamada personalizada.
    corpo.append(campoComDica('Descricao', controles.descricao, 'E por ela que a IA sabe qual dado extrair.'));
  }
  if (extras.includes('palavrasChave')) {
    controles.palavras = entradaTexto((item?.palavrasChave || []).join(', '));
    // A regra de escrita fica, porque errar nela quebra a deteccao. Como a
    // origem e atribuida sozinha na primeira mensagem ja esta na dica do
    // cartao Origens, e nao precisa ser dito duas vezes.
    corpo.append(campo('Palavras-chave', controles.palavras, 'Separadas por virgula.'));
  }

  modal({
    titulo: item ? `Editar ${item.nome}` : 'Novo item',
    corpo,
    confirmar: 'Salvar',
    aoConfirmar: async () => {
      if (!nome.value.trim()) throw new Error('Informe o nome.');
      const dados = { nome: nome.value.trim() };
      if (controles.cor) dados.cor = controles.cor.value;
      if (controles.chaveVar) dados.chave = controles.chaveVar.value.trim();
      if (controles.descricao) dados.descricao = controles.descricao.value;
      if (controles.palavras) dados.palavrasChave = controles.palavras.value.split(',').map((p) => p.trim()).filter(Boolean);
      if (item) await api.patch(`/api/${colecao}/${item.id}`, dados);
      else await api.post(`/api/${colecao}`, dados);
      await recarregarTela();
    },
  });
}

/* ------------------------------------------------------------------ */
/* Membros                                                             */
/* ------------------------------------------------------------------ */

async function secaoMembros(recarregarTela) {
  const membros = await recarregar('membros');
  const papeis = estado.sessao.papeis;

  const lista = el('div', { class: 'lista-simples' });
  for (const membro of membros) {
    const departamentos = (membro.departamentos || []).includes('*')
      ? 'todos os departamentos'
      : (membro.departamentos || [])
          .map((id) => (id === 'sem-departamento' ? 'Sem departamento' : estado.departamentos.find((d) => d.id === id)?.nome))
          .filter(Boolean)
          .join(', ') || 'nenhum departamento';

    lista.append(
      el('div', { class: 'lista-item' }, [
        avatar(membro.usuario),
        el('div', { class: 'corpo' }, [
          el('div', { class: 'titulo', texto: membro.usuario?.nome || 'sem nome' }),
          // O ponto do meio so entra se houver e-mail: com o fallback vazio a
          // linha comecava por um separador orfao.
          el('div', { class: 'desc', texto: [membro.usuario?.email, departamentos].filter(Boolean).join(' · ') }),
        ]),
        membro.modoFoco ? selo('modo foco', 'alerta') : null,
        selo(papeis[membro.papel]?.nome || membro.papel, membro.papel === 'administrador' ? 'ouro' : ''),
        podeConfigurar() ? botao('Editar', { pequeno: true, aoClicar: () => editarMembro(membro, recarregarTela) }) : null,
        !podeConfigurar() || membro.usuarioId === estado.sessao.usuario.id
          ? null
          : botao('Remover', {
              pequeno: true,
              tipo: 'perigo',
              aoClicar: () =>
                confirmar('Remover membro?', `${membro.usuario?.nome} perde o acesso a este workspace.`, async () => {
                  await api.delete(`/api/membros/${membro.id}`);
                  aviso('Membro removido.', 'sucesso');
                  await recarregarTela();
                }, 'Remover'),
            }),
      ]),
    );
  }

  const explicacao = el('div', { class: 'lista-simples' });
  for (const [id, papel] of Object.entries(papeis)) {
    explicacao.append(
      el('div', { class: 'lista-item' }, [
        selo(papel.nome, id === 'administrador' ? 'ouro' : ''),
        el('div', { class: 'corpo' }, [el('div', { class: 'desc', texto: papel.descricao })]),
      ]),
    );
  }

  return el('div', {}, [
    podeConfigurar()
      ? el('div', { class: 'linha-botoes mb-4' }, [
          botao('Adicionar membro', { tipo: 'principal', icone: 'mais', aoClicar: () => editarMembro(null, recarregarTela) }),
        ])
      : null,
    cartao(null, null, lista),
    cartaoComDica(
      {
        titulo: 'Como o acesso funciona',
        conceito:
          'Duas excecoes valem acima de qualquer restricao: quem e responsavel pela conversa sempre a enxerga, e quem for mencionado em nota interna ganha acesso por 24 horas.',
        largura: 360,
        respiro: false,
      },
      explicacao,
    ),
  ]);
}

function editarMembro(membro, recarregarTela) {
  const novo = !membro;
  const nome = entradaTexto(membro?.usuario?.nome || '');
  const email = entradaTexto(membro?.usuario?.email || '', { type: 'email' });
  const senha = entradaTexto('', { type: 'password', placeholder: novo ? 'senha inicial' : 'deixe em branco para manter' });
  const whatsapp = entradaTexto(membro?.usuario?.whatsapp || '');
  const papel = selecao(
    Object.entries(estado.sessao.papeis).map(([id, p]) => ({ valor: id, rotulo: p.nome })),
    membro?.papel || 'suporte',
  );

  // O servidor recusa mudanca do proprio nivel de acesso e recusa promover a
  // administrador quem nao e administrador. O campo acompanha a regra, para
  // ninguem preencher o formulario inteiro e so descobrir no Salvar.
  const oProprio = Boolean(membro) && membro.usuarioId === estado.sessao.usuario.id;
  if (oProprio) papel.disabled = true;
  else if (estado.sessao.papel !== 'administrador') {
    const opcaoAdmin = [...papel.options].find((opcao) => opcao.value === 'administrador');
    if (opcaoAdmin && membro?.papel !== 'administrador') opcaoAdmin.disabled = true;
  }
  const modoFoco = marcador(membro?.modoFoco);

  const departamentos = new Set(membro?.departamentos || []);
  const listaDepartamentos = el('div', { class: 'linha-botoes' });
  const opcoesDep = [
    { id: '*', nome: 'Todos' },
    { id: 'sem-departamento', nome: 'Sem departamento' },
    ...estado.departamentos,
  ];
  for (const dep of opcoesDep) {
    const b = el('button', { class: `selo selo-clicavel ${departamentos.has(dep.id) ? 'ouro' : ''}`.trim(), texto: dep.nome });
    b.addEventListener('click', () => {
      if (departamentos.has(dep.id)) departamentos.delete(dep.id);
      else departamentos.add(dep.id);
      b.classList.toggle('ouro', departamentos.has(dep.id));
    });
    listaDepartamentos.append(b);
  }

  const conexoes = new Set(membro?.conexoes || []);
  const listaConexoes = el('div', { class: 'linha-botoes' });
  for (const conexao of [{ id: '*', nome: 'Todas' }, ...estado.conexoes]) {
    const b = el('button', { class: `selo selo-clicavel ${conexoes.has(conexao.id) ? 'ouro' : ''}`.trim(), texto: conexao.nome });
    b.addEventListener('click', () => {
      if (conexoes.has(conexao.id)) conexoes.delete(conexao.id);
      else conexoes.add(conexao.id);
      b.classList.toggle('ouro', conexoes.has(conexao.id));
    });
    listaConexoes.append(b);
  }

  modal({
    titulo: novo ? 'Novo membro' : `Editar ${membro.usuario?.nome}`,
    largo: true,
    corpo: el('div', {}, [
      el('div', { class: 'grade g2' }, [
        campo('Nome completo', nome),
        campo('E-mail', email),
        campo('Senha', senha),
        campo('WhatsApp', whatsapp),
        campo('Permissao', papel),
      ]),
      el('div', { class: 'campo' }, [el('span', { texto: 'Departamentos que enxerga' }), listaDepartamentos]),
      el('div', { class: 'campo' }, [el('span', { texto: 'Conexoes que enxerga' }), listaConexoes]),
      el('label', { class: 'campo marcador' }, [
        modoFoco,
        el('span', { texto: 'Modo foco (so enxerga as conversas em que e responsavel)' }),
      ]),
    ]),
    confirmar: 'Salvar',
    aoConfirmar: async () => {
      const dados = {
        papel: papel.value,
        departamentos: [...departamentos],
        conexoes: [...conexoes],
        modoFoco: modoFoco.checked,
      };
      if (novo) {
        if (!email.value.trim() || !senha.value) throw new Error('E-mail e senha inicial sao obrigatorios.');
        await api.post('/api/membros', { ...dados, nome: nome.value, email: email.value, senha: senha.value, whatsapp: whatsapp.value });
      } else {
        dados.usuario = { nome: nome.value, email: email.value, whatsapp: whatsapp.value };
        if (senha.value) dados.usuario.senha = senha.value;
        await api.patch(`/api/membros/${membro.id}`, dados);
      }
      aviso('Membro salvo.', 'sucesso');
      await recarregarTela();
    },
  });
}

/* ------------------------------------------------------------------ */
/* Horario comercial                                                   */
/* ------------------------------------------------------------------ */

async function secaoHorario(recarregarTela) {
  const { horario, resumo } = await api.get('/api/horario-comercial');
  const controles = {};

  const linhas = [];
  for (const dia of resumo) {
    const ativo = marcador(dia.faixa);
    const de = el('input', { type: 'time', value: dia.faixa?.de || '09:00', 'aria-label': `Abre as, ${dia.nome}` });
    const ate = el('input', { type: 'time', value: dia.faixa?.ate || '18:00', 'aria-label': `Fecha as, ${dia.nome}` });
    controles[dia.dia] = { ativo, de, ate };

    // O marcador vem primeiro no controle de proposito: e nele que o rotulo do
    // dia se prende, entao clicar no nome do dia abre e fecha o expediente.
    linhas.push(
      ajuste(
        dia.nome,
        grupoControles(
          ativo,
          el('div', { class: 'flexivel' }, [de]),
          el('span', { class: 'c-suave t-sm', texto: 'as' }),
          el('div', { class: 'flexivel' }, [ate]),
        ),
        dia.faixa ? null : 'Sem expediente. O follow-up deste dia cai no proximo dia util.',
      ),
    );
  }

  // A caixa que fechava a secao repetia palavra por palavra a ultima frase da
  // descricao do cabecalho, que hoje e a dica do titulo. Mensagem agendada a
  // mao continua ignorando o horario comercial, e isso continua escrito la.
  return el('div', {}, [
    ajustes(
      ...linhas,
      rodapeAjustes(
        podeConfigurar()
          ? botao('Salvar', {
              tipo: 'principal',
              aoClicar: async () => {
                const dias = {};
                for (const [dia, controle] of Object.entries(controles)) {
                  dias[dia] = controle.ativo.checked ? { de: controle.de.value, ate: controle.ate.value } : null;
                }
                await api.put('/api/horario-comercial', { fuso: horario.fuso || 'America/Sao_Paulo', dias });
                aviso('Horario salvo.', 'sucesso');
                await recarregarTela();
              },
            })
          : null,
      ),
    ),
  ]);
}

/* ------------------------------------------------------------------ */
/* Chaves de API                                                       */
/* ------------------------------------------------------------------ */

async function secaoApi(recarregarTela) {
  const chaves = await api.get('/api/chaves-api');

  const lista = el('div', { class: 'lista-simples' });
  for (const chave of chaves) {
    lista.append(
      el('div', { class: 'lista-item' }, [
        el('div', { class: 'corpo' }, [
          el('div', { class: 'titulo', texto: chave.nome }),
          el('div', { class: 'desc', texto: `${chave.prefixo}… · criada em ${dataHora(chave.criadoEm)}. Ultimo uso: ${chave.ultimoUso ? dataHora(chave.ultimoUso) : 'nunca'}` }),
        ]),
        botao('Revogar', {
          pequeno: true,
          tipo: 'perigo',
          aoClicar: () =>
            confirmar('Revogar chave?', 'Qualquer integracao que a use para de funcionar na hora.', async () => {
              await api.delete(`/api/chaves-api/${chave.id}`);
              await recarregarTela();
            }, 'Revogar'),
        }),
      ]),
    );
  }
  if (!chaves.length) lista.append(el('div', { class: 'vazio', texto: 'Nenhuma chave criada.' }));

  const exemplos = [
    ['GET', '/v1/contacts', 'Lista conversas com filtros de numero, status, departamento e nao lidas.'],
    ['POST', '/v1/contacts', 'Cadastra um contato e define o responsavel.'],
    ['POST', '/v1/send/message', 'Envia mensagem ou agenda para depois (scheduledAt).'],
    ['POST', '/v1/send/template', 'Envia um template com as variaveis preenchidas.'],
    ['GET', '/v1/message', 'Historico de uma conversa.'],
    ['PATCH', '/v1/settings/status', 'Move a conversa de status (e dispara o follow-up.)'],
    ['GET', '/v1/connections', 'Numeros conectados.'],
    ['GET', '/v1/agents', 'Agentes de IA cadastrados.'],
  ];
  const tabela = el('tbody');
  for (const [metodo, caminho, texto] of exemplos) {
    tabela.append(
      el('tr', {}, [
        el('td', {}, [selo(metodo, metodo === 'GET' ? 'info' : 'ouro')]),
        el('td', {}, [el('span', { class: 'mono', texto: caminho })]),
        el('td', { texto }),
      ]),
    );
  }

  return el('div', {}, [
    // O cabecalho e o limite sao dado de quem vai escrever a integracao, e nao
    // conselho: ficam, so que atras da dica do titulo. O motivo do limite saiu,
    // porque nao muda nada do que a pessoa faz aqui.
    subsecaoComDica(
      'Chaves ativas',
      'Autenticacao pelo cabecalho x-company-key. Limite de 3 requisicoes por segundo.',
      cartao(
        null,
        null,
        lista,
        el('div', { class: 'mt-3' }, [
          botao('Gerar chave', {
            tipo: 'principal',
            pequeno: true,
            icone: 'mais',
            aoClicar: () => {
              const nome = entradaTexto('', { placeholder: 'Site do escritorio' });
              modal({
                titulo: 'Nova chave de API',
                corpo: campo('Para que serve', nome),
                confirmar: 'Gerar',
                aoConfirmar: async () => {
                  const criada = await api.post('/api/chaves-api', { nome: nome.value || 'Chave sem nome' });

                  // Mesmo cuidado do copiarEmail: fora de contexto seguro, como
                  // no acesso pelo IP da maquina, navigator.clipboard nem
                  // existe. Sem o await e sem o catch o clique estourava por
                  // dentro e o "Chave copiada" verde aparecia do mesmo jeito,
                  // com a chave que nao volta a ser exibida indo embora junto
                  // com a janela.
                  const copiar = botao('', { icone: 'copiar', pequeno: true, titulo: 'Copiar a chave' });
                  copiar.setAttribute('aria-label', 'Copiar a chave');
                  copiar.addEventListener('click', async () => {
                    try {
                      // Sem o optional chaining de proposito: quando
                      // navigator.clipboard nao existe, isto lanca e cai no
                      // catch, em vez de resolver calado e mentir o sucesso.
                      await navigator.clipboard.writeText(criada.chave);
                      aviso('Chave copiada.', 'sucesso');
                    } catch {
                      aviso('Nao consegui copiar. Selecione a chave na tela e copie a mao.', 'erro');
                    }
                  });

                  modal({
                    titulo: 'Chave criada',
                    corpo: el('div', {}, [
                      el('p', { class: 'cartao-ajuda', texto: 'Copie agora: por seguranca, ela nao volta a ser exibida.' }),
                      el('div', { class: 'chave-copiavel' }, [
                        el('span', { class: 'mono', texto: criada.chave }),
                        copiar,
                      ]),
                    ]),
                  });
                  await recarregarTela();
                },
              });
            },
          }),
        ]),
      ),
    ),
    subsecao(
      'Endpoints disponiveis',
      `Endereco base: ${location.origin}`,
      cartao(
        null,
        null,
        el('div', { class: 'tabela-rolagem' }, [
          el('table', {}, [
            el('thead', {}, [el('tr', {}, [el('th', { texto: 'Metodo' }), el('th', { texto: 'Caminho' }), el('th', { texto: 'O que faz' })])]),
            tabela,
          ]),
        ]),
      ),
    ),
  ]);
}

/* ------------------------------------------------------------------ */
/* Aparencia                                                           */
/* ------------------------------------------------------------------ */

/* A miniatura ao lado de cada opcao ja mostra o que cada tema faz, entao a
   explicacao so sobrou onde a miniatura nao alcanca: "Seguir o sistema" nao se
   ve numa imagem, e o Escuro carrega a cor da marca. "Claro" nao leva nada, era
   o rotulo escrito de novo. */
const OPCOES_TEMA = [
  {
    id: 'sistema',
    rotulo: 'Seguir o sistema',
    ajuda: 'Acompanha o modo claro ou escuro do aparelho.',
    temas: ['claro', 'escuro'],
  },
  { id: 'claro', rotulo: 'Claro', ajuda: null, temas: ['claro'] },
  // A miniatura ao lado ja mostra as cores, entao a frase vai para o balao. A
  // de "Seguir o sistema" fica visivel: e a unica que diz algo que nem o rotulo
  // nem a miniatura dizem, e e lida na hora de escolher entre as tres.
  { id: 'escuro', rotulo: 'Escuro', ajuda: null, balao: 'Preto e dourado da marca.', temas: ['escuro'] },
];

/* --preto entra na lista porque a faixa lateral da miniatura e pintada com ele,
   como a lateral de verdade. Sem ele, a faixa da previa saia na cor do tema que
   esta em uso, e nao na do tema que a miniatura esta mostrando: as duas
   miniaturas de "Seguir o sistema" ficavam com a lateral igual. */
const VARIAVEIS_DA_PREVIA = ['--preto', '--fundo', '--superficie', '--superficie-2', '--borda', '--borda-forte', '--ouro'];

/**
 * Le a paleta de um tema sem repetir nenhuma cor aqui dentro.
 *
 * O tema escuro mora no :root e o claro em [data-tema='claro'], entao nao da
 * para pedir os dois ao mesmo tempo por CSS. A saida e por o atributo na raiz
 * por um instante, ler os valores ja calculados e devolver a raiz ao que era.
 * Nada aparece na tela no meio do caminho: o navegador so pinta no fim do
 * quadro, e a troca e desfeita antes disso.
 */
function paletaDoTema(nomeDoTema) {
  const raiz = document.documentElement;
  const antes = raiz.dataset.tema;
  raiz.dataset.tema = nomeDoTema;

  const calculado = getComputedStyle(raiz);
  const paleta = {};
  for (const variavel of VARIAVEIS_DA_PREVIA) paleta[variavel] = calculado.getPropertyValue(variavel).trim();

  if (antes) raiz.dataset.tema = antes;
  else delete raiz.dataset.tema;
  return paleta;
}

/**
 * Miniatura da tela: faixa lateral, titulo e duas linhas de texto.
 *
 * As classes .previa-tema-* moram em web/css/tema.css, no bloco de Aparencia.
 * A miniatura e um desenho, nao um componente: por isso as medidas dela vivem
 * juntas em uma classe so, em vez de virarem seis utilitarias empilhadas. O que
 * fica inline e o calculado, a largura de cada barra e a cor que ela pinta.
 */
function miniTela(nomeDoTema) {
  const barra = (largura, cor) => el('div', { class: 'previa-tema-barra', estilo: { width: largura, background: cor } });

  const caixa = el('div', { class: 'previa-tema-quadro' }, [
    el('div', { class: 'previa-tema-lateral' }, [
      barra('100%', 'var(--ouro)'),
      barra('100%', 'var(--borda-forte)'),
      barra('100%', 'var(--borda-forte)'),
    ]),
    el('div', { class: 'previa-tema-corpo' }, [
      barra('62%', 'var(--borda-forte)'),
      barra('100%', 'var(--borda)'),
      barra('80%', 'var(--borda)'),
    ]),
  ]);

  const paleta = paletaDoTema(nomeDoTema);
  for (const [variavel, valor] of Object.entries(paleta)) caixa.style.setProperty(variavel, valor);
  return caixa;
}

function previaDoTema(opcao) {
  return el(
    'div',
    { class: 'previa-tema', 'aria-hidden': 'true' },
    opcao.temas.map((nomeDoTema) => miniTela(nomeDoTema)),
  );
}

function secaoAparencia() {
  const escolhido = localStorage.getItem(CHAVE_TEMA) || 'sistema';

  const aplicar = (id) => {
    if (id === 'sistema') {
      // Seguir o sistema e a ausencia de escolha: sem a chave e sem o atributo,
      // quem decide passa a ser a media query de prefers-color-scheme.
      localStorage.removeItem(CHAVE_TEMA);
      delete document.documentElement.dataset.tema;
    } else {
      definirTema(id);
    }
    aviso('Aparencia trocada.', 'sucesso');
  };

  const linhas = OPCOES_TEMA.map((opcao) => {
    const escolha = el('input', { type: 'radio', name: 'aparencia-do-sistema', value: opcao.id });
    escolha.checked = opcao.id === escolhido;
    escolha.addEventListener('change', () => {
      if (escolha.checked) aplicar(opcao.id);
    });

    const controle = el('div', { class: 'linha' }, [escolha, previaDoTema(opcao)]);
    return ajuste(opcao.rotulo, controle, opcao.ajuda, opcao.balao);
  });

  // As duas frases que fechavam a secao, sobre valer so neste navegador e sobre
  // o interruptor gemeo la em cima, estao inteiras na dica do titulo. Aqui
  // ficam as tres opcoes e as miniaturas, que e o que se vem fazer.
  return ajustes(...linhas);
}

/* ------------------------------------------------------------------ */
/* Consumo                                                             */
/* ------------------------------------------------------------------ */

function metricaSimples(rotulo, valor, nota) {
  return el('div', { class: 'metrica' }, [
    el('div', { class: 'valor', texto: numero(valor) }),
    el('div', { class: 'rotulo', texto: rotulo }),
    nota ? el('div', { class: 'nota', texto: nota }) : null,
  ]);
}

async function secaoConsumo() {
  let filtro = { de: null, ate: null };
  const area = el('div');

  async function carregar() {
    const consumo = await api.get('/api/consumo', filtro);
    const topo = Array.isArray(consumo.topContatos) ? consumo.topContatos : [];

    limpar(area);
    area.append(
      el('div', { class: 'metricas' }, [
        metricaSimples('Total no periodo', consumo.total, 'creditos'),
        metricaSimples('Conversas', consumo.conversas, 'com consumo'),
        metricaSimples('Media por conversa', consumo.mediaPorConversa, `referencia: ${consumo.referenciaPorConversa}`),
      ]),
    );

    if (topo.length) {
      const lista = el(
        'div',
        { class: 'lista-simples' },
        topo.map((item) =>
          el('div', { class: 'lista-item' }, [
            el('div', { class: 'corpo' }, [el('div', { class: 'titulo', texto: item.nome })]),
            selo(`${numero(item.quantidade)} creditos`, 'ouro'),
          ]),
        ),
      );
      area.append(
        el('div', { class: 'mt-4' }, [
          // O que costuma estar no topo da lista e leitura de numero, nao aviso:
          // vale a primeira vez que alguem abre o consumo. Fica na dica.
          subsecaoComDica(
            'Conversas que mais consumiram',
            'A ponta da lista costuma ser audio gerado e conversa que voltou muitas vezes para a IA.',
            cartao(null, null, lista),
          ),
        ]),
      );
    }
  }

  const seletor = seletorPeriodo({
    aoAplicar: async (faixa) => {
      filtro = faixa;
      try {
        await carregar();
      } catch (erro) {
        aviso(erro.message, 'erro');
      }
    },
  });

  await carregar();

  return el('div', {}, [
    el('div', { class: 'linha-botoes mb-4' }, [seletor]),
    area,
  ]);
}
