import { api, enviarArquivo } from '../api.js';
import { previaDaMidia } from '../componentes.js';
import { estado, podeConfigurar, recarregar } from '../estado.js';
import {
  areaTexto,
  avatar,
  aviso,
  botao,
  campo,
  confirmar,
  dataHora,
  el,
  entradaTexto,
  icone,
  interruptor,
  limpar,
  modal,
  plural,
  selecao,
  selo,
  vazio,
} from '../ui.js';

/**
 * Agentes de IA em tres colunas: a lista por pasta, as instrucoes do agente
 * aberto sempre a vista no meio, e a configuracao num painel a direita.
 *
 * As instrucoes sao o que mais se le e se reescreve, entao nao ficam mais atras
 * de uma aba: o painel da direita muda de assunto sem tirar o texto da frente.
 * O painel e agrupado pela pergunta que responde:
 *
 *   Atendimento   quando ele entra na conversa, de quem recebe, para quem passa
 *   Inteligencia  com que modelo pensa, e o que consulta
 *   Perfil        como a equipe o reconhece
 *
 * Duas licoes da tela antiga de tres colunas continuam valendo. Abaixo de
 * 1230px a terceira coluna sumia inteira, levando a configuracao junto: agora
 * ela desce para baixo das instrucoes, e nada some. E qualquer ajuste na coluna
 * da direita redesenhava a tela e apagava o prompt ainda nao salvo: agora o
 * texto vive num rascunho por agente, e o centro so e redesenhado quando muda o
 * agente aberto.
 */

/**
 * A pasta padrao. Tem que ser a MESMA string do servidor (PASTA_PADRAO em
 * servidor/rotas/automacoes.js), senao a tela mostra duas pastas onde o
 * escritorio ve uma so.
 */
const PASTA_PADRAO = 'Meus Agentes';

/* O valor sentinela do <select> de pasta. Nunca um caractere de controle: um
   NUL gravado neste arquivo ja fez o ripgrep trata-lo como binario e pula-lo
   em toda busca. */
const NOVA_PASTA = '::nova-pasta::';

/* As abas do painel da direita. Sao so icones, como no painel da conversa: o
   nome vai no title e no aria-label. */
const ABAS = [
  { id: 'atendimento', rotulo: 'Atendimento', icone: 'conversas' },
  { id: 'inteligencia', rotulo: 'Inteligência', icone: 'raio' },
  { id: 'perfil', rotulo: 'Perfil', icone: 'pessoa' },
];

/* Os grupos do menu de mencoes, na ordem em que se usa mais. */
const GRUPOS_DE_MENCAO = [
  ['sistema', 'Ações do sistema'],
  ['status', 'Status'],
  ['tag', 'Etiquetas'],
  ['variavel', 'Dados do cliente'],
  ['departamento', 'Departamentos'],
  ['agente', 'Agentes'],
  ['membro', 'Pessoas da equipe'],
  ['origem', 'Origens'],
  ['template', 'Templates'],
  ['personalizado', 'Ferramentas próprias'],
];

/* As faixas vem do servidor (PROMPT em config.js). Estas so valem se a sessao
   for de uma versao antiga, sem o campo. */
const FAIXAS_DE_RESERVA = { minimo: 1500, recomendadoAte: 7400, longoAte: 12000, maximo: 20000, caracteresPorToken: 3 };

const CHAVE_PASTAS_FECHADAS = 'correia.agentes.pastasFechadas';

function lerPastasFechadas() {
  try {
    return new Set(JSON.parse(localStorage.getItem(CHAVE_PASTAS_FECHADAS) || '[]'));
  } catch {
    return new Set();
  }
}

function gravarPastasFechadas(conjunto) {
  try {
    localStorage.setItem(CHAVE_PASTAS_FECHADAS, JSON.stringify([...conjunto]));
  } catch {
    /* navegador sem armazenamento: a pasta so nao fica lembrada */
  }
}

const numeroBr = (n) => Number(n || 0).toLocaleString('pt-BR');
const dolar = (v) =>
  `US$ ${Number(v || 0).toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

/**
 * O que o tamanho do prompt quer dizer, em numeros que a pessoa usa para
 * decidir: quantos tokens o modelo le, e quanto isso custa a cada mil
 * respostas — o prompt inteiro vai junto em TODA resposta do agente.
 */
function medir(tamanho, modeloId) {
  const faixas = estado.sessao?.prompt || FAIXAS_DE_RESERVA;
  const modelo = (estado.sessao?.modelos || []).find((m) => m.id === modeloId);
  const tokens = Math.ceil(tamanho / (faixas.caracteresPorToken || 3));
  const porMil = ((tokens * (modelo?.precoEntrada || 0)) / 1_000_000) * 1000;

  let faixa;
  if (tamanho < faixas.minimo) faixa = { texto: 'Curto demais: o agente improvisa', tipo: 'alerta' };
  else if (tamanho <= faixas.recomendadoAte) faixa = { texto: 'Na faixa recomendada', tipo: 'sucesso' };
  else if (tamanho <= faixas.longoAte) faixa = { texto: 'Longo: custa mais e mistura regras', tipo: 'alerta' };
  else faixa = { texto: 'Muito longo: leve o excesso para a base', tipo: 'erro' };

  return { faixas, tokens, porMil, faixa, cobra: Boolean(modelo?.precoEntrada) };
}

/** Como as conversas chegam a este agente, numa linha. */
function gatilhoDe(agente) {
  if (!agente.ativo) return { texto: 'Desligado', tipo: 'fraco' };
  /* O agente de avaliacao nao recebe conversa de ninguem: entra quando a equipe conclui. */
  if (agente.objetivo === 'avaliar') return { texto: 'Entra quando um atendimento é concluído', tipo: '' };
  if (agente.primarioEm?.length) return { texto: `Atende sozinho: ${agente.primarioEm.map((c) => c.nome).join(', ')}`, tipo: '' };
  if (agente.palavrasChave?.length) return { texto: `Palavra-chave: ${agente.palavrasChave.slice(0, 3).join(', ')}`, tipo: '' };
  if (agente.referenciadoPor?.length) return { texto: `Recebe de ${agente.referenciadoPor.map((r) => r.nome).join(', ')}`, tipo: '' };
  return { texto: 'Nenhuma conversa chega a ele', tipo: 'alerta' };
}

export async function paginaAgentes({ parametros, definirAcoes, definirPrincipal }) {
  const container = el('div', { class: 'agentes' });
  let selecionadoId = parametros[0] || null;
  /* Link antigo da aba Instrucoes (#/agentes/id/instrucoes) abre no
     Atendimento: as instrucoes agora ficam sempre a vista. */
  let aba = ABAS.some((a) => a.id === parametros[1]) ? parametros[1] : 'atendimento';
  let busca = '';
  let agentes = [];
  let vozes = { vozes: [], base: [], disponivel: false };
  let catalogoDeMencoes = [];
  const pastasFechadas = lerPastasFechadas();

  /* A tela de Agentes abre mostrando TODOS os escritorios juntos, para a
     equipe ver todo mundo sem trocar de workspace. O botao "Este escritorio"
     volta para so o aberto. Abrir ou editar um agente continua trocando de
     escritorio por baixo (agentes-por-escritorio.js). So faz sentido com mais
     de um escritorio; com um so, comeca nele mesmo. */
  const escritoriosDaSessao = estado.sessao?.workspaces || [];
  let verTodosOsEscritorios = escritoriosDaSessao.length > 1;
  let agentesDeTodos = null;

  /* id -> { nome, prompt } do que foi escrito e ainda nao salvo. */
  const rascunhos = new Map();
  const temRascunho = (id) => {
    const r = rascunhos.get(id);
    const agente = agentes.find((a) => a.id === id);
    return Boolean(r && agente && (r.nome !== agente.nome || r.prompt !== (agente.prompt || '')));
  };

  /* O agente desenhado no centro: { id, pintar(), salvar() }. */
  let centro = null;

  /* Sem agente no endereco (#/agentes), a tela abre na lista por pastas; com
     agente (#/agentes/id), no editor de tres colunas. */
  const modoLista = !parametros[0];
  const pastasDaLista = el('section', { class: 'agentes-pastas', 'aria-label': 'Agentes por pasta' });
  const squadsAbertos = new Set();

  definirAcoes?.(
    podeConfigurar()
      ? botao('Agentes por área', { pequeno: true, icone: 'usuarios', aoClicar: () => abrirPacotes() })
      : null,
    podeConfigurar()
      ? botao('Criar com IA', { pequeno: true, icone: 'raio', aoClicar: () => abrirGeracao(recarregarTudo) })
      : null,
  );
  definirPrincipal?.(
    podeConfigurar() ? botao('Novo agente', { tipo: 'principal', icone: 'mais', aoClicar: criarVazio }) : null,
  );

  const lista = el('aside', { class: 'agentes-lista', 'aria-label': 'Agentes' });
  const area = el('section', { class: 'agentes-area', 'aria-label': 'Instruções do agente' });
  const lado = el('aside', { class: 'agentes-lado', 'aria-label': 'Configuração do agente' });
  container.append(lista, area, lado);

  /* Ctrl+S salva de qualquer lugar da tela: e o texto das instrucoes que se protege. */
  container.addEventListener('keydown', (evento) => {
    if ((evento.ctrlKey || evento.metaKey) && evento.key.toLowerCase() === 's') {
      evento.preventDefault();
      centro?.salvar();
    }
  });

  async function recarregarTudo() {
    const [lidos, listaVozes] = await Promise.all([recarregar('agentes'), api.get('/api/vozes').catch(() => vozes)]);
    agentes = lidos;
    vozes = listaVozes;
    try {
      catalogoDeMencoes = await api.get('/api/mencoes');
    } catch {
      /* sem catalogo o menu de mencoes fica vazio; a tela segue */
    }
    if (modoLista) {
      /* Abrindo em "todos os escritorios": busca a lista cruzada antes de pintar. */
      if (verTodosOsEscritorios && !agentesDeTodos) {
        try {
          agentesDeTodos = await api.get('/api/agentes/todos-escritorios');
        } catch {
          verTodosOsEscritorios = false;
        }
      }
      desenharPastas();
      return;
    }
    if (!agentes.some((a) => a.id === selecionadoId)) selecionadoId = agentes[0]?.id || null;
    desenharLista();
    desenharArea();
  }

  function irPara(id, novaAba = aba) {
    selecionadoId = id;
    aba = novaAba;
    history.replaceState(null, '', `#/agentes/${id}${aba !== 'atendimento' ? `/${aba}` : ''}`);
    desenharLista();
    desenharArea();
  }

  /* Abre outro agente, pela lista ou pelo Caminho da conversa. Texto ainda nao
     salvo pede confirmacao antes de sair. */
  function abrirAgente(id) {
    if (id === selecionadoId) return;
    if (temRascunho(selecionadoId) && !window.confirm('Há alterações não salvas nas instruções. Sair mesmo assim?')) return;
    rascunhos.delete(selecionadoId);
    irPara(id);
  }

  /* ================= Lista ================= */

  function desenharLista() {
    limpar(lista);

    const campoBusca = entradaTexto(busca, {
      type: 'search',
      placeholder: 'Buscar agente',
      'aria-label': 'Buscar agente',
      class: 'agentes-busca-campo',
    });
    campoBusca.addEventListener('input', () => {
      busca = campoBusca.value;
      desenharItens();
    });

    const ligados = agentes.filter((a) => a.ativo).length;
    lista.append(
      el('div', { class: 'agentes-lista-topo' }, [
        el('a', { class: 'agentes-voltar', href: '#/agentes' }, [icone('voltar', 12), 'Todas as pastas']),
        el('label', { class: 'agentes-busca' }, [icone('lupa', 14), campoBusca]),
        el('div', {
          class: 'agentes-lista-resumo',
          texto: `${plural(agentes.length, 'agente', 'agentes')} · ${plural(ligados, 'ligado', 'ligados')}`,
        }),
      ]),
    );

    const itens = el('div', { class: 'agentes-itens' });
    lista.append(itens);

    function desenharItens() {
      limpar(itens);
      const termo = busca.trim().toLowerCase();
      const visiveis = agentes.filter((a) => !termo || a.nome.toLowerCase().includes(termo));

      if (!agentes.length) {
        itens.append(vazio('Nenhum agente', 'Crie o primeiro no botão Novo agente, lá em cima.', null, 'agentes'));
        return;
      }
      if (!visiveis.length) {
        itens.append(el('p', { class: 'agentes-nada', texto: `Nenhum agente com "${busca.trim()}".` }));
        return;
      }

      const pastas = new Map();
      for (const agente of visiveis) {
        const pasta = agente.pasta || PASTA_PADRAO;
        if (!pastas.has(pasta)) pastas.set(pasta, []);
        pastas.get(pasta).push(agente);
      }
      /* A padrao primeiro, o resto em ordem alfabetica: a ordem de criacao
         ninguem escolheu e ninguem lembra. */
      const nomes = [...pastas.keys()].sort((a, b) => {
        if (a === PASTA_PADRAO) return -1;
        if (b === PASTA_PADRAO) return 1;
        return a.localeCompare(b, 'pt-BR');
      });

      for (const pasta of nomes) {
        /* Buscando, toda pasta abre: esconder o resultado dentro de uma pasta
           fechada e o mesmo que nao ter achado. */
        const fechada = !termo && pastasFechadas.has(pasta);
        const grupo = el('div', { class: `agentes-pasta ${fechada ? 'fechada' : ''}`.trim() });
        grupo.append(
          el('div', { class: 'agentes-pasta-cabecalho' }, [
            el('button', {
              type: 'button',
              class: 'agentes-pasta-alternar',
              'aria-expanded': fechada ? 'false' : 'true',
              aoClick: () => {
                if (pastasFechadas.has(pasta)) pastasFechadas.delete(pasta);
                else pastasFechadas.add(pasta);
                gravarPastasFechadas(pastasFechadas);
                desenharItens();
              },
            }, [
              icone('voltar', 12),
              el('span', { class: 'agentes-pasta-nome', texto: pasta }),
              el('span', { class: 'agentes-pasta-conta', texto: String(pastas.get(pasta).length) }),
            ]),
            podeConfigurar()
              ? el('button', {
                  type: 'button',
                  class: 'pasta-renomear',
                  texto: 'renomear',
                  title: `Renomear a pasta ${pasta}`,
                  'aria-label': `Renomear a pasta ${pasta}`,
                  aoClick: () => renomearPasta(pasta, pastas.get(pasta).length),
                })
              : null,
          ]),
        );
        if (!fechada) for (const agente of pastas.get(pasta)) grupo.append(itemDaLista(agente));
        itens.append(grupo);
      }
    }

    desenharItens();
  }

  function itemDaLista(agente) {
    const ativo = agente.id === selecionadoId;
    const gatilho = gatilhoDe(agente);
    const invalidas = agente.mencoesInvalidas?.length || 0;

    return el('button', {
      type: 'button',
      class: `agente-item ${ativo ? 'ativo' : ''} ${agente.ativo ? '' : 'desligado'}`.replace(/\s+/g, ' ').trim(),
      'aria-current': ativo ? 'true' : null,
      aoClick: () => abrirAgente(agente.id),
    }, [
      el('span', { class: 'agente-item-rosto' }, [
        avatar(agente, 36),
        el('span', { class: `agente-ponto ${agente.ativo ? 'ligado' : ''}`.trim(), title: agente.ativo ? 'Ligado' : 'Desligado' }),
      ]),
      el('span', { class: 'agente-item-dados' }, [
        el('span', { class: 'agente-item-nome' }, [
          el('span', { class: 'agente-item-nome-texto', texto: agente.nome }),
          temRascunho(agente.id) ? el('span', { class: 'agente-item-rascunho', title: 'Alterações não salvas', texto: '•' }) : null,
        ]),
        el('span', { class: `agente-item-sub ${gatilho.tipo}`.trim(), texto: gatilho.texto }),
        invalidas
          ? el('span', { class: 'agente-item-alerta' }, [icone('alerta', 12), plural(invalidas, 'menção inválida', 'menções inválidas')])
          : null,
      ]),
    ]);
  }

  /**
   * Instala a secretaria, os especialistas e a proposta de uma area. O
   * servidor nunca sobrescreve agente que ja existe com o mesmo nome; a lista
   * mostra quais sao novos antes de confirmar.
   */
  async function abrirPacotes() {
    const pacotes = await api.get('/api/agentes-pacotes');
    if (!pacotes?.length) return aviso('Nenhum pacote disponível.', 'erro');

    const lista = el('ul', { class: 'lista-simples sem-margem' });
    const escolhaArea = selecao(pacotes.map((p) => ({ valor: p.area, rotulo: p.nome })), pacotes[0].area, {
      aoChange: () => desenharLista(),
    });
    const escolhaNumero = selecao(
      [
        { valor: '', rotulo: 'Não mexer em nenhum número' },
        ...(estado.conexoes || []).map((c) => ({ valor: c.id, rotulo: c.nome })),
      ],
      '',
    );

    let substituir = false;
    const quantosHoje = (estado.agentes || []).length;
    const trocar = interruptor(
      'Apagar os agentes de agora e ficar só com estes',
      false,
      (ligado) => {
        substituir = ligado;
        desenharLista();
      },
      {
        ajuda: `${plural(quantosHoje, 'agente sai', 'agentes saem')}, com uma cópia guardada na pasta de dados do sistema. As conversas e os números que estavam com eles passam para o primeiro agente da lista.`,
      },
    );

    function desenharLista() {
      limpar(lista);
      const pacote = pacotes.find((p) => p.area === escolhaArea.value);
      (pacote?.agentes || []).forEach((agente, posicao) => {
        const fica = agente.instalado && !substituir;
        lista.append(
          el('li', { class: 'linha-p' }, [
            el('span', { class: 'flexivel', texto: agente.nome }),
            posicao === 0 ? selo('recebe a conversa', 'propria') : null,
            selo(fica ? 'já existe, fica como está' : 'novo', fica ? '' : 'ouro'),
          ]),
        );
      });
    }
    desenharLista();

    modal({
      titulo: 'Agentes por área',
      corpo: el('div', {}, [
        el('p', {
          class: 'cartao-ajuda',
          texto: 'O primeiro agente recebe a conversa e passa para o membro do squad certo; cada membro faz a sua etapa e passa para o próximo, até o contrato. Quem recebe responde na hora. Etiquetas, departamentos e templates que os roteiros citam e ainda não existem são criados junto.',
        }),
        campo('Área', escolhaArea),
        lista,
        trocar,
        campo(
          'Usar num número',
          escolhaNumero,
          'Opcional. O número passa a ser desta área, e o primeiro agente responde toda conversa nova dele.',
        ),
      ]),
      confirmar: 'Instalar',
      aoConfirmar: async () => {
        const resposta = await api.post(`/api/agentes-pacotes/${escolhaArea.value}`, {
          conexaoId: escolhaNumero.value || undefined,
          substituir,
        });
        aviso(
          `${plural(resposta.criados.length, 'agente criado', 'agentes criados')}${resposta.mantidos.length ? `, ${plural(resposta.mantidos.length, 'já existia', 'já existiam')}` : ''}${resposta.removidos?.length ? `, ${plural(resposta.removidos.length, 'antigo apagado', 'antigos apagados')} (cópia em ${resposta.copia})` : ''}${resposta.conexao ? `. ${resposta.conexao.nome} agora é desta área` : ''}.`,
          'sucesso',
        );
        if (resposta.conexao) await recarregar('conexoes').catch(() => {});
        await recarregarTudo();
      },
    });
  }

  function renomearPasta(pasta, quantos) {
    const nome = entradaTexto(pasta, { placeholder: 'Nome da pasta' });
    modal({
      titulo: 'Renomear pasta',
      corpo: el('div', {}, [
        campo('Nome', nome),
        el('p', {
          class: 'dica sem-margem',
          texto: `${plural(quantos, 'agente', 'agentes')} ${quantos === 1 ? 'muda' : 'mudam'} de pasta. Com o nome de uma pasta que já existe, as duas viram uma só.`,
        }),
      ]),
      confirmar: 'Renomear',
      aoConfirmar: async () => {
        const novo = nome.value.trim();
        if (!novo) throw new Error('Escreva o nome da pasta.');
        if (novo === pasta) return;
        const resposta = await api.patch('/api/agentes-pasta', { de: pasta, para: novo });
        aviso(`${plural(resposta.movidos, 'agente movido', 'agentes movidos')}.`, 'sucesso');
        await recarregarTudo();
      },
    });
  }

  async function criarVazio() {
    if (temRascunho(selecionadoId) && !window.confirm('Há alterações não salvas nas instruções. Sair mesmo assim?')) return;
    rascunhos.delete(selecionadoId);
    const criado = await api.post('/api/agentes', {
      nome: 'Novo agente',
      prompt: [
        'QUEM VOCÊ É',
        'Você é a assistente virtual do escritório Correia Advogados Associados. Fala em português do Brasil, com educação e objetividade, em frases curtas.',
        '',
        'ROTEIRO (uma pergunta por vez, na ordem):',
        '1. Cumprimente pelo nome e pergunte "…"',
        '2. …',
        '',
        'REGRAS',
        '- Nunca prometa resultado, valor ou prazo.',
        '- Se a pessoa pedir atendimento humano, transfira com @responsavel.',
      ].join('\n'),
    });
    if (modoLista) {
      location.hash = `#/agentes/${criado.id}`;
      return;
    }
    selecionadoId = criado.id;
    await recarregarTudo();
  }

  /* ================= Area do agente ================= */

  function desenharArea() {
    const agente = agentes.find((a) => a.id === selecionadoId) || null;
    container.classList.toggle('sem-agente', !agente);
    if (!agente) {
      centro = null;
      limpar(area);
      limpar(lado);
      area.append(el('div', { class: 'agentes-vazio' }, [vazio('Escolha um agente', 'Ou crie um novo no botão Novo agente.', null, 'agentes')]));
      return;
    }

    /* O centro so e redesenhado quando muda o agente. Ligar, trocar o modelo
       ou mexer numa palavra-chave salva na hora e recarrega a lista e o painel;
       redesenhar o centro junto levaria o cursor e a rolagem de quem esta no
       meio do texto de volta para o comeco. */
    if (centro?.id === agente.id) centro.pintar();
    else desenharCentro(agente);
    desenharLado(agente);
  }

  function desenharCentro(agente) {
    limpar(area);
    const id = agente.id;
    /* O agente como esta na lista agora: cada ajuste salvo recarrega a lista, e
       o objeto de quando o centro foi desenhado fica velho. */
    const atual = () => agentes.find((a) => a.id === id) || agente;

    if (!rascunhos.has(id)) rascunhos.set(id, { nome: agente.nome, prompt: agente.prompt || '' });
    const rascunho = rascunhos.get(id);

    const botaoSalvar = botao('Salvar', { tipo: 'principal', titulo: 'Salvar nome e instruções (Ctrl+S)' });
    const estadoSalvo = el('span', { class: 'agentes-salvo', 'aria-live': 'polite' });
    const atualizarSalvo = () => {
      const sujo = temRascunho(id);
      botaoSalvar.disabled = !sujo;
      estadoSalvo.textContent = sujo ? 'Alterações não salvas' : 'Tudo salvo';
      estadoSalvo.classList.toggle('pendente', sujo);
    };

    const nome = entradaTexto(rascunho.nome, { class: 'agentes-nome', 'aria-label': 'Nome do agente', maxlength: '80' });
    nome.addEventListener('input', () => {
      rascunho.nome = nome.value;
      atualizarSalvo();
    });

    const salvarTexto = async () => {
      if (!temRascunho(id)) return;
      const enviado = { nome: rascunho.nome.trim(), prompt: rascunho.prompt };
      if (!enviado.nome) {
        aviso('Dê um nome ao agente antes de salvar.', 'erro');
        return;
      }
      try {
        await api.patch(`/api/agentes/${id}`, enviado);
        aviso('Agente salvo.', 'sucesso');
        await recarregarTudo();
        /* O rascunho continua sendo o dos campos, que seguem escrevendo nele. Se
           ninguem escreveu enquanto salvava, ele passa a ser o que ficou gravado
           (o nome, por exemplo, vai sem o espaco sobrando no fim). */
        if (rascunho.nome.trim() === enviado.nome && rascunho.prompt === enviado.prompt) {
          const salvo = atual();
          rascunho.nome = salvo.nome;
          rascunho.prompt = salvo.prompt || '';
          if (nome.value !== rascunho.nome) nome.value = rascunho.nome;
          if (instrucoes.texto.value !== rascunho.prompt) instrucoes.texto.value = rascunho.prompt;
        }
        atualizarSalvo();
      } catch (erro) {
        aviso(erro.message, 'erro');
      }
    };
    botaoSalvar.addEventListener('click', salvarTexto);

    const testar = botao('Testar no chat', {
      icone: 'simulador',
      aoClicar: () => {
        try {
          localStorage.setItem('correiatendimentos:chat-teste-agente', id);
        } catch {
          /* sem armazenamento, o chat abre no automatico */
        }
        location.hash = '#/simulador';
      },
    });

    /* Para quem configura, o rosto e o botao da foto (ver escolherFoto). */
    const rosto = podeConfigurar()
      ? el('button', { type: 'button', class: 'agentes-rosto', aoClick: () => escolherFoto(atual()) })
      : el('span', { class: 'agentes-rosto' });
    const sub = el('div', { class: 'agentes-identidade-sub' });

    /* As instrucoes leem o agente pela lista de agora: o modelo (que muda o
       custo) e as mencoes invalidas mudam depois de salvar, e o texto nao pode
       ser desenhado de novo por causa disso. */
    const instrucoes = abaInstrucoes(
      {
        get nome() {
          return atual().nome;
        },
        get modelo() {
          return atual().modelo;
        },
        get mencoesInvalidas() {
          return atual().mencoesInvalidas;
        },
      },
      rascunho,
      atualizarSalvo,
    );

    /* O que muda sem redesenhar o centro: o rosto (foto nova), ligado ou
       desligado, o modelo e a medida do texto, que depende do modelo. */
    function pintar() {
      const a = atual();
      const modelo = (estado.sessao?.modelos || []).find((m) => m.id === a.modelo);
      limpar(rosto);
      rosto.append(avatar(a, 44));
      if (rosto.tagName === 'BUTTON') {
        rosto.append(el('span', { class: 'agentes-rosto-marca', 'aria-hidden': 'true' }, [icone(a.foto ? 'contrato' : 'mais', 11)]));
        rosto.title = a.foto ? 'Trocar a foto do agente' : 'Adicionar uma foto ao agente';
        rosto.setAttribute('aria-label', rosto.title);
      }
      limpar(sub);
      sub.append(
        ...[
          el('span', { class: `agente-ponto ${a.ativo ? 'ligado' : ''}`.trim() }),
          el('span', { texto: a.ativo ? 'Ligado' : 'Desligado' }),
          el('span', { class: 'agentes-sep', texto: '·' }),
          el('span', { texto: modelo?.nome || 'Sem modelo' }),
          a.modeloDisponivel ? null : selo('sem chave: roteiro fixo', 'alerta'),
        ].filter(Boolean),
      );
      testar.disabled = !a.ativo;
      testar.title = a.ativo ? 'Abre o Chat de teste já conversando com este agente' : 'Ligue o agente para testar';
      instrucoes.medirAgora();
      atualizarSalvo();
    }

    area.append(
      el('header', { class: 'agentes-cabecalho' }, [
        rosto,
        el('div', { class: 'agentes-identidade' }, [nome, sub]),
        el('div', { class: 'agentes-cabecalho-acoes' }, [estadoSalvo, testar, botaoSalvar]),
      ]),
      instrucoes,
    );

    centro = { id, pintar, salvar: salvarTexto };
    pintar();
  }

  function desenharLado(agente) {
    /* Salvar um ajuste redesenha o painel. A rolagem volta para onde estava:
       sem isso, quem mexe no tempo de espera, la embaixo, seria jogado de volta
       para o topo a cada clique. */
    const mesmoPainel = lado.dataset.agente === agente.id && lado.dataset.aba === aba;
    const rolagem = mesmoPainel ? lado.querySelector('.agentes-lado-corpo')?.scrollTop || 0 : 0;
    limpar(lado);
    lado.dataset.agente = agente.id;
    lado.dataset.aba = aba;

    /* Configuracao salva na hora e recarrega a lista e o painel. */
    const salvarConfig = async (mudancas, mensagem) => {
      try {
        await api.patch(`/api/agentes/${agente.id}`, mudancas);
        if (mensagem) aviso(mensagem, 'sucesso');
        await recarregarTudo();
      } catch (erro) {
        aviso(erro.message, 'erro');
      }
    };

    const abas = el('div', { class: 'abas-icone', role: 'tablist', 'aria-label': 'Configuração do agente' });
    for (const item of ABAS) {
      const aberta = item.id === aba;
      abas.append(
        el('button', {
          type: 'button',
          role: 'tab',
          class: aberta ? 'aba-icone ativo' : 'aba-icone',
          title: item.rotulo,
          'aria-label': item.rotulo,
          'aria-selected': aberta ? 'true' : 'false',
          aoClick: () => irPara(agente.id, item.id),
        }, [icone(item.icone, 20)]),
      );
    }

    const conteudo =
      aba === 'inteligencia'
        ? abaInteligencia(agente, salvarConfig)
        : aba === 'perfil'
          ? abaPerfil(agente, salvarConfig)
          : abaAtendimento(agente, salvarConfig);

    const corpo = el('div', {
      class: 'agentes-lado-corpo',
      role: 'tabpanel',
      'aria-label': ABAS.find((a) => a.id === aba)?.rotulo || '',
    }, [conteudo]);
    lado.append(abas, corpo);
    corpo.scrollTop = rolagem;
  }

  /* ---------------- Instrucoes ---------------- */

  function abaInstrucoes(agente, rascunho, atualizarSalvo) {
    const faixas = estado.sessao?.prompt || FAIXAS_DE_RESERVA;
    const texto = areaTexto(rascunho.prompt, {
      class: 'agentes-prompt',
      maxlength: String(faixas.maximo),
      spellcheck: 'true',
      'aria-label': `Instruções de ${agente.nome}`,
    });

    const numeros = el('div', { class: 'agentes-medidor-numeros' });
    const regua = el('div', { class: 'agentes-regua', 'aria-hidden': 'true' });
    const marca = el('span', { class: 'agentes-regua-marca' });
    const chips = el('div', { class: 'agentes-mencoes' });

    /* A regua mostra as quatro faixas na proporcao real do limite. */
    const zonas = [
      [0, faixas.minimo, 'curto'],
      [faixas.minimo, faixas.recomendadoAte, 'bom'],
      [faixas.recomendadoAte, faixas.longoAte, 'longo'],
      [faixas.longoAte, faixas.maximo, 'demais'],
    ];
    for (const [de, ate, classe] of zonas) {
      regua.append(el('span', { class: `agentes-regua-zona ${classe}`, estilo: { flexGrow: String(ate - de) } }));
    }
    regua.append(marca);

    function medirAgora() {
      const tamanho = texto.value.length;
      const m = medir(tamanho, agente.modelo);
      limpar(numeros);
      numeros.append(
        el('span', { class: 'agentes-medidor-principal' }, [
          el('strong', { texto: numeroBr(tamanho) }),
          ` de ${numeroBr(faixas.maximo)} caracteres`,
        ]),
        el('span', { class: 'agentes-sep', texto: '·' }),
        el('span', { texto: `≈ ${numeroBr(m.tokens)} tokens` }),
        m.cobra ? el('span', { class: 'agentes-sep', texto: '·' }) : null,
        m.cobra
          ? el('span', {
              title: 'Custo só da leitura das instruções. O prompt inteiro vai junto em cada resposta do agente.',
              texto: `≈ ${dolar(m.porMil)} a cada mil respostas`,
            })
          : null,
        selo(m.faixa.texto, m.faixa.tipo),
      );
      marca.style.left = `${Math.min(100, (tamanho / faixas.maximo) * 100)}%`;
      desenharMencoes();
    }

    function desenharMencoes() {
      limpar(chips);
      const alvo = texto.value.toLowerCase();
      const usadas = catalogoDeMencoes.filter((item) => alvo.includes(`@${String(item.rotulo).toLowerCase()}`));
      const invalidas = (agente.mencoesInvalidas || []).filter((m) => alvo.includes(`@${m.toLowerCase()}`));

      if (!usadas.length && !invalidas.length) {
        chips.append(el('span', { class: 'agentes-apoio', texto: 'Nenhuma menção. Use Inserir menção para o agente mudar status, etiquetar ou transferir.' }));
        return;
      }
      for (const item of usadas) {
        chips.append(el('span', { class: 'mencao-chip', texto: `@${item.rotulo}`, title: item.descricao || item.tipo }));
      }
      for (const m of invalidas) {
        chips.append(el('span', { class: 'mencao-chip invalida', texto: `@${m}`, title: 'Não existe mais neste escritório' }));
      }
      if (invalidas.length) {
        chips.append(
          el('div', { class: 'agentes-invalidas' }, [
            icone('alerta', 14),
            el('span', {
              texto: `${plural(invalidas.length, 'menção aponta', 'menções apontam')} para algo que não existe mais (template, status ou etiqueta apagados). O agente não consegue executar essa parte.`,
            }),
            botao('Tirar do texto', {
              pequeno: true,
              aoClicar: () => {
                let novo = texto.value;
                for (const m of invalidas) {
                  const escapado = m.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
                  novo = novo.replace(new RegExp(`\\s?@${escapado}(?![\\wÀ-ÿ-])`, 'gi'), '');
                }
                texto.value = novo;
                texto.dispatchEvent(new Event('input'));
              },
            }),
          ]),
        );
      }
    }

    let temporizador = null;
    texto.addEventListener('input', () => {
      rascunho.prompt = texto.value;
      atualizarSalvo();
      clearTimeout(temporizador);
      temporizador = setTimeout(medirAgora, 250);
    });

    /* ---------- Inserir mencao ---------- */

    const menu = el('div', { class: 'agentes-menu-mencoes', hidden: true, role: 'dialog', 'aria-label': 'Inserir menção' });
    const filtroMenu = entradaTexto('', { type: 'search', placeholder: 'Procurar', 'aria-label': 'Procurar menção' });
    const listaMenu = el('div', { class: 'agentes-menu-lista' });
    menu.append(filtroMenu, listaMenu);

    function inserir(rotulo) {
      const antes = texto.value.slice(0, texto.selectionStart);
      const espaco = antes && !/\s$/.test(antes) ? ' ' : '';
      texto.setRangeText(`${espaco}@${rotulo} `, texto.selectionStart, texto.selectionEnd, 'end');
      texto.dispatchEvent(new Event('input'));
      fecharMenu();
      texto.focus();
    }

    function desenharMenu() {
      limpar(listaMenu);
      const termo = filtroMenu.value.trim().toLowerCase();
      let achou = 0;
      for (const [tipo, titulo] of GRUPOS_DE_MENCAO) {
        const itens = catalogoDeMencoes.filter(
          (i) => i.tipo === tipo && (!termo || `${i.rotulo} ${i.descricao || ''}`.toLowerCase().includes(termo)),
        );
        if (!itens.length) continue;
        listaMenu.append(el('div', { class: 'agentes-menu-grupo', texto: titulo }));
        for (const item of itens) {
          achou += 1;
          listaMenu.append(
            el('button', { type: 'button', class: 'agentes-menu-item', aoClick: () => inserir(item.rotulo) }, [
              el('span', { class: 'agentes-menu-rotulo', texto: `@${item.rotulo}` }),
              item.descricao ? el('span', { class: 'agentes-menu-desc', texto: item.descricao }) : null,
            ]),
          );
        }
      }
      if (!achou) listaMenu.append(el('p', { class: 'agentes-apoio', texto: 'Nada com esse nome.' }));
    }
    filtroMenu.addEventListener('input', desenharMenu);

    const fecharNoClique = (evento) => {
      if (!menu.contains(evento.target) && !botaoMenu.contains(evento.target)) fecharMenu();
    };
    function fecharMenu() {
      menu.hidden = true;
      botaoMenu.setAttribute('aria-expanded', 'false');
      document.removeEventListener('mousedown', fecharNoClique);
    }
    const botaoMenu = botao('Inserir menção', {
      pequeno: true,
      icone: 'mais',
      aoClicar: () => {
        if (!menu.hidden) return fecharMenu();
        menu.hidden = false;
        botaoMenu.setAttribute('aria-expanded', 'true');
        filtroMenu.value = '';
        desenharMenu();
        filtroMenu.focus();
        document.addEventListener('mousedown', fecharNoClique);
      },
    });
    botaoMenu.setAttribute('aria-expanded', 'false');
    menu.addEventListener('keydown', (evento) => {
      if (evento.key === 'Escape') {
        fecharMenu();
        botaoMenu.focus();
      }
    });

    medirAgora();

    /* O centro guarda o campo e a medida: a troca de modelo mede de novo, e o
       texto gravado volta ao campo, sem desenhar as instrucoes outra vez. */
    return Object.assign(
      el('div', { class: 'agentes-instrucoes' }, [
        el('div', { class: 'agentes-barra-prompt' }, [
          el('div', { class: 'agentes-barra-titulo' }, [
            el('strong', { texto: 'Instruções do agente' }),
            el('span', { class: 'agentes-apoio', texto: 'Quem ele é, como fala, o roteiro e o que nunca fazer.' }),
          ]),
          el('div', { class: 'agentes-barra-acoes' }, [botaoMenu, menu]),
        ]),
        texto,
        el('div', { class: 'agentes-medidor' }, [numeros, regua, chips]),
      ]),
      { texto, medirAgora },
    );
  }

  /* ---------------- Painel: Atendimento ---------------- */

  /* Um bloco do painel: o rotulo, o controle e, embaixo, a ajuda curta. */
  function secao(titulo, ajuda, ...filhos) {
    return el('section', { class: 'agentes-secao' }, [
      el('h3', { class: 'agentes-secao-titulo', texto: titulo }),
      ...filhos,
      ajuda ? el('p', { class: 'agentes-secao-ajuda', texto: ajuda }) : null,
    ]);
  }

  /* Lista editavel como etiquetas: escrever e Enter (ou virgula) acrescenta, o
     x tira. Salva na hora, como o resto do painel. */
  function etiquetasEditaveis(valores, { rotulo, nomeDoItem, exemplo, gravar, ajustar = (valor) => valor }) {
    const itens = [...valores];
    const caixa = el('div', { class: 'agentes-tags' });
    const nova = entradaTexto('', { placeholder: itens.length ? 'Mais uma…' : exemplo, 'aria-label': rotulo });
    const acrescentar = () => {
      const novas = nova.value.split(',').map((valor) => ajustar(valor.trim())).filter(Boolean);
      const antes = itens.length;
      for (const valor of novas) if (!itens.includes(valor)) itens.push(valor);
      nova.value = '';
      if (itens.length !== antes) gravar(itens);
    };
    nova.addEventListener('keydown', (evento) => {
      if (evento.key === 'Enter' || evento.key === ',') {
        evento.preventDefault();
        acrescentar();
      }
    });
    nova.addEventListener('blur', () => {
      if (nova.value.trim()) acrescentar();
    });
    for (const valor of itens) {
      caixa.append(
        el('span', { class: 'agentes-tag' }, [
          valor,
          el('button', {
            type: 'button',
            class: 'agentes-tag-tirar',
            'aria-label': `Tirar ${nomeDoItem} ${valor}`,
            aoClick: () => {
              itens.splice(itens.indexOf(valor), 1);
              gravar(itens);
            },
          }, [icone('fechar', 10)]),
        ]),
      );
    }
    caixa.append(nova);
    return caixa;
  }

  /*
   * Caminho da conversa: por onde ela chega a este agente e para quem ele a
   * passa. Chega por um numero em que ele atende sozinho, por palavra-chave ou
   * por outro agente que o menciona nas instrucoes; segue para os agentes que
   * ele menciona. Agente do caminho abre com um clique.
   */
  function caminhoDa(agente) {
    const passo = (rosto, nome, apoio, opcoes = {}) => {
      const classe = ['agentes-passo', opcoes.atual ? 'atual' : '', opcoes.alerta ? 'alerta' : ''].filter(Boolean).join(' ');
      const filhos = [
        rosto,
        el('span', { class: 'agentes-passo-dados' }, [
          el('span', { class: 'agentes-passo-nome', texto: nome }),
          el('span', { class: 'agentes-passo-apoio', texto: apoio }),
        ]),
      ];
      if (!opcoes.abrir) return el('div', { class: classe }, filhos);
      return el('button', { type: 'button', class: classe, title: `Abrir ${nome}`, aoClick: opcoes.abrir }, filhos);
    };
    const simbolo = (nome) => el('span', { class: 'agentes-passo-simbolo' }, [icone(nome, 14)]);
    const ligacao = () => el('span', { class: 'agentes-ligacao', 'aria-hidden': 'true' });

    const chegadas = [
      ...(agente.primarioEm || []).map((conexao) =>
        passo(simbolo('conexoes'), conexao.nome, 'toda conversa nova deste número começa aqui'),
      ),
      ...(agente.palavrasChave?.length
        ? [passo(simbolo('etiqueta'), 'Palavra-chave', `primeira mensagem com ${agente.palavrasChave.slice(0, 2).join(' ou ')}`)]
        : []),
      ...(agente.referenciadoPor || []).map((origem) =>
        passo(avatar(agentes.find((a) => a.id === origem.id) || origem, 28), origem.nome, 'passa a conversa para este agente', {
          abrir: () => abrirAgente(origem.id),
        }),
      ),
    ];
    const saidas = agentes
      .filter((outro) => outro.id !== agente.id && (outro.referenciadoPor || []).some((r) => r.id === agente.id))
      .map((destino) =>
        passo(avatar(destino, 28), destino.nome, destino.ativo ? 'recebe a conversa deste agente' : 'recebe daqui, mas está desligado', {
          abrir: () => abrirAgente(destino.id),
        }),
      );

    return el('div', { class: 'agentes-caminho' }, [
      el('div', { class: 'agentes-caminho-grupo' }, chegadas.length
        ? chegadas
        : [passo(simbolo('alerta'), 'Nenhuma conversa chega a ele', 'escolha um número em Conexões ou escreva palavras-chave', { alerta: true })]),
      ligacao(),
      passo(avatar(agente, 28), agente.nome, 'este agente', { atual: true }),
      ligacao(),
      saidas.length
        ? el('div', { class: 'agentes-caminho-grupo' }, saidas)
        : passo(simbolo('ok'), 'Termina aqui', 'para passar adiante, mencione outro agente nas instruções'),
    ]);
  }

  function abaAtendimento(agente, salvarConfig) {
    /* Area: com qual numero ele trabalha, e para quem pode passar a conversa. */
    const area = el('select', { 'aria-label': 'Área do agente' }, [
      el('option', { value: '', texto: 'Todas as áreas' }),
      ...(estado.sessao?.areas || []).map((a) => el('option', { value: a.id, texto: a.nome })),
    ]);
    area.value = agente.area || '';
    area.addEventListener('change', () => salvarConfig({ area: area.value || null }));

    const esperas = [
      { valor: 5, rotulo: '5 s', ajuda: 'quase imediato' },
      { valor: 15, rotulo: '15 s', ajuda: 'padrão' },
      { valor: 30, rotulo: '30 s', ajuda: 'áudio e mensagem picada' },
      { valor: 60, rotulo: '60 s', ajuda: 'casos específicos' },
    ];
    const atualEspera = agente.delaySegundos ?? 15;
    const escolhida = esperas.find((e) => e.valor === atualEspera);
    const segmentado = el(
      'div',
      { class: 'agentes-segmentado', role: 'radiogroup', 'aria-label': 'Tempo de espera' },
      esperas.map((e) =>
        el('button', {
          type: 'button',
          role: 'radio',
          'aria-checked': e.valor === atualEspera ? 'true' : 'false',
          class: e.valor === atualEspera ? 'ativo' : '',
          title: e.ajuda,
          aoClick: () => e.valor !== atualEspera && salvarConfig({ delaySegundos: e.valor }),
        }, [e.rotulo]),
      ),
    );

    return el('div', { class: 'agentes-config' }, [
      secao(
        'Situação',
        'Desligado, ele não responde a ninguém e some do Chat de teste.',
        interruptor(agente.ativo ? 'Agente ligado' : 'Agente desligado', agente.ativo, (ligado) =>
          salvarConfig({ ativo: ligado }, ligado ? 'Agente ligado.' : 'Agente desligado.'),
        ),
      ),
      secao('Área', 'Palavra-chave e passagem de conversa só valem dentro da mesma área.', area),
      secao(
        'Caminho da conversa',
        null,
        caminhoDa(agente),
        botao('Abrir Conexões', { pequeno: true, icone: 'abrir', aoClicar: () => (location.hash = '#/conexoes') }),
      ),
      secao(
        'Precisa coletar antes de avançar',
        'Enquanto faltar algum, ele lê "FALTA COLETAR" no contexto.',
        /* O servidor transforma o texto em chave (CTPS foto -> ctps_foto). */
        etiquetasEditaveis(agente.requisitos || [], {
          rotulo: 'Novo requisito',
          nomeDoItem: 'o requisito',
          exemplo: 'qualidade_segurado, ctps_foto',
          gravar: (requisitos) => salvarConfig({ requisitos }),
        }),
      ),
      secao(
        'Palavras-chave',
        'Só valem na primeira mensagem de quem escreve.',
        etiquetasEditaveis(agente.palavrasChave || [], {
          rotulo: 'Nova palavra-chave',
          nomeDoItem: 'a palavra-chave',
          exemplo: 'bpc, loas, auxílio…',
          ajustar: (palavra) => palavra.toLowerCase(),
          gravar: (palavrasChave) => salvarConfig({ palavrasChave }),
        }),
      ),
      secao(
        'Tempo de espera antes de responder',
        `${escolhida ? `${escolhida.rotulo}: ${escolhida.ajuda}. ` : ''}Cada mensagem nova reinicia a contagem, para ele responder a tudo de uma vez.`,
        segmentado,
      ),
    ]);
  }

  /* ---------------- Inteligencia ---------------- */

  function abaInteligencia(agente, salvarConfig) {
    const tamanho = (rascunhos.get(agente.id)?.prompt ?? agente.prompt ?? '').length;

    const modelos = el(
      'div',
      { class: 'agentes-modelos', role: 'radiogroup', 'aria-label': 'Modelo de IA' },
      (estado.sessao?.modelos || []).map((m) => {
        const escolhido = m.id === agente.modelo;
        const custo = medir(tamanho, m.id);
        return el('button', {
          type: 'button',
          role: 'radio',
          'aria-checked': escolhido ? 'true' : 'false',
          class: `agentes-modelo ${escolhido ? 'ativo' : ''}`.trim(),
          aoClick: () => !escolhido && salvarConfig({ modelo: m.id }, `${agente.nome} agora usa ${m.nome}.`),
        }, [
          el('span', { class: 'agentes-modelo-topo' }, [
            el('strong', { texto: m.nome }),
            escolhido ? icone('ok', 14) : null,
          ]),
          el('span', { class: 'agentes-modelo-uso', texto: m.uso || '' }),
          el('span', {
            class: 'agentes-modelo-custo',
            texto: custo.cobra ? `Instruções: ≈ ${dolar(custo.porMil)} a cada mil respostas` : 'Sem custo de IA',
          }),
        ]);
      }),
    );

    const bases = el('div', { class: 'agentes-bases' });
    for (const base of estado.conhecimento) {
      const marcada = (agente.conhecimentoIds || []).includes(base.id);
      const caixa = el('input', { type: 'checkbox', checked: marcada || null });
      caixa.addEventListener('change', () => {
        const atuais = new Set(agente.conhecimentoIds || []);
        if (caixa.checked) atuais.add(base.id);
        else atuais.delete(base.id);
        salvarConfig({ conhecimentoIds: [...atuais] });
      });
      bases.append(
        el('label', { class: `agentes-base ${marcada ? 'ativo' : ''}`.trim() }, [
          caixa,
          el('span', { class: 'agentes-base-dados' }, [
            el('strong', { texto: base.nome }),
            base.descricao ? el('span', { texto: base.descricao }) : null,
          ]),
        ]),
      );
    }
    if (!estado.conhecimento.length) bases.append(el('p', { class: 'agentes-apoio', texto: 'Nenhuma base cadastrada ainda.' }));

    return el('div', { class: 'agentes-config' }, [
      secao(
        'Modelo de IA',
        agente.modeloDisponivel
          ? 'O cérebro do agente. O custo abaixo é só o da leitura das instruções, que vão junto em toda resposta.'
          : 'Sem a chave deste provedor em Integrações, o agente responde pelo roteiro fixo: segue as falas numeradas do prompt, uma por resposta.',
        modelos,
      ),
      secao(
        'Base de conhecimento',
        'Marcar já basta: o agente consulta o que estiver marcado quando a pergunta for de regra, requisito, prazo ou valor. É aqui que mora o material longo, e não nas instruções.',
        bases,
        botao('Abrir a base de conhecimento', { pequeno: true, icone: 'pasta', aoClicar: () => (location.hash = '#/conhecimento') }),
      ),
      secao(
        'O que ele pode fazer',
        'Sai das menções escritas nas instruções. Quanto menos ferramenta, menos chance de ele fazer o que não devia.',
        agente.ferramentas?.length
          ? el('div', { class: 'linha-p quebra' }, agente.ferramentas.map((f) => el('span', { class: 'selo', texto: f })))
          : el('p', { class: 'agentes-apoio', texto: 'Só conversar: nenhuma ação.' }),
      ),
    ]);
  }

  /* ---------------- Foto do agente ---------------- */

  /* Formatos que o navegador desenha. Foto de iPhone vem em HEIC: sobe sem erro
     e o <img> nao desenha — melhor recusar dizendo o que fazer. */
  const FORMATOS_DE_FOTO = ['image/jpeg', 'image/png', 'image/webp', 'image/gif'];

  /* Abre o seletor de arquivo e grava a foto. Quem chama e o rosto do agente,
     no alto das instrucoes, e o Perfil: so no Perfil, atras de uma aba de
     icone, a foto ficava escondida. */
  function escolherFoto(agente) {
    const seletor = el('input', { type: 'file', accept: FORMATOS_DE_FOTO.join(',') });
    seletor.addEventListener('change', async () => {
      const arquivo = seletor.files[0];
      if (!arquivo) return;
      if (!FORMATOS_DE_FOTO.includes(arquivo.type)) {
        aviso('Use uma foto em JPG, PNG ou WEBP. Foto de iPhone costuma vir em HEIC: exporte como JPG antes.', 'erro');
        return;
      }
      try {
        const midia = await enviarArquivo(arquivo);
        await api.patch(`/api/agentes/${agente.id}`, { foto: midia.url });
        aviso(agente.foto ? 'Foto do agente trocada.' : 'Foto do agente adicionada.', 'sucesso');
        await recarregarTudo();
      } catch (erro) {
        aviso(erro.message, 'erro');
      }
    });
    seletor.click();
  }

  /* ---------------- Perfil ---------------- */

  function abaPerfil(agente, salvarConfig) {

    const pastas = [...new Set(agentes.map((a) => a.pasta || PASTA_PADRAO))].sort((a, b) => {
      if (a === PASTA_PADRAO) return -1;
      if (b === PASTA_PADRAO) return 1;
      return a.localeCompare(b, 'pt-BR');
    });
    const escolhaDePasta = selecao(
      [...pastas.map((p) => ({ valor: p, rotulo: p })), { valor: NOVA_PASTA, rotulo: 'Nova pasta…' }],
      agente.pasta || PASTA_PADRAO,
      {
        'aria-label': 'Pasta',
        aoChange: (evento) => {
          if (evento.target.value !== NOVA_PASTA) return salvarConfig({ pasta: evento.target.value });
          /* Volta o <select> ANTES da janela: se a pessoa desistir, ele nao
             pode ficar mostrando "Nova pasta…" como se fosse onde o agente esta. */
          evento.target.value = agente.pasta || PASTA_PADRAO;
          const nome = entradaTexto('', { placeholder: 'Comercial' });
          modal({
            titulo: 'Nova pasta',
            corpo: el('div', {}, [campo('Nome', nome)]),
            confirmar: 'Mover para a pasta',
            aoConfirmar: async () => {
              const escolhido = nome.value.trim();
              if (!escolhido) throw new Error('Escreva o nome da pasta.');
              if (escolhido.length > 40) throw new Error('Nome muito longo (máximo 40 caracteres).');
              await salvarConfig({ pasta: escolhido });
            },
          });
        },
      },
    );

    const escolhaDeVoz = selecao(
      [
        { valor: '', rotulo: 'Sem voz (responde por texto)' },
        ...vozes.vozes.map((v) => ({ valor: v.id, rotulo: `${v.nome} (do escritório)` })),
        ...vozes.base.map((v) => ({ valor: v.id, rotulo: v.nome })),
      ],
      agente.vozId || '',
      { 'aria-label': 'Voz do agente', aoChange: (e) => salvarConfig({ vozId: e.target.value || null }) },
    );

    return el('div', { class: 'agentes-config' }, [
      secao(
        'Foto',
        'Aparece na lista e na conversa, no lugar das iniciais. Ajuda a equipe a ver de relance quem está conduzindo.',
        el('div', { class: 'agentes-foto' }, [
          avatar(agente, 64),
          el('div', { class: 'linha-p quebra' }, [
            botao(agente.foto ? 'Trocar foto' : 'Escolher foto', { pequeno: true, aoClicar: () => escolherFoto(agente) }),
            agente.foto
              ? botao('Tirar a foto', { pequeno: true, aoClicar: () => salvarConfig({ foto: null }, 'Foto removida.') })
              : null,
          ]),
        ]),
      ),
      secao('Pasta', 'Só organiza a lista ao lado. Não muda nada no atendimento.', escolhaDePasta),
      secao(
        'Voz',
        vozes.disponivel ? 'Com voz, o agente pode responder em áudio quando a pessoa pede.' : 'A voz precisa da chave da OpenAI em Integrações.',
        escolhaDeVoz,
        botao('Ouvir', {
          pequeno: true,
          desabilitado: !vozes.disponivel || !agente.vozId,
          aoClicar: async () => {
            try {
              const midia = await api.post('/api/vozes/testar', { vozId: agente.vozId });
              modal({ titulo: 'Prévia da voz', corpo: el('div', {}, [previaDaMidia(midia)]) });
            } catch (erro) {
              aviso(erro.message, 'erro');
            }
          },
        }),
      ),
      podeConfigurar()
        ? el('section', { class: 'agentes-secao agentes-perigo' }, [
            el('h3', { class: 'agentes-secao-titulo', texto: 'Excluir agente' }),
            el('p', {
              class: 'agentes-secao-ajuda',
              texto: 'Conversas que estão com ele precisam de outro responsável antes. Não dá para desfazer.',
            }),
            botao('Excluir agente', {
              pequeno: true,
              tipo: 'perigo',
              icone: 'lixo',
              aoClicar: () =>
                confirmar('Excluir agente?', `"${agente.nome}" será removido.`, async () => {
                  await api.delete(`/api/agentes/${agente.id}`);
                  rascunhos.delete(agente.id);
                  selecionadoId = null;
                  await recarregarTudo();
                }, 'Excluir'),
            }),
          ])
        : null,
    ]);
  }

  /* ================= Lista por pastas ================= */

  /*
   * No molde da LiderHub: cada pasta com o agente que recebe a conversa e, ao
   * lado dele, os membros do squad. Clicar no agente abre o editor.
   *
   * Quem lidera e quem tem o objetivo "recepcionar". O membro vai para o lider
   * que chega ate ele pelas mencoes (@agente nas instrucoes); sem caminho, para
   * o primeiro lider da pasta. Pasta sem ninguem que recepcione mostra cada
   * agente numa linha.
   */
  function squadsDaPasta(daPasta) {
    const lideres = daPasta.filter((a) => a.objetivo === 'recepcionar');
    if (!lideres.length) return daPasta.map((agente) => ({ agente, membros: [] }));

    /* referenciadoPor diz quem cita o agente; o caminho do lider e o inverso. */
    const idsDaPasta = new Set(daPasta.map((a) => a.id));
    const cita = new Map(daPasta.map((a) => [a.id, []]));
    for (const agente of daPasta) {
      for (const quem of agente.referenciadoPor || []) if (idsDaPasta.has(quem.id)) cita.get(quem.id).push(agente.id);
    }
    const idsDeLider = new Set(lideres.map((l) => l.id));
    const donoDe = new Map();
    for (const lider of lideres) {
      const fila = [lider.id];
      const visto = new Set(fila);
      while (fila.length) {
        for (const proximo of cita.get(fila.shift()) || []) {
          if (visto.has(proximo)) continue;
          visto.add(proximo);
          fila.push(proximo);
          if (!idsDeLider.has(proximo) && !donoDe.has(proximo)) donoDe.set(proximo, lider.id);
        }
      }
    }

    const squads = lideres.map((agente) => ({ agente, membros: [] }));
    for (const agente of daPasta) {
      if (idsDeLider.has(agente.id)) continue;
      const lider = donoDe.get(agente.id) || lideres[0].id;
      squads.find((s) => s.agente.id === lider).membros.push(agente);
    }
    return squads;
  }

  const editadoEm = (lista) =>
    lista
      .map((a) => a.atualizadoEm || a.criadoEm || '')
      .sort()
      .pop() || '';

  function desenharPastas() {
    limpar(pastasDaLista);
    const workspace = estado.sessao?.workspace;
    const escritorios = estado.sessao?.workspaces || [];
    const ligados = agentes.filter((a) => a.ativo).length;
    const quantasPastas = new Set(agentes.map((a) => a.pasta || PASTA_PADRAO)).size;

    const campoBusca = entradaTexto(busca, {
      type: 'search',
      placeholder: verTodosOsEscritorios ? 'Buscar agente ou escritório' : 'Buscar agente ou pasta',
      'aria-label': verTodosOsEscritorios ? 'Buscar agente ou escritório' : 'Buscar agente ou pasta',
      class: 'agentes-busca-campo',
    });
    campoBusca.addEventListener('input', () => {
      busca = campoBusca.value;
      desenharCorpo();
    });

    /* So troca a ABA: abrir ou editar um agente de outro escritorio continua
       trocando de escritorio de verdade (como no seletor la em cima), porque
       cada um so existe, so atende WhatsApp e so usa a IA do seu escritorio. */
    async function alternarEscopo() {
      if (!verTodosOsEscritorios && !agentesDeTodos) {
        try {
          agentesDeTodos = await api.get('/api/agentes/todos-escritorios');
        } catch (erro) {
          aviso(erro.message, 'erro');
          return;
        }
      }
      verTodosOsEscritorios = !verTodosOsEscritorios;
      desenharPastas();
    }

    pastasDaLista.append(
      el('div', { class: 'agentes-pastas-topo' }, [
        el('label', { class: 'agentes-busca' }, [icone('lupa', 14), campoBusca]),
        el('span', {
          class: 'agentes-pastas-resumo',
          texto: verTodosOsEscritorios
            ? `${plural((agentesDeTodos || []).length, 'agente', 'agentes')} · ${plural(escritorios.length, 'escritório', 'escritórios')}`
            : `${plural(agentes.length, 'agente', 'agentes')} · ${plural(ligados, 'ligado', 'ligados')} · ${plural(quantasPastas, 'pasta', 'pastas')}`,
        }),
        !verTodosOsEscritorios && workspace
          ? el('span', { class: 'agentes-escritorio', title: 'O escritório aberto' }, [icone('predio', 14), workspace.nome])
          : null,
        escritorios.length > 1
          ? botao(verTodosOsEscritorios ? 'Este escritório' : 'Todos os escritórios', {
              pequeno: true,
              icone: verTodosOsEscritorios ? 'predio' : 'usuarios',
              aoClicar: alternarEscopo,
            })
          : null,
      ]),
    );

    /* No escritorio geral, enquanto houver agente de area aqui ou faltar o
       escritorio de uma area, o convite para separar. So faz sentido olhando
       um escritorio por vez. */
    const AREAS_COM_ESCRITORIO = ['previdenciario', 'trabalhista'];
    const falta =
      agentes.some((a) => AREAS_COM_ESCRITORIO.includes(a.area)) ||
      !AREAS_COM_ESCRITORIO.every((area) => escritorios.some((w) => w.area === area));
    if (!verTodosOsEscritorios && podeConfigurar() && workspace && !workspace.area && falta) {
      pastasDaLista.append(
        el('div', { class: 'agentes-separar' }, [
          icone('predio', 20),
          el('p', {}, [
            el('strong', { texto: 'Cada área no seu escritório. ' }),
            'Os agentes do Previdenciário ficam no escritório Previdenciário e os do Trabalhista no Trabalhista, cada um com o seu número e as suas conversas.',
          ]),
          botao('Separar por escritório', { pequeno: true, tipo: 'principal', icone: 'predio', aoClicar: abrirSeparacao }),
        ]),
      );
    }

    const corpo = el('div', { class: 'agentes-tabela' });
    pastasDaLista.append(corpo);

    function desenharCorpo() {
      limpar(corpo);
      if (verTodosOsEscritorios) {
        desenharCorpoDeTodos();
        return;
      }
      if (!agentes.length) {
        corpo.append(
          vazio(
            'Nenhum agente neste escritório',
            workspace?.area
              ? 'Instale os agentes da área em Agentes por área, lá em cima.'
              : 'Crie o primeiro em Novo agente, ou instale os de uma área em Agentes por área.',
            null,
            'agentes',
          ),
        );
        return;
      }

      const termo = busca.trim().toLowerCase();
      const acha = (texto) => !termo || String(texto || '').toLowerCase().includes(termo);

      const pastas = new Map();
      for (const agente of agentes) {
        const pasta = agente.pasta || PASTA_PADRAO;
        if (!pastas.has(pasta)) pastas.set(pasta, []);
        pastas.get(pasta).push(agente);
      }
      const nomes = [...pastas.keys()].sort((a, b) => {
        if (a === PASTA_PADRAO) return -1;
        if (b === PASTA_PADRAO) return 1;
        return a.localeCompare(b, 'pt-BR');
      });

      corpo.append(
        el('div', { class: 'agentes-tabela-cabeca', 'aria-hidden': 'true' }, [
          el('span', { texto: 'Pastas' }),
          el('span', { texto: 'Última edição' }),
          el('span'),
        ]),
      );

      let mostrou = 0;
      for (const pasta of nomes) {
        const daPasta = pastas.get(pasta);
        const pastaAcha = acha(pasta);
        /* Buscando, fica o squad em que o lider, um membro ou a pasta bate. */
        const squads = squadsDaPasta(daPasta).filter(
          ({ agente, membros }) => pastaAcha || acha(agente.nome) || membros.some((m) => acha(m.nome)),
        );
        if (!squads.length) continue;
        mostrou += 1;

        const aberta = Boolean(termo) || !pastasFechadas.has(pasta);
        corpo.append(
          el('div', { class: 'agentes-linha agentes-linha-pasta' }, [
            el(
              'button',
              {
                type: 'button',
                class: 'agentes-linha-principal',
                'aria-expanded': aberta ? 'true' : 'false',
                aoClick: () => {
                  if (pastasFechadas.has(pasta)) pastasFechadas.delete(pasta);
                  else pastasFechadas.add(pasta);
                  gravarPastasFechadas(pastasFechadas);
                  desenharCorpo();
                },
              },
              [
                el('span', { class: 'agentes-seta' }, [icone('voltar', 12)]),
                el('span', { class: 'agentes-pasta-icone' }, [icone('pasta', 16)]),
                el('strong', { class: 'agentes-linha-nome', texto: pasta }),
                el('span', {
                  class: 'agentes-linha-conta',
                  title: plural(daPasta.length, 'agente na pasta, contando os membros', 'agentes na pasta, contando os membros'),
                  texto: plural(squads.length, 'agente', 'agentes'),
                }),
              ],
            ),
            el('span', { class: 'agentes-linha-quando', texto: dataHora(editadoEm(daPasta)) || '-' }),
            botaoMais(
              podeConfigurar() ? [{ rotulo: 'Renomear pasta', icone: 'pasta', acao: () => renomearPasta(pasta, daPasta.length) }] : [],
            ),
          ]),
        );
        if (!aberta) continue;

        for (const { agente, membros } of squads) {
          const membroBate = Boolean(termo) && membros.some((m) => acha(m.nome));
          const aberto = membroBate || squadsAbertos.has(agente.id);
          corpo.append(
            linhaDoAgente(agente, {
              membros,
              aberto,
              aoAlternar: () => {
                if (squadsAbertos.has(agente.id)) squadsAbertos.delete(agente.id);
                else squadsAbertos.add(agente.id);
                desenharCorpo();
              },
            }),
          );
          if (aberto) for (const membro of membros) corpo.append(linhaDoAgente(membro, { membro: true }));
        }
      }

      if (!mostrou) corpo.append(el('p', { class: 'agentes-nada', texto: `Nenhum agente ou pasta com "${busca.trim()}".` }));
    }

    /* A aba "Todos os escritorios": so lista, agrupado por escritorio. Nao
       tem pasta, membro de squad nem acoes de editar - isso e sempre dentro
       do escritorio de cada um. */
    function desenharCorpoDeTodos() {
      const todos = agentesDeTodos || [];
      if (!todos.length) {
        corpo.append(vazio('Nenhum agente em nenhum escritório', 'Crie o primeiro em Novo agente.', null, 'agentes'));
        return;
      }

      const termo = busca.trim().toLowerCase();
      const acha = (texto) => !termo || String(texto || '').toLowerCase().includes(termo);

      const porEscritorio = new Map();
      for (const agente of todos) {
        if (!porEscritorio.has(agente.workspaceId)) porEscritorio.set(agente.workspaceId, []);
        porEscritorio.get(agente.workspaceId).push(agente);
      }

      corpo.append(
        el('div', { class: 'agentes-tabela-cabeca', 'aria-hidden': 'true' }, [
          el('span', { texto: 'Escritórios' }),
          el('span', { texto: 'Última edição' }),
          el('span'),
        ]),
      );

      let mostrou = 0;
      for (const [workspaceId, doEscritorio] of porEscritorio) {
        const nomeEscritorio = doEscritorio[0]?.workspaceNome || '';
        const escritorioAcha = acha(nomeEscritorio);
        const visiveis = doEscritorio.filter((a) => escritorioAcha || acha(a.nome) || acha(a.pasta));
        if (!visiveis.length) continue;
        mostrou += 1;

        const ligadosDoEscritorio = doEscritorio.filter((a) => a.ativo).length;
        corpo.append(
          el('div', { class: 'agentes-linha agentes-linha-pasta' }, [
            el('div', { class: 'agentes-linha-principal' }, [
              el('span', { class: 'agentes-seta vazia' }),
              el('span', { class: 'agentes-pasta-icone' }, [icone('predio', 16)]),
              el('strong', { class: 'agentes-linha-nome', texto: nomeEscritorio }),
              el('span', {
                class: 'agentes-linha-conta',
                texto: `${plural(doEscritorio.length, 'agente', 'agentes')} · ${plural(ligadosDoEscritorio, 'ligado', 'ligados')}`,
              }),
            ]),
            el('span'),
            el('span'),
          ]),
        );

        for (const agente of visiveis.sort((a, b) => a.nome.localeCompare(b.nome, 'pt-BR'))) {
          corpo.append(linhaDoAgenteCruzado(agente, workspaceId));
        }
      }

      if (!mostrou) corpo.append(el('p', { class: 'agentes-nada', texto: `Nenhum agente ou escritório com "${busca.trim()}".` }));
    }

    desenharCorpo();
  }

  /* A linha da aba "Todos os escritorios": abrir troca de escritorio de
     verdade primeiro (como no seletor la em cima), porque o agente so existe
     dentro do dele. */
  function linhaDoAgenteCruzado(agente, workspaceId) {
    const abrir = async (evento) => {
      evento.preventDefault();
      if (workspaceId !== estado.sessao?.workspace?.id) await api.post('/api/sessao/workspace', { workspaceId });
      location.hash = `#/agentes/${agente.id}`;
      location.reload();
    };
    return el('div', { class: `agentes-linha agentes-linha-agente${agente.ativo ? '' : ' desligado'}` }, [
      el('div', { class: 'agentes-linha-principal' }, [
        el('span', { class: 'agentes-seta vazia' }),
        el('a', { class: 'agentes-linha-link', href: `#/agentes/${agente.id}`, title: `Abrir ${agente.nome}`, aoClick: abrir }, [
          el('span', { class: 'agente-item-rosto' }, [
            avatar(agente, 30),
            el('span', { class: `agente-ponto ${agente.ativo ? 'ligado' : ''}`.trim(), title: agente.ativo ? 'Ligado' : 'Desligado' }),
          ]),
          el('span', { class: 'agentes-linha-nome', texto: agente.nome }),
          agente.pasta && agente.pasta !== PASTA_PADRAO ? selo(agente.pasta, 'info') : null,
        ]),
        agente.ativo ? null : el('span', { class: 'agentes-linha-desligado', texto: 'desligado' }),
      ]),
      el('span', { class: 'agentes-linha-quando', texto: dataHora(agente.atualizadoEm) || '-' }),
      el('span'),
    ]);
  }

  function linhaDoAgente(agente, { membros = [], aberto = false, aoAlternar = null, membro = false } = {}) {
    const invalidas = agente.mencoesInvalidas?.length || 0;
    const nomesDosMembros = membros.map((m) => m.nome);
    return el(
      'div',
      { class: `agentes-linha agentes-linha-agente${membro ? ' membro' : ''}${agente.ativo ? '' : ' desligado'}` },
      [
        el('div', { class: 'agentes-linha-principal' }, [
          membros.length
            ? el(
                'button',
                {
                  type: 'button',
                  class: 'agentes-seta',
                  'aria-expanded': aberto ? 'true' : 'false',
                  'aria-label': `${aberto ? 'Esconder' : 'Mostrar'} os membros de ${agente.nome}`,
                  aoClick: aoAlternar,
                },
                [icone('voltar', 12)],
              )
            : el('span', { class: 'agentes-seta vazia' }),
          el('a', { class: 'agentes-linha-link', href: `#/agentes/${agente.id}`, title: `Abrir ${agente.nome}` }, [
            el('span', { class: 'agente-item-rosto' }, [
              avatar(agente, 30),
              el('span', { class: `agente-ponto ${agente.ativo ? 'ligado' : ''}`.trim(), title: agente.ativo ? 'Ligado' : 'Desligado' }),
            ]),
            el('span', { class: 'agentes-linha-nome', texto: agente.nome }),
          ]),
          membros.length
            ? el(
                'button',
                {
                  type: 'button',
                  class: 'agentes-membros',
                  title: nomesDosMembros.join('\n'),
                  'aria-label': `${plural(membros.length, 'membro', 'membros')}: ${nomesDosMembros.join(', ')}`,
                  aoClick: aoAlternar,
                },
                [
                  ...membros.slice(0, 3).map((m) => avatar(m, 24)),
                  membros.length > 3 ? el('span', { class: 'agentes-membros-mais', texto: `+${membros.length - 3}` }) : null,
                ],
              )
            : null,
          agente.ativo ? null : el('span', { class: 'agentes-linha-desligado', texto: 'desligado' }),
          invalidas
            ? el('span', { class: 'agente-item-alerta' }, [icone('alerta', 12), plural(invalidas, 'menção inválida', 'menções inválidas')])
            : null,
        ]),
        el('span', { class: 'agentes-linha-quando', texto: dataHora(editadoEm([agente, ...membros])) || '-' }),
        botaoMais(acoesDoAgente(agente)),
      ],
    );
  }

  function acoesDoAgente(agente) {
    return [
      { rotulo: 'Abrir', icone: 'abrir', acao: () => (location.hash = `#/agentes/${agente.id}`) },
      agente.ativo
        ? {
            rotulo: 'Testar no chat',
            icone: 'simulador',
            acao: () => {
              try {
                localStorage.setItem('correiatendimentos:chat-teste-agente', agente.id);
              } catch {
                /* sem armazenamento, o chat abre no automatico */
              }
              location.hash = '#/simulador';
            },
          }
        : null,
      podeConfigurar()
        ? {
            rotulo: agente.ativo ? 'Desligar' : 'Ligar',
            icone: 'raio',
            acao: async () => {
              try {
                await api.patch(`/api/agentes/${agente.id}`, { ativo: !agente.ativo });
                aviso(`${agente.nome} ${agente.ativo ? 'desligado' : 'ligado'}.`, 'sucesso');
                await recarregarTudo();
              } catch (erro) {
                aviso(erro.message, 'erro');
              }
            },
          }
        : null,
      podeConfigurar()
        ? {
            rotulo: 'Excluir',
            icone: 'lixo',
            perigo: true,
            acao: () =>
              confirmar('Excluir agente?', `"${agente.nome}" será removido.`, async () => {
                await api.delete(`/api/agentes/${agente.id}`);
                await recarregarTudo();
              }, 'Excluir'),
          }
        : null,
    ].filter(Boolean);
  }

  /* O "..." de cada linha: um menu pequeno, que fecha com Esc ou clique fora. */
  function botaoMais(itens) {
    if (!itens.length) return el('span');
    const caixa = el('div', { class: 'agentes-mais' });
    const menu = el('div', { class: 'agentes-mais-menu', role: 'menu', hidden: true });
    const gatilho = el(
      'button',
      { type: 'button', class: 'agentes-mais-botao', 'aria-haspopup': 'menu', 'aria-expanded': 'false', 'aria-label': 'Mais ações', title: 'Mais ações' },
      [icone('opcoes', 16)],
    );
    const fora = (evento) => {
      if (!caixa.contains(evento.target)) fechar();
    };
    const teclas = (evento) => {
      if (evento.key !== 'Escape') return;
      fechar();
      gatilho.focus();
    };
    function fechar() {
      menu.hidden = true;
      gatilho.setAttribute('aria-expanded', 'false');
      document.removeEventListener('mousedown', fora);
      document.removeEventListener('keydown', teclas);
    }
    gatilho.addEventListener('click', () => {
      if (!menu.hidden) return fechar();
      menu.hidden = false;
      gatilho.setAttribute('aria-expanded', 'true');
      document.addEventListener('mousedown', fora);
      document.addEventListener('keydown', teclas);
      menu.querySelector('button')?.focus();
    });
    for (const item of itens) {
      menu.append(
        el(
          'button',
          {
            type: 'button',
            role: 'menuitem',
            class: `agentes-mais-item${item.perigo ? ' perigo' : ''}`,
            aoClick: () => {
              fechar();
              item.acao();
            },
          },
          [icone(item.icone, 14), el('span', { texto: item.rotulo })],
        ),
      );
    }
    caixa.append(gatilho, menu);
    return caixa;
  }

  /* Separar: o servidor cria os escritorios que faltam e leva cada area para o seu. */
  function abrirSeparacao() {
    const outros = agentes.filter((a) => !['previdenciario', 'trabalhista'].includes(a.area));
    let apagarOutros = false;
    const opcao = outros.length
      ? interruptor(
          `Apagar também os outros ${plural(outros.length, 'agente', 'agentes')} deste escritório`,
          false,
          (ligado) => {
            apagarOutros = ligado;
          },
          { ajuda: 'Saem com cópia guardada. As conversas e os números que estavam com eles ficam sem agente, esperando uma pessoa.' },
        )
      : null;

    modal({
      titulo: 'Separar os agentes por escritório',
      corpo: el('div', {}, [
        el('p', {
          class: 'cartao-ajuda',
          texto: 'Cada área passa a trabalhar no seu escritório, com número, conversas e agentes próprios. O escritório que ainda não existe é criado.',
        }),
        el('ul', { class: 'lista-simples sem-margem' }, [
          el('li', { class: 'linha-p' }, [
            icone('predio', 14),
            el('span', { class: 'flexivel', texto: 'Previdenciário' }),
            el('span', { class: 'dica sem-margem', texto: 'Eduarda e os squads de auxílio-acidente, BPC e maternidade' }),
          ]),
          el('li', { class: 'linha-p' }, [
            icone('predio', 14),
            el('span', { class: 'flexivel', texto: 'Trabalhista' }),
            el('span', { class: 'dica sem-margem', texto: 'AG01 e os membros AG02 a AG08' }),
          ]),
        ]),
        el('p', {
          class: 'dica',
          texto: 'Em cada escritório ficam só os agentes da área, ligados; o que houver de outro sai com cópia guardada. Deste escritório saem os agentes dessas duas áreas, e aqui fica o Agente 26 (triagem de quem já é cliente), desligado.',
        }),
        opcao,
      ]),
      confirmar: 'Separar',
      aoConfirmar: async () => {
        const resposta = await api.post('/api/agentes-por-escritorio', { apagarOutros });
        aviso(
          `${resposta.escritorios.map((e) => `${e.nome}: ${plural(e.agentes, 'agente', 'agentes')}`).join(' · ')}${
            resposta.removidosDaqui.length ? ` · ${plural(resposta.removidosDaqui.length, 'saiu daqui', 'saíram daqui')}` : ''
          }.`,
          'sucesso',
        );
        /* Depois que este modal fechar: os escritorios novos so entram no
           seletor de cima quando a sessao for lida de novo. */
        setTimeout(() => abrirEscritorios(resposta.escritorios), 0);
      },
    });
  }

  function abrirEscritorios(escritorios) {
    const entrar = async (workspaceId) => {
      await api.post('/api/sessao/workspace', { workspaceId });
      location.hash = '#/agentes';
      location.reload();
    };
    modal({
      titulo: 'Agentes separados',
      corpo: el('div', {}, [
        el('p', { class: 'cartao-ajuda', texto: 'Abra um escritório para ver os agentes dele. Dá para trocar a qualquer hora no seletor lá em cima.' }),
        el(
          'ul',
          { class: 'lista-simples sem-margem' },
          escritorios.map((e) =>
            el('li', { class: 'linha-p' }, [
              icone('predio', 14),
              el('span', { class: 'flexivel', texto: `${e.nome} · ${plural(e.agentes, 'agente', 'agentes')}` }),
              botao(`Abrir ${e.nome}`, { pequeno: true, aoClicar: () => entrar(e.workspaceId) }),
            ]),
          ),
        ),
      ]),
      confirmar: 'Ficar aqui',
      aoConfirmar: () => location.reload(),
    });
  }

  await recarregarTudo();
  return modoLista ? pastasDaLista : container;
}

/* ------------------------------------------------------------------ */

function abrirGeracao(recarregarTela) {
  const nome = entradaTexto('', { placeholder: 'Triagem Aposentadoria' });
  const objetivo = selecao(
    [
      { valor: 'fechar', rotulo: 'Fechar contrato' },
      { valor: 'agendar', rotulo: 'Agendar reunião' },
      { valor: 'qualificar', rotulo: 'Qualificar e transferir para humano' },
      { valor: 'recepcionar', rotulo: 'Triagem e roteamento' },
      { valor: 'atender', rotulo: 'Atender pós-venda' },
    ],
    'qualificar',
  );
  const descricao = areaTexto('', {
    class: 'alta',
    placeholder: 'Explique como o escritório atende esse caso: o que perguntar, em que ordem, o que desqualifica, como são os honorários.',
  });
  const referencia = areaTexto('', {
    placeholder: 'Opcional: cole uma conversa exemplar exportada do WhatsApp ou o script comercial.',
  });

  modal({
    titulo: 'Criar agente com IA',
    largo: true,
    corpo: el('div', {}, [
      el('div', { class: 'dica mb-3', texto: 'Precisa da chave da Anthropic em Integrações. O prompt sai na faixa recomendada de tamanho.' }),
      el('div', { class: 'grade g2' }, [campo('Nome', nome), campo('Objetivo', objetivo)]),
      campo('Como esse atendimento funciona', descricao),
      campo('Material de referência', referencia),
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
      aviso('Agente criado. Revise as instruções antes de colocar no ar.', 'sucesso');
      await recarregarTela();
    },
  });
}
