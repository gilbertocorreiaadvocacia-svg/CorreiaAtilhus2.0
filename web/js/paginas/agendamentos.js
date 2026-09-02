import { api } from '../api.js';
import { campoComDica, dica, paginacao, seletorPeriodo, seloSaude } from '../componentes.js';
import { estado } from '../estado.js';
import { legenda } from '../graficos.js';
import {
  aviso,
  botao,
  campo,
  confirmar,
  dataHora,
  el,
  entradaTexto,
  limpar,
  modal,
  numero,
  plural,
  selecao,
  selo,
  vazio,
} from '../ui.js';

const COR_SAUDE = { saudavel: 'var(--sucesso)', risco: 'var(--alerta)', critico: 'var(--erro)' };
const ROTULO_SAUDE = { saudavel: 'Saudavel', risco: 'Em risco', critico: 'Critico' };
const ORDEM_SAUDE = { saudavel: 0, risco: 1, critico: 2 };
const DIAS_SEMANA = ['Dom', 'Seg', 'Ter', 'Qua', 'Qui', 'Sex', 'Sab'];

/* Duas cores, uma para o que ainda vai sair e outra para o que ja saiu. O que
   pesa na conta da Meta e a primeira; a segunda entra para dar a referencia do
   que aquele numero ja aguentou no mesmo dia. */
const SERIES_HORA = [
  { chave: 'pendente', nome: 'Na fila', cor: 'var(--alerta)' },
  { chave: 'enviado', nome: 'Ja enviadas', cor: 'var(--info)' },
];

/** Data para AAAA-MM-DD com os campos locais: toISOString viraria o dia a noite. */
function paraIso(data) {
  const mes = String(data.getMonth() + 1).padStart(2, '0');
  const dia = String(data.getDate()).padStart(2, '0');
  return `${data.getFullYear()}-${mes}-${dia}`;
}

/** AAAA-MM-DD para 17/08, sem passar por Date para nao pegar fuso. */
function dataCurta(iso) {
  if (!iso) return '';
  const [, mes, dia] = String(iso).split('-');
  return `${dia}/${mes}`;
}

/** AAAA-MM-DD para 17/08/2026. O ano so aparece onde o periodo pode cruzar dois. */
function dataBr(iso) {
  if (!iso) return '';
  const [ano, mes, dia] = String(iso).split('-');
  return `${dia}/${mes}/${ano}`;
}

function diaDaSemana(iso) {
  const [ano, mes, dia] = String(iso).split('-').map(Number);
  return DIAS_SEMANA[new Date(ano, (mes || 1) - 1, dia || 1).getDay()];
}

/**
 * Quem colocou a mensagem na fila. O backend nao devolve um campo pronto de
 * responsavel: o que existe e o criadoPor de quem agendou a mao, pelo agente ou
 * pela API. Follow-up nasce da automacao e nao tem dono, entao ganha um grupo
 * proprio em vez de cair em branco no meio da lista.
 */
function responsavelDe(agendamento) {
  const autor = agendamento.criadoPor;
  if (autor && autor.nome) return { chave: String(autor.id || autor.nome), nome: autor.nome };
  if (agendamento.tipo === 'followup') return { chave: 'automacao', nome: 'Automacao de follow-up' };
  return { chave: 'sem', nome: 'Sem responsavel' };
}

/** Maior quantidade de mensagens marcada para o mesmo minuto. */
function picoPorMinuto(lista) {
  const minutos = new Map();
  for (const agendamento of lista) {
    const minuto = agendamento.quando.slice(0, 16);
    minutos.set(minuto, (minutos.get(minuto) || 0) + 1);
  }
  return Math.max(0, ...minutos.values());
}

/**
 * Central de agendamentos: tudo o que ainda vai sair, follow-up automatico e
 * mensagem marcada a mao. E a tela que evita o acidente mais comum: muita
 * mensagem concentrada no mesmo dia, no mesmo numero.
 */
export async function paginaAgendamentos() {
  const container = el('div');
  const hoje = paraIso(new Date());
  const filtro = {
    de: hoje,
    ate: paraIso(new Date(Date.now() + 6 * 86400000)),
    tipo: '',
    conexao: '',
    estado: '',
  };

  const marcados = new Set();
  let dados = null;
  /* Responsavel e pagina ficam fora do filtro do servidor: os dois sao
     resolvidos aqui, sobre a lista que ja veio. */
  let responsavel = '';
  let diaFoco = hoje;
  let pagina = 1;
  let porPagina = 20;

  async function carregar() {
    dados = await api.get('/api/agendamentos', filtro);
    marcados.clear();
    pagina = 1;
    if (responsavel && !opcoesResponsavel().some((opcao) => opcao.valor === responsavel)) responsavel = '';
    diaFoco = escolherDiaFoco();
    pintar();
  }

  /* O grafico e sempre de um dia so. Hoje e o dia que interessa quando ele esta
     no periodo; fora disso, o primeiro dia com fila. */
  function escolherDiaFoco() {
    const doServidor = dados.dias.map((dia) => dia.dia);
    const daLista = dados.agendamentos.map((agendamento) => agendamento.quando.slice(0, 10));
    const todos = [...new Set([...doServidor, ...daLista])].sort();
    if (todos.includes(hoje)) return hoje;
    return todos[0] || hoje;
  }

  function opcoesResponsavel() {
    const contagem = new Map();
    for (const agendamento of dados.agendamentos) {
      const { chave, nome } = responsavelDe(agendamento);
      const item = contagem.get(chave) || { valor: chave, nome, total: 0 };
      item.total += 1;
      contagem.set(chave, item);
    }
    return [...contagem.values()]
      .sort((a, b) => a.nome.localeCompare(b.nome, 'pt-BR'))
      .map((item) => ({ valor: item.valor, rotulo: `${item.nome} (${item.total})` }));
  }

  /* O responsavel filtra so a tabela. Cartao de dia e grafico continuam olhando
     a fila inteira de proposito: a Meta conta o numero, nao o atendente. */
  function listaFiltrada() {
    if (!responsavel) return dados.agendamentos;
    return dados.agendamentos.filter((agendamento) => responsavelDe(agendamento).chave === responsavel);
  }

  function piorSaude() {
    if (!dados.dias.length) return null;
    let pior = 'saudavel';
    for (const dia of dados.dias) {
      if ((ORDEM_SAUDE[dia.saude] ?? -1) > ORDEM_SAUDE[pior]) pior = dia.saude;
    }
    return pior;
  }

  /* O periodo escolhido ja esta escrito no botao do seletor, ao lado. Aqui fica
     so o que ele nao diz: quantas mensagens cairam dentro dele. */
  function resumoDoPeriodo() {
    return plural(dados.total, 'mensagem no periodo', 'mensagens no periodo');
  }

  /**
   * Como a saude e medida. E conceito, e conceito nao ocupa linha fixa em cima
   * da fila: mora na dica do proprio selo, a um passar de mouse ou uma
   * tabulacao de distancia.
   */
  function explicacaoDaSaude() {
    return el('div', { class: 'pilha-p' }, [
      el('p', {
        class: 'sem-margem',
        texto:
          'Medida por conexao, uma de cada vez. O indicador do dia mostra o pior numero daquele dia, e nao a soma dos numeros: duas conexoes com 40 envios cada seguem saudaveis, uma conexao sozinha com 80 nao.',
      }),
      el('p', {
        class: 'sem-margem',
        texto:
          'Muita mensagem em pouco tempo pelo mesmo numero e lida pela Meta como disparo em massa e pode bloquear a conexao.',
      }),
    ]);
  }

  function cabecalho() {
    const truncada = dados.agendamentos.length < dados.total;

    return el('div', { class: 'linha-topo entre quebra mb-4' }, [
      el('div', { class: 'pilha-p' }, [
        /* Titulo, saude e contagem do periodo na mesma linha. Eram tres linhas
           empilhadas, e cada uma empurrava a fila para baixo da dobra. */
        el('div', { class: 'cartao-titulo sem-margem' }, [
          el('span', { texto: 'Fila de envios' }),
          seloSaude(piorSaude()),
          dica(explicacaoDaSaude(), { assunto: 'saude da fila' }),
          el('span', { class: 't-sm c-suave', texto: resumoDoPeriodo() }),
        ]),
        truncada
          ? el('div', {
              class: 't-xs c-alerta',
              texto: `Lista cortada nas primeiras ${numero(dados.agendamentos.length)}. Reduza o periodo.`,
            })
          : null,
      ]),
      seletorPeriodo({
        de: filtro.de,
        ate: filtro.ate,
        aoAplicar: async ({ de, ate }) => {
          filtro.de = de || '';
          filtro.ate = ate || '';
          await carregar();
        },
      }),
    ]);
  }

  function barraFiltros() {
    const tipo = selecao(
      [
        { valor: '', rotulo: 'Follow-up e agendadas' },
        { valor: 'followup', rotulo: 'Somente follow-up' },
        { valor: 'manual', rotulo: 'Somente agendadas a mao' },
      ],
      filtro.tipo,
      {
        aoChange: async (evento) => {
          filtro.tipo = evento.target.value;
          await carregar();
        },
      },
    );

    const conexao = selecao(
      [{ valor: '', rotulo: 'Todas as conexoes' }, ...estado.conexoes.map((c) => ({ valor: c.id, rotulo: c.nome }))],
      filtro.conexao,
      {
        aoChange: async (evento) => {
          filtro.conexao = evento.target.value;
          await carregar();
        },
      },
    );

    const situacao = selecao(
      [
        { valor: '', rotulo: 'Todas as situacoes' },
        { valor: 'pendente', rotulo: 'Na fila' },
        { valor: 'enviado', rotulo: 'Ja enviadas' },
        { valor: 'cancelado', rotulo: 'Canceladas' },
      ],
      filtro.estado,
      {
        aoChange: async (evento) => {
          filtro.estado = evento.target.value;
          await carregar();
        },
      },
    );

    const quem = selecao(
      [{ valor: '', rotulo: 'Todos os responsaveis' }, ...opcoesResponsavel()],
      responsavel,
      {
        aoChange: (evento) => {
          responsavel = evento.target.value;
          marcados.clear();
          pagina = 1;
          pintar();
        },
      },
    );

    /* .cartao-formulario desconta do respiro de baixo a margem que cada campo
       ja carrega, senao a ultima linha do cartao fica com o dobro de folga. */
    return el('div', { class: 'cartao cartao-formulario mb-4' }, [
      el('div', { class: 'grade g4' }, [
        campo('Tipo', tipo),
        campo('Conexao', conexao),
        campo('Situacao', situacao),
        // Com um responsavel escolhido, o cabecalho e os cartoes de dia seguem
        // contando a fila inteira e o rodape da tabela conta o filtrado. Sao
        // dois numeros diferentes da mesma fila, e a dica e o que diz por que.
        campoComDica(
          'Responsavel',
          quem,
          'Filtra so a lista abaixo. Os cartoes de dia e o grafico continuam olhando a fila inteira.',
        ),
      ]),
    ]);
  }

  function cartoesDoDia() {
    const grade = el('div', { class: 'grade g4' });

    for (const dia of dados.dias) {
      const ehHoje = dia.dia === hoje;
      const focado = dia.dia === diaFoco;
      const cor = COR_SAUDE[dia.saude] || 'var(--texto-fraco)';
      const saude = ROTULO_SAUDE[dia.saude] || 'Sem dado';

      grade.append(
        el('button', {
          type: 'button',
          /* .metrica-hoje poe o filete dourado em volta do dia de hoje, e o
             aria-pressed marca o dia que o grafico esta mostrando. O fundo e a
             moldura dos dois estados moram no CSS. */
          class: ehHoje ? 'metrica metrica-hoje' : 'metrica',
          'aria-pressed': String(focado),
          title: `Ver a distribuicao de ${dataBr(dia.dia)} ao longo do dia`,
          /* A cor da saude vem do dado, e por isso continua inline. Sendo
             inline, ela tambem vence a moldura da classe: o topo colorido nao
             corre o risco de ser apagado pelos quatro lados. */
          estilo: { borderTopColor: cor },
          aoClick: () => {
            diaFoco = dia.dia;
            pintar();
          },
        }, [
          el('div', { class: 'linha entre' }, [
            el('span', {
              class: ehHoje ? 't-sm peso-600 c-ouro' : 't-sm peso-500 c-suave',
              texto: ehHoje ? 'Hoje' : diaDaSemana(dia.dia),
            }),
            el('span', {
              class: 'ponto',
              role: 'img',
              'aria-label': `Saude do dia: ${saude}`,
              title: saude,
              estilo: { background: cor },
            }),
          ]),
          el('div', { class: 'valor mt-2', texto: numero(dia.total) }),
          el('div', { class: 'rotulo', texto: dataCurta(dia.dia) }),
        ]),
      );
    }

    return el('div', { class: 'mb-4' }, [grade]);
  }

  function graficoDoDia() {
    /* A chave do dia e o trecho de data do proprio ISO, a mesma que o servidor
       usa para montar os cartoes: assim o total do cartao e o total do grafico
       falam do mesmo conjunto. A hora, essa sim, e a local, que e a que a
       equipe le no relogio. */
    const doDia = dados.agendamentos.filter((agendamento) => agendamento.quando.slice(0, 10) === diaFoco);

    const horas = Array.from({ length: 24 }, (_, hora) => ({ hora, pendente: 0, enviado: 0, total: 0 }));
    for (const agendamento of doDia) {
      const faixa = horas[new Date(agendamento.quando).getHours()];
      if (agendamento.estado === 'pendente') {
        faixa.pendente += 1;
        faixa.total += 1;
      } else if (agendamento.estado === 'enviado') {
        faixa.enviado += 1;
        faixa.total += 1;
      }
    }

    const maximo = Math.max(1, ...horas.map((faixa) => faixa.total));
    const grafico = el('div', { class: 'grafico-barras' });

    for (const faixa of horas) {
      /* .coluna-empilhada tira o gradiente da classe: aqui a coluna e so o
         trilho, quem pinta sao os dois pedacos empilhados dentro dela. */
      const coluna = el('div', {
        class: 'coluna-empilhada',
        title: `${String(faixa.hora).padStart(2, '0')}h, ${faixa.pendente} na fila e ${faixa.enviado} ja enviadas`,
        estilo: { height: `${(faixa.total / maximo) * 100}%` },
      });

      const pedacos = [
        { valor: faixa.pendente, cor: 'var(--alerta)' },
        { valor: faixa.enviado, cor: 'var(--info)' },
      ].filter((pedaco) => pedaco.valor > 0);

      /* So o pedaco de cima e arredondado, e quem cuida disso e o :first-child
         de .coluna-empilhada, no CSS. */
      for (const pedaco of pedacos) {
        coluna.append(
          el('div', {
            estilo: {
              height: `${(pedaco.valor / (faixa.total || 1)) * 100}%`,
              background: pedaco.cor,
            },
          }),
        );
      }

      grafico.append(coluna);
    }

    const pico = picoPorMinuto(doDia);
    const direita = el('div', { class: 'linha-botoes' }, [
      el('span', { class: 't-sm c-suave', texto: plural(doDia.length, 'agendado', 'agendados') }),
      pico > 1 ? selo(`pico de ${pico} no mesmo minuto`, pico >= 5 ? 'erro' : 'alerta') : null,
      pico > 1
        ? dica(
            'Mensagens marcadas para o mesmo minuto, no mesmo numero, sao o padrao que a Meta reconhece como disparo em massa. Selecione as mensagens do dia e use Reagendar para espalhar a fila.',
          )
        : null,
    ]);

    return el('div', { class: 'cartao' }, [
      el('div', { class: 'linha-topo entre quebra mb-3' }, [
        /* Como se le o grafico e conceito, e por isso vai na dica do titulo. Na
           linha da tela fica o dia, a contagem e o aviso de pico. */
        el('div', { class: 'cartao-titulo sem-margem' }, [
          el('span', { texto: `${diaFoco === hoje ? 'Hoje' : diaDaSemana(diaFoco)}, ${dataCurta(diaFoco)}` }),
          dica(
            'Distribuicao dos envios ao longo do dia. Pico concentrado e lido como disparo em massa; o ideal e a fila espalhada.',
            { assunto: 'distribuicao do dia' },
          ),
        ]),
        direita,
      ]),
      grafico,
      el('div', { class: 'linha entre t-xs c-fraco mt-1' }, [
        el('span', { texto: '00h' }),
        el('span', { texto: '12h' }),
        el('span', { texto: '23h' }),
      ]),
      legenda(SERIES_HORA),
    ]);
  }

  /**
   * Monta a tabela da pagina atual. A selecao mora no Set de fora, entao virar
   * de pagina nao perde o que ja estava marcado.
   */
  function tabela(daPagina) {
    const caixas = new Map();
    const contador = el('span', { class: 'selo ouro', texto: plural(0, 'selecionada', 'selecionadas') });

    /* A barra so existe com alguma mensagem marcada. O display fica inline
       porque e estado de tempo de execucao: atualizarSelecao reescreve ele a
       cada troca de caixa. */
    const barraAcoes = el('div', { class: 'linha-botoes mb-3', estilo: { display: 'none' } }, [
      contador,
      botao('Reagendar', { pequeno: true, aoClicar: () => abrirReagendamento([...marcados], carregar) }),
      botao('Cancelar envio', {
        pequeno: true,
        tipo: 'perigo',
        aoClicar: () =>
          confirmar(
            'Cancelar estes envios?',
            'Cancelar e definitivo: a mensagem sai da fila e nao volta.',
            async () => {
              const resultado = await api.post('/api/agendamentos/cancelar', { ids: [...marcados] });
              aviso(`${resultado.cancelados} envios cancelados.`, 'sucesso');
              await carregar();
            },
            'Cancelar envios',
          ),
      }),
    ]);

    const todas = el('input', {
      type: 'checkbox',
      'aria-label': 'Selecionar as mensagens desta pagina',
    });

    function atualizarSelecao() {
      contador.textContent = plural(marcados.size, 'selecionada', 'selecionadas');
      barraAcoes.style.display = marcados.size ? 'flex' : 'none';
      const disponiveis = [...caixas.values()].filter((caixa) => !caixa.disabled);
      todas.disabled = !disponiveis.length;
      todas.checked = disponiveis.length > 0 && disponiveis.every((caixa) => caixa.checked);
      todas.indeterminate = !todas.checked && disponiveis.some((caixa) => caixa.checked);
    }

    const corpo = el('tbody');
    for (const agendamento of daPagina) {
      const caixa = el('input', {
        type: 'checkbox',
        'aria-label': `Selecionar a mensagem de ${dataHora(agendamento.quando)}`,
      });
      caixa.disabled = agendamento.estado !== 'pendente';
      caixa.checked = marcados.has(agendamento.id);
      caixa.addEventListener('change', () => {
        if (caixa.checked) marcados.add(agendamento.id);
        else marcados.delete(agendamento.id);
        atualizarSelecao();
      });
      caixas.set(agendamento.id, caixa);

      corpo.append(
        el('tr', {}, [
          el('td', {}, [caixa]),
          el('td', { texto: dataHora(agendamento.quando) }),
          el('td', {}, [
            selo(
              agendamento.tipo === 'followup' ? 'follow-up' : 'agendada',
              agendamento.tipo === 'followup' ? 'ouro' : 'info',
            ),
          ]),
          el('td', {}, [
            agendamento.contato
              ? el('a', { href: `#/atendimento/${agendamento.contato.id}`, texto: agendamento.contato.nome })
              : document.createTextNode('-'),
          ]),
          el('td', { texto: agendamento.conexao || '-' }),
          el('td', { texto: responsavelDe(agendamento).nome }),
          el('td', { texto: agendamento.template || (agendamento.conteudo || '').slice(0, 50) || '-' }),
          /* So o estado ruim vira selo. Pendente e enviado sao o esperado numa
             fila e ja tem coluna propria: pintar os dois enchia a tabela de
             selo colorido e afogava o unico que precisa ser visto. */
          el('td', {}, [
            agendamento.estado === 'erro'
              ? selo('erro', 'erro')
              : el('span', { class: 'c-suave', texto: agendamento.estado }),
          ]),
          el('td', {}, [agendamento.desistir?.ativo ? selo('desiste do lead', 'erro') : null]),
        ]),
      );
    }

    todas.addEventListener('change', () => {
      for (const [id, caixa] of caixas) {
        if (caixa.disabled) continue;
        caixa.checked = todas.checked;
        if (todas.checked) marcados.add(id);
        else marcados.delete(id);
      }
      atualizarSelecao();
    });

    atualizarSelecao();
    return { barraAcoes, todas, corpo };
  }

  function pintar() {
    limpar(container);
    container.append(cabecalho(), barraFiltros());

    if (dados.dias.length) container.append(cartoesDoDia());
    if (dados.agendamentos.length) container.append(graficoDoDia());

    const lista = listaFiltrada();
    if (!lista.length) {
      container.append(
        responsavel
          ? vazio('Nada para esse responsavel', 'Nenhuma mensagem desse responsavel no periodo escolhido.')
          : vazio('Nada na fila', 'Nenhuma mensagem programada para o periodo escolhido.'),
      );
      return;
    }

    const paginas = Math.max(1, Math.ceil(lista.length / porPagina));
    if (pagina > paginas) pagina = paginas;
    const inicio = (pagina - 1) * porPagina;
    const daPagina = lista.slice(inicio, inicio + porPagina);
    const { barraAcoes, todas, corpo } = tabela(daPagina);

    container.append(
      barraAcoes,
      /* .cartao-tabela abre mao do respiro do cartao: quem cuida do respiro
         aqui e a propria tabela, linha por linha. */
      el('div', { class: 'cartao cartao-tabela' }, [
        el('div', { class: 'tabela-rolagem' }, [
          el('table', {}, [
            el('thead', {}, [
              el('tr', {}, [
                el('th', { class: 'coluna-selecao' }, [todas]),
                // A regra do horario comercial explica os horarios deslocados e os
                // minutos quebrados desta coluna, e este e o unico lugar do
                // sistema onde o efeito dela aparece na cara de quem usa.
                el('th', {}, [
                  el('span', { class: 'linha' }, [
                    document.createTextNode('Sai em'),
                    dica(
                      'Follow-up fora do horario comercial e adiado para o proximo dia util, com o minuto sorteado, assim a fila nao sai toda junta as 9h.',
                      { assunto: 'a coluna Sai em' },
                    ),
                  ]),
                ]),
                el('th', { texto: 'Tipo' }),
                el('th', { texto: 'Contato' }),
                el('th', { texto: 'Conexao' }),
                el('th', { texto: 'Responsavel' }),
                el('th', { texto: 'Mensagem' }),
                el('th', { texto: 'Situacao' }),
                // A coluna de acoes nao tem titulo na tela, mas quem navega a
                // tabela por leitor de tela precisa de um nome para ela.
                el('th', {}, [el('span', { class: 'apenas-leitor', texto: 'Acoes' })]),
              ]),
            ]),
            corpo,
          ]),
        ]),
        el('div', { class: 'rodape-tabela' }, [
          paginacao({
            pagina,
            paginas,
            total: lista.length,
            porPagina,
            rotulo: 'mensagens',
            aoMudar: (nova) => {
              pagina = nova;
              pintar();
            },
            aoMudarTamanho: (tamanho) => {
              porPagina = tamanho;
              pagina = 1;
              pintar();
            },
          }),
        ]),
      ]),
    );
  }

  await carregar();
  return container;
}

function abrirReagendamento(ids, recarregarTela) {
  const inicio = el('input', { type: 'datetime-local' });
  const agora = new Date(Date.now() + 30 * 60000);
  inicio.value = new Date(agora.getTime() - agora.getTimezoneOffset() * 60000).toISOString().slice(0, 16);

  const intervalo = entradaTexto('30', { type: 'number', min: '1' });
  const respeitar = el('input', { type: 'checkbox' });
  respeitar.checked = true;

  const projecao = el('div', { class: 'dica' });

  /**
   * Projecao da fila.
   *
   * O erro fica dentro do proprio bloco: sem o try, uma recusa do servidor
   * deixava o numero velho na tela e ainda caia no ouvinte global de
   * unhandledrejection, que empilha um toast vermelho por tecla digitada.
   */
  async function atualizarProjecao() {
    try {
      const dados = await api.post('/api/agendamentos/projecao', {
        quantidade: ids.length,
        intervaloSegundos: Number(intervalo.value) || 30,
      });
      limpar(projecao);
      projecao.append(
        el('div', {}, [
          el('strong', {
            texto: `${plural(ids.length, 'mensagem', 'mensagens')}, ${dados.porHora} por hora. A fila leva ${plural(dados.duracaoMinutos, 'minuto', 'minutos')}.`,
          }),
        ]),
        el('div', { class: 'mt-2' }, [seloSaude(dados.saude)]),
        el('div', { class: 'mt-2', texto: dados.recomendacao }),
      );
    } catch (erro) {
      limpar(projecao);
      projecao.append(el('div', { texto: `Nao consegui calcular a projecao agora: ${erro.message}` }));
    }
  }

  // Uma requisicao por tecla digitada, nao: o campo espera a pausa, como a
  // analise de prompt em agentes.js ja faz.
  let temporizadorProjecao = null;
  intervalo.addEventListener('input', () => {
    clearTimeout(temporizadorProjecao);
    temporizadorProjecao = setTimeout(atualizarProjecao, 300);
  });
  atualizarProjecao();

  modal({
    titulo: `Reagendar ${plural(ids.length, 'mensagem', 'mensagens')}`,
    corpo: el('div', {}, [
      campo('Comecar em', inicio),
      /* O piso cabe no proprio rotulo. A projecao logo abaixo ja diz, a cada
         digito, como fica a saude e o que recomendar. */
      campo('Intervalo entre mensagens (segundos, minimo seguro 30)', intervalo),
      /* Campo de caixa de selecao: a caixa e o texto na mesma linha, porque
         aqui o rotulo nao fica em cima do controle como nos outros campos. */
      el('label', { class: 'campo linha' }, [
        respeitar,
        el('span', { class: 't-md', texto: 'Respeitar o horario comercial' }),
      ]),
      projecao,
    ]),
    confirmar: 'Reagendar',
    aoConfirmar: async () => {
      const resultado = await api.post('/api/agendamentos/reagendar', {
        ids,
        inicio: new Date(inicio.value).toISOString(),
        intervaloSegundos: Number(intervalo.value) || 30,
        respeitarHorario: respeitar.checked,
      });
      aviso(`${plural(resultado.reagendados, 'mensagem reagendada', 'mensagens reagendadas')}.`, 'sucesso');
      await recarregarTela();
    },
  });
}
