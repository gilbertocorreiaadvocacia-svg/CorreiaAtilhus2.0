import { spawn } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

import { PACOTES } from '../ia/pacotes.js';
import { suite } from './apoio.js';

/**
 * Relatorio de melhorias do escritorio em 14/10/2026: encaminhamento seguro
 * para atendimento humano, as tres unidades reais (Carpina, Condado e
 * Timbaúba) sem prometer atendimento so onde ha unidade, atendimento a
 * distancia sem prometer que tudo e virtual, e nome do cliente nunca trava a
 * conversa.
 *
 * Parte 1 (abaixo): o bloco novo esta em todo agente de atendimento dos tres
 * pacotes, e as frases antigas que prometiam "100% online" ou mandavam
 * insistir no nome do cliente nao voltam por engano numa edicao futura.
 *
 * Parte 2 (testarAplicarRegrasInstitucionais): a migracao de boot
 * (nucleo/migrar-regras-institucionais.js) acrescenta o bloco em quem ja
 * estava instalado antes desta mudanca, corrige o texto antigo so onde ele
 * existir, nunca toca em quem nao e de atendimento, e rodar duas vezes nao
 * muda nada de novo.
 */
export async function testarRegrasInstitucionais() {
  const s = suite('Regras institucionais nos prompts (relatorio de 14/10/2026)');

  const naoAvaliacaoNemPosVenda = (areaId) => PACOTES[areaId].agentes.filter((a) => a.objetivo !== 'avaliar' && a.objetivo !== 'atender');

  for (const areaId of ['previdenciario', 'trabalhista', 'civel']) {
    for (const agente of naoAvaliacaoNemPosVenda(areaId)) {
      s.ok(`${agente.nome}: tem o bloco de regras institucionais`, /REGRAS INSTITUCIONAIS \(ATUALIZA[CÇ][AÃ]O 2026-10-14\)/.test(agente.prompt), agente.prompt.slice(-200));
      s.ok(`${agente.nome}: cita as tres unidades reais`, /Carpina.*Condado.*Timba[uú]ba/.test(agente.prompt));
      s.ok(`${agente.nome}: nao promete que tudo e virtual nem presencial zero`, !/100% online|tudo (e |)digital/i.test(agente.prompt), agente.prompt.match(/.{0,60}(100% online|tudo (e |)digital).{0,60}/i)?.[0]);
    }
  }

  const triagemTrabalhista = PACOTES.trabalhista.agentes.find((a) => a.nome === 'Triagem Trabalhista');
  s.ok(
    'a Triagem Trabalhista nao insiste mais ate o lead dizer o nome',
    !/Insista at[eé] o lead dizer o nome/i.test(triagemTrabalhista?.prompt || ''),
    (triagemTrabalhista?.prompt || '').slice(0, 50),
  );
  s.ok(
    'a Triagem Trabalhista segue o atendimento mesmo sem o nome',
    /N[AÃ]O insista al[eé]m disso: siga o atendimento normalmente mesmo sem o nome/i.test(triagemTrabalhista?.prompt || ''),
  );

  return s;
}

/** Testa a migracao de boot contra uma base descartavel, de fora do processo. */
export async function testarAplicarRegrasInstitucionais({ raiz }) {
  const s = suite('Aplicar regras institucionais (migracao de boot)');
  const urlDoBanco = pathToFileURL(path.join(raiz, 'servidor/nucleo/banco.js')).href;
  const urlDaMigracao = pathToFileURL(path.join(raiz, 'servidor/nucleo/migrar-regras-institucionais.js')).href;
  const pasta = fs.mkdtempSync(path.join(os.tmpdir(), 'regras-institucionais-'));

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
inserir('workspaces', { id: 'w1', nome: 'Previdenciário', area: 'previdenciario' });
inserir('agentes', {
  id: 'a-beatriz', workspaceId: 'w1', nome: 'Beatriz (Triagem)', ativo: true,
  prompt: 'Prompt antigo da Beatriz, sem o bloco novo.',
});
inserir('agentes', {
  id: 'a-05', workspaceId: 'w1', nome: '#05 Proposta e Objeções [aux acidente]', ativo: true,
  prompt: 'DISTÂNCIA ou advogado online: Claro! Hoje tudo no INSS é digital — até o juiz fala com você pelo celular. Nosso escritório é 100% online para agilizar e atender clientes de todo o Brasil. Faz sentido resolver rápido com quem é especialista, em vez de esperar alguém da sua cidade que não tem a mesma experiência nesse tipo de causa? Envie o template @oab.',
});
inserir('agentes', {
  id: 'a-posvenda', workspaceId: 'w1', nome: 'Pós-venda · Previdenciário', ativo: true,
  prompt: 'Prompt do pos-venda, nao e de atendimento inicial.',
});
await encerrarBanco();
`,
  );
  const lerBase = async () => {
    const dump = path.join(pasta, 'ler.mjs');
    fs.writeFileSync(
      dump,
      `import { iniciarBanco, listar } from ${JSON.stringify(urlDoBanco)};
iniciarBanco();
console.log(JSON.stringify({ agentes: listar('agentes') }));
process.exit(0);
`,
    );
    const r = await rodar(dump);
    return JSON.parse(r.texto.trim().split('\n').pop());
  };
  const aplicar = async () => {
    const script = path.join(pasta, 'aplicar.mjs');
    fs.writeFileSync(
      script,
      `import { iniciarBanco, encerrarBanco } from ${JSON.stringify(urlDoBanco)};
import { aplicarRegrasInstitucionais } from ${JSON.stringify(urlDaMigracao)};
iniciarBanco();
console.log(JSON.stringify(aplicarRegrasInstitucionais()));
await encerrarBanco();
process.exit(0);
`,
    );
    return rodar(script);
  };

  try {
    const m = await rodar(montagem);
    if (!s.ok('a base descartavel foi montada', m.codigo === 0, m.texto.slice(-300))) return s;
    const por = (b, id) => b.agentes.find((a) => a.id === id);

    const primeira = await aplicar();
    s.ok('a migracao roda sem erro', primeira.codigo === 0, primeira.texto.slice(-500));
    const resultado = JSON.parse(primeira.texto.trim().split('\n').pop());
    s.ok('acrescentou o bloco em 1 agente e corrigiu o texto de outro', resultado.acrescentados === 2 && resultado.corrigidos === 1, JSON.stringify(resultado));

    let b = await lerBase();
    s.ok('a Beatriz ganha o bloco novo no final do prompt antigo', por(b, 'a-beatriz').prompt.startsWith('Prompt antigo da Beatriz') && /REGRAS INSTITUCIONAIS/.test(por(b, 'a-beatriz').prompt), por(b, 'a-beatriz').prompt.slice(-80));
    s.ok('a frase "100% online" e corrigida no #05', !/100% online/.test(por(b, 'a-05').prompt) && /REGRAS INSTITUCIONAIS/.test(por(b, 'a-05').prompt), por(b, 'a-05').prompt.slice(0, 120));
    s.ok('o pos-venda nao ganha o bloco (nao e atendimento inicial)', !/REGRAS INSTITUCIONAIS/.test(por(b, 'a-posvenda').prompt), por(b, 'a-posvenda').prompt);

    const segunda = await aplicar();
    const resultado2 = JSON.parse(segunda.texto.trim().split('\n').pop());
    s.ok('rodar de novo nao acrescenta nem corrige mais nada', resultado2.acrescentados === 0 && resultado2.corrigidos === 0, JSON.stringify(resultado2));
    const c = await lerBase();
    s.ok('rodar de novo nao muda o conteudo', JSON.stringify(c) === JSON.stringify(b), 'diferenca apos rodar de novo');
  } finally {
    fs.rmSync(pasta, { recursive: true, force: true });
  }
  return s;
}
