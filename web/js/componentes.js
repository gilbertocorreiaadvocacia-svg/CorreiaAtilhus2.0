import { el, limpar, icone, botao, campo, cartao, plural, selecao, selo, aviso } from './ui.js';

/**
 * Previa de midia. Aparece no editor de template, no balao da conversa e no
 * teste de voz, sempre igual, para o que a equipe ve na tela ser o que o
 * cliente recebe no celular.
 *
 * Imagem e documento abrem o visualizador em tela cheia (abrirVisualizador,
 * logo abaixo). `opcoes.aoAbrir` troca esse clique — e o que a conversa usa
 * para abrir o visualizador ja com as outras imagens dela, e nao so esta.
 */
export function previaDaMidia(midia, opcoes = {}) {
  if (!midia?.url) return null;
  // A largura das duas previas mora em .midia-previa e .midia-previa.compacta,
  // no tema. Aqui fica so a escolha entre uma e outra.
  const medida = `midia-previa${opcoes.compacta ? ' compacta' : ''}`;
  const abrir = () => (opcoes.aoAbrir ? opcoes.aoAbrir() : abrirVisualizador([midia], 0));

  if (midia.tipo === 'imagem') {
    /* Botao em volta da imagem, e nao clique na imagem: assim ela chega pelo
       Tab e o leitor de tela anuncia que abre. */
    return el('button', {
      type: 'button',
      class: 'midia-ampliar',
      title: 'Ampliar',
      'aria-label': `Ampliar ${midia.nome || 'imagem'}`,
      aoClick: abrir,
    }, [el('img', { src: midia.url, alt: midia.nome || '', class: medida, loading: 'lazy' })]);
  }

  if (midia.tipo === 'video') {
    return el('video', { src: midia.url, controls: true, preload: 'metadata', class: medida });
  }

  if (midia.tipo === 'audio') {
    // O tocador do navegador nao aceita moldura nem canto arredondado, entao a
    // variacao som tira a borda e usa largura em vez de largura maxima.
    return el('audio', { src: midia.url, controls: true, preload: 'metadata', class: `${medida} som` });
  }

  return cartaoDeArquivo(midia, { aoAbrir: abrir });
}

/** O tipo que o visualizador sabe mostrar, olhando o mime e o nome. */
function formatoDe(item) {
  const nome = String(item?.nome || item?.url || '').toLowerCase();
  const mime = String(item?.mime || '').toLowerCase();
  if (item?.tipo === 'imagem' || mime.startsWith('image/') || /\.(jpe?g|png|webp|gif)$/.test(nome)) return 'imagem';
  if (item?.tipo === 'video' || mime.startsWith('video/') || /\.(mp4|webm)$/.test(nome)) return 'video';
  if (item?.tipo === 'audio' || mime.startsWith('audio/') || /\.(mp3|ogg|opus|wav|m4a)$/.test(nome)) return 'audio';
  if (mime === 'application/pdf' || /\.pdf$/.test(nome)) return 'pdf';
  return 'arquivo';
}

/**
 * Um documento como cartao: icone, nome e o que acontece no clique. O selo
 * dourado de antes ("Abrir contrato.pdf") era um link que trocava de aba sem
 * aviso, e nao dizia de que tipo era o arquivo.
 */
export function cartaoDeArquivo(item, { aoAbrir, detalhe } = {}) {
  const formato = formatoDe(item);
  const extensao = (String(item.nome || '').match(/\.([a-z0-9]{2,5})$/i)?.[1] || (formato === 'pdf' ? 'pdf' : 'arquivo')).toUpperCase();
  return el('button', {
    type: 'button',
    class: 'midia-arquivo',
    title: formato === 'pdf' ? 'Ver o documento' : 'Abrir',
    aoClick: aoAbrir || (() => abrirVisualizador([item], 0)),
  }, [
    el('span', { class: 'midia-arquivo-icone' }, [icone('contrato', 18)]),
    el('span', { class: 'midia-arquivo-dados' }, [
      el('span', { class: 'midia-arquivo-nome', texto: item.nome || 'Documento' }),
      el('span', { class: 'midia-arquivo-tipo', texto: detalhe || extensao }),
    ]),
  ]);
}

/**
 * Visualizador de midia em tela cheia.
 *
 * `itens` e uma lista de { url, tipo, nome, mime, legenda }, e `inicio` o que
 * abre primeiro. Com mais de um, as setas (e as teclas ← →) passam entre eles:
 * e assim que se le uma pilha de fotos de documento que o cliente mandou em
 * sequencia, sem fechar e abrir cada uma.
 *
 * Imagem abre ajustada a tela; um clique amplia no ponto clicado, outro volta.
 * PDF abre no leitor do proprio navegador, dentro da tela. O que o navegador
 * nao sabe mostrar (Word, planilha) vira um cartao com o botao de baixar.
 */
export function abrirVisualizador(itens, inicio = 0) {
  const lista = (itens || []).filter((i) => i?.url);
  if (!lista.length) return null;
  let atual = Math.max(0, Math.min(inicio, lista.length - 1));
  const focoAntes = document.activeElement;

  const titulo = el('div', { class: 'visualizador-titulo' });
  const contador = el('span', { class: 'visualizador-contador' });
  const palco = el('div', { class: 'visualizador-palco' });
  const legenda = el('div', { class: 'visualizador-legenda' });
  const abrirFora = el('a', { class: 'botao pequeno', target: '_blank', rel: 'noopener', title: 'Abrir em outra aba' }, [icone('abrir', 14), 'Nova aba']);
  /* Sem icone: o conjunto vendorizado nao tem o de download, e desenhar um a
     mao e a regra que o sistema nao quebra (ver ui.js, icone). */
  const baixar = el('a', { class: 'botao pequeno', title: 'Baixar o arquivo' }, ['Baixar']);
  const ampliar = botao('Ampliar', { pequeno: true, icone: 'lupa' });
  const fechar = botao('', { pequeno: true, icone: 'fechar', titulo: 'Fechar (Esc)' });
  fechar.setAttribute('aria-label', 'Fechar');

  const anterior = el('button', { type: 'button', class: 'visualizador-seta anterior', 'aria-label': 'Anterior' }, [icone('voltar', 22)]);
  const proximo = el('button', { type: 'button', class: 'visualizador-seta proximo', 'aria-label': 'Próximo' }, [icone('voltar', 22)]);

  const janela = el('div', { class: 'visualizador', role: 'dialog', 'aria-modal': 'true', 'aria-label': 'Visualizador de arquivo' }, [
    el('div', { class: 'visualizador-barra' }, [
      el('div', { class: 'visualizador-cabeca' }, [titulo, contador]),
      el('div', { class: 'visualizador-acoes' }, [ampliar, abrirFora, baixar, fechar]),
    ]),
    el('div', { class: 'visualizador-corpo' }, [anterior, palco, proximo]),
    legenda,
  ]);

  let imagem = null;
  let ampliada = false;

  function ajustar(evento) {
    if (!imagem) return;
    ampliada = !ampliada;
    ampliar.lastChild.textContent = ampliada ? 'Ajustar à tela' : 'Ampliar';
    palco.classList.toggle('ampliada', ampliada);
    if (!ampliada) {
      imagem.style.width = '';
      return;
    }
    /* Amplia a partir do tamanho que ela tinha na tela, e leva a rolagem ate o
       ponto clicado — senao a pessoa clica no numero do RG e cai no canto. */
    const caixa = imagem.getBoundingClientRect();
    const px = evento?.clientX != null ? (evento.clientX - caixa.left) / caixa.width : 0.5;
    const py = evento?.clientY != null ? (evento.clientY - caixa.top) / caixa.height : 0.5;
    const largura = Math.max(caixa.width * 2.5, imagem.naturalWidth);
    imagem.style.width = `${largura}px`;
    requestAnimationFrame(() => {
      palco.scrollLeft = largura * px - palco.clientWidth / 2;
      palco.scrollTop = imagem.offsetHeight * py - palco.clientHeight / 2;
    });
  }

  function mostrar() {
    const item = lista[atual];
    const formato = formatoDe(item);
    limpar(palco);
    palco.classList.remove('ampliada');
    ampliada = false;
    imagem = null;

    titulo.textContent = item.nome || { imagem: 'Imagem', video: 'Vídeo', audio: 'Áudio', pdf: 'Documento' }[formato] || 'Arquivo';
    contador.textContent = lista.length > 1 ? `${atual + 1} de ${lista.length}` : '';
    legenda.textContent = item.legenda || '';
    legenda.hidden = !item.legenda;
    abrirFora.href = item.url;
    baixar.href = item.urlBaixar || item.url;
    baixar.setAttribute('download', item.nome || '');
    ampliar.hidden = formato !== 'imagem';
    ampliar.lastChild.textContent = 'Ampliar';
    anterior.hidden = lista.length < 2;
    proximo.hidden = lista.length < 2;

    if (formato === 'imagem') {
      imagem = el('img', { src: item.url, alt: item.nome || '', class: 'visualizador-imagem' });
      imagem.addEventListener('click', ajustar);
      palco.append(imagem);
    } else if (formato === 'video') {
      palco.append(el('video', { src: item.url, controls: true, autoplay: true, class: 'visualizador-video' }));
    } else if (formato === 'audio') {
      palco.append(el('audio', { src: item.url, controls: true, autoplay: true }));
    } else if (formato === 'pdf') {
      palco.append(el('iframe', { src: item.url, class: 'visualizador-documento', title: item.nome || 'Documento' }));
    } else {
      palco.append(
        el('div', { class: 'visualizador-sem-previa' }, [
          icone('contrato', 40),
          el('strong', { texto: item.nome || 'Arquivo' }),
          el('p', { texto: 'O navegador não mostra este tipo de arquivo. Baixe para abrir no programa certo.' }),
        ]),
      );
    }
  }

  function andar(passo) {
    if (lista.length < 2) return;
    atual = (atual + passo + lista.length) % lista.length;
    mostrar();
  }

  function sair() {
    document.removeEventListener('keydown', teclas, true);
    janela.remove();
    document.body.classList.remove('sem-rolagem');
    if (focoAntes && typeof focoAntes.focus === 'function') focoAntes.focus();
  }

  function teclas(evento) {
    if (evento.key === 'Escape') {
      evento.stopPropagation();
      sair();
    } else if (evento.key === 'ArrowRight') andar(1);
    else if (evento.key === 'ArrowLeft') andar(-1);
  }

  anterior.addEventListener('click', () => andar(-1));
  proximo.addEventListener('click', () => andar(1));
  ampliar.addEventListener('click', () => ajustar());
  fechar.addEventListener('click', sair);
  /* Clique no fundo escuro fecha; clique na imagem amplia. */
  palco.addEventListener('click', (evento) => {
    if (evento.target === palco) sair();
  });
  document.addEventListener('keydown', teclas, true);

  document.body.append(janela);
  document.body.classList.add('sem-rolagem');
  mostrar();
  fechar.focus();
  return { fechar: sair };
}

/* Datas ------------------------------------------------------------ */

/** Meia-noite de hoje, no fuso do navegador. */
function hoje() {
  const d = new Date();
  d.setHours(0, 0, 0, 0);
  return d;
}

function somarDias(data, dias) {
  const d = new Date(data.getTime());
  d.setDate(d.getDate() + dias);
  return d;
}

/**
 * Data -> AAAA-MM-DD montado com os campos locais. Nada de toISOString aqui:
 * ele converte para UTC e, a noite, devolve o dia seguinte.
 */
function paraIso(data) {
  const mes = String(data.getMonth() + 1).padStart(2, '0');
  const dia = String(data.getDate()).padStart(2, '0');
  return `${data.getFullYear()}-${mes}-${dia}`;
}

/** AAAA-MM-DD -> DD/MM/AAAA, sem passar por Date para nao pegar fuso. */
function paraBr(iso) {
  if (!iso) return '';
  const [ano, mes, dia] = String(iso).split('-');
  return `${dia}/${mes}/${ano}`;
}

/**
 * Mostra ou esconde. O atributo hidden sozinho nao basta: qualquer regra de
 * display na classe do elemento ganha dele, entao o inline vai junto.
 */
function alternarVisivel(no, visivel) {
  no.hidden = !visivel;
  no.style.display = visivel ? '' : 'none';
}

const ATALHOS_PERIODO = [
  { rotulo: 'Hoje', faixa: () => ({ de: paraIso(hoje()), ate: paraIso(hoje()) }) },
  { rotulo: '7 dias', faixa: () => ({ de: paraIso(somarDias(hoje(), -6)), ate: paraIso(hoje()) }) },
  { rotulo: '30 dias', faixa: () => ({ de: paraIso(somarDias(hoje(), -29)), ate: paraIso(hoje()) }) },
  { rotulo: '90 dias', faixa: () => ({ de: paraIso(somarDias(hoje(), -89)), ate: paraIso(hoje()) }) },
  {
    rotulo: 'Este mês',
    faixa: () => {
      const h = hoje();
      return { de: paraIso(new Date(h.getFullYear(), h.getMonth(), 1)), ate: paraIso(h) };
    },
  },
  {
    rotulo: 'Mês passado',
    faixa: () => {
      const h = hoje();
      return {
        de: paraIso(new Date(h.getFullYear(), h.getMonth() - 1, 1)),
        ate: paraIso(new Date(h.getFullYear(), h.getMonth(), 0)),
      };
    },
  },
];

/**
 * Seletor de periodo. Entra no lugar dos dois campos de data soltos: quem filtra
 * relatorio quase sempre quer "os ultimos 30 dias", nao uma data especifica, e
 * digitar duas datas para isso e trabalho a toa. O atalho ja aplica e fecha; os
 * dois campos ficam ali para o ajuste fino, confirmado no Aplicar.
 *
 * O calendario e o do navegador (input type=date). Desenhar um aqui daria mais
 * codigo do que o componente inteiro e sairia pior no teclado e no leitor de tela.
 */
export function seletorPeriodo({ de, ate, aoAplicar } = {}) {
  let atual = { de: de || null, ate: ate || null };
  let aberto = false;

  const caixa = el('div', { class: 'seletor-periodo' });
  const botaoAbrir = botao('', { titulo: 'Escolher período' });
  botaoAbrir.setAttribute('aria-haspopup', 'dialog');
  botaoAbrir.setAttribute('aria-expanded', 'false');

  function resumo() {
    if (atual.de && atual.ate) return `${paraBr(atual.de)} a ${paraBr(atual.ate)}`;
    if (atual.de) return `A partir de ${paraBr(atual.de)}`;
    if (atual.ate) return `Até ${paraBr(atual.ate)}`;
    return 'Todo o período';
  }

  function pintarRotulo() {
    limpar(botaoAbrir);
    botaoAbrir.append(icone('agenda', 15), document.createTextNode(resumo()));
  }

  const entradaDe = el('input', { type: 'date', value: atual.de || '', 'aria-label': 'Data inicial' });
  const entradaAte = el('input', { type: 'date', value: atual.ate || '', 'aria-label': 'Data final' });

  function aplicar(faixa) {
    let inicio = faixa.de || '';
    let fim = faixa.ate || '';
    // Datas em AAAA-MM-DD comparam bem como texto, entao da para arrumar a
    // inversao sem construir Date so para isso.
    if (inicio && fim && inicio > fim) [inicio, fim] = [fim, inicio];
    entradaDe.value = inicio;
    entradaAte.value = fim;
    atual = { de: inicio || null, ate: fim || null };
    pintarRotulo();
    fechar();
    if (aoAplicar) aoAplicar({ de: atual.de, ate: atual.ate });
  }

  const botaoLimpar = botao('Limpar', { aoClicar: () => aplicar({ de: '', ate: '' }) });
  botaoLimpar.classList.add('direita');
  const botaoAplicar = botao('Aplicar', {
    tipo: 'principal',
    aoClicar: () => aplicar({ de: entradaDe.value, ate: entradaAte.value }),
  });

  const painel = el('div', { class: 'seletor-periodo-painel', role: 'dialog', 'aria-label': 'Período' }, [
    el(
      'div',
      { class: 'atalhos-periodo' },
      ATALHOS_PERIODO.map((atalho) =>
        botao(atalho.rotulo, { pequeno: true, aoClicar: () => aplicar(atalho.faixa()) }),
      ),
    ),
    el('div', { class: 'grade g2' }, [campo('De', entradaDe), campo('Ate', entradaAte)]),
    // O par de botoes vai para a borda direita do painel pela .direita no
    // primeiro deles: a margem automatica come a sobra a esquerda e empurra os
    // dois juntos, sem precisar de uma regra de alinhamento so para esta linha.
    el('div', { class: 'linha-botoes' }, [botaoLimpar, botaoAplicar]),
  ]);
  alternarVisivel(painel, false);

  function escutarTecla(evento) {
    if (evento.key !== 'Escape') return;
    fechar();
    botaoAbrir.focus();
  }

  function escutarFora(evento) {
    if (!caixa.contains(evento.target)) fechar();
  }

  function abrir() {
    if (aberto) return;
    aberto = true;
    alternarVisivel(painel, true);
    caixa.classList.add('aberto');
    botaoAbrir.setAttribute('aria-expanded', 'true');
    document.addEventListener('keydown', escutarTecla);
    document.addEventListener('mousedown', escutarFora);
  }

  function fechar() {
    if (!aberto) return;
    aberto = false;
    alternarVisivel(painel, false);
    caixa.classList.remove('aberto');
    botaoAbrir.setAttribute('aria-expanded', 'false');
    document.removeEventListener('keydown', escutarTecla);
    document.removeEventListener('mousedown', escutarFora);
  }

  botaoAbrir.addEventListener('click', () => (aberto ? fechar() : abrir()));
  pintarRotulo();
  caixa.append(botaoAbrir, painel);
  return caixa;
}

/**
 * Gaveta lateral. Mesmo contrato do modal de ui.js, mas o painel entra pela
 * direita e ocupa a altura toda: formulario longo (agente, template, conexao)
 * fica apertado na janela centralizada, que so cresce ate 88vh e depois rola
 * junto com o rodape de acao.
 *
 * `aoConfirmar` pode devolver promessa. Se lancar erro, a gaveta continua
 * aberta com o texto ja digitado e o erro sai no aviso.
 */
export function gaveta({
  titulo,
  descricao,
  corpo,
  confirmar,
  aoConfirmar,
  aoFechar,
  /* Painel de leitura nao tem o que cancelar: quem so olhou fecha, nao desiste.
     O rotulo continua "Cancelar" por padrao para todo formulario ja existente. */
  rotuloCancelar = 'Cancelar',
  /* A gaveta de formulario tem a largura de uma coluna de campos. A de
     detalhes carrega tabela, lista de eventos e blocos lado a lado, e em 480px
     tudo isso quebra em uma linha por palavra. */
  larga = false,
} = {}) {
  const cortina = el('div', { class: 'gaveta-cortina' });
  let fechada = false;

  const fechar = () => {
    if (fechada) return;
    fechada = true;
    cortina.remove();
    document.removeEventListener('keydown', escutarEsc);
    if (aoFechar) aoFechar();
  };

  const escutarEsc = (evento) => {
    if (evento.key === 'Escape') fechar();
  };
  document.addEventListener('keydown', escutarEsc);

  const botaoConfirmar = confirmar
    ? botao(confirmar, {
        tipo: 'principal',
        aoClicar: async () => {
          botaoConfirmar.disabled = true;
          try {
            const resultado = await aoConfirmar?.();
            if (resultado !== false) fechar();
          } catch (erro) {
            aviso(erro.message, 'erro');
          } finally {
            botaoConfirmar.disabled = false;
          }
        },
      })
    : null;

  const caixa = el('aside', { class: `gaveta ${larga ? 'larga' : ''}`.trim(), role: 'dialog', 'aria-modal': 'true', 'aria-label': titulo || 'Painel' }, [
    el('header', { class: 'gaveta-cabecalho' }, [
      // O crescimento vive aqui, no filho direto do flex: no h2 ele seria
      // inerte e o botao Fechar grudava no texto em vez de ir para a borda.
      el('div', { class: 'flexivel encolhe' }, [
        el('h2', { texto: titulo || '' }),
        descricao ? el('p', { class: 'subtitulo', texto: descricao }) : null,
      ]),
      botao('', { icone: 'fechar', pequeno: true, titulo: 'Fechar', aoClicar: fechar }),
    ]),
    el('div', { class: 'gaveta-corpo' }, [].concat(corpo || [])),
    el('footer', { class: 'gaveta-rodape' }, [botao(rotuloCancelar, { aoClicar: fechar }), botaoConfirmar]),
  ]);

  cortina.append(caixa);
  cortina.addEventListener('mousedown', (evento) => {
    if (evento.target === cortina) fechar();
  });
  document.body.append(cortina);

  // Formulario longo comeca a ser preenchido de cima para baixo: deixar o cursor
  // no primeiro campo poupa um clique em toda abertura.
  const primeiro = caixa.querySelector('.gaveta-corpo input, .gaveta-corpo select, .gaveta-corpo textarea');
  if (primeiro) primeiro.focus();

  return { fechar, caixa };
}

let contadorDica = 0;

/**
 * Folga entre o gatilho e o balao, e folga minima ate a borda da janela.
 *
 * Nao sao medidas de desenho, e por isso nao saem dos tokens de espaco: sao os
 * dois numeros que posicionar() usa para calcular onde o balao cabe na tela.
 */
const RESPIRO_DICA = 8;
const MARGEM_DICA = 12;

/**
 * Dica de ajuda. O texto explicativo fica atras de um icone em vez de ocupar uma
 * linha embaixo do campo: assim a tela nao vira um manual, e quem ja sabe o que
 * o campo faz nao precisa ler de novo toda vez.
 *
 * `conteudo` aceita texto, um elemento ou uma lista de elementos: explicacao de
 * conceito costuma passar de um paragrafo.
 *
 * Funciona no mouse e no teclado, fecha com Escape nos dois casos e anda para
 * dentro quando o gatilho esta perto de qualquer borda da tela.
 *
 * O gatilho e um <button> de verdade, com aria-expanded acompanhando aberto e
 * fechado. Um span com tabindex e role de nota entrava na ordem de tabulacao
 * anunciado como conteudo estatico, sem dizer que abria alguma coisa. O balao
 * fica ao lado do botao, e nao dentro dele, porque o texto de ajuda leva
 * paragrafo e lista, que nao cabem dentro de um botao.
 */
export function dica(conteudo, { largura = 320, assunto } = {}) {
  const id = `dica-${++contadorDica}`;
  // O balao e fixo, e nao absoluto. A coluna de propriedades do atendimento, a
  // area de tabela e o corpo da gaveta rolam com overflow, e overflow em um
  // eixo corta o outro junto: dentro deles um balao absoluto era cortado na
  // borda do painel, muito antes da borda da janela. Fixo, ele so precisa caber
  // na tela, e quem cuida disso e posicionar().
  //
  // Por isso tambem caem aqui o bottom e o transform que .dica-balao usa para
  // se pendurar no gatilho: com position fixed quem diz o lugar e o par
  // left/top, medido na hora. Todo o resto da aparencia continua no tema.
  //
  // O overflow deveria morar em .dica-balao, em web/css/tema.css: ele existe
  // porque posicionar() poe teto de altura quando o texto nao cabe nem acima
  // nem abaixo do gatilho, e sem rolagem interna esse teto cortava o fim da
  // explicacao em vez de deixar ler.
  const balao = el('div', {
    class: 'dica-balao',
    id,
    role: 'tooltip',
    estilo: { position: 'fixed', bottom: 'auto', transform: 'none', overflowY: 'auto' },
  });
  for (const parte of [].concat(conteudo ?? '')) {
    // O resto do sistema monta lista de filho com null no meio, para o item que
    // so aparece as vezes. Sem esta guarda o null virava a palavra "null"
    // escrita dentro do balao.
    if (parte === null || parte === undefined || parte === '') continue;
    balao.append(parte instanceof Node ? parte : document.createTextNode(String(parte)));
  }
  // Balao sem conteudo e um icone de ajuda que abre um retangulo vazio: a
  // explicacao sumiu e a tela nao da sinal nenhum disso. Como esta e a caixa
  // para onde foi a explicacao que saiu das telas, o erro precisa aparecer na
  // hora de montar, e nao no dia em que alguem for procurar o texto.
  if (!balao.childNodes.length) throw new Error('dica() sem conteudo');
  alternarVisivel(balao, false);

  // `assunto` e opcional e entra por ultimo na assinatura de proposito: as
  // chamadas que ja existem continuam valendo sem tocar em nenhuma tela. Com
  // ele, quem navega por tabulacao ouve de que campo e a ajuda, em vez de
  // "Ajuda" repetido dezenas de vezes na mesma tela.
  const gatilho = el(
    'button',
    {
      type: 'button',
      class: 'dica-alvo',
      'aria-label': assunto ? `Ajuda sobre ${assunto}` : 'Ajuda',
      'aria-expanded': 'false',
      'aria-describedby': id,
    },
    [icone('info', 14)],
  );

  const caixa = el('span', { class: 'dica-caixa' }, [gatilho, balao]);

  function posicionar() {
    // A tela do atendimento se redesenha a cada evento do servidor. Com o balao
    // aberto na hora do redesenho, o gatilho sai do documento e estes ouvintes
    // de rolagem e de tecla ficariam presos para sempre a um no que ninguem
    // mais ve, medindo um retangulo de zero por zero.
    if (!gatilho.isConnected) {
      esconder();
      return;
    }

    const area = gatilho.getBoundingClientRect();

    // Em tela estreita a largura pedida nao cabe. Encolher aqui e melhor do que
    // deixar o balao passar da janela e perder o fim de cada linha. A largura
    // vai tambem no maximo porque .dica-balao trava em 250px, e sem isso o
    // balao media um tamanho e era desenhado em outro.
    const cabe = Math.min(largura, window.innerWidth - 2 * MARGEM_DICA);
    balao.style.width = `${cabe}px`;
    balao.style.maxWidth = `${cabe}px`;

    // Centralizado no gatilho, e empurrado para dentro quando encosta na borda.
    // E o caso do painel da direita do atendimento e da ultima coluna da
    // tabela, onde o icone fica a poucos pixels do fim da tela.
    const meio = area.left + area.width / 2 - cabe / 2;
    const ultimo = Math.max(window.innerWidth - cabe - MARGEM_DICA, MARGEM_DICA);
    balao.style.left = `${Math.round(Math.min(Math.max(meio, MARGEM_DICA), ultimo))}px`;

    // O teto da abertura anterior sai antes da medida. Sem isso o balao que uma
    // vez abriu apertado, perto do rodape, continuava apertado nas aberturas
    // seguintes, no meio da tela, onde cabia inteiro.
    balao.style.maxHeight = '';
    const alto = balao.offsetHeight;

    // Acima do gatilho, que e onde ele nao tapa o campo que esta explicando.
    // Sem altura sobrando la em cima, vai para baixo.
    const folgaAcima = area.top - RESPIRO_DICA - MARGEM_DICA;
    const folgaAbaixo = window.innerHeight - area.bottom - RESPIRO_DICA - MARGEM_DICA;

    // Explicacao de conceito passa de um paragrafo, e balao alto com o gatilho
    // no meio da tela nao cabe inteiro nem de um lado nem do outro. Nesse caso
    // ele fica do lado mais folgado, com teto de altura, e rola por dentro:
    // cortado na borda da janela ele perderia justamente o fim do texto.
    const paraCima = alto <= folgaAcima || folgaAcima >= folgaAbaixo;
    const folga = Math.max(paraCima ? folgaAcima : folgaAbaixo, 0);
    if (alto > folga) balao.style.maxHeight = `${folga}px`;

    const topo = paraCima ? area.top - Math.min(alto, folga) - RESPIRO_DICA : area.bottom + RESPIRO_DICA;
    balao.style.top = `${Math.round(Math.max(topo, MARGEM_DICA))}px`;
  }

  function aoRolar(evento) {
    // Rolar dentro do proprio balao nao mexe o gatilho de lugar. Recalcular ali
    // so faria o texto pular embaixo do dedo de quem esta lendo.
    if (evento.target === balao) return;
    posicionar();
  }

  function aoTeclar(evento) {
    if (evento.key !== 'Escape') return;
    // Modal, gaveta e seletor de periodo tambem fecham no Escape, e todos
    // escutam o mesmo document. Com o foco dentro da dica ela foi aberta pelo
    // teclado e o Escape e dela: parar aqui evita que um toque so feche a
    // explicacao e leve o formulario inteiro junto. Aberta apenas no passar do
    // mouse, o balao fecha e o Escape segue caminho, porque quem apertou
    // estava trabalhando no formulario, nao lendo a dica.
    if (caixa.contains(document.activeElement)) evento.stopPropagation();
    esconder();
  }

  function mostrar() {
    alternarVisivel(balao, true);
    gatilho.setAttribute('aria-expanded', 'true');
    posicionar();
    // Escape tem de fechar tambem quando o balao abriu no passar do mouse, que
    // e quando o gatilho nao esta com o foco e um ouvinte preso a caixa nunca
    // chegaria a ser chamado. O true poe a escuta na descida do evento, antes
    // dos ouvintes que modal e gaveta penduram no mesmo document.
    document.addEventListener('keydown', aoTeclar, true);
    // Sendo fixo, o balao nao anda junto com o painel que rola por baixo dele.
    // O true escuta a rolagem de qualquer painel, e nao so a da janela.
    document.addEventListener('scroll', aoRolar, true);
    window.addEventListener('resize', posicionar);
  }

  function esconder() {
    alternarVisivel(balao, false);
    gatilho.setAttribute('aria-expanded', 'false');
    document.removeEventListener('keydown', aoTeclar, true);
    document.removeEventListener('scroll', aoRolar, true);
    window.removeEventListener('resize', posicionar);
  }

  caixa.addEventListener('mouseenter', mostrar);
  caixa.addEventListener('mouseleave', () => {
    // Tirar o mouse de cima nao pode fechar o que o teclado abriu: a dica sumia
    // com o foco ainda no gatilho e so voltava depois de sair dele e voltar.
    if (caixa.contains(document.activeElement)) return;
    esconder();
  });
  caixa.addEventListener('focusin', mostrar);
  caixa.addEventListener('focusout', (evento) => {
    if (!caixa.contains(evento.relatedTarget)) esconder();
  });

  return caixa;
}

/**
 * Cartao com a explicacao atras do icone de ajuda, no proprio titulo.
 *
 * Entra no lugar de cartao(titulo, descricao, ...): o paragrafo de descricao
 * ocupa uma linha fixa para sempre, e quem usa a tela o dia inteiro le esse
 * texto na primeira semana e nunca mais. Atras do icone ele continua a um
 * passo de distancia, do mouse ou do Tab, sem empurrar o dado para baixo.
 *
 * O balao entra dentro do proprio h2 porque .cartao-titulo ja e uma linha
 * flex alinhada ao centro: o icone encosta no texto com o respiro do tema, sem
 * regra nova.
 *
 * E o unico cartaoComDica do sistema. Existiam quatro, com tres assinaturas
 * diferentes, um em cada tela: bastava uma delas importar o daqui para o modulo
 * parar de carregar com identificador repetido e a tela sair em branco.
 *
 * `conceito` e o texto do balao. `ajuda` e o paragrafo que continua visivel, e so
 * entra quando a frase fala do estado de agora, e nao do conceito. `respiro` da
 * folga entre o titulo e o conteudo, e por padrao vale quando nao ha paragrafo:
 * titulo colado no grafico nao se le.
 */
export function cartaoComDica({ titulo, conceito, ajuda = null, largura, respiro }, ...filhos) {
  const no = cartao(titulo, ajuda, ...filhos);
  const cabeca = no.querySelector('.cartao-titulo');
  // Sem titulo, cartao() nao monta o h2 e a explicacao nao tem onde entrar. Com
  // encadeamento opcional isso passava calado: a dica inteira sumia, sem erro,
  // sem console e sem rastro na tela.
  if (!cabeca) throw new Error('cartaoComDica exige título');
  if (conceito) cabeca.append(dica(conceito, { largura, assunto: titulo }));
  if (respiro ?? !ajuda) cabeca.classList.add('mb-3');
  return no;
}

let contadorCampoDica = 0;

/**
 * Campo com a explicacao atras do icone de ajuda, no lugar da linha de texto
 * embaixo do controle.
 *
 * Entra no lugar de campo(rotulo, entrada, ajuda). Nao basta trocar o rotulo
 * dentro do <label class="campo"> que campo() monta: o nome acessivel do
 * controle e montado com o texto inteiro do rotulo, e o botao da dica entraria
 * nele, com o leitor de tela anunciando "WhatsApp Ajuda sobre WhatsApp". Por
 * isso aqui a moldura e uma <div>, o rotulo e um <label for> de verdade e a
 * dica fica fora dele.
 *
 * O <span> de fora e o rotulo que o tema ja desenha, e o de dentro existe
 * porque `.campo > span` diz display block e ganha de qualquer utilitaria. E o
 * de dentro que alinha o texto com o icone.
 */
export function campoComDica(rotulo, entrada, ajuda) {
  if (!entrada.id) entrada.id = `campo-dica-${++contadorCampoDica}`;
  return el('div', { class: 'campo' }, [
    el('span', {}, [
      el('span', { class: 'linha' }, [
        el('label', { for: entrada.id, texto: rotulo }),
        dica(ajuda, { assunto: rotulo }),
      ]),
    ]),
    entrada,
  ]);
}

const TAMANHOS_PAGINA = [10, 20, 50, 100];

/**
 * Singular do rotulo do rodape, para o caso de uma linha so.
 *
 * So o suficiente para os rotulos que o sistema usa: quase todos terminam em s
 * ("tarefas", "conversas", "contatos"), e "contatos carregados" tem duas
 * palavras. Nao e um pluralizador de portugues, e nem precisa ser: o rotulo
 * vem escrito no codigo, nao do usuario.
 */
function singularDe(rotulo) {
  return String(rotulo)
    .split(' ')
    .map((palavra) => (palavra.endsWith('s') ? palavra.slice(0, -1) : palavra))
    .join(' ');
}

/**
 * Rodape de tabela. Mostra o total antes de tudo porque "675 tarefas" e a
 * resposta que a pessoa procura na maioria das vezes; a navegacao vem depois.
 *
 * `rotulo` e o nome do que esta sendo contado, no plural ("tarefas",
 * "conversas"). Com uma linha so ele vai para o singular: este rodape aparece
 * em todas as tabelas do sistema, entao "1 tarefas" aparecia em todas elas.
 */
export function paginacao({ pagina, paginas, total, porPagina, aoMudar, aoMudarTamanho, rotulo = 'itens' } = {}) {
  const tamanho = Number(porPagina) || TAMANHOS_PAGINA[1];
  const quantas = Math.max(1, Number(paginas) || Math.ceil((Number(total) || 0) / tamanho) || 1);
  const atual = Math.min(Math.max(1, Number(pagina) || 1), quantas);

  const seletorTamanho = selecao(
    TAMANHOS_PAGINA.map((n) => ({ valor: n, rotulo: String(n) })),
    tamanho,
    {
      'aria-label': 'Itens por página',
      aoChange: (evento) => aoMudarTamanho?.(Number(evento.target.value)),
    },
  );

  const anterior = botao('', { icone: 'voltar', pequeno: true, titulo: 'Página anterior', aoClicar: () => aoMudar?.(atual - 1) });
  anterior.setAttribute('aria-label', 'Página anterior');
  anterior.disabled = atual <= 1;

  const proxima = botao('', { icone: 'voltar', pequeno: true, titulo: 'Próxima página', aoClicar: () => aoMudar?.(atual + 1) });
  proxima.setAttribute('aria-label', 'Próxima página');
  proxima.disabled = atual >= quantas;
  // Mesmo desenho da seta anterior, virado: o conjunto de icones so tem um lado
  // e desenhar o outro a mao sairia com peso diferente. A volta de meia volta
  // mora em .icone-virado, no tema, porque toda seta espelhada do sistema
  // precisa dela e nenhuma delas depende de dado.
  proxima.firstChild.classList.add('icone-virado');

  return el('div', { class: 'paginacao' }, [
    el('span', { texto: plural(Number(total) || 0, singularDe(rotulo), rotulo) }),
    el('div', { class: 'paginacao-controles' }, [
      seletorTamanho,
      el('span', { texto: 'por página' }),
      el('span', { texto: `Página ${atual} de ${quantas}` }),
      anterior,
      proxima,
    ]),
  ]);
}

const SAUDE = {
  saudavel: { texto: 'Saudável', tipo: 'sucesso', cor: 'var(--sucesso)' },
  risco: { texto: 'Em risco', tipo: 'alerta', cor: 'var(--alerta)' },
  critico: { texto: 'Crítico', tipo: 'erro', cor: 'var(--erro)' },
};

/** Selo de saude do agente, da fila ou da conexao. */
export function seloSaude(nivel) {
  const item = SAUDE[String(nivel || '').toLowerCase()];
  if (!item) return selo('Sem dado', '');
  return selo(item.texto, item.tipo, item.cor);
}

/* Amostras da rampa do escritorio -------------------------------------- */

/* A cor gravada e um token de tema, e nao um hex: o mesmo registro precisa ser
   legivel no tema escuro e no claro, e so a folha de estilo sabe em qual dos
   dois esta pintando. Um input type=color nao consegue representar isso, e na
   primeira edicao gravaria preto por cima sem avisar. */
const DEGRAUS = [
  { token: 'var(--serie-1)', nome: 'Marfim' },
  { token: 'var(--serie-2)', nome: 'Ouro claro' },
  { token: 'var(--serie-3)', nome: 'Champanhe' },
  { token: 'var(--serie-4)', nome: 'Ouro da marca' },
  { token: 'var(--serie-5)', nome: 'Grafite quente' },
  { token: 'var(--serie-6)', nome: 'Ouro velho' },
  { token: 'var(--serie-7)', nome: 'Bronze' },
  { token: 'var(--serie-8)', nome: 'Bronze profundo' },
  { token: 'var(--sucesso)', nome: 'Jade, para desfecho bom' },
  { token: 'var(--erro)', nome: 'Terracota, para perda' },
];

/**
 * Seletor de cor por amostra.
 *
 * Devolve um elemento que expoe `.value` como se fosse um input, para as telas
 * que ja liam `controles.cor.value` seguirem funcionando sem mudanca.
 */
export function seletorDeCor(valorInicial) {
  let escolhido = String(valorInicial || '').trim() || DEGRAUS[1].token;

  /* Cor escolhida a mao antes desta versao continua disponivel como uma
     amostra a mais: some-la da lista faria a proxima edicao trocar a escolha
     do escritorio sem ninguem pedir. */
  const lista = DEGRAUS.some((d) => d.token === escolhido)
    ? DEGRAUS
    : [...DEGRAUS, { token: escolhido, nome: 'A cor atual deste item' }];

  const caixa = el('div', { class: 'amostras', role: 'radiogroup', 'aria-label': 'Cor' });

  const botoes = lista.map((degrau) => {
    const botao = el('button', {
      type: 'button',
      class: 'amostra',
      role: 'radio',
      title: degrau.nome,
      'aria-label': degrau.nome,
      estilo: { background: degrau.token },
    });
    botao.addEventListener('click', () => {
      escolhido = degrau.token;
      marcar();
    });
    return { degrau, botao };
  });

  function marcar() {
    for (const { degrau, botao } of botoes) {
      botao.setAttribute('aria-checked', degrau.token === escolhido ? 'true' : 'false');
    }
  }

  caixa.append(...botoes.map((item) => item.botao));
  marcar();

  Object.defineProperty(caixa, 'value', {
    get: () => escolhido,
    set: (novo) => {
      escolhido = String(novo || '').trim() || DEGRAUS[1].token;
      marcar();
    },
  });

  return caixa;
}

/* Distribuicao em barras -------------------------------------------------- */


/* Menu de acoes ----------------------------------------------------------- */

/**
 * Menu suspenso das tres reticencias, no fim da linha de uma tabela.
 *
 * Existe porque linha de tabela nao comporta quatro botoes lado a lado: com
 * Configurar, Testar, Webhook e Excluir escritos por extenso, a coluna de acoes
 * ficava mais larga que a coluna que importa, e o nome da conexao era o
 * primeiro a ser cortado. Aqui a linha mostra so o gatilho, e as acoes aparecem
 * quando alguem realmente vai agir.
 *
 * O menu e fixo, e nao absoluto, pelo mesmo motivo da dica: a area de tabela
 * rola com overflow, e overflow em um eixo corta o outro junto.
 *
 * `itens` aceita `null` no meio da lista, para a tela poder esconder uma acao
 * sem montar o vetor condicionalmente. `{ separador: true }` desenha a linha
 * que separa o que muda o cadastro do que apaga.
 */
export function menuAcoes(itens, { rotulo = 'Ações', texto = '', iconeGatilho = 'opcoes' } = {}) {
  const lista = el('div', { class: 'menu-acoes-lista', role: 'menu', hidden: true });
  /* Sem `texto`, o gatilho e so o icone das reticencias, que e o que cabe no
     fim de uma linha de tabela. Com `texto`, vira um botao escrito, para o
     menu que fica solto numa barra e precisa dizer o que ele abre. */
  const gatilho = botao(texto, { icone: iconeGatilho, pequeno: !texto, titulo: rotulo });
  gatilho.setAttribute('aria-haspopup', 'menu');
  gatilho.setAttribute('aria-expanded', 'false');

  const caixa = el('div', { class: 'menu-acoes' }, [gatilho, lista]);
  let aberto = false;

  function fechar() {
    if (!aberto) return;
    aberto = false;
    lista.setAttribute('hidden', '');
    gatilho.setAttribute('aria-expanded', 'false');
    document.removeEventListener('keydown', aoTeclar, true);
    document.removeEventListener('mousedown', aoClicarFora, true);
    window.removeEventListener('scroll', fechar, true);
    window.removeEventListener('resize', fechar);
  }

  function aoTeclar(evento) {
    if (evento.key === 'Escape') {
      fechar();
      gatilho.focus();
    }
  }

  function aoClicarFora(evento) {
    if (!caixa.contains(evento.target)) fechar();
  }

  function posicionar() {
    const area = gatilho.getBoundingClientRect();
    const alvo = lista.getBoundingClientRect();
    /* Encosta a direita do menu na direita do gatilho: a coluna de acoes fica
       na borda da tabela, e abrir para a direita jogaria o menu para fora da
       tela. Se nao couber para baixo, sobe. */
    const esquerda = Math.max(8, Math.min(area.right - alvo.width, window.innerWidth - alvo.width - 8));
    const cabeAbaixo = area.bottom + alvo.height + 8 < window.innerHeight;
    lista.style.left = `${esquerda}px`;
    lista.style.top = cabeAbaixo ? `${area.bottom + 4}px` : `${area.top - alvo.height - 4}px`;
  }

  function abrir() {
    if (aberto) return;
    aberto = true;
    lista.removeAttribute('hidden');
    gatilho.setAttribute('aria-expanded', 'true');
    posicionar();
    document.addEventListener('keydown', aoTeclar, true);
    document.addEventListener('mousedown', aoClicarFora, true);
    /* Captura no scroll para pegar tambem a rolagem da area da tabela, que nao
       borbulha ate a janela. */
    window.addEventListener('scroll', fechar, true);
    window.addEventListener('resize', fechar);
  }

  gatilho.addEventListener('click', () => (aberto ? fechar() : abrir()));

  for (const item of itens.filter(Boolean)) {
    if (item.separador) {
      lista.append(el('div', { class: 'menu-acoes-separador' }));
      continue;
    }
    const marcavel = item.marcado !== undefined;
    const opcao = el('button', {
      type: 'button',
      class: `menu-acoes-item ${item.perigo ? 'perigo' : ''}`.trim(),
      role: marcavel ? 'menuitemcheckbox' : 'menuitem',
      'aria-checked': marcavel ? String(Boolean(item.marcado)) : null,
    });
    /* Item que liga e desliga guarda o lugar do check mesmo desmarcado: sem a
       caixa vazia, a lista inteira dancava para a esquerda a cada clique. */
    if (marcavel) {
      opcao.append(
        item.marcado ? icone('ok', 14) : el('span', { class: 'menu-acoes-vazio', 'aria-hidden': 'true' }),
      );
    } else if (item.icone) {
      opcao.append(icone(item.icone, 14));
    }
    opcao.append(document.createTextNode(item.rotulo));
    opcao.addEventListener('click', () => {
      fechar();
      item.aoClicar?.();
    });
    lista.append(opcao);
  }

  return caixa;
}
