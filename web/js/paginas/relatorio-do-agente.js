import { api } from '../api.js';
import { gaveta } from '../componentes.js';
import { areaTexto, aviso, botao, campo, cartao, el, interruptor, limpar, modal, numero, selecao, selo, vazio } from '../ui.js';

/**
 * O agente de relatorios (servidor/ia/agente-de-relatorios.js): o cartao no
 * alto da tela de Relatorios com o que aconteceu no fim de semana — leads que
 * entraram e foram atendidos, qualificados e desqualificados, com estatistica e
 * comparacao com o fim de semana anterior.
 *
 * Os numeros vem do servidor, ja contados; esta tela so desenha. O texto vem
 * do agente (ou, sem IA, o texto padrao) e e desenhado por blocos — titulo
 * "## ", item "- ", paragrafo — sem innerHTML: o que o modelo escreveu nunca
 * vira marcacao.
 */

const ETAPAS = [
  ['nova', 'Nova conversa', 'var(--serie-1)'],
  ['analise', 'Em análise', 'var(--serie-2)'],
  ['qualificado', 'Qualificado', 'var(--serie-3)'],
  ['proposta', 'Proposta', 'var(--serie-4)'],
  ['sucesso', 'Sucesso', 'var(--sucesso)'],
  ['desqualificado', 'Desqualificado', 'var(--serie-5)'],
  ['recusada', 'Recusada', 'var(--erro)'],
  ['desistencia', 'Desistência', 'var(--serie-8)'],
  ['nenhum', 'Sem classificação', 'var(--texto-fraco)'],
];

const ONDE_ESTAO = [
  ['comIa', 'Com a IA'],
  ['aguardandoHumano', 'Esperando a equipe'],
  ['emAtendimento', 'Em atendimento'],
  ['concluidos', 'Concluídos'],
];

/* So a palavra, no singular ou no plural: o plural() do ui.js devolve o numero
   junto ("46 leads"), e aqui o numero quase sempre ja esta escrito ao lado. */
const palavra = (n, um, varios) => (Number(n) === 1 ? um : varios);

const quando = (iso) =>
  iso
    ? new Date(iso).toLocaleString('pt-BR', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit', timeZone: 'America/Sao_Paulo' })
    : '';

const sinal = (v) => (v == null ? '' : v.diferenca > 0 ? `+${numero(v.diferenca)}` : v.diferenca < 0 ? `−${numero(Math.abs(v.diferenca))}` : 'igual');

/** O texto do agente em blocos: "## " titulo, "- " item, o resto paragrafo. */
export function blocosDoTexto(texto) {
  const blocos = [];
  let lista = null;
  /* "Pontos de atencao" ganha uma caixa propria: e a parte do relatorio que pede
     uma providencia, e nao pode se perder no meio do texto corrido. */
  let caixa = null;
  const colocar = (no) => (caixa ? caixa.append(no) : blocos.push(no));
  for (const linha of String(texto || '').split('\n')) {
    const t = linha.trim();
    if (!t) {
      lista = null;
    } else if (t.startsWith('## ')) {
      lista = null;
      caixa = null;
      const titulo = el('h3', { class: 'relatorio-secao', texto: t.slice(3) });
      if (/^pontos de aten/i.test(t.slice(3))) {
        caixa = el('div', { class: 'relatorio-atencao', role: 'note' });
        blocos.push(caixa);
      }
      colocar(titulo);
    } else if (t.startsWith('- ')) {
      if (!lista) {
        lista = el('ul', { class: 'relatorio-lista' });
        colocar(lista);
      }
      lista.append(el('li', { texto: t.slice(2) }));
    } else {
      lista = null;
      colocar(el('p', { texto: t }));
    }
  }
  return blocos;
}

/** O mesmo texto para colar no WhatsApp: titulo em negrito, itens com bolinha. */
function textoParaCopiar(r) {
  const linhas = String(r.texto || '').split('\n').map((l) => (l.startsWith('## ') ? `*${l.slice(3)}*` : l.startsWith('- ') ? `• ${l.slice(2)}` : l));
  return linhas.join('\n').trim();
}

function metrica(rotulo, valor, apoio, comparacao) {
  return el('div', { class: 'metrica' }, [
    el('div', { class: 'valor', texto: valor }),
    el('div', { class: 'rotulo', texto: rotulo }),
    apoio ? el('div', { class: 'nota', texto: apoio }) : null,
    comparacao ? el('div', { class: 'nota', texto: comparacao }) : null,
  ]);
}

function barras(itens, { maximo } = {}) {
  const topo = maximo ?? Math.max(1, ...itens.map((i) => i.valor));
  return el(
    'ul',
    { class: 'barras-cat' },
    itens.map((i) =>
      el('li', {}, [
        el('span', { class: 'nome', texto: i.nome, title: i.nome }),
        el('span', { class: 'trilho' }, [el('i', { estilo: { width: `${Math.max(i.valor ? 3 : 0, (i.valor / topo) * 100)}%`, background: i.cor || 'var(--ouro)' } })]),
        el('span', { class: 'valor', texto: numero(i.valor) }),
      ]),
    ),
  );
}

function graficoDeHoras(porHora) {
  const topo = Math.max(1, ...porHora.map((h) => h.novos));
  return el('div', { class: 'relatorio-horas', role: 'img', 'aria-label': 'Leads que chegaram, por hora do dia' }, porHora.map((h) =>
    el('div', { class: 'relatorio-hora', title: `${h.hora}h: ${h.novos} ${palavra(h.novos, 'lead', 'leads')}` }, [
      el('span', { class: 'relatorio-hora-valor', texto: h.novos ? String(h.novos) : '' }),
      el('i', { estilo: { '--v': String((h.novos / topo) * 100) } }),
      el('span', { class: 'relatorio-hora-rotulo', texto: h.hora % 3 === 0 ? `${h.hora}h` : '' }),
    ]),
  ));
}

function tabelaDosDias(porDia) {
  const celula = (v) => el('td', { class: 'n', texto: numero(v) });
  return el('div', { class: 'tabela-rolagem' }, [
    el('table', { class: 'relatorio-tabela tabela-densa' }, [
      el('thead', {}, [el('tr', {}, ['Dia', 'Leads', 'Atendidos', 'Qualificados', 'Desqualificados', 'Recebidas', 'Enviadas'].map((t, i) => el('th', { class: i ? 'n' : '', texto: t })))]),
      el('tbody', {}, porDia.map((d) => el('tr', {}, [el('td', { texto: d.rotulo }), celula(d.novos), celula(d.atendidos), celula(d.qualificados), celula(d.desqualificados), celula(d.recebidas), celula(d.enviadas)]))),
    ]),
  ]);
}

function corpoDoRelatorio(r) {
  const e = r.estatisticas;
  const l = e.leads;
  const q = e.qualificacao;
  const v = e.comparacao.variacao;
  const antes = 'em relação ao período anterior';
  const comparar = (x) => (x ? `${sinal(x)} ${antes}` : '');

  const tempo = l.primeiraResposta;
  const metricas = el('div', { class: 'metricas mb-4' }, [
    metrica(palavra(l.novos, 'lead novo', 'leads novos'), numero(l.novos), l.criadosPelaEquipe ? `${numero(l.criadosPelaEquipe)} aberto${l.criadosPelaEquipe === 1 ? '' : 's'} pela equipe, fora da conta` : null, comparar(v.novos)),
    metrica(palavra(l.atendidos, 'atendido', 'atendidos'), numero(l.atendidos), l.atendidosPct == null ? null : `${numero(l.atendidosPct)}% dos leads novos`, comparar(v.atendidos)),
    metrica(palavra(q.qualificados.total, 'qualificado', 'qualificados'), numero(q.qualificados.total), q.qualificados.total ? `${numero(q.qualificados.deLeadsNovos)} novos e ${numero(q.qualificados.deConversasAntigas)} de conversas antigas` : null, comparar(v.qualificados)),
    metrica(palavra(q.desqualificados.total, 'desqualificado', 'desqualificados'), numero(q.desqualificados.total), q.desqualificados.total ? `${numero(q.desqualificados.deLeadsNovos)} novos e ${numero(q.desqualificados.deConversasAntigas)} de conversas antigas` : null, comparar(v.desqualificados)),
    metrica('até a primeira resposta', tempo.medianaTxt || '—', tempo.amostras ? `mediana de ${numero(tempo.amostras)} ${palavra(tempo.amostras, 'lead', 'leads')}` : 'ninguém foi respondido', e.comparacao.anterior.medianaTxt ? `antes: ${e.comparacao.anterior.medianaTxt}` : ''),
  ]);

  const aviso1 = r.avisoDaIa ? el('div', { class: 'relatorio-aviso', role: 'note' }, [el('strong', { texto: 'Texto padrão. ' }), r.avisoDaIa]) : null;

  const etapas = ETAPAS.map(([id, nome, cor]) => ({ nome, cor, valor: e.etapaDosLeadsNovos[id] || 0 })).filter((x) => x.valor);
  const onde = ONDE_ESTAO.map(([id, nome]) => ({ nome, valor: e.ondeEstaoOsLeadsNovos[id] || 0 }));
  const quemRespondeu = (e.quemRespondeuPrimeiro || []).map((x) => ({ nome: x.classe === 'ia' ? `${x.nome} (IA)` : x.nome, valor: x.atendidos }));
  const porNumero = (e.porNumero || []).map((x) => ({ nome: x.nome, valor: x.novos }));
  const porCanal = (e.porCanal || []).map((x) => ({ nome: x.nome, valor: x.novos }));
  const porOrigem = (e.porOrigem || []).filter((x) => x.nome !== 'Sem informação' || (e.porOrigem || []).length > 1).map((x) => ({ nome: x.nome, valor: x.novos }));

  const blocoCom = (titulo, ajuda, conteudo, extra = '') => el('div', { class: `relatorio-bloco ${extra}`.trim() }, [el('h4', { texto: titulo }), ajuda ? el('p', { class: 'relatorio-bloco-ajuda', texto: ajuda }) : null, conteudo]);
  const vazioDe = (texto) => el('p', { class: 't-sm c-fraco', texto });

  const graficos = el('div', { class: 'grade g2 relatorio-graficos' }, [
    blocoCom('Dia a dia', null, tabelaDosDias(e.porDia), 'relatorio-bloco-largo'),
    blocoCom('Quando os leads chegaram', e.picoDeEntrada ? `Mais leads ${e.picoDeEntrada.txt} (${numero(e.picoDeEntrada.novos)}). Horário de São Paulo.` : 'Horário de São Paulo.', l.novos ? graficoDeHoras(e.porHora) : vazioDe('Nenhum lead novo no período.')),
    blocoCom('Onde os leads novos estão agora', 'Etapa em que cada lead novo está hoje.', etapas.length ? barras(etapas) : vazioDe('Nenhum lead novo no período.')),
    blocoCom('Com quem estão', null, l.novos ? barras(onde) : vazioDe('Nenhum lead novo no período.')),
    blocoCom('Quem respondeu primeiro', 'A primeira resposta de cada lead atendido.', quemRespondeu.length ? barras(quemRespondeu) : vazioDe('Ninguém respondeu leads novos.')),
    blocoCom('De onde vieram', 'Por número conectado e por canal.', porNumero.length ? el('div', { class: 'pilha-g' }, [barras(porNumero), porCanal.length > 1 || porCanal[0]?.nome !== 'WhatsApp' ? barras(porCanal) : null, porOrigem.length > 1 ? barras(porOrigem) : null]) : vazioDe('Nenhum lead novo no período.')),
  ]);

  const numerosSoltos = el('p', { class: 'relatorio-rodape-numeros', texto: [
    `${numero(e.mensagens.recebidas)} ${palavra(e.mensagens.recebidas, 'mensagem recebida', 'mensagens recebidas')} (${numero(e.mensagens.audiosRecebidos)} em áudio) e ${numero(e.mensagens.enviadas)} ${palavra(e.mensagens.enviadas, 'enviada', 'enviadas')} (${numero(e.mensagens.enviadasPorIa)} pela IA, ${numero(e.mensagens.enviadasPorPessoas)} pela equipe)`,
    `${numero(l.conversasAtivas)} ${palavra(l.conversasAtivas, 'conversa falou', 'conversas falaram')} com o escritório, ${numero(l.retornos)} ${palavra(l.retornos, 'delas antiga', 'delas antigas')}`,
    e.contratos.assinados ? `${numero(e.contratos.assinados)} ${palavra(e.contratos.assinados, 'contrato assinado', 'contratos assinados')}` : null,
    e.followups.enviados ? `${numero(e.followups.enviados)} ${palavra(e.followups.enviados, 'follow-up enviado', 'follow-ups enviados')}` : null,
    e.falhas.total ? `${numero(e.falhas.total)} ${palavra(e.falhas.total, 'falha', 'falhas')} da IA, do envio ou da voz` : null,
  ].filter(Boolean).join(' · ') + '.' });

  const definicoes = el('details', { class: 'relatorio-definicoes' }, [
    el('summary', { texto: 'Como contamos' }),
    el('ul', { class: 'relatorio-lista' }, (e.definicoes || []).map((d) => el('li', { texto: d }))),
  ]);

  return [
    aviso1,
    metricas,
    el('div', { class: 'relatorio-texto' }, blocosDoTexto(r.texto)),
    e.semMovimento ? null : graficos,
    e.semMovimento ? null : numerosSoltos,
    definicoes,
  ];
}

function imprimir(r) {
  const e = r.estatisticas;
  const esc = (t) => String(t ?? '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
  const texto = String(r.texto || '')
    .split('\n')
    .map((l) => (l.startsWith('## ') ? `<h2>${esc(l.slice(3))}</h2>` : l.startsWith('- ') ? `<p class="item">• ${esc(l.slice(2))}</p>` : l.trim() ? `<p>${esc(l)}</p>` : ''))
    .join('');
  const linhas = e.porDia.map((d) => `<tr><td>${esc(d.rotulo)}</td><td class="n">${d.novos}</td><td class="n">${d.atendidos}</td><td class="n">${d.qualificados}</td><td class="n">${d.desqualificados}</td></tr>`).join('');
  const cartoes = [
    ['Leads novos', e.leads.novos],
    ['Atendidos', e.leads.atendidos],
    ['Qualificados', e.qualificacao.qualificados.total],
    ['Desqualificados', e.qualificacao.desqualificados.total],
    ['Até a 1ª resposta', e.leads.primeiraResposta.medianaTxt || '—'],
  ].map(([t, v]) => `<div class="c"><b>${esc(v)}</b><span>${esc(t)}</span></div>`).join('');
  const html = `<!doctype html><html lang="pt-BR"><head><meta charset="utf-8"><title>Relatório — ${esc(r.periodo.rotulo)}</title>
    <style>
      * { box-sizing: border-box; }
      body { font: 14px/1.5 -apple-system, Segoe UI, Roboto, sans-serif; color: #141414; margin: 32px; }
      header { display: flex; align-items: center; gap: 16px; border-bottom: 2px solid #141414; padding-bottom: 12px; margin-bottom: 20px; }
      header img { height: 48px; width: auto; flex: none; }
      h1 { font-size: 20px; margin: 0; } .sub { color: #555; margin-top: 4px; }
      h2 { font-size: 15px; margin: 22px 0 6px; } p { margin: 4px 0; } .item { padding-left: 4px; }
      .cartoes { display: flex; gap: 12px; flex-wrap: wrap; margin-bottom: 8px; }
      .c { border: 1px solid #ccc; border-radius: 6px; padding: 10px 14px; min-width: 120px; }
      .c b { display: block; font-size: 24px; } .c span { color: #555; font-size: 12px; }
      table { width: 100%; border-collapse: collapse; margin-top: 6px; }
      th, td { text-align: left; padding: 6px 8px; border-bottom: 1px solid #ddd; } th.n, td.n { text-align: right; }
      thead th { background: #f3f3f3; } footer { margin-top: 28px; color: #999; font-size: 12px; }
      @media print { body { margin: 0; } }
    </style></head><body>
    <header><img src="${location.origin}/assets/logo.png" alt="" onerror="this.remove()">
      <div><h1>Correia Advogados — Relatório do atendimento</h1><div class="sub">${esc(r.periodo.rotulo)}${r.periodo.parcial ? ' (até o momento da geração)' : ''}</div></div></header>
    <div class="cartoes">${cartoes}</div>
    ${texto}
    <h2>Dia a dia</h2>
    <table><thead><tr><th>Dia</th><th class="n">Leads</th><th class="n">Atendidos</th><th class="n">Qualificados</th><th class="n">Desqualificados</th></tr></thead><tbody>${linhas}</tbody></table>
    <h2>Como contamos</h2>${(e.definicoes || []).map((d) => `<p class="item">• ${esc(d)}</p>`).join('')}
    <footer>Gerado em ${esc(quando(r.geradoEm))} pelo Atilhus Chat.</footer></body></html>`;
  const janela = window.open('', '_blank');
  if (!janela) {
    aviso('O navegador bloqueou a janela de impressão. Permita pop-ups para gerar o PDF.', 'erro');
    return;
  }
  janela.document.write(html);
  janela.document.close();
  janela.focus();
  setTimeout(() => janela.print(), 300);
}

/** Desenha o cartao do agente em `area`. Nao desenha nada para quem nao e dono nem administrador. */
export async function pintarAgenteDeRelatorios(area) {
  let painel;
  try {
    painel = await api.get('/api/relatorios/agente');
  } catch (erro) {
    limpar(area);
    area.append(cartao('Agente de relatórios', null, vazio('Não consegui carregar o agente', erro.message, botao('Tentar de novo', { aoClicar: () => pintarAgenteDeRelatorios(area) }))));
    return;
  }
  if (!painel.permitido) {
    limpar(area);
    return;
  }

  let { config, historico, opcoes } = painel;
  let aberto = painel.atual;
  let escolha = painel.padrao.de;
  let gerando = painel.gerando;

  async function gerar() {
    const fim = opcoes.find((o) => o.de === escolha) || opcoes[0];
    gerando = true;
    desenhar();
    try {
      aberto = await api.post('/api/relatorios/agente/gerar', { de: fim.de, ate: fim.ate });
      historico = (await api.get('/api/relatorios/agente')).historico;
      aviso('Relatório pronto.', 'sucesso');
    } catch (erro) {
      aviso(`Não consegui gerar o relatório: ${erro.message}`, 'erro');
    } finally {
      gerando = false;
      desenhar();
    }
  }

  async function abrir(id) {
    try {
      aberto = await api.get(`/api/relatorios/agente/${id}`);
      desenhar();
    } catch (erro) {
      aviso(erro.message, 'erro');
    }
  }

  function apagar(r) {
    modal({
      titulo: 'Apagar este relatório?',
      corpo: el('p', { texto: `${r.periodo.rotulo}, gerado em ${quando(r.geradoEm)}. Dá para gerar de novo quando quiser.` }),
      confirmar: 'Apagar',
      aoConfirmar: async () => {
        await api.delete(`/api/relatorios/agente/${r.id}`);
        historico = historico.filter((x) => x.id !== r.id);
        if (aberto?.id === r.id) aberto = historico[0] ? await api.get(`/api/relatorios/agente/${historico[0].id}`) : null;
        desenhar();
      },
    });
  }

  async function copiar(r) {
    try {
      await navigator.clipboard.writeText(textoParaCopiar(r));
      aviso('Texto copiado. É só colar no WhatsApp.', 'sucesso');
    } catch {
      aviso('O navegador não deixou copiar. Selecione o texto e copie à mão.', 'erro');
    }
  }

  function editarInstrucoes() {
    let automatico = config.automatico;
    const instrucoes = areaTexto(config.instrucoes, { rows: 6, maxlength: 2000, placeholder: 'Ex.: compare sempre com a meta de 50 leads por semana. Destaque os leads que chegaram à noite.' });
    gaveta({
      titulo: 'Instruções do agente',
      descricao: 'O agente já sabe contar e escrever o relatório. Aqui você acrescenta o que quer que ele observe. Ele só usa números que o sistema contou; instrução nenhuma o faz inventar dado.',
      corpo: el('div', { class: 'pilha-g' }, [
        interruptor('Gerar sozinho toda segunda, às 7h', automatico, (ligado) => (automatico = ligado)),
        campo('O que mais o agente deve observar', instrucoes, 'Até 2.000 caracteres.'),
      ]),
      confirmar: 'Salvar',
      descartar: () => (instrucoes.value.trim() !== config.instrucoes.trim() || automatico !== config.automatico ? 'Você mudou as instruções e ainda não salvou.' : null),
      aoConfirmar: async () => {
        config = await api.put('/api/relatorios/agente/config', { automatico, instrucoes: instrucoes.value });
        aviso('Instruções salvas.', 'sucesso');
        desenhar();
      },
    });
  }

  function desenhar() {
    limpar(area);
    const seletor = selecao(opcoes.map((o) => ({ valor: o.de, rotulo: o.rotulo })), escolha, { 'aria-label': 'Fim de semana do relatório', disabled: gerando });
    seletor.addEventListener('change', () => (escolha = seletor.value));
    const barra = el('div', { class: 'relatorio-barra' }, [
      el('div', { class: 'linha' }, [seletor, botao(gerando ? 'Gerando…' : aberto ? 'Gerar de novo' : 'Gerar agora', { tipo: 'principal', icone: 'atualizar', desabilitado: gerando, aoClicar: gerar })]),
      el('div', { class: 'linha relatorio-barra-direita' }, [
        selo(config.automatico ? 'Sai sozinho toda segunda, às 7h' : 'Automático desligado', config.automatico ? 'ouro' : ''),
        botao('Instruções', { icone: 'ajustes', pequeno: true, aoClicar: editarInstrucoes }),
      ]),
    ]);

    let corpo;
    if (gerando && !aberto) {
      corpo = el('div', { class: 'painel-bloco t-sm c-fraco', texto: 'Contando o fim de semana e escrevendo o relatório… pode levar alguns segundos.' });
    } else if (!aberto) {
      corpo = vazio('Ainda não há relatório', config.automatico ? 'O primeiro sai na próxima segunda, às 7h. Para ver agora, escolha o fim de semana e clique em Gerar agora.' : 'O envio automático está desligado. Escolha o fim de semana e clique em Gerar agora.');
    } else {
      const r = aberto;
      corpo = el('div', { class: gerando ? 'relatorio-gerando' : '' }, [
        el('div', { class: 'relatorio-topo' }, [
          el('div', {}, [
            el('h3', { class: 'relatorio-titulo', texto: r.periodo.rotulo }),
            el('p', { class: 'relatorio-origem', texto: `Gerado em ${quando(r.geradoEm)}${r.origem === 'automatico' ? ', automaticamente' : r.geradoPor?.nome ? `, por ${r.geradoPor.nome}` : ''}. ${r.usouIa ? 'Texto escrito pela IA, com os números conferidos.' : 'Texto padrão, sem IA.'}` }),
          ]),
          el('div', { class: 'linha' }, [
            r.periodo.parcial ? selo('Período em andamento', 'alerta') : null,
            botao('Copiar', { icone: 'copiar', pequeno: true, titulo: 'Copiar o texto para colar no WhatsApp', aoClicar: () => copiar(r) }),
            botao('PDF', { icone: 'contrato', pequeno: true, aoClicar: () => imprimir(r) }),
            botao('Apagar', { icone: 'lixo', pequeno: true, aoClicar: () => apagar(r) }),
          ]),
        ]),
        ...corpoDoRelatorio(r),
      ]);
    }

    const anteriores = historico.filter((h) => h.id !== aberto?.id);
    const lista = anteriores.length
      ? el('div', { class: 'relatorio-historico' }, [
          el('h4', { texto: 'Relatórios anteriores' }),
          el('div', { class: 'lista-simples' }, anteriores.slice(0, 12).map((h) =>
            el('button', { type: 'button', class: 'lista-item relatorio-historico-item', aoClick: () => abrir(h.id) }, [
              el('div', { class: 'corpo' }, [el('div', { class: 'titulo', texto: h.periodo.rotulo }), el('div', { class: 't-sm c-fraco', texto: `${quando(h.geradoEm)}${h.origem === 'automatico' ? ' · automático' : ''}` })]),
              el('div', { class: 'linha-p' }, [selo(`${numero(h.novos)} ${palavra(h.novos, 'lead', 'leads')}`, ''), selo(`${numero(h.qualificados)} qual.`, 'ouro'), selo(`${numero(h.desqualificados)} desq.`, '')]),
            ]),
          )),
        ])
      : null;

    area.append(
      cartao(
        'Agente de relatórios',
        'Conta o que aconteceu no atendimento no fim de semana: quantos leads entraram e foram atendidos, quantos foram qualificados e desqualificados, com a comparação com o fim de semana anterior.',
        barra,
        corpo,
        lista,
      ),
    );
  }

  desenhar();
}
