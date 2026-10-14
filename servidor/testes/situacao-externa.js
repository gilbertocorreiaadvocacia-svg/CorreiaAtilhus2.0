import { spawn } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

import { suite } from './apoio.js';

/**
 * `atualizarSituacaoExterna` (servidor/whatsapp/recebimento.js): o estado de
 * entrega que a Meta manda (enviada, entregue, lida, erro) por webhook, uma
 * vez por mensagem enviada, varias vezes por mensagem (um evento por etapa).
 *
 * Achado em 14/10/2026: antes, isso percorria TODO contato do escritorio e
 * lia a conversa do disco ate achar a mensagem — sem limite, disparando a
 * cada confirmacao, nao so depois de reiniciar como os bugs parecidos ja
 * corrigidos. Agora tenta achar sem tocar disco primeiro
 * (buscarMensagemPorIdExternoEmCache, nucleo/banco.js), e so cai na busca
 * completa (disco) se nao achar.
 *
 * O que nao pode falhar: os dois caminhos chegam no mesmo resultado —
 * conversa ja em cache (o caso de quase sempre, pois foi ela que mandou a
 * mensagem segundos antes) e conversa ainda fria no disco (o caso raro,
 * simulado aqui escrevendo o arquivo da conversa direto, sem passar pelo
 * cache) atualizam a mensagem do mesmo jeito; idExterno que nao existe em
 * lugar nenhum nao quebra, so devolve false.
 */
export async function testarSituacaoExterna({ raiz }) {
  const s = suite('Situacao externa (confirmacao de entrega)');
  const urlDoBanco = pathToFileURL(path.join(raiz, 'servidor/nucleo/banco.js')).href;
  const urlDoRecebimento = pathToFileURL(path.join(raiz, 'servidor/whatsapp/recebimento.js')).href;
  const pasta = fs.mkdtempSync(path.join(os.tmpdir(), 'situacao-externa-'));

  const rodar = (arquivo) =>
    new Promise((resolve) => {
      const p = spawn(process.execPath, [arquivo], { env: { ...process.env, CORREIA_DADOS: pasta }, stdio: ['ignore', 'pipe', 'pipe'] });
      let texto = '';
      p.stdout.on('data', (d) => (texto += d));
      p.stderr.on('data', (d) => (texto += d));
      p.on('close', (codigo) => resolve({ codigo, texto }));
    });

  const montagem = path.join(pasta, 'montar.mjs');
  fs.writeFileSync(
    montagem,
    `import fs from 'node:fs';
import path from 'node:path';
import { iniciarBanco, inserir, inserirMensagem, encerrarBanco } from ${JSON.stringify(urlDoBanco)};
iniciarBanco();
inserir('workspaces', { id: 'w1', nome: 'Escritorio de Teste' });

/* c1: caminho rapido — a propria insercao ja deixa a conversa em cache,
   igual ao envio de verdade (inserirMensagem chama mensagensDe por baixo). */
inserir('contatos', { id: 'c1', workspaceId: 'w1', nome: 'Lead cache quente', telefone: '5581900000001' });
inserirMensagem('c1', { id: 'm1', idExterno: 'EXT-QUENTE', situacao: 'enviada', direcao: 'saida' });

/* c2: caminho de fallback — a conversa existe no disco, mas este processo
   nunca chamou mensagensDe('c2'), entao nao esta em cache nenhum. */
inserir('contatos', { id: 'c2', workspaceId: 'w1', nome: 'Lead cache frio', telefone: '5581900000002' });
await encerrarBanco();

/* Escreve o arquivo da conversa de c2 DIRETO, depois do encerrarBanco
   (que ja salvou o resto) — sem passar pelo cache deste processo. */
const pastaMensagens = path.join(${JSON.stringify(pasta)}, 'mensagens');
fs.mkdirSync(pastaMensagens, { recursive: true });
fs.writeFileSync(
  path.join(pastaMensagens, 'c2.json'),
  JSON.stringify([{ id: 'm2', contatoId: 'c2', idExterno: 'EXT-FRIO', situacao: 'enviada', direcao: 'saida', criadoEm: new Date().toISOString() }]),
);
`,
  );

  const rodarTeste = path.join(pasta, 'rodar.mjs');
  fs.writeFileSync(
    rodarTeste,
    `import { iniciarBanco, mensagensDe, encerrarBanco } from ${JSON.stringify(urlDoBanco)};
import { atualizarSituacaoExterna } from ${JSON.stringify(urlDoRecebimento)};
iniciarBanco();

const achouQuente = atualizarSituacaoExterna('w1', 'EXT-QUENTE', 'entregue');
const achouFrio = atualizarSituacaoExterna('w1', 'EXT-FRIO', 'lida');
const naoAchou = atualizarSituacaoExterna('w1', 'NAO-EXISTE-EM-LUGAR-NENHUM', 'erro');

console.log(JSON.stringify({
  achouQuente,
  achouFrio,
  naoAchou,
  situacaoC1: mensagensDe('c1').find((m) => m.id === 'm1')?.situacao,
  situacaoC2: mensagensDe('c2').find((m) => m.id === 'm2')?.situacao,
}));
await encerrarBanco();
process.exit(0);
`,
  );

  try {
    const m = await rodar(montagem);
    if (!s.ok('a base descartavel foi montada', m.codigo === 0, m.texto.slice(-400))) return s;

    const r = await rodar(rodarTeste);
    if (!s.ok('roda sem erro', r.codigo === 0, r.texto.slice(-400))) return s;
    const b = JSON.parse(r.texto.trim().split('\n').pop());

    s.ok('acha e atualiza a mensagem ja em cache (caminho rapido)', b.achouQuente === true, JSON.stringify(b));
    s.ok('a situacao da mensagem em cache fica "entregue"', b.situacaoC1 === 'entregue', String(b.situacaoC1));

    s.ok('acha e atualiza a mensagem que so existia no disco (caminho de reserva)', b.achouFrio === true, JSON.stringify(b));
    s.ok('a situacao da mensagem que estava fria no disco fica "lida"', b.situacaoC2 === 'lida', String(b.situacaoC2));

    s.ok('idExterno que nao existe em lugar nenhum devolve false, sem quebrar', b.naoAchou === false, JSON.stringify(b));
  } finally {
    fs.rmSync(pasta, { recursive: true, force: true });
  }
  return s;
}
