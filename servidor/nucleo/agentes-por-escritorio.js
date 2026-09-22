import path from 'node:path';
import { PASTA_DADOS, areaValida } from '../config.js';
import { ESCRITORIO_GERAL, PACOTES, prepararEscritorio } from '../ia/pacotes.js';
import { achar, atualizar, inserir, listar, remover } from './banco.js';
import { gravarAtomico, normalizar, novoId } from './util.js';
import { criarWorkspacesPorArea } from './workspaces-por-area.js';

/**
 * Agentes nos escritorios: o construtor do agente, a instalacao dos pacotes e
 * a separacao de cada area no seu escritorio.
 *
 * Mora no nucleo, e nao na rota, porque tem duas portas: a tela de Agentes
 * (rotas/automacoes.js) e a ferramenta de linha de comando
 * (ferramentas/agentes-por-escritorio.js), que roda com o servidor parado.
 */

/** A pasta padrao, quando ninguem escolheu nenhuma. */
export const PASTA_PADRAO = 'Meus Agentes';

/**
 * A forma de um agente novo, num lugar so.
 *
 * Havia TRES lugares criando agente com listas de campos diferentes: a
 * semente, o POST /api/agentes e o POST /api/agentes/gerar. O terceiro ja
 * nascia sem vozId e sem modoAudio, e o defeito era mudo: o agente gerado
 * por IA aparecia normal na lista, e so quem fosse escolher a voz dele
 * descobria que o campo se comportava diferente do dos outros.
 *
 * Com um construtor so, acrescentar campo ao agente e mexer aqui — e o
 * agente gerado por IA nasce igual ao criado a mao. A semente continua
 * separada de proposito: ela roda uma vez, com prompts proprios, e nao pode
 * depender de uma rota.
 */
export function novoAgente(workspaceId, dados = {}) {
  return {
    id: novoId('agn'),
    workspaceId,
    nome: dados.nome || 'Novo agente',
    objetivo: dados.objetivo || 'atender',
    prompt: dados.prompt || '',
    palavrasChave: dados.palavrasChave || [],
    modelo: dados.modelo || 'claude-sonnet-5',
    delaySegundos: dados.delaySegundos ?? 15,
    conhecimentoIds: dados.conhecimentoIds || [],
    vozId: null,
    modoAudio: false,
    pasta: dados.pasta || PASTA_PADRAO,
    area: areaValida(dados.area),
    requisitos: dados.requisitos || [],
    /*
     * A foto e uma URL de /midia, guardada pelo mesmo upload que ja recebe
     * video de proposta e audio. Nasce vazia: sem ela o avatar() do sistema
     * desenha as iniciais, que e o que a tela ja mostrava antes de existir
     * foto nenhuma.
     */
    foto: dados.foto || null,
    ativo: dados.ativo !== false,
  };
}

/* Os agentes que vao sair, inteiros, num arquivo em PASTA_DADOS/copias-de-agentes
   (e nao numa colecao nova: o espelho da nuvem so conhece as colecoes do banco). */
export function guardarCopia(workspaceId, agentes, motivo) {
  if (!agentes.length) return null;
  const nome = `agentes-${workspaceId}-${new Date().toISOString().replace(/[:.]/g, '-')}.json`;
  gravarAtomico(
    path.join(PASTA_DADOS, 'copias-de-agentes', nome),
    JSON.stringify({ workspaceId, motivo, copiadoEm: new Date().toISOString(), agentes }, null, 2),
  );
  return nome;
}

/**
 * Tudo o que apontava para um dos agentes que vao sair passa para `para` (o
 * agente que recebe a conversa) ou fica sem ninguem (null): conversa, numero,
 * desistencia do follow-up e pos-assinatura da ZapSign.
 */
export function reatribuir(workspaceId, ids, para) {
  const conta = { conversas: 0, numeros: 0 };
  if (!ids.size) return conta;
  const eraDeQuemSai = (quem) => quem?.tipo === 'agente' && ids.has(quem.id);

  for (const contato of listar('contatos', { workspaceId })) {
    if (!eraDeQuemSai(contato.responsavel)) continue;
    atualizar(
      'contatos',
      contato.id,
      para ? { responsavel: para } : { responsavel: null, estado: contato.estado === 'ia' ? 'pendente' : contato.estado },
    );
    conta.conversas += 1;
  }
  for (const numero of listar('conexoes', { workspaceId })) {
    if (!eraDeQuemSai(numero.responsavelPadrao)) continue;
    atualizar('conexoes', numero.id, { responsavelPadrao: para });
    conta.numeros += 1;
  }
  for (const registro of listar('status', { workspaceId })) {
    if (!(registro.followups || []).some((passo) => eraDeQuemSai(passo.desistir?.responsavel))) continue;
    atualizar('status', registro.id, {
      followups: registro.followups.map((passo) =>
        eraDeQuemSai(passo.desistir?.responsavel) ? { ...passo, desistir: { ...passo.desistir, responsavel: para } } : passo,
      ),
    });
  }
  const integracoes = achar('integracoes', { workspaceId });
  if (eraDeQuemSai(integracoes?.zapsign?.posAssinatura?.responsavel)) {
    atualizar('integracoes', integracoes.id, {
      zapsign: { ...integracoes.zapsign, posAssinatura: { ...integracoes.zapsign.posAssinatura, responsavel: para } },
    });
  }
  return conta;
}

/**
 * Instala um pacote num escritorio. Antes dos agentes, cria o que os prompts
 * citam pelo nome e o escritorio nao tem (etiquetas, departamentos, templates e
 * variaveis; ver prepararEscritorio em ia/pacotes.js).
 *
 * Agente do pacote que ja existe (pelo nome) fica, com o prompt que o
 * escritorio afinou.
 *
 * Com `substituir`, os agentes que NAO sao do pacote saem, com copia, e tudo o
 * que apontava para eles passa para o primeiro agente do pacote, o que recebe a
 * conversa. Com `ligar`, os agentes do pacote ficam ligados, na area e na pasta
 * do pacote. Com `conexao`, o numero passa a ser da area e o primeiro agente
 * responde por ele.
 */
export function instalarPacote({ workspaceId, area = null, pacote = PACOTES[area], substituir = false, ligar = false, conexao = null }) {
  const doPacote = new Set(pacote.agentes.map((a) => normalizar(a.nome)));
  const saem = substituir ? listar('agentes', { workspaceId }).filter((a) => !doPacote.has(normalizar(a.nome))) : [];
  const copia = guardarCopia(workspaceId, saem, `fora do pacote ${pacote.nome}`);

  const criadosNoEscritorio = prepararEscritorio(workspaceId, pacote);
  const bases = listar('conhecimento', { workspaceId })
    .filter((base) => (pacote.bases || []).some((pedaco) => normalizar(base.nome).includes(pedaco)))
    .map((base) => base.id);

  const criados = [];
  const mantidos = [];
  for (const dados of pacote.agentes) {
    const pasta = dados.pasta || pacote.pasta;
    const existente = listar('agentes', { workspaceId }).find((a) => normalizar(a.nome) === normalizar(dados.nome));
    if (existente) {
      if (ligar) atualizar('agentes', existente.id, { ativo: dados.ativo !== false, area: areaValida(area), pasta });
      mantidos.push({ id: existente.id, nome: existente.nome });
      continue;
    }
    const agente = inserir('agentes', novoAgente(workspaceId, { ...dados, area, pasta, conhecimentoIds: bases }));
    criados.push({ id: agente.id, nome: agente.nome });
  }

  const entrada = listar('agentes', { workspaceId }).find((a) => normalizar(a.nome) === normalizar(pacote.agentes[0].nome));
  const paraEntrada = { tipo: 'agente', id: entrada.id, nome: entrada.nome };
  const reatribuidos = reatribuir(workspaceId, new Set(saem.map((a) => a.id)), paraEntrada);
  for (const agente of saem) remover('agentes', agente.id);
  if (conexao) atualizar('conexoes', conexao.id, { area, responsavelPadrao: paraEntrada });

  return {
    criados,
    mantidos,
    removidos: saem.map((a) => ({ id: a.id, nome: a.nome })),
    copia,
    reatribuidos,
    criadosNoEscritorio,
    variaveisCriadas: criadosNoEscritorio.variaveis,
  };
}

/**
 * O agente de avaliacao do atendimento em todo escritorio que ainda nao o
 * recebeu (pedido de 16/09). Roda na subida do servidor, e UMA vez por
 * escritorio: se o escritorio apagar o agente depois, ele nao volta sozinho.
 */
export function garantirAvaliacaoNosEscritorios() {
  let instalados = 0;
  for (const workspace of listar('workspaces')) {
    if (workspace.avaliacaoInstaladaEm) continue;
    const pacote = workspace.area ? PACOTES[workspace.area] : ESCRITORIO_GERAL;
    const modelo = pacote?.agentes.find((a) => a.objetivo === 'avaliar');
    const jaTem = listar('agentes', { workspaceId: workspace.id }).some((a) => a.objetivo === 'avaliar');
    if (modelo && !jaTem) {
      prepararEscritorio(workspace.id, { templates: ['avaliacao'] });
      inserir('agentes', novoAgente(workspace.id, { ...modelo, area: workspace.area || null }));
      instalados += 1;
    }
    atualizar('workspaces', workspace.id, { avaliacaoInstaladaEm: new Date().toISOString() });
  }
  return instalados;
}

/**
 * Cada numero de area atendido pelo agente de entrada da area.
 *
 * Separar por escritorio punha os agentes ligados em cada area, e os numeros
 * de WhatsApp da area ficavam SEM responsavel padrao. Os agentes estavam
 * ligados e ninguem entregava conversa a eles: o cliente escrevia e a conversa
 * caia em Pendentes, esperando uma pessoa (achado na auditoria de 22/09).
 *
 * So mexe em numero sem responsavel: numero que alguem ja apontou para uma
 * pessoa ou outro agente fica como esta. O simulador (Chat de teste) nao entra,
 * porque la quem escolhe o agente e a tela. O que muda vai antes para
 * PASTA_DADOS/copias-de-agentes.
 */
export function ligarNumerosDasAreas() {
  const ligados = [];
  for (const workspace of listar('workspaces')) {
    const pacote = workspace.area ? PACOTES[workspace.area] : null;
    if (!pacote) continue;
    const entrada = listar('agentes', { workspaceId: workspace.id }).find(
      (a) => a.ativo && normalizar(a.nome) === normalizar(pacote.agentes[0].nome),
    );
    if (!entrada) continue;
    const semResponsavel = listar('conexoes', { workspaceId: workspace.id }).filter(
      (c) => c.tipo !== 'simulador' && !c.responsavelPadrao?.id,
    );
    if (!semResponsavel.length) continue;
    const nome = `numeros-${workspace.id}-${new Date().toISOString().replace(/[:.]/g, '-')}.json`;
    gravarAtomico(
      path.join(PASTA_DADOS, 'copias-de-agentes', nome),
      JSON.stringify({ workspaceId: workspace.id, motivo: 'numeros ligados ao agente de entrada', copiadoEm: new Date().toISOString(), conexoes: semResponsavel }, null, 2),
    );
    for (const conexao of semResponsavel) {
      atualizar('conexoes', conexao.id, {
        area: conexao.area || workspace.area,
        responsavelPadrao: { tipo: 'agente', id: entrada.id, nome: entrada.nome },
      });
      ligados.push({ escritorio: workspace.nome, numero: conexao.nome, tipo: conexao.tipo, agente: entrada.nome, copia: nome });
    }
  }
  return ligados;
}

/**
 * Cada area no seu escritorio: os agentes do Previdenciario no escritorio
 * Previdenciario, os do Trabalhista no Trabalhista.
 *
 * Roda a partir do escritorio geral (o sem area). Cria os escritorios que
 * faltam (nucleo/workspaces-por-area.js), deixa em cada um so os agentes do
 * pacote da area, ligados, e tira do escritorio geral os agentes desses
 * pacotes. Com `apagarOutros`, sai tambem o resto dos agentes do geral, e o que
 * estava com eles fica sem agente. No geral fica o que e dele (ESCRITORIO_GERAL:
 * o Agente 26, desligado). Tudo o que sai vai antes para copias-de-agentes.
 */
export function separarPorEscritorio({ origemId, apagarOutros = false }) {
  const origem = achar('workspaces', origemId);
  if (!origem) throw Object.assign(new Error('Escritorio de origem nao encontrado.'), { codigo: 404 });
  if (origem.area) throw Object.assign(new Error('Separe a partir do escritorio geral, o que nao tem area.'), { codigo: 409 });

  const escritorios = [];
  const nomesQueMudam = new Set();
  for (const alvo of criarWorkspacesPorArea({ baseWorkspaceId: origemId })) {
    if (!PACOTES[alvo.area]) continue;
    for (const agente of PACOTES[alvo.area].agentes) nomesQueMudam.add(normalizar(agente.nome));
    const resultado = instalarPacote({ workspaceId: alvo.workspaceId, area: alvo.area, substituir: true, ligar: true });
    escritorios.push({
      area: alvo.area,
      nome: alvo.nome,
      workspaceId: alvo.workspaceId,
      criadoAgora: alvo.situacao === 'criado',
      agentes: resultado.criados.length + resultado.mantidos.length,
      removidos: resultado.removidos.length,
      copia: resultado.copia,
    });
  }

  const doGeral = new Set(ESCRITORIO_GERAL.agentes.map((a) => normalizar(a.nome)));
  const saem = listar('agentes', { workspaceId: origemId }).filter(
    (agente) => !doGeral.has(normalizar(agente.nome)) && (apagarOutros || nomesQueMudam.has(normalizar(agente.nome))),
  );
  const copia = guardarCopia(origemId, saem, 'separados por escritorio');
  const reatribuidos = reatribuir(origemId, new Set(saem.map((a) => a.id)), null);
  for (const agente of saem) remover('agentes', agente.id);

  const geral = instalarPacote({ workspaceId: origemId, pacote: ESCRITORIO_GERAL, ligar: true });
  /* Os agentes ligados precisam de quem lhes entregue conversa. */
  const numerosLigados = ligarNumerosDasAreas();

  return {
    escritorios,
    removidosDaqui: saem.map((a) => ({ id: a.id, nome: a.nome })),
    copia,
    reatribuidos,
    ficamNoGeral: geral.criados.length + geral.mantidos.length,
    numerosLigados,
  };
}
