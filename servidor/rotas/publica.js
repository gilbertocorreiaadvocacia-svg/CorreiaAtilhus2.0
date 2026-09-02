import crypto from 'node:crypto';
import { achar, atualizar, inserir, listar, mensagensDe } from '../nucleo/banco.js';
import { agora, aplicarVariaveis, normalizarTelefone, novoId } from '../nucleo/util.js';
import { emitir } from '../nucleo/eventos.js';
import { enviarMensagem } from '../whatsapp/envio.js';
import { acharOuCriarContato } from '../whatsapp/recebimento.js';
import { aplicarStatus } from '../automacao/followup.js';
import { comCodigo } from './sessao.js';

/**
 * API publica. Autenticacao por cabecalho x-company-key, uma chave por
 * workspace. Serve para o site do escritorio, para o n8n e para qualquer
 * automacao externa. Limite de 3 requisicoes por segundo por workspace, para
 * uma integracao mal escrita nao derrubar o atendimento.
 */

const JANELA = 1000;
const LIMITE = 3;
const contadores = new Map();

export function autenticarChave(req) {
  const bruta = req.headers['x-company-key'];
  if (!bruta) return null;
  const hash = crypto.createHash('sha256').update(String(bruta)).digest('hex');
  const chave = listar('chavesApi').find((c) => c.hash === hash);
  if (!chave) return null;
  atualizar('chavesApi', chave.id, { ultimoUso: agora() });
  return { workspaceId: chave.workspaceId, chaveId: chave.id };
}

export function dentroDoLimite(workspaceId) {
  const agoraMs = Date.now();
  const atual = contadores.get(workspaceId) || { inicio: agoraMs, total: 0 };
  if (agoraMs - atual.inicio >= JANELA) {
    atual.inicio = agoraMs;
    atual.total = 0;
  }
  atual.total += 1;
  contadores.set(workspaceId, atual);
  return atual.total <= LIMITE;
}

function paraContato(contato) {
  return {
    id: contato.id,
    name: contato.nome,
    number: contato.telefone,
    connection: contato.conexaoId,
    status: contato.statusId,
    department: contato.departamentoId,
    tags: contato.etiquetas || [],
    source: contato.origemId,
    stage: contato.estado === 'arquivado' ? 'Closed' : contato.aceitoPor ? 'Open' : 'Pending',
    unread: contato.naoLidas || 0,
    variables: contato.variaveis || {},
    createdAt: contato.criadoEm,
    updatedAt: contato.ultimaMensagemEm || contato.criadoEm,
  };
}

export function registrarPublica(rotas) {
  const opcoes = { publica: true, chaveApi: true };

  rotas.get('/v1/connections', async ({ api }) =>
    listar('conexoes', { workspaceId: api.workspaceId }).map((c) => ({
      id: c.id,
      name: c.nome,
      number: c.numero,
      type: c.tipo,
      state: c.estado,
    })),
  opcoes);

  rotas.get('/v1/connections/:id', async ({ api, params }) => {
    const conexao = achar('conexoes', params.id);
    if (!conexao || conexao.workspaceId !== api.workspaceId) throw comCodigo('Conexao nao encontrada.', 404);
    return { id: conexao.id, name: conexao.nome, number: conexao.numero, type: conexao.tipo, state: conexao.estado };
  }, opcoes);

  const classes = [
    ['status', 'status', 'statusId'],
    ['source', 'origens', 'origemId'],
    ['tags', 'etiquetas', 'etiquetas'],
    ['departamentos', 'departamentos', 'departamentoId'],
  ];

  for (const [caminho, colecao, campo] of classes) {
    rotas.get(`/v1/settings/${caminho}`, async ({ api }) =>
      listar(colecao, { workspaceId: api.workspaceId }).map((i) => ({ id: i.id, name: i.nome, color: i.cor })),
    opcoes);

    rotas.patch(`/v1/settings/${caminho}`, async ({ api, corpo }) => {
      const contato = achar('contatos', corpo.contact);
      if (!contato || contato.workspaceId !== api.workspaceId) throw comCodigo('Contato nao encontrado.', 404);

      if (campo === 'etiquetas') {
        const novas = corpo.tags || [];
        /* Confere as etiquetas ANTES de gravar qualquer uma. Sem isso, um id
           errado (ou de outro workspace) entrava na lista do contato e ficava
           la: a tela mostrava uma etiqueta sem nome e ninguem sabia de onde
           tinha vindo. */
        for (const id of novas) {
          const etiqueta = achar('etiquetas', id);
          if (!etiqueta || etiqueta.workspaceId !== api.workspaceId) {
            throw comCodigo(`Etiqueta "${id}" nao encontrada.`, 404);
          }
        }
        const finais = corpo.replace ? novas : [...new Set([...(contato.etiquetas || []), ...novas])];
        atualizar('contatos', contato.id, { etiquetas: finais });
        emitir(api.workspaceId, 'contato', { contatoId: contato.id });
        return { ok: true, tags: finais };
      }

      if (caminho === 'status') {
        const status = achar('status', corpo.value || corpo.status);
        if (!status || status.workspaceId !== api.workspaceId) throw comCodigo('Status nao encontrado.', 404);
        /* aplicarStatus ja emite o evento por dentro. */
        await aplicarStatus(contato, status, { tipo: 'api', nome: 'API publica' });
        return { ok: true };
      }

      /* Origem e departamento tambem precisam ser do proprio workspace, e
         precisam existir: gravar um id solto deixava o campo apontando para
         nada, e a conversa some dos filtros sem explicacao. */
      const alvo = corpo.value || corpo[caminho] || corpo.departamento || null;
      if (alvo) {
        const registro = achar(colecao, alvo);
        if (!registro || registro.workspaceId !== api.workspaceId) {
          throw comCodigo('Registro nao encontrado.', 404);
        }
      }
      atualizar('contatos', contato.id, { [campo]: alvo });
      /* Sem este aviso, o lead movido pela integracao so aparecia na tela de
         quem apertasse F5: quem estava com a conversa aberta continuava vendo
         a origem antiga. */
      emitir(api.workspaceId, 'contato', { contatoId: contato.id });
      return { ok: true };
    }, opcoes);
  }

  rotas.get('/v1/users', async ({ api }) =>
    listar('membros', { workspaceId: api.workspaceId }).map((m) => {
      const usuario = achar('usuarios', m.usuarioId);
      return { id: m.id, name: usuario?.nome, email: usuario?.email, role: m.papel };
    }),
  opcoes);

  rotas.get('/v1/agents', async ({ api }) =>
    listar('agentes', { workspaceId: api.workspaceId }).map((a) => ({
      id: a.id,
      name: a.nome,
      model: a.modelo,
      active: a.ativo,
      keywords: a.palavrasChave || [],
    })),
  opcoes);

  rotas.get('/v1/contacts', async ({ api, query }) => {
    let contatos = listar('contatos', { workspaceId: api.workspaceId });
    if (query.number) {
      const numero = normalizarTelefone(query.number);
      contatos = contatos.filter((c) => c.telefone === numero);
    }
    if (query.connection) contatos = contatos.filter((c) => c.conexaoId === query.connection);
    if (query.status) contatos = contatos.filter((c) => c.statusId === query.status);
    if (query.department) contatos = contatos.filter((c) => c.departamentoId === query.department);
    if (query.stage) contatos = contatos.filter((c) => paraContato(c).stage === query.stage);
    if (query.hasUnread === 'true') contatos = contatos.filter((c) => (c.naoLidas || 0) > 0);
    if (query.createdFrom) contatos = contatos.filter((c) => c.criadoEm >= query.createdFrom);
    if (query.createdTo) contatos = contatos.filter((c) => c.criadoEm <= query.createdTo);

    const pagina = Math.max(1, Number(query.page || 1));
    const porPagina = Math.min(100, Number(query.limit || 50));
    const inicio = (pagina - 1) * porPagina;

    return {
      total: contatos.length,
      page: pagina,
      limit: porPagina,
      data: contatos.slice(inicio, inicio + porPagina).map(paraContato),
    };
  }, opcoes);

  rotas.post('/v1/contacts', async ({ api, corpo }) => {
    if (corpo.agent && corpo.user) throw comCodigo('Informe agent OU user, nunca os dois.', 400);
    const conexao = achar('conexoes', corpo.connection) || listar('conexoes', { workspaceId: api.workspaceId })[0];
    if (!conexao) throw comCodigo('Nenhuma conexao cadastrada.', 400);

    const { contato } = acharOuCriarContato({
      workspaceId: api.workspaceId,
      conexao,
      telefone: corpo.number,
      nome: corpo.name || '',
    });

    const mudancas = {};
    if (corpo.agent) {
      const agente = achar('agentes', corpo.agent);
      if (agente) mudancas.responsavel = { tipo: 'agente', id: agente.id, nome: agente.nome };
      mudancas.estado = 'ia';
    }
    if (corpo.user) {
      const membro = achar('membros', corpo.user);
      const usuario = membro ? achar('usuarios', membro.usuarioId) : null;
      if (membro) mudancas.responsavel = { tipo: 'membro', id: membro.id, nome: usuario?.nome };
      mudancas.estado = 'pendente';
    }
    if (Object.keys(mudancas).length) atualizar('contatos', contato.id, mudancas);

    if (corpo.status) {
      const status = achar('status', corpo.status);
      if (status) await aplicarStatus(contato, status, { tipo: 'api', nome: 'API publica' }, { dispararFollowups: false });
    }

    return paraContato(achar('contatos', contato.id));
  }, opcoes);

  rotas.post('/v1/contacts/:id/mark-read', async ({ api, params }) => {
    const contato = achar('contatos', params.id);
    if (!contato || contato.workspaceId !== api.workspaceId) throw comCodigo('Contato nao encontrado.', 404);
    atualizar('contatos', contato.id, { naoLidas: 0 });
    return { ok: true };
  }, opcoes);

  rotas.get('/v1/message', async ({ api, query }) => {
    const contato = achar('contatos', query.contact);
    if (!contato || contato.workspaceId !== api.workspaceId) throw comCodigo('Contato nao encontrado.', 404);
    const limite = Math.min(200, Number(query.limit || 50));
    return { data: mensagensDe(contato.id).slice(-limite) };
  }, opcoes);

  rotas.get('/v1/message/:id', async ({ api, params }) => {
    for (const contato of listar('contatos', { workspaceId: api.workspaceId })) {
      const mensagem = mensagensDe(contato.id).find((m) => m.id === params.id);
      if (mensagem) return mensagem;
    }
    throw comCodigo('Mensagem nao encontrada.', 404);
  }, opcoes);

  rotas.post('/v1/send/message', async ({ api, corpo }) => {
    const contato = achar('contatos', corpo.contact);
    if (!contato || contato.workspaceId !== api.workspaceId) throw comCodigo('Contato nao encontrado.', 404);

    const tipoMapa = { conversation: 'texto', image: 'imagem', video: 'video', audio: 'audio', document: 'documento' };
    const tipo = tipoMapa[corpo.messageType || 'conversation'] || 'texto';
    if (tipo === 'texto' && !corpo.content) throw comCodigo('content e obrigatorio para mensagem de texto.', 400);
    if (tipo !== 'texto' && !corpo.url) throw comCodigo('url e obrigatorio para midia.', 400);

    if (corpo.note) {
      const { inserirNota } = await import('../ia/mencoes.js');
      return inserirNota(contato, corpo.content, { tipo: 'api', nome: 'API publica' });
    }

    if (corpo.scheduledAt) {
      const quando = new Date(corpo.scheduledAt);
      if (Number.isNaN(quando.getTime())) throw comCodigo('scheduledAt invalido.', 400);
      return inserir('agendamentos', {
        id: novoId('agd'),
        workspaceId: api.workspaceId,
        contatoId: contato.id,
        conexaoId: contato.conexaoId,
        tipo: 'manual',
        conteudo: corpo.content || '',
        midia: corpo.url ? { tipo, url: corpo.url } : null,
        quando: quando.toISOString(),
        previstoPara: quando.toISOString(),
        estado: 'pendente',
        criadoPor: { tipo: 'api', nome: 'API publica' },
      });
    }

    return enviarMensagem({
      contato,
      conexao: achar('conexoes', contato.conexaoId),
      tipo,
      conteudo: corpo.content || '',
      midia: corpo.url ? { tipo, url: corpo.url } : null,
      autor: { tipo: 'api', nome: 'API publica' },
    });
  }, opcoes);

  rotas.post('/v1/message/:id/cancel', async ({ api, params }) => {
    const agendamento = achar('agendamentos', params.id);
    if (!agendamento || agendamento.workspaceId !== api.workspaceId) throw comCodigo('Agendamento nao encontrado.', 404);
    if (agendamento.estado !== 'pendente') throw comCodigo('Este agendamento ja saiu da fila.', 409);
    atualizar('agendamentos', params.id, { estado: 'cancelado', motivoCancelamento: 'cancelado pela API' });
    return { ok: true };
  }, opcoes);

  rotas.get('/v1/templates', async ({ api }) =>
    listar('templates', { workspaceId: api.workspaceId }).map((t) => ({
      id: t.id,
      name: t.nome,
      shortcut: t.atalho,
      content: t.conteudo,
      metaName: t.metaNome || null,
      metaStatus: t.aprovacaoMeta?.situacao || 'nao_solicitada',
    })),
  opcoes);

  rotas.get('/v1/templates/:id', async ({ api, params }) => {
    const template = achar('templates', params.id);
    if (!template || template.workspaceId !== api.workspaceId) throw comCodigo('Template nao encontrado.', 404);
    return template;
  }, opcoes);

  rotas.post('/v1/send/template', async ({ api, corpo }) => {
    const contato = achar('contatos', corpo.contact);
    if (!contato || contato.workspaceId !== api.workspaceId) throw comCodigo('Contato nao encontrado.', 404);
    const template = achar('templates', corpo.template);
    if (!template || template.workspaceId !== api.workspaceId) throw comCodigo('Template nao encontrado.', 404);

    const posicionais = {};
    for (const [chave, valor] of Object.entries(corpo)) {
      const casou = /^var(\d+)$/.exec(chave);
      if (casou) posicionais[`var${casou[1]}`] = valor;
    }

    let conteudo = aplicarVariaveis(template.conteudo, {
      nome: contato.nome,
      ...(contato.variaveis || {}),
      ...posicionais,
    });
    Object.entries(posicionais).forEach(([, valor], indice) => {
      conteudo = conteudo.replace(`{{${indice + 1}}}`, valor);
    });

    return enviarMensagem({
      contato,
      conexao: achar('conexoes', contato.conexaoId),
      tipo: template.midia ? template.midia.tipo : 'texto',
      conteudo,
      midia: template.midia,
      templateId: template.id,
      autor: { tipo: 'api', nome: 'API publica' },
    });
  }, opcoes);

}
