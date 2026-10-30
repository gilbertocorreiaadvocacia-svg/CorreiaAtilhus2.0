import { spawn } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

import { suite } from './apoio.js';

/**
 * Envio de template que diz a verdade (etapa 3 do video de boas-vindas,
 * 30/10/2026). Ate aqui enviar_template devolvia `ok` ao modelo mesmo com o
 * WhatsApp recusando o envio, e ele contava ao cliente que "ja mandei o video".
 *
 * O que nao pode falhar:
 *  - envio que sai: continua devolvendo ok, sem aviso a ninguem;
 *  - envio recusado: o modelo recebe "o cliente NAO recebeu" e a conversa
 *    registra, com o motivo;
 *  - tempo esgotado e outra coisa: o modelo recebe "talvez", sem afirmar nem
 *    negar, e e mandado nao reenviar (duplicaria o video);
 *  - a equipe (so dono e administrador) recebe UM aviso por dia por template com
 *    arquivo; template so de texto nao avisa, e o aviso nao leva telefone;
 *  - as boas-vindas automaticas nao repetem o envio depois de tempo esgotado;
 *  - o prazo do envio de arquivo cresce com o tamanho e nunca fica abaixo dos
 *    60 segundos de antes.
 */
export async function testarEnvioConfiavelDeTemplate({ raiz }) {
  const s = suite('Template que nao saiu nao e contado ao modelo como enviado');
  const url = (arquivo) => JSON.stringify(pathToFileURL(path.join(raiz, arquivo)).href);
  const pasta = fs.mkdtempSync(path.join(os.tmpdir(), 'envio-confiavel-'));
  const script = path.join(pasta, 'envio.mjs');
  fs.writeFileSync(
    script,
    `import http from 'node:http';
import { iniciarBanco, achar, inserir, listar, mensagensDe, encerrarBanco } from ${url('servidor/nucleo/banco.js')};
import { guardarBuffer } from ${url('servidor/nucleo/midia.js')};
import { executarFerramenta } from ${url('servidor/ia/mencoes.js')};
import { enviarBoasVindasSePrecisar } from ${url('servidor/nucleo/boas-vindas-automaticas.js')};
import { prazoDoEnvioDeMidia } from ${url('servidor/whatsapp/drivers/qrcode.js')};
iniciarBanco();

/* Um servico que recusa todo envio, e um que aceita a conexao e nunca responde. */
const recusa = http.createServer((req, res) => {
  req.resume();
  req.on('end', () => { res.statusCode = 500; res.setHeader('content-type', 'application/json'); res.setHeader('connection', 'close'); res.end('{"message":"o numero 5581900001234 nao tem WhatsApp"}'); });
});
const mudo = http.createServer((req) => { req.resume(); });
await new Promise((ok) => recusa.listen(0, '127.0.0.1', ok));
await new Promise((ok) => mudo.listen(0, '127.0.0.1', ok));
const qr = (servidor) => ({ servidor: 'http://127.0.0.1:' + servidor.address().port, chave: 'x', instancia: 'teste' });

const ha = (min) => new Date(Date.now() - min * 60000).toISOString();
const video = guardarBuffer({ nome: 'boas-vindas.mp4', dados: Buffer.from('video de boas-vindas'), mime: 'video/mp4' });
const resultado = {};

inserir('workspaces', { id: 'w1', nome: 'Correia' });
inserir('usuarios', { id: 'u-admin', nome: 'Admin Teste' });
inserir('membros', { id: 'm-admin', workspaceId: 'w1', usuarioId: 'u-admin', papel: 'admin' });
inserir('usuarios', { id: 'u-dono', nome: 'Dono Teste' });
inserir('membros', { id: 'm-dono', workspaceId: 'w1', usuarioId: 'u-dono', papel: 'owner' });
inserir('usuarios', { id: 'u-atende', nome: 'Atendente Teste' });
inserir('membros', { id: 'm-atende', workspaceId: 'w1', usuarioId: 'u-atende', papel: 'atendente' });
inserir('conexoes', { id: 'cx-sim', workspaceId: 'w1', tipo: 'simulador', nome: 'Sim' });
inserir('conexoes', { id: 'cx-recusa', workspaceId: 'w1', tipo: 'qrcode', nome: 'QR recusa', estado: 'conectado', qrcode: qr(recusa) });
inserir('conexoes', { id: 'cx-mudo', workspaceId: 'w1', tipo: 'qrcode', nome: 'QR mudo', estado: 'conectado', qrcode: qr(mudo) });
inserir('agentes', { id: 'ag1', workspaceId: 'w1', nome: 'Eduarda', ativo: true, modelo: 'regras', prompt: 'Atenda.' });
inserir('templates', { id: 'tp-video', workspaceId: 'w1', nome: 'Boas-vindas', atalho: 'bemvindo', conteudo: 'Ola {{nome}}!', midia: video });
inserir('templates', { id: 'tp-texto', workspaceId: 'w1', nome: 'So texto', atalho: 'sotexto', conteudo: 'Um texto.' });
let n = 0;
const lead = (id, conexaoId) => inserir('contatos', { id, workspaceId: 'w1', conexaoId, telefone: '5581900' + String(++n).padStart(6, '0'), nome: 'Lead ' + id, estado: 'ia', responsavel: { tipo: 'agente', id: 'ag1', nome: 'Eduarda' }, ultimaEntradaEm: ha(1), etiquetas: [] });
const enviar = (contatoId, template) => executarFerramenta({ nome: 'enviar_template', argumentos: { template }, contato: achar('contatos', contatoId), agente: achar('agentes', 'ag1'), conexao: achar('conexoes', achar('contatos', contatoId).conexaoId), workspaceId: 'w1' });
const avisos = (membroId) => listar('notificacoes', { membroId }).filter((x) => /nao saiu|não saiu/.test(x.titulo));

/* 1. Sai: continua ok, ninguem e avisado. */
lead('c-ok', 'cx-sim');
const ok = await enviar('c-ok', 'bemvindo');
resultado.sai = { ok: ok.ok === true, enviado: ok.enviado, situacao: mensagensDe('c-ok').find((m) => m.templateId)?.situacao, avisos: avisos('m-admin').length };

/* 2. Recusado: o modelo e a conversa sabem. */
lead('c-recusa', 'cx-recusa');
const recusado = await enviar('c-recusa', 'bemvindo');
const msgRecusada = mensagensDe('c-recusa').find((m) => m.templateId);
resultado.recusado = {
  ok: recusado.ok === true,
  enviado: recusado.enviado,
  clienteRecebeu: recusado.cliente_recebeu,
  erro: recusado.erro,
  situacao: msgRecusada?.situacao,
  logs: listar('logs', { contatoId: 'c-recusa' }).filter((l) => /Template NÃO enviado/.test(l.descricao || '')).length,
  motivoNaConversa: listar('logs', { contatoId: 'c-recusa' }).some((l) => /Template NÃO enviado/.test(l.descricao || '') && /5581900001234/.test(l.descricao || '')),
  uso: achar('templates', 'tp-video').uso,
};

/* 3. A equipe: so dono e administrador, uma vez, sem telefone. */
const aviso = avisos('m-admin')[0];
resultado.equipe = {
  admin: avisos('m-admin').length,
  dono: avisos('m-dono').length,
  atendente: avisos('m-atende').length,
  titulo: aviso?.titulo,
  texto: aviso?.texto,
  semTelefone: aviso ? !/\\d{6,}/.test(aviso.texto + aviso.titulo) : null,
  comNome: /Lead c-recusa/.test(aviso?.texto || ''),
  levaAoContato: aviso?.contatoId === 'c-recusa',
};

/* 4. Outra falha do mesmo template no mesmo dia: o mesmo aviso, sem repetir. */
lead('c-recusa-2', 'cx-recusa');
await enviar('c-recusa-2', 'bemvindo');
resultado.repetida = { admin: avisos('m-admin').length, falhas: achar('templates', 'tp-video').uso?.falhas };

/* 5. Template so de texto que falha nao avisa ninguem (so conta). */
lead('c-texto', 'cx-recusa');
const texto = await enviar('c-texto', 'sotexto');
resultado.soTexto = { erro: Boolean(texto.erro), enviado: texto.enviado, admin: avisos('m-admin').length, falhas: achar('templates', 'tp-texto').uso?.falhas };

/* 6. Tempo esgotado: o modelo nao pode afirmar nem negar, e nao reenvia. */
lead('c-mudo', 'cx-mudo');
const esgotado = await enviar('c-mudo', 'bemvindo');
const msgMuda = mensagensDe('c-mudo').find((m) => m.templateId);
resultado.esgotado = {
  ok: esgotado.ok === true,
  enviado: esgotado.enviado,
  clienteRecebeu: esgotado.cliente_recebeu,
  erro: esgotado.erro,
  codigo: msgMuda?.erro?.codigo,
  textoDaMensagem: msgMuda?.erro?.mensagem,
};

/* 7. Boas-vindas automaticas: depois de tempo esgotado, nao tenta de novo. */
inserir('workspaces', { id: 'w2', nome: 'Outro', boasVindas: { automatica: true, templateId: 'tp-w2', ligadaEm: ha(60) } });
inserir('conexoes', { id: 'cx-w2', workspaceId: 'w2', tipo: 'qrcode', nome: 'QR mudo', estado: 'conectado', qrcode: qr(mudo) });
inserir('agentes', { id: 'ag-w2', workspaceId: 'w2', nome: 'Eduarda', ativo: true, modelo: 'regras', prompt: 'Atenda.' });
inserir('templates', { id: 'tp-w2', workspaceId: 'w2', nome: 'Boas-vindas', atalho: 'bemvindo', conteudo: 'Ola!', midia: video });
inserir('contatos', { id: 'c-w2', workspaceId: 'w2', conexaoId: 'cx-w2', telefone: '5581900999999', nome: 'Lead w2', estado: 'ia', responsavel: { tipo: 'agente', id: 'ag-w2', nome: 'Eduarda' }, ultimaEntradaEm: ha(1), etiquetas: [] });
await enviarBoasVindasSePrecisar({ contato: achar('contatos', 'c-w2'), agente: achar('agentes', 'ag-w2'), conexao: achar('conexoes', 'cx-w2') });
resultado.boasVindasEsgotadas = {
  tentativas: mensagensDe('c-w2').filter((m) => m.templateId).length,
  falhas: achar('contatos', 'c-w2').boasVindasFalhas,
  marcou: Boolean(achar('contatos', 'c-w2').boasVindasEnviadasEm),
};

/* 8. O prazo do envio de arquivo: nunca abaixo de antes, cresce com o tamanho, tem teto. */
const fixo = process.env.CORREIA_PRAZO_ENVIO_MS;
resultado.fixoDoTeste = prazoDoEnvioDeMidia(5 * 1024 * 1024);
delete process.env.CORREIA_PRAZO_ENVIO_MS;
const MB = 1024 * 1024;
resultado.prazos = { vazio: prazoDoEnvioDeMidia(0), semArgumento: prazoDoEnvioDeMidia(), negativo: prazoDoEnvioDeMidia(-5), umMega: prazoDoEnvioDeMidia(MB), cincoMegas: prazoDoEnvioDeMidia(5 * MB), dezesseis: prazoDoEnvioDeMidia(16 * MB), enorme: prazoDoEnvioDeMidia(500 * MB) };
if (fixo) process.env.CORREIA_PRAZO_ENVIO_MS = fixo;

console.log(JSON.stringify(resultado));
recusa.closeAllConnections?.();
mudo.closeAllConnections?.();
await new Promise((ok) => recusa.close(ok));
await new Promise((ok) => mudo.close(ok));
await encerrarBanco();
/* No Windows, sair com uma conexao ainda fechando derruba o processo com um erro do libuv. */
await new Promise((ok) => setTimeout(ok, 300));
process.exit(0);
`,
  );

  try {
    const r = await new Promise((resolve) => {
      const p = spawn(process.execPath, [script], {
        env: { ...process.env, CORREIA_DADOS: pasta, CORREIA_PRAZO_ENVIO_MS: '400', CORREIA_BOASVINDAS_ESPERA_MS: '50' },
        stdio: ['ignore', 'pipe', 'pipe'],
      });
      let texto = '';
      p.stdout.on('data', (d) => (texto += d));
      p.stderr.on('data', (d) => (texto += d));
      p.on('close', (codigo) => resolve({ codigo, texto }));
    });
    if (!s.ok('o escritorio de teste roda sem erro', r.codigo === 0, r.texto.slice(-900))) return s;
    const b = JSON.parse(r.texto.trim().split('\n').pop());

    s.ok('envio que sai: continua ok, com o nome do template, e ninguem e avisado', b.sai.ok && b.sai.enviado === 'Boas-vindas' && b.sai.situacao === 'enviada' && b.sai.avisos === 0, JSON.stringify(b.sai));

    s.ok(
      'envio recusado: o modelo recebe que o cliente NAO recebeu, e nao recebe ok',
      !b.recusado.ok && b.recusado.enviado === false && b.recusado.clienteRecebeu === false && /NÃO recebeu/.test(b.recusado.erro || '') && /não diga que enviou/i.test(b.recusado.erro || ''),
      JSON.stringify(b.recusado),
    );
    s.ok('e a conversa fica com a mensagem em erro e uma linha no registro', b.recusado.situacao === 'erro' && b.recusado.logs === 1, JSON.stringify({ situacao: b.recusado.situacao, logs: b.recusado.logs }));
    s.ok('o motivo dito ao modelo diz o que houve, sem repetir o telefone', /nao tem WhatsApp/.test(b.recusado.erro || '') && !/\d{6,}/.test(b.recusado.erro || ''), b.recusado.erro);
    s.ok('mas a conversa (da equipe) guarda o motivo inteiro', b.recusado.motivoNaConversa === true, JSON.stringify(b.recusado.motivoNaConversa));
    s.ok('o contador do template conta a falha', b.recusado.uso?.falhas === 1 && b.recusado.uso?.enviados === 1, JSON.stringify(b.recusado.uso));

    s.ok('a equipe e avisada: dono e administrador, uma vez cada, o atendente nao', b.equipe.admin === 1 && b.equipe.dono === 1 && b.equipe.atendente === 0, JSON.stringify(b.equipe));
    s.ok('o aviso diz qual template e qual conversa, e leva a ela', /Boas-vindas/.test(b.equipe.titulo || '') && b.equipe.comNome && b.equipe.levaAoContato, JSON.stringify(b.equipe));
    s.ok('e o aviso nao leva telefone nenhum', b.equipe.semTelefone === true, b.equipe.texto);
    s.ok('outra falha do mesmo template no mesmo dia nao repete o aviso, mas conta', b.repetida.admin === 1 && b.repetida.falhas === 2, JSON.stringify(b.repetida));
    s.ok('template so de texto que falha avisa ninguem: so conta', b.soTexto.erro && b.soTexto.enviado === false && b.soTexto.admin === 1 && b.soTexto.falhas === 1, JSON.stringify(b.soTexto));

    s.ok(
      'tempo esgotado: o modelo recebe "talvez", e nao ok',
      !b.esgotado.ok && b.esgotado.enviado === false && b.esgotado.clienteRecebeu === 'talvez' && /pode ter chegado/.test(b.esgotado.erro || '') && /Não envie de novo/.test(b.esgotado.erro || ''),
      JSON.stringify(b.esgotado),
    );
    s.ok(
      'e a mensagem da conversa nao manda procurar o servico fora do ar: diz que o arquivo pode ter chegado',
      b.esgotado.codigo === 'timeout' && /pode ter chegado ao cliente/.test(b.esgotado.textoDaMensagem || '') && !/esta rodando/.test(b.esgotado.textoDaMensagem || ''),
      b.esgotado.textoDaMensagem,
    );
    s.ok(
      'boas-vindas automaticas depois de tempo esgotado: uma tentativa so (o video pode ter chegado), sem marcar como enviado',
      b.boasVindasEsgotadas.tentativas === 1 && b.boasVindasEsgotadas.falhas === 2 && !b.boasVindasEsgotadas.marcou,
      JSON.stringify(b.boasVindasEsgotadas),
    );

    s.ok('o prazo fixo de teste vale quando configurado', b.fixoDoTeste === 400, String(b.fixoDoTeste));
    s.ok('o prazo do envio de arquivo nunca fica abaixo dos 60 s de antes', b.prazos.vazio === 60000 && b.prazos.semArgumento === 60000 && b.prazos.negativo === 60000 && b.prazos.umMega >= 60000, JSON.stringify(b.prazos));
    s.ok('cresce com o tamanho: 5 s por MB', b.prazos.umMega === 65000 && b.prazos.cincoMegas === 85000 && b.prazos.dezesseis === 140000, JSON.stringify(b.prazos));
    s.ok('e tem teto de 150 s', b.prazos.enorme === 150000, JSON.stringify(b.prazos));
  } finally {
    fs.rmSync(pasta, { recursive: true, force: true });
  }
  return s;
}
