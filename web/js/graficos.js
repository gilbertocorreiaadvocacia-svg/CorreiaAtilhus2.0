import { el } from './ui.js';

/**
 * Graficos em SVG, desenhados a mao. Sem biblioteca: o sistema roda sem
 * instalar nada, e uma dependencia de grafico costuma pesar mais que o
 * resto da tela inteira.
 *
 * Todo grafico grande recebe nome: sem ele o leitor de tela anuncia "grafico" e
 * nada mais. Os que sao so figura levam role de imagem; o de evolucao leva role
 * de grupo, porque as faixas de leitura dele sao focaveis e role de imagem
 * apagaria os filhos para quem usa leitor de tela.
 */

const NS = 'http://www.w3.org/2000/svg';
const VOLTA = Math.PI * 2;
const FORMATO_NUMERO = new Intl.NumberFormat('pt-BR', { maximumFractionDigits: 1 });

/* Tamanho de texto dentro do SVG. font-size de SVG e atributo, e nao regra de
   estilo, entao o valor precisa ser numero e nao pode sair de var(--t-xs).
   Estas duas constantes sao os mesmos dois passos da escala do tema, escritos
   uma vez so: era aqui que sobreviviam o 10 e o 9,5, e meio pixel e exatamente
   o que faz um grafico parecer montado no olho. */
const T_XS = 11;
const T_SM = 13;

/* Cada gradiente precisa de um id proprio: duas roscas na mesma tela
   compartilhariam a mesma referencia e uma sobrescreveria a outra. */
let sequenciaId = 0;
function idUnico(prefixo) {
  sequenciaId += 1;
  return `grafico-${prefixo}-${sequenciaId}`;
}

function no(etiqueta, atributos = {}, filhos = []) {
  const elemento = document.createElementNS(NS, etiqueta);
  for (const [chave, valor] of Object.entries(atributos)) {
    if (valor === null || valor === undefined) continue;
    elemento.setAttribute(chave, valor);
  }
  for (const filho of [].concat(filhos)) {
    if (filho) elemento.append(filho);
  }
  return elemento;
}

function texto(conteudo, atributos = {}) {
  /* Algarismo alinhado e de largura fixa tambem nos rotulos de grafico: sem
     isso, o "14%" da rosca e do funil saia com o 4 afundado (algarismo antigo
     da fonte), diferente do mesmo numero no cartao ao lado. Vai por style
     inline porque o <text> do SVG nao herda a regra dos cartoes. */
  const t = no('text', {
    fill: 'currentColor',
    'font-size': T_XS,
    style: 'font-variant-numeric: lining-nums tabular-nums',
    ...atributos,
  });
  t.textContent = conteudo;
  return t;
}

function titulo(conteudo) {
  return no('title', {}, [document.createTextNode(conteudo)]);
}

/** Duas casas bastam num SVG e deixam o atributo d curto de ler. */
function arred(valor) {
  return Math.round(valor * 100) / 100;
}

/*
 * Largura real em vez de largura fixa.
 *
 * Grafico com texto precisa de uma unidade do viewBox valendo um pixel da tela.
 * Com preserveAspectRatio none as letras esticam; com o padrao o navegador
 * encaixa pela altura e centraliza, e sobra tarja vazia dos dois lados. Num
 * cartao de 1573px o desenho de 900 ocupava 891 e desperdicava 682, quase
 * metade. A saida e medir a caixa e so entao desenhar.
 */
const DESENHOS = new WeakMap();
let observadorDeLargura = null;

function observarLargura(caixa, redesenhar) {
  DESENHOS.set(caixa, redesenhar);
  if (!observadorDeLargura) {
    observadorDeLargura = new ResizeObserver((entradas) => {
      for (const entrada of entradas) {
        /* Um observador para a tela toda, e nao um por grafico: a tela se
           redesenha inteira a cada evento do servidor, e um observador por
           grafico seguraria vivo o no ja descartado. Podar aqui o que saiu do
           documento e o que impede o vazamento. */
        if (!entrada.target.isConnected) {
          observadorDeLargura.unobserve(entrada.target);
          DESENHOS.delete(entrada.target);
          continue;
        }
        const desenhar = DESENHOS.get(entrada.target);
        if (desenhar) desenhar(Math.round(entrada.contentRect.width));
      }
    });
  }
  observadorDeLargura.observe(caixa);
}

/**
 * Caixa que se mede e entrega a largura ao desenho.
 *
 * O primeiro desenho sai aqui, na largura minima, por dois motivos: quem chama
 * testa o retorno para decidir entre grafico e estado vazio, entao a resposta
 * precisa existir antes da caixa; e assim o cartao ja nasce com conteudo, sem
 * piscar vazio ate o observador acordar.
 */
function responsivo(altura, minimo, desenhar) {
  /* O desenho troca a cada redimensionamento, mas o balao da dica nao: ele
     mora fora do palco para nao ser varrido junto com o SVG antigo. */
  const palco = el("div", { class: "grafico-palco" });
  const caixa = el("div", { class: "grafico-caixa", estilo: { height: altura + "px" } }, [palco]);

  const primeiro = desenhar(minimo, caixa);
  if (!primeiro) return null;
  palco.append(primeiro);

  let ultima = minimo;
  observarLargura(caixa, (largura) => {
    const util = Math.max(minimo, largura);
    /* Redesenhar a cada pixel de arrasto nao muda nada visivel e custa caro.
       Um passo de 8px passa despercebido e corta a conta por oito. */
    if (Math.abs(util - ultima) < 8) return;
    ultima = util;
    const novo = desenhar(util, caixa);
    if (novo) palco.replaceChildren(novo);
  });
  return caixa;
}

function formatar(valor) {
  return FORMATO_NUMERO.format(Number(valor) || 0);
}

function rotuloDoPeriodo(periodo) {
  if (/^\d{4}-\d{2}-\d{2}$/.test(periodo)) {
    const [, mes, dia] = periodo.split('-');
    return `${dia}/${mes}`;
  }
  if (/^\d{4}-\d{2}$/.test(periodo)) {
    const [ano, mes] = periodo.split('-');
    return `${mes}/${ano.slice(2)}`;
  }
  return periodo;
}

/**
 * Catmull-Rom convertida em Bezier cubica. A curva passa por todos os pontos,
 * ao contrario de uma suavizacao solta que inventa o meio do caminho e mente
 * sobre o dado. `limites` prende os pontos de controle na area util: sem isso
 * a curva escapa da grade quando o valor sobe e desce de um ponto para o outro.
 */
function caminhoSuave(pontos, limites) {
  if (!pontos.length) return '';
  const prender = (valor) => (limites ? Math.min(limites.baixo, Math.max(limites.topo, valor)) : valor);
  const partes = [`M ${arred(pontos[0][0])} ${arred(pontos[0][1])}`];

  for (let i = 0; i < pontos.length - 1; i += 1) {
    const anterior = pontos[i - 1] || pontos[i];
    const atual = pontos[i];
    const proximo = pontos[i + 1];
    const seguinte = pontos[i + 2] || proximo;

    const c1x = atual[0] + (proximo[0] - anterior[0]) / 6;
    const c1y = prender(atual[1] + (proximo[1] - anterior[1]) / 6);
    const c2x = proximo[0] - (seguinte[0] - atual[0]) / 6;
    const c2y = prender(proximo[1] - (seguinte[1] - atual[1]) / 6);

    partes.push(
      `C ${arred(c1x)} ${arred(c1y)}, ${arred(c2x)} ${arred(c2y)}, ${arred(proximo[0])} ${arred(proximo[1])}`,
    );
  }
  return partes.join(' ');
}

/** Gradiente vertical da cor ate transparente. Sem y1/y2 usa a caixa do proprio path. */
function gradienteVertical(id, cor, opacidadeTopo, y1, y2) {
  const atributos =
    y1 === undefined
      ? { id, x1: '0', y1: '0', x2: '0', y2: '1' }
      : { id, gradientUnits: 'userSpaceOnUse', x1: '0', y1: arred(y1), x2: '0', y2: arred(y2) };

  return no('linearGradient', atributos, [
    no('stop', { offset: '0%', 'stop-color': cor, 'stop-opacity': String(opacidadeTopo) }),
    no('stop', { offset: '100%', 'stop-color': cor, 'stop-opacity': '0' }),
  ]);
}

/** Setor de anel: arco de verdade, com raio externo e interno, e nao um traco fingido. */
function arcoDeAnel(centroX, centroY, raioExterno, raioInterno, anguloInicial, varredura) {
  const abertura = Math.min(varredura, VOLTA - 0.0005);
  const fim = anguloInicial + abertura;
  const grande = abertura > Math.PI ? 1 : 0;
  const ponto = (raio, angulo) => [
    arred(centroX + raio * Math.cos(angulo)),
    arred(centroY + raio * Math.sin(angulo)),
  ];

  const [x1, y1] = ponto(raioExterno, anguloInicial);
  const [x2, y2] = ponto(raioExterno, fim);
  const [x3, y3] = ponto(raioInterno, fim);
  const [x4, y4] = ponto(raioInterno, anguloInicial);

  return [
    `M ${x1} ${y1}`,
    `A ${arred(raioExterno)} ${arred(raioExterno)} 0 ${grande} 1 ${x2} ${y2}`,
    `L ${x3} ${y3}`,
    `A ${arred(raioInterno)} ${arred(raioInterno)} 0 ${grande} 0 ${x4} ${y4}`,
    'Z',
  ].join(' ');
}

export function sankeyPorOrigem(origens, opcoes = {}) {
  const altura = opcoes.altura ?? 320;
  return responsivo(altura, 420, (largura, caixa) =>
    desenharSankey(origens, { ...opcoes, altura, largura, caixa }),
  );
}

function desenharSankey(origens, { altura = 320, largura = 900, caixa = null, rotulo = 'Da origem ao desfecho' } = {}) {
  const margemVertical = 12;
  const larguraNo = 12;
  const xEsquerda = 150;
  const xDireita = largura - 150;

  const comVolume = origens.filter((o) => o.novas > 0);
  if (!comVolume.length) return null;

  /* Cor por token do tema, e nao em hex: em hex fixo as mesmas faixas ficam
     ilegiveis no tema claro. */
  const desfechos = [
    { chave: 'sucessos', nome: 'Contrato assinado', cor: 'var(--sucesso)' },
    { chave: 'propostas', nome: 'Em proposta', cor: 'var(--serie-8)' },
    { chave: 'qualificados', nome: 'Qualificados', cor: 'var(--serie-4)' },
    { chave: 'perdas', nome: 'Perdas', cor: 'var(--erro)' },
  ];

  /* Cada lead conta uma vez so, no estagio mais avancado a que chegou. */
  const fluxos = comVolume.map((origem) => {
    const sucessos = origem.sucessos;
    const propostas = Math.max(0, origem.propostas - origem.sucessos);
    const qualificados = Math.max(0, origem.qualificados - origem.propostas);
    const perdas = origem.perdas;
    const restante = Math.max(0, origem.novas - sucessos - propostas - qualificados - perdas);
    return { origem, sucessos, propostas, qualificados, perdas, restante, total: origem.novas };
  });

  const totalGeral = fluxos.reduce((soma, f) => soma + f.total, 0) || 1;
  const alturaUtil = altura - margemVertical * 2 - (fluxos.length - 1) * 6;
  const escala = alturaUtil / totalGeral;

  const totaisDesfecho = {};
  for (const desfecho of desfechos) {
    totaisDesfecho[desfecho.chave] = fluxos.reduce((soma, f) => soma + f[desfecho.chave], 0);
  }
  const totalDesfechos = Object.values(totaisDesfecho).reduce((a, b) => a + b, 0) || 1;

  const svg = no('svg', {
    viewBox: `0 0 ${largura} ${altura}`,
    role: 'img',
    'aria-label': rotulo,
    style: `width:100%;height:${altura}px;overflow:visible;color:var(--texto-suave)`,
  });

  /* Posicao vertical de cada no da direita */
  const alturaDireita = {};
  let cursorDireita = margemVertical;
  for (const desfecho of desfechos) {
    const valor = totaisDesfecho[desfecho.chave];
    const alturaNo = Math.max(valor * escala, valor ? 3 : 0);
    alturaDireita[desfecho.chave] = { topo: cursorDireita, altura: alturaNo, usado: 0 };
    if (valor) cursorDireita += alturaNo + 8;
  }

  const dica = caixa ? criarDica(caixa) : null;

  /* Segue o cursor sem repetir o mesmo bloco em cada forma do diagrama. */
  const ligarDica = (forma, montarLinhas) => {
    if (!dica) return forma;
    forma.addEventListener('pointerenter', () => forma.setAttribute('opacity', '0.75'));
    forma.addEventListener('pointermove', (evento) => {
      const retangulo = svg.getBoundingClientRect();
      dica.mostrar(evento.clientX - retangulo.left, evento.clientY - retangulo.top - 18, montarLinhas());
    });
    forma.addEventListener('pointerleave', () => {
      forma.removeAttribute('opacity');
      dica.esconder();
    });
    return forma;
  };

  let cursorEsquerda = margemVertical;
  for (const fluxo of fluxos) {
    const alturaOrigem = Math.max(fluxo.total * escala, 4);
    let usadoNaOrigem = 0;

    svg.append(
      ligarDica(
        no('rect', {
          x: xEsquerda - larguraNo,
          y: cursorEsquerda,
          width: larguraNo,
          height: alturaOrigem,
          rx: '3',
          fill: 'var(--ouro)',
        }),
        () => [linhaDaDica('var(--ouro)', fluxo.origem.nome, fluxo.total)],
      ),
      texto(fluxo.origem.nome, {
        x: xEsquerda - larguraNo - 8,
        y: cursorEsquerda + alturaOrigem / 2 + 3,
        'text-anchor': 'end',
        'font-size': T_SM,
        fill: 'var(--texto)',
      }),
      texto(`${fluxo.total}`, {
        x: xEsquerda - larguraNo - 8,
        y: cursorEsquerda + alturaOrigem / 2 + 15,
        'text-anchor': 'end',
        'font-size': T_XS,
        fill: 'var(--texto-fraco)',
      }),
    );

    for (const desfecho of desfechos) {
      const valor = fluxo[desfecho.chave];
      if (!valor) continue;

      const espessura = Math.max(valor * escala, 1.5);
      const destino = alturaDireita[desfecho.chave];
      const y0 = cursorEsquerda + usadoNaOrigem;
      const y1 = destino.topo + destino.usado;
      usadoNaOrigem += espessura;
      destino.usado += espessura;

      const meio = (xEsquerda + xDireita) / 2;
      const caminho = [
        `M ${xEsquerda} ${y0}`,
        `C ${meio} ${y0}, ${meio} ${y1}, ${xDireita} ${y1}`,
        `L ${xDireita} ${y1 + espessura}`,
        `C ${meio} ${y1 + espessura}, ${meio} ${y0 + espessura}, ${xEsquerda} ${y0 + espessura}`,
        'Z',
      ].join(' ');

      const banda = no('path', { d: caminho, fill: desfecho.cor, 'fill-opacity': '0.34' });
      if (dica) {
        ligarDica(banda, () => [
          el('div', { class: 'dica-titulo', texto: fluxo.origem.nome }),
          linhaDaDica(desfecho.cor, desfecho.nome, valor),
          el('div', { class: 'dica-linha' }, [
            el('span', { class: 'dica-ponto', estilo: { background: 'var(--ouro)' } }),
            el('span', { class: 'dica-nome', texto: 'De um total de' }),
            el('b', { texto: FORMATO_NUMERO.format(fluxo.total) }),
          ]),
        ]);
      } else {
        banda.append(
          no('title', {}, [
            document.createTextNode(`${fluxo.origem.nome} → ${desfecho.nome}: ${valor} de ${fluxo.total}`),
          ]),
        );
      }
      svg.append(banda);
    }

    cursorEsquerda += alturaOrigem + 6;
  }

  for (const desfecho of desfechos) {
    const info = alturaDireita[desfecho.chave];
    const valor = totaisDesfecho[desfecho.chave];
    if (!valor) continue;
    svg.append(
      ligarDica(
        no('rect', { x: xDireita, y: info.topo, width: larguraNo, height: info.altura, rx: '3', fill: desfecho.cor }),
        () => [linhaDaDica(desfecho.cor, desfecho.nome, valor)],
      ),
      texto(desfecho.nome, {
        x: xDireita + larguraNo + 8,
        y: info.topo + info.altura / 2 + 3,
        'font-size': T_SM,
        fill: 'var(--texto)',
      }),
      texto(`${valor} · ${((valor / totalDesfechos) * 100).toFixed(0)}%`, {
        x: xDireita + larguraNo + 8,
        y: info.topo + info.altura / 2 + 15,
        'font-size': T_XS,
        fill: 'var(--texto-fraco)',
      }),
    );
  }

  return svg;
}


/**
 * Linha minima para caber dentro de um cartao de metrica: sem eixo, sem grade
 * e sem rotulo, porque o numero grande do cartao ja diz o valor. A linha aqui
 * serve so para mostrar o feitio da ultima semana.
 */
export function miniLinha(valores, { cor = 'var(--ouro)', altura = 44 } = {}) {
  const dados = (Array.isArray(valores) ? valores : []).map((valor) => Number(valor) || 0);
  if (!dados.length) return null;

  const largura = 160;
  const folga = 5;
  const areaAltura = Math.max(4, altura - folga * 2);
  const maximo = Math.max(...dados);
  const minimo = Math.min(...dados);
  const faixa = maximo - minimo;

  /* Serie constante ou de um ponto so: linha reta no meio, sem fingir variacao. */
  const reta = faixa === 0 || dados.length === 1;
  const x = (indice) => (dados.length <= 1 ? largura / 2 : (indice / (dados.length - 1)) * largura);
  const y = (valor) => folga + areaAltura - ((valor - minimo) / faixa) * areaAltura;

  const pontos = reta
    ? [
        [0, altura / 2],
        [largura, altura / 2],
      ]
    : dados.map((valor, indice) => [x(indice), y(valor)]);

  const svg = no('svg', {
    viewBox: `0 0 ${largura} ${altura}`,
    preserveAspectRatio: 'none',
    'aria-hidden': 'true',
    focusable: 'false',
    style: `width:100%;height:${altura}px;display:block`,
  });

  const idGradiente = idUnico('mini');
  svg.append(no('defs', {}, [gradienteVertical(idGradiente, cor, 0.22)]));

  const linha = caminhoSuave(pontos, { topo: 0, baixo: altura });
  svg.append(
    no('path', {
      d: `${linha} L ${arred(pontos[pontos.length - 1][0])} ${altura} L ${arred(pontos[0][0])} ${altura} Z`,
      fill: `url(#${idGradiente})`,
      stroke: 'none',
    }),
    no('path', {
      d: linha,
      fill: 'none',
      stroke: cor,
      'stroke-width': '2',
      'stroke-linecap': 'round',
      'stroke-linejoin': 'round',
      'vector-effect': 'non-scaling-stroke',
    }),
  );

  return svg;
}

export function legenda(series) {
  return el(
    'div',
    { class: 'linha-g quebra mt-2 t-xs c-suave' },
    series.map((item) =>
      el('span', { class: 'linha-p' }, [
        el('span', { class: 'legenda-cor', estilo: { background: item.cor } }),
        item.nome,
      ]),
    ),
  );
}

export function funilBarras(etapas, opcoes = {}) {
  const degraus = (Array.isArray(etapas) ? etapas : []).filter((e) => e && e.id !== "perdas");
  const perdas = (Array.isArray(etapas) ? etapas : []).find((e) => e && e.id === "perdas");
  if (degraus.length < 2) return null;

  const altura = opcoes.altura ?? (degraus.length + (perdas ? 1 : 0)) * 38 + 16;
  return responsivo(altura, 360, (largura, caixa) =>
    desenharFunilBarras(degraus, perdas, { ...opcoes, altura, largura, caixa }),
  );
}

function desenharFunilBarras(degraus, perdas, { altura, largura, caixa = null, rotulo = "Do primeiro contato ao contrato" }) {
  const topo = Math.max(1, Number(degraus[0].valor) || 0);
  if (topo <= 0) return null;

  const calha = Math.min(150, Math.max(96, largura * 0.16));
  const reservaDoValor = 54;
  const areaBarra = Math.max(60, largura - calha - reservaDoValor);
  const escala = areaBarra / topo;

  const alturaLinha = 38;
  const alturaBarra = 20;

  const svg = no("svg", {
    viewBox: `0 0 ${largura} ${altura}`,
    role: "img",
    "aria-label": rotulo,
    style: `width:100%;height:${altura}px;display:block;color:var(--texto-fraco)`,
  });
  const caixaDefs = no("defs");
  svg.append(caixaDefs);

  const gradienteDe = (cor) => {
    const id = idUnico("funil");
    caixaDefs.append(
      /* Apaga junto a origem e fecha cheio na ponta: a ponta e onde esta o
         numero, e e para la que o olho precisa ir. */
      no("linearGradient", { id, x1: "0", y1: "0", x2: "1", y2: "0" }, [
        no("stop", { offset: "0%", "stop-color": cor, "stop-opacity": "0.72" }),
        no("stop", { offset: "100%", "stop-color": cor, "stop-opacity": "1" }),
      ]),
    );
    return id;
  };

  const dica = caixa ? criarDica(caixa) : null;

  const barra = (indice, item, larguraAnterior) => {
    const y = 8 + indice * alturaLinha;
    const meio = y + alturaBarra / 2;
    const valor = Math.max(0, Number(item.valor) || 0);
    const w = Math.max(valor > 0 ? 2 : 0, valor * escala);
    const r = Math.min(3, alturaBarra / 2);

    svg.append(
      texto(item.nome, { x: 0, y: meio + 4, fill: "var(--texto-suave)", "font-size": T_SM }),
    );

    /* O vao ate a barra de cima e a queda. Fica so contornado, porque e
       ausencia: preencher daria a ela o mesmo peso de quem seguiu. */
    if (larguraAnterior !== null && larguraAnterior > w + 1) {
      svg.append(
        no("rect", {
          x: arred(calha + w),
          y: arred(y),
          width: arred(larguraAnterior - w),
          height: alturaBarra,
          rx: r,
          fill: "none",
          stroke: "var(--erro)",
          "stroke-opacity": "0.4",
          "stroke-dasharray": "2 3",
        }),
      );
    }

    if (w > 0) {
      const barra = no("rect", {
        x: arred(calha),
        y: arred(y),
        width: arred(w),
        height: alturaBarra,
        rx: r,
        fill: `url(#${gradienteDe(item.cor || "var(--ouro)")})`,
      });

      if (dica) {
        const perdeu =
          larguraAnterior !== null && larguraAnterior > w + 1
            ? Math.round((larguraAnterior - w) / escala)
            : 0;
        barra.addEventListener("pointermove", (evento) => {
          const retangulo = svg.getBoundingClientRect();
          dica.mostrar(evento.clientX - retangulo.left, evento.clientY - retangulo.top - 18, [
            linhaDaDica(item.cor || "var(--ouro)", item.nome, valor),
            /* A queda so aparece quando existe etapa anterior: em Nova conversa
               nao ha de onde cair, e um "0 perdidas" ali seria ruido. */
            perdeu
              ? el("div", { class: "dica-linha" }, [
                  el("span", { class: "dica-ponto", estilo: { background: "var(--erro)" } }),
                  el("span", { class: "dica-nome", texto: "Perdeu nesta etapa" }),
                  el("b", { texto: FORMATO_NUMERO.format(perdeu) }),
                ])
              : null,
          ]);
        });
        barra.addEventListener("pointerleave", () => dica.esconder());
      } else {
        barra.append(titulo(`${item.nome}: ${FORMATO_NUMERO.format(valor)}`));
      }

      svg.append(barra);
    }

    svg.append(
      texto(FORMATO_NUMERO.format(valor), {
        x: arred(calha + w + 8),
        y: meio + 4,
        fill: "var(--texto)",
        "font-size": T_SM,
        "font-weight": "600",
      }),
    );

    return w;
  };

  let anterior = null;
  degraus.forEach((item, indice) => {
    anterior = barra(indice, item, anterior);
  });

  if (perdas) barra(degraus.length, { ...perdas, cor: "var(--erro)" }, null);

  return svg;
}

/**
 * Rosca de distribuicao.
 *
 * Anel com uma fatia por categoria, com folga entre elas para o olho separar
 * fatia pequena de fatia pequena. O centro fica vazio de proposito: o total ja
 * vive no cabeco da secao, e numero grande dentro do anel disputa atencao com
 * a propria divisao que o anel mostra.
 */
export function rosca(fatias, opcoes = {}) {
  const lista = (Array.isArray(fatias) ? fatias : [])
    .map((f) => ({ nome: f.nome, valor: Math.max(0, Number(f.valor) || 0), cor: f.cor }))
    .filter((f) => f.valor > 0);
  if (!lista.length) return null;

  const altura = opcoes.altura ?? 176;
  return responsivo(altura, 150, (largura, caixa) => desenharRosca(lista, { ...opcoes, altura, largura, caixa }));
}

function desenharRosca(lista, { altura, largura, espessura = 26, caixa = null, rotulo = 'Distribuicao' }) {
  const total = lista.reduce((s, f) => s + f.valor, 0);
  if (total <= 0) return null;

  const lado = Math.min(altura, largura);
  const centroX = largura / 2;
  const centroY = altura / 2;
  const raioExterno = lado / 2 - 6;
  const raioInterno = Math.max(8, raioExterno - espessura);

  const svg = no('svg', {
    viewBox: `0 0 ${largura} ${altura}`,
    role: 'img',
    'aria-label': `${rotulo}, ${FORMATO_NUMERO.format(total)} no total: ${lista
      .map((f) => `${f.nome} ${FORMATO_NUMERO.format(f.valor)}`)
      .join(', ')}`,
    style: `width:100%;height:${altura}px;display:block`,
  });

  /* Comeca no topo, e nao na direita: e de la que o olho comeca a ler. */
  let angulo = -Math.PI / 2;
  /* A folga e angular, entao fatia minuscula sumiria dentro do proprio vao.
     O piso garante que toda categoria contada continue visivel. */
  const folga = lista.length > 1 ? 0.012 : 0;

  const dica = caixa ? criarDica(caixa) : null;

  for (const fatia of lista) {
    const varredura = Math.max(folga * 2 + 0.004, (fatia.valor / total) * VOLTA);
    const pedaco = no('path', {
      d: arcoDeAnel(centroX, centroY, raioExterno, raioInterno, angulo + folga / 2, varredura - folga),
      fill: fatia.cor || 'var(--ouro)',
    });

    if (dica) {
      /* A fatia clareia sob o cursor: sem isso, com o balao aberto, nao da
         para saber de qual pedaco do anel ele esta falando. */
      pedaco.addEventListener('pointerenter', () => pedaco.setAttribute('opacity', '0.72'));
      pedaco.addEventListener('pointermove', (evento) => {
        const retangulo = svg.getBoundingClientRect();
        dica.mostrar(evento.clientX - retangulo.left, evento.clientY - retangulo.top - 18, [
          linhaDaDica(fatia.cor || 'var(--ouro)', fatia.nome, fatia.valor),
        ]);
      });
      pedaco.addEventListener('pointerleave', () => {
        pedaco.removeAttribute('opacity');
        dica.esconder();
      });
    } else {
      pedaco.append(titulo(`${fatia.nome}: ${FORMATO_NUMERO.format(fatia.valor)}`));
    }

    svg.append(pedaco);
    angulo += varredura;
  }

  return svg;
}

/**
 * Evolucao no tempo, uma area por etapa do funil.
 *
 * Area empilhada nao: cada serie desenha a propria area a partir da linha de
 * base, com o preenchimento apagando para baixo. Empilhada, o valor de uma
 * etapa passaria a depender da altura das outras e ninguem conseguiria ler o
 * numero de nenhuma.
 */
export function graficoEvolucao(opcoes = {}) {
  const altura = opcoes.altura ?? 300;
  return responsivo(altura, 420, (largura, caixa) => desenharEvolucao({ ...opcoes, altura, largura, caixa }));
}

function desenharEvolucao({
  serie,
  series,
  altura = 300,
  largura = 900,
  percentual = false,
  teto = null,
  caixa = null,
  rotulo = 'Evolucao no periodo',
}) {
  const linhas = Array.isArray(serie) ? serie : [];
  const defs = Array.isArray(series) ? series : [];
  if (!linhas.length || !defs.length) return null;

  const margem = { topo: 14, direita: 10, baixo: 34, esquerda: 38 };
  const areaLargura = Math.max(40, largura - margem.esquerda - margem.direita);
  const base = altura - margem.baixo;
  const areaAltura = Math.max(30, base - margem.topo);

  const bruto = Math.max(1, ...linhas.flatMap((l) => defs.map((d) => Number(l[d.chave]) || 0)));
  /* Teto redondo: com o maximo cru, o eixo saia com 7, 13 ou 41 no rotulo, e
     numero quebrado no eixo obriga a pessoa a interpretar em vez de ler. */
  const maximo = percentual ? 100 : teto || arredondarParaCima(bruto);

  const x = (i) => margem.esquerda + (linhas.length <= 1 ? areaLargura / 2 : (i / (linhas.length - 1)) * areaLargura);
  const y = (v) => margem.topo + areaAltura - (Math.min(v, maximo) / maximo) * areaAltura;

  /*
   * O rotulo acessivel carrega os numeros, e nao so o nome do grafico.
   *
   * O balao que aparece no cursor e a leitura de quem tem mouse. Quem usa
   * leitor de tela ouvia "Evolucao no periodo" e mais nada: um grafico sem
   * dado nenhum. Aqui vai o total de cada serie e o periodo de pico, que e o
   * que a curva mostra de relance para quem enxerga.
   */
  const resumo = defs
    .map((definicao) => {
      const valores = linhas.map((l) => Number(l[definicao.chave]) || 0);
      const total = valores.reduce((a, b) => a + b, 0);
      const maior = Math.max(...valores);
      const quando = maior > 0 ? rotuloDoPeriodo(linhas[valores.indexOf(maior)].periodo) : null;
      const unidade = percentual ? '%' : '';
      return quando
        ? `${definicao.nome}: ${FORMATO_NUMERO.format(total)}${unidade}, com pico de ${FORMATO_NUMERO.format(maior)}${unidade} em ${quando}`
        : `${definicao.nome}: nenhum no periodo`;
    })
    .join('. ');

  const svg = no('svg', {
    viewBox: `0 0 ${largura} ${altura}`,
    role: 'img',
    'aria-label': `${rotulo}. ${resumo}.`,
    style: `width:100%;height:${altura}px;display:block;color:var(--texto-fraco)`,
  });
  const caixaDefs = no('defs');
  svg.append(caixaDefs);

  /* Grade e escala. Quatro linhas: menos que isso nao da referencia, mais
     que isso vira papel quadriculado. */
  for (let i = 0; i <= 4; i += 1) {
    const valor = (maximo / 4) * i;
    const posicao = y(valor);
    svg.append(
      no('line', {
        x1: margem.esquerda,
        x2: largura - margem.direita,
        y1: arred(posicao),
        y2: arred(posicao),
        stroke: 'var(--borda)',
        'stroke-width': '1',
        'stroke-dasharray': i ? '2 4' : '0',
      }),
      texto(percentual ? `${Math.round(valor)}%` : FORMATO_NUMERO.format(valor), {
        x: margem.esquerda - 6,
        y: arred(posicao) + 4,
        'text-anchor': 'end',
        fill: 'var(--texto-fraco)',
      }),
    );
  }

  for (const definicao of defs) {
    const pontos = linhas.map((linha, i) => [x(i), y(Number(linha[definicao.chave]) || 0)]);
    const caminho = caminhoSuave(pontos, { topo: margem.topo, baixo: base });
    const idGradiente = idUnico('area');
    caixaDefs.append(gradienteVertical(idGradiente, definicao.cor, 0.28, margem.topo, base));

    svg.append(
      no('path', {
        d: `${caminho} L ${arred(pontos[pontos.length - 1][0])} ${arred(base)} L ${arred(pontos[0][0])} ${arred(base)} Z`,
        fill: `url(#${idGradiente})`,
        stroke: 'none',
      }),
      no('path', {
        d: caminho,
        fill: 'none',
        stroke: definicao.cor,
        'stroke-width': '2',
        'stroke-linecap': 'round',
        'stroke-linejoin': 'round',
        'vector-effect': 'non-scaling-stroke',
        /* Sem eventos de ponteiro: quem responde ao cursor e o retangulo de
           captura, que cobre a area inteira. A curva no caminho interceptava e
           deixava buracos na leitura. */
        'pointer-events': 'none',
      }),
    );
  }

  /*
   * Camada de leitura: linha-guia, marcador em cada serie e o balao com o dia
   * inteiro. Fica por cima de tudo, com um retangulo transparente que captura
   * o ponteiro em qualquer altura do grafico. Sem ele, so haveria leitura em
   * cima da propria curva, que e uma mira de dois pixels.
   */
  if (caixa) {
    const dica = criarDica(caixa);
    const guia = no('line', {
      y1: margem.topo,
      y2: base,
      stroke: 'var(--texto-fraco)',
      'stroke-width': '1',
      'stroke-dasharray': '3 3',
      opacity: '0',
      'pointer-events': 'none',
    });
    const marcadores = defs.map((definicao) =>
      no('circle', {
        r: '3.5',
        fill: 'var(--superficie)',
        stroke: definicao.cor,
        'stroke-width': '2',
        opacity: '0',
        'pointer-events': 'none',
      }),
    );
    const captura = no('rect', {
      x: margem.esquerda,
      y: margem.topo,
      width: areaLargura,
      height: areaAltura,
      fill: 'transparent',
    });

    const mostrar = (evento) => {
      const retangulo = svg.getBoundingClientRect();
      /* O viewBox tem a largura real em pixels, entao a conversao e direta.
         Ainda assim a escala entra na conta: em tela com zoom o retangulo
         medido nao bate com as unidades do viewBox. */
      const escala = retangulo.width / largura || 1;
      const posX = (evento.clientX - retangulo.left) / escala;
      const passoX = linhas.length > 1 ? areaLargura / (linhas.length - 1) : areaLargura;
      const indice = Math.max(
        0,
        Math.min(linhas.length - 1, Math.round((posX - margem.esquerda) / passoX)),
      );
      const linha = linhas[indice];
      const alvoX = x(indice);

      guia.setAttribute('x1', arred(alvoX));
      guia.setAttribute('x2', arred(alvoX));
      guia.setAttribute('opacity', '1');
      defs.forEach((definicao, i) => {
        marcadores[i].setAttribute('cx', arred(alvoX));
        marcadores[i].setAttribute('cy', arred(y(Number(linha[definicao.chave]) || 0)));
        marcadores[i].setAttribute('opacity', '1');
      });

      dica.mostrar(alvoX * escala, (evento.clientY - retangulo.top) - 20, [
        el('div', { class: 'dica-titulo', texto: rotuloDoPeriodo(linha.periodo) }),
        ...defs.map((definicao) => {
          const valor = Number(linha[definicao.chave]) || 0;
          return linhaDaDica(definicao.cor, definicao.nome, percentual ? valor : Math.round(valor));
        }),
      ]);
    };

    const esconder = () => {
      guia.setAttribute('opacity', '0');
      for (const marcador of marcadores) marcador.setAttribute('opacity', '0');
      dica.esconder();
    };

    captura.addEventListener('pointermove', mostrar);
    captura.addEventListener('pointerleave', esconder);
    svg.append(guia, ...marcadores, captura);
  }

  /* Com muitos periodos os rotulos se atropelam. Mostra um a cada N, e sempre
     o primeiro e o ultimo, que sao os que delimitam a janela. */
  const passo = Math.max(1, Math.ceil(linhas.length / Math.max(2, Math.floor(areaLargura / 72))));
  linhas.forEach((linha, i) => {
    if (i % passo && i !== linhas.length - 1) return;
    svg.append(
      texto(rotuloDoPeriodo(linha.periodo), {
        x: arred(x(i)),
        y: altura - 12,
        'text-anchor': i === 0 ? 'start' : i === linhas.length - 1 ? 'end' : 'middle',
        fill: 'var(--texto-fraco)',
      }),
    );
  });

  return svg;
}

/** Teto redondo para o eixo: 1, 2 ou 5 vezes uma potencia de dez. */
function arredondarParaCima(valor) {
  const potencia = 10 ** Math.floor(Math.log10(valor));
  for (const passo of [1, 2, 5, 10]) {
    const alvo = passo * potencia;
    if (alvo >= valor) return alvo;
  }
  return potencia * 10;
}

/* Dica de grafico ------------------------------------------------------- */

/**
 * Balao que segue o cursor dentro do grafico.
 *
 * O atributo title do SVG ate mostra o valor, mas com o atraso do sistema
 * operacional, um item por vez e sem controle nenhum de aparencia. Num grafico
 * de oito series, ler uma de cada vez nao responde a pergunta: o que se quer
 * saber e como estava o dia inteiro naquele ponto.
 */
function criarDica(caixa) {
  /* Reaproveita o balao existente: o desenho e refeito a cada mudanca de
     largura, e criar um novo em cada volta empilharia baloes invisiveis. */
  let no = caixa.querySelector(':scope > .dica-grafico');
  if (!no) {
    no = el('div', { class: 'dica-grafico', hidden: true });
    caixa.append(no);
  }

  return {
    mostrar(x, y, filhos) {
      no.replaceChildren(...filhos.filter(Boolean));
      no.removeAttribute('hidden');

      /* Posiciona depois de medir: so com o conteudo dentro da para saber se o
         balao cabe a direita do cursor ou se precisa virar para a esquerda. */
      const larguraCaixa = caixa.clientWidth;
      const larguraDica = no.offsetWidth;
      const folga = 14;
      const cabeADireita = x + folga + larguraDica <= larguraCaixa;
      no.style.left = `${Math.max(0, cabeADireita ? x + folga : x - folga - larguraDica)}px`;
      no.style.top = `${Math.max(0, Math.min(y, caixa.clientHeight - no.offsetHeight))}px`;
    },
    esconder() {
      no.setAttribute('hidden', '');
    },
  };
}

/** Uma linha do balao: bolinha da cor, nome, e o valor alinhado a direita. */
function linhaDaDica(cor, nome, valor) {
  return el('div', { class: 'dica-linha' }, [
    el('span', { class: 'dica-ponto', estilo: { background: cor } }),
    el('span', { class: 'dica-nome', texto: nome }),
    el('b', { texto: FORMATO_NUMERO.format(valor) }),
  ]);
}
