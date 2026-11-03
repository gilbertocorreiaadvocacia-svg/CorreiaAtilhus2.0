import { spawn } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

import { suite } from './apoio.js';

/**
 * A sequencia do status "Follow up" (nucleo/followup-padrao.js), 03/11/2026.
 *
 * Pedido do escritorio: "quando eu coloco em Follow up, deveria ficar mandando os
 * follow-ups" e, depois, a cadencia e os textos: primeira mensagem 30 minutos depois, a
 * segunda 2 dias depois, a terceira 3 dias depois, a quarta 5 dias depois e, "se nao
 * tiver nenhuma resposta, desqualifica" (com a quinta mensagem, o aviso de encerramento).
 *
 * O que nao pode falhar:
 *  - o status "Follow up" sem passos ganha quatro mensagens, com os textos do escritorio,
 *    em 30 minutos, 2 dias e 30 min, 5 dias e 30 min e 10 dias e 30 min contados da entrada
 *    (os intervalos viram tempos acumulados, que e como o motor conta); o ultimo passo
 *    espera um dia, manda o aviso de encerramento e desqualifica, concluindo a conversa;
 *  - os cinco textos entram como templates proprios, sem tocar em fu1, fu2 e fu3 (que os
 *    outros status usam), e um template que a equipe ja tinha com o mesmo atalho fica
 *    como esta;
 *  - a conversa que entra no status ganha os quatro envios agendados nos tempos certos;
 *  - o que a versao anterior desta mesma arrumacao instalou (fu1/fu2/fu3 em 1 h, 24 h e
 *    72 h, sem desistir) e trocado pela nova — e SO isso: o que a equipe configurou ou
 *    esvaziou de proposito nao e tocado, nem reposto;
 *  - roda uma vez por escritorio e por versao;
 *  - sem o status Desqualificado, instala os quatro envios sem desistencia;
 *  - quem ja estava no status nao recebe nada de uma vez.
 */
export async function testarFollowUpPadrao({ raiz }) {
  const s = suite('O status Follow up manda quatro mensagens e desqualifica quem não respondeu');
  const url = (arquivo) => JSON.stringify(pathToFileURL(path.join(raiz, arquivo)).href);
  const pasta = fs.mkdtempSync(path.join(os.tmpdir(), 'followup-padrao-'));
  const script = path.join(pasta, 'followup.mjs');

  /* Os textos que o escritorio escreveu, na ordem: o teste os fixa palavra por palavra. */
  const TEXTOS = [
    'Conseguiu pensar melhor? Podemos seguir com seu atendimento?',
    'Olá! Estamos à disposição para te ajudar. Vamos dar continuidade?',
    'Oi! Ficou alguma dúvida sobre os valores que você pode ter direito a receber? 💰',
    'Oi! Posso te fazer uma pergunta rápida sobre seu atendimento?',
    'Oi, {{nome}}! Como não consegui seu retorno, vou encerrar nosso acompanhamento por enquanto. Quando precisar, estaremos à disposição! 😊',
  ];

  fs.writeFileSync(
    script,
    `import { iniciarBanco, achar, inserir, listar, atualizar, encerrarBanco } from ${url('servidor/nucleo/banco.js')};
import { garantirSequenciaNoStatusFollowUp, MINUTOS_ACUMULADOS } from ${url('servidor/nucleo/followup-padrao.js')};
import { aplicarStatus } from ${url('servidor/automacao/followup.js')};
import { copiarConfiguracoes } from ${url('servidor/nucleo/copiar-workspace.js')};
iniciarBanco();
const resultado = { acumulados: MINUTOS_ACUMULADOS };

const templates = (ws, atalhos = ['fu1', 'fu2', 'fu3', 'bemvindo']) => Object.fromEntries(atalhos.map((a) => [a, inserir('templates', { id: 'tpl-' + ws + '-' + a, workspaceId: ws, nome: a, atalho: a, conteudo: 'Ola {{nome}} ' + a })]));
const resumo = (statusId) => achar('status', statusId).followups.map((p) => ({ atalho: achar('templates', p.templateId)?.atalho, texto: achar('templates', p.templateId)?.conteudo, minutos: p.minutos, desistir: p.desistir }));
const v1 = (ws) => [
  { id: 'v1a', templateId: 'tpl-' + ws + '-fu1', minutos: 60, desistir: null },
  { id: 'v1b', templateId: 'tpl-' + ws + '-fu2', minutos: 1440, desistir: null },
  { id: 'v1c', templateId: 'tpl-' + ws + '-fu3', minutos: 4320, desistir: null },
];

/* w1: o escritorio do dia a dia — status "Follow up" sem passos, Desqualificado e uma conversa que ja estava la. */
inserir('workspaces', { id: 'w1', nome: 'Geral' });
templates('w1');
inserir('conexoes', { id: 'cx1', workspaceId: 'w1', tipo: 'simulador', nome: 'Sim' });
inserir('status', { id: 'st-fu', workspaceId: 'w1', nome: 'Follow up', tipo: 'nenhum', followups: [] });
inserir('status', { id: 'st-desq', workspaceId: 'w1', nome: 'Desqualificado', tipo: 'desqualificado', followups: [] });
inserir('status', { id: 'st-outro', workspaceId: 'w1', nome: 'Em análise', tipo: 'analise', followups: [] });
inserir('contatos', { id: 'c-ja-estava', workspaceId: 'w1', conexaoId: 'cx1', telefone: '5581900000001', nome: 'Ja Estava', statusId: 'st-fu', estado: 'arquivado', etiquetas: [] });
inserir('contatos', { id: 'c-novo', workspaceId: 'w1', conexaoId: 'cx1', telefone: '5581900000002', nome: 'Novo', statusId: null, estado: 'pendente', etiquetas: [] });

/* w2: a equipe ja configurou o status (e escreveu "Follow-up"). w3: nao tem o status. */
inserir('workspaces', { id: 'w2', nome: 'Com passos' });
templates('w2');
inserir('status', { id: 'st-fu2', workspaceId: 'w2', nome: 'Follow-up', tipo: 'nenhum', followups: [{ id: 'fup-meu', templateId: 'tpl-w2-bemvindo', minutos: 5, desistir: null }] });
inserir('workspaces', { id: 'w3', nome: 'Sem o status' });
templates('w3');
inserir('status', { id: 'st-q3', workspaceId: 'w3', nome: 'Qualificado', tipo: 'qualificado', followups: [] });
/* w4: tem o status (FOLLOW_UP), nao tem o Desqualificado, e a equipe ja tinha um template followup1 com texto proprio. */
inserir('workspaces', { id: 'w4', nome: 'Sem desqualificado' });
inserir('templates', { id: 'tpl-w4-followup1', workspaceId: 'w4', nome: 'Meu follow 1', atalho: 'followup1', conteudo: 'Texto da equipe' });
inserir('status', { id: 'st-fu4', workspaceId: 'w4', nome: 'FOLLOW_UP', tipo: 'nenhum', followups: [] });
/* w5: a versao anterior desta arrumacao ja tinha instalado fu1/fu2/fu3 em 1 h, 24 h e 72 h. */
inserir('workspaces', { id: 'w5', nome: 'Versao 1', followUpPadraoEm: '2026-11-03T14:23:00.000Z' });
templates('w5');
inserir('status', { id: 'st-desq5', workspaceId: 'w5', nome: 'Desqualificado', tipo: 'desqualificado', followups: [] });
inserir('status', { id: 'st-fu5', workspaceId: 'w5', nome: 'Follow up', tipo: 'nenhum', followups: v1('w5') });
/* w6: a versao 1 estava la e a equipe MUDOU o tempo. w7: a equipe ESVAZIOU de proposito. */
inserir('workspaces', { id: 'w6', nome: 'Mudou', followUpPadraoEm: '2026-11-03T14:23:00.000Z' });
templates('w6');
inserir('status', { id: 'st-fu6', workspaceId: 'w6', nome: 'Follow up', tipo: 'nenhum', followups: v1('w6').map((p, i) => (i === 0 ? { ...p, minutos: 90 } : p)) });
inserir('workspaces', { id: 'w7', nome: 'Esvaziou', followUpPadraoEm: '2026-11-03T14:23:00.000Z' });
templates('w7');
inserir('status', { id: 'st-fu7', workspaceId: 'w7', nome: 'Follow up', tipo: 'nenhum', followups: [] });
/* w8: ja na versao 2. */
inserir('workspaces', { id: 'w8', nome: 'Ja na 2', followUpPadraoVersao: 2, followUpPadraoEm: '2026-11-03T15:00:00.000Z' });
templates('w8');
inserir('status', { id: 'st-fu8', workspaceId: 'w8', nome: 'Follow up', tipo: 'nenhum', followups: [] });

const r1 = garantirSequenciaNoStatusFollowUp();
resultado.relato = r1;
const doEscritorio = (ws) => Object.fromEntries(listar('templates', { workspaceId: ws }).filter((t) => /^followup\\d$/.test(t.atalho)).map((t) => [t.atalho, t.conteudo]));
resultado.geral = {
  passos: resumo('st-fu'),
  textosCriados: doEscritorio('w1'),
  fuIntactos: ['fu1', 'fu2', 'fu3'].every((a) => achar('templates', 'tpl-w1-' + a).conteudo === 'Ola {{nome}} ' + a),
  encerramentoId: listar('templates', { workspaceId: 'w1' }).find((t) => t.atalho === 'followup5')?.id,
  outroStatusIntacto: achar('status', 'st-outro').followups.length === 0,
  versao: achar('workspaces', 'w1').followUpPadraoVersao,
};
resultado.jaTinha = { passos: achar('status', 'st-fu2').followups, versao: achar('workspaces', 'w2').followUpPadraoVersao, criou: Object.keys(doEscritorio('w2')).length };
resultado.semOStatus = { passos: achar('status', 'st-q3').followups.length, versao: achar('workspaces', 'w3').followUpPadraoVersao || 0, criou: Object.keys(doEscritorio('w3')).length };
resultado.semDesqualificado = { passos: resumo('st-fu4'), textos: doEscritorio('w4'), quantos: listar('templates', { workspaceId: 'w4' }).length };
resultado.versao1 = { passos: resumo('st-fu5'), versao: achar('workspaces', 'w5').followUpPadraoVersao };
resultado.mudou = { minutos: achar('status', 'st-fu6').followups.map((p) => p.minutos), versao: achar('workspaces', 'w6').followUpPadraoVersao };
resultado.esvaziou = { passos: achar('status', 'st-fu7').followups.length, versao: achar('workspaces', 'w7').followUpPadraoVersao };
resultado.jaNaDois = { passos: achar('status', 'st-fu8').followups.length };

/* Quem ja estava no status nao recebe nada; quem ENTRA depois ganha os quatro envios. */
resultado.jaEstava = listar('agendamentos', { contatoId: 'c-ja-estava' }).length;
const antes = Date.now();
await aplicarStatus(achar('contatos', 'c-novo'), achar('status', 'st-fu'), { tipo: 'membro', nome: 'Ana' });
const agendados = listar('agendamentos', { contatoId: 'c-novo' }).sort((a, b) => a.indice - b.indice);
resultado.entrou = agendados.map((a) => ({ tipo: a.tipo, estado: a.estado, texto: achar('templates', a.templateId)?.conteudo, minutos: a.minutos, emMin: Math.round((Date.parse(a.previstoPara) - antes) / 60000), desistir: a.desistir ? { statusId: a.desistir.statusId, espera: a.desistir.esperaMinutos, arquivar: a.desistir.arquivar, aviso: a.desistir.templateId } : null }));

/* De novo: nada muda. A equipe tira os passos de proposito: o proximo boot nao os poe de volta. */
const r2 = garantirSequenciaNoStatusFollowUp();
atualizar('status', 'st-fu', { followups: [] });
const r3 = garantirSequenciaNoStatusFollowUp();
resultado.depois = { segunda: r2, aposTirar: r3, passos: achar('status', 'st-fu').followups.length };

/* Copiar o escritorio para outro leva junto o aviso de encerramento: o template e o status de DESTINO, nao os de origem. */
/* No teste de cima a equipe esvaziou o status do w1; refaz a instalacao so para ter o que copiar. */
inserir('workspaces', { id: 'w9', nome: 'Copia' });
atualizar('workspaces', 'w1', { followUpPadraoVersao: 0, followUpPadraoEm: null });
garantirSequenciaNoStatusFollowUp();
copiarConfiguracoes('w9', 'w1', ['templates', 'status']);
const copiaFu = listar('status', { workspaceId: 'w9' }).find((x) => x.nome === 'Follow up');
const ultimaCopia = copiaFu?.followups?.at(-1);
const desqCopia = listar('status', { workspaceId: 'w9' }).find((x) => x.nome === 'Desqualificado');
const avisoCopiado = ultimaCopia?.desistir?.templateId ? achar('templates', ultimaCopia.desistir.templateId) : null;
resultado.copia = {
  passos: copiaFu?.followups?.length,
  statusDeDestino: ultimaCopia?.desistir?.statusId === desqCopia?.id && Boolean(desqCopia),
  avisoEDeDestino: avisoCopiado?.workspaceId === 'w9' && /encerrar/.test(avisoCopiado?.conteudo || ''),
  esperaPreservada: ultimaCopia?.desistir?.esperaMinutos === 1440,
};

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

    s.ok('os intervalos (30 min, 2 dias, 3 dias, 5 dias) viram tempos acumulados da entrada', JSON.stringify(b.acumulados) === JSON.stringify([30, 2910, 7230, 14430]), JSON.stringify(b.acumulados));
    const g = b.geral.passos;
    s.ok(
      'o status "Follow up" sem passos ganha quatro mensagens, com os textos do escritório, nos tempos acumulados',
      g.length === 4 && g.every((p, i) => p.texto === TEXTOS[i] && p.minutos === [30, 2910, 7230, 14430][i]) && b.geral.versao === 2,
      JSON.stringify(g.map((p) => [p.atalho, p.minutos])),
    );
    s.ok(
      'os cinco textos entram como templates proprios (followup1 a followup5), e fu1, fu2 e fu3 dos outros status ficam como estavam',
      Object.keys(b.geral.textosCriados).length === 5 && TEXTOS.every((t, i) => b.geral.textosCriados['followup' + (i + 1)] === t) && b.geral.fuIntactos === true,
      JSON.stringify(b.geral.textosCriados),
    );
    s.ok(
      'só o último passo desqualifica: para o status Desqualificado, concluindo a conversa, um dia depois da quarta mensagem, com o quinto texto como aviso de encerramento',
      g.slice(0, 3).every((p) => p.desistir === null) && g[3].desistir?.ativo === true && g[3].desistir.statusId === 'st-desq' && g[3].desistir.arquivar === true && g[3].desistir.esperaMinutos === 1440 && g[3].desistir.responsavel === null && g[3].desistir.templateId === b.geral.encerramentoId,
      JSON.stringify(g[3]),
    );
    s.ok('outro status sem passos não é tocado', b.geral.outroStatusIntacto === true);
    s.ok('o que a equipe já configurou não é trocado (mesmo escrito "Follow-up"), e nada é criado', b.jaTinha.passos.length === 1 && b.jaTinha.passos[0].id === 'fup-meu' && b.jaTinha.versao === 2 && b.jaTinha.criou === 0, JSON.stringify(b.jaTinha));
    s.ok('escritório sem o status não muda, não é marcado e não ganha templates', b.semOStatus.passos === 0 && b.semOStatus.versao === 0 && b.semOStatus.criou === 0, JSON.stringify(b.semOStatus));
    s.ok(
      'sem o status Desqualificado, instala as quatro mensagens sem desistência; e o template que a equipe já tinha com o atalho followup1 fica com o texto dela',
      b.semDesqualificado.passos.length === 4 && b.semDesqualificado.passos.every((p) => p.desistir === null) && b.semDesqualificado.textos.followup1 === 'Texto da equipe' && b.semDesqualificado.passos[0].texto === 'Texto da equipe' && b.semDesqualificado.quantos === 5 && b.relato.semDesqualificado === 1,
      JSON.stringify(b.semDesqualificado),
    );
    s.ok(
      'o que a versão anterior instalou (fu1/fu2/fu3 em 1 h, 24 h e 72 h) é trocado pela sequência nova',
      b.versao1.passos.length === 4 && b.versao1.passos.every((p, i) => p.texto === TEXTOS[i]) && b.versao1.passos[3].desistir?.statusId === 'st-desq5' && b.versao1.versao === 2 && b.relato.atualizados === 1,
      JSON.stringify(b.versao1.passos.map((p) => [p.atalho, p.minutos])),
    );
    s.ok('mas se a equipe mexeu nele (mudou um tempo), não troca', JSON.stringify(b.mudou.minutos) === JSON.stringify([90, 1440, 4320]) && b.mudou.versao === 2, JSON.stringify(b.mudou));
    s.ok('e se a equipe esvaziou de propósito, não repõe', b.esvaziou.passos === 0 && b.esvaziou.versao === 2, JSON.stringify(b.esvaziou));
    s.ok('escritório que já está na versão 2 não é tocado', b.jaNaDois.passos === 0);
    s.ok('o relato conta: 2 instalados, 1 atualizado e 3 que a equipe já tinha mexido', b.relato.instalados === 2 && b.relato.atualizados === 1 && b.relato.jaTinham === 3, JSON.stringify(b.relato));

    s.ok('quem já estava no status não recebe nada de uma vez', b.jaEstava === 0, String(b.jaEstava));
    s.ok(
      'a conversa que ENTRA no status ganha os quatro envios agendados, com os textos e nos tempos certos, e só o último leva a desistência',
      b.entrou.length === 4 &&
        b.entrou.every((a, i) => a.texto === TEXTOS[i] && a.minutos === [30, 2910, 7230, 14430][i] && a.estado === 'pendente' && a.tipo === 'followup') &&
        b.entrou[0].emMin >= 29 && b.entrou[0].emMin <= 31 &&
        b.entrou.slice(0, 3).every((a) => a.desistir === null) && b.entrou[3].desistir?.statusId === 'st-desq' && b.entrou[3].desistir.espera === 1440 && b.entrou[3].desistir.aviso === b.geral.encerramentoId,
      JSON.stringify(b.entrou),
    );
    s.ok(
      'copiar o escritório para outro leva o aviso de encerramento junto: o template e o status de destino (não os de origem), e a espera',
      b.copia.passos === 4 && b.copia.statusDeDestino === true && b.copia.avisoEDeDestino === true && b.copia.esperaPreservada === true,
      JSON.stringify(b.copia),
    );
    s.ok(
      'roda uma vez por versão: de novo não muda nada, e se a equipe tirar os passos de propósito eles não voltam',
      b.depois.segunda.instalados === 0 && b.depois.segunda.atualizados === 0 && b.depois.aposTirar.instalados === 0 && b.depois.passos === 0,
      JSON.stringify(b.depois),
    );
  } finally {
    fs.rmSync(pasta, { recursive: true, force: true });
  }
  return s;
}
