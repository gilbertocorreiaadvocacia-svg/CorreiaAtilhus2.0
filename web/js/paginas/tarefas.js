import { api } from '../api.js';
import { estado, ouvir } from '../estado.js';
import { campoComDica, gaveta, paginacao } from '../componentes.js';
import {
  areaTexto,
  aviso,
  botao,
  campo,
  confirmar,
  dataHora,
  el,
  entradaTexto,
  limpar,
  numero,
  selecao,
  selo,
  telefone,
  vazio,
} from '../ui.js';

/**
 * Tarefas do escritorio.
 *
 * A tela responde uma pergunta so: o que precisa sair, e de quem. Por isso a
 * ordem padrao e por prazo e o filtro ja abre em "na fila". Quem entra aqui
 * esta atras do que esta pendente, nao do historico do que ja foi feito.
 *
 * Toda tarefa nasce colada em uma conversa, entao o formulario obriga a
 * escolha do cliente, igual ao servidor (servidor/rotas/tarefas.js). Quem nao
 * pode abrir o atendimento tambem nao ve a tarefa que fala dele, e a listagem
 * ja chega filtrada de la.
 */

/** Os mesmos pontos que o servidor aceita. */
const PONTOS = [1, 2, 3, 5, 8, 13, 21];

const SITUACOES = [
  { valor: 'aberta', rotulo: 'Aberta' },
  { valor: 'em_andamento', rotulo: 'Em andamento' },
  { valor: 'concluida', rotulo: 'Concluida' },
  { valor: 'cancelada', rotulo: 'Cancelada' },
];

/**
 * Selo por situacao. "aberta" fica de fora de proposito: e o estado normal de
 * quase toda linha da tabela, e um selo repetido em tudo nao informa nada.
 */
const SELO_SITUACAO = {
  em_andamento: ['em andamento', 'info'],
  concluida: ['concluida', 'sucesso'],
  cancelada: ['cancelada', ''],
};

const EXPLICACAO_PONTOS = 'Escala de esforco: 1, 2, 3, 5, 8, 13 e 21.';

/* ------------------------------------------------------------------ */
/* Tela                                                                */
/* ------------------------------------------------------------------ */

export async function paginaTarefas() {
  const container = el('div');
  const filtro = { busca: '', situacao: 'abertas', responsavel: '', ordenar: 'prazo', pagina: 1, porPagina: 20 };

  const areaMetricas = el('div', { class: 'metricas mb-4' });
  const areaLista = el('div');

  async function atualizarMetricas() {
    pintarMetricas(areaMetricas, await api.get('/api/tarefas/resumo'));
  }

  async function desenhar() {
    const [dados, resumo] = await Promise.all([api.get('/api/tarefas', filtro), api.get('/api/tarefas/resumo')]);
    pintarMetricas(areaMetricas, resumo);
    pintarLista(areaLista, dados, filtro, contexto);
  }

  const contexto = { desenhar, atualizarMetricas };

  // O servidor emite 'tarefas' a cada criacao, edicao ou exclusao. Sem ouvir
  // aqui, dois atendentes com a tela aberta nao viam o trabalho um do outro: a
  // lista e os quatro numeros do topo ficavam velhos ate trocar de pagina.
  ouvir('tarefas', () => {
    if (!document.body.contains(container)) return;
    desenhar();
  });

  // A barra de topo e montada uma vez so. Se ela fosse redesenhada junto com a
  // tabela, o campo de busca perderia o foco a cada tecla digitada.
  container.append(barraDeTopo(filtro, desenhar), areaMetricas, areaLista);
  await desenhar();
  return container;
}

function barraDeTopo(filtro, desenhar) {
  const busca = entradaTexto(filtro.busca, { type: 'search', placeholder: 'Titulo, descricao ou nome do cliente' });
  let esperando = null;
  busca.addEventListener('input', () => {
    // Espera a pessoa parar de digitar: uma consulta por tecla faz a tabela
    // piscar e ainda deixa a resposta antiga chegar depois da nova.
    clearTimeout(esperando);
    esperando = setTimeout(() => {
      filtro.busca = busca.value.trim();
      filtro.pagina = 1;
      desenhar();
    }, 300);
  });

  const aplicar = (chave) => (evento) => {
    filtro[chave] = evento.target.value;
    filtro.pagina = 1;
    desenhar();
  };

  const situacao = selecao(
    [{ valor: 'abertas', rotulo: 'Na fila' }, ...SITUACOES, { valor: 'todas', rotulo: 'Todas' }],
    filtro.situacao,
    { 'aria-label': 'Filtrar por situacao', aoChange: aplicar('situacao') },
  );

  const responsavel = selecao(
    [
      { valor: '', rotulo: 'Qualquer responsavel' },
      { valor: 'nenhum', rotulo: 'Sem responsavel' },
      ...estado.membros.map((membro) => ({ valor: membro.id, rotulo: membro.usuario?.nome || 'Membro' })),
    ],
    filtro.responsavel,
    { 'aria-label': 'Filtrar por responsavel', aoChange: aplicar('responsavel') },
  );

  const ordenar = selecao(
    [
      { valor: 'prazo', rotulo: 'Prazo' },
      { valor: 'criacao', rotulo: 'Criacao' },
      { valor: 'pontos', rotulo: 'Pontos' },
    ],
    filtro.ordenar,
    { 'aria-label': 'Ordenar a lista', aoChange: aplicar('ordenar') },
  );

  return el(
    'div',
    { class: 'cartao barra-filtros' },
    [
      coluna('Busca', busca, 'campo-largo'),
      coluna('Situacao', situacao),
      coluna('Responsavel', responsavel),
      coluna('Ordenar por', ordenar, 'campo-estreito'),
      botao('Nova tarefa', { tipo: 'principal', icone: 'mais', aoClicar: () => abrirFormulario(null, desenhar) }),
    ],
  );
}

/**
 * Campo da barra de filtros: o rotulo de sempre, com largura elastica.
 *
 * A largura vem de .barra-filtros no tema, em tres tamanhos e nao em um pixel
 * escolhido por campo. Sem `medida` o campo sai na largura padrao da barra.
 */
function coluna(rotulo, entrada, medida) {
  const caixa = campo(rotulo, entrada);
  if (medida) caixa.classList.add(medida);
  return caixa;
}

/* ------------------------------------------------------------------ */
/* Numeros do topo                                                     */
/* ------------------------------------------------------------------ */

/**
 * Os quatro numeros do topo.
 *
 * A nota embaixo do numero so fica quando diz o que o rotulo nao diz, que aqui
 * e sempre a base da conta: "aberta e em andamento" explica o que entrou na
 * soma. "passaram do prazo" embaixo de "Vencidas" era a mesma palavra escrita
 * duas vezes, e a semana virou o proprio rotulo, que ja e onde ela pesa menos.
 */
function pintarMetricas(area, resumo) {
  limpar(area);
  area.append(
    metrica('Tarefas abertas', resumo.abertas, 'aberta e em andamento'),
    metrica('Vencidas', resumo.vencidas, 'ainda na fila', resumo.vencidas ? 'var(--erro)' : null),
    metrica(
      'Concluidas em 7 dias',
      resumo.concluidasNaSemana,
      null,
      resumo.concluidasNaSemana ? 'var(--sucesso)' : null,
    ),
    metrica('Pontos em aberto', resumo.pontosAbertos),
  );
}

/**
 * Cartao de numero. `cor` fica no atributo style porque e decidida em tempo de
 * execucao, pelo proprio valor: so vira vermelha quando ha tarefa vencida.
 */
function metrica(rotulo, valor, nota, cor, ajuda) {
  return el('div', { class: 'metrica', estilo: cor ? { borderTopColor: cor } : {} }, [
    el('div', { class: 'valor', texto: numero(valor) }),
    el('div', { class: ajuda ? 'rotulo linha' : 'rotulo' }, [rotulo, ajuda || null]),
    nota ? el('div', { class: 'nota', texto: nota }) : null,
  ]);
}

/* ------------------------------------------------------------------ */
/* Tabela                                                              */
/* ------------------------------------------------------------------ */

function pintarLista(area, dados, filtro, contexto) {
  const desenhar = contexto.desenhar;
  limpar(area);

  if (!dados.tarefas.length) {
    const filtrando = Boolean(filtro.busca) || Boolean(filtro.responsavel) || filtro.situacao !== 'abertas';
    area.append(
      filtrando
        ? vazio('Nenhuma tarefa neste filtro', 'Mude a busca, a situacao ou o responsavel para ver as outras.')
        : vazio(
            'Nenhuma tarefa',
            'Crie a primeira a partir de uma conversa ou pelo botao acima.',
            botao('Nova tarefa', {
              tipo: 'principal',
              icone: 'mais',
              aoClicar: () => abrirFormulario(null, desenhar),
            }),
          ),
    );
    return;
  }

  const corpo = el('tbody');
  for (const tarefa of dados.tarefas) corpo.append(linhaDaTarefa(tarefa, contexto));

  area.append(
    el('div', { class: 'cartao cartao-tabela' }, [
      el('div', { class: 'tabela-rolagem' }, [
        el('table', { class: 'tabela-densa' }, [
          el('thead', {}, [
            el('tr', {}, [
              el('th', { texto: 'Titulo' }),
              el('th', { texto: 'Prazo' }),
              el('th', { texto: 'Pontos' }),
              el('th', { texto: 'Conversa' }),
              el('th', { texto: 'Responsavel' }),
              el('th', { texto: 'Criador' }),
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
          pagina: dados.pagina,
          paginas: dados.paginas,
          total: dados.total,
          porPagina: dados.porPagina,
          rotulo: 'tarefas',
          aoMudar: (pagina) => {
            filtro.pagina = pagina;
            desenhar();
          },
          aoMudarTamanho: (tamanho) => {
            filtro.porPagina = tamanho;
            filtro.pagina = 1;
            desenhar();
          },
        }),
      ]),
    ]),
  );
}

function linhaDaTarefa(tarefa, contexto) {
  const concluida = tarefa.situacao === 'concluida';
  const marca = SELO_SITUACAO[tarefa.situacao];

  /**
   * Troca a situacao e redesenha so esta linha, nunca a tabela inteira.
   *
   * Redesenhar a lista faria a tarefa recem concluida sumir na hora, porque o
   * filtro padrao mostra so o que esta na fila, e junto com ela sumiria o
   * botao de desfazer. Ficando no lugar, o desfazer continua a um clique de
   * distancia ate a proxima leitura da lista.
   */
  const trocarSituacao = async (situacao, mensagem) => {
    const atualizada = await api.patch(`/api/tarefas/${tarefa.id}`, { situacao });
    linha.replaceWith(linhaDaTarefa(atualizada, contexto));
    aviso(mensagem, 'sucesso');
    await contexto.atualizarMetricas();
  };

  // O servidor deixa editar quem e administrador, quem criou ou quem responde
  // pela tarefa. Quem so enxerga nao recebe o botao, senao o clique voltaria em
  // erro depois de a pessoa achar que tinha concluido.
  const meuMembro = estado.sessao?.membro?.id || null;
  const ehAdministrador = estado.sessao?.papel === 'administrador';
  const criouATarefa = Boolean(meuMembro) && tarefa.criadoPor?.id === meuMembro;
  const podeEditar = ehAdministrador || criouATarefa || (meuMembro && tarefa.responsavelId === meuMembro);

  // Concluir e desfazer sao o mesmo botao trocando de lado: quem clicou por
  // engano volta atras no mesmo lugar onde errou, sem abrir o formulario.
  const alternar = !podeEditar
    ? null
    : concluida
      ? botao('', {
          icone: 'atualizar',
          pequeno: true,
          titulo: 'Reabrir a tarefa',
          aoClicar: () => trocarSituacao('aberta', 'Tarefa reaberta.'),
        })
      : botao('', {
          icone: 'ok',
          pequeno: true,
          titulo: 'Marcar como concluida',
          aoClicar: () =>
            trocarSituacao('concluida', 'Tarefa concluida. Da para reabrir na linha.'),
        });
  if (alternar) alternar.setAttribute('aria-label', concluida ? 'Reabrir a tarefa' : 'Marcar como concluida');

  const abrir = botao('', {
    icone: 'abrir',
    pequeno: true,
    titulo: 'Abrir a tarefa',
    aoClicar: () => abrirFormulario(tarefa, contexto.desenhar),
  });
  abrir.setAttribute('aria-label', 'Abrir a tarefa');

  // O servidor so deixa o administrador ou quem criou excluir. Esconder o
  // botao dos outros evita que a regra seja descoberta por tentativa e erro.
  const podeExcluir = ehAdministrador || criouATarefa;

  const excluir = podeExcluir
    ? botao('', {
        icone: 'lixo',
        pequeno: true,
        tipo: 'perigo',
        titulo: 'Excluir tarefa',
        aoClicar: () =>
          confirmar(
            'Excluir esta tarefa?',
            `"${tarefa.titulo}" sai da lista e nao volta. Para guardar o registro, prefira cancelar.`,
            async () => {
              await api.delete(`/api/tarefas/${tarefa.id}`);
              aviso('Tarefa excluida.', 'sucesso');
              await contexto.desenhar();
            },
            'Excluir',
          ),
      })
    : null;
  if (excluir) excluir.setAttribute('aria-label', 'Excluir tarefa');

  const linha = el('tr', { class: 'linha-clicavel' }, [
    el('td', {}, [
      el('div', { class: 'linha quebra' }, [
        el('span', { class: 'peso-600', texto: tarefa.titulo }),
        marca ? selo(marca[0], marca[1]) : null,
      ]),
      tarefa.descricao
        ? el('div', { class: 'desc-celula cortar', texto: tarefa.descricao, title: tarefa.descricao })
        : null,
    ]),
    el('td', { class: 'nao-quebra' }, [
      tarefa.vencida
        ? el('span', { class: 'c-erro peso-600', texto: dataHora(tarefa.prazo) })
        : dataHora(tarefa.prazo),
      tarefa.vencida ? el('div', { class: 'mt-1' }, [selo('vencida', 'erro')]) : null,
    ]),
    el('td', { class: 'num', texto: String(tarefa.pontos ?? '-') }),
    el('td', {}, [
      tarefa.contato
        ? el('a', { href: `#/atendimento/${tarefa.contato.id}`, texto: tarefa.contato.nome })
        : el('span', { class: 'c-fraco', texto: 'conversa excluida' }),
    ]),
    el('td', { texto: tarefa.responsavel?.nome || 'sem responsavel' }),
    el('td', { texto: tarefa.criadoPor?.nome || '-' }),
    el('td', {}, [
      el('div', { class: 'linha-botoes acoes' }, [
        alternar,
        abrir,
        excluir,
      ]),
    ]),
  ]);

  // Atalho de mouse para a linha inteira. Quem usa teclado ou leitor de tela
  // chega pelo botao de abrir, que ja tem nome proprio.
  linha.addEventListener('click', (evento) => {
    if (evento.target.closest('a, button, input')) return;
    abrirFormulario(tarefa, contexto.desenhar);
  });

  return linha;
}

/* ------------------------------------------------------------------ */
/* Formulario                                                          */
/* ------------------------------------------------------------------ */

async function abrirFormulario(tarefa, recarregarTela) {
  // As conversas vem de uma vez e a busca acontece aqui na tela: a lista do
  // escritorio cabe em memoria, e assim o resultado aparece enquanto a pessoa
  // digita, sem uma ida ao servidor por letra.
  const { contatos } = await api.get('/api/contatos', { limite: 300 });

  const titulo = entradaTexto(tarefa?.titulo || '', { placeholder: 'Juntar o laudo do INSS' });
  const descricao = areaTexto(tarefa?.descricao || '', {
    placeholder: 'O que precisa ser feito, com o detalhe que evita a pergunta depois.',
  });

  const pontos = selecao(
    PONTOS.map((valor) => ({ valor, rotulo: valor === 1 ? '1 ponto' : `${valor} pontos` })),
    tarefa?.pontos || 3,
  );

  const responsavel = selecao(
    [
      { valor: '', rotulo: 'Escolha quem faz' },
      ...estado.membros.map((membro) => ({ valor: membro.id, rotulo: membro.usuario?.nome || 'Membro' })),
    ],
    tarefa?.responsavelId || estado.sessao?.membro?.id || '',
  );

  const prazo = el('input', { type: 'datetime-local', value: paraCampoLocal(tarefa?.prazo) });
  const situacao = selecao(SITUACOES, tarefa?.situacao || 'aberta');

  /* Conversa ---------------------------------------------------------- */

  let escolhida =
    contatos.find((contato) => contato.id === tarefa?.contatoId) ||
    (tarefa?.contato ? { id: tarefa.contato.id, nome: tarefa.contato.nome, telefone: '' } : null);

  const buscaConversa = entradaTexto('', { type: 'search', placeholder: 'Nome ou telefone do cliente' });
  const resultados = el('div', { class: 'lista-simples mt-2' });
  const atual = el('div', { class: 'mt-2' });

  function pintarEscolhida() {
    limpar(atual);
    limpar(resultados);
    buscaConversa.style.display = escolhida ? 'none' : '';

    if (!escolhida) {
      atual.append(
        el('small', {
          class: 'ajuda-campo',
          texto: 'Duas letras do nome ou tres digitos do telefone.',
        }),
      );
      return;
    }

    atual.append(
      el('div', { class: 'lista-item' }, [
        el('div', { class: 'corpo' }, [
          el('div', { class: 'titulo', texto: escolhida.nome }),
          el('div', { class: 'desc', texto: telefone(escolhida.telefone) || 'sem telefone' }),
        ]),
        botao('Trocar', {
          pequeno: true,
          aoClicar: () => {
            escolhida = null;
            buscaConversa.value = '';
            pintarEscolhida();
            buscaConversa.focus();
          },
        }),
      ]),
    );
  }

  function pintarResultados() {
    limpar(resultados);
    const achados = filtrarContatos(contatos, buscaConversa.value.trim());
    if (!achados) return;

    if (!achados.length) {
      resultados.append(
        el('small', {
          class: 'ajuda-campo',
          texto: 'Nenhuma conversa com esse nome ou telefone.',
        }),
      );
      return;
    }

    for (const contato of achados.slice(0, 8)) {
      resultados.append(
        el(
          'button',
          {
            type: 'button',
            class: 'lista-item',
            aoClick: () => {
              escolhida = contato;
              pintarEscolhida();
            },
          },
          [
            el('div', { class: 'corpo' }, [
              el('div', { class: 'titulo', texto: contato.nome }),
              el('div', { class: 'desc', texto: telefone(contato.telefone) || 'sem telefone' }),
            ]),
          ],
        ),
      );
    }
  }

  buscaConversa.addEventListener('input', pintarResultados);
  pintarEscolhida();

  // O campo, os resultados e a conversa escolhida sao um bloco so, entao a
  // margem de baixo fica no bloco e sai do campo.
  const campoConversa = campo('Conversa', buscaConversa);
  campoConversa.classList.add('sem-margem');

  gaveta({
    titulo: tarefa ? 'Editar tarefa' : 'Nova tarefa',
    corpo: [
      campo('Titulo', titulo),
      campo('Descricao', descricao),
      campoComDica('Pontuacao', pontos, EXPLICACAO_PONTOS),
      el('div', { class: 'mb-3' }, [campoConversa, resultados, atual]),
      campo('Responsavel', responsavel),
      campoComDica('Prazo', prazo, 'Vencido e ainda na fila, entra no numero de vencidas do topo.'),
      campo('Situacao', situacao),
    ],
    confirmar: 'Salvar',
    aoConfirmar: async () => {
      if (!titulo.value.trim()) throw new Error('Escreva um titulo para a tarefa.');
      if (!escolhida) throw new Error('Escolha a conversa a que a tarefa se refere.');
      if (!responsavel.value) throw new Error('Escolha o responsavel pela tarefa.');
      if (!prazo.value) throw new Error('Informe o prazo da tarefa.');

      const dados = {
        titulo: titulo.value.trim(),
        descricao: descricao.value.trim(),
        pontos: Number(pontos.value),
        contatoId: escolhida.id,
        responsavelId: responsavel.value,
        prazo: new Date(prazo.value).toISOString(),
        situacao: situacao.value,
      };

      if (tarefa) await api.patch(`/api/tarefas/${tarefa.id}`, dados);
      else await api.post('/api/tarefas', dados);

      aviso(tarefa ? 'Tarefa atualizada.' : 'Tarefa criada.', 'sucesso');
      await recarregarTela();
    },
  });
}

/* ------------------------------------------------------------------ */
/* Apoio                                                               */
/* ------------------------------------------------------------------ */

function semAcento(valor) {
  return String(valor || '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase();
}

/**
 * Busca por nome ou por telefone. Devolve null enquanto o termo e curto demais
 * para significar alguma coisa, e o trecho de numero so entra na conta a
 * partir de tres digitos: com menos que isso a lista inteira casaria, e uma
 * lista inteira nao e resultado de busca.
 */
function filtrarContatos(contatos, termo) {
  const alvo = semAcento(termo);
  const digitos = termo.replace(/\D+/g, '');
  if (!alvo || (alvo.length < 2 && digitos.length < 3)) return null;

  return contatos.filter(
    (contato) =>
      semAcento(contato.nome).includes(alvo) ||
      (digitos.length >= 3 && String(contato.telefone || '').includes(digitos)),
  );
}

/** ISO do servidor para o formato do input datetime-local, no fuso da tela. */
function paraCampoLocal(iso) {
  const data = iso ? new Date(iso) : proximoPrazo();
  return new Date(data.getTime() - data.getTimezoneOffset() * 60000).toISOString().slice(0, 16);
}

/** Amanha as 17h: da o dia inteiro de folga e cai dentro do expediente. */
function proximoPrazo() {
  const data = new Date(Date.now() + 86400000);
  data.setHours(17, 0, 0, 0);
  return data;
}
