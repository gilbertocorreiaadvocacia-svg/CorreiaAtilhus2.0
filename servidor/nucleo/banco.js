import fs from 'node:fs';
import path from 'node:path';
import { PASTA_DADOS, PASTA_MENSAGENS } from '../config.js';
import { agora, garantirPasta, gravarAtomico, lerJson, novoId, ordenarPor } from './util.js';
import { encerrarEspelho, espelhar } from './espelho.js';

/**
 * Banco de arquivos JSON, sem dependencia externa.
 *
 * Tudo o que e pequeno e consultado o tempo todo (contatos, status, agentes)
 * fica em memoria e e gravado com atraso curto, assim uma rajada de alteracoes
 * vira uma unica escrita em disco. As mensagens, que sao o volume real do
 * sistema, ficam em um arquivo por conversa e so sao carregadas quando a
 * conversa e aberta.
 */

const COLECOES = [
  'workspaces',
  'usuarios',
  'membros',
  'conexoes',
  'status',
  'departamentos',
  'etiquetas',
  'origens',
  'variaveis',
  'agentes',
  'conhecimento',
  'templates',
  'contatos',
  'tarefas',
  'agendamentos',
  'contratos',
  'compromissos',
  'logs',
  'notificacoes',
  'creditos',
  'temposResposta',
  'integracoes',
  'vozes',
  'chavesApi',
  'configuracoes',
  /* Os nomes salvos no celular de cada numero conectado (ver whatsapp/agenda.js). */
  'agenda',
  /* Frase de teste x agente esperado, para a bateria de roteamento em
     Agentes (ver automacao/testes-de-roteamento.js). */
  'testesDeRoteamento',
];

const memoria = new Map();
const sujas = new Set();
let temporizador = null;

function caminhoDa(colecao) {
  return path.join(PASTA_DADOS, `${colecao}.json`);
}

export function iniciarBanco() {
  garantirPasta(PASTA_DADOS);
  garantirPasta(PASTA_MENSAGENS);
  for (const colecao of COLECOES) {
    memoria.set(colecao, lerJson(caminhoDa(colecao), []));
  }
}

function marcarSuja(colecao) {
  sujas.add(colecao);
  if (temporizador) return;
  temporizador = setTimeout(() => {
    temporizador = null;
    salvarPendentes();
  }, 250);
  if (typeof temporizador.unref === 'function') temporizador.unref();
}

/*
 * Gravado compacto, sem a indentacao. Cada mudanca regrava a colecao inteira,
 * e de forma sincrona: com o servidor parado esperando. Medido em 26/10/2026
 * ("deixe mais otimizado"): 60 mil registros de logs gravavam em 87 ms
 * indentados e em 49 ms compactos, 17% menores — numa VPS de 1 vCPU, a
 * diferenca entre uma pausa que se sente e uma que nao. O conteudo e o mesmo, e
 * os arquivos antigos, indentados, continuam sendo lidos igual.
 */
export function salvarPendentes() {
  for (const colecao of sujas) {
    gravarAtomico(caminhoDa(colecao), JSON.stringify(memoria.get(colecao) ?? []));
  }
  sujas.clear();
}

export function tabela(colecao) {
  if (!memoria.has(colecao)) memoria.set(colecao, []);
  return memoria.get(colecao);
}

function combina(registro, filtro) {
  return Object.entries(filtro).every(([chave, valor]) => {
    if (valor === undefined) return true;
    if (Array.isArray(valor)) return valor.includes(registro[chave]);
    return registro[chave] === valor;
  });
}

export function listar(colecao, filtro) {
  /* Sem filtro e com filtro nulo querem dizer a mesma coisa aqui: a colecao
     inteira. O padrao de parametro sozinho nao cobria o null. */
  return tabela(colecao).filter((registro) => combina(registro, filtro || {}));
}

/**
 * Acha um registro por id ou por filtro.
 *
 * O TRATAMENTO DO NULO E O PONTO DELICADO desta funcao, e ela ja errou nos
 * dois sentidos:
 *
 * - `achar('status', null)` estourava. O padrao `filtro = {}` so vale para
 *   undefined, entao o null seguia direto para Object.entries e derrubava a
 *   requisicao inteira. Nao era caso raro: statusId, departamentoId e
 *   origemId sao gravados como null quando nao ha valor, e sete das catorze
 *   conversas do escritorio estavam sem departamento — a exportacao de
 *   contatos respondia 500 por causa disso.
 * - `achar('status', undefined)` era pior, e calado: caia no filtro vazio e
 *   devolvia o PRIMEIRO status da tabela. Uma conversa sem status apareceria
 *   exportada como "Nova conversa" sem ninguem desconfiar.
 *
 * Os dois agora respondem a mesma coisa, que e a unica resposta certa: nao ha
 * referencia, entao nao ha registro. Buscar a colecao inteira e trabalho de
 * listar(), e quem quer o primeiro registro pede o primeiro da lista.
 */
export function achar(colecao, filtro) {
  if (typeof filtro === 'string') return filtro ? tabela(colecao).find((r) => r.id === filtro) || null : null;
  if (!filtro) return null;
  return tabela(colecao).find((registro) => combina(registro, filtro)) || null;
}

/* ------------------------------------------------------------------ */
/* Ligar e desligar agente: so por ordem de quem usa o sistema         */
/* ------------------------------------------------------------------ */

/*
 * Pedido do escritorio em 30/10/2026, depois de a IA "ligar sozinha" depois de
 * um "Desligar todos": a IA nunca liga nem desliga sem o usuario mandar.
 *
 * A regra mora AQUI, no banco, e nao em cada rotina que mexe em agente: a
 * correcao de 29/10 tirou o reinicio de dentro de ativarAgentesSemEquipe, mas
 * o proximo codigo que escrevesse `ativo` num agente (um instalador, uma
 * varredura, uma migracao) reabriria o mesmo buraco sem ninguem perceber.
 *
 * Com a protecao ligada (o servidor liga na subida, depois de semear a base
 * nova), o campo `ativo` de um agente so muda quando quem muda esta DENTRO de
 * comOrdemDoUsuario: as rotas em que uma pessoa liga, desliga, cria ou instala
 * agentes (rotas/automacoes.js). Fora delas:
 *   - atualizar() larga so o `ativo`, o resto da mudanca segue;
 *   - inserir() grava o agente DESLIGADO;
 *   - a tentativa fica anotada (log de seguranca, uma vez por agente, e a conta
 *     e as ultimas vao no /api/saude), para saber QUEM tentou.
 * Ferramentas de manutencao e testes, que importam o banco sem ligar a
 * protecao, seguem como sempre.
 */
let estadoDosAgentesProtegido = false;
let ordensDoUsuario = 0;
let totalBarradas = 0;
const ultimasBarradas = [];
const jaAvisadas = new Set();

export function protegerEstadoDosAgentes() {
  estadoDosAgentesProtegido = true;
}

/**
 * Roda `executar` (SINCRONA) como ordem de uma pessoa: dentro dela, ligar e
 * desligar agente vale. Sincrona de proposito: um await no meio devolveria a
 * trava no lugar, que e o lado seguro.
 */
export function comOrdemDoUsuario(executar) {
  ordensDoUsuario += 1;
  try {
    return executar();
  } finally {
    ordensDoUsuario -= 1;
  }
}

/** Para /api/saude: a protecao esta ligada, e o que ela ja barrou desde a subida. */
export function situacaoDaProtecaoDosAgentes() {
  return { ligada: estadoDosAgentesProtegido, barradasDesdeASubida: totalBarradas, ultimas: [...ultimasBarradas] };
}

const estadoBarrado = () => estadoDosAgentesProtegido && ordensDoUsuario === 0;

function anotarBarrada(agente, queriaLigar) {
  totalBarradas += 1;
  /* Quem chamou: a primeira linha da pilha fora deste arquivo, so o nome da funcao e o arquivo. */
  const linha = (new Error().stack || '')
    .split('\n')
    .slice(2)
    .map((l) => l.trim())
    .find((l) => !/nucleo[\\/]banco\.js/.test(l));
  const onde = String(linha || '')
    .replace(/^at\s+/, '')
    .replace(/file:\/\/\/[^)]*?[\\/]servidor[\\/]/, '')
    .replace(/file:\/\/\/(?:[^)\\/]*[\\/])*/, '')
    .replace(/\)$/, '')
    .slice(0, 140);
  ultimasBarradas.push({ em: agora(), queria: queriaLigar ? 'ligar' : 'desligar', onde });
  if (ultimasBarradas.length > 20) ultimasBarradas.shift();
  console.warn(`[protecao] barrei ${queriaLigar ? 'ligar' : 'desligar'} o agente "${agente.nome}" sem ordem do usuario (${onde}).`);

  const chave = `${agente.id || agente.nome}:${queriaLigar}`;
  if (!agente.workspaceId || jaAvisadas.has(chave)) return;
  jaAvisadas.add(chave);
  registrarLog(
    agente.workspaceId,
    null,
    'seguranca',
    `Bloqueei o sistema de ${queriaLigar ? 'ligar' : 'desligar'} sozinho o agente ${agente.nome}: o estado dos agentes so muda quando voce liga ou desliga.`,
    { tipo: 'sistema', nome: 'Protecao dos agentes' },
  );
}

export function inserir(colecao, dados) {
  if (colecao === 'agentes' && dados.ativo !== false && estadoBarrado()) {
    if (dados.ativo === true) anotarBarrada({ workspaceId: dados.workspaceId, nome: dados.nome || 'novo' }, true);
    dados = { ...dados, ativo: false };
  }
  const registro = {
    id: dados.id || novoId(),
    criadoEm: dados.criadoEm || agora(),
    ...dados,
  };
  registro.id = dados.id || registro.id;
  tabela(colecao).push(registro);
  marcarSuja(colecao);
  espelhar(colecao, registro.id, registro);
  return registro;
}

export function atualizar(colecao, id, mudancas) {
  const registro = achar(colecao, id);
  if (!registro) return null;
  if (colecao === 'agentes' && 'ativo' in mudancas && Boolean(mudancas.ativo) !== Boolean(registro.ativo) && estadoBarrado()) {
    anotarBarrada(registro, Boolean(mudancas.ativo));
    const { ativo, ...resto } = mudancas;
    mudancas = resto;
  }
  Object.assign(registro, mudancas, { atualizadoEm: agora() });
  marcarSuja(colecao);
  espelhar(colecao, registro.id, registro);
  return registro;
}

export function remover(colecao, id) {
  const lista = tabela(colecao);
  const indice = lista.findIndex((r) => r.id === id);
  if (indice < 0) return false;
  lista.splice(indice, 1);
  marcarSuja(colecao);
  espelhar(colecao, id, null);
  return true;
}

export function removerOnde(colecao, filtro) {
  const lista = tabela(colecao);
  let removidos = 0;
  for (let i = lista.length - 1; i >= 0; i -= 1) {
    if (combina(lista[i], filtro)) {
      /* O id sai ANTES do splice: depois da remocao o registro nao existe mais
         para consultar, e o espelho ficaria com a linha orfa no Supabase. */
      const { id } = lista[i];
      lista.splice(i, 1);
      espelhar(colecao, id, null);
      removidos += 1;
    }
  }
  if (removidos) marcarSuja(colecao);
  return removidos;
}

/**
 * Reordena os registros de um workspace dentro da colecao, na ordem dos `ids`.
 *
 * A tabela guarda os registros de todos os workspaces na mesma lista, e a
 * ordem dela e a ordem que a tela mostra (o Kanban e a lista de status leem
 * `listar`, que preserva a ordem). Aqui so os registros DESTE workspace mudam
 * de lugar, nas mesmas posicoes que ja ocupavam; os dos outros ficam intactos.
 * Id que nao vier na lista mantem a ordem atual, no fim.
 */
export function reordenar(colecao, workspaceId, ids) {
  const lista = tabela(colecao);
  const posicoes = [];
  const doWorkspace = [];
  lista.forEach((registro, i) => {
    if (registro.workspaceId === workspaceId) {
      posicoes.push(i);
      doWorkspace.push(registro);
    }
  });
  const porId = new Map(doWorkspace.map((r) => [r.id, r]));
  const ordenados = [];
  for (const id of ids) {
    if (porId.has(id)) {
      ordenados.push(porId.get(id));
      porId.delete(id);
    }
  }
  for (const r of doWorkspace) if (porId.has(r.id)) ordenados.push(r);
  posicoes.forEach((pos, k) => {
    lista[pos] = ordenados[k];
  });
  marcarSuja(colecao);
  return ordenados.length;
}

/* ------------------------------------------------------------------ */
/* Mensagens, um arquivo por conversa                                  */
/* ------------------------------------------------------------------ */

const cacheMensagens = new Map();
const mensagensSujas = new Set();
let temporizadorMensagens = null;

function caminhoMensagens(contatoId) {
  return path.join(PASTA_MENSAGENS, `${contatoId}.json`);
}

export function mensagensDe(contatoId) {
  if (!cacheMensagens.has(contatoId)) {
    cacheMensagens.set(contatoId, lerJson(caminhoMensagens(contatoId), []));
  }
  return cacheMensagens.get(contatoId);
}

/* A mesma conversa, sem deixa-la no cache: para olhar centenas de conversas
   uma vez so (ver concluirHistoricoSoDoCelular, em whatsapp/importar-
   historico.js) sem segurar todas na memoria do servidor. */
export function mensagensSemGuardar(contatoId) {
  return cacheMensagens.get(contatoId) ?? lerJson(caminhoMensagens(contatoId), []);
}

/*
 * Quantas mensagens tem a conversa, SEM ler o arquivo se ele ainda nao
 * estiver em memoria. Devolve null nesse caso, em vez de pagar a leitura.
 *
 * Achado em 13/10/2026: a listagem (GET /api/contatos) chama isto para
 * CADA contato do lote (ate 400 de uma vez, ou 1000 na tela Contatos). Logo
 * depois de reiniciar — e o escritorio reiniciou varias vezes num dia so,
 * implantando ajuste atras de ajuste — cada um desses contatos e um
 * cache-miss, e mensagensDe() faz fs.readFileSync + JSON.parse SINCRONO por
 * contato. Um escritorio com conversa de mais de dez mil mensagens (ja visto
 * aqui) transforma a PRIMEIRA listagem apos o boot num laco de centenas de
 * leituras de disco, uma atras da outra, bloqueando o unico event loop do
 * Node — e e o processo inteiro que trava por isso, nao so quem abriu a
 * lista: todo mundo usando o sistema ao mesmo tempo sente.
 *
 * O cache esquenta sozinho (abrir a conversa, mensagem nova chegando,
 * consulta de credito do mes...), entao o numero so demora a aparecer nas
 * conversas que ainda ninguem tocou desde o ultimo reinicio — nunca trava
 * nada para mostrar.
 */
export function totalMensagensEmCache(contatoId) {
  return cacheMensagens.has(contatoId) ? cacheMensagens.get(contatoId).length : null;
}

/*
 * Acha uma mensagem pelo idExterno, so entre conversas que JA estao em
 * memoria — nunca le arquivo do disco. Devolve {contatoId, mensagem} ou
 * null.
 *
 * Achado em 14/10/2026: atualizarSituacaoExterna (whatsapp/recebimento.js)
 * usava isto para achar a mensagem de uma confirmacao de entrega (enviada,
 * entregue, lida), percorrendo TODO contato do escritorio e lendo a
 * conversa do disco ate achar — e a Meta manda varias confirmacoes por
 * mensagem enviada, entao isso disparava o tempo todo, nao so depois de
 * reiniciar como os outros dois casos ja corrigidos.
 *
 * Quase sempre acha aqui: a conversa que MANDOU esta mensagem acabou de
 * passar por inserirMensagem por causa do proprio envio, segundos antes —
 * ja esta cache-quente quando a confirmacao de entrega chega. So cai na
 * busca completa (mais cara) no caso raro de nao achar.
 */
export function buscarMensagemPorIdExternoEmCache(idExterno) {
  for (const [contatoId, mensagens] of cacheMensagens) {
    const mensagem = mensagens.find((m) => m.idExterno === idExterno);
    if (mensagem) return { contatoId, mensagem };
  }
  return null;
}

function marcarMensagensSujas(contatoId) {
  mensagensSujas.add(contatoId);
  if (temporizadorMensagens) return;
  temporizadorMensagens = setTimeout(() => {
    temporizadorMensagens = null;
    salvarMensagensPendentes();
  }, 250);
  if (typeof temporizadorMensagens.unref === 'function') temporizadorMensagens.unref();
}

export function salvarMensagensPendentes() {
  for (const contatoId of mensagensSujas) {
    /* Compacto, pelo mesmo motivo de salvarPendentes, acima. */
    gravarAtomico(caminhoMensagens(contatoId), JSON.stringify(cacheMensagens.get(contatoId) ?? []));
  }
  mensagensSujas.clear();
}

export function inserirMensagem(contatoId, dados) {
  const lista = mensagensDe(contatoId);
  const mensagem = {
    id: dados.id || novoId('msg'),
    contatoId,
    criadoEm: dados.criadoEm || agora(),
    ...dados,
  };
  lista.push(mensagem);
  marcarMensagensSujas(contatoId);
  espelhar('mensagens', mensagem.id, mensagem);
  return mensagem;
}

export function atualizarMensagem(contatoId, id, mudancas) {
  const lista = mensagensDe(contatoId);
  const mensagem = lista.find((m) => m.id === id);
  if (!mensagem) return null;
  Object.assign(mensagem, mudancas);
  marcarMensagensSujas(contatoId);
  espelhar('mensagens', mensagem.id, mensagem);
  return mensagem;
}

export function moverMensagens(deContatoId, paraContatoId) {
  const origem = mensagensDe(deContatoId);
  const destino = mensagensDe(paraContatoId);
  for (const mensagem of origem) {
    const movida = { ...mensagem, contatoId: paraContatoId };
    destino.push(movida);
    /* A mensagem mantem o id ao mudar de dono, entao no Supabase e a MESMA
       linha com contato_id novo. Sem espelhar, a unificacao de conversas ficava
       so no JSON e o espelho apontava para a conversa que deixou de existir. */
    espelhar('mensagens', movida.id, movida);
  }
  destino.sort((a, b) => String(a.criadoEm).localeCompare(String(b.criadoEm)));
  cacheMensagens.set(deContatoId, []);
  marcarMensagensSujas(deContatoId);
  marcarMensagensSujas(paraContatoId);
  return origem.length;
}

export function apagarMensagens(contatoId) {
  /* As linhas do Supabase saem uma a uma: a porta de escrita e por id, e apagar
     por contato exigiria abrir uma segunda operacao la dentro. Excluir conversa
     e raro, entao o lote maior compensa a porta menor. */
  for (const mensagem of mensagensDe(contatoId)) espelhar('mensagens', mensagem.id, null);
  cacheMensagens.delete(contatoId);
  mensagensSujas.delete(contatoId);
  try {
    fs.unlinkSync(caminhoMensagens(contatoId));
  } catch {
    /* nao existia, tudo bem */
  }
}

/* ------------------------------------------------------------------ */

export function registrarLog(workspaceId, contatoId, tipo, descricao, autor = null, dados = null) {
  return inserir('logs', { workspaceId, contatoId, tipo, descricao, autor, dados });
}

export function logsDe(contatoId, limite = 200) {
  return ordenarPor(listar('logs', { contatoId }), 'criadoEm', 'desc').slice(0, limite);
}

export function encerrarBanco() {
  salvarPendentes();
  salvarMensagensPendentes();
  /* Devolve a promessa para quem encerra poder esperar o espelho esvaziar. */
  return encerrarEspelho();
}
