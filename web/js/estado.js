import { api } from './api.js';

/**
 * Estado compartilhado da tela. As classes da conversa (status, etiquetas,
 * departamentos, agentes...) sao lidas uma vez e ficam em memoria, sao usadas
 * em quase todo componente e mudam pouco.
 */

export const estado = {
  sessao: null,
  status: [],
  departamentos: [],
  etiquetas: [],
  origens: [],
  variaveis: [],
  templates: [],
  agentes: [],
  conexoes: [],
  membros: [],
  conhecimento: [],
  notificacoes: [],
};

const ouvintes = new Map();

export function ouvir(evento, funcao) {
  if (!ouvintes.has(evento)) ouvintes.set(evento, new Set());
  ouvintes.get(evento).add(funcao);
  return () => ouvintes.get(evento).delete(funcao);
}

export function disparar(evento, dados) {
  for (const funcao of ouvintes.get(evento) || []) {
    try {
      funcao(dados);
    } catch (erro) {
      console.error('[ouvinte]', evento, erro);
    }
  }
}

export async function carregarSessao() {
  estado.sessao = await api.get('/api/sessao/eu');
  return estado.sessao;
}

export async function carregarBasico() {
  const [status, departamentos, etiquetas, origens, variaveis, templates, agentes, conexoes, membros, conhecimento] =
    await Promise.all([
      api.get('/api/status'),
      api.get('/api/departamentos'),
      api.get('/api/etiquetas'),
      api.get('/api/origens'),
      api.get('/api/variaveis'),
      api.get('/api/templates'),
      api.get('/api/agentes'),
      api.get('/api/conexoes'),
      api.get('/api/membros'),
      api.get('/api/conhecimento'),
    ]);

  Object.assign(estado, {
    status,
    departamentos,
    etiquetas,
    origens,
    variaveis,
    templates,
    agentes,
    conexoes,
    membros,
    conhecimento,
  });
  disparar('basico', estado);
}

export async function recarregar(chave) {
  const caminhos = {
    status: '/api/status',
    departamentos: '/api/departamentos',
    etiquetas: '/api/etiquetas',
    origens: '/api/origens',
    variaveis: '/api/variaveis',
    templates: '/api/templates',
    agentes: '/api/agentes',
    conexoes: '/api/conexoes',
    membros: '/api/membros',
    conhecimento: '/api/conhecimento',
  };
  estado[chave] = await api.get(caminhos[chave]);
  disparar('basico', estado);
  return estado[chave];
}

export async function carregarNotificacoes() {
  estado.notificacoes = await api.get('/api/notificacoes');
  disparar('notificacoes', estado.notificacoes);
  return estado.notificacoes;
}

/* Atalhos de consulta ------------------------------------------------ */

/* So os dois que as telas realmente chamam. Os atalhos de status,
   departamento, agente, membro e template estavam exportados sem nenhum
   importador: onde o dado e preciso, a tela faz o proprio find. Meia lista
   viva e meia morta so faz o proximo leitor achar que existe um padrao. */
export const acharEtiqueta = (id) => estado.etiquetas.find((e) => e.id === id) || null;
export const acharConexao = (id) => estado.conexoes.find((c) => c.id === id) || null;

/** Lista de responsaveis possiveis: agentes de IA e pessoas da equipe. */
export function opcoesResponsavel() {
  return [
    { valor: '', rotulo: 'Sem responsavel' },
    ...estado.agentes.map((a) => ({ valor: `agente:${a.id}`, rotulo: `IA · ${a.nome}` })),
    ...estado.membros.map((m) => ({ valor: `membro:${m.id}`, rotulo: `Equipe · ${m.usuario?.nome || 'membro'}` })),
  ];
}

export function podeConfigurar() {
  return ['administrador', 'gerente'].includes(estado.sessao?.papel);
}

/* Tempo real --------------------------------------------------------- */

let fonte = null;

export function conectarEventos() {
  if (fonte) fonte.close();
  fonte = new EventSource('/api/eventos');

  // Todo nome emitido pelo servidor precisa estar nesta lista, senao o pacote
  // chega no EventSource e e descartado em silencio. Foi o que acontecia com
  // 'tarefas': quem criava ou concluia uma tarefa via a mudanca so na propria
  // aba, e a do colega seguia com a lista e os contadores velhos.
  for (const evento of [
    'mensagem',
    'contato',
    'contatos',
    'agendamento',
    'conexao',
    'contrato',
    'digitando',
    'mensagem-situacao',
    'tarefas',
  ]) {
    fonte.addEventListener(evento, (pacote) => {
      let dados = {};
      try {
        dados = JSON.parse(pacote.data);
      } catch {
        /* ignora pacote quebrado */
      }
      disparar(evento, dados);
    });
  }

  fonte.addEventListener('notificacao', (pacote) => {
    try {
      const dados = JSON.parse(pacote.data);
      estado.notificacoes.unshift(dados.notificacao);
      disparar('notificacoes', estado.notificacoes);
    } catch {
      /* ignora */
    }
  });

  fonte.onerror = () => {
    // O proprio EventSource reconecta; so evitamos vazar conexao antiga.
  };
}

/**
 * Sem escolha guardada, devolve null: o CSS entao segue o tema do sistema
 * operacional. Quem trabalha o dia todo em sala clara nao deveria receber uma
 * tela preta so porque a marca do escritorio e preta.
 */
export function tema() {
  return localStorage.getItem('correiatendimentos:tema') || null;
}

export function definirTema(novo) {
  localStorage.setItem('correiatendimentos:tema', novo);
  document.documentElement.dataset.tema = novo;
}
