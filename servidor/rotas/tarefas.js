import { achar, atualizar, inserir, listar, registrarLog, remover, removerOnde } from '../nucleo/banco.js';
import { ehAdministrador, podeConfigurar, podeVerConversa } from '../nucleo/auth.js';
import { emitir } from '../nucleo/eventos.js';
import { agora, normalizar, novoId, ordenarPor } from '../nucleo/util.js';
import { notificar } from '../ia/mencoes.js';
import { comCodigo } from './sessao.js';

/**
 * Tarefas do escritorio.
 *
 * Toda tarefa nasce colada em uma conversa, porque na pratica nao existe
 * "juntar documento" solto, existe "juntar o documento do fulano". E por isso
 * que a visibilidade da tarefa segue a visibilidade da conversa: quem nao pode
 * abrir o atendimento tambem nao ve a tarefa que fala dele.
 *
 * A pontuacao usa a escala de Fibonacci de proposito. Numero corrido leva a
 * discussao para "isso e 6 ou 7?", que nao muda nada; com os saltos a escolha
 * vira grande ou pequena, que e a unica coisa que importa na hora de dividir o
 * dia entre as pessoas.
 */

/** Pontos de Fibonacci, o mesmo conjunto que a tela oferece. */
export const PONTOS = [1, 2, 3, 5, 8, 13, 21];

export const SITUACOES = ['aberta', 'em_andamento', 'concluida', 'cancelada'];

/** As duas situacoes que ainda pesam na fila de alguem. */
const EM_ABERTO = ['aberta', 'em_andamento'];

const UMA_SEMANA = 1000 * 60 * 60 * 24 * 7;

/* ------------------------------------------------------------------ */
/* Apoio                                                               */
/* ------------------------------------------------------------------ */

function autorDe(ctx) {
  return { tipo: 'membro', id: ctx.membro?.id || null, nome: ctx.usuario.nome };
}

function membroResumido(membroId) {
  if (!membroId) return null;
  const membro = achar('membros', membroId);
  if (!membro) return null;
  const usuario = achar('usuarios', membro.usuarioId);
  return { id: membro.id, nome: usuario?.nome || 'Membro removido' };
}

/** Vencida e a tarefa que ainda esta na fila e ja passou do prazo. */
function estaVencida(tarefa) {
  if (!tarefa.prazo) return false;
  if (!EM_ABERTO.includes(tarefa.situacao)) return false;
  const limite = new Date(tarefa.prazo).getTime();
  return !Number.isNaN(limite) && limite < Date.now();
}

/**
 * Indice id -> contato do workspace, montado uma vez por requisicao.
 *
 * A listagem passa por tres lugares que precisam do contato de cada tarefa: a
 * visibilidade, o filtro de busca e o enriquecimento da linha. Com um achar em
 * cada um deles, e o achar sendo varredura linear, trinta mil contatos e duas
 * mil tarefas viravam dezenas de milhoes de comparacoes por requisicao, e como
 * o Node e uma thread so, o webhook do WhatsApp ficava esperando na fila.
 */
function indiceDeContatos(ctx) {
  return new Map(listar('contatos', { workspaceId: ctx.workspaceId }).map((c) => [c.id, c]));
}

/** Contato da tarefa pelo indice quando ele existe; senao, pela busca de sempre. */
function contatoDaTarefa(tarefa, contatos) {
  if (!tarefa.contatoId) return null;
  if (contatos) return contatos.get(tarefa.contatoId) || null;
  return achar('contatos', tarefa.contatoId);
}

function enriquecer(tarefa, contatos = null) {
  const contato = contatoDaTarefa(tarefa, contatos);
  return {
    ...tarefa,
    contato: contato ? { id: contato.id, nome: contato.nome } : null,
    responsavel: membroResumido(tarefa.responsavelId),
    vencida: estaVencida(tarefa),
  };
}

/**
 * Quem enxerga a tarefa. Responsavel e criador sempre enxergam a propria
 * tarefa; os demais passam pela mesma regra da conversa. Se a conversa ja foi
 * excluida, sobra so essa dupla, para nao vazar o nome de um cliente que a
 * pessoa nunca teve permissao de ver.
 */
function podeVerTarefa(ctx, tarefa, contatos = null) {
  if (!tarefa || tarefa.workspaceId !== ctx.workspaceId) return false;
  if (ehAdministrador(ctx)) return true;

  const membroId = ctx.membro?.id || null;
  if (membroId && tarefa.responsavelId === membroId) return true;
  if (membroId && tarefa.criadoPor?.id === membroId) return true;
  if (!tarefa.contatoId) return true;

  const contato = contatoDaTarefa(tarefa, contatos);
  if (!contato) return false;
  return podeVerConversa(ctx, contato);
}

function tarefaOu404(ctx, id) {
  const tarefa = achar('tarefas', id);
  if (!tarefa || tarefa.workspaceId !== ctx.workspaceId) throw comCodigo('Tarefa nao encontrada.', 404);
  if (!podeVerTarefa(ctx, tarefa)) throw comCodigo('Voce nao tem acesso a esta tarefa.', 403);
  return tarefa;
}

function exigirTexto(valor, mensagem) {
  const texto = String(valor ?? '').trim();
  if (!texto) throw comCodigo(mensagem, 400);
  return texto;
}

function conferirPontos(valor) {
  const pontos = Number(valor);
  if (!PONTOS.includes(pontos)) {
    throw comCodigo(`Pontuacao invalida. Use uma destas: ${PONTOS.join(', ')}.`, 400);
  }
  return pontos;
}

function conferirPrazo(valor) {
  const data = new Date(valor);
  if (!valor || Number.isNaN(data.getTime())) throw comCodigo('Informe um prazo valido.', 400);
  return data.toISOString();
}

function conferirSituacao(valor) {
  if (!SITUACOES.includes(valor)) {
    throw comCodigo(`Situacao invalida. Use uma destas: ${SITUACOES.join(', ')}.`, 400);
  }
  return valor;
}

function conferirConversa(ctx, contatoId) {
  if (!contatoId) throw comCodigo('Escolha a conversa a que a tarefa se refere.', 400);
  const contato = achar('contatos', contatoId);
  if (!contato || contato.workspaceId !== ctx.workspaceId) throw comCodigo('Conversa nao encontrada.', 404);
  if (!podeVerConversa(ctx, contato)) throw comCodigo('Voce nao tem acesso a esta conversa.', 403);
  return contato;
}

function conferirResponsavel(ctx, responsavelId) {
  if (!responsavelId) throw comCodigo('Escolha o responsavel pela tarefa.', 400);
  const membro = achar('membros', responsavelId);
  if (!membro || membro.workspaceId !== ctx.workspaceId) throw comCodigo('Responsavel nao encontrado.', 404);
  return membro;
}

function prazoLegivel(iso) {
  const data = new Date(iso);
  return Number.isNaN(data.getTime()) ? 'sem prazo' : data.toLocaleString('pt-BR');
}

/** Avisa o responsavel, menos quando ele mesmo criou ou pegou a tarefa. */
function avisarResponsavel(ctx, tarefa, titulo) {
  if (!tarefa.responsavelId || tarefa.responsavelId === ctx.membro?.id) return;
  const contato = tarefa.contatoId ? achar('contatos', tarefa.contatoId) : null;
  const deQuem = contato ? ` (${contato.nome})` : '';
  notificar(
    ctx.workspaceId,
    tarefa.responsavelId,
    'tarefa',
    titulo,
    `${ctx.usuario.nome}: "${tarefa.titulo}"${deQuem}. Prazo ${prazoLegivel(tarefa.prazo)}.`,
    tarefa.contatoId || null,
  );
}

/* ------------------------------------------------------------------ */
/* Rotas                                                               */
/* ------------------------------------------------------------------ */

export function registrarTarefas(rotas) {
  /**
   * Contadores do topo da tela. Fica antes da listagem so por organizacao, o
   * roteador casa caminho exato e nao existe rota GET /api/tarefas/:id.
   */
  rotas.get('/api/tarefas/resumo', async ({ ctx }) => {
    const contatos = indiceDeContatos(ctx);
    const tarefas = listar('tarefas', { workspaceId: ctx.workspaceId }).filter((t) =>
      podeVerTarefa(ctx, t, contatos),
    );
    const abertas = tarefas.filter((t) => EM_ABERTO.includes(t.situacao));
    const inicioDaSemana = new Date(Date.now() - UMA_SEMANA).toISOString();

    return {
      abertas: abertas.length,
      vencidas: abertas.filter(estaVencida).length,
      concluidasNaSemana: tarefas.filter(
        (t) => t.situacao === 'concluida' && t.concluidaEm && t.concluidaEm >= inicioDaSemana,
      ).length,
      pontosAbertos: abertas.reduce((soma, t) => soma + (Number(t.pontos) || 0), 0),
    };
  });

  rotas.get('/api/tarefas', async ({ ctx, query }) => {
    const contatos = indiceDeContatos(ctx);
    let tarefas = listar('tarefas', { workspaceId: ctx.workspaceId }).filter((t) =>
      podeVerTarefa(ctx, t, contatos),
    );

    if (query.situacao && query.situacao !== 'todas') {
      const alvo = query.situacao === 'abertas' ? EM_ABERTO : [query.situacao];
      tarefas = tarefas.filter((t) => alvo.includes(t.situacao));
    }
    if (query.responsavel) {
      tarefas = tarefas.filter((t) =>
        query.responsavel === 'nenhum' ? !t.responsavelId : t.responsavelId === query.responsavel,
      );
    }
    if (query.contato) tarefas = tarefas.filter((t) => t.contatoId === query.contato);
    if (query.vencidas === 'true') tarefas = tarefas.filter(estaVencida);

    if (query.busca) {
      const alvo = normalizar(query.busca);
      tarefas = tarefas.filter((t) => {
        const contato = contatoDaTarefa(t, contatos);
        return (
          normalizar(t.titulo).includes(alvo) ||
          normalizar(t.descricao || '').includes(alvo) ||
          normalizar(contato?.nome || '').includes(alvo)
        );
      });
    }

    // Por prazo e o padrao porque a pergunta do dia e sempre "o que vence
    // primeiro", nunca "o que eu cadastrei por ultimo".
    const ordenar = query.ordenar || 'prazo';
    let ordenadas;
    if (ordenar === 'criacao') ordenadas = ordenarPor(tarefas, 'criadoEm', 'desc');
    else if (ordenar === 'pontos') ordenadas = ordenarPor(tarefas, 'pontos', 'desc');
    else ordenadas = ordenarPor(tarefas, 'prazo', 'asc');

    const total = ordenadas.length;
    const porPagina = Math.min(Math.max(Number(query.porPagina) || 20, 1), 100);
    const paginas = Math.max(1, Math.ceil(total / porPagina));
    const pagina = Math.min(Math.max(Number(query.pagina) || 1, 1), paginas);
    const inicio = (pagina - 1) * porPagina;

    return {
      total,
      pagina,
      porPagina,
      paginas,
      tarefas: ordenadas.slice(inicio, inicio + porPagina).map((t) => enriquecer(t, contatos)),
    };
  });

  rotas.post('/api/tarefas', async ({ ctx, corpo }) => {
    const titulo = exigirTexto(corpo.titulo, 'A tarefa precisa de um titulo.');
    const contato = conferirConversa(ctx, corpo.contatoId);
    const responsavel = conferirResponsavel(ctx, corpo.responsavelId);
    const prazo = conferirPrazo(corpo.prazo);
    const pontos = conferirPontos(corpo.pontos);
    const situacao = SITUACOES.includes(corpo.situacao) ? corpo.situacao : 'aberta';
    const autor = autorDe(ctx);

    const tarefa = inserir('tarefas', {
      id: novoId('trf'),
      workspaceId: ctx.workspaceId,
      titulo,
      descricao: String(corpo.descricao || '').trim(),
      pontos,
      contatoId: contato.id,
      responsavelId: responsavel.id,
      criadoPor: autor,
      prazo,
      situacao,
      // O formulario oferece as quatro situacoes, entao a tarefa pode nascer
      // concluida, que e o caso de registrar o que ja foi feito. Sem o carimbo
      // ela nao entra em abertas nem em concluidas na semana e some dos
      // contadores do topo. Mesma regra do PATCH.
      concluidaEm: situacao === 'concluida' ? agora() : null,
      atualizadoEm: agora(),
    });

    registrarLog(ctx.workspaceId, contato.id, 'tarefa', `Tarefa criada: ${titulo}`, autor, {
      tarefaId: tarefa.id,
      pontos,
      prazo,
    });
    avisarResponsavel(ctx, tarefa, 'Nova tarefa para voce');
    emitir(ctx.workspaceId, 'tarefas', { tarefaId: tarefa.id });

    return enriquecer(tarefa);
  });

  rotas.patch('/api/tarefas/:id', async ({ ctx, params, corpo }) => {
    const tarefa = tarefaOu404(ctx, params.id);

    /*
     * Editar nao pode ser mais liberado que excluir. Quem enxerga a tarefa
     * enxerga porque ve a conversa; mexer nela e outra coisa, e fica com o
     * administrador, com quem criou e com quem responde por ela.
     */
    const membroId = ctx.membro?.id || null;
    const criou = Boolean(membroId) && tarefa.criadoPor?.id === membroId;
    const responde = Boolean(membroId) && tarefa.responsavelId === membroId;
    if (!ehAdministrador(ctx) && !criou && !responde) {
      throw comCodigo('Somente o administrador, quem criou ou o responsavel pode editar a tarefa.', 403);
    }

    const mudancas = {};

    if (corpo.titulo !== undefined) mudancas.titulo = exigirTexto(corpo.titulo, 'A tarefa precisa de um titulo.');
    if (corpo.descricao !== undefined) mudancas.descricao = String(corpo.descricao || '').trim();
    if (corpo.pontos !== undefined) mudancas.pontos = conferirPontos(corpo.pontos);
    if (corpo.prazo !== undefined) mudancas.prazo = conferirPrazo(corpo.prazo);
    if (corpo.contatoId !== undefined) mudancas.contatoId = conferirConversa(ctx, corpo.contatoId).id;

    /*
     * Passar a tarefa para outra pessoa e decisao de quem organiza a fila. O
     * aviso so vai para o novo responsavel: quem perdeu a tarefa nao recebe
     * nada, entao um atendente nao tira do colega sem ninguem ficar sabendo.
     */
    if (corpo.responsavelId !== undefined) {
      const novoResponsavel = conferirResponsavel(ctx, corpo.responsavelId).id;
      if (novoResponsavel !== tarefa.responsavelId && !podeConfigurar(ctx) && !criou) {
        throw comCodigo('Somente o administrador, o gerente ou quem criou a tarefa pode trocar o responsavel.', 403);
      }
      mudancas.responsavelId = novoResponsavel;
    }

    if (corpo.situacao !== undefined) {
      mudancas.situacao = conferirSituacao(corpo.situacao);
      // Concluir carimba a data; reabrir limpa o carimbo, senao a tarefa que
      // voltou para a fila continuaria contando no resumo da semana.
      mudancas.concluidaEm = mudancas.situacao === 'concluida' ? tarefa.concluidaEm || agora() : null;
    }

    const concluiuAgora = mudancas.situacao === 'concluida' && tarefa.situacao !== 'concluida';
    const trocouResponsavel =
      mudancas.responsavelId !== undefined && mudancas.responsavelId !== tarefa.responsavelId;

    const atualizada = atualizar('tarefas', tarefa.id, mudancas);

    if (concluiuAgora && atualizada.contatoId) {
      registrarLog(
        ctx.workspaceId,
        atualizada.contatoId,
        'tarefa',
        `Tarefa concluida: ${atualizada.titulo}`,
        autorDe(ctx),
        { tarefaId: atualizada.id, pontos: atualizada.pontos },
      );
    }
    if (trocouResponsavel) avisarResponsavel(ctx, atualizada, 'Tarefa passada para voce');
    emitir(ctx.workspaceId, 'tarefas', { tarefaId: atualizada.id });

    return enriquecer(atualizada);
  });

  rotas.delete('/api/tarefas/:id', async ({ ctx, params }) => {
    const tarefa = tarefaOu404(ctx, params.id);
    const criou = Boolean(ctx.membro?.id) && tarefa.criadoPor?.id === ctx.membro.id;
    if (!ehAdministrador(ctx) && !criou) {
      throw comCodigo('Somente o administrador ou quem criou a tarefa pode excluir.', 403);
    }
    remover('tarefas', tarefa.id);
    emitir(ctx.workspaceId, 'tarefas', { tarefaId: tarefa.id });
    return { ok: true };
  });
}

/* ------------------------------------------------------------------ */

/**
 * Apaga as tarefas de uma conversa que deixou de existir.
 *
 * A exclusao definitiva de conversa, em DELETE /api/contatos/:id de
 * servidor/rotas/atendimento.js, ja chama esta funcao junto com os outros
 * removerOnde. Quem criar outro caminho de exclusao de conversa precisa chamar
 * aqui tambem, senao a tarefa fica orfa apontando para uma conversa que nao
 * existe mais.
 */
export function removerTarefasDoContato(contatoId) {
  return removerOnde('tarefas', { contatoId });
}
