import { spawn } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

import { suite } from './apoio.js';

/**
 * `npm run reorganizar-agentes`: destrava a Beatriz, limpa os nomes do
 * Trabalhista, corrige a pasta e tira o "Agente 26" repetido (07/10/2026).
 *
 * O que nao pode falhar: simular nao grava; aplicar renomeia so quem tem o
 * nome antigo; toda referencia "@NomeAntigo" nos prompts do MESMO escritorio
 * vira "@NomeNovo" (inclusive autorreferencia); a pasta errada do Trabalhista
 * e corrigida; o "Agente 26" desligado some de cada escritorio onde aparece,
 * mas um agente ativo com o mesmo nome generico NAO e tocado; e rodar duas
 * vezes nao muda nada de novo.
 */
export async function testarReorganizarAgentes({ raiz }) {
  const s = suite('Reorganizar agentes (ferramenta)');
  const urlDoBanco = pathToFileURL(path.join(raiz, 'servidor/nucleo/banco.js')).href;
  const pasta = fs.mkdtempSync(path.join(os.tmpdir(), 'reorganizar-agentes-'));

  const rodar = (arquivo, args = []) =>
    new Promise((resolve) => {
      const p = spawn(process.execPath, [arquivo, ...args], {
        env: { ...process.env, CORREIA_DADOS: pasta },
        stdio: ['ignore', 'pipe', 'pipe'],
      });
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
inserir('workspaces', { id: 'w1', nome: 'Previdenciário' });
inserir('agentes', {
  id: 'a-01', workspaceId: 'w1', nome: '#01 Triagem [aux acidente]', pasta: 'Auxílio-Acidente FER MAR26', ativo: true,
  prompt: 'Fora do escopo, passe com @responsavel para @#01 Triagem [aux acidente].',
});
inserir('agentes', {
  id: 'a-02', workspaceId: 'w1', nome: '#02 Segurado [aux acidente]', pasta: 'Auxílio-Acidente FER MAR26', ativo: true,
  prompt: 'Recebido do @responsavel para @#02 Triagem [aux acidente], encaminha para @#01 Triagem [aux acidente].',
});
inserir('workspaces', { id: 'w2', nome: 'Trabalhista' });
inserir('agentes', {
  id: 'a-ag01', workspaceId: 'w2', nome: 'AG01 [trab] Triagem', pasta: 'Agentes Trabalhista + Auxilio acidente', ativo: true,
  prompt: 'Resposta negativa: passe com @responsavel para @AG01 [trab] Triagem, de volta para quem recebeu.',
});
inserir('agentes', {
  id: 'a-ag02', workspaceId: 'w2', nome: 'AG02 [trab] Acidente e Doenças', pasta: 'Agentes Trabalhista + Auxilio acidente', ativo: true,
  prompt: 'Passe com @responsavel para @AG01 [trab] Triagem se nao for disso.',
});
inserir('workspaces', { id: 'w3', nome: 'Escritório geral' });
inserir('agentes', { id: 'a-26-geral', workspaceId: 'w3', nome: 'Agente 26', pasta: 'Sem pasta', ativo: false, prompt: 'Rascunho.' });
inserir('workspaces', { id: 'w4', nome: 'Filial Teste' });
inserir('agentes', { id: 'a-26-filial', workspaceId: 'w4', nome: 'Agente 26', pasta: 'Sem pasta', ativo: false, prompt: 'Rascunho.' });
inserir('agentes', { id: 'a-26-ativo', workspaceId: 'w4', nome: 'Agente 26', pasta: 'Outra pasta', ativo: true, prompt: 'Este esta em uso, mesmo com nome parecido.' });
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

  try {
    const m = await rodar(montagem);
    if (!s.ok('a base descartavel foi montada', m.codigo === 0, m.texto.slice(-300))) return s;
    const ferramenta = path.join(raiz, 'servidor/ferramentas/reorganizar-agentes.js');
    const por = (b, id) => b.agentes.find((a) => a.id === id);

    const simulado = await rodar(ferramenta);
    let b = await lerBase();
    s.ok('simular termina sem erro e diz o que faria', simulado.codigo === 0 && /Beatriz/.test(simulado.texto), simulado.texto.slice(-500));
    s.ok('simular nao grava nada', por(b, 'a-01').nome === '#01 Triagem [aux acidente]' && por(b, 'a-26-geral') !== undefined, JSON.stringify(por(b, 'a-01')));

    const aplicado = await rodar(ferramenta, ['--aplicar']);
    b = await lerBase();
    s.ok('aplicar termina sem erro', aplicado.codigo === 0, aplicado.texto.slice(-500));

    s.ok('a Beatriz e destravada', por(b, 'a-01').nome === 'Beatriz (Triagem)', por(b, 'a-01').nome);
    s.ok(
      'a autorreferencia da Beatriz acompanha o renome',
      por(b, 'a-01').prompt === 'Fora do escopo, passe com @responsavel para @Beatriz (Triagem).',
      por(b, 'a-01').prompt,
    );
    s.ok(
      'outro agente do MESMO escritorio tambem acompanha (mesmo sem ser renomeado)',
      por(b, 'a-02').prompt === 'Recebido do @responsavel para @#02 Triagem [aux acidente], encaminha para @Beatriz (Triagem).',
      por(b, 'a-02').prompt,
    );

    s.ok('o Trabalhista perde o prefixo AG0N', por(b, 'a-ag01').nome === 'Triagem Trabalhista' && por(b, 'a-ag02').nome === 'Acidente e Doenças', JSON.stringify([por(b, 'a-ag01').nome, por(b, 'a-ag02').nome]));
    s.ok(
      'as referencias cruzadas do Trabalhista acompanham',
      por(b, 'a-ag01').prompt.includes('@Triagem Trabalhista') && por(b, 'a-ag02').prompt.includes('@Triagem Trabalhista'),
      JSON.stringify([por(b, 'a-ag01').prompt, por(b, 'a-ag02').prompt]),
    );
    s.ok('a pasta do Trabalhista e corrigida', por(b, 'a-ag01').pasta === 'Trabalhista' && por(b, 'a-ag02').pasta === 'Trabalhista', JSON.stringify([por(b, 'a-ag01').pasta, por(b, 'a-ag02').pasta]));

    s.ok('o Previdenciario nao muda de workspace nem de pasta', por(b, 'a-01').pasta === 'Auxílio-Acidente FER MAR26', por(b, 'a-01').pasta);

    s.ok('o Agente 26 desligado some do escritorio geral', por(b, 'a-26-geral') === undefined);
    s.ok('o Agente 26 desligado some da Filial Teste', por(b, 'a-26-filial') === undefined);
    s.ok('um agente ATIVO com nome parecido nao e tocado', por(b, 'a-26-ativo')?.nome === 'Agente 26' && por(b, 'a-26-ativo')?.ativo === true, JSON.stringify(por(b, 'a-26-ativo')));

    const denovo = await rodar(ferramenta, ['--aplicar']);
    const c = await lerBase();
    s.ok('rodar de novo nao muda mais nada', JSON.stringify(c) === JSON.stringify(b), denovo.texto.slice(-400));
  } finally {
    fs.rmSync(pasta, { recursive: true, force: true });
  }
  return s;
}
