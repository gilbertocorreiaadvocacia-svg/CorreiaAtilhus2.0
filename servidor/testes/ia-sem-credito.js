import { spawn } from 'node:child_process';
import fs from 'node:fs';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

import { suite } from './apoio.js';

/**
 * A IA sem credito (ia/saude-da-ia.js), 30/10/2026. O credito da Anthropic
 * acabou e, durante dias, cada mensagem de cliente gerava uma falha e UM aviso
 * no sino por conversa (263 falhas em 7 dias, 492 avisos), e quando o credito
 * voltou ninguem tentou de novo: sete conversas ficaram esperando ate quatro dias.
 *
 * O que nao pode falhar:
 *  - credito acabado ou chave recusada abrem UM episodio e UM aviso aos
 *    administradores, que diz o que fazer; as conversas afetadas nao geram mais
 *    um aviso cada, mas a linha de erro delas no historico continua;
 *  - falha comum (corpo invalido, 429, resposta cortada) continua do jeito de
 *    antes: aviso por conversa, nenhum episodio;
 *  - a primeira resposta bem-sucedida fecha o episodio, avisa que a IA voltou e
 *    retoma as conversas que esperavam, uma resposta so para cada, sem extra;
 *  - conversa velha demais, de pessoa ou de grupo nao e tocada;
 *  - o aviso nao se repete a cada falha.
 *
 * A Anthropic e a de mentira, e e criada aqui: as tres primeiras chamadas
 * (da chave de teste) recusam por falta de credito, as seguintes respondem.
 */
export async function testarIaSemCredito({ raiz }) {
  const s = suite('A IA sem credito avisa uma vez e retoma sozinha');
  const url = (arquivo) => JSON.stringify(pathToFileURL(path.join(raiz, arquivo)).href);
  const pasta = fs.mkdtempSync(path.join(os.tmpdir(), 'ia-sem-credito-'));
  const script = path.join(pasta, 'ia.mjs');

  let chamadasDoCredito = 0;
  const iaFalsa = http.createServer((req, res) => {
    req.resume();
    req.on('end', () => {
      res.setHeader('content-type', 'application/json');
      res.setHeader('connection', 'close');
      /* Outra chave: um erro comum, que nao e de credito nem de chave. */
      if (req.headers['x-api-key'] === 'sk-ant-outro-erro') {
        res.statusCode = 400;
        res.end(JSON.stringify({ type: 'error', error: { type: 'invalid_request_error', message: 'messages: text content blocks must be non-empty' } }));
        return;
      }
      chamadasDoCredito += 1;
      if (chamadasDoCredito <= 3) {
        res.statusCode = 400;
        res.end(JSON.stringify({ type: 'error', error: { type: 'invalid_request_error', message: 'Your credit balance is too low to access the Anthropic API. Please go to Plans & Billing to upgrade or purchase credits.' } }));
        return;
      }
      res.end(JSON.stringify({ id: 'msg_teste', type: 'message', role: 'assistant', model: 'claude-sonnet-5', content: [{ type: 'text', text: 'Olá! Já te explico como funciona.' }], stop_reason: 'end_turn', usage: { input_tokens: 10, output_tokens: 8 } }));
    });
  });
  await new Promise((ok) => iaFalsa.listen(0, '127.0.0.1', ok));

  fs.writeFileSync(
    script,
    `import { iniciarBanco, achar, inserir, listar, mensagensDe, inserirMensagem, encerrarBanco } from ${url('servidor/nucleo/banco.js')};
import { agendarResposta } from ${url('servidor/ia/motor.js')};
import { classificarErroDaIa, iaFalhou, situacaoDaIa } from ${url('servidor/ia/saude-da-ia.js')};
iniciarBanco();
const espera = (ms) => new Promise((ok) => setTimeout(ok, ms));
const esperarAte = async (condicao, ms = 12000) => { const fim = Date.now() + ms; while (Date.now() < fim) { if (condicao()) return true; await espera(50); } return false; };
const ha = (min) => new Date(Date.now() - min * 60000).toISOString();
const resultado = {};

/* O escritorio, com dono, administrador e atendente, e a chave de mentira. */
inserir('workspaces', { id: 'w1', nome: 'Correia' });
inserir('integracoes', { id: 'int1', workspaceId: 'w1', ia: { chaveAnthropic: 'sk-ant-de-mentira' } });
inserir('conexoes', { id: 'cx1', workspaceId: 'w1', tipo: 'simulador', nome: 'Sim' });
for (const [id, papel] of [['dono', 'owner'], ['admin', 'admin'], ['atende', 'atendente']]) {
  inserir('usuarios', { id: 'u-' + id, nome: id });
  inserir('membros', { id: 'm-' + id, workspaceId: 'w1', usuarioId: 'u-' + id, papel });
}
inserir('agentes', { id: 'ag1', workspaceId: 'w1', nome: 'Eduarda', ativo: true, modelo: 'claude-sonnet-5', delaySegundos: 1, prompt: 'Atenda.' });
const agente = { tipo: 'agente', id: 'ag1', nome: 'Eduarda' };
const lead = (id, minutos, extras = {}) => {
  inserir('contatos', { id, workspaceId: 'w1', conexaoId: 'cx1', telefone: '5581900' + String(Math.abs(id.split('').reduce((a, c) => a * 31 + c.charCodeAt(0), 7)) % 1000000).padStart(6, '0'), nome: 'Lead ' + id, estado: 'ia', responsavel: agente, ultimaEntradaEm: ha(minutos), etiquetas: [], ...extras });
  inserirMensagem(id, { direcao: 'entrada', tipo: 'texto', conteudo: 'Oi, preciso de ajuda', autor: { tipo: 'cliente' }, situacao: 'recebida', criadoEm: ha(minutos) });
};
const respostasDe = (id) => mensagensDe(id).filter((m) => m.direcao === 'saida' && !m.templateId).length;
const avisos = (membro, parte) => listar('notificacoes', { membroId: membro }).filter((n) => new RegExp(parte).test(n.titulo));

lead('c1', 30); lead('c2', 20); lead('c3', 10);
lead('c-velha', 100 * 60);                                   /* espera ha 100 horas */
lead('c-pessoa', 15, { estado: 'ativo', responsavel: { tipo: 'membro', id: 'm-atende', nome: 'atende' } });
lead('c-grupo', 12, { grupo: true });

/* 1. As tres falham por credito, quase juntas. */
for (const id of ['c1', 'c2', 'c3']) agendarResposta(achar('contatos', id));
await esperarAte(() => listar('logs', { tipo: 'erro_ia' }).length >= 3);
const meio = {
  situacao: situacaoDaIa('w1'),
  avisosDePara: avisos('m-admin', 'parou de responder').length,
  avisosDoDono: avisos('m-dono', 'parou de responder').length,
  avisosDoAtendente: avisos('m-atende', 'parou de responder').length,
  avisosPorConversa: listar('notificacoes').filter((n) => n.tipo === 'erro_ia').length,
  linhasDeErro: listar('logs', { tipo: 'erro_ia' }).length,
  titulo: avisos('m-admin', 'parou de responder')[0]?.titulo,
  texto: avisos('m-admin', 'parou de responder')[0]?.texto,
};
resultado.meio = meio;

/* 2. O credito "volta" (a 4a chamada responde): a sonda tira a primeira da fila, e o resto sai sozinho. */
const todas = await esperarAte(() => ['c1', 'c2', 'c3'].every((id) => respostasDe(id) >= 1));
await espera(600); /* tempo de uma resposta extra aparecer, se existisse */
resultado.depois = {
  todas,
  respostas: Object.fromEntries(['c1', 'c2', 'c3', 'c-velha', 'c-pessoa', 'c-grupo'].map((id) => [id, respostasDe(id)])),
  situacao: situacaoDaIa('w1'),
  avisosDeVolta: avisos('m-admin', 'voltou a responder').length,
  avisoDeVoltaDoAtendente: avisos('m-atende', 'voltou a responder').length,
  textoDaVolta: avisos('m-admin', 'voltou a responder')[0]?.texto,
  avisosDePara: avisos('m-admin', 'parou de responder').length,
  logsDaIa: listar('logs', { tipo: 'ia_parou' }).length + '/' + listar('logs', { tipo: 'ia_voltou' }).length,
};

/* 3. O aviso nao se repete a cada falha: cinco falhas seguidas num escritorio novo, um aviso so. */
inserir('workspaces', { id: 'w2', nome: 'Outro' });
inserir('usuarios', { id: 'u-adm2', nome: 'adm2' });
inserir('membros', { id: 'm-adm2', workspaceId: 'w2', usuarioId: 'u-adm2', papel: 'admin' });
const credito = Object.assign(new Error('Your credit balance is too low to access the Anthropic API.'), { status: 400 });
const cinco = [1, 2, 3, 4, 5].map(() => iaFalhou('w2', credito).suprimirAvisoPorConversa);
resultado.dedupe = { suprimiram: cinco.every(Boolean), avisos: avisos('m-adm2', 'parou de responder').length, falhas: situacaoDaIa('w2').falhas, problema: situacaoDaIa('w2').problema };

/* 4. Chave recusada abre outro tipo de episodio, com outro texto. */
const chave = Object.assign(new Error('invalid x-api-key'), { status: 401 });
const trocou = iaFalhou('w2', chave);
resultado.chave = { suprimiu: trocou.suprimirAvisoPorConversa, problema: situacaoDaIa('w2').problema, avisos: avisos('m-adm2', 'chave').length };

/* 5. A classificacao. */
const c = (msg, status) => classificarErroDaIa(Object.assign(new Error(msg), status ? { status } : {}));
resultado.classes = {
  credito: c('Your credit balance is too low to access the Anthropic API', 400),
  limiteDeGasto: c('You have reached your specified API usage limits.', 400),
  pagamento: c('payment required', 402),
  chave: c('invalid x-api-key', 401),
  proibida: c('forbidden', 403),
  limite429: c('rate limit', 429),
  sobrecarga: c('Overloaded', 529),
  semResposta: c('Anthropic nao respondeu em 120s'),
  cortada: c('A resposta da IA passou do tamanho maximo e veio cortada; nada foi enviado ao cliente'),
  recusa: c('A IA se recusou a responder esta conversa'),
  corpo: c('messages: text content blocks must be non-empty', 400),
  vazio: classificarErroDaIa(null),
};
const comum = iaFalhou('w2', Object.assign(new Error('rate limit'), { status: 429 }));
resultado.comum = { suprimir: comum.suprimirAvisoPorConversa, classe: comum.classe };

/* 6. Erro comum num escritorio com outra chave: o aviso por conversa continua, e nao abre episodio. */
inserir('workspaces', { id: 'w3', nome: 'Terceiro' });
inserir('integracoes', { id: 'int3', workspaceId: 'w3', ia: { chaveAnthropic: 'sk-ant-outro-erro' } });
inserir('conexoes', { id: 'cx3', workspaceId: 'w3', tipo: 'simulador', nome: 'Sim' });
inserir('usuarios', { id: 'u-adm3', nome: 'adm3' });
inserir('membros', { id: 'm-adm3', workspaceId: 'w3', usuarioId: 'u-adm3', papel: 'admin' });
inserir('agentes', { id: 'ag3', workspaceId: 'w3', nome: 'Eduarda3', ativo: true, modelo: 'claude-sonnet-5', delaySegundos: 1, prompt: 'Atenda.' });
inserir('contatos', { id: 'c-outro', workspaceId: 'w3', conexaoId: 'cx3', telefone: '5581900777777', nome: 'Lead outro', estado: 'ia', responsavel: { tipo: 'agente', id: 'ag3', nome: 'Eduarda3' }, ultimaEntradaEm: ha(5), etiquetas: [] });
inserirMensagem('c-outro', { direcao: 'entrada', tipo: 'texto', conteudo: 'Oi', autor: { tipo: 'cliente' }, situacao: 'recebida', criadoEm: ha(5) });
agendarResposta(achar('contatos', 'c-outro'));
await esperarAte(() => listar('notificacoes', { membroId: 'm-adm3' }).some((n) => n.tipo === 'erro_ia'));
resultado.erroComum = {
  avisoPorConversa: listar('notificacoes', { membroId: 'm-adm3' }).filter((n) => n.tipo === 'erro_ia').length,
  episodio: situacaoDaIa('w3').problema,
  avisoDePara: avisos('m-adm3', 'parou de responder').length,
};

console.log(JSON.stringify(resultado));
await encerrarBanco();
/* No Windows, sair com uma conexao ainda fechando derruba o processo com um erro do libuv. */
await espera(300);
process.exit(0);
`,
  );

  try {
    const r = await new Promise((resolve) => {
      const p = spawn(process.execPath, [script], {
        env: {
          ...process.env,
          CORREIA_DADOS: pasta,
          CORREIA_ANTHROPIC_URL: `http://127.0.0.1:${iaFalsa.address().port}`,
          CORREIA_SONDA_IA_MS: '300',
          CORREIA_RETOMADA_IA_ESPACO_MS: '50',
        },
        stdio: ['ignore', 'pipe', 'pipe'],
      });
      let texto = '';
      p.stdout.on('data', (d) => (texto += d));
      p.stderr.on('data', (d) => (texto += d));
      p.on('close', (codigo) => resolve({ codigo, texto }));
    });
    if (!s.ok('o escritorio de teste roda sem erro', r.codigo === 0, r.texto.slice(-900))) return s;
    const b = JSON.parse(r.texto.trim().split('\n').pop());

    s.ok(
      'tres falhas por credito abrem UM episodio',
      b.meio.situacao.problema === 'credito' && b.meio.situacao.falhas >= 1 && Boolean(b.meio.situacao.desde),
      JSON.stringify(b.meio.situacao),
    );
    s.ok('e UM aviso, para o administrador e para o dono', b.meio.avisosDePara === 1 && b.meio.avisosDoDono === 1, JSON.stringify(b.meio));
    s.ok('o atendente nao recebe o aviso do sistema', b.meio.avisosDoAtendente === 0, String(b.meio.avisosDoAtendente));
    s.ok('nenhum aviso por conversa: o unico aviso substitui os tres', b.meio.avisosPorConversa === 0, String(b.meio.avisosPorConversa));
    s.ok('mas a linha de erro de cada conversa continua no historico', b.meio.linhasDeErro === 3, String(b.meio.linhasDeErro));
    s.ok(
      'o aviso diz o que fazer: o painel, o botao de testar e que o sistema retoma sozinho',
      /Anthropic/.test(b.meio.titulo || '') && /console\.anthropic\.com/.test(b.meio.texto || '') && /Testar conexão/.test(b.meio.texto || '') && /retoma sozinho/.test(b.meio.texto || ''),
      JSON.stringify({ titulo: b.meio.titulo, texto: b.meio.texto }),
    );

    s.ok('quando a IA volta, as tres conversas que esperavam sao respondidas', b.depois.todas, JSON.stringify(b.depois.respostas));
    s.ok(
      'uma resposta so para cada, sem resposta extra',
      b.depois.respostas.c1 === 1 && b.depois.respostas.c2 === 1 && b.depois.respostas.c3 === 1 && chamadasDoCredito === 6,
      JSON.stringify({ respostas: b.depois.respostas, chamadasAIa: chamadasDoCredito }),
    );
    s.ok(
      'a conversa de 100 horas, a de pessoa e o grupo nao sao tocados',
      b.depois.respostas['c-velha'] === 0 && b.depois.respostas['c-pessoa'] === 0 && b.depois.respostas['c-grupo'] === 0,
      JSON.stringify(b.depois.respostas),
    );
    s.ok('o episodio fecha, e fica registrado quando voltou', b.depois.situacao.problema === null && Boolean(b.depois.situacao.voltouEm), JSON.stringify(b.depois.situacao));
    s.ok('os administradores sao avisados da volta, uma vez, e dizendo quantas conversas', b.depois.avisosDeVolta === 1 && /2 conversas/.test(b.depois.textoDaVolta || ''), JSON.stringify({ avisos: b.depois.avisosDeVolta, texto: b.depois.textoDaVolta }));
    s.ok('o atendente tambem nao recebe esse', b.depois.avisoDeVoltaDoAtendente === 0);
    s.ok('o aviso de parada continua sendo um so', b.depois.avisosDePara === 1, String(b.depois.avisosDePara));
    s.ok('as duas que a fila retomou aparecem na contagem', b.depois.situacao.retomadas === 2, JSON.stringify(b.depois.situacao));
    s.ok('cada virada fica no registro do escritorio', b.depois.logsDaIa === '1/1', b.depois.logsDaIa);

    s.ok('cinco falhas seguidas: um aviso so, e todas contadas', b.dedupe.suprimiram && b.dedupe.avisos === 1 && b.dedupe.falhas === 5 && b.dedupe.problema === 'credito', JSON.stringify(b.dedupe));
    s.ok('chave recusada e outro episodio, com aviso proprio, e tambem suprime o aviso por conversa', b.chave.suprimiu && b.chave.problema === 'chave' && b.chave.avisos === 1, JSON.stringify(b.chave));

    s.ok(
      'a classificacao: credito, limite de gasto e pagamento pedem pessoa',
      b.classes.credito === 'credito' && b.classes.limiteDeGasto === 'credito' && b.classes.pagamento === 'credito',
      JSON.stringify(b.classes),
    );
    s.ok('chave invalida e proibida pedem pessoa', b.classes.chave === 'chave' && b.classes.proibida === 'chave', JSON.stringify(b.classes));
    s.ok(
      'limite, sobrecarga e tempo esgotado passam sozinhos',
      b.classes.limite429 === 'passageiro' && b.classes.sobrecarga === 'passageiro' && b.classes.semResposta === 'passageiro',
      JSON.stringify(b.classes),
    );
    s.ok(
      'resposta cortada, recusa, corpo invalido e erro vazio ficam do jeito de antes',
      b.classes.cortada === 'outro' && b.classes.recusa === 'outro' && b.classes.corpo === 'outro' && b.classes.vazio === 'outro',
      JSON.stringify(b.classes),
    );
    s.ok('erro passageiro nao suprime o aviso por conversa nem abre episodio', b.comum.suprimir === false && b.comum.classe === 'passageiro', JSON.stringify(b.comum));
    s.ok(
      'erro comum de verdade: o aviso por conversa continua, e nenhum episodio',
      b.erroComum.avisoPorConversa === 1 && b.erroComum.episodio === null && b.erroComum.avisoDePara === 0,
      JSON.stringify(b.erroComum),
    );
  } finally {
    iaFalsa.closeAllConnections?.();
    await new Promise((ok) => iaFalsa.close(ok));
    fs.rmSync(pasta, { recursive: true, force: true });
  }
  return s;
}
