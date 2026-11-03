import { spawn } from 'node:child_process';
import fs from 'node:fs';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

import { suite } from './apoio.js';

/**
 * A voz que falha deixa rastro (ia/audio.js, sintetizar), 03/11/2026.
 *
 * "A IA ainda nao manda audio": sem a chave da OpenAI ela nem tenta, mas com a
 * chave errada ou sem saldo a tentativa falhava em silencio — a resposta saia em
 * texto e nada dizia por que, nem para a equipe nem para quem confere de fora.
 *
 * O que nao pode falhar:
 *  - a falha NUNCA derruba a resposta: sintetizar devolve null e o motor manda o
 *    texto (isso o teste de voz de ponta a ponta, voz.js, ja garante);
 *  - toda falha deixa uma linha de erro na conversa, entra nas ultimas tentativas
 *    de /api/saude e na contagem de falhas do atendimento, com o motivo;
 *  - o motivo nunca guarda um pedaco de chave;
 *  - chave recusada ou sem saldo avisa os administradores UMA vez por dia; erro
 *    do servidor, que passa sozinho, nao avisa ninguem;
 *  - sem chave nao ha tentativa, nem rastro.
 */
export async function testarVozVisivel({ raiz }) {
  const s = suite('A voz que falha deixa rastro');
  const url = (arquivo) => JSON.stringify(pathToFileURL(path.join(raiz, arquivo)).href);
  const pasta = fs.mkdtempSync(path.join(os.tmpdir(), 'voz-visivel-'));
  const script = path.join(pasta, 'voz.mjs');

  let chamadas = 0;
  const openaiFalsa = http.createServer((req, res) => {
    req.resume();
    req.on('end', () => {
      chamadas += 1;
      res.setHeader('connection', 'close');
      const json = (status, dados) => {
        res.writeHead(status, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify(dados));
      };
      if (chamadas === 1) return json(401, { error: { message: 'Incorrect API key provided: sk-proj-ABCDEFGH12345678. You can find your API key at platform.openai.com.' } });
      if (chamadas === 2) return json(429, { error: { message: 'You exceeded your current quota, please check your plan and billing details.', type: 'insufficient_quota' } });
      if (chamadas === 3) return json(500, { error: { message: 'The server had an error while processing your request.' } });
      res.writeHead(200, { 'Content-Type': 'audio/mpeg' });
      res.end(Buffer.from('ID3-audio-de-mentira'));
    });
  });
  await new Promise((ok) => openaiFalsa.listen(0, '127.0.0.1', ok));

  fs.writeFileSync(
    script,
    `import { iniciarBanco, inserir, listar, encerrarBanco } from ${url('servidor/nucleo/banco.js')};
import { sintetizar, ultimasSinteses } from ${url('servidor/ia/audio.js')};
import { saudeDoAtendimento } from ${url('servidor/nucleo/saude-do-atendimento.js')};
iniciarBanco();
const espera = (ms) => new Promise((ok) => setTimeout(ok, ms));
const resultado = {};

inserir('workspaces', { id: 'w1', nome: 'Correia' });
inserir('integracoes', { id: 'int1', workspaceId: 'w1', ia: { chaveOpenai: 'sk-openai-de-mentira' } });
for (const [id, papel] of [['admin', 'admin'], ['atende', 'atendente']]) {
  inserir('usuarios', { id: 'u-' + id, nome: id });
  inserir('membros', { id: 'm-' + id, workspaceId: 'w1', usuarioId: 'u-' + id, papel });
}
inserir('contatos', { id: 'c1', workspaceId: 'w1', conexaoId: 'cx', telefone: '5581900000001', nome: 'Lead', estado: 'ia', etiquetas: [] });
inserir('workspaces', { id: 'w2', nome: 'Sem chave' });
inserir('contatos', { id: 'c2', workspaceId: 'w2', conexaoId: 'cx', telefone: '5581900000002', nome: 'Lead 2', estado: 'ia', etiquetas: [] });

const falar = (workspaceId, contatoId) => sintetizar({ workspaceId, contatoId, texto: 'Olá, vou te explicar como funciona o benefício.', vozId: 'nova' });
const avisos = (membro) => listar('notificacoes', { membroId: membro }).filter((n) => /voz da IA parou/.test(n.titulo));
const linhas = () => listar('logs', { tipo: 'erro_voz' });

/* 1. Chave recusada (401). */
const r1 = await falar('w1', 'c1');
resultado.chaveRecusada = {
  devolveNull: r1 === null,
  ultima: ultimasSinteses()[0],
  linhas: linhas().length,
  textoDaLinha: linhas()[0]?.descricao,
  avisoAdmin: avisos('m-admin').length,
  avisoAtendente: avisos('m-atende').length,
  textoDoAviso: avisos('m-admin')[0]?.texto,
};

/* 2. Sem saldo (429 insufficient_quota): conta de novo, mas o aviso do dia nao se repete. */
const r2 = await falar('w1', 'c1');
resultado.semSaldo = { devolveNull: r2 === null, linhas: linhas().length, avisoAdmin: avisos('m-admin').length, ultima: ultimasSinteses()[0] };

/* 3. Erro do servidor (500): passa sozinho, nao avisa ninguem. Em outro dia ele avisaria? Aqui so contamos. */
const r3 = await falar('w1', 'c1');
resultado.erroDoServidor = { devolveNull: r3 === null, linhas: linhas().length, avisoAdmin: avisos('m-admin').length, ultima: ultimasSinteses()[0] };

/* 4. Funcionou: devolve o audio e entra como sucesso. */
const r4 = await falar('w1', 'c1');
resultado.funcionou = { devolveAudio: Boolean(r4 && (r4.url || r4.arquivo)), duracao: r4?.duracaoEstimada, ultima: ultimasSinteses()[0], linhas: linhas().length };

/* 5. Sem chave: nem tenta, nem deixa rastro. */
const antes = ultimasSinteses().length;
const r5 = await falar('w2', 'c2');
resultado.semChave = { devolveNull: r5 === null, tentativasNovas: ultimasSinteses().length - antes, linhasDoContato2: linhas().filter((l) => l.contatoId === 'c2').length };

/* 6. O retrato do atendimento conta e mostra o motivo. */
const saude = saudeDoAtendimento('w1');
resultado.saude = {
  em24h: saude.falhas.erro_voz.em24h,
  motivos: (saude.motivosDeErroDaVoz || []).map((m) => m.motivo),
  quantasUltimas: ultimasSinteses().length,
};
resultado.chaveEmLugarNenhum = !JSON.stringify([linhas(), ultimasSinteses(), listar('notificacoes')]).includes('ABCDEFGH12345678');

console.log(JSON.stringify(resultado));
await encerrarBanco();
await espera(300);
process.exit(0);
`,
  );

  try {
    const r = await new Promise((resolve) => {
      const p = spawn(process.execPath, [script], {
        env: { ...process.env, CORREIA_DADOS: pasta, CORREIA_OPENAI_URL: `http://127.0.0.1:${openaiFalsa.address().port}` },
        stdio: ['ignore', 'pipe', 'pipe'],
      });
      let texto = '';
      p.stdout.on('data', (d) => (texto += d));
      p.stderr.on('data', (d) => (texto += d));
      p.on('close', (codigo) => resolve({ codigo, texto }));
    });
    if (!s.ok('o escritorio de teste roda sem erro', r.codigo === 0, r.texto.slice(-900))) return s;
    const b = JSON.parse(r.texto.trim().split('\n').pop());

    s.ok('chave recusada: sintetizar devolve null (o motor manda o texto), sem derrubar nada', b.chaveRecusada.devolveNull === true);
    s.ok(
      'e entra nas ultimas tentativas, com o status e o motivo',
      b.chaveRecusada.ultima?.ok === false && b.chaveRecusada.ultima?.status === 401 && /Incorrect API key/.test(b.chaveRecusada.ultima?.erro || ''),
      JSON.stringify(b.chaveRecusada.ultima),
    );
    s.ok('deixa uma linha de erro na conversa, dizendo que a resposta saiu em texto', b.chaveRecusada.linhas === 1 && /saiu em texto/.test(b.chaveRecusada.textoDaLinha || ''), String(b.chaveRecusada.textoDaLinha));
    s.ok('nunca guarda um pedaco da chave (nem na linha, nem nas tentativas, nem no aviso)', b.chaveEmLugarNenhum === true);
    s.ok('chave recusada avisa o administrador, e o atendente nao', b.chaveRecusada.avisoAdmin === 1 && b.chaveRecusada.avisoAtendente === 0, JSON.stringify(b.chaveRecusada));
    s.ok('o aviso diz o que conferir e que as respostas seguem em texto', /platform\.openai\.com/.test(b.chaveRecusada.textoDoAviso || '') && /em texto/.test(b.chaveRecusada.textoDoAviso || ''), String(b.chaveRecusada.textoDoAviso));

    s.ok(
      'sem saldo: conta como falha, e o aviso do dia NAO se repete',
      b.semSaldo.devolveNull && b.semSaldo.linhas === 2 && b.semSaldo.avisoAdmin === 1 && b.semSaldo.ultima?.status === 429,
      JSON.stringify(b.semSaldo),
    );
    s.ok(
      'erro do servidor (que passa sozinho): conta como falha, mas nao avisa ninguem a mais',
      b.erroDoServidor.devolveNull && b.erroDoServidor.linhas === 3 && b.erroDoServidor.avisoAdmin === 1 && b.erroDoServidor.ultima?.status === 500,
      JSON.stringify(b.erroDoServidor),
    );
    s.ok('quando funciona, devolve o audio e entra como sucesso', b.funcionou.devolveAudio && b.funcionou.ultima?.ok === true && b.funcionou.linhas === 3, JSON.stringify(b.funcionou));
    s.ok('sem chave nao ha tentativa nem rastro', b.semChave.devolveNull && b.semChave.tentativasNovas === 0 && b.semChave.linhasDoContato2 === 0, JSON.stringify(b.semChave));
    s.ok(
      'o retrato do atendimento conta as tres falhas e mostra os motivos',
      b.saude.em24h === 3 && b.saude.motivos.some((m) => /Incorrect API key/.test(m)) && b.saude.motivos.some((m) => /exceeded your current quota/.test(m)),
      JSON.stringify(b.saude),
    );
  } finally {
    openaiFalsa.closeAllConnections?.();
    await new Promise((ok) => openaiFalsa.close(ok));
    fs.rmSync(pasta, { recursive: true, force: true });
  }
  return s;
}
