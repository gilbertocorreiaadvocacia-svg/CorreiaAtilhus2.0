import { spawn } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

import { suite } from './apoio.js';

/**
 * Quantas vezes cada template saiu e falhou (nucleo/uso-dos-templates.js).
 * Etapa 0 do video de boas-vindas, 30/10/2026: o escritorio colocou o video num
 * template e, de fora, nao havia como saber se ele chegou a algum lead.
 *
 * O que nao pode falhar:
 *  - cada saida com template conta uma vez, e a falha conta como falha, nunca
 *    como enviada;
 *  - mensagem sem template nao mexe em contador nenhum;
 *  - o motivo da falha sai em /api/saude sem telefone (a rota e aberta);
 *  - medir nunca derruba o envio (template que nao existe mais);
 *  - a copia do template para outro escritorio comeca do zero.
 */
export async function testarUsoDosTemplates({ raiz }) {
  const s = suite('Cada template conta quantas vezes saiu e quantas falhou');
  const url = (arquivo) => JSON.stringify(pathToFileURL(path.join(raiz, arquivo)).href);
  const pasta = fs.mkdtempSync(path.join(os.tmpdir(), 'uso-templates-'));
  const script = path.join(pasta, 'uso.mjs');
  fs.writeFileSync(
    script,
    `import { iniciarBanco, achar, inserir, listar, encerrarBanco } from ${url('servidor/nucleo/banco.js')};
import { enviarMensagem } from ${url('servidor/whatsapp/envio.js')};
import { anotarEnvioDoTemplate, usoDosTemplates } from ${url('servidor/nucleo/uso-dos-templates.js')};
import { copiarConfiguracoes } from ${url('servidor/nucleo/copiar-workspace.js')};
iniciarBanco();
inserir('workspaces', { id: 'w1', nome: 'Correia Advogados' });
inserir('workspaces', { id: 'w2', nome: 'Outro Escritorio' });
const conexao = inserir('conexoes', { id: 'cx1', workspaceId: 'w1', tipo: 'simulador', nome: 'Simulador' });
const contato = inserir('contatos', { id: 'c1', workspaceId: 'w1', conexaoId: 'cx1', telefone: '5581931119101', nome: 'Cliente', estado: 'ia' });
const video = { tipo: 'video', url: '/midia/boas-vindas.mp4', arquivo: 'boas-vindas.mp4', nome: 'boas-vindas.mp4' };
inserir('templates', { id: 'tpl-video', workspaceId: 'w1', nome: 'Boas-vindas', atalho: 'bemvindo', conteudo: 'Ola!', midia: video });
inserir('templates', { id: 'tpl-parado', workspaceId: 'w1', nome: 'Parado', atalho: 'parado', conteudo: 'Nunca saiu.' });
const autor = { tipo: 'agente', id: 'ag1', nome: 'Juliana' };
const resultado = {};

/* Duas saidas boas. */
await enviarMensagem({ contato, conexao, tipo: 'video', conteudo: 'Ola!', midia: video, templateId: 'tpl-video', autor });
await enviarMensagem({ contato, conexao, tipo: 'video', conteudo: 'Ola!', midia: video, templateId: 'tpl-video', autor });
resultado.depoisDeDuasBoas = { ...achar('templates', 'tpl-video').uso };

/* Uma que falha: sem conexao, o envio registra o erro na mensagem. */
const falhou = await enviarMensagem({ contato, conexao: null, tipo: 'video', conteudo: 'Ola!', midia: video, templateId: 'tpl-video', autor });
resultado.situacaoDaFalha = falhou.situacao;
resultado.depoisDaFalha = { ...achar('templates', 'tpl-video').uso };

/* Mensagem sem template nao mexe em nada. */
await enviarMensagem({ contato, conexao, tipo: 'texto', conteudo: 'So texto', autor });
resultado.semTemplate = { ...achar('templates', 'tpl-video').uso };
resultado.parado = achar('templates', 'tpl-parado').uso || null;

/* Template que nao existe mais: medir nao derruba nada. */
let estourou = false;
try {
  anotarEnvioDoTemplate('tpl-que-sumiu', { ok: true });
  anotarEnvioDoTemplate(null, { ok: false, erro: 'x' });
  await enviarMensagem({ contato, conexao, tipo: 'texto', conteudo: 'Template apagado', templateId: 'tpl-que-sumiu', autor });
} catch {
  estourou = true;
}
resultado.estourou = estourou;

/* O motivo sai sem telefone, e o que nunca saiu nao aparece. */
anotarEnvioDoTemplate('tpl-video', { ok: false, erro: 'O numero 5581931119101 nao tem WhatsApp' });
const saude = usoDosTemplates('w1');
resultado.saude = saude;
resultado.saudeSemTelefone = !/\\d{6,}/.test(JSON.stringify(saude));
resultado.saudeSoOQueSaiu = Object.keys(saude).join(',');
resultado.saudeDeOutroEscritorio = usoDosTemplates('w2');

/* A copia para outro escritorio comeca do zero. */
copiarConfiguracoes('w2', 'w1', ['templates']);
const copia = listar('templates', { workspaceId: 'w2' }).find((t) => t.atalho === 'bemvindo');
resultado.copiaExiste = Boolean(copia);
resultado.copiaSemUso = Boolean(copia) && copia.uso === undefined;
resultado.originalMantem = Boolean(achar('templates', 'tpl-video').uso?.enviados);

console.log(JSON.stringify(resultado));
await encerrarBanco();
process.exit(0);
`,
  );

  try {
    const r = await new Promise((resolve) => {
      const p = spawn(process.execPath, [script], { env: { ...process.env, CORREIA_DADOS: pasta }, stdio: ['ignore', 'pipe', 'pipe'] });
      let texto = '';
      p.stdout.on('data', (d) => (texto += d));
      p.stderr.on('data', (d) => (texto += d));
      p.on('close', (codigo) => resolve({ codigo, texto }));
    });
    if (!s.ok('o escritorio de teste roda sem erro', r.codigo === 0, r.texto.slice(-800))) return s;
    const b = JSON.parse(r.texto.trim().split('\n').pop());

    s.ok('duas saidas boas contam duas enviadas e nenhuma falha', b.depoisDeDuasBoas?.enviados === 2 && b.depoisDeDuasBoas?.falhas === 0, JSON.stringify(b.depoisDeDuasBoas));
    s.ok('e guardam a data da ultima saida', Boolean(b.depoisDeDuasBoas?.ultimoEnvioEm));
    s.ok('a saida que falha fica como erro na conversa', b.situacaoDaFalha === 'erro', b.situacaoDaFalha);
    s.ok(
      'e conta como falha, sem tirar nem somar nas enviadas',
      b.depoisDaFalha?.enviados === 2 && b.depoisDaFalha?.falhas === 1 && /conexao/.test(b.depoisDaFalha?.ultimaFalha || ''),
      JSON.stringify(b.depoisDaFalha),
    );
    s.ok('mensagem sem template nao mexe no contador', JSON.stringify(b.semTemplate) === JSON.stringify(b.depoisDaFalha), JSON.stringify(b.semTemplate));
    s.ok('o template que nunca saiu continua sem contador', b.parado === null, JSON.stringify(b.parado));
    s.ok('template que nao existe mais nao derruba o envio', b.estourou === false);

    s.ok('a saude mostra so o que saiu, por atalho', b.saudeSoOQueSaiu === 'bemvindo', b.saudeSoOQueSaiu);
    s.ok('com enviadas, falhas e o motivo da ultima', b.saude?.bemvindo?.enviados === 2 && b.saude?.bemvindo?.falhas === 2 && Boolean(b.saude?.bemvindo?.ultimaFalha), JSON.stringify(b.saude));
    s.ok('o motivo da falha sai sem telefone', b.saudeSemTelefone, JSON.stringify(b.saude));
    s.ok('outro escritorio nao ve o contador deste', Object.keys(b.saudeDeOutroEscritorio || {}).length === 0, JSON.stringify(b.saudeDeOutroEscritorio));

    s.ok('a copia do template para outro escritorio comeca do zero', b.copiaExiste && b.copiaSemUso, JSON.stringify({ existe: b.copiaExiste, semUso: b.copiaSemUso }));
    s.ok('e o original mantem o contador', b.originalMantem);
  } finally {
    fs.rmSync(pasta, { recursive: true, force: true });
  }
  return s;
}
