import { PROMPT, VOZES, areaValida } from '../config.js';
import { achar, atualizar, inserir, listar, remover } from '../nucleo/banco.js';
import { normalizar, novoId, slug } from '../nucleo/util.js';
import { PACOTES } from '../ia/pacotes.js';
import { PASTA_PADRAO, instalarPacote, novoAgente as agenteNovo, separarPorEscritorio } from '../nucleo/agentes-por-escritorio.js';
import { normalizarMomentos } from '../nucleo/casos.js';
import { sintetizar, vozDisponivel } from '../ia/audio.js';
import { analisarPrompt, catalogoCompleto, ferramentasDoAgente } from '../ia/mencoes.js';
import { forcarResposta } from '../ia/motor.js';
import { modeloDe, provedorDisponivel, conversar } from '../ia/provedores.js';
import { comCodigo, exigirConfiguracao } from './sessao.js';
import { removerTemplate } from '../automacao/remover-template.js';

/**
 * Tudo o que configura o comportamento do sistema: as classes da conversa,
 * os templates, os agentes e a base de conhecimento.
 */

function doWorkspace(ctx, colecao, id) {
  const registro = achar(colecao, id);
  if (!registro || registro.workspaceId !== ctx.workspaceId) throw comCodigo('Registro nao encontrado.', 404);
  return registro;
}

/**
 * Previa de voz: a frase e sempre esta e o intervalo minimo entre dois testes
 * do mesmo usuario e de SEGUNDOS_ENTRE_TESTES. Cada teste e sintese paga e um
 * arquivo novo em disco, entao ele nao pode ser um botao de apertar em laco.
 */
const FRASE_DE_TESTE = 'Ola! Aqui e do escritorio Correia Advogados Associados. Como posso te ajudar?';
const SEGUNDOS_ENTRE_TESTES = 5;
const ultimoTesteDeVoz = new Map();

function esperarEntreTestesDeVoz(usuarioId) {
  const anterior = ultimoTesteDeVoz.get(usuarioId) || 0;
  const faltam = Math.ceil((anterior + SEGUNDOS_ENTRE_TESTES * 1000 - Date.now()) / 1000);
  if (faltam > 0) throw comCodigo(`Espere ${faltam} segundos para ouvir de novo.`, 429);
  ultimoTesteDeVoz.set(usuarioId, Date.now());
}

function crud(rotas, caminho, colecao, { prefixo, aoCriar, aoAtualizar, aoRemover } = {}) {
  rotas.get(`/api/${caminho}`, async ({ ctx }) => listar(colecao, { workspaceId: ctx.workspaceId }));

  rotas.post(`/api/${caminho}`, async ({ ctx, corpo }) => {
    exigirConfiguracao(ctx);
    const registro = inserir(colecao, {
      id: novoId(prefixo || caminho.slice(0, 3)),
      workspaceId: ctx.workspaceId,
      ...corpo,
    });
    if (aoCriar) aoCriar(registro, ctx);
    return registro;
  });

  rotas.patch(`/api/${caminho}/:id`, async ({ ctx, params, corpo }) => {
    exigirConfiguracao(ctx);
    doWorkspace(ctx, colecao, params.id);
    const registro = atualizar(colecao, params.id, corpo);
    if (aoAtualizar) aoAtualizar(registro, ctx);
    return registro;
  });

  rotas.delete(`/api/${caminho}/:id`, async ({ ctx, params }) => {
    exigirConfiguracao(ctx);
    doWorkspace(ctx, colecao, params.id);
    if (aoRemover) aoRemover(params.id, ctx);
    remover(colecao, params.id);
    return { ok: true };
  });
}

export function registrarAutomacoes(rotas) {
  /* ---------------- Classes da conversa ---------------- */

  crud(rotas, 'departamentos', 'departamentos', { prefixo: 'dep' });
  crud(rotas, 'etiquetas', 'etiquetas', { prefixo: 'etq' });
  crud(rotas, 'origens', 'origens', { prefixo: 'org' });
  crud(rotas, 'variaveis', 'variaveis', {
    prefixo: 'var',
    aoCriar: (registro) => {
      if (!registro.chave) atualizar('variaveis', registro.id, { chave: slug(registro.nome).replace(/-/g, '_') });
    },
  });

  rotas.get('/api/status', async ({ ctx }) => listar('status', { workspaceId: ctx.workspaceId }));

  rotas.post('/api/status', async ({ ctx, corpo }) => {
    exigirConfiguracao(ctx);
    return inserir('status', {
      id: novoId('sts'),
      workspaceId: ctx.workspaceId,
      nome: corpo.nome,
      cor: corpo.cor || 'var(--serie-2)',
      descricao: corpo.descricao || '',
      tipo: corpo.tipo || 'nenhum',
      departamentoId: corpo.departamentoId || null,
      followups: corpo.followups || [],
      momentos: normalizarMomentos(corpo.momentos),
    });
  });

  rotas.patch('/api/status/:id', async ({ ctx, params, corpo }) => {
    exigirConfiguracao(ctx);
    doWorkspace(ctx, 'status', params.id);

    if (corpo.followups) {
      const sequencia = corpo.followups.map((passo, indice) => ({
        id: passo.id || novoId('fup'),
        templateId: passo.templateId,
        minutos: Number(passo.minutos) || 60,
        desistir: indice === corpo.followups.length - 1 ? passo.desistir || null : null,
      }));
      const ultimo = sequencia[sequencia.length - 1];
      if (ultimo?.desistir?.ativo && ultimo.desistir.statusId === params.id) {
        throw comCodigo('O status de desistencia precisa ser diferente do status atual.', 400);
      }
      corpo.followups = sequencia;
    }
    if (corpo.momentos !== undefined) corpo.momentos = normalizarMomentos(corpo.momentos);

    return atualizar('status', params.id, corpo);
  });

  rotas.delete('/api/status/:id', async ({ ctx, params }) => {
    exigirConfiguracao(ctx);
    doWorkspace(ctx, 'status', params.id);
    const emUso = listar('contatos', { workspaceId: ctx.workspaceId }).some((c) => c.statusId === params.id);
    if (emUso) throw comCodigo('Ha conversas neste status. Mova-as antes de excluir.', 409);
    remover('status', params.id);
    return { ok: true };
  });

  /* ---------------- Templates ---------------- */

  crud(rotas, 'templates', 'templates', {
    prefixo: 'tpl',
    /* Limpa follow-up, agendamento e ZapSign que apontavam para ele; o
       remover do crud, logo depois, nao acha mais nada e segue. */
    aoRemover: (id) => removerTemplate(id),
    aoCriar: (registro) => {
      if (!registro.atalho) atualizar('templates', registro.id, { atalho: slug(registro.nome) });
      if (!registro.aprovacaoMeta) {
        atualizar('templates', registro.id, {
          aprovacaoMeta: { solicitada: false, situacao: 'nao_solicitada' },
        });
      }
    },
  });

  rotas.post('/api/templates/:id/aprovacao-meta', async ({ ctx, params, corpo }) => {
    exigirConfiguracao(ctx);
    const template = doWorkspace(ctx, 'templates', params.id);
    const { solicitarAprovacao } = await import('../whatsapp/templates-meta.js');
    return solicitarAprovacao({ workspaceId: ctx.workspaceId, template, conexaoIds: corpo.conexaoIds || [], categoria: corpo.categoria });
  });

  rotas.post('/api/templates/:id/revalidar', async ({ ctx, params }) => {
    exigirConfiguracao(ctx);
    const template = doWorkspace(ctx, 'templates', params.id);
    const { revalidarNaMeta } = await import('../whatsapp/templates-meta.js');
    return revalidarNaMeta({ workspaceId: ctx.workspaceId, template });
  });

  /* ---------------- Base de conhecimento ---------------- */

  crud(rotas, 'conhecimento', 'conhecimento', { prefixo: 'kb' });

  /* ---------------- Agentes ---------------- */

  /**
   * Os campos que a TELA pode mudar num agente.
   *
   * Ate aqui o corpo do PATCH ia cru para o banco, e isso abria dois buracos
   * de tamanhos bem diferentes.
   *
   * O primeiro e de dono: um PATCH com { workspaceId: 'outro' } mudava o
   * escritorio a que o agente pertence, e a guarda de workspace logo acima so
   * confere o registro ANTES da escrita — depois dela o agente ja nao e mais
   * daqui, e some da tela sem nenhum erro.
   *
   * O segundo e mais insidioso. O GET devolve o agente somado a sete campos
   * CALCULADOS na hora — caracteres, mencoes, ferramentas, primarioEm. Uma tela
   * que devolvesse esse objeto inteiro num PATCH gravaria os sete no disco, e a
   * partir dali o registro carregaria uma copia congelada de um calculo que
   * ninguem mais refaz: o agente diria ter uma ferramenta que o prompt nao pede
   * mais.
   *
   * Campo fora da lista e descartado em silencio, de proposito: a tela nunca
   * manda um, e recusar a chamada inteira por causa de um campo a mais faria o
   * salvar falhar por motivo que a pessoa nao tem como entender. Quem
   * acrescentar um campo novo ao agente precisa acrescentar aqui tambem — e o
   * teste em servidor/testes/agentes.js afirma exatamente isso.
   */
  const CAMPOS_DO_AGENTE = new Set([
    'nome',
    'objetivo',
    'prompt',
    'palavrasChave',
    'modelo',
    'delaySegundos',
    'conhecimentoIds',
    'vozId',
    'modoAudio',
    'pasta',
    'ativo',
    'foto',
    'area',
    'requisitos',
  ]);

  /**
   * A foto tem que ser um arquivo desta maquina.
   *
   * O campo passava pela lista como texto livre, e texto livre aqui e duas
   * coisas ruins de uma vez. Um endereco de fora — { foto: 'https://…' } —
   * faria o navegador de toda a equipe buscar num terceiro a cada desenho da
   * lista, entregando a ele a hora e o IP de quem esta trabalhando. E um
   * 'data:image/png;base64,…' gravaria a imagem INTEIRA dentro do registro do
   * agente, que vive num arquivo JSON lido por completo na memoria e espelhado
   * no Supabase — uma foto de 4 MB viraria 4 MB de texto em cada leitura.
   *
   * O upload legitimo devolve sempre /midia/<arquivo>, entao e isso que se
   * aceita. Vazio e nulo continuam valendo: e assim que se tira a foto.
   */
  const CAMINHO_DE_MIDIA = /^\/midia\/[\w.-]+$/;

  /** A trava de tamanho do prompt. O porque do numero esta em PROMPT, config.js. */
  function conferirTamanhoDoPrompt(prompt) {
    const tamanho = String(prompt ?? '').length;
    if (tamanho > PROMPT.maximo) {
      throw comCodigo(
        `O prompt tem ${tamanho.toLocaleString('pt-BR')} caracteres; o limite e ${PROMPT.maximo.toLocaleString('pt-BR')}. Leve regras, leis e documentos para a Base de conhecimento: o agente consulta la so quando precisa.`,
        400,
      );
    }
  }

  function apenasCamposDoAgente(corpo) {
    const limpo = {};
    for (const [chave, valor] of Object.entries(corpo || {})) {
      if (!CAMPOS_DO_AGENTE.has(chave)) continue;
      if (chave === 'prompt') conferirTamanhoDoPrompt(valor);
      if (chave === 'area') {
        limpo.area = areaValida(valor);
        continue;
      }
      /* Requisito e a chave de uma variavel ("CTPS foto" vira ctps_foto): e
         pela chave que o motor sabe o que ainda falta coletar. */
      if (chave === 'requisitos') {
        limpo.requisitos = [...new Set((Array.isArray(valor) ? valor : [])
          .map((item) => slug(String(item)).replace(/-/g, '_'))
          .filter(Boolean))].slice(0, 20);
        continue;
      }
      if (chave === 'foto') {
        if (valor === null || valor === '') { limpo.foto = null; continue; }
        if (!CAMINHO_DE_MIDIA.test(String(valor))) {
          throw comCodigo('A foto precisa ser um arquivo enviado pelo proprio sistema.', 400);
        }
      }
      limpo[chave] = valor;
    }
    return limpo;
  }

  /* O construtor unico do agente mora em nucleo/agentes-por-escritorio.js: e o
     mesmo que instala os pacotes e separa as areas por escritorio. */
  function novoAgente(ctx, dados = {}) {
    return agenteNovo(ctx.workspaceId, dados);
  }

  rotas.get('/api/agentes', async ({ ctx }) =>
    listar('agentes', { workspaceId: ctx.workspaceId }).map((agente) => {
      const analise = analisarPrompt(agente.prompt || '', ctx.workspaceId);
      const conexoes = listar('conexoes', { workspaceId: ctx.workspaceId }).filter(
        (c) => c.responsavelPadrao?.tipo === 'agente' && c.responsavelPadrao.id === agente.id,
      );
      const referencias = listar('agentes', { workspaceId: ctx.workspaceId }).filter(
        (outro) => outro.id !== agente.id && (outro.prompt || '').includes(`@${agente.nome}`),
      );
      return {
        ...agente,
        caracteres: (agente.prompt || '').length,
        mencoes: analise.mencoes,
        mencoesInvalidas: analise.invalidas,
        ferramentas: ferramentasDoAgente(agente, ctx.workspaceId).map((f) => f.nome),
        primarioEm: conexoes.map((c) => ({ id: c.id, nome: c.nome })),
        referenciadoPor: referencias.map((r) => ({ id: r.id, nome: r.nome })),
        modeloDisponivel: provedorDisponivel(agente.modelo, ctx.workspaceId),
      };
    }),
  );

  /*
   * So para ENXERGAR: um agente e sempre do escritorio dele (edicao, WhatsApp
   * e IA continuam por area). Isto junta os agentes de todos os escritorios do
   * usuario numa lista so, para a aba "Todos os escritorios" da tela de
   * Agentes - sem o custo de mencoes/ferramentas da lista de um escritorio so.
   */
  rotas.get('/api/agentes/todos-escritorios', async ({ ctx }) =>
    ctx.workspaces.flatMap((workspace) =>
      listar('agentes', { workspaceId: workspace.id }).map((agente) => ({
        id: agente.id,
        nome: agente.nome,
        pasta: agente.pasta || PASTA_PADRAO,
        ativo: agente.ativo,
        area: agente.area || null,
        atualizadoEm: agente.atualizadoEm || agente.criadoEm,
        workspaceId: workspace.id,
        workspaceNome: workspace.nome,
      })),
    ),
  );

  /* ---------------- Pacotes de agentes por area (ia/pacotes.js) ---------------- */

  /* O escritorio de uma area so recebe os agentes da propria area (pedido de
     15/09: "os agentes trabalhistas vao para o workspace trabalhista"). O
     escritorio geral, sem area, ve todos. */
  const areaDoEscritorio = (workspaceId) => achar('workspaces', workspaceId)?.area || null;

  rotas.get('/api/agentes-pacotes', async ({ ctx }) => {
    const nomes = new Set(listar('agentes', { workspaceId: ctx.workspaceId }).map((a) => normalizar(a.nome)));
    const daqui = areaDoEscritorio(ctx.workspaceId);
    return Object.entries(PACOTES).filter(([area]) => !daqui || area === daqui).map(([area, pacote]) => ({
      area,
      nome: pacote.nome,
      agentes: pacote.agentes.map((a) => ({ nome: a.nome, instalado: nomes.has(normalizar(a.nome)) })),
    }));
  });

  /* Instalar (nucleo/agentes-por-escritorio.js): cria o que os roteiros citam e
     nao existe, nunca sobrescreve agente do pacote que ja existe e, com
     `substituir`, tira o que nao e do pacote, com copia. */
  rotas.post('/api/agentes-pacotes/:area', async ({ ctx, params, corpo }) => {
    exigirConfiguracao(ctx);
    if (!PACOTES[params.area]) throw comCodigo('Nao ha pacote de agentes para esta area.', 404);
    const daqui = areaDoEscritorio(ctx.workspaceId);
    if (daqui && daqui !== params.area) {
      throw comCodigo(
        `Este escritorio e do ${PACOTES[daqui]?.nome || daqui}. Os agentes de ${PACOTES[params.area].nome} ficam no escritorio da area deles.`,
        409,
      );
    }

    const conexao = corpo?.conexaoId ? achar('conexoes', corpo.conexaoId) : null;
    if (corpo?.conexaoId && (!conexao || conexao.workspaceId !== ctx.workspaceId)) {
      throw comCodigo('Conexao nao encontrada.', 404);
    }

    const resultado = instalarPacote({
      workspaceId: ctx.workspaceId,
      area: params.area,
      substituir: corpo?.substituir === true,
      conexao,
    });
    return { ok: true, ...resultado, conexao: conexao ? { id: conexao.id, nome: conexao.nome } : null };
  });

  /* Cada area no seu escritorio, a partir do escritorio geral
     (separarPorEscritorio, em nucleo/agentes-por-escritorio.js). A mesma coisa
     roda com o servidor parado por ferramentas/agentes-por-escritorio.js. */
  rotas.post('/api/agentes-por-escritorio', async ({ ctx, corpo }) => {
    exigirConfiguracao(ctx);
    if (areaDoEscritorio(ctx.workspaceId)) {
      throw comCodigo('Separe a partir do escritorio geral, o que nao tem area.', 409);
    }
    return { ok: true, ...separarPorEscritorio({ origemId: ctx.workspaceId, apagarOutros: corpo?.apagarOutros === true }) };
  });

  rotas.post('/api/agentes', async ({ ctx, corpo }) => {
    exigirConfiguracao(ctx);
    conferirTamanhoDoPrompt(corpo?.prompt);
    return inserir('agentes', novoAgente(ctx, corpo));
  });

  rotas.patch('/api/agentes/:id', async ({ ctx, params, corpo }) => {
    exigirConfiguracao(ctx);
    doWorkspace(ctx, 'agentes', params.id);
    return atualizar('agentes', params.id, apenasCamposDoAgente(corpo));
  });

  /**
   * Renomear uma pasta de agentes.
   *
   * Nao ha tabela de pastas, e isso e de proposito: a pasta e so um texto no
   * registro do agente, e ela existe enquanto algum agente apontar para ela.
   * Criar pasta e mover um agente para um nome novo; esvaziar e a mesma coisa
   * ao contrario.
   *
   * O que NAO da para fazer no navegador e renomear: seriam N chamadas, uma por
   * agente, e uma falha no meio deixaria metade da pasta com o nome velho e
   * metade com o novo — duas pastas na tela onde havia uma. Aqui e um laco so,
   * sincrono, sobre o banco em memoria: ou renomeia tudo, ou nao renomeia nada.
   */
  rotas.patch('/api/agentes-pasta', async ({ ctx, corpo }) => {
    exigirConfiguracao(ctx);
    const de = String(corpo.de || '').trim();
    const para = String(corpo.para || '').trim();
    if (!de || !para) throw comCodigo('Informe o nome atual e o novo nome da pasta.', 400);
    if (para.length > 40) throw comCodigo('Nome de pasta muito longo (maximo 40 caracteres).', 400);

    const daPasta = listar('agentes', { workspaceId: ctx.workspaceId }).filter(
      (agente) => (agente.pasta || PASTA_PADRAO) === de,
    );
    if (!daPasta.length) throw comCodigo('Pasta nao encontrada.', 404);

    /*
     * Renomear para um nome que ja existe junta as duas pastas. Isso e o
     * esperado — e como funciona em qualquer gerenciador de arquivos — mas
     * merece um retorno dizendo quantos agentes se mexeram, senao a pessoa ve
     * uma pasta sumir da tela e acha que apagou os agentes dela.
     */
    for (const agente of daPasta) atualizar('agentes', agente.id, { pasta: para });
    return { ok: true, movidos: daPasta.length, juntou: daPasta.length !== listar('agentes', { workspaceId: ctx.workspaceId }).filter((a) => (a.pasta || PASTA_PADRAO) === para).length };
  });

  rotas.delete('/api/agentes/:id', async ({ ctx, params }) => {
    exigirConfiguracao(ctx);
    doWorkspace(ctx, 'agentes', params.id);
    const emUso = listar('contatos', { workspaceId: ctx.workspaceId }).some(
      (c) => c.responsavel?.tipo === 'agente' && c.responsavel.id === params.id,
    );
    if (emUso) throw comCodigo('Ha conversas com este agente como responsavel. Troque o responsavel antes.', 409);
    remover('agentes', params.id);
    return { ok: true };
  });

  rotas.get('/api/mencoes', async ({ ctx }) => catalogoCompleto(ctx.workspaceId));

  /* ---------------- Vozes ---------------- */

  rotas.get('/api/vozes', async ({ ctx }) => ({
    vozes: listar('vozes', { workspaceId: ctx.workspaceId }),
    base: VOZES,
    disponivel: vozDisponivel(ctx.workspaceId),
  }));

  rotas.post('/api/vozes', async ({ ctx, corpo }) => {
    exigirConfiguracao(ctx);
    if (!corpo.nome) throw comCodigo('De um nome a voz.', 400);
    return inserir('vozes', {
      id: novoId('voz'),
      workspaceId: ctx.workspaceId,
      nome: corpo.nome,
      descricao: corpo.descricao || '',
      vozBase: corpo.vozBase || 'nova',
      velocidade: Number(corpo.velocidade) || 1,
    });
  });

  rotas.patch('/api/vozes/:id', async ({ ctx, params, corpo }) => {
    exigirConfiguracao(ctx);
    doWorkspace(ctx, 'vozes', params.id);
    return atualizar('vozes', params.id, corpo);
  });

  rotas.delete('/api/vozes/:id', async ({ ctx, params }) => {
    exigirConfiguracao(ctx);
    doWorkspace(ctx, 'vozes', params.id);
    remover('vozes', params.id);
    return { ok: true };
  });

  /**
   * Ouve a voz antes de colocar no ar.
   *
   * O botao Ouvir e aberto a qualquer perfil de proposito: escolher voz sem
   * ouvir nao funciona. O que nao pode e o texto vir do cliente. Com corpo.texto
   * solto, um laco de fetch com vinte mil caracteres virava sintese paga na
   * chave da OpenAI do escritorio e um arquivo novo em disco por chamada. A
   * frase e sempre esta, e cada usuario tem um intervalo minimo entre testes.
   */
  rotas.post('/api/vozes/testar', async ({ ctx, corpo }) => {
    if (!vozDisponivel(ctx.workspaceId)) {
      throw comCodigo('Para gerar audio e preciso cadastrar a chave da OpenAI na tela de Integracoes.', 400);
    }
    esperarEntreTestesDeVoz(ctx.usuarioId);

    // A voz precisa ser deste workspace, ou uma das vozes base do catalogo.
    const pedida = String(corpo.vozId || corpo.vozBase || '').trim();
    const doWorkspace = listar('vozes', { workspaceId: ctx.workspaceId }).some((v) => v.id === pedida);
    const doCatalogo = VOZES.some((v) => v.id === pedida);
    if (pedida && !doWorkspace && !doCatalogo) throw comCodigo('Voz nao encontrada.', 404);

    const midia = await sintetizar({
      workspaceId: ctx.workspaceId,
      contatoId: null,
      texto: FRASE_DE_TESTE,
      vozId: pedida || undefined,
    });
    if (!midia) throw comCodigo('Nao consegui gerar o audio agora.', 502);
    return midia;
  });

  /** Roda o agente na hora, sem esperar o delay, usado no teste da tela. */
  rotas.post('/api/agentes/:id/responder-agora', async ({ ctx, corpo }) => {
    const contato = achar('contatos', corpo.contatoId);
    if (!contato || contato.workspaceId !== ctx.workspaceId) throw comCodigo('Conversa nao encontrada.', 404);
    const texto = await forcarResposta(contato.id);
    return { ok: true, texto };
  });

  /** Gera o prompt de um agente novo a partir de uma descricao em linguagem comum. */
  rotas.post('/api/agentes/gerar', async ({ ctx, corpo }) => {
    exigirConfiguracao(ctx);
    const modeloId = corpo.modelo || 'claude-opus-5';
    if (!provedorDisponivel(modeloId, ctx.workspaceId) || modeloDe(modeloId).provedor === 'regras') {
      throw comCodigo(
        'Para gerar agente com IA e preciso cadastrar a chave da API na tela de Integracoes.',
        400,
      );
    }

    const catalogo = catalogoCompleto(ctx.workspaceId);
    const porTipo = (tipo) =>
      catalogo.filter((c) => c.tipo === tipo).map((c) => c.rotulo).join(', ') || 'nenhum cadastrado';

    const resposta = await conversar({
      modeloId,
      workspaceId: ctx.workspaceId,
      sistema: [
        'Voce escreve prompts de agentes de atendimento no WhatsApp para um escritorio de advocacia brasileiro.',
        '',
        'O prompt que voce escrever sera executado por outro modelo. Ele precisa:',
        '- Estar em portugues do Brasil.',
        '- Comecar dizendo quem o agente e e como fala.',
        '- Trazer um ROTEIRO numerado, uma pergunta por vez, com as falas exatas entre aspas.',
        '- Amarrar cada pergunta condicional a resposta anterior.',
        '- Terminar com as REGRAS: o que nunca fazer, quando transferir e o que dizer ao transferir.',
        '- Usar @ para acionar acoes reais, apenas com os itens que existem no workspace.',
        `- Ter entre 3.000 e ${PROMPT.recomendadoAte.toLocaleString('pt-BR')} caracteres. Regra longa, lei e tabela de valores nao entram: o agente consulta a base de conhecimento.`,
        '',
        'Itens disponiveis para mencao:',
        `- Status: ${porTipo('status')}`,
        `- Etiquetas: ${porTipo('tag')}`,
        `- Departamentos: ${porTipo('departamento')}`,
        `- Templates: ${porTipo('template')}`,
        `- Variaveis: ${porTipo('variavel')}`,
        `- Agentes: ${porTipo('agente')}`,
        '- Sistema: @think, @calculadora, @dataehora, @resumo, @biblioteca, @salvarnome, @notificar, @gerarcontrato, @calendario, @advbox, @ativaraudio, @desativaraudio, @desativarIA',
        '',
        'Responda SO com o texto do prompt. Sem introducao, sem comentario, sem markdown de bloco.',
      ].join('\n'),
      mensagens: [
        {
          papel: 'usuario',
          texto: [
            `Objetivo do agente: ${corpo.objetivo || 'qualificar leads'}.`,
            `Descricao dada pelo escritorio: ${corpo.descricao || 'sem descricao'}.`,
            corpo.referencia ? `Material de referencia:\n${String(corpo.referencia).slice(0, 6000)}` : '',
          ]
            .filter(Boolean)
            .join('\n\n'),
        },
      ],
    });

    if (!resposta.texto) throw comCodigo('A IA nao devolveu um prompt. Tente de novo.', 502);

    return inserir(
      'agentes',
      novoAgente(ctx, {
        ...corpo,
        nome: corpo.nome || 'Agente gerado por IA',
        // O prompt aqui e o texto que o modelo acabou de escrever, nunca o que
        // veio no corpo da chamada.
        prompt: resposta.texto,
        modelo: corpo.modeloDoAgente,
      }),
    );
  });
}
