import crypto from 'node:crypto';
import http from 'node:http';

/**
 * Atilhus Juri de mentira: a edge `receber-contrato-assinado`, com as mesmas
 * regras de porta (assinatura HMAC de "<carimbo>.<corpo>", carimbo de 5
 * minutos) e a mesma idempotencia pelo token do documento.
 *
 * Rotas de teste, com prefixo __ :
 *   POST /__modo       { status } responde 500, 422... ate mandar 200 de novo
 *   GET  /__recebidos  os pacotes aceitos, na ordem
 */
export function subirJuriFalso(porta, segredo) {
  const recebidos = [];
  const casos = new Map();
  let modo = 200;
  let contador = 0;

  const json = (res, status, dados) => {
    res.writeHead(status, { 'content-type': 'application/json' });
    res.end(JSON.stringify(dados));
  };

  const servidor = http.createServer(async (req, res) => {
    const url = new URL(req.url, 'http://local');
    const pedacos = [];
    for await (const p of req) pedacos.push(p);
    const bruto = Buffer.concat(pedacos).toString('utf8');

    if (url.pathname === '/__recebidos') return json(res, 200, recebidos);
    if (url.pathname === '/__modo') {
      modo = Number(JSON.parse(bruto || '{}').status) || 200;
      return json(res, 200, { ok: true, modo });
    }
    if (url.pathname !== '/functions/v1/receber-contrato-assinado' || req.method !== 'POST') {
      return json(res, 404, { erro: 'rota nao existe no Juri de mentira' });
    }

    const carimbo = String(req.headers['x-atilhus-chat-carimbo'] || '');
    const veio = String(req.headers['x-atilhus-chat-assinatura'] || '');
    if (!Number.isFinite(Number(carimbo)) || Math.abs(Date.now() - Number(carimbo)) > 5 * 60 * 1000) {
      return json(res, 401, { erro: 'CARIMBO_FORA_DA_JANELA' });
    }
    const esperado = crypto.createHmac('sha256', segredo).update(`${carimbo}.${bruto}`).digest('hex');
    if (veio.length !== esperado.length || !crypto.timingSafeEqual(Buffer.from(veio), Buffer.from(esperado))) {
      return json(res, 401, { erro: 'ASSINATURA_INVALIDA' });
    }

    const corpo = JSON.parse(bruto);
    if (corpo.ping) return json(res, 200, { ok: true, ping: true });

    if (modo === 422) return json(res, 422, { erro: 'SEM_POS_VENDA_EM_TIMBAUBA', mensagem: 'SEM_POS_VENDA_EM_TIMBAUBA' });
    if (modo !== 200) return json(res, modo, { erro: 'FALHA_TEMPORARIA' });

    const antigo = casos.get(corpo.token_documento);
    if (antigo) return json(res, 200, { ok: true, situacao: 'repetido', ...antigo, documentos: 0 });

    contador += 1;
    const ids = { contato_id: `contato-juri-${contador}`, caso_id: `caso-${contador}`, tarefa_id: `tarefa-${contador}` };
    casos.set(corpo.token_documento, ids);
    recebidos.push(corpo);
    return json(res, 200, { ok: true, situacao: 'novo', ...ids, documentos: (corpo.documentos || []).length });
  });

  return new Promise((resolve) => servidor.listen(porta, '127.0.0.1', () => resolve(servidor)));
}
