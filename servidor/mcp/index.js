#!/usr/bin/env node
/**
 * Servidor MCP do Correiatendimentos.
 *
 * Deixa o Claude (Desktop, Code, Cursor) ler e mexer no atendimento do
 * escritorio por conversa: "quantos leads de BPC entraram esta semana",
 * "manda a mensagem de documentos pendentes para a dona Maria".
 *
 * Fala JSON-RPC 2.0 por stdin/stdout, uma mensagem por linha, que e o
 * transporte stdio do MCP. Sem dependencia nenhuma, como o resto do sistema.
 *
 * Conversa com a API publica (/v1) em vez de abrir o banco direto, de
 * proposito: a chave x-company-key ja limita a um workspace, ja tem limite de
 * requisicao e ja registra o ultimo uso. Lendo os arquivos JSON aqui, esta
 * porta entraria por baixo de tudo isso, e um cliente MCP mal configurado
 * enxergaria workspace que nao e dele.
 *
 * Uso:
 *   CORREIA_URL=http://localhost:4477 CORREIA_CHAVE=chk_... node servidor/mcp/index.js
 */

const BASE = (process.env.CORREIA_URL || 'http://localhost:4477').replace(/\/+$/, '');
const CHAVE = process.env.CORREIA_CHAVE || '';

/* A versao do protocolo que sabemos falar. Se o cliente pedir outra, devolvemos
   esta mesma: o MCP manda negociar, e mentir a versao para agradar quebraria na
   primeira chamada que dependesse do que mudou entre elas. */
const PROTOCOLO = '2024-11-05';

/* A API publica aceita 3 chamadas por segundo por workspace. Um cliente MCP
   fazendo cinco perguntas seguidas estoura isso, e o 429 chegaria ao usuario
   como "erro" quando na verdade e so pressa. Uma espera curta e uma segunda
   tentativa resolvem sem que ninguem veja. */
const TENTATIVAS = 3;
const ESPERA_MS = 400;

const dormir = (ms) => new Promise((r) => setTimeout(r, ms));

async function chamarApi(caminho, { metodo = 'GET', corpo = null } = {}) {
  if (!CHAVE) throw new Error('Falta a variavel CORREIA_CHAVE com a chave de API do workspace.');

  let ultimoErro = null;
  for (let tentativa = 0; tentativa < TENTATIVAS; tentativa += 1) {
    let resposta;
    try {
      resposta = await fetch(`${BASE}/v1${caminho}`, {
        method: metodo,
        headers: {
          'x-company-key': CHAVE,
          ...(corpo ? { 'Content-Type': 'application/json' } : {}),
        },
        body: corpo ? JSON.stringify(corpo) : undefined,
      });
    } catch (erro) {
      /* Servidor no ar e servidor fora do ar dao mensagens muito diferentes de
         utilidade. "fetch failed" nao ajuda ninguem; dizer que o programa
         precisa estar aberto, sim. */
      throw new Error(`Nao consegui falar com ${BASE}. O Correiatendimentos esta aberto? (${erro.message})`);
    }

    if (resposta.status === 429 && tentativa < TENTATIVAS - 1) {
      await dormir(ESPERA_MS * (tentativa + 1));
      continue;
    }

    const bruto = await resposta.text();
    let dados = null;
    try {
      dados = bruto ? JSON.parse(bruto) : null;
    } catch {
      dados = { erro: bruto };
    }

    if (!resposta.ok) {
      ultimoErro = new Error(dados?.erro || `Erro ${resposta.status} em ${caminho}`);
      break;
    }
    return dados;
  }
  throw ultimoErro || new Error(`Nao consegui completar ${caminho}.`);
}

/** Monta ?a=1&b=2 pulando o que veio vazio. */
function busca(parametros) {
  const partes = Object.entries(parametros || {}).filter(
    ([, v]) => v !== undefined && v !== null && v !== '',
  );
  return partes.length ? `?${new URLSearchParams(partes)}` : '';
}

const texto = (descricao) => ({ type: 'string', description: descricao });

/*
 * As 14 ferramentas.
 *
 * Cada descricao diz tambem QUANDO usar, e nao so o que faz. O modelo escolhe a
 * ferramenta lendo isso: "lista contatos" faz ele listar tudo e filtrar na
 * cabeca; dizer que da para filtrar por status e por data faz ele filtrar no
 * servidor, que e mais rapido e nao estoura o limite de requisicao.
 */
const FERRAMENTAS = [
  {
    name: 'list_connections',
    description: 'Lista as conexoes de WhatsApp do escritorio, com nome, numero, tipo e se estao ligadas.',
    inputSchema: { type: 'object', properties: {} },
    executar: () => chamarApi('/connections'),
  },
  {
    name: 'get_connection',
    description: 'Detalhes de uma conexao de WhatsApp pelo id.',
    inputSchema: { type: 'object', properties: { id: texto('Id da conexao') }, required: ['id'] },
    executar: (a) => chamarApi(`/connections/${encodeURIComponent(a.id)}`),
  },
  {
    name: 'query_contacts',
    description:
      'Busca conversas do escritorio. Filtre no servidor sempre que puder: por numero, status, departamento, etiqueta ou periodo. Devolve 50 por pagina por padrao.',
    inputSchema: {
      type: 'object',
      properties: {
        number: texto('Telefone, so digitos, com DDI'),
        status: texto('Id do status (use list_status)'),
        department: texto('Id do departamento (use list_departments)'),
        tag: texto('Id da etiqueta (use list_tags)'),
        source: texto('Id da origem (use list_sources)'),
        from: texto('Data inicial, AAAA-MM-DD'),
        to: texto('Data final, AAAA-MM-DD'),
        page: { type: 'number', description: 'Pagina, comeca em 1' },
        limit: { type: 'number', description: 'Quantos por pagina, ate 100' },
      },
    },
    executar: (a) => chamarApi(`/contacts${busca(a)}`),
  },
  {
    name: 'get_contact',
    description: 'Detalhes de uma conversa: nome, telefone, status, departamento, etiquetas e variaveis salvas.',
    inputSchema: { type: 'object', properties: { id: texto('Id do contato') }, required: ['id'] },
    executar: async (a) => {
      /* Nao existe GET /contacts/{id} na API publica, entao a busca vem pela
         listagem. Quando nao acha, a mensagem diz o caminho em vez de so falhar:
         sem isso o modelo repete a mesma chamada ate desistir. */
      const lista = await chamarApi(`/contacts${busca({ limit: 100 })}`);
      const achado = (lista.data || []).find((c) => c.id === a.id);
      if (achado) return achado;
      throw new Error(
        `Nao achei o contato ${a.id} na primeira pagina. Use query_contacts com filtro (number, status) para encontra-lo.`,
      );
    },
  },
  {
    name: 'mark_contact_read',
    description: 'Zera o contador de nao lidas de uma conversa.',
    inputSchema: { type: 'object', properties: { id: texto('Id do contato') }, required: ['id'] },
    executar: (a) => chamarApi(`/contacts/${encodeURIComponent(a.id)}/mark-read`, { metodo: 'POST' }),
  },
  {
    name: 'list_messages',
    description: 'Mensagens de uma conversa, com paginacao.',
    inputSchema: {
      type: 'object',
      properties: {
        contact: texto('Id do contato'),
        page: { type: 'number' },
        limit: { type: 'number', description: 'Ate 100' },
      },
      required: ['contact'],
    },
    executar: (a) => chamarApi(`/message${busca(a)}`),
  },
  {
    name: 'get_message',
    description: 'Detalhes de uma mensagem pelo id, inclusive situacao de entrega e o erro, quando houver.',
    inputSchema: { type: 'object', properties: { id: texto('Id da mensagem') }, required: ['id'] },
    executar: (a) => chamarApi(`/message/${encodeURIComponent(a.id)}`),
  },
  {
    name: 'send_message',
    description:
      'Envia mensagem para um contato. ATENCAO: sai de verdade no WhatsApp do cliente. Confirme com a pessoa antes de usar. Fora da janela de 24h do WhatsApp so passa template.',
    inputSchema: {
      type: 'object',
      properties: {
        contact: texto('Id do contato'),
        number: texto('Ou o telefone, se nao tiver o id'),
        message: texto('O texto a enviar'),
      },
      required: ['message'],
    },
    executar: (a) =>
      chamarApi('/send/message', {
        metodo: 'POST',
        corpo: { contact: a.contact, number: a.number, message: a.message },
      }),
  },
  {
    name: 'list_status',
    description: 'Os status do funil do escritorio, com id e nome. Use antes de filtrar conversa por status.',
    inputSchema: { type: 'object', properties: {} },
    executar: () => chamarApi('/settings/status'),
  },
  {
    name: 'list_sources',
    description: 'As origens de lead cadastradas, com id e nome.',
    inputSchema: { type: 'object', properties: {} },
    executar: () => chamarApi('/settings/source'),
  },
  {
    name: 'list_tags',
    description: 'As etiquetas cadastradas, com id e nome.',
    inputSchema: { type: 'object', properties: {} },
    executar: () => chamarApi('/settings/tags'),
  },
  {
    name: 'list_departments',
    description: 'Os departamentos do escritorio, com id e nome.',
    inputSchema: { type: 'object', properties: {} },
    executar: () => chamarApi('/settings/departamentos'),
  },
  {
    name: 'list_users',
    description: 'As pessoas da equipe, com nome, email e papel.',
    inputSchema: { type: 'object', properties: {} },
    executar: () => chamarApi('/users'),
  },
  {
    name: 'list_agents',
    description: 'Os agentes de IA do escritorio, com modelo, palavras-chave e se estao ligados.',
    inputSchema: { type: 'object', properties: {} },
    executar: () => chamarApi('/agents'),
  },
];

const PELO_NOME = new Map(FERRAMENTAS.map((f) => [f.name, f]));

/* ---------------- Transporte ---------------- */

function responder(id, resultado) {
  process.stdout.write(`${JSON.stringify({ jsonrpc: '2.0', id, result: resultado })}\n`);
}

function responderErro(id, codigo, mensagem) {
  process.stdout.write(`${JSON.stringify({ jsonrpc: '2.0', id, error: { code: codigo, message: mensagem } })}\n`);
}

async function tratar(pedido) {
  const { id, method, params } = pedido;

  /* Notificacao nao tem id e nao pode ser respondida. Responder uma faz o
     cliente reclamar de resposta sem pedido correspondente. */
  const ehNotificacao = id === undefined || id === null;

  switch (method) {
    case 'initialize':
      return responder(id, {
        protocolVersion: PROTOCOLO,
        capabilities: { tools: {} },
        serverInfo: { name: 'correiatendimentos', version: '0.1.0' },
      });

    case 'notifications/initialized':
    case 'initialized':
      return;

    case 'ping':
      return responder(id, {});

    case 'tools/list':
      return responder(id, {
        tools: FERRAMENTAS.map(({ name, description, inputSchema }) => ({ name, description, inputSchema })),
      });

    case 'tools/call': {
      const ferramenta = PELO_NOME.get(params?.name);
      if (!ferramenta) return responderErro(id, -32602, `Ferramenta desconhecida: ${params?.name}`);
      try {
        const saida = await ferramenta.executar(params.arguments || {});
        return responder(id, { content: [{ type: 'text', text: JSON.stringify(saida, null, 2) }] });
      } catch (erro) {
        /* Erro de ferramenta vai como resultado com isError, e nao como erro de
           JSON-RPC: assim o modelo LE a mensagem e corrige a chamada, em vez de
           a conversa inteira parar com uma falha de protocolo. */
        return responder(id, { content: [{ type: 'text', text: erro.message }], isError: true });
      }
    }

    default:
      if (ehNotificacao) return;
      return responderErro(id, -32601, `Metodo nao suportado: ${method}`);
  }
}

let acumulado = '';
process.stdin.setEncoding('utf8');
process.stdin.on('data', (pedaco) => {
  acumulado += pedaco;
  /* Uma mensagem por linha. O pedaco que chega pelo cano pode cortar uma linha
     no meio, entao so as linhas completas sao processadas e o resto fica para
     o proximo pedaco. */
  let quebra;
  while ((quebra = acumulado.indexOf('\n')) >= 0) {
    const linha = acumulado.slice(0, quebra).trim();
    acumulado = acumulado.slice(quebra + 1);
    if (!linha) continue;
    let pedido;
    try {
      pedido = JSON.parse(linha);
    } catch {
      responderErro(null, -32700, 'JSON invalido.');
      continue;
    }
    tratar(pedido).catch((erro) => responderErro(pedido?.id ?? null, -32603, erro.message));
  }
});

process.stdin.on('end', () => process.exit(0));
