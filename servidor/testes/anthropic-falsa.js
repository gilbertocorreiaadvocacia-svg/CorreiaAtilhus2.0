import http from 'node:http';

/**
 * Anthropic de mentira.
 *
 * O motor ganhou tempo limite e UMA retentativa, e as duas coisas so tem valor
 * se estiverem certas nos detalhes: repetir um 429 salva o atendimento, repetir
 * um 401 gasta o dobro para receber o mesmo erro, e repetir tres vezes deixa o
 * cliente esperando meio minuto a mais por nada.
 *
 * Nao da para provar isso contra a API de verdade. Ela nao devolve 429 sob
 * encomenda, cada tentativa custa dinheiro do escritorio, e uma suite que
 * depende de internet reprova sozinha no dia em que a rede oscila. Este arquivo
 * responde no mesmo formato e deixa o teste escolher o que vem: uma fila de
 * respostas, consumida uma por chamada.
 *
 * O que ele NAO prova e que a Anthropic de verdade manda `retry-after` no 429,
 * nem que o corpo do erro tem o formato que o codigo espera. Isso so a primeira
 * chave real diz. O que ele prova e a decisao que e nossa: quantas vezes
 * tentamos, e em quais codigos.
 *
 * Rotas de teste, fora do protocolo, todas com prefixo __ :
 *   POST /__roteiro    define a fila de respostas da proxima bateria
 *   GET  /__chamadas   quantas vezes o sistema bateu aqui, e com que corpo
 */

/**
 * A fila do que responder. Cada item e { status, corpo?, cabecalhos?, demora? }.
 * Acabando a fila, repete o ultimo item: assim um teste que so quer "sempre
 * 429" escreve um item so.
 */
let roteiro = [];
const chamadas = [];
const outras = [];

/**
 * O que e chamada do teste, e o que e agente vivo.
 *
 * As suites anteriores deixam conversas com agente responsavel, e o cronometro
 * desses agentes dispara sozinho — inclusive durante os dois segundos em que a
 * retentativa esta dormindo. Sem separar, aconteceu exatamente isto: um agente
 * de triagem de BPC bateu aqui no meio do teste do 429, a contagem deu 3 onde
 * devia dar 2, e o teste reprovou por um motivo que nao tinha nada a ver com o
 * que ele afirma.
 *
 * A contagem errada nem e o pior. O pior e o ROTEIRO CONSUMIDO por quem nao
 * devia: o agente comeu o "200" reservado para a segunda tentativa, e o teste
 * do lado passou a depender de quando um cronometro alheio dispara.
 *
 * A marca e o proprio texto de sistema que a rota de teste ja manda. Nao
 * precisou inventar cabecalho novo no codigo de producao so para o teste
 * conseguir se reconhecer aqui dentro.
 */
const MARCA_DO_TESTE = 'exatamente a palavra: funcionando';
const ehDoTeste = (corpo) => String(corpo?.system || '').includes(MARCA_DO_TESTE);

function responderJson(res, status, dados, cabecalhos = {}) {
  const corpo = JSON.stringify(dados);
  res.writeHead(status, { 'content-type': 'application/json', ...cabecalhos });
  res.end(corpo);
}

/** Resposta de sucesso no formato da Anthropic, com o texto pedido. */
function sucesso(texto) {
  return {
    id: 'msg_falso',
    type: 'message',
    role: 'assistant',
    content: [{ type: 'text', text: texto }],
    usage: { input_tokens: 10, output_tokens: 3 },
  };
}

async function lerCorpo(req) {
  const pedacos = [];
  for await (const pedaco of req) pedacos.push(pedaco);
  const bruto = Buffer.concat(pedacos).toString('utf8');
  try {
    return bruto ? JSON.parse(bruto) : null;
  } catch {
    return bruto;
  }
}

export function subirAnthropicFalsa(porta) {
  const servidor = http.createServer(async (req, res) => {
    const url = new URL(req.url, 'http://local');

    if (url.pathname === '/__roteiro' && req.method === 'POST') {
      const corpo = await lerCorpo(req);
      roteiro = Array.isArray(corpo?.roteiro) ? corpo.roteiro : [];
      chamadas.length = 0;
      outras.length = 0;
      return responderJson(res, 200, { ok: true, itens: roteiro.length });
    }

    if (url.pathname === '/__chamadas') {
      return responderJson(res, 200, { total: chamadas.length, chamadas, agentes: outras.length });
    }

    if (url.pathname === '/v1/messages' && req.method === 'POST') {
      const corpo = await lerCorpo(req);
      const registro = {
        chave: req.headers['x-api-key'] || '',
        modelo: corpo?.model || null,
        sistema: String(corpo?.system || '').slice(0, 70),
        quando: Date.now(),
      };

      /* Agente que disparou sozinho recebe um sucesso simples e vai embora sem
         encostar no roteiro. Continua anotado, em `outras`, para o teste poder
         ver que houve — so nao entra na conta nem gasta a fila. */
      if (!ehDoTeste(corpo)) {
        outras.push(registro);
        return responderJson(res, 200, sucesso('ok'));
      }

      chamadas.push(registro);

      // Fila vazia: sucesso simples, para o teste que so quer o caminho feliz.
      const item = roteiro.length ? roteiro[Math.min(chamadas.length - 1, roteiro.length - 1)] : { status: 200 };

      /* `demora` serve para provocar o tempo limite. O socket fica aberto e
         nada e escrito: e assim que uma API travada se parece de verdade,
         diferente de uma que recusa a conexao na hora. */
      if (item.demora) {
        await new Promise((r) => setTimeout(r, item.demora));
      }

      if (item.status === 200) {
        return responderJson(res, 200, sucesso(item.texto || 'funcionando'));
      }
      return responderJson(
        res,
        item.status,
        { type: 'error', error: { type: 'falso', message: item.mensagem || `erro ${item.status}` } },
        item.cabecalhos || {},
      );
    }

    responderJson(res, 404, { error: { message: 'rota nao existe na Anthropic de mentira' } });
  });

  return new Promise((resolve) => {
    servidor.listen(porta, '127.0.0.1', () => resolve(servidor));
  });
}
