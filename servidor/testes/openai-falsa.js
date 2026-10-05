import http from 'node:http';

/**
 * OpenAI de mentira, so a parte de audio.
 *
 * A voz do agente nunca tinha teste: o caminho inteiro (motor -> sintetizar ->
 * OpenAI -> arquivo -> mensagem de audio) so seria exercido no dia em que a
 * primeira chave real fosse cadastrada, na frente do cliente. Este arquivo
 * responde no formato da API e deixa o teste escolher o que vem.
 *
 * O que ele NAO prova: que a OpenAI de verdade aceita estes parametros hoje, e
 * que o audio dela e inteligivel. Isso so a chave real diz (o botao Ouvir da
 * tela de Vozes existe para isso). O que ele prova e a decisao que e nossa: que
 * voz e que velocidade pedimos, que sem chave nao se chama, e que falha na
 * OpenAI vira texto, e nao silencio.
 *
 *   POST /__falhar      { status } a proxima resposta de voz falha com esse codigo
 *   GET  /__chamadas    o que o sistema pediu, em ordem
 *   POST /__zerar       limpa
 */
const chamadas = [];
let falhar = null;

export function subirOpenaiFalsa(porta) {
  const servidor = http.createServer((req, res) => {
    const pedacos = [];
    req.on('data', (d) => pedacos.push(d));
    req.on('end', () => {
      const corpo = Buffer.concat(pedacos);
      const json = (status, dados) => {
        res.writeHead(status, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify(dados));
      };

      if (req.url === '/__chamadas') return json(200, chamadas);
      if (req.url === '/__zerar') {
        chamadas.length = 0;
        falhar = null;
        return json(200, { ok: true });
      }
      if (req.url === '/__falhar') {
        falhar = JSON.parse(corpo.toString() || '{}').status || null;
        return json(200, { ok: true });
      }

      if (req.url === '/v1/audio/speech') {
        let pedido = {};
        try {
          pedido = JSON.parse(corpo.toString());
        } catch {
          /* corpo invalido: registra vazio */
        }
        chamadas.push({ rota: 'speech', autorizacao: req.headers.authorization, ...pedido });
        if (falhar) {
          const status = falhar;
          falhar = null;
          return json(status, { error: { message: 'falha combinada pelo teste' } });
        }
        res.writeHead(200, { 'Content-Type': 'audio/mpeg' });
        return res.end(Buffer.from('ID3-audio-de-mentira-' + (pedido.input || '').length));
      }

      if (req.url === '/v1/audio/transcriptions') {
        chamadas.push({ rota: 'transcriptions', autorizacao: req.headers.authorization });
        return json(200, { text: 'transcricao de mentira' });
      }

      return json(404, { error: 'rota desconhecida' });
    });
  });
  return new Promise((resolve) => servidor.listen(porta, '127.0.0.1', () => resolve(servidor)));
}
