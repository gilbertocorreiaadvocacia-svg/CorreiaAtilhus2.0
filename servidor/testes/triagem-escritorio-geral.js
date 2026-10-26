import { spawn } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

import { suite } from './apoio.js';

/**
 * `garantirTriagemNoEscritorioGeral` (nucleo/agentes-por-escritorio.js):
 * reproduz o caso real do "Ricardo" (achado em producao em 23/10/2026) —
 * escritorio geral, sem area, com um numero de anuncio sem responsavel
 * padrao nenhum, e o cliente perguntando sobre auxílio-acidente fica
 * pendente para sempre porque o escritorio geral nasce so com o agente de
 * avaliacao, sem nenhuma Triagem.
 *
 * O que nao pode falhar: o escritorio geral com numero de verdade sem
 * responsavel ganha o pacote inteiro do Previdenciario (Eduarda e os
 * especialistas dela), Eduarda vira responsavel padrao do numero, e o
 * pendente (o "Ricardo") e reatribuido a ela e recebe resposta de
 * verdade; o escritorio de area (ja coberto por ligarNumerosDasAreas) nao
 * e duplicado por esta funcao; escritorio geral SEM nenhum numero de
 * verdade (so simulador) nao ganha agente nenhum; rodar de novo nao
 * reinstala o pacote nem religa quem ja foi ligado.
 *
 * E a equipe trabalhista junto (24/10/2026): os oito do
 * roteiro, ligados e sem area, com o rascunho trabalhista e sem a base de
 * objecoes previdenciaria; a Eduarda do escritorio geral passando o
 * trabalhista para a Triagem Trabalhista e continuando a entrada do
 * escritorio; a Eduarda do escritorio Previdenciario intocada.
 *
 * E o escritorio geral como estava no ar em 26/10/2026, com todos os agentes
 * desligados: a equipe entra desligada e nao vira a entrada de todo lead,
 * volta junto no "Ativar todos", e a Eduarda so passa o trabalhista para a
 * Triagem Trabalhista enquanto ela estiver ligada.
 */
export async function testarTriagemEscritorioGeral({ raiz }) {
  const s = suite('Escritorio geral sem area ganha a Triagem do Previdenciario para atender de verdade');
  const urlDoBanco = pathToFileURL(path.join(raiz, 'servidor/nucleo/banco.js')).href;
  const urlDoReatribuir = pathToFileURL(path.join(raiz, 'servidor/automacao/reatribuir-pendentes.js')).href;
  const urlDoAgentesPorEscritorio = pathToFileURL(path.join(raiz, 'servidor/nucleo/agentes-por-escritorio.js')).href;
  const url = (arquivo) => JSON.stringify(pathToFileURL(path.join(raiz, arquivo)).href);
  const pasta = fs.mkdtempSync(path.join(os.tmpdir(), 'triagem-geral-'));

  const rodar = (arquivo, args = [], dados = pasta) =>
    new Promise((resolve) => {
      const p = spawn(process.execPath, [arquivo, ...args], { env: { ...process.env, CORREIA_DADOS: dados }, stdio: ['ignore', 'pipe', 'pipe'] });
      let texto = '';
      p.stdout.on('data', (d) => (texto += d));
      p.stderr.on('data', (d) => (texto += d));
      p.on('close', (codigo) => resolve({ codigo, texto }));
    });

  const montagem = path.join(pasta, 'montar.mjs');
  fs.writeFileSync(
    montagem,
    `import { iniciarBanco, inserir, encerrarBanco } from ${JSON.stringify(urlDoBanco)};
import { EDUARDA } from ${url('servidor/ia/pacotes/triagem.js')};
iniciarBanco();

/* Escritorio geral de verdade: sem area, com o numero de anuncio igual ao
   caso real, e o agente de avaliacao que ele ja nasce tendo. Mais uma
   Triagem Trabalhista antiga, desligada e criada ANTES de tudo (fica primeiro
   na lista), e a base de objecoes previdenciaria do escritorio. */
inserir('workspaces', { id: 'w-geral', nome: 'Correia Advogados' });
inserir('agentes', { id: 'ag-triagem-velha', workspaceId: 'w-geral', nome: 'Triagem Trabalhista', ativo: false, area: 'trabalhista', prompt: 'prompt afinado pelo escritorio', conhecimentoIds: [] });
inserir('agentes', { id: 'ag-avaliacao', workspaceId: 'w-geral', nome: 'Avaliação · Escritório geral', ativo: true, objetivo: 'avaliar' });
inserir('conhecimento', { id: 'k-objecoes-prev', workspaceId: 'w-geral', nome: 'Quebra de objeções', conteudo: 'objecoes do previdenciario', arquivos: [] });

/* Escritorio do Previdenciario, com a Eduarda do pacote: nao e tocado. */
inserir('workspaces', { id: 'w-prev', nome: 'Previdenciario', area: 'previdenciario' });
inserir('conexoes', { id: 'conx-prev', workspaceId: 'w-prev', tipo: 'oficial', nome: 'Previdenciario', area: 'previdenciario', responsavelPadrao: null });
inserir('agentes', { id: 'ag-eduarda-prev', workspaceId: 'w-prev', nome: EDUARDA.nome, ativo: true, area: 'previdenciario', prompt: EDUARDA.prompt });
inserir('conexoes', { id: 'conx-facebook', workspaceId: 'w-geral', tipo: 'oficial', nome: 'Trafego pago - Facebook', responsavelPadrao: null });
inserir('conexoes', { id: 'conx-sim-geral', workspaceId: 'w-geral', tipo: 'simulador', nome: 'Chat de teste', responsavelPadrao: null });

/* Escritorio SO com simulador: nao deve ganhar agente nenhum. */
inserir('workspaces', { id: 'w-vazio', nome: 'Filial Teste' });
inserir('conexoes', { id: 'conx-sim-vazio', workspaceId: 'w-vazio', tipo: 'simulador', nome: 'Chat de teste', responsavelPadrao: null });

/* O "Ricardo": pendente, perguntando sobre auxilio-acidente. */
inserir('contatos', { id: 'c-ricardo', workspaceId: 'w-geral', conexaoId: 'conx-facebook', telefone: '5548920056366', nome: 'Ricardo', estado: 'pendente', responsavel: null, ultimaEntradaEm: new Date().toISOString(), etiquetas: [] });
await encerrarBanco();
`,
  );

  const rodarVarredura = path.join(pasta, 'varrer.mjs');
  fs.writeFileSync(
    rodarVarredura,
    `import { iniciarBanco, achar, listar, mensagensDe, encerrarBanco } from ${JSON.stringify(urlDoBanco)};
import { comoEduardaPassaOTrabalhista, garantirTriagemNoEscritorioGeral } from ${JSON.stringify(urlDoAgentesPorEscritorio)};
import { reatribuirPendentes } from ${JSON.stringify(urlDoReatribuir)};
import { processarBaseEStatus } from ${url('servidor/nucleo/base-e-status.js')};
import { escolherAgente } from ${url('servidor/ia/escolher-agente.js')};
import { ferramentasDoAgente } from ${url('servidor/ia/mencoes.js')};
import { EQUIPE_TRABALHISTA_NO_GERAL } from ${url('servidor/ia/pacotes.js')};
import { TRABALHISTA_PARA_AGENTE, TRABALHISTA_PARA_PESSOA, TRAVA_PARA_AGENTE } from ${url('servidor/ia/pacotes/triagem.js')};
iniciarBanco();
const ligados = garantirTriagemNoEscritorioGeral();
/* Na ordem do boot (servidor/index.js): a base vem depois da instalacao. */
processarBaseEStatus({ aplicar: true });
const resultado = reatribuirPendentes();
/* A Eduarda e a de verdade (do pacote real, sem delaySegundos proprio no
   teste) — o delay dela e o padrao de producao, 15s (ver novoAgente, em
   nucleo/agentes-por-escritorio.js). Espera generosa para o timer ter
   chance de disparar dentro deste processo descartavel — so na primeira
   chamada (--esperar-resposta); a segunda ("rodar de novo") nao reatribui
   ninguem, entao nao ha resposta nenhuma para esperar. */
if (process.argv.includes('--esperar-resposta')) await new Promise((resolver) => setTimeout(resolver, 16500));
const agentesDoGeral = listar('agentes', { workspaceId: 'w-geral' }).map((a) => ({ nome: a.nome, ativo: a.ativo }));
const saida = {
  ligados,
  resultado,
  facebook: achar('conexoes', 'conx-facebook'),
  simuladorGeral: achar('conexoes', 'conx-sim-geral'),
  agentesDoFilialTeste: listar('agentes', { workspaceId: 'w-vazio' }).length,
  ricardo: achar('contatos', 'c-ricardo'),
  mensagensDoRicardo: mensagensDe('c-ricardo').length,
  qtdAgentesDoGeral: agentesDoGeral.length,
  temEspecialistaAuxilioAcidente: agentesDoGeral.some((a) => a.nome.includes('Beatriz')),
};

const doGeral = listar('agentes', { workspaceId: 'w-geral' });
const equipe = EQUIPE_TRABALHISTA_NO_GERAL.agentes.map((modelo) => doGeral.filter((a) => a.nome === modelo.nome));
const rascunho = listar('conhecimento', { workspaceId: 'w-geral' }).find((k) => k.nome.includes('Trabalhista (rascunho)'));
const eduardaGeral = doGeral.find((a) => a.nome === 'Eduarda (Triagem)');
const transferir = ferramentasDoAgente(eduardaGeral, 'w-geral').find((f) => f.nome === 'transferir_conversa');
saida.equipe = {
  completa: equipe.every((iguais) => iguais.length === 1),
  ligadaSemArea: equipe.every(([a]) => a?.ativo && !a?.area),
  comRascunhoTrabalhista: Boolean(rascunho) && equipe.every(([a]) => (a?.conhecimentoIds || []).includes(rascunho.id)),
  semBasePrevidenciaria: equipe.every(([a]) => !(a?.conhecimentoIds || []).includes('k-objecoes-prev')),
  semPosVendaNemAvaliacaoTrabalhista: !doGeral.some((a) => ['Pós-venda · Trabalhista', 'Avaliação · Trabalhista'].includes(a.nome)),
};
saida.triagemVelha = achar('agentes', 'ag-triagem-velha');
saida.eduardaGeral = {
  paraAgente: eduardaGeral.prompt.includes(TRABALHISTA_PARA_AGENTE),
  paraPessoa: eduardaGeral.prompt.includes(TRABALHISTA_PARA_PESSOA),
  travaNova: eduardaGeral.prompt.includes(TRAVA_PARA_AGENTE),
  tamanho: eduardaGeral.prompt.length,
};
saida.destinosDaEduarda = transferir?.parametros?.properties?.destino?.enum || [];
saida.entradaDoGeral = escolherAgente({ workspaceId: 'w-geral' })?.agente?.nome;
saida.comoPassaNoGeral = comoEduardaPassaOTrabalhista('w-geral');
saida.eduardaPrev = {
  paraPessoa: achar('agentes', 'ag-eduarda-prev').prompt.includes(TRABALHISTA_PARA_PESSOA),
  comoPassa: comoEduardaPassaOTrabalhista('w-prev'),
  agentes: listar('agentes', { workspaceId: 'w-prev' }).length,
};
console.log(JSON.stringify(saida));
await encerrarBanco();
process.exit(0);
`,
  );

  try {
    const m = await rodar(montagem);
    if (!s.ok('a base descartavel foi montada', m.codigo === 0, m.texto.slice(-400))) return s;

    const r = await rodar(rodarVarredura, ['--esperar-resposta']);
    if (!s.ok('a varredura roda sem erro', r.codigo === 0, r.texto.slice(-500))) return s;
    const b = JSON.parse(r.texto.trim().split('\n').pop());

    s.ok('o escritorio geral ganhou o pacote inteiro do Previdenciario (mais de 10 agentes)', b.qtdAgentesDoGeral > 10, JSON.stringify(b.qtdAgentesDoGeral));
    s.ok('o agente de avaliacao que ja existia continua la (nao foi substituido)', b.qtdAgentesDoGeral >= 11, JSON.stringify(b.qtdAgentesDoGeral));
    s.ok('a Beatriz (especialista de auxilio-acidente) foi instalada junto', b.temEspecialistaAuxilioAcidente, JSON.stringify(b));

    s.ok('ligou exatamente 1 numero (o do Facebook, nao o simulador)', b.ligados === 1, JSON.stringify(b.ligados));
    s.ok('a conexao do Facebook ganhou a Eduarda como responsavel padrao', b.facebook?.responsavelPadrao?.nome === 'Eduarda (Triagem)', JSON.stringify(b.facebook?.responsavelPadrao));
    s.ok('o simulador do escritorio geral nunca e tocado', !b.simuladorGeral?.responsavelPadrao, JSON.stringify(b.simuladorGeral?.responsavelPadrao));
    s.ok('o "Filial Teste" (so simulador) nao ganhou agente nenhum', b.agentesDoFilialTeste === 0, JSON.stringify(b.agentesDoFilialTeste));

    s.ok('o Ricardo (pendente) foi reatribuido', b.resultado.reativados === 1, JSON.stringify(b.resultado));
    s.ok('o Ricardo ganha a Eduarda como responsavel e vira estado ia', b.ricardo?.responsavel?.nome === 'Eduarda (Triagem)' && b.ricardo?.estado === 'ia', JSON.stringify(b.ricardo));
    s.ok('o Ricardo recebe uma resposta de verdade da Eduarda', b.mensagensDoRicardo > 0, JSON.stringify(b.mensagensDoRicardo));

    /* A equipe trabalhista (24/10/2026). */
    s.ok('o escritorio geral ganhou a equipe trabalhista inteira, sem repetir ninguem', b.equipe.completa, JSON.stringify(b.equipe));
    s.ok('ligada e sem area, para a Eduarda conseguir passar para ela', b.equipe.ligadaSemArea, JSON.stringify(b.equipe));
    s.ok(
      'a Triagem Trabalhista que ja existia foi religada, com o prompt que o escritorio afinou',
      b.triagemVelha?.ativo === true && !b.triagemVelha?.area && b.triagemVelha?.prompt === 'prompt afinado pelo escritorio',
      JSON.stringify(b.triagemVelha),
    );
    s.ok('sem pos-venda nem avaliacao trabalhista repetidos (o geral ja tem os seus)', b.equipe.semPosVendaNemAvaliacaoTrabalhista);
    s.ok('a equipe trabalhista nao recebe a base de objecoes previdenciaria', b.equipe.semBasePrevidenciaria);
    s.ok('e recebe o rascunho trabalhista', b.equipe.comRascunhoTrabalhista, JSON.stringify(b.equipe));
    s.ok(
      'a Eduarda do escritorio geral passa o trabalhista para a Triagem Trabalhista, nao para uma pessoa',
      b.eduardaGeral.paraAgente && !b.eduardaGeral.paraPessoa && b.eduardaGeral.travaNova,
      JSON.stringify(b.eduardaGeral),
    );
    s.ok('a Triagem Trabalhista esta entre os destinos da Eduarda', b.destinosDaEduarda.includes('Triagem Trabalhista'), JSON.stringify(b.destinosDaEduarda));
    s.ok('a Eduarda continua sendo a entrada do escritorio geral', b.entradaDoGeral === 'Eduarda (Triagem)', JSON.stringify(b.entradaDoGeral));
    s.ok('o /api/saude mostra que a Eduarda passa o trabalhista para agente', b.comoPassaNoGeral === 'agente', JSON.stringify(b.comoPassaNoGeral));
    s.ok(
      'a Eduarda do escritorio Previdenciario continua passando o trabalhista para uma pessoa, e ninguem entra la',
      b.eduardaPrev.paraPessoa && b.eduardaPrev.comoPassa === 'pessoa' && b.eduardaPrev.agentes === 1,
      JSON.stringify(b.eduardaPrev),
    );

    const r2 = await rodar(rodarVarredura);
    const c = JSON.parse(r2.texto.trim().split('\n').pop());
    s.ok('rodar de novo nao reinstala o pacote por cima (mesma contagem de agentes)', c.qtdAgentesDoGeral === b.qtdAgentesDoGeral, JSON.stringify({ antes: b.qtdAgentesDoGeral, depois: c.qtdAgentesDoGeral }));
    s.ok('rodar de novo nao religa quem ja foi ligado', c.ligados === 0, JSON.stringify(c.ligados));
    s.ok(
      'rodar de novo nao mexe outra vez no prompt da Eduarda',
      JSON.stringify(c.eduardaGeral) === JSON.stringify(b.eduardaGeral) && c.equipe.completa,
      JSON.stringify({ antes: b.eduardaGeral, depois: c.eduardaGeral }),
    );
  } finally {
    fs.rmSync(pasta, { recursive: true, force: true });
  }

  /* ---------------- Escritorio geral com a IA desligada (26/10/2026) ---------------- */

  const pastaDesligada = fs.mkdtempSync(path.join(os.tmpdir(), 'triagem-geral-desligada-'));
  const desligado = path.join(pastaDesligada, 'desligado.mjs');
  fs.writeFileSync(
    desligado,
    `import { iniciarBanco, achar, atualizar, inserir, listar, encerrarBanco } from ${JSON.stringify(urlDoBanco)};
import { comoEduardaPassaOTrabalhista, garantirTriagemNoEscritorioGeral } from ${JSON.stringify(urlDoAgentesPorEscritorio)};
import { reatribuirPendentes } from ${JSON.stringify(urlDoReatribuir)};
import { escolherAgente } from ${url('servidor/ia/escolher-agente.js')};
import { EQUIPE_TRABALHISTA_NO_GERAL } from ${url('servidor/ia/pacotes.js')};
import { EDUARDA } from ${url('servidor/ia/pacotes/triagem.js')};
iniciarBanco();

/* Como estava no ar: o Previdenciario ja instalado, a equipe trabalhista
   ainda nao, todos os agentes desligados ("Desligar todos"), uma pessoa como
   padrao do numero e um lead pendente. */
inserir('workspaces', { id: 'w-geral', nome: 'Correia Advogados', triagemGeralInstaladaEm: '2026-10-23T12:00:00.000Z' });
inserir('conexoes', { id: 'conx-anuncio', workspaceId: 'w-geral', tipo: 'oficial', nome: 'Trafego pago', responsavelPadrao: { tipo: 'membro', id: 'mbr-1', nome: 'Atendente' } });
inserir('agentes', { id: 'ag-eduarda', workspaceId: 'w-geral', nome: EDUARDA.nome, ativo: false, area: 'previdenciario', prompt: EDUARDA.prompt, conhecimentoIds: [] });
inserir('agentes', { id: 'ag-avaliacao', workspaceId: 'w-geral', nome: 'Avaliação · Escritório geral', ativo: false, objetivo: 'avaliar' });
inserir('contatos', { id: 'c-lead', workspaceId: 'w-geral', conexaoId: 'conx-anuncio', telefone: '5500000000001', nome: 'Lead Pendente', estado: 'pendente', responsavel: { tipo: 'membro', id: 'mbr-1', nome: 'Atendente' }, ultimaEntradaEm: new Date().toISOString(), etiquetas: [] });

const doGeral = () => listar('agentes', { workspaceId: 'w-geral' });
const retrato = (reativados) => {
  const equipe = EQUIPE_TRABALHISTA_NO_GERAL.agentes.map((modelo) => doGeral().find((a) => a.nome === modelo.nome));
  const lead = achar('contatos', 'c-lead');
  return {
    reativados,
    equipeInstalada: equipe.every(Boolean),
    equipeToda: equipe.length,
    equipeLigada: equipe.filter((a) => a?.ativo).length,
    equipeSemArea: equipe.every((a) => a && !a.area),
    comoPassa: comoEduardaPassaOTrabalhista('w-geral'),
    promptDoPacote: achar('agentes', 'ag-eduarda').prompt === EDUARDA.prompt,
    entrada: escolherAgente({ workspaceId: 'w-geral' })?.agente?.nome || null,
    lead: { estado: lead.estado, com: lead.responsavel?.nome },
  };
};

garantirTriagemNoEscritorioGeral();
const desligado = retrato(reatribuirPendentes().reativados);

/* "Ativar todos" (rotas/automacoes.js) e a varredura seguinte. */
for (const agente of doGeral()) atualizar('agentes', agente.id, { ativo: true });
garantirTriagemNoEscritorioGeral();
const ligado = retrato(reatribuirPendentes().reativados);

/* So a Triagem Trabalhista desligada, e a varredura seguinte. */
atualizar('agentes', doGeral().find((a) => a.nome === EQUIPE_TRABALHISTA_NO_GERAL.agentes[0].nome).id, { ativo: false });
garantirTriagemNoEscritorioGeral();
const semTriagem = retrato(0);

console.log(JSON.stringify({ desligado, ligado, semTriagem }));
await encerrarBanco();
process.exit(0);
`,
  );

  try {
    const r = await rodar(desligado, [], pastaDesligada);
    if (!s.ok('o escritorio geral desligado roda sem erro', r.codigo === 0, r.texto.slice(-500))) return s;
    const { desligado: d, ligado: l, semTriagem: t } = JSON.parse(r.texto.trim().split('\n').pop());

    s.ok('com a IA do escritorio desligada, a equipe trabalhista entra desligada e sem area', d.equipeInstalada && d.equipeLigada === 0 && d.equipeSemArea, JSON.stringify(d));
    s.ok(
      'e ninguem vira a entrada: o lead pendente nao vai para a Triagem Trabalhista',
      d.entrada === null && d.reativados === 0 && d.lead.estado === 'pendente',
      JSON.stringify(d),
    );
    s.ok('a Eduarda desligada fica como esta, passando o trabalhista para uma pessoa', d.comoPassa === 'pessoa' && d.promptDoPacote, JSON.stringify(d));
    s.ok('no "Ativar todos" a equipe volta junto', l.equipeLigada === l.equipeToda, JSON.stringify(l));
    s.ok('e na varredura seguinte a Eduarda passa o trabalhista para a Triagem Trabalhista', l.comoPassa === 'agente', JSON.stringify(l));
    s.ok(
      'a Eduarda e a entrada e fica com o lead pendente',
      l.entrada === 'Eduarda (Triagem)' && l.reativados === 1 && l.lead.com === 'Eduarda (Triagem)',
      JSON.stringify(l),
    );
    s.ok(
      'com a Triagem Trabalhista desligada, a Eduarda volta a passar o trabalhista para uma pessoa, com o prompt do pacote',
      t.comoPassa === 'pessoa' && t.promptDoPacote,
      JSON.stringify(t),
    );
  } finally {
    fs.rmSync(pastaDesligada, { recursive: true, force: true });
  }
  return s;
}
