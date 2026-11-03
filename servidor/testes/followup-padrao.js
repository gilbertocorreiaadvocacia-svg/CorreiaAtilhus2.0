import { spawn } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

import { suite } from './apoio.js';

/**
 * O status "Follow up" manda os follow-ups (nucleo/followup-padrao.js), 03/11/2026.
 *
 * "Quando eu coloco em Follow up, deveria ficar mandando os follow-ups." O status
 * nascia sem nenhum passo, e colocar uma conversa ali nao mandava nada.
 *
 * O que nao pode falhar:
 *  - o status "Follow up" sem passos ganha fu1 (1 h), fu2 (24 h) e fu3 (72 h), com as
 *    mensagens do proprio escritorio, e o ultimo passo NAO desiste nem arquiva;
 *  - a conversa que entra no status ganha os tres envios agendados, nos tempos certos;
 *  - roda uma vez por escritorio: se a equipe tirar os passos de proposito, o proximo
 *    boot nao os poe de volta;
 *  - nao mexe em status que ja tem passos (marca como visto, sem trocar nada), nem em
 *    outros status, nem em escritorio sem o status;
 *  - sem os tres templates, nao instala e nao marca (instala quando existirem);
 *  - quem ja esta no status nao recebe nada de uma vez (a sequencia e da entrada).
 */
export async function testarFollowUpPadrao({ raiz }) {
  const s = suite('O status Follow up manda fu1, fu2 e fu3');
  const url = (arquivo) => JSON.stringify(pathToFileURL(path.join(raiz, arquivo)).href);
  const pasta = fs.mkdtempSync(path.join(os.tmpdir(), 'followup-padrao-'));
  const script = path.join(pasta, 'followup.mjs');

  fs.writeFileSync(
    script,
    `import { iniciarBanco, achar, inserir, listar, atualizar, encerrarBanco } from ${url('servidor/nucleo/banco.js')};
import { garantirSequenciaNoStatusFollowUp } from ${url('servidor/nucleo/followup-padrao.js')};
import { aplicarStatus } from ${url('servidor/automacao/followup.js')};
iniciarBanco();
const resultado = {};

const templates = (ws) => Object.fromEntries(['fu1', 'fu2', 'fu3', 'bemvindo'].map((a) => [a, inserir('templates', { id: 'tpl-' + ws + '-' + a, workspaceId: ws, nome: a, atalho: a, conteudo: 'Ola {{nome}} ' + a })]));

/* w1: o escritorio do dia a dia, com o status "Follow up" sem passos e uma conversa que ja estava la. */
inserir('workspaces', { id: 'w1', nome: 'Geral' });
templates('w1');
inserir('conexoes', { id: 'cx1', workspaceId: 'w1', tipo: 'simulador', nome: 'Sim' });
inserir('status', { id: 'st-fu', workspaceId: 'w1', nome: 'Follow up', tipo: 'nenhum', followups: [] });
inserir('status', { id: 'st-outro', workspaceId: 'w1', nome: 'Em análise', tipo: 'analise', followups: [] });
inserir('contatos', { id: 'c-ja-estava', workspaceId: 'w1', conexaoId: 'cx1', telefone: '5581900000001', nome: 'Ja Estava', statusId: 'st-fu', estado: 'arquivado', etiquetas: [] });
inserir('contatos', { id: 'c-novo', workspaceId: 'w1', conexaoId: 'cx1', telefone: '5581900000002', nome: 'Novo', statusId: null, estado: 'pendente', etiquetas: [] });

/* w2: o status ja tem passos (a equipe configurou), e w3: nao tem o status. */
inserir('workspaces', { id: 'w2', nome: 'Com passos' });
templates('w2');
inserir('status', { id: 'st-fu2', workspaceId: 'w2', nome: 'Follow-up', tipo: 'nenhum', followups: [{ id: 'fup-meu', templateId: 'tpl-w2-bemvindo', minutos: 5, desistir: null }] });
inserir('workspaces', { id: 'w3', nome: 'Sem o status' });
templates('w3');
inserir('status', { id: 'st-q3', workspaceId: 'w3', nome: 'Qualificado', tipo: 'qualificado', followups: [] });
/* w4: tem o status mas falta um dos templates. */
inserir('workspaces', { id: 'w4', nome: 'Sem template' });
inserir('templates', { id: 'tpl-w4-fu1', workspaceId: 'w4', nome: 'fu1', atalho: 'fu1', conteudo: 'a' });
inserir('templates', { id: 'tpl-w4-fu2', workspaceId: 'w4', nome: 'fu2', atalho: 'fu2', conteudo: 'b' });
inserir('status', { id: 'st-fu4', workspaceId: 'w4', nome: 'FOLLOW_UP', tipo: 'nenhum', followups: [] });

const r1 = garantirSequenciaNoStatusFollowUp();
const passos = achar('status', 'st-fu').followups;
resultado.instalou = {
  relato: r1,
  passos: passos.map((p) => ({ template: achar('templates', p.templateId)?.atalho, minutos: p.minutos, desistir: p.desistir })),
  outroStatusIntacto: achar('status', 'st-outro').followups.length === 0,
  marcado: Boolean(achar('workspaces', 'w1').followUpPadraoEm),
};
resultado.jaTinha = { passos: achar('status', 'st-fu2').followups, marcado: Boolean(achar('workspaces', 'w2').followUpPadraoEm) };
resultado.semOStatus = { passos: achar('status', 'st-q3').followups.length, marcado: Boolean(achar('workspaces', 'w3').followUpPadraoEm) };
resultado.semTemplate = { passos: achar('status', 'st-fu4').followups.length, marcado: Boolean(achar('workspaces', 'w4').followUpPadraoEm) };

/* Quem ja estava no status nao recebe nada; quem ENTRA depois ganha os tres envios. */
resultado.jaEstava = listar('agendamentos', { contatoId: 'c-ja-estava' }).length;
const antes = Date.now();
await aplicarStatus(achar('contatos', 'c-novo'), achar('status', 'st-fu'), { tipo: 'membro', nome: 'Ana' });
const agendados = listar('agendamentos', { contatoId: 'c-novo' }).sort((a, b) => a.indice - b.indice);
resultado.entrou = agendados.map((a) => ({ tipo: a.tipo, estado: a.estado, template: achar('templates', a.templateId)?.atalho, minutos: a.minutos, emMin: Math.round((Date.parse(a.previstoPara) - antes) / 60000) }));

/* Roda de novo: nada muda. Depois a equipe tira os passos de proposito: o proximo boot nao os poe de volta. */
const r2 = garantirSequenciaNoStatusFollowUp();
atualizar('status', 'st-fu', { followups: [] });
const r3 = garantirSequenciaNoStatusFollowUp();
resultado.depois = { segunda: r2, aposTirar: r3, passos: achar('status', 'st-fu').followups.length };

/* O escritorio que estava sem o template ganha o terceiro: agora instala (e so agora marca). */
inserir('templates', { id: 'tpl-w4-fu3', workspaceId: 'w4', nome: 'fu3', atalho: 'fu3', conteudo: 'c' });
const r4 = garantirSequenciaNoStatusFollowUp();
resultado.quandoOTemplateChega = { relato: r4, passos: achar('status', 'st-fu4').followups.length, marcado: Boolean(achar('workspaces', 'w4').followUpPadraoEm) };

console.log(JSON.stringify(resultado));
await encerrarBanco();
await new Promise((ok) => setTimeout(ok, 300));
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
    if (!s.ok('o escritório de teste roda sem erro', r.codigo === 0, r.texto.slice(-900))) return s;
    const b = JSON.parse(r.texto.trim().split('\n').pop());

    s.ok(
      'o status "Follow up" sem passos ganha fu1 (1 h), fu2 (24 h) e fu3 (72 h), com os templates do escritório',
      b.instalou.relato.instalados === 1 && b.instalou.passos.map((p) => `${p.template}:${p.minutos}`).join(',') === 'fu1:60,fu2:1440,fu3:4320',
      JSON.stringify(b.instalou),
    );
    s.ok('o último passo não desiste do lead nem arquiva', b.instalou.passos.every((p) => p.desistir === null), JSON.stringify(b.instalou.passos));
    s.ok('outro status sem passos não é tocado, e o escritório fica marcado', b.instalou.outroStatusIntacto === true && b.instalou.marcado === true);
    s.ok(
      'o status que a equipe já configurou não é trocado (mesmo com outro jeito de escrever o nome), e fica marcado como visto',
      b.jaTinha.passos.length === 1 && b.jaTinha.passos[0].id === 'fup-meu' && b.jaTinha.passos[0].minutos === 5 && b.jaTinha.marcado === true && b.instalou.relato.jaTinham === 1,
      JSON.stringify(b.jaTinha),
    );
    s.ok('escritório sem o status não muda nem é marcado', b.semOStatus.passos === 0 && b.semOStatus.marcado === false, JSON.stringify(b.semOStatus));
    s.ok('sem os três templates não instala e não marca', b.semTemplate.passos === 0 && b.semTemplate.marcado === false && b.instalou.relato.semTemplates === 1, JSON.stringify(b.semTemplate));

    s.ok('quem já estava no status não recebe nada de uma vez', b.jaEstava === 0, String(b.jaEstava));
    s.ok(
      'a conversa que ENTRA no status ganha os três envios agendados, nos tempos certos',
      b.entrou.length === 3 && b.entrou.map((a) => `${a.template}:${a.minutos}:${a.estado}`).join(',') === 'fu1:60:pendente,fu2:1440:pendente,fu3:4320:pendente' && b.entrou[0].emMin >= 59 && b.entrou[0].emMin <= 61 && b.entrou.every((a) => a.tipo === 'followup'),
      JSON.stringify(b.entrou),
    );
    s.ok(
      'roda uma vez só: de novo não muda nada, e se a equipe tirar os passos de propósito eles não voltam',
      b.depois.segunda.instalados === 0 && b.depois.aposTirar.instalados === 0 && b.depois.passos === 0,
      JSON.stringify(b.depois),
    );
    s.ok('quando o template que faltava chega, aí instala e marca', b.quandoOTemplateChega.relato.instalados === 1 && b.quandoOTemplateChega.passos === 3 && b.quandoOTemplateChega.marcado === true, JSON.stringify(b.quandoOTemplateChega));
  } finally {
    fs.rmSync(pasta, { recursive: true, force: true });
  }
  return s;
}
