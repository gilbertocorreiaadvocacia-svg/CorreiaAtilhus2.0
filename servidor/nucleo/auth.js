import crypto from 'node:crypto';
import path from 'node:path';
import { PASTA_DADOS } from '../config.js';
import { achar, atualizar, inserir, listar, tabela } from './banco.js';
import { agora, conferirSenha, gravarAtomico, hashSenha, lerJson, normalizar, novoId } from './util.js';

const DURACAO_SESSAO = 1000 * 60 * 60 * 24 * 30; // 30 dias
const ARQUIVO_SESSOES = path.join(PASTA_DADOS, 'sessoes.json');

/**
 * As sessoes ficam em disco de proposito. O sistema e aberto e fechado pelo
 * atalho varias vezes por dia; se ficassem so na memoria, todo mundo teria de
 * entrar de novo a cada reinicio, e senha digitada com pressa acaba virando
 * senha anotada em papel colado no monitor.
 */
const SESSOES = new Map(Object.entries(lerJson(ARQUIVO_SESSOES, {})));

/**
 * Grava na hora, sem adiar. Entrar no sistema acontece poucas vezes por dia, e
 * adiar meio segundo significava perder a sessao de quem entrasse pouco antes
 * de o servidor ser fechado, justamente o caso mais irritante.
 */
function gravarSessoes() {
  const validas = {};
  for (const [token, sessao] of SESSOES) {
    if (sessao.expiraEm > Date.now()) validas[token] = sessao;
  }
  try {
    gravarAtomico(ARQUIVO_SESSOES, JSON.stringify(validas));
  } catch {
    // Sem permissao de escrita o sistema continua funcionando; so nao lembra
    // de quem entrou depois de reiniciar.
  }
}

export const PAPEIS = {
  administrador: {
    nome: 'Administrador',
    descricao: 'Acesso total: configuracoes, agentes, membros e conversas de todos os departamentos.',
    nivel: 3,
  },
  gerente: {
    nome: 'Gerente',
    descricao: 'Gerencia conversas e membros dos departamentos autorizados. Nao remove administradores.',
    nivel: 2,
  },
  suporte: {
    nome: 'Suporte',
    descricao: 'Atende apenas os departamentos e conexoes designados. Sem acesso as configuracoes gerais.',
    nivel: 1,
  },
};

export function criarSessao(usuarioId, workspaceId) {
  const token = crypto.randomBytes(32).toString('hex');
  SESSOES.set(token, {
    usuarioId,
    workspaceId,
    criadaEm: Date.now(),
    expiraEm: Date.now() + DURACAO_SESSAO,
  });
  gravarSessoes();
  return token;
}

/**
 * Encerra as outras sessoes do usuario e mantem a de quem esta pedindo.
 *
 * Chamada ao trocar a senha: se alguem entrou na conta, trocar a senha sem
 * derrubar a sessao dele nao resolve nada, porque o cookie continua valendo por
 * trinta dias. Devolve quantas caiu, para a tela poder dizer o que aconteceu.
 */
export function encerrarOutrasSessoes(usuarioId, tokenAtual) {
  let encerradas = 0;
  for (const [token, sessao] of SESSOES) {
    if (sessao.usuarioId === usuarioId && token !== tokenAtual) {
      SESSOES.delete(token);
      encerradas += 1;
    }
  }
  if (encerradas) gravarSessoes();
  return encerradas;
}

/**
 * Sessoes ainda validas do usuario. O token NUNCA sai daqui: quem chama recebe
 * so quando a sessao nasceu e em qual workspace ela esta.
 */
export function sessoesDoUsuario(usuarioId) {
  const agora = Date.now();
  const lista = [];
  for (const [token, sessao] of SESSOES) {
    if (sessao.usuarioId !== usuarioId || sessao.expiraEm <= agora) continue;
    lista.push({
      token,
      criadaEm: sessao.criadaEm ? new Date(sessao.criadaEm).toISOString() : null,
      expiraEm: new Date(sessao.expiraEm).toISOString(),
      workspaceId: sessao.workspaceId,
    });
  }
  return lista.sort((a, b) => String(b.criadaEm).localeCompare(String(a.criadaEm)));
}

export function lerSessao(token) {
  if (!token) return null;
  const sessao = SESSOES.get(token);
  if (!sessao) return null;
  if (sessao.expiraEm < Date.now()) {
    SESSOES.delete(token);
    gravarSessoes();
    return null;
  }
  return sessao;
}

export function trocarWorkspaceDaSessao(token, workspaceId) {
  const sessao = SESSOES.get(token);
  if (sessao) {
    sessao.workspaceId = workspaceId;
    gravarSessoes();
  }
}

export function encerrarSessao(token) {
  SESSOES.delete(token);
  gravarSessoes();
}

/** Tira do disco as sessoes de quem foi removido do workspace ou do sistema. */
export function limparSessoesOrfas() {
  let removidas = 0;
  for (const [token, sessao] of SESSOES) {
    if (!achar('usuarios', sessao.usuarioId)) {
      SESSOES.delete(token);
      removidas += 1;
    }
  }
  if (removidas) gravarSessoes();
  return removidas;
}

export function autenticar(email, senha) {
  const alvo = normalizar(email);
  const usuario = tabela('usuarios').find((u) => normalizar(u.email) === alvo);
  if (!usuario) return null;
  if (!conferirSenha(senha, usuario.senha)) return null;
  atualizar('usuarios', usuario.id, { ultimoAcesso: agora() });
  return usuario;
}

export function criarUsuario({ nome, email, senha, foto = null, whatsapp = null }) {
  return inserir('usuarios', {
    id: novoId('usr'),
    nome,
    email: String(email).trim(),
    senha: hashSenha(senha),
    foto,
    whatsapp,
  });
}

export function membroDe(usuarioId, workspaceId) {
  return achar('membros', { usuarioId, workspaceId });
}

export function workspacesDoUsuario(usuarioId) {
  const membros = listar('membros', { usuarioId });
  return membros
    .map((m) => {
      const ws = achar('workspaces', m.workspaceId);
      return ws ? { ...ws, papel: m.papel, membroId: m.id } : null;
    })
    .filter(Boolean);
}

/** Monta o objeto que acompanha toda requisicao autenticada. */
export function contextoDaSessao(token) {
  const sessao = lerSessao(token);
  if (!sessao) return null;
  const usuario = achar('usuarios', sessao.usuarioId);
  if (!usuario) return null;
  const workspaces = workspacesDoUsuario(usuario.id);
  if (!workspaces.length) return null;

  let workspaceId = sessao.workspaceId;
  if (!workspaces.some((w) => w.id === workspaceId)) workspaceId = workspaces[0].id;

  const membro = membroDe(usuario.id, workspaceId);
  return {
    token,
    usuario,
    usuarioId: usuario.id,
    workspaceId,
    workspace: achar('workspaces', workspaceId),
    membro,
    papel: membro?.papel || 'suporte',
    workspaces,
  };
}

export function ehAdministrador(ctx) {
  return ctx?.papel === 'administrador';
}

export function podeConfigurar(ctx) {
  return ctx?.papel === 'administrador' || ctx?.papel === 'gerente';
}

/**
 * Regras de visibilidade da auditoria:
 * administrador ve tudo; os demais so veem os departamentos e as conexoes
 * autorizados. Duas excecoes sobrepoem qualquer restricao, ser o responsavel
 * pela conversa e ter sido mencionado em nota interna nas ultimas 24 horas.
 */
export function podeVerConversa(ctx, contato) {
  if (!ctx || !contato) return false;
  if (contato.workspaceId !== ctx.workspaceId) return false;
  if (ehAdministrador(ctx)) return true;

  const membro = ctx.membro || {};

  if (contato.responsavel?.tipo === 'membro' && contato.responsavel.id === membro.id) return true;

  const mencao = (contato.mencoesRecentes || []).find((m) => m.membroId === membro.id);
  if (mencao && Date.now() - new Date(mencao.em).getTime() < 1000 * 60 * 60 * 24) return true;

  const departamentos = membro.departamentos || [];
  const conexoes = membro.conexoes || [];

  const departamentoOk =
    departamentos.includes('*') ||
    (contato.departamentoId
      ? departamentos.includes(contato.departamentoId)
      : departamentos.includes('sem-departamento'));

  const conexaoOk = !conexoes.length || conexoes.includes('*') || conexoes.includes(contato.conexaoId);

  return departamentoOk && conexaoOk;
}

export function filtrarConversasVisiveis(ctx, contatos) {
  if (ehAdministrador(ctx)) return contatos;
  return contatos.filter((c) => podeVerConversa(ctx, c));
}

/**
 * A pergunta ao contrario: dada uma conversa, quem da equipe a enxerga.
 *
 * As outras funcoes daqui partem de uma pessoa e filtram conversas. Quem avisa
 * que chegou mensagem precisa do inverso — a conversa ja existe, falta saber a
 * quem contar. Fazer isso na mao no lugar do aviso significaria reescrever as
 * regras de departamento, conexao e mencao ali, e no dia em que uma delas
 * mudasse o aviso continuaria seguindo a regra velha: notificacao vazando para
 * quem nao pode abrir a conversa.
 *
 * O papel mora no membro, e nao no usuario, entao o contexto e montado a
 * partir dele — do mesmo jeito que a sessao monta.
 */
export function membrosQuePodemVer(workspaceId, contato) {
  return listar('membros', { workspaceId }).filter((membro) =>
    podeVerConversa({ workspaceId, papel: membro.papel, membro }, contato),
  );
}

/** Modo foco: o vendedor so enxerga o que e dele. */
export function aplicarModoFoco(ctx, contatos) {
  if (!ctx?.membro?.modoFoco) return contatos;
  return contatos.filter(
    (c) => c.responsavel?.tipo === 'membro' && c.responsavel.id === ctx.membro.id,
  );
}
