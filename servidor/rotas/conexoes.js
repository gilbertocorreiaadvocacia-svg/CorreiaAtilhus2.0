import crypto from 'node:crypto';
import { achar, atualizar, inserir, listar, registrarLog, remover } from '../nucleo/banco.js';
import { emitir } from '../nucleo/eventos.js';
import { agora, novoId, ordenarPor } from '../nucleo/util.js';
import { receberMensagem, atualizarSituacaoExterna } from '../whatsapp/recebimento.js';
import { notificar } from '../ia/mencoes.js';
import { comCodigo, exigirConfiguracao } from './sessao.js';

const GRAPH = 'https://graph.facebook.com/v21.0';

function extrairTexto(mensagem) {
  switch (mensagem.type) {
    case 'text':
      return { tipo: 'texto', conteudo: mensagem.text?.body || '' };
    case 'button':
      return { tipo: 'texto', conteudo: mensagem.button?.text || '' };
    case 'interactive':
      return {
        tipo: 'texto',
        conteudo:
          mensagem.interactive?.button_reply?.title || mensagem.interactive?.list_reply?.title || '',
      };
    case 'image':
      return { tipo: 'imagem', conteudo: mensagem.image?.caption || '', midia: { tipo: 'imagem', id: mensagem.image?.id } };
    case 'video':
      return { tipo: 'video', conteudo: mensagem.video?.caption || '', midia: { tipo: 'video', id: mensagem.video?.id } };
    case 'audio':
      return { tipo: 'audio', conteudo: '', midia: { tipo: 'audio', id: mensagem.audio?.id } };
    case 'document':
      return {
        tipo: 'documento',
        conteudo: mensagem.document?.caption || '',
        midia: { tipo: 'documento', id: mensagem.document?.id, nome: mensagem.document?.filename },
      };
    case 'location':
      return {
        tipo: 'texto',
        conteudo: `Localizacao: ${mensagem.location?.latitude}, ${mensagem.location?.longitude}`,
      };
    default:
      return { tipo: 'texto', conteudo: `[mensagem do tipo ${mensagem.type} recebida]` };
  }
}

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

export function registrarConexoes(rotas) {
  /*
   * A ordem e escolhida na tela e vale para todo mundo, por isso mora no
   * registro e nao no navegador de quem arrastou. Conexao criada antes de
   * existir o campo cai no fim da fila em vez de sumir da lista, e a data de
   * criacao desempata para a ordem nunca oscilar entre dois carregamentos.
   */
  rotas.get('/api/conexoes', async ({ ctx }) => {
    const lista = listar('conexoes', { workspaceId: ctx.workspaceId }).map((conexao) => ({
      ...conexao,
      ordem: Number.isFinite(conexao.ordem) ? conexao.ordem : Number.MAX_SAFE_INTEGER,
      oficial: conexao.oficial ? { ...conexao.oficial, token: conexao.oficial.token ? '***' : '' } : null,
      webhookUrl: conexao.tipo === 'oficial' ? `/webhook/${conexao.id}` : null,
    }));
    return ordenarPor(lista, 'ordem').sort(
      (a, b) => a.ordem - b.ordem || String(a.criadoEm).localeCompare(String(b.criadoEm)),
    );
  });

  rotas.post('/api/conexoes', async ({ ctx, corpo }) => {
    exigirConfiguracao(ctx);
    const existentes = listar('conexoes', { workspaceId: ctx.workspaceId });
    const conexao = inserir('conexoes', {
      id: novoId('cnx'),
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
    });
    registrarEvento(conexao, 'criada', `Conexao criada em modo ${conexao.tipo}.`, {
      tipo: 'membro',
      id: ctx.membro?.id || null,
      nome: ctx.usuario?.nome || 'Equipe',
    });
    return conexao;
  });

  rotas.patch('/api/conexoes/:id', async ({ ctx, params, corpo }) => {
    exigirConfiguracao(ctx);
    const conexao = achar('conexoes', params.id);
    if (!conexao || conexao.workspaceId !== ctx.workspaceId) throw comCodigo('Conexao nao encontrada.', 404);

    if (corpo.oficial) {
      corpo.oficial = {
        ...conexao.oficial,
        ...corpo.oficial,
        // Campo mascarado na leitura: so troca quando vem valor novo de verdade.
        token: corpo.oficial.token && corpo.oficial.token !== '***' ? corpo.oficial.token : conexao.oficial?.token || '',
      };
    }
    const atualizada = atualizar('conexoes', params.id, corpo);
    emitir(ctx.workspaceId, 'conexao', { conexaoId: params.id });
    return { ...atualizada, oficial: { ...atualizada.oficial, token: atualizada.oficial?.token ? '***' : '' } };
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

  /** Confere se as credenciais da Cloud API respondem. */
  rotas.post('/api/conexoes/:id/testar', async ({ ctx, params }) => {
    const conexao = achar('conexoes', params.id);
    if (!conexao || conexao.workspaceId !== ctx.workspaceId) throw comCodigo('Conexao nao encontrada.', 404);
    if (conexao.tipo !== 'oficial') return { ok: true, tipo: 'simulador', mensagem: 'Modo simulador ativo.' };

    const { phoneNumberId, token } = conexao.oficial || {};
    if (!phoneNumberId || !token) {
      atualizar('conexoes', params.id, { estado: 'desconectado' });
      registrarEvento(conexao, 'teste', 'Teste sem o ID do numero ou o token de acesso.');
      return { ok: false, erro: 'Preencha o ID do numero e o token de acesso.' };
    }
    try {
      const resposta = await fetch(`${GRAPH}/${phoneNumberId}?fields=display_phone_number,quality_rating,verified_name`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      const dados = await resposta.json().catch(() => ({}));
      if (!resposta.ok) {
        const motivo = dados?.error?.message || `Graph API ${resposta.status}`;
        atualizar('conexoes', params.id, { estado: 'desconectado', ultimoErro: motivo });
        registrarEvento(conexao, 'desconectado', `A Meta recusou o teste: ${motivo}`);
        return { ok: false, erro: motivo };
      }
      atualizar('conexoes', params.id, {
        estado: 'conectado',
        numero: dados.display_phone_number || conexao.numero,
        qualidade: dados.quality_rating || null,
        nomeExibicao: dados.verified_name || null,
        conectadoEm: agora(),
        ultimoErro: null,
      });
      registrarEvento(
        conexao,
        'conectado',
        `Numero respondeu: ${dados.display_phone_number || conexao.numero}${dados.quality_rating ? ` (qualidade ${dados.quality_rating})` : ''}.`,
      );
      emitir(ctx.workspaceId, 'conexao', { conexaoId: params.id });
      return { ok: true, numero: dados.display_phone_number, qualidade: dados.quality_rating };
    } catch (erro) {
      return { ok: false, erro: erro.message };
    }
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

  /* ---------------- Webhook da Meta ---------------- */

  /** Verificacao do endpoint (a Meta faz um GET quando voce salva a URL). */
  rotas.get('/webhook/:conexaoId', async ({ res, params, query }) => {
    const conexao = achar('conexoes', params.conexaoId);
    const esperado = conexao?.oficial?.verifyToken;
    if (query['hub.mode'] === 'subscribe' && esperado && query['hub.verify_token'] === esperado) {
      res.writeHead(200, { 'Content-Type': 'text/plain' });
      res.end(String(query['hub.challenge'] || ''));
      return null;
    }
    res.writeHead(403, { 'Content-Type': 'text/plain' });
    res.end('token de verificacao invalido');
    return null;
  }, { publica: true, cru: true });

  /** Eventos: mensagens recebidas, status de entrega e alteracao de template. */
  rotas.post('/webhook/:conexaoId', async ({ req, res, params, corpoBruto }) => {
    const conexao = achar('conexoes', params.conexaoId);
    if (!conexao) {
      res.writeHead(404);
      res.end();
      return null;
    }

    const segredo = conexao.oficial?.appSecret;
    if (segredo) {
      const assinatura = req.headers['x-hub-signature-256'];
      const esperada = `sha256=${crypto.createHmac('sha256', segredo).update(corpoBruto).digest('hex')}`;
      const a = Buffer.from(String(assinatura || ''));
      const b = Buffer.from(esperada);
      if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) {
        res.writeHead(401);
        res.end();
        return null;
      }
    }

    // Responde antes de processar: sem 200 rapido, a Meta reenvia por dias.
    res.writeHead(200);
    res.end();

    let carga;
    try {
      carga = JSON.parse(corpoBruto.toString('utf8'));
    } catch {
      return null;
    }

    for (const entrada of carga.entry || []) {
      for (const alteracao of entrada.changes || []) {
        const valor = alteracao.value || {};

        for (const mensagem of valor.messages || []) {
          const perfil = valor.contacts?.find((c) => c.wa_id === mensagem.from);
          const extraido = extrairTexto(mensagem);
          const contexto = mensagem.referral || {};
          await receberMensagem({
            workspaceId: conexao.workspaceId,
            conexao,
            telefone: mensagem.from,
            nome: perfil?.profile?.name || '',
            idExterno: mensagem.id,
            tipo: extraido.tipo,
            conteudo: extraido.conteudo,
            midia: extraido.midia || null,
            metadados: contexto.ctwa_clid
              ? {
                  ctwaClid: contexto.ctwa_clid,
                  title: contexto.headline || null,
                  mediaURL: contexto.media_url || null,
                  sourceID: contexto.source_id || null,
                  sourceApp: contexto.source_type === 'ad' ? 'facebook' : contexto.source_type || null,
                  sourceURL: contexto.source_url || null,
                  sourceType: contexto.source_type || null,
                  clickToWhatsappCall: true,
                }
              : null,
          }).catch(() => {});
        }

        for (const situacao of valor.statuses || []) {
          const mapa = { sent: 'enviada', delivered: 'entregue', read: 'lida', failed: 'erro' };
          atualizarSituacaoExterna(
            conexao.workspaceId,
            situacao.id,
            mapa[situacao.status] || situacao.status,
            situacao.errors?.[0] ? { mensagem: situacao.errors[0].title, codigo: String(situacao.errors[0].code) } : null,
          );
        }

        if (alteracao.field === 'message_template_status_update') {
          const template = listar('templates', { workspaceId: conexao.workspaceId }).find(
            (t) => t.metaNome === valor.message_template_name,
          );
          if (template) {
            const mapa = { APPROVED: 'aprovado', REJECTED: 'reprovado', PAUSED: 'pausado', PENDING: 'em_analise' };
            atualizar('templates', template.id, {
              aprovacaoMeta: {
                ...(template.aprovacaoMeta || {}),
                situacao: mapa[valor.event] || String(valor.event || '').toLowerCase(),
                motivo: valor.reason || null,
              },
            });
          }
        }

        if (alteracao.field === 'phone_number_quality_update') {
          atualizar('conexoes', conexao.id, { qualidade: valor.current_limit || valor.event || null });
          registrarEvento(conexao, 'qualidade', `A Meta mudou a qualidade do numero para ${valor.event}.`);
          for (const membro of listar('membros', { workspaceId: conexao.workspaceId })) {
            if (membro.papel === 'administrador') {
              notificar(conexao.workspaceId, membro.id, 'sistema', 'Qualidade do numero mudou', `${conexao.nome}: ${valor.event}`);
            }
          }
        }
      }
    }
    return null;
  }, { publica: true, cru: true });
}
