import crypto from 'node:crypto';
import { ENDERECO_PUBLICO, PORTA, areaValida } from '../config.js';
import { ESCOPOS_TIKTOK, concluirLoginTikTok, registrarWebhookTikTok } from '../whatsapp/drivers/tiktok.js';
import { achar, atualizar, inserir, listar, registrarLog, remover } from '../nucleo/banco.js';
import { emitir } from '../nucleo/eventos.js';
import { agora, normalizarTelefone, novoId, ordenarPor } from '../nucleo/util.js';
import { acharOuCriarContato, atualizarSituacaoExterna, receberMensagem } from '../whatsapp/recebimento.js';
import { driverDa, listarDrivers } from '../whatsapp/drivers/index.js';
import { notificar } from '../ia/mencoes.js';
import { agendarResposta } from '../ia/motor.js';
import { guardarNaAgenda } from '../whatsapp/agenda.js';
import { completarComEvolutionLocal, garantirEvolutionLocal } from '../whatsapp/evolution-local.js';
import { agendarSincronizacao, cancelarSincronizacao, rodar } from '../whatsapp/sincronizar-historico.js';
import { comCodigo, exigirConfiguracao } from './sessao.js';

/**
 * Conexoes de WhatsApp.
 *
 * Esta rota nao sabe falar com a Meta nem com a Evolution API, e e de proposito:
 * cada jeito de conectar mora no seu driver, em `servidor/whatsapp/drivers/`.
 * Aqui ficam as decisoes que valem para os tres, e so elas: quem pode mexer, o
 * que fazer com o evento traduzido, e o que gravar.
 */

/**
 * Trilha de eventos do numero.
 *
 * Reaproveita a colecao `logs`, que ja e espelhada no Supabase e ja tem o
 * carimbo de tempo e o autor: o que faltava era como achar de novo o que
 * aconteceu com UM numero. O `contatoId` fica nulo (o evento e do numero, nao
 * de uma conversa) e o vinculo vai em `dados.conexaoId`, que e por onde a aba
 * Logs do painel filtra.
 *
 * Sem isso, "o numero caiu ontem a tarde" nao tinha onde ser lido: a tela
 * mostrava so o estado de agora, e quem chegava de manha via "desconectado"
 * sem nenhuma pista de quando ou por que.
 */
function registrarEvento(conexao, tipo, descricao, autor = null) {
  return registrarLog(conexao.workspaceId, null, `conexao_${tipo}`, descricao, autor, {
    conexaoId: conexao.id,
    conexaoNome: conexao.nome,
  });
}

/**
 * O que sai na leitura.
 *
 * Todo segredo vira '***': token da Meta e chave do servico de QR Code sao a
 * chave da casa, e a tela nunca precisa do valor, so precisa saber se ele
 * existe. O campo em branco na tela significa "mantenha o que esta guardado".
 */
function paraTela(conexao) {
  const mascara = (valor) => (valor ? '***' : '');
  return {
    ...conexao,
    ordem: Number.isFinite(conexao.ordem) ? conexao.ordem : Number.MAX_SAFE_INTEGER,
    oficial: conexao.oficial ? { ...conexao.oficial, token: mascara(conexao.oficial.token) } : null,
    qrcode: conexao.qrcode ? { ...conexao.qrcode, chave: mascara(conexao.qrcode.chave) } : null,
    instagram: conexao.instagram
      ? { ...conexao.instagram, token: mascara(conexao.instagram.token), appSecret: mascara(conexao.instagram.appSecret) }
      : null,
    tiktok: conexao.tiktok
      ? {
          ...conexao.tiktok,
          appSecret: mascara(conexao.tiktok.appSecret),
          token: mascara(conexao.tiktok.token),
          renovacao: mascara(conexao.tiktok.renovacao),
          estadoLogin: undefined,
        }
      : null,
    /* Instagram e TikTok tem UM webhook por app, e nao um por conexao: e a
       conta de cada evento que diz de qual conexao ele e. */
    webhookUrl: ['instagram', 'tiktok'].includes(conexao.tipo) ? `/webhook/${conexao.tipo}` : `/webhook/${conexao.id}`,
    enderecoPublico: ENDERECO_PUBLICO || null,
  };
}

/** Os campos de rede social que a conexao nasce tendo, vazios. */
function blocosDasRedes() {
  return {
    instagram: { contaId: '', token: '', appSecret: '', verifyToken: crypto.randomBytes(16).toString('hex') },
    tiktok: { appId: '', appSecret: '', businessId: '', token: '', renovacao: '', usuario: '' },
  };
}

/**
 * Junta o bloco de credenciais que veio da tela com o que ja estava guardado,
 * preservando o segredo quando o campo chegou vazio ou mascarado.
 *
 * Sem isto, salvar so o nome da conexao apagava o token do numero, e o numero
 * parava de enviar sem ninguem entender por que.
 */
function juntarSegredo(atual = {}, novo = {}, campoSegredo) {
  const vindo = novo[campoSegredo];
  const manter = !vindo || vindo === '***';
  return { ...atual, ...novo, [campoSegredo]: manter ? atual[campoSegredo] || '' : vindo };
}

/**
 * O endereco que o servico de QR Code precisa chamar de volta.
 *
 * O padrao e o localhost desta maquina, que e onde o servico costuma rodar. Em
 * Docker isso nao serve: `localhost` dentro do container e o proprio container,
 * e nao esta maquina. Por isso o campo e configuravel, e a tela explica quando
 * mexer nele.
 */
/** A conexao de Instagram ou TikTok a que um evento do webhook do app se refere. */
function conexaoDoWebhookGeral(tipo, carga) {
  if (!carga) return null;
  if (tipo === 'instagram') {
    const contas = new Set((carga.entry || []).map((entrada) => String(entrada.id)));
    return listar('conexoes').find((c) => c.tipo === 'instagram' && contas.has(String(c.instagram?.contaId || ''))) || null;
  }
  if (tipo === 'tiktok') {
    const conta = String(carga.user_openid || '');
    return listar('conexoes').find((c) => c.tipo === 'tiktok' && conta && String(c.tiktok?.businessId || '') === conta) || null;
  }
  return null;
}

/* Para onde o TikTok devolve o navegador depois do login da conta comercial. */
const retornoDoTikTok = () => `${ENDERECO_PUBLICO}/tiktok/retorno`;

function urlDoWebhook(conexao) {
  const configurada = String(conexao.qrcode?.urlWebhook || '').replace(/\/+$/, '');
  const base = configurada || `http://localhost:${PORTA}`;
  return `${base}/webhook/${conexao.id}`;
}

export function registrarConexoes(rotas) {
  /*
   * A ordem e escolhida na tela e vale para todo mundo, por isso mora no
   * registro e nao no navegador de quem arrastou. Conexao criada antes de
   * existir o campo cai no fim da fila em vez de sumir da lista, e a data de
   * criacao desempata para a ordem nunca oscilar entre dois carregamentos.
   */
  rotas.get('/api/conexoes', async ({ ctx }) => {
    const lista = listar('conexoes', { workspaceId: ctx.workspaceId }).map(paraTela);
    return ordenarPor(lista, 'ordem').sort(
      (a, b) => a.ordem - b.ordem || String(a.criadoEm).localeCompare(String(b.criadoEm)),
    );
  });

  /** Os caminhos disponiveis, para a tela montar o seletor de tipo. */
  rotas.get('/api/conexoes-tipos', async () => listarDrivers());

  rotas.post('/api/conexoes', async ({ ctx, corpo }) => {
    exigirConfiguracao(ctx);
    const existentes = listar('conexoes', { workspaceId: ctx.workspaceId });
    const id = novoId('cnx');
    const conexao = inserir('conexoes', {
      id,
      workspaceId: ctx.workspaceId,
      /* Fim da fila. Entrando em zero, o numero novo (que ainda nem conectou)
         empurraria para baixo o numero que o escritorio usa o dia inteiro. */
      ordem: existentes.length,
      nome: corpo.nome || 'Nova conexao',
      tipo: corpo.tipo || 'simulador',
      numero: corpo.numero || '',
      estado: corpo.tipo === 'simulador' ? 'conectado' : 'desconectado',
      statusPadraoId: corpo.statusPadraoId || null,
      departamentoPadraoId: corpo.departamentoPadraoId || null,
      responsavelPadrao: corpo.responsavelPadrao || null,
      area: areaValida(corpo.area),
      oficial: {
        phoneNumberId: '',
        wabaId: '',
        token: '',
        verifyToken: crypto.randomBytes(16).toString('hex'),
        appSecret: '',
      },
      /* Endereco, chave e retorno ja vem da Evolution desta maquina (ver
         whatsapp/evolution-local.js); sem ela instalada, ficam em branco. */
      qrcode: completarComEvolutionLocal({
        servidor: '',
        chave: '',
        /* Uma instancia por numero, com o nome ja preenchido: o id da conexao
           e unico e nao muda, e obrigar alguem a inventar um nome so cria a
           chance de duas conexoes apontarem para a mesma sessao. */
        instancia: id,
        urlWebhook: '',
      }),
      ...blocosDasRedes(),
    });
    registrarEvento(conexao, 'criada', `Conexao criada em modo ${conexao.tipo}.`, {
      tipo: 'membro',
      id: ctx.membro?.id || null,
      nome: ctx.usuario?.nome || 'Equipe',
    });
    return paraTela(conexao);
  });

  rotas.patch('/api/conexoes/:id', async ({ ctx, params, corpo }) => {
    exigirConfiguracao(ctx);
    const conexao = achar('conexoes', params.id);
    if (!conexao || conexao.workspaceId !== ctx.workspaceId) throw comCodigo('Conexao nao encontrada.', 404);

    if (corpo.oficial) corpo.oficial = juntarSegredo(conexao.oficial, corpo.oficial, 'token');
    if (corpo.qrcode) corpo.qrcode = juntarSegredo(conexao.qrcode, corpo.qrcode, 'chave');
    /* Conexao criada antes dos canais de rede social nao tem os blocos. */
    const redes = blocosDasRedes();
    if (corpo.instagram) {
      const atual = conexao.instagram || redes.instagram;
      corpo.instagram = juntarSegredo(atual, juntarSegredo(atual, corpo.instagram, 'token'), 'appSecret');
      if (!corpo.instagram.verifyToken) corpo.instagram.verifyToken = atual.verifyToken || redes.instagram.verifyToken;
      /* Token novo so pode ser renovado depois de 24 horas: a rodada de
         renovacao conta a partir daqui. */
      if (corpo.instagram.token && corpo.instagram.token !== atual.token) {
        Object.assign(corpo.instagram, { tokenGuardadoEm: agora(), tokenRenovadoEm: null });
      }
    }
    if (corpo.tiktok) {
      const atual = conexao.tiktok || redes.tiktok;
      /* Token e renovacao so entram pelo login do TikTok, nunca pela tela. */
      const { token, renovacao, tokenVenceEm, renovacaoVenceEm, estadoLogin, ...editavel } = corpo.tiktok;
      corpo.tiktok = juntarSegredo(atual, editavel, 'appSecret');
    }
    if (corpo.area !== undefined) corpo.area = areaValida(corpo.area);

    const anterior = conexao.tipo;
    const atualizada = atualizar('conexoes', params.id, corpo);

    if (corpo.tipo && corpo.tipo !== anterior) {
      registrarEvento(atualizada, 'tipo', `Caminho de conexao trocado de ${anterior} para ${corpo.tipo}.`, {
        tipo: 'membro',
        id: ctx.membro?.id || null,
        nome: ctx.usuario?.nome || 'Equipe',
      });
    }

    emitir(ctx.workspaceId, 'conexao', { conexaoId: params.id });
    return paraTela(atualizada);
  });

  /**
   * Traz o historico que ja estava no celular.
   *
   * Fica atras de exigirConfiguracao como as outras: a importacao escreve
   * dezenas de conversas na base do escritorio de uma vez, e desfazer isso e
   * bem mais trabalhoso que evitar.
   *
   * Nao passa pelo funil de recebimento de proposito — ele acionaria o agente,
   * que escreveria para pessoas reais sobre assuntos de meses atras. O porque
   * inteiro esta em servidor/whatsapp/importar-historico.js.
   */
  rotas.post('/api/conexoes/:id/importar-historico', async ({ ctx, params, corpo }) => {
    exigirConfiguracao(ctx);
    const conexao = achar('conexoes', params.id);
    if (!conexao || conexao.workspaceId !== ctx.workspaceId) throw comCodigo('Conexao nao encontrada.', 404);
    if (conexao.tipo !== 'qrcode') {
      throw comCodigo('So a conexao por QR Code tem historico para trazer.', 400);
    }

    /* Quem clicou fica com as conversas em Ativos. A rodada e a mesma das
       automaticas (whatsapp/sincronizar-historico.js), entao a tela le o
       andamento do mesmo lugar, seja qual for a origem. */
    const quemClicou = ctx.membro
      ? { tipo: 'membro', id: ctx.membro.id, nome: ctx.usuario?.nome || 'Equipe' }
      : null;
    try {
      const relato = await rodar(conexao.id, null, quemClicou, { forcarFotos: true });
      if (!relato) throw comCodigo('Ja ha uma importacao em andamento para este numero.', 409);
      return relato;
    } catch (erro) {
      if (erro.codigo) throw erro;
      throw comCodigo(erro.message, 502);
    }
  });

  rotas.delete('/api/conexoes/:id', async ({ ctx, params }) => {
    exigirConfiguracao(ctx);
    const conexao = achar('conexoes', params.id);
    if (!conexao || conexao.workspaceId !== ctx.workspaceId) throw comCodigo('Conexao nao encontrada.', 404);
    const emUso = listar('contatos', { workspaceId: ctx.workspaceId }).some((c) => c.conexaoId === params.id);
    if (emUso) throw comCodigo('Ha conversas nesta conexao. Migre-as para outro numero antes de excluir.', 409);
    cancelarSincronizacao(params.id);
    /* A agenda e a lista de contatos do celular daquele numero: sem o numero,
       guardar nome e telefone de centenas de pessoas nao serve a ninguem. */
    for (const registro of listar('agenda', { conexaoId: params.id })) remover('agenda', registro.id);
    remover('conexoes', params.id);
    return { ok: true };
  });

  /**
   * Ordem das conexoes na tela, arrastada pela alca da linha.
   *
   * Recebe a lista inteira de ids, e nao "mova o item X para a posicao Y": com
   * duas pessoas reordenando ao mesmo tempo, um deslocamento relativo aplicado
   * sobre uma lista que ja mudou embaralha tudo. A lista inteira e o estado
   * final que a pessoa esta vendo, e o ultimo a salvar vence, que e o
   * comportamento que ela espera.
   */
  rotas.post('/api/conexoes/ordenar', async ({ ctx, corpo }) => {
    exigirConfiguracao(ctx);
    const ids = Array.isArray(corpo.ids) ? corpo.ids : [];
    if (!ids.length) throw comCodigo('Envie a lista de ids na ordem desejada.', 400);

    const minhas = new Set(listar('conexoes', { workspaceId: ctx.workspaceId }).map((c) => c.id));
    /* Id de fora do workspace nao reordena nada aqui: sem esta conferencia,
       uma lista forjada renumeraria conexao de outro escritorio. */
    for (const id of ids) {
      if (!minhas.has(id)) throw comCodigo('Conexao nao encontrada.', 404);
    }

    ids.forEach((id, indice) => atualizar('conexoes', id, { ordem: indice }));
    emitir(ctx.workspaceId, 'conexao', { ordenadas: true });
    return { ok: true, total: ids.length };
  });

  /** Eventos do numero: o que a aba Logs e o "Ver eventos" do painel leem. */
  rotas.get('/api/conexoes/:id/eventos', async ({ ctx, params, query }) => {
    const conexao = achar('conexoes', params.id);
    if (!conexao || conexao.workspaceId !== ctx.workspaceId) throw comCodigo('Conexao nao encontrada.', 404);

    const limite = Math.min(Number(query.limite) || 50, 200);
    return listar('logs', { workspaceId: ctx.workspaceId })
      .filter((log) => log.dados?.conexaoId === params.id)
      .sort((a, b) => String(b.criadoEm).localeCompare(String(a.criadoEm)))
      .slice(0, limite)
      .map((log) => ({
        id: log.id,
        em: log.criadoEm,
        tipo: String(log.tipo || '').replace(/^conexao_/, ''),
        descricao: log.descricao,
      }));
  });

  /** Confere se o caminho daquela conexao esta de pe, seja ele qual for. */
  rotas.post('/api/conexoes/:id/testar', async ({ ctx, params }) => {
    const encontrada = achar('conexoes', params.id);
    if (!encontrada || encontrada.workspaceId !== ctx.workspaceId) throw comCodigo('Conexao nao encontrada.', 404);
    const conexao = garantirEvolutionLocal(encontrada);

    const resultado = await driverDa(conexao).testar({ conexao });

    /* O simulador nao tem estado de rede para gravar: ele esta sempre de pe, e
       reescrever o registro a cada teste so encheria a trilha de eventos. */
    if (conexao.tipo !== 'simulador') {
      atualizar('conexoes', params.id, {
        estado: resultado.ok ? 'conectado' : 'desconectado',
        numero: resultado.numero || conexao.numero,
        qualidade: resultado.qualidade ?? conexao.qualidade ?? null,
        nomeExibicao: resultado.nomeExibicao || conexao.nomeExibicao || null,
        conectadoEm: resultado.ok ? agora() : conexao.conectadoEm || null,
        ultimoErro: resultado.ok ? null : resultado.erro || null,
      });
      registrarEvento(
        conexao,
        resultado.ok ? 'conectado' : 'desconectado',
        resultado.ok
          ? `Teste passou: ${resultado.numero || conexao.numero || 'numero'}${resultado.qualidade ? ` (qualidade ${resultado.qualidade})` : ''}.`
          : `Teste falhou: ${resultado.erro}`,
      );
      emitir(ctx.workspaceId, 'conexao', { conexaoId: params.id });

      /* A tela do QR Code descobre que a sessao abriu por aqui, a cada tres
         segundos. Se o aviso de sessao aberta da Evolution nao chegar (webhook
         mal apontado), as conversas do celular vem assim mesmo. */
      const atual = achar('conexoes', params.id);
      if (resultado.ok && atual?.tipo === 'qrcode' && atual.historico?.situacao !== 'concluido') {
        agendarSincronizacao(atual);
      }
    }

    return resultado;
  });

  /**
   * Abre a sessao. So existe no caminho por QR Code: a Cloud API nao tem sessao
   * para abrir, ela ja nasce ligada quando as credenciais estao certas.
   */
  rotas.post('/api/conexoes/:id/conectar', async ({ ctx, params }) => {
    exigirConfiguracao(ctx);
    const encontrada = achar('conexoes', params.id);
    if (!encontrada || encontrada.workspaceId !== ctx.workspaceId) throw comCodigo('Conexao nao encontrada.', 404);
    /* Conexao criada antes de o sistema saber ler a Evolution local, ou
       trocada de tipo depois de criada: completa aqui, no clique. */
    const conexao = garantirEvolutionLocal(encontrada);

    const driver = driverDa(conexao);
    if (!driver.conectar) {
      throw comCodigo(`O caminho "${driver.nome}" nao abre sessao. Use Testar conexao.`, 400);
    }

    /* Quem pede o QR Code e quem fica com as conversas que o celular trouxer
       (ver whatsapp/sincronizar-historico.js). */
    if (ctx.membro?.id) atualizar('conexoes', params.id, { conectadaPor: ctx.membro.id });

    const resultado = await driver.conectar({ conexao, urlWebhook: urlDoWebhook(conexao) });

    if (resultado.erro) {
      atualizar('conexoes', params.id, { ultimoErro: resultado.erro });
      registrarEvento(conexao, 'erro', `Falha ao abrir a sessao: ${resultado.erro}`);
      emitir(ctx.workspaceId, 'conexao', { conexaoId: params.id });
      return resultado;
    }

    atualizar('conexoes', params.id, {
      estado: resultado.estado === 'conectado' ? 'conectado' : 'desconectado',
      qrCode: resultado.qrCode || null,
      ultimoErro: null,
      ...(resultado.estado === 'conectado' ? { conectadoEm: agora() } : {}),
    });
    registrarEvento(
      conexao,
      'sessao',
      resultado.estado === 'conectado'
        ? 'Sessao ja estava aberta.'
        : 'QR Code gerado, esperando a leitura pelo celular.',
      { tipo: 'membro', id: ctx.membro?.id || null, nome: ctx.usuario?.nome || 'Equipe' },
    );
    emitir(ctx.workspaceId, 'conexao', { conexaoId: params.id });
    return resultado;
  });

  /** Encerra a sessao no celular, sem apagar a configuracao. */
  rotas.post('/api/conexoes/:id/desconectar', async ({ ctx, params }) => {
    exigirConfiguracao(ctx);
    const conexao = achar('conexoes', params.id);
    if (!conexao || conexao.workspaceId !== ctx.workspaceId) throw comCodigo('Conexao nao encontrada.', 404);

    const driver = driverDa(conexao);
    if (!driver.desconectar) throw comCodigo(`O caminho "${driver.nome}" nao tem sessao para encerrar.`, 400);

    const resultado = await driver.desconectar({ conexao });
    atualizar('conexoes', params.id, { estado: 'desconectado', qrCode: null });
    registrarEvento(
      conexao,
      'sessao',
      resultado.erro ? `Falha ao encerrar a sessao: ${resultado.erro}` : 'Sessao encerrada pela equipe.',
      { tipo: 'membro', id: ctx.membro?.id || null, nome: ctx.usuario?.nome || 'Equipe' },
    );
    emitir(ctx.workspaceId, 'conexao', { conexaoId: params.id });
    return resultado;
  });

  /* ---------------- Simulador ---------------- */

  /**
   * Recebe uma mensagem como se tivesse vindo do WhatsApp. E o que permite
   * testar agente, follow-up e funil inteiro antes de existir chip.
   */
  rotas.post('/api/simulador/mensagem', async ({ ctx, corpo }) => {
    /*
     * O CHAT DE TESTE SO FALA POR CONEXAO DE SIMULADOR.
     *
     * A resposta do agente sai pelo driver da conexao usada. Por uma conexao de
     * simulador ela e so gravada; por uma conexao de verdade ela vai para o
     * WhatsApp do numero digitado na tela — e o numero digitado na tela e
     * inventado. A tela antiga listava todas as conexoes e caia na primeira da
     * lista quando nenhuma era escolhida: bastava existir um numero real para
     * o teste mandar mensagem de agente para um desconhecido.
     */
    const doEscritorio = listar('conexoes', { workspaceId: ctx.workspaceId });
    const escolhida = corpo.conexaoId ? doEscritorio.find((c) => c.id === corpo.conexaoId) : null;
    if (corpo.conexaoId && !escolhida) throw comCodigo('Conexao nao encontrada.', 404);
    if (escolhida && escolhida.tipo !== 'simulador') {
      throw comCodigo(
        'O chat de teste so funciona por uma conexao de simulador: por um numero de verdade, a resposta do agente iria para o WhatsApp de alguem.',
        400,
      );
    }
    const conexao = escolhida || doEscritorio.find((c) => c.tipo === 'simulador');
    if (!conexao) throw comCodigo('Crie uma conexao de simulador para usar o chat de teste.', 400);

    /*
     * O numero aqui e DIGITADO, e por isso ganha o 55 como qualquer numero
     * digitado. O funil de recebimento trata o numero como vindo do WhatsApp,
     * sem palpite de pais — e desde que passou a ser assim, o "32 98811-2233"
     * da tela entrava sem o 55, um numero que nao existe.
     */
    const telefone = normalizarTelefone(corpo.telefone);
    if (!telefone) throw comCodigo('Informe o WhatsApp do cliente de teste.', 400);

    /*
     * O agente escolhido na tela.
     *
     * Sem escolha vale a regra do WhatsApp de verdade: o responsavel padrao da
     * conexao, e a palavra-chave da primeira mensagem. Com escolha, ela vence
     * as duas — e esse e o ponto de testar um agente especifico: quem escolheu
     * a Recepcao e escreveu "BPC" nao pode ser desviado para a Triagem BPC.
     */
    let agente = null;
    if (corpo.agenteId) {
      agente = achar('agentes', corpo.agenteId);
      if (!agente || agente.workspaceId !== ctx.workspaceId) throw comCodigo('Agente nao encontrado.', 404);
      if (!agente.ativo) {
        throw comCodigo(`O agente ${agente.nome} esta desligado. Ligue-o em Agentes para testar.`, 400);
      }
    }

    /** Devolve true quando precisou trocar alguma coisa. */
    const passarParaOAgente = (contato) => {
      if (!agente || !contato) return false;
      const jaEle = contato.responsavel?.tipo === 'agente' && contato.responsavel.id === agente.id;
      if (jaEle && contato.estado === 'ia') return false;
      const mudancas = { responsavel: { tipo: 'agente', id: agente.id, nome: agente.nome }, estado: 'ia' };
      atualizar('contatos', contato.id, mudancas);
      Object.assign(contato, mudancas);
      registrarLog(ctx.workspaceId, contato.id, 'responsavel', `Chat de teste: conversa entregue a ${agente.nome}`);
      return true;
    };

    /* ANTES da mensagem: o agente precisa ja estar na conversa quando ela
       chega, senao quem agenda a resposta e o agente padrao da conexao. */
    if (agente) {
      const { contato } = acharOuCriarContato({ workspaceId: ctx.workspaceId, conexao, telefone, nome: corpo.nome || '' });
      passarParaOAgente(contato);
    }

    const resultado = await receberMensagem({
      workspaceId: ctx.workspaceId,
      conexao,
      telefone,
      nome: corpo.nome || '',
      conteudo: corpo.conteudo || '',
      tipo: corpo.tipo || 'texto',
      midia: corpo.midia || null,
      metadados: corpo.metadados || null,
    });

    /* DEPOIS tambem: a palavra-chave da primeira mensagem e o /restart trocam
       o responsavel por conta propria. A resposta le o responsavel na hora em
       que sai, entao recolocar aqui garante QUEM responde.

       Mas nao QUANDO. O relogio ja foi armado pelo agente da palavra-chave,
       com o delay DELE: escolher um agente de 1s e escrever "BPC" fazia a
       resposta esperar os 15s da Triagem BPC, enquanto a tela contava 1s.
       Rearmar com o agente escolhido corrige o prazo. No /restart nao: ali o
       sistema limpa a conversa e ninguem deve responder ao comando. */
    if (passarParaOAgente(resultado.contato) && !resultado.reiniciado) {
      agendarResposta(resultado.contato);
    }

    return {
      ok: true,
      contatoId: resultado.contato.id,
      reiniciado: Boolean(resultado.reiniciado),
      responsavel: resultado.contato.responsavel || null,
    };
  });

  /* ---------------- Login do TikTok ---------------- */

  /**
   * O endereco do login do TikTok para esta conexao.
   *
   * O TikTok so entrega o token da conta comercial depois que alguem entra
   * com ela na pagina dele e autoriza o app; ele devolve o navegador para
   * /tiktok/retorno com um codigo, que vira o token. O `state` amarra a volta
   * a esta conexao e a este pedido — sem ele, qualquer um mandaria um codigo
   * da propria conta para dentro da conexao do escritorio.
   */
  rotas.post('/api/conexoes/:id/tiktok/entrar', async ({ ctx, params }) => {
    exigirConfiguracao(ctx);
    const conexao = achar('conexoes', params.id);
    if (!conexao || conexao.workspaceId !== ctx.workspaceId) throw comCodigo('Conexao nao encontrada.', 404);
    if (conexao.tipo !== 'tiktok') throw comCodigo('Esta conexao nao e do TikTok.', 400);
    if (!ENDERECO_PUBLICO) throw comCodigo('O login do TikTok precisa do sistema hospedado, com endereco publico.', 409);
    if (!conexao.tiktok?.appId) throw comCodigo('Preencha e salve o App ID do app do TikTok antes de entrar.', 400);

    const estadoLogin = crypto.randomBytes(16).toString('hex');
    atualizar('conexoes', conexao.id, { tiktok: { ...conexao.tiktok, estadoLogin, estadoLoginEm: agora() } });
    const url = new URL('https://www.tiktok.com/v2/auth/authorize/');
    url.searchParams.set('client_key', conexao.tiktok.appId);
    url.searchParams.set('response_type', 'code');
    url.searchParams.set('scope', ESCOPOS_TIKTOK.join(','));
    url.searchParams.set('redirect_uri', retornoDoTikTok());
    url.searchParams.set('state', `${conexao.id}.${estadoLogin}`);
    return { url: url.toString() };
  });

  rotas.get('/tiktok/retorno', async ({ res, query }) => {
    const [conexaoId, estadoLogin] = String(query.state || '').split('.');
    const conexao = conexaoId ? achar('conexoes', conexaoId) : null;
    const valido =
      conexao?.tipo === 'tiktok' &&
      estadoLogin &&
      conexao.tiktok?.estadoLogin === estadoLogin &&
      Date.now() - Date.parse(conexao.tiktok.estadoLoginEm || '') < 15 * 60 * 1000;

    let aviso = 'erro';
    if (valido && query.code) {
      try {
        await concluirLoginTikTok(conexao, String(query.code), retornoDoTikTok());
        const atual = achar('conexoes', conexao.id);
        atualizar('conexoes', conexao.id, { tiktok: { ...atual.tiktok, estadoLogin: null, estadoLoginEm: null } });
        const teste = await driverDa(atual).testar({ conexao: achar('conexoes', conexao.id) });
        atualizar('conexoes', conexao.id, {
          estado: teste.ok ? 'conectado' : 'desconectado',
          numero: teste.numero || atual.numero,
          nomeExibicao: teste.nomeExibicao || null,
          conectadoEm: teste.ok ? agora() : null,
          ultimoErro: teste.ok ? null : teste.erro,
        });
        registrarEvento(atual, 'conectado', `Conta do TikTok autorizada${teste.numero ? `: ${teste.numero}` : ''}.`);
        emitir(conexao.workspaceId, 'conexao', { conexaoId: conexao.id });
        aviso = 'ok';
      } catch (erro) {
        if (conexao) registrarEvento(conexao, 'erro', `Login do TikTok falhou: ${erro.message}`);
      }
    }
    /* O aviso vai na busca, e nao dentro do #: a rota da tela e o que vem
       depois do #, e "conexoes?tiktok=ok" seria uma pagina que nao existe. */
    res.writeHead(302, { Location: `/?tiktok=${aviso}#/conexoes` });
    res.end();
    return null;
  }, { publica: true, cru: true });

  /** Cadastra no TikTok o endereco que recebe as DMs (um por app). */
  rotas.post('/api/conexoes/:id/tiktok/webhook', async ({ ctx, params }) => {
    exigirConfiguracao(ctx);
    const conexao = achar('conexoes', params.id);
    if (!conexao || conexao.workspaceId !== ctx.workspaceId) throw comCodigo('Conexao nao encontrada.', 404);
    if (!ENDERECO_PUBLICO) throw comCodigo('O webhook do TikTok precisa do sistema hospedado, com endereco publico.', 409);
    try {
      const resultado = await registrarWebhookTikTok(conexao, `${ENDERECO_PUBLICO}/webhook/tiktok`);
      registrarEvento(conexao, 'webhook', `Webhook cadastrado no TikTok: ${resultado.endereco}`);
      return resultado;
    } catch (erro) {
      throw comCodigo(`O TikTok recusou o webhook: ${erro.message}`, 502);
    }
  });

  /* ---------------- Webhook ---------------- */

  /**
   * Verificacao do endpoint. Hoje so a Meta faz isso, com um GET no momento em
   * que voce salva a URL no painel dela; o driver de QR Code nao implementa e
   * a rota responde 404, que e a verdade: nao ha nada para verificar ali.
   */
  rotas.get('/webhook/:conexaoId', async ({ res, params, query }) => {
    /* O webhook do Instagram e do app, e nao da conexao: vale o token de
       verificacao de qualquer conexao do Instagram. */
    const conexao =
      params.conexaoId === 'instagram'
        ? listar('conexoes').find(
            (c) => c.tipo === 'instagram' && c.instagram?.verifyToken && c.instagram.verifyToken === query['hub.verify_token'],
          )
        : achar('conexoes', params.conexaoId);
    const driver = conexao ? driverDa(conexao) : null;

    if (!driver?.verificarWebhook) {
      res.writeHead(404, { 'Content-Type': 'text/plain' });
      res.end('sem verificacao para este tipo de conexao');
      return null;
    }

    const resultado = driver.verificarWebhook({ conexao, query });
    res.writeHead(resultado.ok ? 200 : 403, { 'Content-Type': 'text/plain' });
    res.end(resultado.resposta);
    return null;
  }, { publica: true, cru: true });

  /**
   * Eventos que chegam do provedor.
   *
   * Cada provedor tem o seu formato, e traduzir e trabalho do driver. Daqui
   * para baixo o codigo so conhece a forma normalizada, entao ligar um provedor
   * novo nao mexe em nada deste bloco.
   */
  rotas.post('/webhook/:conexaoId', async ({ req, res, params, corpoBruto }) => {
    /*
     * Instagram e TikTok chamam UM endereco por app (/webhook/instagram,
     * /webhook/tiktok). A conexao sai da conta que o proprio evento traz; a
     * assinatura e conferida depois, com a chave dela.
     */
    const geral = params.conexaoId === 'instagram' || params.conexaoId === 'tiktok';
    let carga = null;
    if (geral) {
      try {
        carga = JSON.parse(corpoBruto.toString('utf8'));
      } catch {
        carga = null;
      }
    }
    const conexao = geral ? conexaoDoWebhookGeral(params.conexaoId, carga) : achar('conexoes', params.conexaoId);
    if (!conexao) {
      /* Conta que nao e de nenhuma conexao: 200 e nada, senao a rede repete o
         mesmo evento por dias. */
      res.writeHead(geral ? 200 : 404);
      res.end();
      return null;
    }

    const driver = driverDa(conexao);

    if (driver.conferirAssinatura && !driver.conferirAssinatura({ conexao, cabecalhos: req.headers, corpoBruto })) {
      res.writeHead(401);
      res.end();
      return null;
    }

    /* Responde antes de processar: sem um 200 rapido, a Meta reenvia o mesmo
       evento por dias e a Evolution enfileira atras dele. */
    res.writeHead(200);
    res.end();

    if (!driver.interpretarWebhook) return null;

    if (!carga) {
      try {
        carga = JSON.parse(corpoBruto.toString('utf8'));
      } catch {
        return null;
      }
    }

    let eventos;
    try {
      eventos = driver.interpretarWebhook({ conexao, corpo: carga });
    } catch (erro) {
      registrarEvento(conexao, 'erro', `Evento recebido em formato inesperado: ${erro.message}`);
      return null;
    }

    for (const mensagem of eventos.mensagens || []) {
      await receberMensagem({ workspaceId: conexao.workspaceId, conexao, ...mensagem }).catch(() => {});
    }

    for (const situacao of eventos.situacoes || []) {
      atualizarSituacaoExterna(conexao.workspaceId, situacao.idExterno, situacao.situacao, situacao.erro || null);
    }

    /* A agenda do celular: guarda e ja renomeia as conversas que existem. */
    if (eventos.agenda?.length && guardarNaAgenda(conexao, eventos.agenda)) {
      emitir(conexao.workspaceId, 'contatos', {});
    }

    for (const aprovacao of eventos.templates || []) {
      const template = listar('templates', { workspaceId: conexao.workspaceId }).find(
        (t) => t.metaNome === aprovacao.metaNome,
      );
      if (!template) continue;
      atualizar('templates', template.id, {
        aprovacaoMeta: {
          ...(template.aprovacaoMeta || {}),
          situacao: aprovacao.situacao,
          motivo: aprovacao.motivo || null,
        },
      });
    }

    if (eventos.conexao) aplicarEventoDeConexao(conexao, eventos.conexao);

    return null;
  }, { publica: true, cru: true });
}

/**
 * Grava o que o provedor contou sobre o proprio numero: sessao que abriu ou
 * caiu, QR Code novo, qualidade rebaixada.
 *
 * A queda e a mudanca de qualidade viram notificacao para os administradores.
 * Numero caido nao aparece em contagem nenhuma: as mensagens simplesmente param
 * de sair, e sem aviso alguem so descobre quando um cliente liga perguntando.
 */
function aplicarEventoDeConexao(conexao, evento) {
  const mudancas = {};
  if (evento.estado) mudancas.estado = evento.estado;
  if (evento.numero) mudancas.numero = evento.numero;
  if (evento.qualidade !== undefined) mudancas.qualidade = evento.qualidade;
  /* `undefined` significa "nao mexa"; `null` significa "apague o QR que esta
     na tela". Sao coisas diferentes e a distincao importa: sessao aberta
     precisa limpar o codigo, evento de mensagem nao. */
  if (evento.qrCode !== undefined) mudancas.qrCode = evento.qrCode;
  if (evento.estado === 'conectado') {
    mudancas.conectadoEm = agora();
    mudancas.ultimoErro = null;
  }

  /* Outro celular no mesmo lugar: o historico do anterior nao conta mais. */
  if (evento.numero && conexao.numero && evento.numero !== conexao.numero) mudancas.historico = null;

  if (Object.keys(mudancas).length) atualizar('conexoes', conexao.id, mudancas);
  if (evento.evento) registrarEvento(conexao, 'sessao', evento.evento);

  /* Sessao aberta pela primeira vez: armar a vinda das conversas do celular. */
  const atual = achar('conexoes', conexao.id);
  if (evento.estado === 'conectado' && atual?.tipo === 'qrcode' && atual.historico?.situacao !== 'concluido') {
    agendarSincronizacao(atual);
  }

  const precisaAvisar = evento.estado === 'desconectado' || evento.qualidade;
  if (precisaAvisar) {
    for (const membro of listar('membros', { workspaceId: conexao.workspaceId })) {
      if (membro.papel !== 'administrador') continue;
      notificar(
        conexao.workspaceId,
        membro.id,
        'sistema',
        evento.qualidade ? 'Qualidade do numero mudou' : 'Numero desconectado',
        `${conexao.nome}: ${evento.evento || evento.qualidade}`,
      );
    }
  }

  emitir(conexao.workspaceId, 'conexao', { conexaoId: conexao.id });
}
