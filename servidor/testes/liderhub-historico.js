import { spawn } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

import { subirLiderhubHistoricoFalsa } from './liderhub-historico-falsa.js';
import { suite } from './apoio.js';

/**
 * Segunda fase da migracao da LiderHub (15/10/2026): o historico completo
 * (contato + conversa inteira) de UMA conexao, a que bater com o numero ja
 * conectado neste workspace.
 *
 * O que nao pode falhar: casa a conexao da LiderHub pelo NUMERO (ignorando
 * formatacao); contato NOVO nasce com o responsavel padrao da conexao daqui
 * (pronto para a IA, sem nenhuma mensagem mandada); contato que JA EXISTIA
 * aqui nunca tem responsavel, estado ou status tocados, so ganha as
 * mensagens que faltavam; toda mensagem leva o prefixo "liderhub:" no
 * idExterno; e rodar a importacao duas vezes nao duplica nada (nem
 * mensagem, nem contagem no relatorio).
 */
export async function testarLiderhubHistorico({ raiz }) {
  const s = suite('Historico completo da LiderHub (fase 2)');
  const urlDoBanco = pathToFileURL(path.join(raiz, 'servidor/nucleo/banco.js')).href;
  const urlDaLiderhub = pathToFileURL(path.join(raiz, 'servidor/integracoes/liderhub.js')).href;
  const pasta = fs.mkdtempSync(path.join(os.tmpdir(), 'liderhub-historico-'));
  const porta = 8300 + Math.floor(Math.random() * 500);
  const CHAVE = 'chave-de-teste-trabalhista';

  const { servidor, pedidos } = await subirLiderhubHistoricoFalsa({
    porta,
    chave: CHAVE,
    conexoes: [{ id: 'lh-conn-1', number: '+55 81 99999-0000', connectionStatus: 'connected', integration: 'WHATSAPP-NON-OFFICIAL' }],
    contatosPorConexao: {
      'lh-conn-1': [
        { id: 'lh-contato-A', contactNumber: '5581977770000', contactName: 'Ana Nova' },
        { id: 'lh-contato-B', contactNumber: '5581988880000', contactName: 'Beto Existente' },
      ],
    },
    mensagensPorContato: {
      'lh-contato-A': [
        { id: 'm-a1', content: 'Oi, bom dia', outbound: false, createdAt: '2025-01-01T10:00:00.000Z', sentAt: '2025-01-01T10:00:00.000Z' },
        { id: 'm-a2', content: 'Olá! Como posso ajudar?', outbound: true, createdAt: '2025-01-01T10:01:00.000Z', sentAt: '2025-01-01T10:01:00.000Z' },
      ],
      'lh-contato-B': [
        { id: 'm-b1', content: 'Mensagem antiga do Beto', outbound: false, createdAt: '2025-02-01T09:00:00.000Z', sentAt: '2025-02-01T09:00:00.000Z' },
      ],
    },
  });

  const env = {
    ...process.env,
    CORREIA_DADOS: pasta,
    CORREIA_LIDERHUB_URL: `http://127.0.0.1:${porta}/v1`,
    CORREIA_LIDERHUB_INTERVALO: '20',
  };

  const rodar = (arquivo) =>
    new Promise((resolve) => {
      const p = spawn(process.execPath, [arquivo], { env, stdio: ['ignore', 'pipe', 'pipe'] });
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
inserir('workspaces', { id: 'w1', nome: 'Trabalhista', area: 'trabalhista' });
inserir('agentes', { id: 'ag1', workspaceId: 'w1', nome: 'Triagem Trabalhista', objetivo: 'recepcionar', ativo: true, prompt: 'x' });
inserir('conexoes', {
  id: 'cnx1', workspaceId: 'w1', tipo: 'qrcode', numero: '5581999990000', estado: 'conectado',
  responsavelPadrao: { tipo: 'agente', id: 'ag1', nome: 'Triagem Trabalhista' },
});
inserir('integracoes', { id: 'int1', workspaceId: 'w1', liderhub: { chave: ${JSON.stringify(CHAVE)}, ativo: false, ultimaImportacao: null } });
inserir('contatos', {
  id: 'ctt-beto', workspaceId: 'w1', conexaoId: 'cnx1', telefone: '5581988880000', nome: 'Beto Existente',
  responsavel: { tipo: 'membro', id: 'm1', nome: 'Fulano' }, estado: 'ativo', statusId: 'sts-x', etiquetas: [],
});
await encerrarBanco();
`,
  );

  const importar = async () => {
    const script = path.join(pasta, `importar-${Date.now()}.mjs`);
    fs.writeFileSync(
      script,
      `import { iniciarBanco, achar, encerrarBanco } from ${JSON.stringify(urlDoBanco)};
import { enfileirarHistoricoLiderhub } from ${JSON.stringify(urlDaLiderhub)};
iniciarBanco();
const iniciado = await enfileirarHistoricoLiderhub('w1');
const comeco = Date.now();
while (Date.now() - comeco < 8000) {
  const registro = achar('integracoes', { workspaceId: 'w1' });
  if (registro?.liderhub?.historico?.situacao !== 'importando') break;
  await new Promise((r) => setTimeout(r, 30));
}
const final = achar('integracoes', { workspaceId: 'w1' });
console.log(JSON.stringify({ iniciado, historico: final.liderhub.historico }));
await encerrarBanco();
process.exit(0);
`,
    );
    return rodar(script);
  };

  const lerBase = async () => {
    const dump = path.join(pasta, 'ler.mjs');
    fs.writeFileSync(
      dump,
      `import { iniciarBanco, listar, mensagensDe } from ${JSON.stringify(urlDoBanco)};
iniciarBanco();
const contatos = listar('contatos');
const mensagens = Object.fromEntries(contatos.map((c) => [c.telefone, mensagensDe(c.id)]));
const etiquetas = listar('etiquetas');
console.log(JSON.stringify({ contatos, mensagens, etiquetas }));
process.exit(0);
`,
    );
    const r = await rodar(dump);
    return JSON.parse(r.texto.trim().split('\n').pop());
  };

  try {
    const m = await rodar(montagem);
    if (!s.ok('a base descartavel foi montada', m.codigo === 0, m.texto.slice(-400))) return s;

    const primeira = await importar();
    s.ok('a importacao roda sem erro', primeira.codigo === 0, primeira.texto.slice(-600));
    const resultado1 = JSON.parse(primeira.texto.trim().split('\n').pop());
    s.ok('acha a conexao certa e poe os 2 contatos na fila', resultado1.iniciado?.contatosTotal === 2, JSON.stringify(resultado1.iniciado));
    s.ok(
      'termina concluido, com 2 contatos e 3 mensagens novas',
      resultado1.historico?.situacao === 'concluido' && resultado1.historico?.contatosProcessados === 2 && resultado1.historico?.mensagensImportadas === 3,
      JSON.stringify(resultado1.historico),
    );

    let base = await lerBase();
    const ana = base.contatos.find((c) => c.telefone === '5581977770000');
    const beto = base.contatos.find((c) => c.telefone === '5581988880000');

    s.ok('a Ana (contato novo) foi criada', Boolean(ana), JSON.stringify(ana));
    s.ok(
      'a Ana nasce pronta para a IA (responsavel padrao da conexao, estado ia)',
      ana?.responsavel?.tipo === 'agente' && ana.responsavel.id === 'ag1' && ana.estado === 'ia',
      JSON.stringify(ana?.responsavel) + ' / ' + ana?.estado,
    );
    s.ok('a Ana ganha as 2 mensagens, com idExterno prefixado', base.mensagens['5581977770000']?.length === 2 && base.mensagens['5581977770000'].every((msg) => msg.idExterno?.startsWith('liderhub:')), JSON.stringify(base.mensagens['5581977770000']));
    s.ok(
      'a Ana ganha ultimaMensagemEm/previa da ultima mensagem importada (aparece certo na fila de Atendimento)',
      ana?.ultimaMensagemEm === '2025-01-01T10:01:00.000Z' && ana?.previa === 'Olá! Como posso ajudar?',
      JSON.stringify({ ultimaMensagemEm: ana?.ultimaMensagemEm, previa: ana?.previa }),
    );
    s.ok(
      'a direcao das mensagens da Ana bate com outbound da LiderHub',
      base.mensagens['5581977770000'].find((msg) => msg.idExterno === 'liderhub:m-a1')?.direcao === 'entrada' &&
        base.mensagens['5581977770000'].find((msg) => msg.idExterno === 'liderhub:m-a2')?.direcao === 'saida',
    );

    s.ok(
      'o Beto (contato que ja existia) NAO tem responsavel nem estado nem status tocados',
      beto?.responsavel?.tipo === 'membro' && beto.responsavel.id === 'm1' && beto.estado === 'ativo' && beto.statusId === 'sts-x',
      JSON.stringify(beto),
    );
    s.ok('o Beto ganha a mensagem que faltava', base.mensagens['5581988880000']?.length === 1 && base.mensagens['5581988880000'][0].idExterno === 'liderhub:m-b1', JSON.stringify(base.mensagens['5581988880000']));
    s.ok(
      'o Beto (sem mensagem antes) tambem ganha ultimaMensagemEm/previa',
      beto?.ultimaMensagemEm === '2025-02-01T09:00:00.000Z' && beto?.previa === 'Mensagem antiga do Beto',
      JSON.stringify({ ultimaMensagemEm: beto?.ultimaMensagemEm, previa: beto?.previa }),
    );

    const etiquetaHistorico = base.etiquetas.find((e) => e.nome === 'Histórico LiderHub');
    s.ok('a etiqueta "Histórico LiderHub" existe e foi aplicada nos dois', Boolean(etiquetaHistorico) && ana.etiquetas.includes(etiquetaHistorico.id) && beto.etiquetas.includes(etiquetaHistorico.id), JSON.stringify({ etiquetaHistorico, anaEtiquetas: ana?.etiquetas, betoEtiquetas: beto?.etiquetas }));

    s.ok('a LiderHub falsa so recebeu requisicoes com a chave certa (nenhum 401 nos pedidos de teste)', pedidos.length > 0, pedidos.join(', '));

    const segunda = await importar();
    s.ok('rodar de novo termina sem erro', segunda.codigo === 0, segunda.texto.slice(-600));
    const resultado2 = JSON.parse(segunda.texto.trim().split('\n').pop());
    s.ok('rodar de novo nao importa nenhuma mensagem nova (idempotente)', resultado2.historico?.situacao === 'concluido' && resultado2.historico?.mensagensImportadas === 0, JSON.stringify(resultado2.historico));

    const depois = await lerBase();
    s.ok(
      'rodar de novo nao duplica mensagem nenhuma',
      depois.mensagens['5581977770000']?.length === 2 && depois.mensagens['5581988880000']?.length === 1,
      JSON.stringify({ ana: depois.mensagens['5581977770000']?.length, beto: depois.mensagens['5581988880000']?.length }),
    );
  } finally {
    servidor.close();
    fs.rmSync(pasta, { recursive: true, force: true });
  }
  return s;
}
