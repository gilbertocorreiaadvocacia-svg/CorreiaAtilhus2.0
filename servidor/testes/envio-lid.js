import { spawn } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

import { suite } from './apoio.js';

/**
 * Responder conversa que chegou so pelo codigo @lid (driver por QR Code).
 *
 * Achado em producao em 24/10/2026: a Eduarda respondeu um lead e a mensagem
 * ficou com "erro 400" e "[object Object]" embaixo. A conversa tinha chegado
 * pelo endereco @lid, sem o telefone junto, e o codigo foi gravado no lugar do
 * telefone (+35 (61) 43889-57348, que nao existe); o envio mandava para esse
 * "numero". E a recusa da Evolution vem como OBJETO ({ exists: false }), que
 * virava "[object Object]".
 *
 * Contra um servico falso que responde como a Evolution respondeu la: numero
 * sem WhatsApp -> 400 com { exists: false }; endereco @lid -> aceito.
 */
export async function testarEnvioLid({ raiz }) {
  const s = suite('Resposta para conversa que chegou so pelo codigo @lid');
  const pasta = fs.mkdtempSync(path.join(os.tmpdir(), 'envio-lid-'));
  const roteiro = path.join(pasta, 'roteiro.mjs');
  fs.writeFileSync(
    roteiro,
    `import http from 'node:http';
import { driverQrCode } from ${JSON.stringify(pathToFileURL(path.join(raiz, 'servidor/whatsapp/drivers/qrcode.js')).href)};

const recebidos = [];
const servidor = http.createServer((pedido, resposta) => {
  let corpo = '';
  pedido.on('data', (d) => (corpo += d));
  pedido.on('end', () => {
    const carga = corpo ? JSON.parse(corpo) : {};
    recebidos.push({ rota: pedido.url, ...carga });
    const responder = (status, dados) => { resposta.writeHead(status, { 'Content-Type': 'application/json', Connection: 'close' }); resposta.end(JSON.stringify(dados)); };
    if (pedido.url.startsWith('/message/sendText/')) {
      if (String(carga.number).endsWith('@lid')) return responder(201, { key: { id: 'PELO_LID' } });
      return responder(400, { status: 400, error: 'Bad Request', response: { message: [{ jid: carga.number + '@s.whatsapp.net', exists: false, number: carga.number }] } });
    }
    if (pedido.url.startsWith('/chat/markMessageAsRead/')) return responder(200, { read: 'success' });
    responder(404, { message: 'rota nao mapeada' });
  });
});
await new Promise((ok) => servidor.listen(0, '127.0.0.1', ok));
const conexao = { id: 'conx-teste', tipo: 'qrcode', qrcode: { servidor: 'http://127.0.0.1:' + servidor.address().port, chave: 'chave-teste', instancia: 'inst' } };

const soLid = { telefone: '35614388957348', lid: '35614388957348@lid' };
const saida = {};
saida.envioLid = await driverQrCode.enviar({ conexao, contato: soLid, tipo: 'texto', conteudo: 'Ola!' }).catch((e) => ({ erro: e.message }));
saida.envioSemTelefone = await driverQrCode.enviar({ conexao, contato: { telefone: '', lid: '35614388957348@lid' }, tipo: 'texto', conteudo: 'Ola!' }).catch((e) => ({ erro: e.message }));
saida.envioNumeroInexistente = await driverQrCode.enviar({ conexao, contato: { telefone: '5511900000000' }, tipo: 'texto', conteudo: 'Ola!' }).then(() => null).catch((e) => ({ erro: e.message, codigo: e.codigoWhatsapp }));
await driverQrCode.marcarLida({ conexao, idExterno: 'ABC', contato: soLid });
saida.recebidos = recebidos;
console.log(JSON.stringify(saida));
/* Sem process.exit: no Windows, sair com uma conexao do fetch ainda aberta
   derruba o Node (UV_HANDLE_CLOSING). Com "Connection: close" em toda resposta
   nao sobra conexao, e o processo termina sozinho depois do close. */
await new Promise((ok) => servidor.close(ok));
`,
  );

  try {
    const r = await new Promise((resolve) => {
      const p = spawn(process.execPath, [roteiro], { stdio: ['ignore', 'pipe', 'pipe'] });
      let texto = '';
      p.stdout.on('data', (d) => (texto += d));
      p.stderr.on('data', (d) => (texto += d));
      p.on('close', (codigo) => resolve({ codigo, texto }));
    });
    if (!s.ok('o roteiro roda sem erro', r.codigo === 0, r.texto.slice(-600))) return s;
    const b = JSON.parse(r.texto.trim().split('\n').pop());
    const enviados = b.recebidos.filter((x) => x.rota.startsWith('/message/sendText/')).map((x) => x.number);
    const lida = b.recebidos.find((x) => x.rota.startsWith('/chat/markMessageAsRead/'));

    s.ok('conversa so com o codigo @lid recebe a resposta pelo proprio @lid', b.envioLid?.idExterno === 'PELO_LID', JSON.stringify(b.envioLid));
    s.ok('o codigo gravado como telefone nunca e usado como numero', !enviados.includes('35614388957348'), JSON.stringify(enviados));
    s.ok('conversa com o telefone vazio e o @lid tambem responde pelo @lid', b.envioSemTelefone?.idExterno === 'PELO_LID', JSON.stringify(b.envioSemTelefone));
    s.ok('o aviso de leitura tambem vai para o @lid', lida?.readMessages?.[0]?.remoteJid === '35614388957348@lid', JSON.stringify(lida));
    s.ok(
      'numero sem WhatsApp vira frase, e nao "[object Object]"',
      Boolean(b.envioNumeroInexistente?.erro) && !b.envioNumeroInexistente.erro.includes('[object Object]') && /nao encontrou/.test(b.envioNumeroInexistente.erro),
      JSON.stringify(b.envioNumeroInexistente),
    );
    s.ok('e o codigo 400 continua junto, para a tela marcar o erro', b.envioNumeroInexistente?.codigo === '400', JSON.stringify(b.envioNumeroInexistente));
  } finally {
    fs.rmSync(pasta, { recursive: true, force: true });
  }
  return s;
}
