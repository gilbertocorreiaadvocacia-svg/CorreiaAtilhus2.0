import crypto from 'node:crypto';
import { PORTA } from '../config.js';
import { achar, atualizar, inserir, listar, registrarLog, remover } from '../nucleo/banco.js';
import { emitir } from '../nucleo/eventos.js';
import { agora, novoId, ordenarPor } from '../nucleo/util.js';
import { receberMensagem, atualizarSituacaoExterna } from '../whatsapp/recebimento.js';
import { driverDa, listarDrivers } from '../whatsapp/drivers/index.js';
import { notificar } from '../ia/mencoes.js';
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
  return {
    ...conexao,
    ordem: Number.isFinite(conexao.ordem) ? conexao.ordem : Number.MAX_SAFE_INTEGER,
    oficial: conexao.oficial ? { ...conexao.oficial, token: conexao.oficial.token ? '***' : '' } : null,
    qrcode: conexao.qrcode ? { ...conexao.qrcode, chave: conexao.qrcode.chave ? '***' : '' } : null,
    webhookUrl: `/webhook/${conexao.id}`,
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
      oficial: {
        phoneNumberId: '',
        wabaId: '',
        token: '',
        verifyToken: crypto.randomBytes(16).toString('hex'),
        appSecret: '',
      },
      qrcode: {
        servidor: '',
        chave: '',
        /* Uma instancia por numero, com o nome ja preenchido: o id da conexao
           e unico e nao muda, e obrigar alguem a inventar um nome so cria a
           chance de duas conexoes apontarem para a mesma sessao. */
        instancia: id,
        urlWebhook: '',
      },
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

  rotas.delete('/api/conexoes/:id', async ({ ctx, params }) => {
    exigirConfiguracao(ctx);
    const conexao = achar('conexoes', params.id);
    if (!conexao || conexao.workspaceId !== ctx.workspaceId) throw comCodigo('Conexao nao encontrada.', 404);
    const emUso = listar('contatos', { workspaceId: ctx.workspaceId }).some((c) => c.conexaoId === params.id);
    if (emUso) throw comCodigo('Ha conversas nesta conexao. Migre-as para outro numero antes de excluir.', 409);
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
    const conexao = achar('conexoes', params.id);
    if (!conexao || conexao.workspaceId !== ctx.workspaceId) throw comCodigo('Conexao nao encontrada.', 404);

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
    }

    return resultado;
  });

  /**
   * Abre a sessao. So existe no caminho por QR Code: a Cloud API nao tem sessao
   * para abrir, ela ja nasce ligada quando as credenciais estao certas.
   */
  rotas.post('/api/conexoes/:id/conectar', async ({ ctx, params }) => {
    exigirConfiguracao(ctx);
    const conexao = achar('conexoes', params.id);
    if (!conexao || conexao.workspaceId !== ctx.workspaceId) throw comCodigo('Conexao nao encontrada.', 404);

    const driver = driverDa(conexao);
    if (!driver.conectar) {
      throw comCodigo(`O caminho "${driver.nome}" nao abre sessao. Use Testar conexao.`, 400);
    }

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
    const conexao = achar('conexoes', corpo.conexaoId) || listar('conexoes', { workspaceId: ctx.workspaceId })[0];
    if (!conexao) throw comCodigo('Cadastre uma conexao antes de simular.', 400);

    const resultado = await receberMensagem({
      workspaceId: ctx.workspaceId,
      conexao,
      telefone: corpo.telefone,
      nome: corpo.nome || '',
      conteudo: corpo.conteudo || '',
      tipo: corpo.tipo || 'texto',
      midia: corpo.midia || null,
      metadados: corpo.metadados || null,
    });

    return {
      ok: true,
      contatoId: resultado.contato.id,
      reiniciado: Boolean(resultado.reiniciado),
    };
  });

  /* ---------------- Webhook ---------------- */

  /**
   * Verificacao do endpoint. Hoje so a Meta faz isso, com um GET no momento em
   * que voce salva a URL no painel dela; o driver de QR Code nao implementa e
   * a rota responde 404, que e a verdade: nao ha nada para verificar ali.
   */
  rotas.get('/webhook/:conexaoId', async ({ res, params, query }) => {
    const conexao = achar('conexoes', params.conexaoId);
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
    const conexao = achar('conexoes', params.conexaoId);
    if (!conexao) {
      res.writeHead(404);
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

    let carga;
    try {
      carga = JSON.parse(corpoBruto.toString('utf8'));
    } catch {
      return null;
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

  if (Object.keys(mudancas).length) atualizar('conexoes', conexao.id, mudancas);
  if (evento.evento) registrarEvento(conexao, 'sessao', evento.evento);

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
