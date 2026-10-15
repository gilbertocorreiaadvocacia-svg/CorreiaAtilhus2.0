import { spawn } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

import { suite } from './apoio.js';

/**
 * Pedido do escritorio em 15/10/2026: "coloque uma protecao para que os
 * contatos nao estejam duplicados. Se tiver duplicado agora, pode apagar."
 *
 * A importacao da LiderHub criava duplicado por dois motivos (os dois
 * corrigidos na fonte, em integracoes/liderhub.js): a fase 1 podia escolher
 * uma conexao diferente da fase 2 dentro do mesmo workspace, e as duas
 * passavam o numero (que ja vem com o pais) pelo normalizador errado,
 * inventando numero para quem tivesse 11 digitos ou menos. deduplicarContatos
 * (whatsapp/duplicados.js) e o reparo: acha pares do mesmo telefone (contando
 * essa ambiguidade do 55) e funde num so, sem depender da conexao. Roda no
 * boot; idempotente.
 */
export async function testarDeduplicarContatos({ raiz }) {
  const s = suite('Contatos duplicados (mesmo telefone) sao fundidos num so');
  const urlDoBanco = pathToFileURL(path.join(raiz, 'servidor/nucleo/banco.js')).href;
  const urlDoModulo = pathToFileURL(path.join(raiz, 'servidor/whatsapp/duplicados.js')).href;
  const pasta = fs.mkdtempSync(path.join(os.tmpdir(), 'duplicados-'));

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
    `import { iniciarBanco, inserir, inserirMensagem, encerrarBanco } from ${JSON.stringify(urlDoBanco)};
iniciarBanco();
inserir('workspaces', { id: 'w1', nome: 'Teste' });
inserir('workspaces', { id: 'w2', nome: 'Outro escritorio' });

/* Duplicado classico: mesmo telefone, conexao diferente (fase 1 x fase 2),
   um so pesa mais (tem mensagem). O mais fraco (c-fraco) tem nome real,
   status e departamento; o mais forte (c-forte) nasceu so com o numero. */
inserir('status', { id: 'st1', workspaceId: 'w1', nome: 'Em andamento', tipo: 'em_analise' });
inserir('departamentos', { id: 'dp1', workspaceId: 'w1', nome: 'Comercial' });
inserir('etiquetas', { id: 'et1', workspaceId: 'w1', nome: 'Urgente', cor: 'var(--serie-1)' });
inserir('etiquetas', { id: 'et2', workspaceId: 'w1', nome: 'VIP', cor: 'var(--serie-2)' });

inserir('contatos', {
  id: 'c-fraco', workspaceId: 'w1', conexaoId: 'conx-simulador', telefone: '5581977770000',
  nome: 'Ana Nova', nomeOrigem: 'manual', statusId: 'st1', departamentoId: 'dp1',
  etiquetas: ['et2'], criadoEm: '2026-01-01T10:00:00.000Z',
  primeiraMensagemEm: '2026-01-01T10:00:00.000Z', ultimaMensagemEm: '2026-01-01T10:00:00.000Z', previa: 'oi antigo',
});
inserirMensagem('c-fraco', { workspaceId: 'w1', direcao: 'entrada', tipo: 'texto', conteudo: 'mensagem antiga', autor: { tipo: 'cliente', nome: 'Ana' }, situacao: 'recebida' });
inserir('contatos', {
  id: 'c-forte', workspaceId: 'w1', conexaoId: 'conx-qrcode', telefone: '5581977770000',
  nome: '5581977770000', nomeOrigem: null, statusId: null, departamentoId: null,
  etiquetas: ['et1'], criadoEm: '2026-02-01T10:00:00.000Z',
  primeiraMensagemEm: '2026-02-01T10:00:00.000Z', ultimaMensagemEm: '2026-03-01T10:00:00.000Z', previa: 'oi novo',
});
inserirMensagem('c-forte', { workspaceId: 'w1', direcao: 'entrada', tipo: 'texto', conteudo: 'oi', autor: { tipo: 'cliente', nome: 'Ana' }, situacao: 'recebida' });
inserirMensagem('c-forte', { workspaceId: 'w1', direcao: 'saida', tipo: 'texto', conteudo: 'ola', autor: { tipo: 'membro', nome: 'Equipe' }, situacao: 'enviada' });

/* Mesma ambiguidade do 55: um numero sem o pais, outro com. */
inserir('contatos', { id: 'c-sem-55', workspaceId: 'w1', conexaoId: 'conx-simulador', telefone: '81988880000', nome: 'Beto', criadoEm: '2026-01-05T10:00:00.000Z' });
inserir('contatos', { id: 'c-com-55', workspaceId: 'w1', conexaoId: 'conx-qrcode', telefone: '5581988880000', nome: '5581988880000', criadoEm: '2026-01-06T10:00:00.000Z' });
inserirMensagem('c-com-55', { workspaceId: 'w1', direcao: 'entrada', tipo: 'texto', conteudo: 'oi', autor: { tipo: 'cliente', nome: 'Beto' }, situacao: 'recebida' });

/* Contato sem par nenhum: nao pode ser tocado. */
inserir('contatos', { id: 'c-unico', workspaceId: 'w1', conexaoId: 'conx-qrcode', telefone: '5581999990000', nome: 'Carla', criadoEm: '2026-01-01T10:00:00.000Z' });

/* Mesmo numero, workspace DIFERENTE: nao e duplicado entre escritorios. */
inserir('contatos', { id: 'c-w2-a', workspaceId: 'w2', conexaoId: 'conx-w2', telefone: '5581977770000', nome: 'Ana em outro escritorio', criadoEm: '2026-01-01T10:00:00.000Z' });

await encerrarBanco();
`,
  );

  const aplicar = async () => {
    const script = path.join(pasta, `aplicar-${Date.now()}.mjs`);
    fs.writeFileSync(
      script,
      `import { iniciarBanco, listar, mensagensDe, encerrarBanco } from ${JSON.stringify(urlDoBanco)};
import { deduplicarContatos } from ${JSON.stringify(urlDoModulo)};
iniciarBanco();
const resultado = deduplicarContatos();
const contatos = listar('contatos');
const mensagensPorContato = Object.fromEntries(contatos.map((c) => [c.id, mensagensDe(c.id).length]));
console.log(JSON.stringify({ resultado, contatos, mensagensPorContato }));
await encerrarBanco();
process.exit(0);
`,
    );
    return rodar(script);
  };

  try {
    const m = await rodar(montagem);
    if (!s.ok('a base descartavel foi montada', m.codigo === 0, m.texto.slice(-400))) return s;

    const r1 = await aplicar();
    s.ok('a primeira aplicacao roda sem erro', r1.codigo === 0, r1.texto.slice(-500));
    const j1 = JSON.parse(r1.texto.trim().split('\n').pop());
    const porId = (lista, id) => lista.find((c) => c.id === id);

    s.ok('funde os dois pares de w1 (4 contatos -> 2 removidos)', j1.resultado.fundidos === 2, JSON.stringify(j1.resultado));
    s.ok('move a mensagem do contato removido para o sobrevivente', j1.resultado.mensagensMovidas === 1, JSON.stringify(j1.resultado));

    s.ok('o contato mais fraco (menos mensagem) foi removido', !porId(j1.contatos, 'c-fraco'), 'c-fraco ainda existe');
    const forte = porId(j1.contatos, 'c-forte');
    s.ok('o contato com mensagem fica (sobrevive)', Boolean(forte), 'c-forte nao sobrou');
    s.ok('o nome provisorio do sobrevivente vira o nome real do fundido', forte?.nome === 'Ana Nova', forte?.nome);
    s.ok('status do fundido entra, ja que o sobrevivente nao tinha', forte?.statusId === 'st1', forte?.statusId);
    s.ok('departamento do fundido entra, ja que o sobrevivente nao tinha', forte?.departamentoId === 'dp1', forte?.departamentoId);
    s.ok('etiquetas somam as dos dois', (forte?.etiquetas || []).sort().join(',') === 'et1,et2', JSON.stringify(forte?.etiquetas));
    s.ok('primeiraMensagemEm fica a mais antiga dos dois', forte?.primeiraMensagemEm === '2026-01-01T10:00:00.000Z', forte?.primeiraMensagemEm);
    s.ok('ultimaMensagemEm/previa ficam as mais recentes (do proprio sobrevivente)', forte?.ultimaMensagemEm === '2026-03-01T10:00:00.000Z' && forte?.previa === 'oi novo', JSON.stringify({ u: forte?.ultimaMensagemEm, p: forte?.previa }));
    s.ok('a mensagem do fraco foi movida para o forte (2 + 1 = 3)', j1.mensagensPorContato['c-forte'] === 3, JSON.stringify(j1.mensagensPorContato));

    s.ok('o par com/sem 55 tambem foi fundido (o sem-55 foi removido)', !porId(j1.contatos, 'c-sem-55'), 'c-sem-55 ainda existe');
    const com55 = porId(j1.contatos, 'c-com-55');
    s.ok('o sobrevivente do par 55 ganhou o nome real (Beto)', com55?.nome === 'Beto', com55?.nome);

    s.ok('o contato sem par nenhum nao foi tocado', porId(j1.contatos, 'c-unico')?.nome === 'Carla', JSON.stringify(porId(j1.contatos, 'c-unico')));
    s.ok('o mesmo telefone em outro workspace nao foi fundido', porId(j1.contatos, 'c-w2-a')?.nome === 'Ana em outro escritorio', JSON.stringify(porId(j1.contatos, 'c-w2-a')));
    s.ok('total de contatos depois (6 - 2 fundidos)', j1.contatos.length === 4, j1.contatos.length);

    const r2 = await aplicar();
    s.ok('a segunda aplicacao roda sem erro', r2.codigo === 0, r2.texto.slice(-500));
    const j2 = JSON.parse(r2.texto.trim().split('\n').pop());
    s.ok('rodar de novo nao funde mais nada (idempotente)', j2.resultado.fundidos === 0, JSON.stringify(j2.resultado));
  } finally {
    fs.rmSync(pasta, { recursive: true, force: true });
  }
  return s;
}
