import fs from 'node:fs';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';

import { baixarModeloDeVoz } from '../ia/modelo-de-voz.js';
import { suite } from './apoio.js';

/**
 * O modelo de voz baixado pela hospedagem (ia/modelo-de-voz.js). Pedido do
 * escritorio em 26/10/2026: "ele nao transcreve audio ainda" — faltava so o
 * modelo no volume.
 *
 * O que nao pode falhar: o modelo inteiro vai para a pasta com o nome certo;
 * pagina de erro, arquivo pela metade e endereco que nao existe nunca deixam
 * arquivo nenhum para tras, porque um modelo quebrado faria o whisper falhar
 * em todo audio. O servidor de download e um de mentira, aqui mesmo.
 */
export async function testarModeloDeVoz() {
  const s = suite('A hospedagem baixa o modelo de voz que falta');
  const modelo = Buffer.concat([Buffer.from('lmgg'), Buffer.alloc(4096, 7)]);

  const servidor = http.createServer((req, res) => {
    if (req.url === '/bom.bin') {
      res.writeHead(200, { 'Content-Length': modelo.length, 'Content-Type': 'application/octet-stream' });
      return res.end(modelo);
    }
    if (req.url === '/redireciona.bin') {
      res.writeHead(302, { Location: '/bom.bin' });
      return res.end();
    }
    if (req.url === '/pagina.bin') {
      res.writeHead(200, { 'Content-Type': 'text/html' });
      return res.end('<html>Entre na sua conta para baixar</html>');
    }
    if (req.url === '/metade.bin') {
      res.writeHead(200, { 'Content-Length': modelo.length });
      res.write(modelo.subarray(0, 100));
      return res.destroy();
    }
    res.writeHead(404);
    return res.end();
  });
  await new Promise((ok) => servidor.listen(0, '127.0.0.1', ok));
  const base = `http://127.0.0.1:${servidor.address().port}`;
  const pasta = fs.mkdtempSync(path.join(os.tmpdir(), 'modelo-de-voz-'));
  const sobrou = () => fs.readdirSync(pasta);

  try {
    const bom = await baixarModeloDeVoz({ url: `${base}/redireciona.bin`, pasta });
    const caminho = path.join(pasta, 'ggml-base.bin');
    s.ok(
      'o modelo inteiro vai para a pasta, com o nome que a transcricao procura',
      bom.ok && fs.existsSync(caminho) && fs.readFileSync(caminho).equals(modelo),
      JSON.stringify(bom),
    );
    s.ok('e nao sobra o arquivo do meio do caminho', JSON.stringify(sobrou()) === JSON.stringify(['ggml-base.bin']), JSON.stringify(sobrou()));
    fs.rmSync(caminho);

    const pagina = await baixarModeloDeVoz({ url: `${base}/pagina.bin`, pasta });
    s.ok('pagina no lugar do modelo e recusada, sem deixar arquivo', !pagina.ok && /nao e um modelo/.test(pagina.erro) && !sobrou().length, JSON.stringify({ pagina, sobrou: sobrou() }));

    const metade = await baixarModeloDeVoz({ url: `${base}/metade.bin`, pasta });
    s.ok('download interrompido e recusado, sem deixar arquivo', !metade.ok && !sobrou().length, JSON.stringify({ metade, sobrou: sobrou() }));

    const naoExiste = await baixarModeloDeVoz({ url: `${base}/sumiu.bin`, pasta });
    s.ok('endereco que nao existe diz o motivo, sem deixar arquivo', !naoExiste.ok && /404/.test(naoExiste.erro) && !sobrou().length, JSON.stringify(naoExiste));
  } finally {
    servidor.closeAllConnections();
    await new Promise((ok) => servidor.close(ok));
    fs.rmSync(pasta, { recursive: true, force: true });
  }
  return s;
}
