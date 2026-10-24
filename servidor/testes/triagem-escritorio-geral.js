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
 */
export async function testarTriagemEscritorioGeral({ raiz }) {
  const s = suite('Escritorio geral sem area ganha a Triagem do Previdenciario para atender de verdade');
  const urlDoBanco = pathToFileURL(path.join(raiz, 'servidor/nucleo/banco.js')).href;
  const urlDoReatribuir = pathToFileURL(path.join(raiz, 'servidor/automacao/reatribuir-pendentes.js')).href;
  const urlDoAgentesPorEscritorio = pathToFileURL(path.join(raiz, 'servidor/nucleo/agentes-por-escritorio.js')).href;
  const url = (arquivo) => JSON.stringify(pathToFileURL(path.join(raiz, arquivo)).href);
  const pasta = fs.mkdtempSync(path.join(os.tmpdir(), 'triagem-geral-'));

  const rodar = (arquivo, args = []) =>
    new Promise((resolve) => {
      const p = spawn(process.execPath, [arquivo, ...args], { env: { ...process.env, CORREIA_DADOS: pasta }, stdio: ['ignore', 'pipe', 'pipe'] });
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
  return s;
}
