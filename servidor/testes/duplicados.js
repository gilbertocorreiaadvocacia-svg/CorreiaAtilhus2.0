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

/* 26/10/2026: o nono digito. O celular sem o 9 (como o WhatsApp enderecava
   conta antiga) e com o 9 sao a mesma pessoa. O antigo, do historico do
   celular, tem mais mensagem; o novo e a conversa que anda agora, com a IA. */
inserir('contatos', { id: 'c-sem-9', workspaceId: 'w1', conexaoId: 'conx-qrcode', telefone: '558197776666', nome: 'Eva', nomeOrigem: 'agenda', importado: true, estado: 'ativo', aceitoPor: 'mbr-x', responsavel: { tipo: 'membro', id: 'mbr-x', nome: 'Pessoa' }, criadoEm: '2026-01-01T10:00:00.000Z', ultimaMensagemEm: '2026-01-10T10:00:00.000Z' });
inserirMensagem('c-sem-9', { workspaceId: 'w1', direcao: 'entrada', tipo: 'texto', conteudo: 'antiga 1', autor: { tipo: 'cliente' }, situacao: 'recebida' });
inserirMensagem('c-sem-9', { workspaceId: 'w1', direcao: 'entrada', tipo: 'texto', conteudo: 'antiga 2', autor: { tipo: 'cliente' }, situacao: 'recebida' });
inserir('contatos', { id: 'c-com-9', workspaceId: 'w1', conexaoId: 'conx-qrcode', telefone: '5581997776666', nome: '5581997776666', estado: 'ia', aceitoPor: null, responsavel: { tipo: 'agente', id: 'ag-1', nome: 'Eduarda' }, criadoEm: '2026-03-10T10:00:00.000Z', ultimaMensagemEm: '2026-03-10T10:00:00.000Z' });
inserirMensagem('c-com-9', { workspaceId: 'w1', direcao: 'entrada', tipo: 'texto', conteudo: 'oi de novo', autor: { tipo: 'cliente' }, situacao: 'recebida' });

/* Fixo (comeca com 3) e o celular 9 3333-...: numeros diferentes, ficam. */
inserir('contatos', { id: 'c-fixo', workspaceId: 'w1', conexaoId: 'conx-qrcode', telefone: '558133334444', nome: 'Escritorio Fixo', criadoEm: '2026-01-01T10:00:00.000Z' });
inserir('contatos', { id: 'c-celular-parecido', workspaceId: 'w1', conexaoId: 'conx-qrcode', telefone: '5581933334444', nome: 'Celular Parecido', criadoEm: '2026-01-01T10:00:00.000Z' });

/* O @lid: a conversa do historico so com o codigo, e a do numero que ganhou o
   mesmo codigo quando a pessoa escreveu. */
inserir('contatos', { id: 'c-so-lid', workspaceId: 'w1', conexaoId: 'conx-qrcode', telefone: '', lid: '43260000000001@lid', nome: 'Fabio', nomeOrigem: 'agenda', importado: true, criadoEm: '2026-01-01T10:00:00.000Z', ultimaMensagemEm: '2026-01-02T10:00:00.000Z' });
inserirMensagem('c-so-lid', { workspaceId: 'w1', direcao: 'entrada', tipo: 'texto', conteudo: 'historico 1', autor: { tipo: 'cliente' }, situacao: 'recebida' });
inserirMensagem('c-so-lid', { workspaceId: 'w1', direcao: 'entrada', tipo: 'texto', conteudo: 'historico 2', autor: { tipo: 'cliente' }, situacao: 'recebida' });
inserir('contatos', { id: 'c-numero-do-lid', workspaceId: 'w1', conexaoId: 'conx-qrcode', telefone: '5581966665555', lid: '43260000000001@lid', nome: 'Fabio', criadoEm: '2026-02-01T10:00:00.000Z', ultimaMensagemEm: '2026-02-01T10:00:00.000Z' });
inserirMensagem('c-numero-do-lid', { workspaceId: 'w1', direcao: 'entrada', tipo: 'texto', conteudo: 'oi', autor: { tipo: 'cliente' }, situacao: 'recebida' });

/* So o codigo, sem par: fica. Mesmo nome de outra pessoa nao junta. */
inserir('contatos', { id: 'c-outro-lid', workspaceId: 'w1', conexaoId: 'conx-qrcode', telefone: '', lid: '43260000000002@lid', nome: 'Carla', nomeOrigem: 'agenda', criadoEm: '2026-01-01T10:00:00.000Z' });

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
import { deduplicarContatos, retratoDasConversas } from ${JSON.stringify(urlDoModulo)};
iniciarBanco();
const resultado = deduplicarContatos();
const contatos = listar('contatos');
const mensagensPorContato = Object.fromEntries(contatos.map((c) => [c.id, mensagensDe(c.id).length]));
const retrato = retratoDasConversas('w1');
console.log(JSON.stringify({ resultado, contatos, mensagensPorContato, retrato }));
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

    s.ok('funde os quatro pares de w1', j1.resultado.fundidos === 4, JSON.stringify(j1.resultado));
    s.ok('move as mensagens dos removidos para os sobreviventes', j1.resultado.mensagensMovidas === 3, JSON.stringify(j1.resultado));

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
    s.ok('total de contatos depois (13 - 4 fundidos)', j1.contatos.length === 9, j1.contatos.length);

    const eva = porId(j1.contatos, 'c-sem-9');
    s.ok('o celular com e sem o nono digito vira uma conversa so', eva && !porId(j1.contatos, 'c-com-9') && j1.mensagensPorContato['c-sem-9'] === 3, JSON.stringify({ eva, msgs: j1.mensagensPorContato['c-sem-9'] }));
    s.ok(
      'e quem atende e o da conversa mais recente (a IA), nao o da importacao antiga',
      eva?.responsavel?.tipo === 'agente' && eva?.estado === 'ia' && !eva?.aceitoPor,
      JSON.stringify({ responsavel: eva?.responsavel, estado: eva?.estado, aceitoPor: eva?.aceitoPor }),
    );
    s.ok('o fixo e o celular parecido nao se juntam', Boolean(porId(j1.contatos, 'c-fixo') && porId(j1.contatos, 'c-celular-parecido')));
    const fabio = porId(j1.contatos, 'c-so-lid');
    s.ok(
      'a conversa so com o codigo @lid e a do numero com o mesmo codigo viram uma, com o telefone',
      fabio && !porId(j1.contatos, 'c-numero-do-lid') && fabio.telefone === '5581966665555' && j1.mensagensPorContato['c-so-lid'] === 3,
      JSON.stringify({ fabio, msgs: j1.mensagensPorContato['c-so-lid'] }),
    );
    s.ok('o @lid sem par e o mesmo nome de outra pessoa nao juntam ninguem', Boolean(porId(j1.contatos, 'c-outro-lid')) && Boolean(porId(j1.contatos, 'c-unico')));
    s.ok(
      'o retrato da aba Ativos conta sem nome de ninguem',
      j1.retrato.total === 8 && j1.retrato.soComCodigoDoWhatsapp === 1 && j1.retrato.mesmoNome === 2,
      JSON.stringify(j1.retrato),
    );

    const r2 = await aplicar();
    s.ok('a segunda aplicacao roda sem erro', r2.codigo === 0, r2.texto.slice(-500));
    const j2 = JSON.parse(r2.texto.trim().split('\n').pop());
    s.ok('rodar de novo nao funde mais nada (idempotente)', j2.resultado.fundidos === 0, JSON.stringify(j2.resultado));

    /* A origem: a mensagem que chega sem o 9 acha a conversa que ja existe. */
    const buscar = path.join(pasta, 'buscar.mjs');
    fs.writeFileSync(
      buscar,
      `import { iniciarBanco, encerrarBanco } from ${JSON.stringify(urlDoBanco)};
import { acharOuCriarContato } from ${JSON.stringify(pathToFileURL(path.join(raiz, 'servidor/whatsapp/recebimento.js')).href)};
iniciarBanco();
const achado = acharOuCriarContato({ workspaceId: 'w1', conexao: { id: 'conx-qrcode', workspaceId: 'w1', tipo: 'qrcode' }, telefone: '558199990000', doWhatsApp: true });
console.log(JSON.stringify({ id: achado.contato.id, novo: achado.novo }));
await encerrarBanco();
process.exit(0);
`,
    );
    const r3 = await rodar(buscar);
    const j3 = JSON.parse(r3.texto.trim().split('\n').pop() || '{}');
    s.ok('a mensagem que chega sem o nono digito cai na conversa que ja existe', j3.id === 'c-unico' && j3.novo === false, r3.texto.slice(-400));
  } finally {
    fs.rmSync(pasta, { recursive: true, force: true });
  }
  return s;
}
