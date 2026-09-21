import http from 'node:http';

/**
 * Instagram e TikTok de mentira, nos caminhos que o sistema usa.
 *
 * Os de verdade exigem app aprovado, conta comercial e endereco publico, e
 * mandariam mensagem para gente de verdade. Estes respondem como as APIs
 * respondem e anotam cada chamada, para o teste conferir o que saiu.
 *
 *   /ig/...   graph.instagram.com (CORREIA_INSTAGRAM_URL aponta para ca)
 *   /tt/...   business-api.tiktok.com/open_api/v1.3 (CORREIA_TIKTOK_URL)
 *   /refresh_access_token   renovacao do token do Instagram (fica na raiz)
 *
 * Rotas de teste:
 *   GET  /__chamadas   { total, chamadas: [{ metodo, caminho, consulta, corpo, cabecalhos }] }
 *   POST /__limpar     zera a lista
 */
export const CONTA_INSTAGRAM = '17840000000000001';
export const CONTA_TIKTOK = 'tt-business-001';

export function subirRedesFalsas(porta) {
  const chamadas = [];
  let contador = 0;
  const endereco = `http://127.0.0.1:${porta}`;
  const IMAGEM = Buffer.from('ffd8ffe000104a46494600010100000100010000ffd9', 'hex');

  const json = (res, status, dados) => {
    res.writeHead(status, { 'content-type': 'application/json' });
    res.end(JSON.stringify(dados));
  };
  const lerCorpo = async (req) => {
    const pedacos = [];
    for await (const p of req) pedacos.push(p);
    const bruto = Buffer.concat(pedacos);
    if (String(req.headers['content-type'] || '').includes('multipart/form-data')) return { multipart: bruto.length };
    try {
      return JSON.parse(bruto.toString('utf8') || '{}');
    } catch {
      return {};
    }
  };
  const tiktokOk = (res, data = {}) => json(res, 200, { code: 0, message: 'OK', data });

  const servidor = http.createServer(async (req, res) => {
    const url = new URL(req.url, 'http://local');
    const caminho = url.pathname;

    if (caminho === '/__chamadas') return json(res, 200, { total: chamadas.length, chamadas });
    if (caminho === '/__limpar') {
      chamadas.length = 0;
      return json(res, 200, { ok: true });
    }
    if (caminho === '/ig-anexo.jpg' || caminho === '/ig-foto.jpg' || caminho === '/tt-imagem.jpg') {
      if (caminho === '/tt-imagem.jpg' && !req.headers['x-user']) return json(res, 401, { erro: 'sem x-user' });
      res.writeHead(200, { 'content-type': 'image/jpeg' });
      return res.end(IMAGEM);
    }

    const corpo = req.method === 'GET' ? {} : await lerCorpo(req);
    chamadas.push({
      metodo: req.method,
      caminho,
      consulta: Object.fromEntries(url.searchParams),
      corpo,
      cabecalhos: { autorizacao: req.headers.authorization || null, accessToken: req.headers['access-token'] || null },
    });

    /* ---------------- Instagram ---------------- */
    if (caminho === '/refresh_access_token') return json(res, 200, { access_token: 'ig-renovado', expires_in: 5184000 });
    if (caminho.startsWith('/ig/')) {
      if (req.headers.authorization !== 'Bearer ig-token' && req.headers.authorization !== 'Bearer ig-renovado') {
        return json(res, 401, { error: { message: 'Invalid OAuth access token', code: 190 } });
      }
      const resto = caminho.slice(4);
      if (resto === 'me') return json(res, 200, { user_id: CONTA_INSTAGRAM, username: 'correia.adv', name: 'Correia Advogados' });
      if (resto === 'me/subscribed_apps') return json(res, 200, { success: true });
      if (resto === `${CONTA_INSTAGRAM}/messages`) {
        if (corpo.sender_action) return json(res, 200, { recipient_id: corpo.recipient?.id });
        contador += 1;
        return json(res, 200, { recipient_id: corpo.recipient?.id, message_id: `IGMID_${contador}` });
      }
      const campos = url.searchParams.get('fields') || '';
      if (campos.includes('profile_pic')) return json(res, 200, { profile_pic: `${endereco}/ig-foto.jpg` });
      if (campos.includes('username')) {
        const nomes = { 9001: ['Maria Instagram', 'maria.ig'], 9002: ['Jose do Anuncio', 'jose.anuncio'] };
        const [name, username] = nomes[resto] || ['', `pessoa${resto}`];
        return json(res, 200, { name, username, id: resto });
      }
      return json(res, 404, { error: { message: 'caminho desconhecido', code: 100 } });
    }

    /* ---------------- TikTok ---------------- */
    if (caminho.startsWith('/tt/')) {
      const resto = caminho.slice(4);
      if (resto === 'tt_user/oauth2/token/') {
        if (corpo.auth_code !== 'CODIGO-DO-LOGIN') return json(res, 200, { code: 40001, message: 'invalid auth_code' });
        /* Vence em um minuto: a proxima chamada ja tem de renovar. */
        return tiktokOk(res, {
          open_id: CONTA_TIKTOK,
          access_token: 'tt-token',
          refresh_token: 'tt-renovacao',
          expires_in: 60,
          refresh_token_expires_in: 31536000,
          scope: 'message.list.send',
        });
      }
      if (resto === 'tt_user/oauth2/refresh_token/') {
        /* Tambem de um minuto: cada chamada do teste passa pela renovacao. */
        return tiktokOk(res, { access_token: 'tt-renovado', refresh_token: 'tt-renovacao-2', expires_in: 60, refresh_token_expires_in: 31536000 });
      }
      if (resto === 'business/webhook/update/') return tiktokOk(res, {});
      if (resto === 'event/track/') return tiktokOk(res, {});

      const token = req.headers['access-token'];
      if (token !== 'tt-token' && token !== 'tt-renovado') return json(res, 200, { code: 40105, message: 'access token invalid' });
      if (resto === 'business/get/') return tiktokOk(res, { username: 'correia.adv', display_name: 'Correia Advogados' });
      if (resto === 'business/message/send/') {
        contador += 1;
        return tiktokOk(res, { message: { message_id: `TTMID_${contador}` } });
      }
      if (resto === 'business/message/media/upload/') return tiktokOk(res, { media_id: 'MEDIA-SUBIDA' });
      if (resto === 'business/message/media/download/') return tiktokOk(res, { download_url: `${endereco}/tt-imagem.jpg` });
      return json(res, 200, { code: 40404, message: 'caminho desconhecido' });
    }

    return json(res, 404, { erro: 'nada aqui' });
  });

  return new Promise((resolve) => servidor.listen(porta, '127.0.0.1', () => resolve(servidor)));
}
