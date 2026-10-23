import { spawn } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

import { suite } from './apoio.js';

/**
 * `reatribuirPendentes` (servidor/automacao/reatribuir-pendentes.js):
 * pedido do escritorio em 19/10/2026 - "toda mensagem nova vai para os
 * agentes; se for uma conversa antiga, o agente deve ler e, conforme o
 * beneficio, vai atender". Toda conversa pendente (de qualquer origem,
 * inclusive uma que o agente tirou da IA de proposito com desativar_ia)
 * volta a ter o agente padrao da conexao, e o agente responde de verdade
 * (pedido do escritorio em 23/10/2026 - "quero que os agentes atendam de
 * verdade": so trocar o responsavel por dentro nao bastava, o cliente
 * continuava sem ver resposta nenhuma).
 *
 * O que nao pode falhar: pendente sem responsavel, e pendente com uma
 * PESSOA como responsavel, ambos ganham o agente padrao, viram estado:'ia'
 * e recebem uma resposta; pendente cuja conexao nao tem agente padrao, ou
 * cujo agente padrao esta desligado, NAO e tocado (nem ganha resposta);
 * grupo nao e tocado; contato que ja nao esta pendente (ia, ativo,
 * arquivado) nao e tocado; rodar de novo nao mexe em quem ja foi
 * reatribuido (nem manda uma segunda resposta).
 */
export async function testarReatribuirPendentes({ raiz }) {
  const s = suite('Conversa pendente volta para o agente padrao (qualquer origem)');
  const urlDoBanco = pathToFileURL(path.join(raiz, 'servidor/nucleo/banco.js')).href;
  const urlDoModulo = pathToFileURL(path.join(raiz, 'servidor/automacao/reatribuir-pendentes.js')).href;
  const pasta = fs.mkdtempSync(path.join(os.tmpdir(), 'reatribuir-pendentes-'));

  const rodar = (arquivo) =>
    new Promise((resolve) => {
      const p = spawn(process.execPath, [arquivo], { env: { ...process.env, CORREIA_DADOS: pasta }, stdio: ['ignore', 'pipe', 'pipe'] });
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
inserir('workspaces', { id: 'w1', nome: 'Teste' });

const padrao = { tipo: 'agente', id: 'ag-triagem', nome: 'Triagem' };
inserir('agentes', { id: 'ag-triagem', workspaceId: 'w1', nome: 'Triagem', ativo: true, delaySegundos: 1 });
inserir('agentes', { id: 'ag-desligado', workspaceId: 'w1', nome: 'Desligado', ativo: false });

inserir('conexoes', { id: 'conx-com-padrao', workspaceId: 'w1', tipo: 'qrcode', responsavelPadrao: padrao });
inserir('conexoes', { id: 'conx-sem-padrao', workspaceId: 'w1', tipo: 'qrcode', responsavelPadrao: null });
inserir('conexoes', { id: 'conx-padrao-desligado', workspaceId: 'w1', tipo: 'qrcode', responsavelPadrao: { tipo: 'agente', id: 'ag-desligado', nome: 'Desligado' } });

/* Pendente "normal": nunca teve responsavel. */
inserir('contatos', { id: 'c-sem-responsavel', workspaceId: 'w1', conexaoId: 'conx-com-padrao', telefone: '5581977770000', nome: 'Ana', estado: 'pendente', responsavel: null, etiquetas: [] });
/* Pendente que um agente tirou da IA de proposito (desativar_ia / transferencia para pessoa). */
inserir('contatos', { id: 'c-com-pessoa', workspaceId: 'w1', conexaoId: 'conx-com-padrao', telefone: '5581988880000', nome: 'Beto', estado: 'pendente', responsavel: { tipo: 'membro', id: 'mbr1', nome: 'Fulana' }, etiquetas: [] });
/* Conexao sem agente padrao: nao tocar. */
inserir('contatos', { id: 'c-sem-padrao-na-conexao', workspaceId: 'w1', conexaoId: 'conx-sem-padrao', telefone: '5581999990000', nome: 'Carla', estado: 'pendente', responsavel: null, etiquetas: [] });
/* Agente padrao da conexao esta desligado: nao tocar. */
inserir('contatos', { id: 'c-agente-desligado', workspaceId: 'w1', conexaoId: 'conx-padrao-desligado', telefone: '5581911110000', nome: 'Dani', estado: 'pendente', responsavel: null, etiquetas: [] });
/* Grupo: nao tocar. */
inserir('contatos', { id: 'c-grupo', workspaceId: 'w1', conexaoId: 'conx-com-padrao', telefone: '5581922220000', nome: 'Grupo da Familia', estado: 'pendente', responsavel: null, grupo: true, etiquetas: [] });
/* Ja esta com IA: nao e nem considerado. */
inserir('contatos', { id: 'c-ja-ia', workspaceId: 'w1', conexaoId: 'conx-com-padrao', telefone: '5581933330000', nome: 'Eva', estado: 'ia', responsavel: padrao, etiquetas: [] });
await encerrarBanco();
`,
  );

  const rodarMigracao = path.join(pasta, 'migrar.mjs');
  fs.writeFileSync(
    rodarMigracao,
    `import { iniciarBanco, listar, mensagensDe, encerrarBanco } from ${JSON.stringify(urlDoBanco)};
import { reatribuirPendentes } from ${JSON.stringify(urlDoModulo)};
iniciarBanco();
const resultado = reatribuirPendentes();
/* O agente de teste tem delaySegundos:1, mas agendarResposta impoe um piso
   de 1s mesmo para quem pedir menos — por isso a espera generosa aqui, so
   para o timer ter chance de disparar dentro deste processo descartavel. */
await new Promise((resolver) => setTimeout(resolver, 1800));
const contatos = listar('contatos');
const mensagens = Object.fromEntries(contatos.map((c) => [c.id, mensagensDe(c.id).length]));
console.log(JSON.stringify({ resultado, contatos, mensagens }));
await encerrarBanco();
process.exit(0);
`,
  );

  try {
    const m = await rodar(montagem);
    if (!s.ok('a base descartavel foi montada', m.codigo === 0, m.texto.slice(-400))) return s;

    const r1 = await rodar(rodarMigracao);
    if (!s.ok('a primeira aplicacao roda sem erro', r1.codigo === 0, r1.texto.slice(-500))) return s;
    const b = JSON.parse(r1.texto.trim().split('\n').pop());
    const porId = (id) => b.contatos.find((c) => c.id === id);

    s.ok('reativa os dois pendentes elegiveis (Ana e Beto)', b.resultado.reativados === 2, JSON.stringify(b.resultado));

    const ana = porId('c-sem-responsavel');
    s.ok('a Ana (sem responsavel) ganha o agente padrao', ana?.responsavel?.id === 'ag-triagem', JSON.stringify(ana?.responsavel));
    s.ok('a Ana vira estado ia', ana?.estado === 'ia', ana?.estado);

    const beto = porId('c-com-pessoa');
    s.ok(
      'o Beto (tinha PESSOA como responsavel) tambem ganha o agente padrao - escopo e qualquer origem',
      beto?.responsavel?.id === 'ag-triagem' && beto?.estado === 'ia',
      JSON.stringify({ responsavel: beto?.responsavel, estado: beto?.estado }),
    );

    const carla = porId('c-sem-padrao-na-conexao');
    s.ok('a Carla (conexao sem agente padrao) continua pendente, sem responsavel', carla?.estado === 'pendente' && !carla?.responsavel, JSON.stringify(carla));

    const dani = porId('c-agente-desligado');
    s.ok('a Dani (agente padrao desligado) continua pendente', dani?.estado === 'pendente' && !dani?.responsavel, JSON.stringify(dani));

    const grupo = porId('c-grupo');
    s.ok('o grupo continua pendente, sem responsavel', grupo?.estado === 'pendente' && !grupo?.responsavel, JSON.stringify(grupo));

    const eva = porId('c-ja-ia');
    s.ok('quem ja estava com IA nao muda', eva?.estado === 'ia' && eva?.responsavel?.id === 'ag-triagem', JSON.stringify(eva));

    s.ok(
      'a Ana e o Beto (reatribuidos) recebem uma resposta de verdade do agente',
      b.mensagens['c-sem-responsavel'] > 0 && b.mensagens['c-com-pessoa'] > 0,
      JSON.stringify(b.mensagens),
    );
    s.ok(
      'quem nao foi reatribuido (Carla, Dani, o grupo, a Eva) nao recebe mensagem nenhuma',
      ['c-sem-padrao-na-conexao', 'c-agente-desligado', 'c-grupo', 'c-ja-ia'].every((id) => b.mensagens[id] === 0),
      JSON.stringify(b.mensagens),
    );

    const r2 = await rodar(rodarMigracao);
    const c = JSON.parse(r2.texto.trim().split('\n').pop());
    s.ok('rodar de novo nao reativa mais ninguem (ja viraram ia)', c.resultado.reativados === 0, JSON.stringify(c.resultado));
    s.ok(
      'rodar de novo nao manda uma segunda resposta para quem ja foi atendido',
      c.mensagens['c-sem-responsavel'] === b.mensagens['c-sem-responsavel'] && c.mensagens['c-com-pessoa'] === b.mensagens['c-com-pessoa'],
      JSON.stringify({ antes: b.mensagens, depois: c.mensagens }),
    );
  } finally {
    fs.rmSync(pasta, { recursive: true, force: true });
  }
  return s;
}
