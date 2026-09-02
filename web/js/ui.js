import { ICONES, VIEWBOX } from './icones.js';
/** Pecas de interface reaproveitadas em todas as telas. */

export function el(etiqueta, atributos = {}, filhos = []) {
  const no = document.createElement(etiqueta);
  for (const [chave, valor] of Object.entries(atributos)) {
    if (valor === null || valor === undefined || valor === false) continue;
    if (chave === 'class') no.className = valor;
    else if (chave === 'html') no.innerHTML = valor;
    else if (chave === 'texto') no.textContent = valor;
    else if (chave === 'dataset') Object.assign(no.dataset, valor);
    else if (chave === 'estilo') aplicarEstilo(no, valor);
    else if (chave.startsWith('ao')) no.addEventListener(chave.slice(2).toLowerCase(), valor);
    else if (valor === true) no.setAttribute(chave, '');
    else no.setAttribute(chave, valor);
  }
  for (const filho of [].concat(filhos)) {
    if (filho === null || filho === undefined || filho === false) continue;
    no.append(filho instanceof Node ? filho : document.createTextNode(String(filho)));
  }
  return no;
}

/**
 * Estilo inline, aceitando tambem variavel de tema.
 *
 * Object.assign direto na style ignora custom property sem reclamar:
 * style['--minha-cor'] = 'x' simplesmente nao faz nada. Quem escrevesse uma
 * variavel aqui ficaria procurando o erro na folha de estilo.
 */
function aplicarEstilo(no, estilo) {
  for (const [chave, valor] of Object.entries(estilo || {})) {
    if (chave.startsWith('--')) no.style.setProperty(chave, valor);
    else no.style[chave] = valor;
  }
}

export function limpar(no) {
  while (no.firstChild) no.firstChild.remove();
  return no;
}

/**
 * Icones: Phosphor regular, vendorizado em js/icones.js.
 * Sao paths de traco preenchido no grid de 256, todos do mesmo peso.
 */
export function icone(nome, tamanho = 16) {
  const caminho = ICONES[nome] || ICONES.inicio;
  const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  svg.setAttribute('viewBox', VIEWBOX);
  svg.setAttribute('width', tamanho);
  svg.setAttribute('height', tamanho);
  svg.setAttribute('fill', 'currentColor');
  svg.setAttribute('aria-hidden', 'true');
  svg.setAttribute('focusable', 'false');
  const p = document.createElementNS('http://www.w3.org/2000/svg', 'path');
  p.setAttribute('d', caminho);
  svg.append(p);
  return svg;
}

/**
 * `opcoes.submeter` faz sair um type="submit". Um formulario com mais de um
 * campo e nenhum botao de submit nao dispara submit no Enter, entao o teclado
 * simplesmente nao entrava no formulario de login. O padrao continua sendo
 * type="button", que e o certo para todo botao que nao fecha formulario.
 */
export function botao(texto, opcoes = {}) {
  const classes = ['botao'];
  if (opcoes.tipo) classes.push(opcoes.tipo);
  /**
   * Tres alturas, e so tres: .botao fica em --controle, .pequeno em
   * --controle-p e .grande em --controle-g. A altura mora na folha de estilo,
   * nunca aqui: enquanto cada tela apertava o proprio botao no atributo style,
   * o sistema chegou a ter botao de 27, 34, 35, 37, 50 e 59 px de altura.
   *
   * Pequeno ganha de grande se os dois vierem juntos, que e chamada errada:
   * melhor sair no tamanho menor do que empilhar as duas classes e depender da
   * ordem em que elas aparecem no arquivo.
   */
  if (opcoes.pequeno) classes.push('pequeno');
  else if (opcoes.grande) classes.push('grande');
  const b = el('button', {
    class: classes.join(' '),
    type: opcoes.submeter ? 'submit' : 'button',
    title: opcoes.titulo || null,
  });
  // Tres alturas de botao, tres tamanhos de icone. O passo grande faltava aqui
  // pelo mesmo motivo que faltava no tema: ele entrou na assinatura e parou no
  // meio do caminho.
  if (opcoes.icone) b.append(icone(opcoes.icone, opcoes.pequeno ? 14 : opcoes.grande ? 18 : 16));
  if (texto) b.append(document.createTextNode(texto));
  if (opcoes.aoClicar) b.addEventListener('click', opcoes.aoClicar);
  if (opcoes.desabilitado) b.disabled = true;
  return b;
}

export function campo(rotulo, entrada, ajuda) {
  return el('label', { class: 'campo' }, [el('span', { texto: rotulo }), entrada, ajuda ? el('small', { texto: ajuda }) : null]);
}

export function entradaTexto(valor = '', atributos = {}) {
  return el('input', { type: 'text', value: valor, ...atributos });
}

export function areaTexto(valor = '', atributos = {}) {
  const t = el('textarea', atributos);
  t.value = valor;
  return t;
}

export function selecao(opcoes, valor, atributos = {}) {
  const s = el('select', atributos);
  for (const opcao of opcoes) {
    const o = el('option', { value: opcao.valor ?? '' , texto: opcao.rotulo });
    if (String(opcao.valor ?? '') === String(valor ?? '')) o.selected = true;
    s.append(o);
  }
  return s;
}

/**
 * `cor` e o unico estilo inline que sobra aqui, e sobra de proposito: e a cor
 * gravada na etiqueta e no status do contato, escolhida pela equipe e lida do
 * banco. Nao existe classe possivel para um valor que so aparece em tempo de
 * execucao. Tamanho, respiro e peso do selo saem todos de .selo no tema.
 */
export function selo(texto, tipo, cor) {
  const s = el('span', { class: `selo ${tipo || ''}`.trim() });
  if (cor) s.append(el('span', { class: 'ponto', estilo: { background: cor } }));
  s.append(document.createTextNode(texto));
  return s;
}

export function cartao(titulo, ajuda, ...filhos) {
  return el('div', { class: 'cartao' }, [
    titulo ? el('h2', { class: 'cartao-titulo', texto: titulo }) : null,
    ajuda ? el('p', { class: 'cartao-ajuda', texto: ajuda }) : null,
    ...filhos,
  ]);
}

/**
 * Estado vazio, sempre com a mesma composicao: icone opcional, titulo, texto de
 * apoio e a acao embaixo. Sem uma forma unica cada tela escolhia o proprio
 * tamanho de titulo, e o mesmo aviso de "nada aqui" saia diferente em cada
 * lista do sistema.
 *
 * `nomeIcone` e opcional e entra por ultimo na assinatura de proposito: as
 * chamadas que ja existem continuam valendo sem tocar em nenhuma tela.
 */
export function vazio(titulo, texto, acao, nomeIcone) {
  return el('div', { class: 'vazio' }, [
    nomeIcone ? el('div', { class: 'vazio-icone' }, [icone(nomeIcone, 28)]) : null,
    el('strong', { class: 't-lg peso-600', texto: titulo }),
    el('div', { class: 't-sm c-suave', texto: texto || '' }),
    acao || null,
  ]);
}

/**
 * Aviso de canto. A caixa #avisos e uma regiao viva no index.html, entao o
 * leitor de tela anuncia o texto sozinho. O erro vai um passo alem com
 * role="alert": ele interrompe a leitura, porque falha em acao irreversivel
 * nao pode esperar a pessoa terminar de ler outra coisa.
 *
 * A transicao de saida mora no CSS, dentro da guarda de movimento reduzido.
 * Aqui fica so a classe.
 */
export function aviso(texto, tipo = '') {
  const caixa = document.getElementById('avisos');
  const no = el('div', { class: `aviso ${tipo}`.trim(), texto, role: tipo === 'erro' ? 'alert' : null });
  caixa.append(no);
  setTimeout(() => {
    no.classList.add('saindo');
    setTimeout(() => no.remove(), 260);
  }, tipo === 'erro' ? 6000 : 3400);
}

/**
 * Concordancia de numero. "1 conversas" e o tipo de detalhe que faz a tela
 * parecer feita as pressas, e ele aparecia em contador, rodape de tabela e
 * barra de selecao.
 */
export function plural(quantidade, singular, muitos) {
  const n = Number(quantidade) || 0;
  return `${numero(n)} ${n === 1 ? singular : muitos}`;
}

/**
 * Modal simples. `aoConfirmar` pode devolver promessa; erro mantem aberto.
 *
 * `balao` e um no de dica() ja montado, e nao um texto: dica() mora em
 * componentes.js, que importa deste arquivo, e importar de volta fecharia um
 * ciclo entre os dois modulos. Serve para o conceito por tras da janela, o que
 * se le uma vez e depois so empurra o formulario para baixo em toda abertura.
 */
export function modal({ titulo, balao, corpo, confirmar, aoConfirmar, largo, aoFechar }) {
  const cortina = el('div', { class: 'cortina' });
  const fechar = () => {
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

  // Mesmo tratamento da gaveta em componentes.js: sem role e sem aria-modal, o
  // leitor de tela segue lendo a pagina de tras como se a janela nao existisse.
  const caixa = el('div', {
    class: `modal ${largo ? 'largo' : ''}`.trim(),
    role: 'dialog',
    'aria-modal': 'true',
    'aria-label': titulo || 'Janela',
  }, [
    el('header', {}, [
      // .linha so quando ha balao: sem ele o h2 continua sendo o bloco de
      // texto de sempre, com o flex: 1 que empurra o Fechar para a borda.
      el('h2', { class: balao ? 'linha' : null }, [titulo || '', balao || null]),
      // Sem titulo o botao fica sem nome nenhum: o icone e aria-hidden e o
      // rotulo e vazio, entao o leitor de tela anunciava so "botao".
      botao('', { icone: 'fechar', pequeno: true, titulo: 'Fechar', aoClicar: fechar }),
    ]),
    el('div', { class: 'corpo' }, [corpo]),
    el('footer', {}, [botao('Fechar', { aoClicar: fechar }), botaoConfirmar]),
  ]);

  cortina.append(caixa);
  cortina.addEventListener('click', (evento) => {
    if (evento.target === cortina) fechar();
  });
  document.body.append(cortina);

  // O foco entra na janela: sem isso o Tab continua andando pela tela de tras e
  // a confirmacao de uma acao destrutiva fica fora do alcance do teclado.
  //
  // Sem campo no corpo, quem recebe o foco e o Fechar do rodape, nunca o
  // Confirmar: em confirmar() o corpo e so um paragrafo, e deixar o cursor no
  // botao que apaga significa que um Enter distraido apaga.
  const primeiro = caixa.querySelector('.corpo input, .corpo select, .corpo textarea');
  (primeiro || caixa.querySelector('footer .botao'))?.focus();

  return { fechar, caixa };
}

export function confirmar(titulo, texto, aoConfirmar, rotulo = 'Confirmar') {
  return modal({
    titulo,
    corpo: el('p', { class: 'sem-margem c-suave', texto }),
    confirmar: rotulo,
    aoConfirmar,
  });
}

/* Formatadores ------------------------------------------------------ */

export function quando(iso) {
  if (!iso) return '';
  const data = new Date(iso);
  const hoje = new Date();
  const mesmoDia = data.toDateString() === hoje.toDateString();
  if (mesmoDia) return data.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' });
  const ontem = new Date(hoje.getTime() - 86400000);
  if (data.toDateString() === ontem.toDateString()) return 'ontem';
  if (data.getFullYear() === hoje.getFullYear())
    return data.toLocaleDateString('pt-BR', { day: '2-digit', month: '2-digit' });
  return data.toLocaleDateString('pt-BR');
}

export function dataHora(iso) {
  if (!iso) return '-';
  return new Date(iso).toLocaleString('pt-BR', { dateStyle: 'short', timeStyle: 'short' });
}

export function telefone(numero) {
  const d = String(numero || '').replace(/\D+/g, '');
  if (d.length < 12) return numero || '';
  return `+${d.slice(0, 2)} (${d.slice(2, 4)}) ${d.length > 12 ? d.slice(4, 9) : d.slice(4, 8)}-${d.length > 12 ? d.slice(9) : d.slice(8)}`;
}

export function duracao(minutos) {
  if (minutos < 60) return `${minutos} min`;
  if (minutos < 1440) {
    const h = minutos / 60;
    return `${Number.isInteger(h) ? h : h.toFixed(1)} h`;
  }
  const d = minutos / 1440;
  return `${Number.isInteger(d) ? d : d.toFixed(1)} dias`;
}

export function iniciais(nome = '') {
  return nome
    .trim()
    .split(/\s+/)
    .slice(0, 2)
    .map((p) => p[0])
    .join('')
    .toUpperCase();
}

export function numero(valor) {
  return new Intl.NumberFormat('pt-BR', { maximumFractionDigits: 1 }).format(valor || 0);
}

/**
 * Avatar de uma pessoa: a foto quando existe, as iniciais quando nao.
 *
 * Antes cada tela desenhava as iniciais direto, entao a foto escolhida em
 * Minha conta so aparecia na previa do proprio formulario: a pessoa salvava,
 * navegava e continuava vendo as iniciais em todo lugar, e reenviava a imagem
 * achando que nao tinha pego. Serve para usuario, membro e contato, que e onde
 * o campo foto existe.
 *
 * A imagem e decorativa (alt vazio): o nome sempre aparece escrito ao lado.
 *
 * A medida sai no atributo style porque `tamanho` e argumento da chamada: a
 * lista usa o circulo de 32 que ja vem de .avatar no tema, e a previa de Minha
 * conta pede 44. Valor decidido em tempo de execucao nao vira classe.
 */
export function avatar(pessoa, tamanho = 32) {
  const medida = `${tamanho}px`;
  if (pessoa?.foto) {
    return el('img', {
      class: 'avatar',
      src: pessoa.foto,
      alt: '',
      estilo: { width: medida, height: medida },
    });
  }
  return el('div', {
    class: 'avatar',
    estilo: { width: medida, height: medida },
    texto: iniciais(pessoa?.nome || '') || '?',
  });
}
