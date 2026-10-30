import { api, enviarArquivo } from '../api.js';
import { estado, podeConfigurar, recarregar } from '../estado.js';
import { dica, gaveta, previaDaMidia } from '../componentes.js';
import {
  areaTexto,
  aviso,
  botao,
  campo,
  confirmar,
  el,
  entradaTexto,
  interruptor,
  limpar,
  modal,
  selecao,
  selo,
  vazio,
} from '../ui.js';

const SITUACOES = {
  nao_solicitada: ['nao enviado a Meta', ''],
  em_analise: ['em analise na Meta', 'alerta'],
  aprovado: ['aprovado', 'sucesso'],
  reprovado: ['reprovado', 'erro'],
  pausado: ['pausado por qualidade', 'erro'],
  erro: ['erro ao enviar', 'erro'],
};

/**
 * Categorias da Meta. A mesma lista serve para o campo do formulario e para os
 * grupos da tela: escritas em dois lugares, uma categoria nova entraria no
 * formulario e depois cairia fora de qualquer grupo da lista.
 */
const CATEGORIAS = [
  {
    valor: 'servico',
    rotulo: 'Serviço',
    rotuloLongo: 'Servico (resposta dentro das 24h (sem custo))',
    ajuda: 'Resposta dentro da janela de 24 horas, sem custo de conversa.',
  },
  {
    valor: 'utilidade',
    rotulo: 'Utilidade',
    rotuloLongo: 'Utilidade (confirmacao, lembrete, atualizacao)',
    ajuda: 'Confirmação, lembrete e atualização de algo que o cliente ja esperava.',
  },
  {
    valor: 'marketing',
    rotulo: 'Marketing',
    rotuloLongo: 'Marketing (proposta, follow-up, campanha)',
    // Duas frases, no ritmo das outras duas categorias. A regra das 24 horas
    // esta inteira: e a unica que reabre a conversa, e so aprovada na Meta.
    ajuda:
      'Proposta, follow-up e campanha. Única categoria que reabre a conversa depois das 24 horas, e so com template aprovado na Meta.',
  },
];

/**
 * Templates: mensagem pronta com texto e midia. Sao o conteudo dos follow-ups,
 * do video de proposta e do tutorial de assinatura, e, na conexao oficial, a
 * unica forma de escrever depois das 24 horas.
 *
 * A tela e uma lista agrupada pela categoria da Meta, e nao uma grade de
 * cartoes: o cartao trazia o texto inteiro de cada template, entao com duas
 * dezenas deles a pagina virava uma parede e achar "aquele do agendamento"
 * dependia de rolar tudo. Na lista cabe muito mais por tela, a busca corta pelo
 * nome ou pelo atalho, e o grupo ja responde a pergunta que vem antes de mexer
 * no texto: este template esta na categoria certa para o uso que eu quero?
 */
export async function paginaTemplates() {
  const container = el('div');
  const filtro = { busca: '' };
  let templates = [];

  const areaLista = el('div');

  function pintar() {
    limpar(areaLista);

    if (!templates.length) {
      areaLista.append(
        vazio(
          'Nenhum template',
          'Crie o primeiro para usar em follow-up e no atendimento.',
          podeConfigurar()
            ? botao('Novo template', { tipo: 'principal', icone: 'mais', aoClicar: () => editar(null, desenhar) })
            : null,
        ),
      );
      return;
    }

    const achados = filtrar(templates, filtro.busca);
    if (!achados.length) {
      areaLista.append(vazio('Nenhum template nesta busca', 'Nada com esse texto no nome nem no atalho.'));
      return;
    }

    areaLista.append(
      // O respiro ate o primeiro grupo ja vem do titulo da secao. Somado a
      // margem propria do paragrafo, sobrava um vao maior que o de dentro da
      // lista e a contagem parecia solta da tela.
      //
      // A dica ao lado da contagem e o unico lugar desta tela onde o atalho "/"
      // aparece. Fora daqui ele so existe no placeholder do chat e na ajuda do
      // campo Atalho, que so abre dentro da gaveta de edicao.
      el('p', { class: 'cartao-ajuda sem-margem linha' }, [
        document.createTextNode(
          achados.length === templates.length
            ? contagem(templates.length)
            : `${achados.length} de ${contagem(templates.length)}`,
        ),
        dica('No chat, digite / para achar o template pelo atalho. Dentro do texto valem {{nome}} e as demais variaveis da conversa.', {
          assunto: 'como usar os templates',
        }),
      ]),
    );
    for (const [categoria, itens] of agrupar(achados)) areaLista.append(grupo(categoria, itens, desenhar));
  }

  const areaBoasVindas = el('div');

  async function desenhar() {
    templates = await recarregar('templates');
    pintar();
    await pintarBoasVindas(areaBoasVindas, () => templates, desenhar);
  }

  // A barra de cima e montada uma vez so. Se ela fosse redesenhada junto com a
  // lista, o campo de busca perderia o foco a cada tecla digitada.
  container.append(barraDeTopo(filtro, pintar, desenhar), areaBoasVindas, areaLista);
  await desenhar();
  return container;
}

/* ------------------------------------------------------------------ */
/* Video de boas-vindas automatico                                     */
/* ------------------------------------------------------------------ */

/**
 * A chave do video de boas-vindas (servidor/nucleo/boas-vindas-automaticas.js).
 *
 * O template de boas-vindas so chegava ao lead se o modelo decidisse chama-lo, e
 * a Eduarda, que recebe a maior parte dos leads, nunca o chamava. Ligada, o
 * sistema manda o template escolhido uma vez por conversa, antes da primeira
 * resposta da IA. Desligada por padrao: quem nao liga continua como antes.
 *
 * So aparece como ligavel se algum template tem video. O servidor recusa ligar
 * sem video, mas a tela avisa antes: uma chave que "liga" e nao envia nada
 * parece funcionar e e o pior resultado possivel.
 */
async function pintarBoasVindas(area, templatesAtuais, recarregarTela) {
  limpar(area);
  let situacao;
  try {
    situacao = await api.get('/api/boas-vindas');
  } catch {
    return; // sem a chave a tela de templates continua inteira
  }

  const comVideo = templatesAtuais().filter((template) => template.midia && template.midia.tipo === 'video');
  const escolhido = situacao.template?.id || '';
  const opcoes = comVideo.length
    ? comVideo.map((template) => ({ valor: template.id, rotulo: `${template.nome}${template.atalho ? ` (/${template.atalho})` : ''}` }))
    : [{ valor: '', rotulo: 'Nenhum template tem vídeo ainda' }];
  const seletor = selecao(opcoes, comVideo.some((template) => template.id === escolhido) ? escolhido : opcoes[0].valor);
  seletor.disabled = !podeConfigurar() || !comVideo.length;

  async function gravar(mudancas, mensagem) {
    try {
      await api.put('/api/boas-vindas', mudancas);
      if (mensagem) aviso(mensagem, 'sucesso');
    } catch (erro) {
      aviso(erro.message, 'erro');
    }
    await pintarBoasVindas(area, templatesAtuais, recarregarTela);
  }

  seletor.addEventListener('change', () => gravar({ templateId: seletor.value || null }, 'Template de boas-vindas trocado.'));

  /* O template que o botão "Editar" abre: o escolhido na lista, ou o do escritório. */
  const alvoDaEdicao = () => {
    const id = comVideo.length ? seletor.value : situacao.template?.id;
    return templatesAtuais().find((template) => template.id === id) || null;
  };

  const chave = interruptor(
    'Enviar o vídeo de boas-vindas a todo lead novo',
    situacao.automatica,
    (ligado) => gravar({ automatica: ligado, templateId: seletor.value || undefined }, ligado ? 'Boas-vindas automáticas ligadas.' : 'Boas-vindas automáticas desligadas.'),
    { desabilitado: !podeConfigurar() || (!comVideo.length && !situacao.automatica) },
  );

  area.append(
    el('div', { class: 'cartao mb-3' }, [
      chave,
      el('p', {
        class: 'cartao-ajuda',
        texto:
          'Ligado, o sistema manda este template (texto e vídeo) uma vez, antes da primeira resposta da IA. Vale só para conversas que começarem depois de ligar, e nunca repete para o mesmo cliente.',
      }),
      comVideo.length
        ? campo('Template enviado', seletor)
        : el('div', {
            class: 'alerta-caixa',
            texto: 'Nenhum template tem vídeo ainda. Anexe o vídeo ao template de boas-vindas, clique em Salvar e volte aqui.',
          }),
      /* Sem este botão, quem queria anexar o vídeo tinha de achar o template na
         lista logo abaixo. Edita o escolhido; se ainda não há nenhum com vídeo,
         o @bemvindo do escritório; se nem ele existe, abre um template novo. */
      podeConfigurar()
        ? el('div', { class: 'linha-botoes mt-2' }, [
            botao(alvoDaEdicao() ? 'Editar este template' : 'Criar o template de boas-vindas', {
              pequeno: true,
              aoClicar: () => editar(alvoDaEdicao(), recarregarTela),
            }),
          ])
        : null,
      situacao.enviados || situacao.falhas
        ? el('div', { class: 'linha quebra mt-2' }, [
            selo(`enviado ${situacao.enviados}×`, situacao.enviados ? 'sucesso' : ''),
            situacao.falhas ? selo(`${situacao.falhas} ${situacao.falhas === 1 ? 'falha' : 'falhas'}`, 'erro') : null,
            situacao.ultimaFalha ? el('span', { class: 't-sm c-erro', texto: `Última falha: ${situacao.ultimaFalha}` }) : null,
          ])
        : null,
    ]),
  );
}

/* ------------------------------------------------------------------ */
/* Topo                                                                */
/* ------------------------------------------------------------------ */

function barraDeTopo(filtro, pintar, recarregarTela) {
  const busca = entradaTexto(filtro.busca, { type: 'search', placeholder: 'Nome ou atalho do template' });

  busca.addEventListener('input', () => {
    // A lista inteira ja esta na memoria, entao o filtro roda aqui mesmo, a
    // cada tecla, sem consulta ao servidor e sem espera de digitacao.
    filtro.busca = busca.value.trim();
    pintar();
  });

  // Mesma barra de filtros de Tarefas: a largura do campo e o respiro ate a
  // lista saem de .barra-filtros, e nao de um valor escolhido nesta tela.
  const campoBusca = campo('Busca', busca);
  campoBusca.classList.add('campo-largo');

  return el(
    'div',
    { class: 'cartao barra-filtros' },
    [
      campoBusca,
      podeConfigurar()
        ? botao('Novo template', { tipo: 'principal', icone: 'mais', aoClicar: () => editar(null, recarregarTela) })
        : null,
    ],
  );
}

/* ------------------------------------------------------------------ */
/* Lista                                                               */
/* ------------------------------------------------------------------ */

/**
 * Busca por nome ou atalho. A barra da frente e descartada porque quem procura
 * pelo atalho digita ele do jeito que usa no chat, com a barra junto.
 */
function filtrar(templates, busca) {
  const termo = String(busca || '').trim().toLowerCase().replace(/^\//, '');
  if (!termo) return templates;
  return templates.filter(
    (template) =>
      String(template.nome || '').toLowerCase().includes(termo) ||
      String(template.atalho || '').toLowerCase().includes(termo),
  );
}

/**
 * Junta os templates por categoria, na ordem do formulario. Categoria que a
 * Meta passe a aceitar e que ainda nao esteja na lista acima vira um grupo
 * proprio no fim, com o nome que veio do servidor: melhor um grupo com nome
 * estranho do que um template sumido da tela.
 */
function agrupar(templates) {
  const conhecidas = new Map(CATEGORIAS.map((categoria) => [categoria.valor, []]));
  const outras = new Map();

  for (const template of templates) {
    const chave = template.categoriaMeta || 'utilidade';
    if (conhecidas.has(chave)) conhecidas.get(chave).push(template);
    else {
      if (!outras.has(chave)) outras.set(chave, []);
      outras.get(chave).push(template);
    }
  }

  const grupos = [];
  for (const categoria of CATEGORIAS) {
    const itens = conhecidas.get(categoria.valor);
    if (itens.length) grupos.push([categoria, itens]);
  }
  for (const [chave, itens] of outras) grupos.push([{ valor: chave, rotulo: chave, ajuda: '' }, itens]);
  return grupos;
}

function contagem(quantos) {
  return quantos === 1 ? '1 template' : `${quantos} templates`;
}

function grupo(categoria, itens, recarregarTela) {
  // .lista-contida: a coluna da grade não passa da largura da tela. Sem ela, a
  // descrição (que não quebra linha) alargava a coluna até 1450 px e os botões
  // Editar, Aprovar na Meta e Excluir ficavam além da borda direita, escondidos
  // atrás de uma barra de rolagem horizontal (visto no sistema no ar, 30/10/2026).
  const lista = el('div', { class: 'lista-simples lista-contida' });
  for (const template of itens) lista.append(linhaDoTemplate(template, recarregarTela));

  // O que a categoria significa e conceito da Meta, nao dado do escritorio:
  // fica na dica do titulo do grupo, e a lista comeca na linha seguinte.
  return el('section', { class: 'secao-painel' }, [
    el('h2', {}, [
      document.createTextNode(categoria.rotulo),
      selo(contagem(itens.length), ''),
      categoria.ajuda ? dica(categoria.ajuda, { assunto: `a categoria ${categoria.rotulo}` }) : null,
    ]),
    lista,
  ]);
}

/** Conteudo numa linha so, para a lista dizer do que o template trata. */
function resumo(conteudo) {
  const texto = String(conteudo || '').replace(/\s+/g, ' ').trim();
  return texto.length > 180 ? `${texto.slice(0, 180)}…` : texto;
}

function linhaDoTemplate(template, recarregarTela) {
  const [rotuloSituacao, tipoSelo] = SITUACOES[template.aprovacaoMeta?.situacao || 'nao_solicitada'];

  const acoes = el('div', { class: 'linha-botoes acoes' }, [
    podeConfigurar() ? botao('Editar', { pequeno: true, aoClicar: () => editar(template, recarregarTela) }) : null,
    podeConfigurar()
      ? botao('Aprovar na Meta', { pequeno: true, aoClicar: () => aprovarNaMeta(template, recarregarTela) })
      : null,
    template.metaNome
      ? botao('Revalidar', {
          pequeno: true,
          aoClicar: async () => {
            const resultado = await api.post(`/api/templates/${template.id}/revalidar`);
            aviso(resultado.ok ? `Situacao na Meta: ${resultado.situacao}` : resultado.erro, resultado.ok ? 'sucesso' : 'erro');
            await recarregarTela();
          },
        })
      : null,
    podeConfigurar()
      ? botao('Excluir', {
          pequeno: true,
          tipo: 'perigo',
          aoClicar: () =>
            confirmar('Excluir template?', `"${template.nome}" some dos follow-ups que o usam.`, async () => {
              await api.delete(`/api/templates/${template.id}`);
              await recarregarTela();
            }, 'Excluir'),
        })
      : null,
  ]);

  return el('div', { class: 'lista-item' }, [
    el('div', { class: 'corpo' }, [
      el('div', { class: 'titulo linha quebra' }, [
        document.createTextNode(template.nome),
        template.atalho ? el('span', { class: 'selo ouro', texto: `/${template.atalho}` }) : null,
        selo(rotuloSituacao, tipoSelo),
        template.midia ? selo(template.midia.tipo, 'info') : null,
        // Quantas vezes saiu e quantas falhou (servidor/nucleo/uso-dos-templates.js):
        // e como se ve, sem abrir conversa por conversa, se o video chegou aos leads.
        template.uso?.enviados ? selo(`enviado ${template.uso.enviados}×`, '') : null,
        template.uso?.falhas ? selo(`${template.uso.falhas} ${template.uso.falhas === 1 ? 'falha' : 'falhas'}`, 'erro') : null,
      ]),
      // O texto inteiro fica no editor. Aqui vai so o comeco, numa linha, que e
      // o bastante para reconhecer o template e cabe muito mais por tela.
      el('div', { class: 'desc cortar', texto: resumo(template.conteudo) }),
      template.uso?.falhas ? el('div', { class: 'desc cortar c-erro', texto: `Última falha: ${template.uso.ultimaFalha || 'sem detalhe'}` }) : null,
    ]),
    acoes,
  ]);
}

/* ------------------------------------------------------------------ */
/* Formulario                                                          */
/* ------------------------------------------------------------------ */

/**
 * Editor em gaveta. Sao cinco campos e um deles e o conteudo, que precisa de
 * altura: na janela centralizada o texto virava uma fresta de tres linhas com
 * o anexo e o rodape de acao disputando o resto.
 */
function editar(template, recarregarTela) {
  const nome = entradaTexto(template?.nome || '');
  const atalho = entradaTexto(template?.atalho || '', { placeholder: 'videoproposta' });
  const conteudo = areaTexto(template?.conteudo || '', { class: 'alta' });
  const categoria = selecao(
    CATEGORIAS.map((item) => ({ valor: item.valor, rotulo: item.rotuloLongo })),
    template?.categoriaMeta || 'utilidade',
  );

  /*
   * O video de boas-vindas nao ficava no template (achado em 30/10/2026). A
   * tela deixava tres buracos: o Salvar nao esperava o arquivo terminar de
   * subir (um video de 10 a 16 MB leva de 10 a 60 segundos, e o template era
   * salvo sem ele); o aviso "Arquivo anexado" parecia dizer que ja estava
   * guardado, quando so fica guardado depois do Salvar; e clicar fora da gaveta
   * descartava tudo sem perguntar.
   *
   * Agora: enquanto o arquivo sobe, a tela diz isso e o Salvar fica travado;
   * depois de subir, um aviso fixo diz que FALTA salvar; e fechar com o arquivo
   * ou o texto sem salvar pergunta antes.
   */
  const midiaInicial = template?.midia || null;
  let midia = midiaInicial;
  let envio = null; // { nome, tamanho, desde, relogio } enquanto um arquivo sobe
  let subindo = null; // a promessa desse envio
  let janela = null;
  /* O que ja esta guardado no servidor: a base para saber se ha algo a perder. */
  let guardado = {
    nome: template?.nome || '',
    atalho: template?.atalho || '',
    conteudo: template?.conteudo || '',
    categoria: template?.categoriaMeta || 'utilidade',
    midia: midiaInicial?.url || null,
  };
  const midiaAtual = el('div', { class: 'mt-2' });

  const megas = (bytes) => (bytes / 1024 / 1024).toFixed(1).replace('.', ',');
  const midiaMudou = () => (midia?.url || null) !== guardado.midia;

  const travarSalvar = (travado) => {
    const botaoSalvar = janela?.botaoConfirmar;
    if (!botaoSalvar) return;
    botaoSalvar.disabled = travado;
    botaoSalvar.title = travado ? 'Espere o arquivo terminar de enviar.' : '';
  };

  const mostrarMidia = () => {
    limpar(midiaAtual);
    if (envio) {
      const segundos = Math.round((Date.now() - envio.desde) / 1000);
      midiaAtual.append(
        el('div', {
          class: 'dica',
          role: 'status',
          texto: `Enviando ${envio.nome} (${megas(envio.tamanho)} MB)… ${segundos} s. O Salvar libera quando terminar.`,
        }),
      );
      return;
    }
    if (!midia) {
      midiaAtual.append(el('div', { class: 't-sm c-fraco', texto: 'Nenhuma mídia anexada.' }));
      return;
    }
    midiaAtual.append(
      el('div', { class: 'lista-item' }, [
        el('div', { class: 'corpo' }, [
          el('div', { class: 'titulo', texto: midia.nome || midia.url }),
          el('div', { class: 'desc', texto: `${midia.tipo}${midia.tamanho ? ` · ${megas(midia.tamanho)} MB` : ''}` }),
        ]),
        botao('Remover', {
          pequeno: true,
          tipo: 'perigo',
          aoClicar: () => {
            midia = null;
            mostrarMidia();
          },
        }),
      ]),
      midiaMudou()
        ? el('div', {
            class: 'alerta-caixa mt-2',
            role: 'status',
            texto: midia
              ? 'Anexado, mas ainda não salvo. Clique em Salvar para guardar no template.'
              : 'A mídia será removida quando você clicar em Salvar.',
          })
        : null,
      // A gaveta e mais estreita que o modal: a previa entra na versao compacta
      // para o video nao encostar nas duas bordas.
      previaDaMidia(midia, { compacta: true }),
    );
  };

  const seletor = el('input', { type: 'file', accept: 'image/*,video/mp4,video/webm,audio/*,application/pdf' });
  seletor.addEventListener('change', async () => {
    const arquivo = seletor.files[0];
    if (!arquivo) return;
    seletor.value = '';
    envio = { nome: arquivo.name, tamanho: arquivo.size, desde: Date.now(), relogio: null };
    envio.relogio = setInterval(mostrarMidia, 1000);
    travarSalvar(true);
    mostrarMidia();
    subindo = enviarArquivo(arquivo);
    try {
      midia = await subindo;
      aviso('Arquivo enviado. Falta clicar em Salvar para guardar no template.', 'sucesso');
    } catch (erro) {
      aviso(erro.message, 'erro');
    } finally {
      clearInterval(envio.relogio);
      envio = null;
      subindo = null;
      travarSalvar(false);
      mostrarMidia();
    }
  });

  const urlMidia = entradaTexto('', { placeholder: 'ou cole um link: https://…/vídeo-proposta.mp4' });
  urlMidia.addEventListener('change', () => {
    if (!urlMidia.value.trim()) return;
    const extensao = urlMidia.value.split('.').pop().toLowerCase();
    const tipo = ['mp4', 'webm'].includes(extensao)
      ? 'video'
      : ['jpg', 'jpeg', 'png', 'webp', 'gif'].includes(extensao)
        ? 'imagem'
        : ['mp3', 'ogg', 'wav'].includes(extensao)
          ? 'audio'
          : 'documento';
    midia = { tipo, url: urlMidia.value.trim(), nome: urlMidia.value.split('/').pop() };
    mostrarMidia();
  });

  mostrarMidia();

  const variaveis = el('div', { class: 'linha-botoes' });
  for (const chave of ['nome', ...estado.variaveis.map((v) => v.chave)]) {
    variaveis.append(
      el('button', {
        class: 'mencao-chip',
        texto: `{{${chave}}}`,
        aoClick: () => {
          const posicao = conteudo.selectionStart || conteudo.value.length;
          conteudo.value = `${conteudo.value.slice(0, posicao)}{{${chave}}}${conteudo.value.slice(posicao)}`;
          conteudo.focus();
        },
      }),
    );
  }

  /* O que se perde se a gaveta fechar agora; nada, quando esta tudo guardado. */
  const oQueSePerde = () => {
    if (envio) return 'O arquivo ainda está sendo enviado. Se fechar agora, ele se perde.';
    if (midiaMudou()) return 'A mídia ainda não foi salva no template. Se fechar agora, a alteração se perde.';
    const mexeu =
      nome.value !== guardado.nome ||
      atalho.value !== guardado.atalho ||
      conteudo.value !== guardado.conteudo ||
      categoria.value !== guardado.categoria;
    return mexeu ? 'Há alterações que ainda não foram salvas. Se fechar agora, elas se perdem.' : null;
  };

  const TIPOS_DA_MIDIA = { video: 'vídeo', imagem: 'imagem', audio: 'áudio', documento: 'documento' };

  /* Depois do primeiro Salvar de um template novo ele ja existe: um segundo
     clique (se o aviso de erro mandou tentar de novo) edita, nao duplica. */
  let existente = template;

  janela = gaveta({
    titulo: template ? `Editar ${template.nome}` : 'Novo template',
    corpo: [
      campo('Nome', nome),
      campo('Atalho', atalho, 'É o que você digita depois da barra no chat.'),
      campo('Conteúdo', conteudo),
      el('div', { class: 'campo' }, [el('span', { texto: 'Variáveis disponíveis' }), variaveis]),
      el('div', { class: 'campo' }, [
        el('span', { texto: 'Mídia' }),
        seletor,
        el('small', { class: 'ajuda-campo', texto: 'Vídeo em MP4, até 16 MB. O arquivo só fica no template depois de clicar em Salvar.' }),
        urlMidia,
        midiaAtual,
      ]),
      campo('Categoria na Meta', categoria),
    ],
    confirmar: 'Salvar',
    descartar: oQueSePerde,
    aoFechar: () => {
      if (envio) clearInterval(envio.relogio);
    },
    aoConfirmar: async () => {
      if (!nome.value.trim()) throw new Error('Dê um nome ao template.');
      if (!conteudo.value.trim()) throw new Error('Escreva o conteúdo.');
      /* O botão fica travado durante o envio; isto cobre o clique que chegou
         antes de a trava entrar. Sem esperar, o template saía sem o vídeo. */
      if (subindo) await subindo.catch(() => {});

      const dados = {
        nome: nome.value.trim(),
        atalho: atalho.value.trim() || undefined,
        conteudo: conteudo.value,
        categoriaMeta: categoria.value,
      };
      /* A mídia só vai quando mudou: um template salvo sem mexer nela não
         pode apagar um arquivo que o servidor colocou enquanto a tela estava
         aberta (templatesDoPacoteGanhamOArquivo, a cada varredura). */
      if (!existente || midiaMudou()) dados.midia = midia;

      const salvo = existente ? await api.patch(`/api/templates/${existente.id}`, dados) : await api.post('/api/templates', dados);
      existente = salvo || existente;
      guardado = {
        nome: nome.value,
        atalho: atalho.value,
        conteudo: conteudo.value,
        categoria: categoria.value,
        midia: salvo?.midia?.url || null,
      };

      /* O aviso diz o que o servidor guardou, e não o que a tela achava que
         tinha mandado. */
      if (midia && salvo?.midia?.url !== midia.url) {
        throw new Error('O template foi salvo, mas o servidor não guardou o arquivo. Anexe de novo e salve.');
      }
      aviso(`Template salvo${salvo?.midia ? ` com ${TIPOS_DA_MIDIA[salvo.midia.tipo] || 'arquivo'}` : ''}.`, 'sucesso');
      await recarregarTela();
    },
  });
}

/**
 * O editor de template aberto de FORA desta tela: o seletor da conversa, o
 * follow-up e a mensagem depois da assinatura mostram o template pelo nome, e
 * ate aqui, para corrigir um texto ou trocar o video, a pessoa tinha de sair
 * dali, achar o template na lista e voltar (30/10/2026).
 *
 * Abre a mesma gaveta de sempre. `aoSalvar` roda depois de salvar, com a lista
 * de templates ja recarregada em `estado.templates`.
 */
export function editarTemplate(template, aoSalvar) {
  editar(template, async () => {
    await recarregar('templates');
    await aoSalvar?.();
  });
}

/**
 * Refaz as opcoes de um seletor de templates depois de uma edicao (o nome pode
 * ter mudado), sem mexer no que estava escolhido. `vazio` e o texto da opcao em
 * branco, quando o seletor tem uma ("Nao enviar").
 */
export function atualizarOpcoesDeTemplate(seletor, vazio = null) {
  const escolhido = seletor.value;
  limpar(seletor);
  if (vazio !== null) seletor.append(el('option', { value: '', texto: vazio }));
  for (const template of estado.templates) seletor.append(el('option', { value: template.id, texto: template.nome }));
  seletor.value = escolhido;
}

/**
 * O botao "Editar template" que fica ao lado de um seletor de templates. Fica
 * desligado enquanto o seletor estiver em branco, e nem aparece para quem nao
 * pode configurar (a gaveta e a mesma da tela de Templates, que exige isso).
 */
export function botaoEditarTemplate({ seletor, vazio = null, aoSalvar = null }) {
  if (!podeConfigurar()) return null;
  const botaoEditar = botao('Editar template', {
    pequeno: true,
    aoClicar: () => {
      const template = estado.templates.find((item) => item.id === seletor.value);
      if (!template) return;
      editarTemplate(template, async () => {
        atualizarOpcoesDeTemplate(seletor, vazio);
        await aoSalvar?.();
      });
    },
  });
  const sincronizar = () => {
    botaoEditar.disabled = !seletor.value;
  };
  seletor.addEventListener('change', sincronizar);
  sincronizar();
  return botaoEditar;
}

/**
 * Aprovacao na Meta: escolha curta, dois controles e um clique, entao continua
 * em modal. Nao e formulario que a pessoa preenche aos poucos.
 */
function aprovarNaMeta(template, recarregarTela) {
  const oficiais = estado.conexoes.filter((c) => c.tipo === 'oficial');
  const escolhidas = new Set(oficiais.map((c) => c.id));
  const lista = el('div', { class: 'linha-botoes' });
  for (const conexao of oficiais) {
    const b = el('button', { class: 'selo ouro selo-clicavel', texto: conexao.nome });
    b.addEventListener('click', () => {
      if (escolhidas.has(conexao.id)) escolhidas.delete(conexao.id);
      else escolhidas.add(conexao.id);
      b.classList.toggle('ouro', escolhidas.has(conexao.id));
    });
    lista.append(b);
  }

  const categoria = selecao(
    [
      { valor: 'utilidade', rotulo: 'Utilidade' },
      { valor: 'marketing', rotulo: 'Marketing (obrigatório para follow-up)' },
      { valor: 'servico', rotulo: 'Serviço' },
    ],
    template.categoriaMeta || 'utilidade',
  );

  modal({
    titulo: `Aprovar "${template.nome}" na Meta`,
    corpo: el('div', {}, [
      // Fica so o que muda a expectativa de quem acabou de clicar. Como
      // escrever um template que a Meta aprova e conselho de redacao, e vale
      // uma vez: mora na dica.
      oficiais.length
        ? el('div', { class: 'dica mb-3 linha' }, [
            el('span', { class: 'flexivel', texto: 'A análise costuma levar de 24 a 48 horas.' }),
            dica('Template com contexto claro e proposito explicito e aprovado com mais facilidade. Sem contexto, a Meta le como spam.', {
              assunto: 'a análise da Meta',
            }),
          ])
        : el('div', { class: 'alerta-caixa', texto: 'Nenhuma conexão oficial cadastrada. No simulador e na API não oficial não existe aprovação de template.' }),
      campo('Categoria', categoria),
      oficiais.length ? el('div', { class: 'campo' }, [el('span', { texto: 'Enviar para quais números' }), lista]) : null,
    ]),
    confirmar: oficiais.length ? 'Solicitar aprovacao' : null,
    aoConfirmar: async () => {
      const resultado = await api.post(`/api/templates/${template.id}/aprovacao-meta`, {
        conexaoIds: [...escolhidas],
        categoria: categoria.value,
      });
      aviso(resultado.ok ? 'Solicitacao enviada. Acompanhe a situacao aqui.' : resultado.erro, resultado.ok ? 'sucesso' : 'erro');
      await recarregarTela();
    },
  });
}
