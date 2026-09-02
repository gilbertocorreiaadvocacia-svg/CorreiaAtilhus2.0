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
    rotulo: 'Servico',
    rotuloLongo: 'Servico (resposta dentro das 24h (sem custo))',
    ajuda: 'Resposta dentro da janela de 24 horas, sem custo de conversa.',
  },
  {
    valor: 'utilidade',
    rotulo: 'Utilidade',
    rotuloLongo: 'Utilidade (confirmacao, lembrete, atualizacao)',
    ajuda: 'Confirmacao, lembrete e atualizacao de algo que o cliente ja esperava.',
  },
  {
    valor: 'marketing',
    rotulo: 'Marketing',
    rotuloLongo: 'Marketing (proposta, follow-up, campanha)',
    // Duas frases, no ritmo das outras duas categorias. A regra das 24 horas
    // esta inteira: e a unica que reabre a conversa, e so aprovada na Meta.
    ajuda:
      'Proposta, follow-up e campanha. Unica categoria que reabre a conversa depois das 24 horas, e so com template aprovado na Meta.',
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

  async function desenhar() {
    templates = await recarregar('templates');
    pintar();
  }

  // A barra de cima e montada uma vez so. Se ela fosse redesenhada junto com a
  // lista, o campo de busca perderia o foco a cada tecla digitada.
  container.append(barraDeTopo(filtro, pintar, desenhar), areaLista);
  await desenhar();
  return container;
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
  const lista = el('div', { class: 'lista-simples' });
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
      ]),
      // O texto inteiro fica no editor. Aqui vai so o comeco, numa linha, que e
      // o bastante para reconhecer o template e cabe muito mais por tela.
      el('div', { class: 'desc cortar', texto: resumo(template.conteudo) }),
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

  let midia = template?.midia || null;
  const midiaAtual = el('div', { class: 'mt-2' });

  const mostrarMidia = () => {
    limpar(midiaAtual);
    if (!midia) {
      midiaAtual.append(el('div', { class: 't-sm c-fraco', texto: 'Nenhuma midia anexada.' }));
      return;
    }
    midiaAtual.append(
      el('div', { class: 'lista-item' }, [
        el('div', { class: 'corpo' }, [
          el('div', { class: 'titulo', texto: midia.nome || midia.url }),
          el('div', { class: 'desc', texto: `${midia.tipo}${midia.tamanho ? ` · ${(midia.tamanho / 1024 / 1024).toFixed(1)} MB` : ''}` }),
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
      // A gaveta e mais estreita que o modal: a previa entra na versao compacta
      // para o video nao encostar nas duas bordas.
      previaDaMidia(midia, { compacta: true }),
    );
  };

  const seletor = el('input', { type: 'file', accept: 'image/*,video/mp4,video/webm,audio/*,application/pdf' });
  seletor.addEventListener('change', async () => {
    const arquivo = seletor.files[0];
    if (!arquivo) return;
    try {
      midia = await enviarArquivo(arquivo);
      mostrarMidia();
      aviso('Arquivo anexado.', 'sucesso');
    } catch (erro) {
      aviso(erro.message, 'erro');
    }
    seletor.value = '';
  });

  const urlMidia = entradaTexto('', { placeholder: 'ou cole um link: https://…/video-proposta.mp4' });
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

  gaveta({
    titulo: template ? `Editar ${template.nome}` : 'Novo template',
    corpo: [
      campo('Nome', nome),
      campo('Atalho', atalho, 'E o que voce digita depois da barra no chat.'),
      campo('Conteudo', conteudo),
      el('div', { class: 'campo' }, [el('span', { texto: 'Variaveis disponiveis' }), variaveis]),
      el('div', { class: 'campo' }, [
        el('span', { texto: 'Midia' }),
        seletor,
        el('small', { class: 'ajuda-campo', texto: 'Ate 16 MB.' }),
        urlMidia,
        midiaAtual,
      ]),
      campo('Categoria na Meta', categoria),
    ],
    confirmar: 'Salvar',
    aoConfirmar: async () => {
      if (!nome.value.trim()) throw new Error('De um nome ao template.');
      if (!conteudo.value.trim()) throw new Error('Escreva o conteudo.');
      const dados = {
        nome: nome.value.trim(),
        atalho: atalho.value.trim() || undefined,
        conteudo: conteudo.value,
        categoriaMeta: categoria.value,
        midia,
      };
      if (template) await api.patch(`/api/templates/${template.id}`, dados);
      else await api.post('/api/templates', dados);
      aviso('Template salvo.', 'sucesso');
      await recarregarTela();
    },
  });
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
      { valor: 'marketing', rotulo: 'Marketing (obrigatorio para follow-up)' },
      { valor: 'servico', rotulo: 'Servico' },
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
            el('span', { class: 'flexivel', texto: 'A analise costuma levar de 24 a 48 horas.' }),
            dica('Template com contexto claro e proposito explicito e aprovado com mais facilidade. Sem contexto, a Meta le como spam.', {
              assunto: 'a analise da Meta',
            }),
          ])
        : el('div', { class: 'alerta-caixa', texto: 'Nenhuma conexao oficial cadastrada. No simulador e na API nao oficial nao existe aprovacao de template.' }),
      campo('Categoria', categoria),
      oficiais.length ? el('div', { class: 'campo' }, [el('span', { texto: 'Enviar para quais numeros' }), lista]) : null,
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
