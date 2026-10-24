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
 */
export async function testarTriagemEscritorioGeral({ raiz }) {
  const s = suite('Escritorio geral sem area ganha a Triagem do Previdenciario para atender de verdade');
  const urlDoBanco = pathToFileURL(path.join(raiz, 'servidor/nucleo/banco.js')).href;
  const urlDoReatribuir = pathToFileURL(path.join(raiz, 'servidor/automacao/reatribuir-pendentes.js')).href;
  const urlDoAgentesPorEscritorio = pathToFileURL(path.join(raiz, 'servidor/nucleo/agentes-por-escritorio.js')).href;
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
iniciarBanco();

/* Escritorio geral de verdade: sem area, com o numero de anuncio igual ao
   caso real, e o agente de avaliacao que ele ja nasce tendo. */
inserir('workspaces', { id: 'w-geral', nome: 'Correia Advogados' });
inserir('agentes', { id: 'ag-avaliacao', workspaceId: 'w-geral', nome: 'Avaliação · Escritório geral', ativo: true, objetivo: 'avaliar' });
inserir('conexoes', { id: 'conx-facebook', workspaceId: 'w-geral', tipo: 'oficial', nome: 'Trafego pago - Facebook', responsavelPadrao: null });
inserir('conexoes', { id: 'conx-sim-geral', workspaceId: 'w-geral', tipo: 'simulador', nome: 'Chat de teste', responsavelPadrao: null });

/* Escritorio SO com simulador: nao deve ganhar agente nenhum. */
inserir('workspaces', { id: 'w-vazio', nome: 'Filial Teste' });
inserir('conexoes', { id: 'conx-sim-vazio', workspaceId: 'w-vazio', tipo: 'simulador', nome: 'Chat de teste', responsavelPadrao: null });

/* O "Ricardo": pendente, perguntando sobre auxilio-acidente. */
inserir('contatos', { id: 'c-ricardo', workspaceId: 'w-geral', conexaoId: 'conx-facebook', telefone: '5548920056366', nome: 'Ricardo', estado: 'pendente', responsavel: null, etiquetas: [] });
await encerrarBanco();
`,
  );

  const rodarVarredura = path.join(pasta, 'varrer.mjs');
  fs.writeFileSync(
    rodarVarredura,
    `import { iniciarBanco, achar, listar, mensagensDe, encerrarBanco } from ${JSON.stringify(urlDoBanco)};
import { garantirTriagemNoEscritorioGeral } from ${JSON.stringify(urlDoAgentesPorEscritorio)};
import { reatribuirPendentes } from ${JSON.stringify(urlDoReatribuir)};
iniciarBanco();
const ligados = garantirTriagemNoEscritorioGeral();
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

    const r2 = await rodar(rodarVarredura);
    const c = JSON.parse(r2.texto.trim().split('\n').pop());
    s.ok('rodar de novo nao reinstala o pacote por cima (mesma contagem de agentes)', c.qtdAgentesDoGeral === b.qtdAgentesDoGeral, JSON.stringify({ antes: b.qtdAgentesDoGeral, depois: c.qtdAgentesDoGeral }));
    s.ok('rodar de novo nao religa quem ja foi ligado', c.ligados === 0, JSON.stringify(c.ligados));
  } finally {
    fs.rmSync(pasta, { recursive: true, force: true });
  }
  return s;
}
