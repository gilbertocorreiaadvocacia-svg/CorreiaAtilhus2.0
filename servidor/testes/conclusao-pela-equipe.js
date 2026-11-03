import { spawn } from 'node:child_process';
import fs from 'node:fs';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

import { suite } from './apoio.js';

/**
 * Conversa que uma PESSOA concluiu nao volta para a IA sozinha
 * (nucleo/conclusao-pela-equipe.js), 03/11/2026.
 *
 * "Quando eu concluia uma conversa, para nao aparecer em Ativos nem em
 * Pendentes, ela ia direto para Pendentes e a IA nao atuava, porque quem
 * finalizou antes fui eu. Quero que seja assim."
 *
 * O que nao pode falhar:
 *  - concluida por pessoa + cliente escreve: reabre em PENDENTES, sem agente, e a
 *    IA nao responde (nem por palavra-chave, nem por "toda mensagem vai para a
 *    IA", nem pela varredura de pendentes);
 *  - a segunda mensagem do cliente, ja em Pendentes, tambem nao chama a IA;
 *  - uma pessoa que cuidava continua sendo a responsavel; so o agente sai;
 *  - quando uma pessoa decide de novo (escolhe um agente, aceita), a IA volta a
 *    atuar normalmente;
 *  - NAO MUDA para quem nao foi concluido por pessoa (historico importado,
 *    desistencia do follow-up): o cliente que volta continua indo para a IA, e a
 *    palavra-chave continua trocando o especialista;
 *  - quem a equipe ja tinha concluido antes ganha o sinal ao subir, uma vez so, e
 *    so quem tem o registro de conclusao por pessoa.
 *
 * A Anthropic e a de mentira: cada pedido que chega e uma vez que a IA atuou.
 */
export async function testarConclusaoPelaEquipe({ raiz }) {
  const s = suite('Conversa concluída pela equipe volta para Pendentes e a IA não atua');
  const url = (arquivo) => JSON.stringify(pathToFileURL(path.join(raiz, arquivo)).href);
  const pasta = fs.mkdtempSync(path.join(os.tmpdir(), 'conclusao-equipe-'));
  const script = path.join(pasta, 'conclusao.mjs');

  const pedidos = [];
  const iaFalsa = http.createServer((req, res) => {
    const pedacos = [];
    req.on('data', (p) => pedacos.push(p));
    req.on('end', () => {
      let corpo = {};
      try {
        corpo = JSON.parse(Buffer.concat(pedacos).toString('utf8'));
      } catch {}
      pedidos.push({ sistema: String(corpo.system || ''), usuario: JSON.stringify(corpo.messages || []) });
      res.setHeader('content-type', 'application/json');
      res.setHeader('connection', 'close');
      res.end(JSON.stringify({ id: 'msg_teste', type: 'message', role: 'assistant', model: 'claude-sonnet-5', content: [{ type: 'text', text: 'Olá! Como posso ajudar?' }], stop_reason: 'end_turn', usage: { input_tokens: 10, output_tokens: 8 } }));
    });
  });
  await new Promise((ok) => iaFalsa.listen(0, '127.0.0.1', ok));

  fs.writeFileSync(
    script,
    `import { iniciarBanco, achar, inserir, listar, atualizar, mensagensDe, encerrarBanco } from ${url('servidor/nucleo/banco.js')};
import { receberMensagem } from ${url('servidor/whatsapp/recebimento.js')};
import { reatribuirPendentes } from ${url('servidor/automacao/reatribuir-pendentes.js')};
import { LIBERAR_PARA_A_IA, mudancasDeConcluir, marcarConcluidasPelaEquipe, semIaAutomatica } from ${url('servidor/nucleo/conclusao-pela-equipe.js')};
import { escolherAgente } from ${url('servidor/ia/escolher-agente.js')};
iniciarBanco();
const espera = (ms) => new Promise((ok) => setTimeout(ok, ms));
const resultado = {};

inserir('workspaces', { id: 'w1', nome: 'Correia' });
inserir('integracoes', { id: 'int1', workspaceId: 'w1', ia: { chaveAnthropic: 'sk-ant-teste' } });
inserir('conexoes', { id: 'cx1', workspaceId: 'w1', tipo: 'simulador', nome: 'Sim' });
inserir('usuarios', { id: 'u1', nome: 'Ana' });
inserir('membros', { id: 'm1', workspaceId: 'w1', usuarioId: 'u1', papel: 'atendente' });
/* A recepcao (entrada) e um especialista com palavra-chave. */
inserir('agentes', { id: 'ag1', workspaceId: 'w1', nome: 'Eduarda', ativo: true, objetivo: 'recepcionar', modelo: 'claude-sonnet-5', delaySegundos: 1, prompt: 'Atenda.' });
inserir('agentes', { id: 'ag2', workspaceId: 'w1', nome: 'Especialista BPC', ativo: true, modelo: 'claude-sonnet-5', delaySegundos: 1, prompt: 'Atenda o BPC.', palavrasChave: ['zzzbpcteste'] });
const IA = { tipo: 'agente', id: 'ag1', nome: 'Eduarda' };
const ANA = { tipo: 'membro', id: 'm1', nome: 'Ana' };

let numero = 5581900000000;
function conversa(id, extra = {}) {
  numero += 1;
  inserir('contatos', { id, workspaceId: 'w1', conexaoId: 'cx1', telefone: String(numero), nome: id, estado: 'ia', responsavel: { ...IA }, etiquetas: [], criadoEm: '2026-10-30T12:00:00.000Z', ...extra });
  return achar('contatos', id);
}
const escrever = (id, conteudo) => receberMensagem({ workspaceId: 'w1', conexao: achar('conexoes', 'cx1'), telefone: achar('contatos', id).telefone, nome: id, conteudo });
const saidas = (id) => mensagensDe(id).filter((m) => m.direcao === 'saida' && m.autor?.tipo === 'agente').length;
const contato = (id) => achar('contatos', id);
const abaDe = (c) => (c.estado === 'arquivado' ? 'concluidos' : c.responsavel?.tipo === 'agente' ? 'ia' : c.aceitoPor ? 'ativos' : 'pendentes');

/* 1. Concluida por uma pessoa (agente era o responsavel) e o cliente volta. */
conversa('U1');
atualizar('contatos', 'U1', mudancasDeConcluir({ id: 'm1' }, 'Ana'));
resultado.concluida = { estado: contato('U1').estado, sinal: semIaAutomatica(contato('U1')), por: contato('U1').semIa?.por?.nome };
await escrever('U1', 'oi, voltei');
await espera(2800);
resultado.volta = { estado: contato('U1').estado, aba: abaDe(contato('U1')), responsavel: contato('U1').responsavel, aceitoPor: contato('U1').aceitoPor, sinal: semIaAutomatica(contato('U1')), respostasDaIa: saidas('U1'), log: listar('logs', { contatoId: 'U1', tipo: 'desarquivar' }).map((l) => l.descricao) };

/* 2. A segunda mensagem, ja em Pendentes, tambem nao chama a IA. */
await escrever('U1', 'alguem ai?');
await espera(2800);
resultado.segunda = { aba: abaDe(contato('U1')), respostasDaIa: saidas('U1'), responsavel: contato('U1').responsavel };

/* 3. A varredura que devolve pendentes para a IA nao toca nela, e a escolha automatica devolve nada. */
const varredura = reatribuirPendentes();
resultado.varredura = { reativados: varredura.reativados, aba: abaDe(contato('U1')), escolha: escolherAgente({ workspaceId: 'w1', contato: contato('U1'), conexao: achar('conexoes', 'cx1'), texto: 'zzzbpcteste' }) };

/* 4. Palavra-chave nova numa conversa concluida pela equipe: nao troca de agente. */
conversa('U4');
atualizar('contatos', 'U4', mudancasDeConcluir({ id: 'm1' }, 'Ana'));
await escrever('U4', 'quero falar de zzzbpcteste');
await espera(2800);
resultado.palavraChave = { aba: abaDe(contato('U4')), responsavel: contato('U4').responsavel, respostasDaIa: saidas('U4') };

/* 5. Uma pessoa que cuidava continua responsavel; so o agente sai. */
conversa('U5', { estado: 'ativo', responsavel: { ...ANA }, aceitoPor: 'm1', aceitoEm: '2026-10-30T12:00:00.000Z' });
atualizar('contatos', 'U5', mudancasDeConcluir({ id: 'm1' }, 'Ana'));
await escrever('U5', 'voltei');
await espera(2800);
resultado.comPessoa = { aba: abaDe(contato('U5')), responsavel: contato('U5').responsavel, estado: contato('U5').estado, aceitoPor: contato('U5').aceitoPor, respostasDaIa: saidas('U5') };

/* 6. Uma pessoa decide de novo (escolhe um agente, como a rota PATCH faz): a IA volta a atuar. */
atualizar('contatos', 'U1', { responsavel: { ...IA }, estado: 'ia', aceitoPor: null, ...LIBERAR_PARA_A_IA });
resultado.liberada = { sinal: semIaAutomatica(contato('U1')) };
await escrever('U1', 'obrigado, e agora?');
await espera(2800);
resultado.depoisDeLiberar = { aba: abaDe(contato('U1')), respostasDaIa: saidas('U1') };

/* 7. NAO MUDA para quem nao foi concluido por pessoa (importado, desistencia do follow-up). */
conversa('N1', { estado: 'arquivado', responsavel: null, importado: true });
conversa('N2', { estado: 'arquivado' });
conversa('N3', { estado: 'arquivado', responsavel: null });
await escrever('N1', 'oi, sou eu de novo');
await escrever('N2', 'preciso de ajuda');
await escrever('N3', 'quero falar de zzzbpcteste');
await espera(2800);
resultado.semSinal = {
  importado: { aba: abaDe(contato('N1')), respostasDaIa: saidas('N1'), sinal: semIaAutomatica(contato('N1')) },
  comAgente: { aba: abaDe(contato('N2')), respostasDaIa: saidas('N2') },
  palavraChave: { responsavel: contato('N3').responsavel?.id, respostasDaIa: saidas('N3') },
};

/* 8. Quem a equipe ja concluiu antes da regra ganha o sinal ao subir, uma vez so. */
conversa('R1', { estado: 'arquivado' });
inserir('logs', { workspaceId: 'w1', contatoId: 'R1', tipo: 'arquivo', descricao: 'Atendimento concluido', criadoEm: '2026-10-31T10:00:00.000Z' });
conversa('R2', { estado: 'arquivado' });           /* concluida, mas reaberta pelo cliente depois e concluida de novo por outro caminho */
inserir('logs', { workspaceId: 'w1', contatoId: 'R2', tipo: 'arquivo', descricao: 'Atendimento concluido', criadoEm: '2026-10-30T10:00:00.000Z' });
inserir('logs', { workspaceId: 'w1', contatoId: 'R2', tipo: 'desarquivar', descricao: 'Conversa reaberta porque o cliente escreveu', criadoEm: '2026-10-31T10:00:00.000Z' });
conversa('R3', { estado: 'arquivado' });           /* sem registro nenhum: historico importado ou follow-up */
conversa('R4', { estado: 'ia' });                  /* nao esta concluida */
inserir('logs', { workspaceId: 'w1', contatoId: 'R4', tipo: 'arquivo', descricao: 'Atendimento concluido', criadoEm: '2026-10-29T10:00:00.000Z' });
conversa('R5', { estado: 'arquivado' });
inserir('logs', { workspaceId: 'w1', contatoId: 'R5', tipo: 'arquivo', descricao: 'Conversa reaberta', criadoEm: '2026-10-29T10:00:00.000Z' });
/* O que as arrumacoes do historico do celular gravam: "Concluida na arrumacao de Ativos..." — NAO e conclusao por pessoa. */
conversa('R6', { estado: 'arquivado', importado: true });
inserir('logs', { workspaceId: 'w1', contatoId: 'R6', tipo: 'arquivo', descricao: 'Concluida na arrumacao de Ativos: conversa do historico do celular sem mensagem ha mais de 30 dias. Reabre sozinha se o cliente escrever.', criadoEm: '2026-10-27T10:00:00.000Z' });
/* Marcada pela primeira versao desta regra, que olhava so a palavra "conclu": o sinal tem de sair. */
conversa('R7', { estado: 'arquivado', importado: true, semIa: { motivo: 'concluida-pela-equipe', em: '2026-10-28T10:00:00.000Z', por: null, retroativo: true } });
inserir('logs', { workspaceId: 'w1', contatoId: 'R7', tipo: 'arquivo', descricao: 'Concluida na arrumacao de Ativos: conversa do historico do celular que ninguem mexeu pelo sistema. Reabre sozinha se o cliente escrever.', criadoEm: '2026-10-28T10:00:00.000Z' });
/* Marcada de verdade (a conclusao por pessoa existe) e depois reaberta pelo cliente: o sinal FICA, ela espera a equipe. */
conversa('R8', { estado: 'pendente', responsavel: null, semIa: { motivo: 'concluida-pela-equipe', em: '2026-10-26T10:00:00.000Z', por: null, retroativo: true } });
inserir('logs', { workspaceId: 'w1', contatoId: 'R8', tipo: 'arquivo', descricao: 'Atendimento concluido', criadoEm: '2026-10-26T10:00:00.000Z' });
inserir('logs', { workspaceId: 'w1', contatoId: 'R8', tipo: 'desarquivar', descricao: 'Conversa reaberta porque o cliente escreveu. Foi concluida pela equipe: fica em Pendentes e a IA nao atende sozinha', criadoEm: '2026-10-31T09:00:00.000Z' });
/* Marcada, mas o registro de origem nao existe mais: sem como confirmar, o sinal sai (o seguro e o comportamento de antes). */
conversa('R9', { estado: 'arquivado', semIa: { motivo: 'concluida-pela-equipe', em: '2026-10-25T10:00:00.000Z', por: null, retroativo: true } });
/* Concluida pela rota nova (nao retroativa): a conferencia nao mexe. */
conversa('R10', { estado: 'arquivado' });
atualizar('contatos', 'R10', mudancasDeConcluir({ id: 'm1' }, 'Ana'));
const { marcadas, corrigidas } = marcarConcluidasPelaEquipe();
const deNovo = marcarConcluidasPelaEquipe();
const marcadasDeNovo = deNovo.marcadas + deNovo.corrigidas;
resultado.retroativo = {
  marcadas, corrigidas, marcadasDeNovo,
  sinais: Object.fromEntries(['R1', 'R2', 'R3', 'R4', 'R5', 'R6', 'R7', 'R8', 'R9', 'R10'].map((id) => [id, semIaAutomatica(contato(id))])),
  retroativo: contato('R1').semIa?.retroativo === true,
  em: contato('R1').semIa?.em,
};
await escrever('R1', 'voltei de novo');
await espera(2800);
resultado.retroativoVolta = { aba: abaDe(contato('R1')), respostasDaIa: saidas('R1') };

console.log(JSON.stringify(resultado));
await encerrarBanco();
await espera(300);
process.exit(0);
`,
  );

  try {
    const r = await new Promise((resolve) => {
      const p = spawn(process.execPath, [script], {
        env: { ...process.env, CORREIA_DADOS: pasta, CORREIA_ANTHROPIC_URL: `http://127.0.0.1:${iaFalsa.address().port}`, ANTHROPIC_API_KEY: '', OPENAI_API_KEY: '' },
        stdio: ['ignore', 'pipe', 'pipe'],
      });
      let texto = '';
      p.stdout.on('data', (d) => (texto += d));
      p.stderr.on('data', (d) => (texto += d));
      p.on('close', (codigo) => resolve({ codigo, texto }));
    });
    if (!s.ok('o escritório de teste roda sem erro', r.codigo === 0, r.texto.slice(-1200))) return s;
    const b = JSON.parse(r.texto.trim().split('\n').pop());

    s.ok('concluir por uma pessoa grava o sinal, com quem concluiu', b.concluida.estado === 'arquivado' && b.concluida.sinal === true && b.concluida.por === 'Ana', JSON.stringify(b.concluida));
    s.ok(
      'o cliente escreve: a conversa volta DIRETO para Pendentes, sem agente, e a IA não responde',
      b.volta.estado === 'pendente' && b.volta.aba === 'pendentes' && b.volta.responsavel === null && b.volta.aceitoPor === null && b.volta.respostasDaIa === 0,
      JSON.stringify(b.volta),
    );
    s.ok('o histórico diz por quê', b.volta.log.some((d) => /concluida pela equipe: fica em Pendentes e a IA nao atende sozinha/.test(d)), JSON.stringify(b.volta.log));
    s.ok('o sinal continua: ela espera a equipe, e é por isso que a segunda mensagem também não chama a IA', b.volta.sinal === true && b.segunda.aba === 'pendentes' && b.segunda.respostasDaIa === 0 && b.segunda.responsavel === null, JSON.stringify({ v: b.volta.sinal, s: b.segunda }));
    s.ok(
      'a varredura que devolve pendentes à IA não toca nela, e a escolha automática (palavra-chave inclusive) devolve nada',
      b.varredura.reativados === 0 && b.varredura.aba === 'pendentes' && b.varredura.escolha === null,
      JSON.stringify(b.varredura),
    );
    s.ok('palavra-chave nova numa conversa concluída pela equipe não ativa especialista nem a IA', b.palavraChave.aba === 'pendentes' && b.palavraChave.responsavel === null && b.palavraChave.respostasDaIa === 0, JSON.stringify(b.palavraChave));
    s.ok(
      'a pessoa que cuidava continua responsável (só o agente sai), em Pendentes, sem a IA',
      b.comPessoa.aba === 'pendentes' && b.comPessoa.responsavel?.tipo === 'membro' && b.comPessoa.responsavel.id === 'm1' && b.comPessoa.estado === 'pendente' && b.comPessoa.aceitoPor === null && b.comPessoa.respostasDaIa === 0,
      JSON.stringify(b.comPessoa),
    );
    s.ok('uma pessoa escolhe um agente de novo: o sinal sai e a IA volta a responder', b.liberada.sinal === false && b.depoisDeLiberar.aba === 'ia' && b.depoisDeLiberar.respostasDaIa === 1, JSON.stringify({ l: b.liberada, d: b.depoisDeLiberar }));

    s.ok(
      'NÃO MUDA para o importado e para o que não foi concluído por pessoa: o cliente que volta vai para a IA, como antes',
      b.semSinal.importado.sinal === false && b.semSinal.importado.aba === 'ia' && b.semSinal.importado.respostasDaIa === 1 && b.semSinal.comAgente.aba === 'ia' && b.semSinal.comAgente.respostasDaIa === 1,
      JSON.stringify(b.semSinal),
    );
    s.ok('e a palavra-chave continua trocando para o especialista nesses casos', b.semSinal.palavraChave.responsavel === 'ag2' && b.semSinal.palavraChave.respostasDaIa === 1, JSON.stringify(b.semSinal.palavraChave));

    s.ok(
      'ao subir, só ganha o sinal quem está concluída agora e cujo último registro é uma conclusão por pessoa',
      b.retroativo.marcadas === 1 && b.retroativo.sinais.R1 === true && b.retroativo.sinais.R2 === false && b.retroativo.sinais.R3 === false && b.retroativo.sinais.R4 === false && b.retroativo.sinais.R5 === false && b.retroativo.sinais.R6 === false,
      JSON.stringify(b.retroativo),
    );
    s.ok(
      'a conclusão que o sistema fez sozinho (arrumação do histórico do celular, "Concluida na arrumacao de Ativos...") NÃO conta como conclusão por pessoa: não recebe o sinal',
      b.retroativo.sinais.R6 === false,
      JSON.stringify(b.retroativo.sinais),
    );
    s.ok(
      'conferência do que uma versão anterior marcou: o sinal sai de quem foi marcada pela arrumação do histórico e de quem não tem mais o registro de origem; fica em quem tem a conclusão por pessoa (mesmo reaberta pelo cliente) e em quem concluiu pela rota',
      b.retroativo.corrigidas === 2 && b.retroativo.sinais.R7 === false && b.retroativo.sinais.R9 === false && b.retroativo.sinais.R8 === true && b.retroativo.sinais.R10 === true && b.retroativo.sinais.R1 === true,
      JSON.stringify({ corrigidas: b.retroativo.corrigidas, sinais: b.retroativo.sinais }),
    );
    s.ok('roda uma vez só, e marca com a data da conclusão e como retroativo', b.retroativo.marcadasDeNovo === 0 && b.retroativo.retroativo === true && b.retroativo.em === '2026-10-31T10:00:00.000Z', JSON.stringify(b.retroativo));
    s.ok('a concluída de antes também volta para Pendentes sem a IA', b.retroativoVolta.aba === 'pendentes' && b.retroativoVolta.respostasDaIa === 0, JSON.stringify(b.retroativoVolta));
  } finally {
    iaFalsa.closeAllConnections?.();
    await new Promise((ok) => iaFalsa.close(ok));
    fs.rmSync(pasta, { recursive: true, force: true });
  }
  return s;
}
