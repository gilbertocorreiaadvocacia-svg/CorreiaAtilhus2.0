import { api } from '../api.js';
import { dica, previaDaMidia } from '../componentes.js';
import { estado, podeConfigurar, recarregar } from '../estado.js';
import {
  areaTexto,
  aviso,
  botao,
  campo,
  confirmar,
  el,
  entradaTexto,
  limpar,
  modal,
  plural,
  selecao,
  selo,
  vazio,
} from '../ui.js';

/**
 * Agentes de IA em tres colunas: a lista, o prompt e o painel de configuracao.
 *
 * O prompt fica grande e sempre visivel porque e nele que o trabalho acontece -
 * um roteiro bom tem entre 4 e 7 mil caracteres, e isso nao se edita dentro de
 * uma janelinha. A direita ficam os nove campos que definem o comportamento do
 * agente, com as mencoes reconhecidas logo abaixo do texto.
 */
export async function paginaAgentes({ parametros }) {
  // As tres colunas desta tela sao mais estreitas na lista e mais largas na
  // configuracao que as do atendimento. A medida mora no tema, em
  // .atendimento.colunas-agentes, e nao numa atribuicao a cada desenho.
  const container = el('div', { class: 'atendimento colunas-agentes' });
  let selecionadoId = parametros[0] || null;
  let vozes = { vozes: [], base: [], disponivel: false };
  let sujo = false;

  /**
   * Catalogo de mencoes, buscado uma vez por carga da tela.
   *
   * Antes ele era pedido de novo a cada pausa na digitacao do prompt, dentro do
   * debounce, e sem try. Numa sessao expirada no meio de um prompt longo a
   * rejeicao caia no unhandledrejection do app.js, que troca o aplicativo
   * inteiro pela tela de login e leva junto o texto nao salvo.
   */
  let catalogoDeMencoes = [];

  async function desenhar() {
    const [agentes, listaVozes] = await Promise.all([recarregar('agentes'), api.get('/api/vozes')]);
    vozes = listaVozes;

    try {
      catalogoDeMencoes = await api.get('/api/mencoes');
    } catch {
      // Sem catalogo os chips ficam como estao. Nao vale derrubar a tela por
      // causa da lista de sugestoes.
      catalogoDeMencoes = [];
    }

    if (!agentes.some((a) => a.id === selecionadoId)) selecionadoId = agentes[0]?.id || null;
    const agente = agentes.find((a) => a.id === selecionadoId) || null;

    limpar(container);
    container.append(colunaLista(agentes), colunaPrompt(agente), colunaConfiguracao(agente));
  }

  /* ---------------- Coluna 1: lista ---------------- */

  function colunaLista(agentes) {
    const corpo = el('div', { class: 'coluna-corpo' });

    const pastas = new Map();
    for (const agente of agentes) {
      const pasta = agente.pasta || 'Meus Agentes';
      if (!pastas.has(pasta)) pastas.set(pasta, []);
      pastas.get(pasta).push(agente);
    }

    for (const [pasta, lista] of pastas) {
      corpo.append(el('div', { class: 'menu-grupo', texto: pasta }));
      for (const agente of lista) {
        // Botao, e nao div com aoClick: a lista de agentes e a navegacao desta
        // tela, e o clique ainda e o unico caminho para a pergunta de prompt
        // nao salvo. No teclado, o div nem chegava ao foco.
        const ativo = agente.id === selecionadoId;
        corpo.append(
          el('button', {
            type: 'button',
            class: `item-conversa ${ativo ? 'ativo' : ''}`.trim(),
            'aria-current': ativo ? 'true' : null,
            aoClick: async () => {
              if (sujo && !window.confirm('Ha alteracoes nao salvas no prompt. Descartar?')) return;
              sujo = false;
              selecionadoId = agente.id;
              history.replaceState(null, '', `#/agentes/${agente.id}`);
              await desenhar();
            },
          }, [
            el('div', { class: 'dados' }, [
              el('div', { class: 'topo-item' }, [
                el('div', { class: 'nome', texto: agente.nome }),
                agente.ativo ? null : el('span', { class: 'selo erro', texto: 'off' }),
              ]),
              el('div', { class: 'previa', texto: `${plural(agente.caracteres, 'caractere', 'caracteres')} · ${plural(agente.mencoes.length, 'mencao', 'mencoes')}` }),
              // Tres selos e o teto da linha, o mesmo do Atendimento: no quarto a
              // faixa quebra em duas linhas. Com o agente desligado, o "off" la em
              // cima ja e o quarto, entao sai o de palavra-chave, que e o menos
              // urgente dos tres: agente off nao captura por palavra-chave mesmo.
              el('div', { class: 'marcas' }, [
                agente.primarioEm.length ? selo('primario', 'ouro') : null,
                agente.ativo && agente.palavrasChave?.length
                  ? selo(plural(agente.palavrasChave.length, 'palavra-chave', 'palavras-chave'), '')
                  : null,
                agente.mencoesInvalidas.length
                  ? selo(plural(agente.mencoesInvalidas.length, 'invalida', 'invalidas'), 'erro')
                  : null,
              ]),
            ]),
          ]),
        );
      }
    }

    if (!agentes.length) corpo.append(vazio('Nenhum agente', 'Crie o primeiro para o WhatsApp atender sozinho.'));

    return el('div', { class: 'coluna' }, [
      el('div', { class: 'coluna-cabecalho' }, [
        el('div', { class: 'linha-botoes' }, [
          podeConfigurar() ? botao('Novo', { pequeno: true, icone: 'mais', aoClicar: criarVazio }) : null,
          podeConfigurar() ? botao('Com IA', { pequeno: true, icone: 'raio', aoClicar: () => abrirGeracao(desenhar) }) : null,
          botao('Base', { pequeno: true, icone: 'pasta', titulo: 'Abrir a base de conhecimento', aoClicar: () => (location.hash = '#/conhecimento') }),
        ]),
      ]),
      corpo,
    ]);
  }

  async function criarVazio() {
    const criado = await api.post('/api/agentes', {
      nome: 'Novo agente',
      prompt: [
        'Voce e a assistente virtual do escritorio Correia Advogados Associados. Fala em portugues do Brasil, com educacao e objetividade, frases curtas.',
        '',
        'ROTEIRO OBRIGATORIO (siga na ordem, uma pergunta por vez):',
        '1. Cumprimente pelo nome e pergunte "…"',
        '2. …',
        '',
        'REGRAS:',
        '- Nunca prometa resultado, valor ou prazo.',
        '- Se o lead pedir atendimento humano, transfira com @responsavel.',
      ].join('\n'),
    });
    selecionadoId = criado.id;
    await desenhar();
  }

  /* ---------------- Coluna 2: prompt ---------------- */

  function colunaPrompt(agente) {
    if (!agente) {
      return el('div', { class: 'conversa' }, [vazio('Escolha um agente', 'Ou crie um novo pela coluna da esquerda.')]);
    }

    const nome = entradaTexto(agente.nome, { class: 't-lg peso-600' });
    const prompt = areaTexto(agente.prompt || '', { class: 'prompt' });

    const contador = el('span', { class: 'selo', texto: plural((agente.prompt || '').length, 'caractere', 'caracteres') });
    const faixa = el('span', { class: 'selo' });
    const chips = el('div', { class: 'faixa-chips' });

    function avaliarFaixa(tamanho) {
      if (tamanho < 1500) return ['curto demais (tende a alucinar)', 'alerta'];
      if (tamanho <= 7400) return ['faixa recomendada', 'sucesso'];
      if (tamanho <= 12000) return ['longo (custa mais por mensagem)', 'alerta'];
      return ['muito longo (o agente perde o fio)', 'erro'];
    }

    let temporizador = null;
    function analisar() {
      const tamanho = prompt.value.length;
      contador.textContent = plural(tamanho, 'caractere', 'caracteres');
      const [texto, tipo] = avaliarFaixa(tamanho);
      faixa.textContent = texto;
      faixa.className = `selo ${tipo}`;

      const alvo = prompt.value.toLowerCase();
      limpar(chips);
      const usadas = catalogoDeMencoes.filter((item) => alvo.includes(`@${String(item.rotulo).toLowerCase()}`));
      for (const item of usadas) {
        chips.append(el('span', { class: 'mencao-chip', texto: `@${item.rotulo}`, title: item.descricao || item.tipo }));
      }
      for (const invalida of agente.mencoesInvalidas) {
        if (alvo.includes(`@${invalida.toLowerCase()}`)) {
          chips.append(el('span', { class: 'mencao-chip invalida', texto: `@${invalida}`, title: 'Nao existe no workspace' }));
        }
      }
      if (!chips.children.length) {
        chips.append(el('span', { class: 't-xs c-fraco', texto: 'Nenhuma mencao no prompt.' }));
      }
    }

    prompt.addEventListener('input', () => {
      sujo = true;
      clearTimeout(temporizador);
      temporizador = setTimeout(analisar, 400);
    });
    nome.addEventListener('input', () => {
      sujo = true;
    });

    const salvar = async () => {
      await api.patch(`/api/agentes/${agente.id}`, { nome: nome.value.trim(), prompt: prompt.value });
      sujo = false;
      aviso('Agente salvo.', 'sucesso');
      await desenhar();
    };

    prompt.addEventListener('keydown', (evento) => {
      if ((evento.ctrlKey || evento.metaKey) && evento.key === 's') {
        evento.preventDefault();
        salvar();
      }
    });

    analisar();

    return el('div', { class: 'conversa' }, [
      el('div', { class: 'conversa-cabecalho' }, [
        el('div', { class: 'flexivel' }, [nome]),
        // O atalho mora no titulo do proprio botao que ele aciona. Escrito
        // como legenda fixa no rodape do prompt, era uma instrucao de uso lida
        // uma vez e relida todo dia sem querer.
        botao('Salvar', { tipo: 'principal', pequeno: true, titulo: 'Salvar (Ctrl+S)', aoClicar: salvar }),
      ]),
      el('div', { class: 'painel-prompt' }, [prompt]),
      el('div', { class: 'compositor' }, [
        el('div', { class: 'linha-botoes mb-2' }, [contador, faixa]),
        chips,
      ]),
    ]);
  }

  /* ---------------- Coluna 3: configuracao ---------------- */

  function colunaConfiguracao(agente) {
    if (!agente) return el('div', { class: 'coluna' });

    const salvar = async (mudancas) => {
      await api.patch(`/api/agentes/${agente.id}`, mudancas);
      await desenhar();
    };

    const modelo = estado.sessao.modelos.find((m) => m.id === agente.modelo);

    /**
     * Uma propriedade do agente: rotulo em cima, controle embaixo.
     *
     * `explicacao` e o conceito por tras do campo e vira balao no rotulo, nunca
     * uma linha de texto fixa embaixo do controle. Sao nove campos nesta
     * coluna: com a explicacao de cada um sempre na tela, a configuracao virava
     * um manual e o agente aberto ficava mais escondido que os textos que
     * falavam dele.
     */
    const bloco = (titulo, explicacao, ...filhos) =>
      el('div', { class: 'propriedade' }, [
        el('span', { class: explicacao ? 'linha' : null }, [
          titulo,
          explicacao ? dica(explicacao, { assunto: titulo.toLowerCase() }) : null,
        ]),
        ...filhos,
      ]);

    const conhecimento = el('div', { class: 'linha-botoes' });
    for (const base of estado.conhecimento) {
      const marcada = (agente.conhecimentoIds || []).includes(base.id);
      conhecimento.append(
        el('button', {
          class: `selo selo-clicavel ${marcada ? 'ouro' : ''}`.trim(),
          texto: base.nome,
          aoClick: async () => {
            const atuais = new Set(agente.conhecimentoIds || []);
            if (marcada) atuais.delete(base.id);
            else atuais.add(base.id);
            await salvar({ conhecimentoIds: [...atuais] });
          },
        }),
      );
    }
    if (!estado.conhecimento.length) {
      conhecimento.append(el('span', { class: 't-sm c-fraco', texto: 'Nenhuma base cadastrada.' }));
    }

    const palavras = entradaTexto((agente.palavrasChave || []).join(', '), { placeholder: 'bpc, loas' });
    palavras.addEventListener('change', () =>
      salvar({ palavrasChave: palavras.value.split(',').map((p) => p.trim()).filter(Boolean) }),
    );

    return el('div', { class: 'coluna' }, [
      el('div', { class: 'coluna-cabecalho' }, [
        el('div', { class: 't-md peso-600 linha' }, [
          'Configuracoes do agente',
          dica('Cada campo desta coluna salva sozinho. O Salvar do meio e do nome e do prompt.', {
            assunto: 'as configuracoes do agente',
          }),
        ]),
      ]),
      el('div', { class: 'coluna-corpo' }, [
        /* 1 e 2, mencoes e contagem ficam na coluna do prompt */
        bloco(
          'Mencoes reconhecidas',
          null,
          el('div', {}, [
            ...agente.mencoes.map((m) => el('span', { class: 'mencao-chip', texto: `@${m.rotulo}`, title: m.descricao || m.tipo })),
            ...agente.mencoesInvalidas.map((m) => el('span', { class: 'mencao-chip invalida', texto: `@${m}` })),
          ]),
          agente.mencoesInvalidas.length
            ? el('div', { class: 'alerta-caixa mt-2', texto: 'Mencao em vermelho nao existe no workspace. O agente se comporta de forma imprevisivel ate voce corrigir ou criar o item.' })
            : null,
        ),

        bloco(
          'Ferramentas ativas',
          'Montadas a partir das mencoes do prompt. Quanto menos ferramenta, menos chance de o agente fazer o que nao devia.',
          // O respiro entre os selos sai do gap do container, nao de uma
          // margem em cada selo.
          el('div', { class: 'linha-p quebra' }, (agente.ferramentas || []).map((f) => el('span', { class: 'selo', texto: f }))),
        ),

        bloco('Base de conhecimento', null, conhecimento),

        bloco(
          'Delay de agrupamento',
          'Tempo que o agente espera antes de responder. Cada nova mensagem do lead reinicia a contagem; resposta duplicada costuma ser delay curto.',
          selecao(
            [
              { valor: 5, rotulo: '5 s (quase imediato)' },
              { valor: 15, rotulo: '15 s (padrao)' },
              { valor: 30, rotulo: '30 s (audio e mensagem picada)' },
              { valor: 60, rotulo: '60 s (casos especificos)' },
            ],
            agente.delaySegundos ?? 15,
            { aoChange: (e) => salvar({ delaySegundos: Number(e.target.value) }) },
          ),
        ),

        bloco(
          'Agente primario',
          null,
          agente.primarioEm.length
            ? el('div', { class: 'linha-p quebra' }, agente.primarioEm.map((c) => selo(c.nome, 'ouro')))
            : el('div', { class: 't-sm c-fraco', texto: 'Nao atende automaticamente em nenhuma conexao.' }),
          botao('Definir na conexao', { pequeno: true, aoClicar: () => (location.hash = '#/conexoes') }),
        ),

        bloco(
          'Palavra-chave',
          'Vale apenas na primeira mensagem da conversa.',
          palavras,
        ),

        bloco(
          'Referencias',
          null,
          agente.referenciadoPor?.length
            ? el('div', { class: 'linha-p quebra' }, agente.referenciadoPor.map((r) => selo(r.nome, '')))
            : el('div', { class: 't-sm c-fraco', texto: 'Nenhum outro agente transfere para este.' }),
        ),

        bloco(
          'Voz do agente',
          null,
          selecao(
            [
              { valor: '', rotulo: 'Sem voz (responde por texto)' },
              ...vozes.vozes.map((v) => ({ valor: v.id, rotulo: `${v.nome} (do escritorio)` })),
              ...vozes.base.map((v) => ({ valor: v.id, rotulo: v.nome })),
            ],
            agente.vozId || '',
            { aoChange: (e) => salvar({ vozId: e.target.value || null }) },
          ),
          el('div', { class: 'linha-botoes mt-2' }, [
            botao('Ouvir', {
              pequeno: true,
              desabilitado: !vozes.disponivel || !agente.vozId,
              aoClicar: async () => {
                try {
                  const midia = await api.post('/api/vozes/testar', { vozId: agente.vozId });
                  modal({ titulo: 'Previa da voz', corpo: el('div', {}, [previaDaMidia(midia)]) });
                } catch (erro) {
                  aviso(erro.message, 'erro');
                }
              },
            }),
          ]),
        ),

        bloco(
          'Modelo de IA',
          // A frase de uso do modelo escolhido vem do servidor e muda a cada
          // troca. A coluna inteira e redesenhada no salvar, entao o balao
          // sempre fala do modelo que esta selecionado agora.
          modelo?.uso || null,
          selecao(
            estado.sessao.modelos.map((m) => ({ valor: m.id, rotulo: `${m.nome} · ${m.creditos} creditos` })),
            agente.modelo,
            { aoChange: (e) => salvar({ modelo: e.target.value }) },
          ),
          !agente.modeloDisponivel
            ? el('div', { class: 'alerta-caixa mt-2', texto: 'Sem chave para este provedor. O agente responde pelo roteiro por regras: segue o prompt numerado, uma etapa por resposta.' })
            : null,
        ),

        bloco(
          'Situacao',
          null,
          el('div', { class: 'linha-botoes' }, [
            botao(agente.ativo ? 'Desligar agente' : 'Ligar agente', {
              pequeno: true,
              aoClicar: () => salvar({ ativo: !agente.ativo }),
            }),
            podeConfigurar()
              ? botao('Excluir', {
                  pequeno: true,
                  tipo: 'perigo',
                  aoClicar: () =>
                    confirmar('Excluir agente?', `"${agente.nome}" sera removido. Conversas com ele como responsavel precisam de outro antes.`, async () => {
                      await api.delete(`/api/agentes/${agente.id}`);
                      selecionadoId = null;
                      await desenhar();
                    }, 'Excluir'),
                })
              : null,
          ]),
        ),
      ]),
    ]);
  }

  await desenhar();
  return container;
}

/* ------------------------------------------------------------------ */

function abrirGeracao(recarregarTela) {
  const nome = entradaTexto('', { placeholder: 'Triagem Aposentadoria' });
  const objetivo = selecao(
    [
      { valor: 'fechar', rotulo: 'Fechar contrato' },
      { valor: 'agendar', rotulo: 'Agendar reuniao' },
      { valor: 'qualificar', rotulo: 'Qualificar e transferir para humano' },
      { valor: 'recepcionar', rotulo: 'Recepcionar e rotear' },
      { valor: 'atender', rotulo: 'Atender pos-venda' },
    ],
    'qualificar',
  );
  const descricao = areaTexto('', {
    class: 'alta',
    placeholder: 'Explique como o escritorio atende esse caso: o que perguntar, em que ordem, o que desqualifica, como sao os honorarios.',
  });
  const referencia = areaTexto('', {
    placeholder: 'Opcional: cole uma conversa exemplar exportada do WhatsApp ou o script comercial.',
  });

  modal({
    titulo: 'Criar agente com IA',
    largo: true,
    corpo: el('div', {}, [
      // Fica so o que impede a acao de funcionar. O resto era descricao do que
      // a propria janela ja faz.
      el('div', { class: 'dica mb-3', texto: 'Precisa de chave de API cadastrada.' }),
      el('div', { class: 'grade g2' }, [campo('Nome', nome), campo('Objetivo', objetivo)]),
      campo('Como esse atendimento funciona', descricao),
      campo('Material de referencia', referencia),
    ]),
    confirmar: 'Gerar agente',
    aoConfirmar: async () => {
      if (!descricao.value.trim()) throw new Error('Descreva como o atendimento funciona.');
      await api.post('/api/agentes/gerar', {
        nome: nome.value.trim() || 'Agente gerado por IA',
        objetivo: objetivo.value,
        descricao: descricao.value,
        referencia: referencia.value || null,
      });
      aviso('Agente criado. Revise o prompt antes de colocar no ar.', 'sucesso');
      await recarregarTela();
    },
  });
}
