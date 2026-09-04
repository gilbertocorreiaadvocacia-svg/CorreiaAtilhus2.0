import http from 'node:http';
import zlib from 'node:zlib';

/**
 * Evolution API de mentira.
 *
 * O driver de QR Code fala HTTP com um servico que segura a sessao do WhatsApp.
 * Testar contra o servico de verdade exigiria Docker, um chip e um celular
 * lendo o codigo, o que nao cabe em CI. Este arquivo responde as mesmas rotas,
 * no mesmo formato, e e o suficiente para provar o que importa: que o driver
 * monta o pedido certo, entende a resposta e traduz o webhook.
 *
 * O que ele NAO prova e que a Evolution de verdade responde exatamente assim.
 * Isso so a primeira conexao real diz. Se algum endereco divergir, o ajuste e
 * dentro de whatsapp/drivers/qrcode.js e nao espalha para o resto.
 *
 * Rotas de teste, fora do protocolo, todas com prefixo __ :
 *   GET  /__escanear   simula o celular lendo o codigo (a sessao abre)
 *   GET  /__enviadas   devolve o que o driver mandou, para conferir
 *   POST /__reiniciar  volta ao estado inicial
 */

const PORTA = Number(process.env.PORTA_EVOLUCAO || 8099);
const CHAVE = process.env.CHAVE_EVOLUCAO || 'chave-de-teste';

let estado = 'close';
const enviadas = [];

/**
 * Um PNG com cara de QR Code, desenhado aqui.
 *
 * Nao e um QR Code valido, e nem precisa ser: nenhum celular vai ler isto. Ele
 * existe para o driver receber um data URI de verdade e a tela ter o que
 * desenhar, em vez de um pixel branco que parece defeito na hora de olhar.
 */
function qrDeMentira() {
  const N = 33;
  const ESCALA = 6;
  const grade = [];
  /* Padrao determinista: o mesmo desenho em toda execucao, para a saida do
     teste nao mudar sem motivo. */
  let semente = 7;
  const proximo = () => {
    semente = (semente * 1103515245 + 12345) & 0x7fffffff;
    return semente % 2;
  };
  for (let y = 0; y < N; y += 1) {
    grade.push(Array.from({ length: N }, proximo));
  }
  const marcador = (ox, oy) => {
    for (let y = -1; y < 8; y += 1) {
      for (let x = -1; x < 8; x += 1) {
        const py = oy + y;
        const px = ox + x;
        if (py < 0 || py >= N || px < 0 || px >= N) continue;
        const borda = x === 0 || x === 6 || y === 0 || y === 6;
        const centro = x >= 2 && x <= 4 && y >= 2 && y <= 4;
        const dentro = x >= 0 && x <= 6 && y >= 0 && y <= 6;
        grade[py][px] = dentro && (borda || centro) ? 1 : 0;
      }
    }
  };
  marcador(0, 0);
  marcador(N - 7, 0);
  marcador(0, N - 7);

  const largura = N * ESCALA;
  const linhas = Buffer.alloc(largura * (largura * 3 + 1));
  let i = 0;
  for (let y = 0; y < largura; y += 1) {
    linhas[i] = 0;
    i += 1;
    for (let x = 0; x < largura; x += 1) {
      const v = grade[Math.floor(y / ESCALA)][Math.floor(x / ESCALA)] ? 0 : 255;
      linhas[i] = v;
      linhas[i + 1] = v;
      linhas[i + 2] = v;
      i += 3;
    }
  }

  const bloco = (tipo, dados) => {
    const corpo = Buffer.concat([Buffer.from(tipo), dados]);
    const tamanho = Buffer.alloc(4);
    tamanho.writeUInt32BE(dados.length);
    const crc = Buffer.alloc(4);
    crc.writeUInt32BE(zlib.crc32 ? zlib.crc32(corpo) : crc32(corpo));
    return Buffer.concat([tamanho, corpo, crc]);
  };

  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(largura, 0);
  ihdr.writeUInt32BE(largura, 4);
  ihdr[8] = 8;
  ihdr[9] = 2;

  const png = Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    bloco('IHDR', ihdr),
    bloco('IDAT', zlib.deflateSync(linhas)),
    bloco('IEND', Buffer.alloc(0)),
  ]);
  return `data:image/png;base64,${png.toString('base64')}`;
}

/* zlib.crc32 so existe do Node 20.15 em diante. */
function crc32(buffer) {
  let c;
  const tabela = [];
  for (let n = 0; n < 256; n += 1) {
    c = n;
    for (let k = 0; k < 8; k += 1) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    tabela[n] = c >>> 0;
  }
  let crc = 0xffffffff;
  for (const byte of buffer) crc = tabela[(crc ^ byte) & 0xff] ^ (crc >>> 8);
  return (crc ^ 0xffffffff) >>> 0;
}

const QR = qrDeMentira();

export function subirEvolucaoFalsa(porta = PORTA, chave = CHAVE) {
  const servidor = http.createServer(async (req, res) => {
    const url = new URL(req.url, 'http://localhost');
    const corpo = await new Promise((resolve) => {
      let bruto = '';
      req.on('data', (p) => (bruto += p));
      req.on('end', () => resolve(bruto));
    });

    const responder = (codigo, dados) => {
      res.writeHead(codigo, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify(dados));
    };

    if (req.headers.apikey !== chave) {
      return responder(401, { message: 'apikey invalida' });
    }

    const caminho = url.pathname;

    /* Rotas de apoio ao teste, fora do protocolo da Evolution. */
    if (caminho === '/__escanear') {
      estado = 'open';
      return responder(200, { ok: true });
    }
    if (caminho === '/__enviadas') return responder(200, enviadas);
    if (caminho === '/__reiniciar') {
      estado = 'close';
      enviadas.length = 0;
      return responder(200, { ok: true });
    }

    /* O protocolo de verdade. */
    if (caminho === '/instance/create') {
      return responder(201, { instance: { instanceName: 'teste', status: 'created' } });
    }
    if (caminho.startsWith('/instance/connect/')) {
      /* Como no servico real: devolve o codigo e a sessao fica em 'connecting'
         ate o celular ler. Quem "le" aqui e a rota /__escanear. */
      estado = 'connecting';
      return responder(200, { base64: QR, code: '2@codigo-de-teste', pairingCode: null });
    }
    if (caminho.startsWith('/instance/connectionState/')) {
      return responder(200, { instance: { instanceName: 'teste', state: estado } });
    }
    if (caminho.startsWith('/instance/logout/')) {
      estado = 'close';
      return responder(200, { status: 'SUCCESS' });
    }
    if (caminho.startsWith('/message/sendText/') || caminho.startsWith('/message/sendMedia/')) {
      const carga = corpo ? JSON.parse(corpo) : {};
      enviadas.push({ rota: caminho, ...carga });
      return responder(201, { key: { id: `MOCK_${enviadas.length}` }, status: 'PENDING' });
    }
    if (caminho.startsWith('/chat/markMessageAsRead/')) return responder(200, { read: 'success' });

    responder(404, { message: `rota nao mapeada: ${caminho}` });
  });

  return new Promise((resolve) => {
    servidor.listen(porta, '127.0.0.1', () => resolve(servidor));
  });
}

/* Tambem roda sozinho, para depurar a mao. */
if (process.argv[1] && process.argv[1].endsWith('evolution-falsa.js')) {
  subirEvolucaoFalsa().then(() => {
    console.log(`Evolution de mentira em http://127.0.0.1:${PORTA} (apikey: ${CHAVE})`);
  });
}
