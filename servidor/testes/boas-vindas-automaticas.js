import { spawn } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

import { cliente, suite } from './apoio.js';

/**
 * O video de boas-vindas sai sozinho, uma vez por conversa
 * (nucleo/boas-vindas-automaticas.js). Etapa 2 do plano de 30/10/2026: o video
 * salvo no template nao chegava aos leads, porque so os tres especialistas
 * mandavam o @bemvindo e a Eduarda, que recebe a maior parte, nunca mandava.
 *
 * O que nao pode falhar:
 *  - chave DESLIGADA (o padrao): nada muda, ninguem recebe video;
 *  - ligada: o lead novo recebe o template ANTES da primeira resposta do agente,
 *    uma so vez, mesmo com varias rodadas e mesmo se o agente tentar mandar o
 *    mesmo template (a ferramenta ignora);
 *  - nunca para conversa que ja existia quando a chave foi ligada, nem para
 *    conversa em que alguem ja falou com o cliente, nem sem video de verdade;
 *  - video que falha desiste depois de duas tentativas, sem derrubar a resposta;
 *  - a rota recusa ligar sem video, so liga o template do proprio escritorio, e
 *    "ligadaEm" so muda na virada de desligada para ligada.
 */
export async function testarBoasVindasAutomaticas({ base, raiz }) {
  const s = suite('O video de boas-vindas sai sozinho, uma vez, antes da primeira resposta');
  const url = (arquivo) => JSON.stringify(pathToFileURL(path.join(raiz, arquivo)).href);
  const pasta = fs.mkdtempSync(path.join(os.tmpdir(), 'boas-vindas-'));
  const script = path.join(pasta, 'boas-vindas.mjs');
  fs.writeFileSync(
    script,
    `import http from 'node:http';
import { iniciarBanco, achar, atualizar, inserir, inserirMensagem, mensagensDe, encerrarBanco } from ${url('servidor/nucleo/banco.js')};
import { guardarBuffer } from ${url('servidor/nucleo/midia.js')};
import { executarAgente } from ${url('servidor/ia/motor.js')};
import { executarFerramenta } from ${url('servidor/ia/mencoes.js')};
import { configDasBoasVindas, templateDasBoasVindas } from ${url('servidor/nucleo/boas-vindas-automaticas.js')};
iniciarBanco();

/* Uma Evolution de mentira que recusa todo envio, para provocar a falha. */
const recusa = http.createServer((req, res) => {
  req.resume();
  req.on('end', () => { res.statusCode = 500; res.setHeader('content-type', 'application/json'); res.setHeader('connection', 'close'); res.end('{"erro":"falha de teste"}'); });
});
await new Promise((ok) => recusa.listen(0, '127.0.0.1', ok));
const portaRecusa = recusa.address().port;

const ha = (min) => new Date(Date.now() - min * 60000).toISOString();
const video = guardarBuffer({ nome: 'boas-vindas.mp4', dados: Buffer.from('video de boas-vindas'), mime: 'video/mp4' });
const resultado = {};

const novoEscritorio = (id, { boasVindas, template = true, conexao = 'simulador' } = {}) => {
  inserir('workspaces', { id, nome: 'Escritorio ' + id, ...(boasVindas ? { boasVindas } : {}) });
  inserir('conexoes', conexao === 'simulador'
    ? { id: 'cx-' + id, workspaceId: id, tipo: 'simulador', nome: 'Sim' }
    : { id: 'cx-' + id, workspaceId: id, tipo: 'qrcode', nome: 'QR', estado: 'conectado', qrcode: { servidor: 'http://127.0.0.1:' + portaRecusa, chave: 'x', instancia: 'teste' } });
  inserir('agentes', { id: 'ag-' + id, workspaceId: id, nome: 'Eduarda ' + id, ativo: true, modelo: 'regras', prompt: 'Atenda. Envie @bemvindo se precisar.' });
  if (template === 'com-video') inserir('templates', { id: 'tp-' + id, workspaceId: id, nome: 'Boas-vindas', atalho: 'bemvindo', conteudo: 'Ola {{nome}}! Assista ao video.', midia: video });
  if (template === 'sem-video') inserir('templates', { id: 'tp-' + id, workspaceId: id, nome: 'Boas-vindas', atalho: 'bemvindo', conteudo: 'So texto.' });
};
let contador = 0;
const novoLead = (id, w, { criadoEm, saida = false } = {}) => {
  inserir('contatos', { id, workspaceId: w, conexaoId: 'cx-' + w, telefone: '5581900' + String(++contador).padStart(6, '0'), nome: 'Lead ' + id, estado: 'ia', responsavel: { tipo: 'agente', id: 'ag-' + w, nome: 'Eduarda ' + w }, ultimaEntradaEm: ha(1), etiquetas: [], ...(criadoEm ? { criadoEm } : {}) });
  inserirMensagem(id, { direcao: 'entrada', tipo: 'texto', conteudo: 'Oi, preciso de ajuda', autor: { tipo: 'cliente' }, situacao: 'recebida', criadoEm: ha(1) });
  if (saida) inserirMensagem(id, { direcao: 'saida', tipo: 'texto', conteudo: 'Ja falei com ele', autor: { tipo: 'membro', id: 'm', nome: 'Pessoa' }, situacao: 'enviada', criadoEm: ha(0.5) });
};
const videos = (id) => mensagensDe(id).filter((m) => m.direcao === 'saida' && m.templateId);

/* 1. Chave desligada (padrao): nada muda. */
novoEscritorio('w-off', { template: 'com-video' });
novoLead('c-off', 'w-off');
await executarAgente('c-off');
resultado.desligada = { videos: videos('c-off').length, marcou: Boolean(achar('contatos', 'c-off').boasVindasEnviadasEm), config: configDasBoasVindas('w-off') };

/* 2. Chave ligada: o lead novo recebe o video antes da primeira resposta, uma vez. */
novoEscritorio('w-on', { template: 'com-video', boasVindas: { automatica: true, templateId: 'tp-w-on', ligadaEm: ha(60) } });
novoLead('c-novo', 'w-on');
await executarAgente('c-novo');
const depoisDaPrimeira = mensagensDe('c-novo').filter((m) => m.direcao === 'saida');
resultado.ligada = {
  videos: videos('c-novo').length,
  primeiraSaidaEhOVideo: Boolean(depoisDaPrimeira[0]?.templateId) && depoisDaPrimeira[0]?.tipo === 'video',
  haRespostaDepois: depoisDaPrimeira.length >= 2,
  textoComNome: depoisDaPrimeira[0]?.conteudo,
  marcou: Boolean(achar('contatos', 'c-novo').boasVindasEnviadasEm),
  usoDoTemplate: achar('templates', 'tp-w-on').uso?.enviados,
};

/* 3. Segunda rodada: nao repete. */
inserirMensagem('c-novo', { direcao: 'entrada', tipo: 'texto', conteudo: 'Mais uma duvida', autor: { tipo: 'cliente' }, situacao: 'recebida', criadoEm: new Date().toISOString() });
atualizar('contatos', 'c-novo', { ultimaEntradaEm: new Date().toISOString() });
await executarAgente('c-novo');
resultado.segundaRodada = { videos: videos('c-novo').length };

/* 4. O especialista tenta mandar o mesmo template: a ferramenta ignora. */
const antes = mensagensDe('c-novo').length;
const agente = achar('agentes', 'ag-w-on');
const chamada = await executarFerramenta({ nome: 'enviar_template', argumentos: { template: 'bemvindo' }, contato: achar('contatos', 'c-novo'), agente, conexao: achar('conexoes', 'cx-w-on'), workspaceId: 'w-on' });
resultado.ferramenta = { ok: chamada.ok, jaEnviado: chamada.ja_enviado === true, mensagensNovas: mensagensDe('c-novo').length - antes };

/* 5. Quem nao recebeu automatico continua mandando normalmente (chave desligada). */
const normal = await executarFerramenta({ nome: 'enviar_template', argumentos: { template: 'bemvindo' }, contato: achar('contatos', 'c-off'), agente: achar('agentes', 'ag-w-off'), conexao: achar('conexoes', 'cx-w-off'), workspaceId: 'w-off' });
resultado.chaveDesligadaFerramenta = { jaEnviado: normal.ja_enviado === true, videos: videos('c-off').length };

/* 6. Conversa que ja existia quando a chave foi ligada, e conversa em que alguem ja falou. */
novoLead('c-antiga', 'w-on', { criadoEm: ha(600) });
await executarAgente('c-antiga');
resultado.conversaAntiga = { videos: videos('c-antiga').length };
novoLead('c-ja-falaram', 'w-on', { saida: true });
await executarAgente('c-ja-falaram');
resultado.alguemJaFalou = { videos: videos('c-ja-falaram').length };

/* 7. Template sem video de verdade, e template que nem existe: nada a mandar, sem erro. */
novoEscritorio('w-sem-video', { template: 'sem-video', boasVindas: { automatica: true, templateId: 'tp-w-sem-video', ligadaEm: ha(60) } });
novoLead('c-sem-video', 'w-sem-video');
await executarAgente('c-sem-video');
resultado.semVideo = { videos: videos('c-sem-video').length, respondeu: mensagensDe('c-sem-video').some((m) => m.direcao === 'saida') };
novoEscritorio('w-sem-template', { template: false, boasVindas: { automatica: true, templateId: null, ligadaEm: ha(60) } });
novoLead('c-sem-template', 'w-sem-template');
await executarAgente('c-sem-template');
resultado.semTemplate = { videos: videos('c-sem-template').length, respondeu: mensagensDe('c-sem-template').some((m) => m.direcao === 'saida') };

/* 8. O padrao sem escolha: o @bemvindo do escritorio. */
novoEscritorio('w-padrao', { template: 'com-video', boasVindas: { automatica: true, templateId: null, ligadaEm: ha(60) } });
resultado.padrao = templateDasBoasVindas('w-padrao')?.atalho;

/* 9. O video falha: tenta duas vezes seguidas (antes da resposta), desiste, e o agente responde mesmo assim. */
novoEscritorio('w-falha', { template: 'com-video', conexao: 'qrcode', boasVindas: { automatica: true, templateId: 'tp-w-falha', ligadaEm: ha(60) } });
novoLead('c-falha', 'w-falha');
await executarAgente('c-falha');
const apos1 = { falhas: achar('contatos', 'c-falha').boasVindasFalhas, marcou: Boolean(achar('contatos', 'c-falha').boasVindasEnviadasEm) };
for (const n of [2, 3]) {
  inserirMensagem('c-falha', { direcao: 'entrada', tipo: 'texto', conteudo: 'Rodada ' + n, autor: { tipo: 'cliente' }, situacao: 'recebida', criadoEm: new Date().toISOString() });
  atualizar('contatos', 'c-falha', { ultimaEntradaEm: new Date().toISOString() });
  await executarAgente('c-falha');
}
const tentativasDoVideo = mensagensDe('c-falha').filter((m) => m.templateId).length;
resultado.falha = { apos1, falhasNoFim: achar('contatos', 'c-falha').boasVindasFalhas, tentativasDoVideo, respondeu: mensagensDe('c-falha').some((m) => m.direcao === 'saida' && !m.templateId), marcou: Boolean(achar('contatos', 'c-falha').boasVindasEnviadasEm), logs: (await import(${url('servidor/nucleo/banco.js')})).listar('logs', { contatoId: 'c-falha' }).filter((l) => l.tipo === 'boas_vindas_falhou').length, usoFalhas: achar('templates', 'tp-w-falha').uso?.falhas };

console.log(JSON.stringify(resultado));
recusa.closeAllConnections?.();
await new Promise((ok) => recusa.close(ok));
await encerrarBanco();
/* No Windows, sair com uma conexao ainda fechando derruba o processo com um
   erro do libuv (UV_HANDLE_CLOSING) e o codigo de saida deixa de ser zero. */
await new Promise((ok) => setTimeout(ok, 300));
process.exit(0);
`,
  );

  try {
    const r = await new Promise((resolve) => {
      const p = spawn(process.execPath, [script], { env: { ...process.env, CORREIA_DADOS: pasta, CORREIA_BOASVINDAS_ESPERA_MS: '50' }, stdio: ['ignore', 'pipe', 'pipe'] });
      let texto = '';
      p.stdout.on('data', (d) => (texto += d));
      p.stderr.on('data', (d) => (texto += d));
      p.on('close', (codigo) => resolve({ codigo, texto }));
    });
    if (!s.ok('o escritorio de teste roda sem erro', r.codigo === 0, r.texto.slice(-900))) return s;
    const b = JSON.parse(r.texto.trim().split('\n').pop());

    s.ok('chave desligada (o padrao): ninguem recebe video e nada e marcado', b.desligada.videos === 0 && !b.desligada.marcou && b.desligada.config.automatica === false, JSON.stringify(b.desligada));

    s.ok('ligada: o lead novo recebe o video uma vez', b.ligada.videos === 1 && b.ligada.marcou, JSON.stringify(b.ligada));
    s.ok('e e a PRIMEIRA coisa que sai, antes da resposta do agente', b.ligada.primeiraSaidaEhOVideo && b.ligada.haRespostaDepois, JSON.stringify(b.ligada));
    s.ok('o texto do template leva o nome do cliente', /Ola Lead c-novo/.test(b.ligada.textoComNome || ''), b.ligada.textoComNome);
    s.ok('e o contador do template conta a saida', b.ligada.usoDoTemplate === 1, String(b.ligada.usoDoTemplate));
    s.ok('segunda rodada na mesma conversa: nao repete', b.segundaRodada.videos === 1, JSON.stringify(b.segundaRodada));
    s.ok(
      'o especialista que tenta mandar o mesmo template e ignorado, sem mensagem nova',
      b.ferramenta.ok === true && b.ferramenta.jaEnviado && b.ferramenta.mensagensNovas === 0,
      JSON.stringify(b.ferramenta),
    );
    s.ok('com a chave desligada o template continua saindo pela ferramenta, como sempre', !b.chaveDesligadaFerramenta.jaEnviado && b.chaveDesligadaFerramenta.videos === 1, JSON.stringify(b.chaveDesligadaFerramenta));

    s.ok('conversa que ja existia quando a chave foi ligada nao recebe', b.conversaAntiga.videos === 0, JSON.stringify(b.conversaAntiga));
    s.ok('conversa em que alguem ja falou com o cliente nao recebe', b.alguemJaFalou.videos === 0, JSON.stringify(b.alguemJaFalou));
    s.ok('template sem video de verdade: nada a mandar, e o agente responde igual', b.semVideo.videos === 0 && b.semVideo.respondeu, JSON.stringify(b.semVideo));
    s.ok('sem template nenhum: idem, sem erro', b.semTemplate.videos === 0 && b.semTemplate.respondeu, JSON.stringify(b.semTemplate));
    s.ok('sem escolha na chave, vale o @bemvindo do escritorio', b.padrao === 'bemvindo', String(b.padrao));

    s.ok(
      'video que falha: tenta duas vezes seguidas, antes da resposta, e nunca vira "enviado"',
      b.falha.apos1.falhas === 2 && b.falha.tentativasDoVideo === 2 && !b.falha.marcou,
      JSON.stringify(b.falha),
    );
    s.ok('desistiu: as rodadas seguintes nao tentam de novo, e o agente respondeu mesmo sem o video', b.falha.falhasNoFim === 2 && b.falha.tentativasDoVideo === 2 && b.falha.respondeu, JSON.stringify(b.falha));
    s.ok('cada falha fica no log da conversa e no contador do template', b.falha.logs === 2 && b.falha.usoFalhas === 2, JSON.stringify(b.falha));

    /* ---------------- A rota da chave ---------------- */

    const api = cliente(base);
    await api.entrar();
    const subir = async (nome, mime) =>
      (await api.post('/api/midia', { nome, mime, conteudoBase64: `data:${mime};base64,${Buffer.from(`conteudo de ${nome}`).toString('base64')}` })).dados;

    const inicial = (await api.get('/api/boas-vindas')).dados;
    s.ok('a chave nasce desligada', inicial?.automatica === false && inicial?.ligadaEm === null, JSON.stringify(inicial));

    const semTemplate = await api.put('/api/boas-vindas', { automatica: true, templateId: null });
    const textoDeTemplate = (await api.post('/api/templates', { nome: 'Boas-vindas so texto', atalho: 'bvsotexto', conteudo: 'So texto' })).dados;
    const semVideo = await api.put('/api/boas-vindas', { automatica: true, templateId: textoDeTemplate.id });
    s.ok(
      'ligar sem template, ou com template sem video, e recusado e diz o que fazer',
      semTemplate.status === 400 && semVideo.status === 400 && /vídeo/.test(semVideo.dados?.erro || ''),
      JSON.stringify({ semTemplate: semTemplate.dados, semVideo: semVideo.dados }),
    );
    s.ok('e continua desligada', (await api.get('/api/boas-vindas')).dados?.automatica === false);

    const midia = await subir('boas-vindas-da-rota.mp4', 'video/mp4');
    const comVideo = (await api.post('/api/templates', { nome: 'Boas-vindas com video', atalho: 'bvrota', conteudo: 'Ola {{nome}}', midia })).dados;
    const ligou = await api.put('/api/boas-vindas', { automatica: true, templateId: comVideo.id });
    s.ok(
      'com video, liga e guarda o template e a hora em que ligou',
      ligou.status === 200 && ligou.dados?.automatica === true && ligou.dados?.templateId === comVideo.id && Boolean(ligou.dados?.ligadaEm) && ligou.dados?.template?.temVideo === true,
      JSON.stringify(ligou.dados),
    );

    const religou = await api.put('/api/boas-vindas', { automatica: true });
    s.ok('ligar de novo nao muda a hora em que ligou', religou.dados?.ligadaEm === ligou.dados?.ligadaEm, JSON.stringify({ antes: ligou.dados?.ligadaEm, depois: religou.dados?.ligadaEm }));

    const inexistente = await api.put('/api/boas-vindas', { templateId: 'tpl-que-nao-existe-aqui' });
    s.ok('template que nao existe neste escritorio: 404, e nada muda', inexistente.status === 404 && (await api.get('/api/boas-vindas')).dados?.templateId === comVideo.id, JSON.stringify(inexistente.dados));

    const desligou = await api.put('/api/boas-vindas', { automatica: false });
    s.ok('desligar guarda a escolha do template e zera a hora', desligou.dados?.automatica === false && desligou.dados?.ligadaEm === null && desligou.dados?.templateId === comVideo.id, JSON.stringify(desligou.dados));

    const saude = (await fetch(`${base}/api/saude`).then((x) => x.json())).varredura?.escritorios || [];
    s.ok('a saude mostra a chave e o template', saude.some((e) => e.boasVindas && 'ligada' in e.boasVindas && 'temVideo' in e.boasVindas), JSON.stringify(saude.map((e) => e.boasVindas)));

    await api.delete(`/api/templates/${textoDeTemplate.id}`);
  } finally {
    fs.rmSync(pasta, { recursive: true, force: true });
  }
  return s;
}
