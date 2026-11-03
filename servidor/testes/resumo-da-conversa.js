import { spawn } from 'node:child_process';
import fs from 'node:fs';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

import { cliente, esperar, suite } from './apoio.js';

/**
 * O agente de resumo da conversa (ia/resumo-da-conversa.js), 03/11/2026: um
 * resumo de cada conversa, na aba de dados, que se atualiza sozinho.
 *
 * O que nao pode falhar:
 *  - o resumo le so o que conta: sem nota interna, sem envio que falhou, com o
 *    que o PDF diz; nunca leva o campo de senha ou de documento das variaveis;
 *  - senha e numero de documento que o modelo escreva mesmo assim saem do texto;
 *  - o segundo resumo ATUALIZA o primeiro com so as mensagens novas;
 *  - IA que falha num pedido manual NAO apaga o resumo bom que ja existia; sem
 *    resumo nenhum, sai o resumo padrao (as contas em frases);
 *  - sozinho, so resume conversa que sossegou, com mensagens suficientes, dentro
 *    da janela, sem grupo, e so de novo com duas mensagens novas;
 *  - poucas por varredura e um teto por dia; IA parada, sem chave ou escritorio
 *    com o automatico desligado nao gastam nada;
 *  - credito ou chave recusados tiram o escritorio da varredura por uma hora, e
 *    falha comum espera meia hora so aquela conversa;
 *  - apagar a conversa apaga o resumo.
 *
 * A Anthropic e a de mentira, criada aqui; o que ela responde depende do nome do
 * cliente no pedido (CREDITO, FALHA, LIVRE, LIXO, COM-CPF), nao da ordem.
 */

const ROTULADO = `Quem é: Cliente de teste, de Recife.
O que busca: auxílio-doença.
Em que pé está: aguardando documentos; a próxima fala é do cliente.
Dados e documentos: enviou o CNIS.
Próximo passo: pedir o laudo médico.`;

const COM_CPF = `Quem é: Maria, CPF 123.456.789-01.
O que busca: auxílio-doença, protocolo 20261103123456.
Em que pé está: aguardando laudo.
Dados e documentos: enviou o CNIS.
Próximo passo: pedir o laudo.`;

export async function testarResumoDaConversa({ raiz }) {
  const s = suite('O resumo da conversa se atualiza sozinho, sem senha e sem apagar o que já era bom');
  const url = (arquivo) => JSON.stringify(pathToFileURL(path.join(raiz, arquivo)).href);
  const pasta = fs.mkdtempSync(path.join(os.tmpdir(), 'resumo-conversa-'));
  const script = path.join(pasta, 'resumo.mjs');

  const pedidos = [];
  const iaFalsa = http.createServer((req, res) => {
    const pedacos = [];
    req.on('data', (p) => pedacos.push(p));
    req.on('end', () => {
      let corpo = {};
      try {
        corpo = JSON.parse(Buffer.concat(pedacos).toString('utf8'));
      } catch {}
      const usuario = JSON.stringify(corpo.messages || []);
      const nome = /Cliente: ([^\\.]*)\./.exec(usuario)?.[1] || '';
      pedidos.push({ nome, sistema: String(corpo.system || ''), usuario: (corpo.messages?.[0]?.content?.[0]?.text ?? corpo.messages?.[0]?.content ?? '') });
      res.setHeader('content-type', 'application/json');
      res.setHeader('connection', 'close');
      const erro = (status, mensagem) => {
        res.statusCode = status;
        res.end(JSON.stringify({ type: 'error', error: { type: 'invalid_request_error', message: mensagem } }));
      };
      if (nome.includes('CREDITO')) return erro(400, 'Your credit balance is too low to access the Anthropic API. Please go to Plans & Billing to upgrade or purchase credits.');
      if (nome.includes('FALHA')) return erro(400, 'messages: text content blocks must be non-empty');
      const texto = nome.includes('COM-CPF') ? COM_CPF : nome.includes('LIVRE') ? 'A cliente quer saber do auxílio-doença e já mandou o CNIS (CPF 123.456.789-01); falta o laudo para seguir.' : nome.includes('LIXO') ? 'ok' : ROTULADO;
      res.end(JSON.stringify({ id: 'msg_teste', type: 'message', role: 'assistant', model: 'claude-sonnet-5', content: [{ type: 'text', text: texto }], stop_reason: 'end_turn', usage: { input_tokens: 10, output_tokens: 8 } }));
    });
  });
  await new Promise((ok) => iaFalsa.listen(0, '127.0.0.1', ok));

  fs.writeFileSync(
    script,
    `import { iniciarBanco, inserir, inserirMensagem, atualizar, listar, remover, encerrarBanco } from ${url('servidor/nucleo/banco.js')};
import { gerarResumo, varrerResumos, resumoDe, situacaoDoResumo, configDoResumo, salvarConfigDoResumo, redigir, lerCampos, resumoPadrao, resumoPublicoDosResumos } from ${url('servidor/ia/resumo-da-conversa.js')};
iniciarBanco();
const espera = (ms) => new Promise((ok) => setTimeout(ok, ms));
const resultado = {};
const AGORA = new Date('2026-11-03T15:00:00.000Z');
const antes = (min, base = AGORA) => new Date(base.getTime() - min * 60000).toISOString();
const IA = { tipo: 'agente', id: 'ag1', nome: 'Eduarda' };

let numero = 5581900000000;
function escritorio(id, { chave = true, extra = {} } = {}) {
  inserir('workspaces', { id, nome: 'Escritório ' + id, ...extra });
  if (chave) inserir('integracoes', { id: 'int-' + id, workspaceId: id, ia: { chaveAnthropic: 'sk-ant-teste' } });
}
/* Uma conversa com 'quantas' mensagens, alternando cliente e escritorio, a ultima 'minAtras' minutos antes de AGORA. */
function conversa(ws, id, { nome = id, quantas = 5, minAtras = 15, extra = {} } = {}) {
  numero += 1;
  const fim = AGORA.getTime() - minAtras * 60000;
  inserir('contatos', { id, workspaceId: ws, conexaoId: 'cx', telefone: String(numero), nome, estado: 'ia', responsavel: { ...IA }, etiquetas: [], criadoEm: new Date(fim - quantas * 60000).toISOString(), ...extra });
  for (let i = 0; i < quantas; i += 1) acrescentar(id, new Date(fim - (quantas - 1 - i) * 60000).toISOString(), i % 2 === 0 ? 'entrada' : 'saida', 'mensagem ' + (i + 1) + ' de ' + id);
}
function acrescentar(id, quando, direcao, conteudo, extra = {}) {
  inserirMensagem(id, { workspaceId: achar(id), direcao, tipo: 'texto', conteudo, criadoEm: quando, autor: direcao === 'entrada' ? { tipo: 'cliente', nome: id } : { ...IA }, ...(direcao === 'saida' ? { situacao: 'enviada' } : {}), ...extra });
  atualizar('contatos', id, { ultimaMensagemEm: quando });
}
const achar = (id) => listar('contatos').find((c) => c.id === id).workspaceId;
const contato = (id) => listar('contatos').find((c) => c.id === id);
const comResumo = (id, ateEm, extra = {}) => inserir('resumosDasConversas', { id: 'rsm-' + id, workspaceId: achar(id), contatoId: id, ateEm, geradoEm: antes(60), usouIa: true, origem: 'automatico', mensagens: 5, texto: 'Quem é: ' + id, campos: [{ rotulo: 'Quem é', texto: id }], ...extra });

/* ====================== O RESUMO NA HORA (manual) ====================== */
escritorio('w1');
inserir('status', { id: 'st1', workspaceId: 'w1', nome: 'Qualificado', tipo: 'qualificado' });
salvarConfigDoResumo('w1', { instrucoes: 'Chame a cliente de Dona e destaque o benefício pedido.' });
conversa('w1', 'M1', { nome: 'Maria COM-CPF', quantas: 4, minAtras: 30, extra: { statusId: 'st1', variaveis: { cidade: 'Recife', senha_gov: 'SEGREDO123', cpf: '12345678901' } } });
acrescentar('M1', antes(25), 'saida', 'NOTA-SECRETA da equipe', { nota: true, autor: { tipo: 'membro', nome: 'Ana' } });
acrescentar('M1', antes(24), 'saida', 'ENVIO-FALHOU', { situacao: 'erro' });
acrescentar('M1', antes(23), 'entrada', 'documento do cliente', { tipo: 'documento', midia: { tipo: 'documento', nome: 'cnis.pdf' }, leitura: 'CNIS mostra vinculo em 2019 na empresa LEITURA-DO-PDF' });

const antesDosCreditos = listar('creditos', { acao: 'resumo_ia' }).length;
const r1 = await gerarResumo(contato('M1'), { origem: 'manual', agora: AGORA });
resultado.r1 = { usouIa: r1.usouIa, rotulos: (r1.campos || []).map((c) => c.rotulo), texto: r1.texto, origem: r1.origem, mensagens: r1.mensagens, creditos: listar('creditos', { acao: 'resumo_ia' }).length - antesDosCreditos, ateEm: r1.ateEm };

/* Segundo resumo: so as mensagens novas, com o anterior de base. */
acrescentar('M1', antes(10), 'entrada', 'NOVA-MSG-1 mandei o laudo');
acrescentar('M1', antes(9), 'saida', 'NOVA-MSG-2 recebido, obrigada');
acrescentar('M1', antes(8), 'entrada', 'NOVA-MSG-3 e agora?');
const r2 = await gerarResumo(contato('M1'), { origem: 'manual', agora: AGORA });
resultado.r2 = { usouIa: r2.usouIa, mensagens: r2.mensagens };
/* Sem nada de novo, le a conversa de novo (nao ha o que atualizar). */
await gerarResumo(contato('M1'), { origem: 'manual', agora: AGORA });

/* A IA falha num pedido manual: o resumo bom continua. */
const guardadoAntes = resumoDe('M1').geradoEm;
atualizar('contatos', 'M1', { nome: 'Maria CREDITO' });
resultado.falhaComResumoBom = await gerarResumo(contato('M1'), { origem: 'manual', agora: new Date(AGORA.getTime() + 60000) }).then(() => 'gerou', (e) => ({ iaFalhou: e.iaFalhou === true, msg: e.message }));
resultado.resumoBomSobrou = { igual: resumoDe('M1').geradoEm === guardadoAntes, usouIa: resumoDe('M1').usouIa };

/* Sem resumo nenhum, a IA falha: sai o padrao, com o aviso. */
conversa('w1', 'M5', { nome: 'Joana FALHA', quantas: 5, minAtras: 40, extra: { statusId: 'st1', variaveis: { cidade: 'Olinda' } } });
const r5 = await gerarResumo(contato('M5'), { origem: 'manual', agora: AGORA });
resultado.r5 = { usouIa: r5.usouIa, aviso: r5.avisoDaIa, rotulos: r5.campos.map((c) => c.rotulo), texto: r5.texto };

/* Texto livre (sem os rotulos) e lixo. */
conversa('w1', 'M6', { nome: 'Livre LIVRE', quantas: 4, minAtras: 40 });
const r6 = await gerarResumo(contato('M6'), { origem: 'manual', agora: AGORA });
resultado.r6 = { usouIa: r6.usouIa, campos: r6.campos, texto: r6.texto };
conversa('w1', 'M7', { nome: 'Lixo LIXO', quantas: 4, minAtras: 40 });
const r7 = await gerarResumo(contato('M7'), { origem: 'manual', agora: AGORA });
resultado.r7 = { usouIa: r7.usouIa, aviso: r7.avisoDaIa };

/* Poucas mensagens e dois pedidos juntos. */
conversa('w1', 'M8', { nome: 'Curta', quantas: 2, minAtras: 40 });
resultado.poucas = await gerarResumo(contato('M8'), { origem: 'manual', agora: AGORA }).then(() => 'gerou', (e) => (e.poucasMensagens ? 'poucas' : 'outro:' + e.message));
conversa('w1', 'M9', { nome: 'Dupla', quantas: 4, minAtras: 40 });
const um = gerarResumo(contato('M9'), { origem: 'manual', agora: AGORA });
const dois = gerarResumo(contato('M9'), { origem: 'manual', agora: AGORA }).then(() => 'passou', (e) => (e.ocupado ? 'ocupado' : 'outro:' + e.message));
resultado.lock = { segundo: await dois, situacaoDurante: situacaoDoResumo(contato('M9')).gerando };
await um;
resultado.lock.depois = situacaoDoResumo(contato('M9')).gerando;
resultado.situacao = (() => { const x = situacaoDoResumo(contato('M1')); return { novas: x.novas, podeGerar: x.podeGerar, temResumo: Boolean(x.resumo), total: x.totalDeMensagens }; })();
resultado.situacaoVazia = (() => { const x = situacaoDoResumo(contato('M8')); return { podeGerar: x.podeGerar, resumo: x.resumo }; })();

/* As funcoes puras. */
resultado.puras = {
  redigirCpf: redigir('CPF 123.456.789-01 e 12345678901'),
  redigirTelefone: redigir('liga para 81 98888-7777'),
  redigirAno: redigir('em 2026, 3 vezes, 15/10'),
  campos: lerCampos('**Quem é:** Maria\\n- O que busca: auxílio\\nIsto não tem rótulo\\nPróximo passo: ligar').map((c) => c.rotulo + '=' + c.texto),
};

/* ====================== O RESUMO QUE SAI SOZINHO ====================== */
escritorio('w2');
conversa('w2', 'S1', { nome: 'S1', quantas: 5, minAtras: 15 });
conversa('w2', 'S2', { nome: 'S2', quantas: 5, minAtras: 3 });
conversa('w2', 'S3', { nome: 'S3', quantas: 5, minAtras: 20, extra: { grupo: true } });
conversa('w2', 'S4', { nome: 'S4', quantas: 2, minAtras: 20 });
conversa('w2', 'S5', { nome: 'S5', quantas: 5, minAtras: 8 * 24 * 60 });
conversa('w2', 'S6', { nome: 'S6', quantas: 5, minAtras: 30 });
comResumo('S6', antes(30));
conversa('w2', 'S7', { nome: 'S7', quantas: 5, minAtras: 40 });
comResumo('S7', antes(40));
acrescentar('S7', antes(12), 'entrada', 'só mais uma');
conversa('w2', 'S8', { nome: 'S8', quantas: 5, minAtras: 40 });
comResumo('S8', antes(40));
acrescentar('S8', antes(14), 'entrada', 'S8-NOVA-1');
acrescentar('S8', antes(13), 'saida', 'S8-NOVA-2');
acrescentar('S8', antes(12), 'entrada', 'S8-NOVA-3');
/* A nota interna nao e mensagem nova. */
conversa('w2', 'S9', { nome: 'S9', quantas: 5, minAtras: 40 });
comResumo('S9', antes(40));
acrescentar('S9', antes(20), 'saida', 'nota da equipe', { nota: true, autor: { tipo: 'membro', nome: 'Ana' } });
acrescentar('S9', antes(19), 'saida', 'outra nota', { nota: true, autor: { tipo: 'membro', nome: 'Ana' } });

const chamadasAntes = 0;
const v1 = await varrerResumos(AGORA);
resultado.v1 = v1.map((r) => r.contatoId);
const v2 = await varrerResumos(AGORA);
resultado.v2 = v2.length;
resultado.s8 = { usouIa: resumoDe('S8').usouIa, origem: resumoDe('S8').origem, ateEm: resumoDe('S8').ateEm, ateEmEsperado: antes(12) };
resultado.s1 = { origem: resumoDe('S1')?.origem, campos: (resumoDe('S1')?.campos || []).length };
resultado.semResumo = ['S2', 'S3', 'S4', 'S5'].map((id) => Boolean(resumoDe(id)));
resultado.s7igual = resumoDe('S7').geradoEm === antes(60);

/* O ultimo recado de quem ja foi resumido mas falou depois: uma mensagem a mais nao basta, duas sim. */
acrescentar('S7', antes(11), 'saida', 'S7-NOVA-2');
const v3 = await varrerResumos(AGORA);
resultado.v3 = v3.map((r) => r.contatoId);

/* O teto por varredura e o teto por dia (CORREIA_RESUMO_POR_VARREDURA=5 e POR_DIA=6). */
escritorio('w3');
for (let i = 1; i <= 8; i += 1) conversa('w3', 'T' + i, { nome: 'T' + i, quantas: 4, minAtras: 10 + i });
const t1 = await varrerResumos(AGORA);
const t2 = await varrerResumos(AGORA);
const t3 = await varrerResumos(AGORA);
const amanha = new Date(AGORA.getTime() + 24 * 3600 * 1000);
const t4 = await varrerResumos(amanha);
resultado.tetos = { primeira: t1.filter((r) => r.workspaceId === 'w3').length, segunda: t2.filter((r) => r.workspaceId === 'w3').length, terceira: t3.filter((r) => r.workspaceId === 'w3').length, diaSeguinte: t4.filter((r) => r.workspaceId === 'w3').length, ordemDaPrimeira: t1.filter((r) => r.workspaceId === 'w3').map((r) => r.contatoId) };

/* Quem nao deve gastar nada: desligado, IA parada, sem chave. */
escritorio('w5'); salvarConfigDoResumo('w5', { automatico: false }); conversa('w5', 'D1', { quantas: 4, minAtras: 20 });
escritorio('w6', { extra: { saudeDaIa: { problema: 'credito', desde: antes(120) } } }); conversa('w6', 'P1', { quantas: 4, minAtras: 20 });
escritorio('w7', { chave: false }); conversa('w7', 'K1', { quantas: 4, minAtras: 20 });
const v5 = await varrerResumos(amanha);
resultado.gastaNada = { geradosDeW5W6W7: v5.filter((r) => ['w5', 'w6', 'w7'].includes(r.workspaceId)).length, w5: listar('resumosDasConversas', { workspaceId: 'w5' }).length, w6: listar('resumosDasConversas', { workspaceId: 'w6' }).length, w7: listar('resumosDasConversas', { workspaceId: 'w7' }).length };

/* Credito recusado tira o escritorio da varredura por uma hora; falha comum espera meia hora so a conversa. */
escritorio('w8');
conversa('w8', 'C1', { nome: 'C1 CREDITO', quantas: 4, minAtras: 10 });
conversa('w8', 'C2', { nome: 'C2', quantas: 4, minAtras: 11 });
const c1 = await varrerResumos(AGORA);
const c2 = await varrerResumos(new Date(AGORA.getTime() + 5 * 60000));
atualizar('contatos', 'C1', { nome: 'C1 voltou' });
const c3 = await varrerResumos(new Date(AGORA.getTime() + 61 * 60000));
resultado.credito = { primeira: c1.filter((r) => r.workspaceId === 'w8').length, durantePausa: c2.filter((r) => r.workspaceId === 'w8').length, depoisDePausa: c3.filter((r) => r.workspaceId === 'w8').map((r) => r.contatoId), publico: resumoPublicoDosResumos('w8', new Date(AGORA.getTime() + 5 * 60000)).pausadoAte };

escritorio('w9');
conversa('w9', 'F1', { nome: 'F1 FALHA', quantas: 4, minAtras: 10 });
conversa('w9', 'F2', { nome: 'F2', quantas: 4, minAtras: 11 });
const f1 = await varrerResumos(AGORA);
const f2 = await varrerResumos(new Date(AGORA.getTime() + 10 * 60000));
const f3 = await varrerResumos(new Date(AGORA.getTime() + 31 * 60000));
resultado.falhaComum = { primeira: f1.filter((r) => r.workspaceId === 'w9').map((r) => r.contatoId), segunda: f2.filter((r) => r.workspaceId === 'w9').map((r) => r.contatoId), depoisDeMeiaHora: f3.filter((r) => r.workspaceId === 'w9').map((r) => r.contatoId) };

/* O resumo padrao de antes ganha outra chance, mas so depois de uma hora. */
escritorio('w10');
conversa('w10', 'R1', { nome: 'R1', quantas: 5, minAtras: 90 });
comResumo('R1', antes(90), { usouIa: false, avisoDaIa: 'A IA nao respondeu', geradoEm: antes(30) });
const r1a = await varrerResumos(AGORA);
conversa('w10', 'R2', { nome: 'R2', quantas: 5, minAtras: 200 });
comResumo('R2', antes(200), { usouIa: false, geradoEm: antes(120) });
const r1b = await varrerResumos(AGORA);
resultado.padraoRetentativa = { recente: r1a.filter((r) => r.workspaceId === 'w10').length, antigo: r1b.filter((r) => r.workspaceId === 'w10').map((r) => r.contatoId), r2UsouIa: resumoDe('R2').usouIa };

/* Apagar a conversa apaga o resumo (por qualquer caminho que chame remover). */
const existiaAntes = Boolean(resumoDe('S1'));
remover('contatos', 'S1');
resultado.cascata = { existiaAntes, existeDepois: Boolean(resumoDe('S1')), outrosFicaram: Boolean(resumoDe('S8')) };

resultado.publico = resumoPublicoDosResumos('w2', AGORA);
resultado.publicoSemTexto = !JSON.stringify(resumoPublicoDosResumos('w2', AGORA)).includes('Cliente de teste');

console.log(JSON.stringify(resultado));
await encerrarBanco();
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
          ANTHROPIC_API_KEY: '',
          OPENAI_API_KEY: '',
          CORREIA_RESUMO_POR_VARREDURA: '5',
          CORREIA_RESUMO_POR_DIA: '6',
        },
        stdio: ['ignore', 'pipe', 'pipe'],
      });
      let texto = '';
      p.stdout.on('data', (d) => (texto += d));
      p.stderr.on('data', (d) => (texto += d));
      p.on('close', (codigo) => resolve({ codigo, texto }));
    });
    if (!s.ok('o escritório de teste roda sem erro', r.codigo === 0, r.texto.slice(-1200))) return s;
    const b = JSON.parse(r.texto.trim().split('\n').pop());

    /* ---- Na hora ---- */
    const deM1 = pedidos.filter((p) => p.nome.startsWith('Maria'));
    const primeiro = deM1[0] || { sistema: '', usuario: '' };
    s.ok(
      'o resumo sai com os cinco rótulos, da IA, custa um crédito e guarda até onde leu',
      b.r1.usouIa === true && b.r1.rotulos.join('|') === 'Quem é|O que busca|Em que pé está|Dados e documentos|Próximo passo' && b.r1.origem === 'manual' && b.r1.creditos === 1 && b.r1.mensagens === 5,
      JSON.stringify(b.r1),
    );
    s.ok(
      'o pedido leva as regras, a instrução do escritório e a conversa com o que o PDF diz',
      /NÃO TÊM EXCEÇÃO/.test(primeiro.sistema) && /Chame a cliente de Dona/.test(primeiro.sistema) && /Recife/.test(primeiro.usuario) && /Etapa do funil: Qualificado/.test(primeiro.usuario) && /LEITURA-DO-PDF/.test(primeiro.usuario) && /Cliente: /.test(primeiro.usuario),
      primeiro.sistema.slice(0, 150),
    );
    s.ok(
      'e NÃO leva nota interna, envio que falhou, nem o campo de senha ou de CPF',
      !/NOTA-SECRETA|ENVIO-FALHOU|SEGREDO123|12345678901/.test(primeiro.usuario),
      primeiro.usuario.slice(0, 400),
    );
    s.ok(
      'senha e número de documento que o modelo escreveu saem do texto guardado',
      !/123\.456\.789-01|20261103123456/.test(b.r1.texto) && /\[número omitido\]/.test(b.r1.texto),
      b.r1.texto,
    );

    const segundo = deM1[1] || { usuario: '' };
    s.ok(
      'o segundo resumo ATUALIZA o primeiro: leva o resumo anterior e só as mensagens novas',
      b.r2.usouIa === true && /RESUMO ANTERIOR/.test(segundo.usuario) && /MENSAGENS NOVAS/.test(segundo.usuario) && /NOVA-MSG-1/.test(segundo.usuario) && /NOVA-MSG-3/.test(segundo.usuario) && !/mensagem 1 de M1/.test(segundo.usuario) && !/LEITURA-DO-PDF/.test(segundo.usuario),
      segundo.usuario.slice(0, 500),
    );
    const terceiro = deM1[2] || { usuario: '' };
    s.ok('sem nada de novo, lê a conversa de novo em vez de atualizar', !/RESUMO ANTERIOR/.test(terceiro.usuario) && /CONVERSA:/.test(terceiro.usuario) && /mensagem 1 de M1/.test(terceiro.usuario), terceiro.usuario.slice(0, 200));

    s.ok(
      'a IA falha num pedido manual e já havia resumo da IA: o erro sobe e o resumo bom continua como estava',
      b.falhaComResumoBom?.iaFalhou === true && /não respondeu/.test(b.falhaComResumoBom.msg) && b.resumoBomSobrou.igual === true && b.resumoBomSobrou.usouIa === true,
      JSON.stringify({ f: b.falhaComResumoBom, s: b.resumoBomSobrou }),
    );
    s.ok(
      'a IA falha e não havia resumo: sai o padrão, com o aviso, em frases das contas da conversa',
      b.r5.usouIa === false && /não respondeu/.test(b.r5.aviso || '') && b.r5.rotulos[0] === 'Quem é' && /Etapa Qualificado/.test(b.r5.texto) && /3 mensagens do cliente e 2 do escritório/.test(b.r5.texto) && /cidade: Olinda/.test(b.r5.texto),
      JSON.stringify(b.r5),
    );
    s.ok('resposta sem os rótulos, mas com texto, é guardada como texto livre, também sem o número de documento', b.r6.usouIa === true && b.r6.campos === null && /auxílio-doença/.test(b.r6.texto) && !/123\.456/.test(b.r6.texto) && /\[número omitido\]/.test(b.r6.texto), JSON.stringify(b.r6));
    s.ok('resposta inútil ("ok") vira o resumo padrão, com o aviso', b.r7.usouIa === false && /não devolveu um resumo utilizável/.test(b.r7.aviso || ''), JSON.stringify(b.r7));
    s.ok('com menos de 3 mensagens não resume', b.poucas === 'poucas' && b.situacaoVazia.podeGerar === false && b.situacaoVazia.resumo === null, JSON.stringify({ p: b.poucas, v: b.situacaoVazia }));
    s.ok('dois pedidos na mesma conversa: o segundo é recusado enquanto o primeiro roda', b.lock.segundo === 'ocupado' && b.lock.situacaoDurante === true && b.lock.depois === false, JSON.stringify(b.lock));
    s.ok('a situação diz quantas mensagens vieram depois do resumo e se já dá para resumir', b.situacao.podeGerar === true && b.situacao.temResumo === true && b.situacao.novas === 0, JSON.stringify(b.situacao));
    s.ok(
      'as funções puras: CPF e telefone saem, ano e datas ficam, "**Rótulo:**" e "- Rótulo:" são lidos',
      !/123\.456/.test(b.puras.redigirCpf) && !/12345678901/.test(b.puras.redigirCpf) && !/98888/.test(b.puras.redigirTelefone) && b.puras.redigirAno === 'em 2026, 3 vezes, 15/10' && b.puras.campos.join('|') === 'Quem é=Maria|O que busca=auxílio|Próximo passo=ligar',
      JSON.stringify(b.puras),
    );

    /* ---- Sozinho ---- */
    s.ok(
      'a varredura resume só o que sossegou: a parada há 15 min e a que tinha resumo e ganhou 3 mensagens; a mais nova primeiro',
      JSON.stringify(b.v1) === JSON.stringify(['S8', 'S1']),
      JSON.stringify(b.v1),
    );
    s.ok(
      'não resume a de 3 minutos, o grupo, a de 2 mensagens, a de 8 dias atrás, a que não ganhou nada nem a que só ganhou notas',
      b.semResumo.every((x) => x === false) && b.s7igual === true && b.v2 === 0,
      JSON.stringify({ b: b.semResumo, s7: b.s7igual, v2: b.v2 }),
    );
    const pedidoS8 = pedidos.find((p) => p.nome === 'S8');
    s.ok('a atualizada sozinha leva o resumo anterior e as 3 mensagens novas, e guarda até onde leu', /RESUMO ANTERIOR/.test(pedidoS8?.usuario || '') && /S8-NOVA-3/.test(pedidoS8?.usuario || '') && b.s8.origem === 'automatico' && b.s8.ateEm === b.s8.ateEmEsperado, JSON.stringify(b.s8));
    s.ok('uma mensagem nova não basta para atualizar; com duas, atualiza', !b.v1.includes('S7') && JSON.stringify(b.v3) === JSON.stringify(['S7']), JSON.stringify({ v1: b.v1, v3: b.v3 }));
    s.ok(
      'poucas por varredura (5) e um teto por dia (6): 5, depois 1, depois nenhuma; no dia seguinte, as 2 que faltavam',
      b.tetos.primeira === 5 && b.tetos.segunda === 1 && b.tetos.terceira === 0 && b.tetos.diaSeguinte === 2 && b.tetos.ordemDaPrimeira[0] === 'T1',
      JSON.stringify(b.tetos),
    );
    s.ok('desligado, IA parada por crédito e sem chave: não resume nada nem chama a IA', b.gastaNada.geradosDeW5W6W7 === 0 && b.gastaNada.w5 === 0 && b.gastaNada.w6 === 0 && b.gastaNada.w7 === 0 && !pedidos.some((p) => ['D1', 'P1', 'K1'].includes(p.nome)), JSON.stringify(b.gastaNada));
    s.ok(
      'crédito recusado: tenta uma vez, tira o escritório da varredura por uma hora (o aviso público mostra até quando) e depois volta a resumir',
      b.credito.primeira === 0 && pedidos.filter((p) => p.nome.startsWith('C1')).length === 2 && pedidos.filter((p) => p.nome === 'C2').length === 1 && b.credito.durantePausa === 0 && Boolean(b.credito.publico) && b.credito.depoisDePausa.includes('C1') && b.credito.depoisDePausa.includes('C2'),
      JSON.stringify(b.credito),
    );
    s.ok(
      'falha comum: a conversa que falhou espera meia hora, e as outras seguem',
      JSON.stringify(b.falhaComum.primeira) === JSON.stringify(['F2']) && b.falhaComum.segunda.length === 0 && b.falhaComum.depoisDeMeiaHora.length === 0 && pedidos.filter((p) => p.nome.startsWith('F1')).length === 2,
      JSON.stringify(b.falhaComum),
    );
    s.ok(
      'o resumo padrão de antes ganha outra chance com a IA, mas só depois de uma hora',
      b.padraoRetentativa.recente === 0 && JSON.stringify(b.padraoRetentativa.antigo) === JSON.stringify(['R2']) && b.padraoRetentativa.r2UsouIa === true,
      JSON.stringify(b.padraoRetentativa),
    );
    s.ok('apagar a conversa apaga o resumo, e só o dela', b.cascata.existiaAntes === true && b.cascata.existeDepois === false && b.cascata.outrosFicaram === true, JSON.stringify(b.cascata));
    s.ok(
      'o resumo público (/api/saude) tem só contagens: ligado, quantos, com IA e padrão, o teto do dia, e nada do texto',
      b.publico.automatico === true && b.publico.total >= 4 && b.publico.tetoPorDia === 6 && typeof b.publico.comIa === 'number' && typeof b.publico.padrao === 'number' && b.publicoSemTexto === true,
      JSON.stringify(b.publico),
    );
  } finally {
    iaFalsa.closeAllConnections?.();
    await new Promise((ok) => iaFalsa.close(ok));
    fs.rmSync(pasta, { recursive: true, force: true });
  }
  return s;
}

/**
 * As rotas do resumo na base compartilhada: o cartao da aba de dados le e pede o
 * resumo; so administrador muda a configuracao.
 */
export async function testarRotasDoResumo({ base }) {
  const s = suite('As rotas do resumo da conversa');
  const dono = cliente(base);
  await dono.entrar();
  const inicio = (await dono.get('/api/sessao/eu')).dados?.workspace?.id;

  const conexoes = (await dono.get('/api/conexoes')).dados || [];
  const conexao = conexoes.find((c) => c.tipo === 'simulador') || conexoes[0];
  const telefone = `5581977${String(Date.now()).slice(-6)}`;
  for (const texto of ['oi, boa tarde', 'queria saber do auxílio-doença', 'tenho laudo médico']) {
    await dono.post('/api/simulador/mensagem', { conexaoId: conexao.id, telefone, nome: 'Cliente do Resumo', conteudo: texto });
  }
  await esperar(1200);
  const achar = async (fone) => ((await dono.get('/api/contatos?aba=todas&limite=1000')).dados?.contatos || []).find((c) => String(c.telefone).endsWith(fone.slice(-8)));
  const contato = await achar(telefone);
  if (!s.ok('a conversa de teste existe', Boolean(contato))) return s;

  const antes = await dono.get(`/api/contatos/${contato.id}/resumo-automatico`);
  s.ok('antes de resumir: sem resumo, dá para gerar e traz a configuração (o dono é administrador)', antes.status === 200 && antes.dados?.resumo === null && antes.dados?.podeGerar === true && antes.dados?.config?.automatico === true, JSON.stringify(antes.dados));

  const gerado = await dono.post(`/api/contatos/${contato.id}/resumo-automatico`, {});
  s.ok('gera o resumo e devolve a situação com ele', gerado.status === 200 && Boolean(gerado.dados?.resumo?.texto) && gerado.dados.novas === 0 && typeof gerado.dados.resumo.usouIa === 'boolean' && gerado.dados.config?.automatico === true, JSON.stringify(gerado.dados).slice(0, 300));
  s.ok('e o resumo fica guardado para a próxima abertura', (await dono.get(`/api/contatos/${contato.id}/resumo-automatico`)).dados?.resumo?.texto === gerado.dados.resumo.texto);

  s.ok('conversa que não existe volta 404', (await dono.get('/api/contatos/nao-existe/resumo-automatico')).status === 404 && (await dono.post('/api/contatos/nao-existe/resumo-automatico', {})).status === 404);

  const curta = `5581966${String(Date.now()).slice(-6)}`;
  await dono.post('/api/simulador/mensagem', { conexaoId: conexao.id, telefone: curta, nome: 'Cliente Curto', conteudo: 'oi' });
  await esperar(800);
  const doCurto = await achar(curta);
  s.ok('conversa com poucas mensagens volta 400', doCurto && (await dono.post(`/api/contatos/${doCurto.id}/resumo-automatico`, {})).status === 400);

  const mudou = await dono.put('/api/resumo-das-conversas/config', { automatico: false, instrucoes: '  Seja breve.  ' });
  s.ok('o dono muda a configuração e ela aparece na próxima leitura', mudou.status === 200 && mudou.dados?.automatico === false && mudou.dados?.instrucoes === 'Seja breve.' && (await dono.get(`/api/contatos/${contato.id}/resumo-automatico`)).dados?.config?.instrucoes === 'Seja breve.');
  await dono.put('/api/resumo-das-conversas/config', { automatico: true, instrucoes: '' });

  const email = 'atendente-resumo@correia.adv.br';
  await dono.post('/api/membros', { email, nome: 'Atendente do Resumo', senha: 'senha-de-teste-123', papel: 'atendente' });
  const atendente = cliente(base);
  await atendente.entrar(email, 'senha-de-teste-123');
  s.ok('o atendente não muda a configuração', (await atendente.put('/api/resumo-das-conversas/config', { automatico: false })).status === 403);

  for (const m of (await dono.get('/api/membros')).dados || []) {
    if (m.usuario?.email === email) await dono.delete(`/api/membros/${m.id}`);
  }
  for (const c of [contato, doCurto]) if (c) await dono.delete(`/api/contatos/${c.id}`);
  if (inicio) await dono.post('/api/sessao/workspace', { workspaceId: inicio });
  return s;
}
