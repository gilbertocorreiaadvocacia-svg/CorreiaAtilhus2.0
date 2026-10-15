import http from 'node:http';

/**
 * LiderHub de mentira para o teste do historico completo (fase 2): so as
 * rotas que servidor/integracoes/liderhub.js usa para isso (/v1/connections,
 * /v1/contacts, /v1/message), no formato da API principal (ver
 * docs.liderhub.ai/api-principal-reference).
 *
 * Arquivo separado de liderhub-falsa.js (que atende /settings/* e /contacts
 * sem o prefixo /v1, para o teste da fase 1 — classificacao): as duas fases
 * precisam de dados e rotas diferentes o bastante para nao valer a pena
 * forcar um servidor de mentira so.
 *
 * Paginas pequenas e fixas: o que importa provar e o mapeamento de campos e
 * a idempotencia, nao a paginacao em si (ja coberta pelo teste da fase 1).
 */
export function subirLiderhubHistoricoFalsa({ porta, chave, conexoes, contatosPorConexao, mensagensPorContato, status = [], tags = [], departamentos = [] }) {
  const pedidos = [];

  const servidor = http.createServer(async (req, res) => {
    const url = new URL(req.url, 'http://localhost');
    pedidos.push(url.pathname + url.search);

    const responder = (codigo, dados) => {
      res.writeHead(codigo, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify(dados));
    };

    if (req.headers['x-company-key'] !== chave) return responder(401, { statusCode: 401, message: 'chave invalida' });

    if (url.pathname === '/v1/connections') {
      return responder(200, { connections: conexoes });
    }

    if (url.pathname === '/v1/settings/status') return responder(200, status);
    if (url.pathname === '/v1/settings/tags') return responder(200, tags);
    if (url.pathname === '/v1/settings/departamentos') return responder(200, departamentos);

    if (url.pathname === '/v1/contacts') {
      const conexaoId = url.searchParams.get('connection');
      const todos = contatosPorConexao[conexaoId] || [];
      return responder(200, {
        contacts: todos,
        pagination: { page: 1, limit: 100, total: todos.length, totalPages: 1, hasNextPage: false, hasPreviousPage: false },
      });
    }

    if (url.pathname === '/v1/message') {
      const contatoId = url.searchParams.get('contact');
      const todas = mensagensPorContato[contatoId] || [];
      return responder(200, {
        messages: todas,
        pagination: { page: 1, limit: 100, total: todas.length, totalPages: 1, hasNextPage: false, hasPreviousPage: false },
      });
    }

    return responder(404, { statusCode: 404, message: `rota de mentira sem resposta: ${url.pathname}` });
  });

  return new Promise((resolve) => {
    servidor.listen(porta, '127.0.0.1', () => resolve({ servidor, pedidos }));
  });
}
