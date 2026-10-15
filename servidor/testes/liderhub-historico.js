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
 * formatacao); contato NOVO sem "user" na LiderHub nasce com o responsavel
 * padrao da conexao daqui (pronto para a IA, sem nenhuma mensagem mandada);
 * contato NOVO que a LiderHub mostra com uma PESSOA cuidando ("user")
 * nasce Pendente, sem responsavel (nunca inventa quem seria essa pessoa
 * aqui); contato que JA EXISTIA aqui nunca tem responsavel, estado ou
 * status tocados, so ganha as mensagens que faltavam; toda mensagem leva o
 * prefixo "liderhub:" no idExterno; e rodar a importacao duas vezes nao
 * duplica nada (nem mensagem, nem contagem no relatorio).
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
        { id: 'lh-contato-C', contactNumber: '5581966660000', contactName: 'Carla Com Pessoa', user: 'lh-user-1', ticketStatus: 'open' },
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
      'lh-contato-C': [
        { id: 'm-c1', content: 'Estou aguardando retorno', outbound: false, createdAt: '2025-03-01T08:00:00.000Z', sentAt: '2025-03-01T08:00:00.000Z' },
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
while (Date.now() - comeco < 2000) {
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
    s.ok('acha a conexao certa e poe os 3 contatos na fila', resultado1.iniciado?.contatosTotal === 3, JSON.stringify(resultado1.iniciado));
    s.ok(
      'termina concluido, com 3 contatos e 4 mensagens novas',
      resultado1.historico?.situacao === 'concluido' && resultado1.historico?.contatosProcessados === 3 && resultado1.historico?.mensagensImportadas === 4,
      JSON.stringify(resultado1.historico),
    );

    let base = await lerBase();
    const ana = base.contatos.find((c) => c.telefone === '5581977770000');
    const beto = base.contatos.find((c) => c.telefone === '5581988880000');
    const carla = base.contatos.find((c) => c.telefone === '5581966660000');

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

    s.ok('a Carla (contato novo, com "user" na LiderHub) foi criada', Boolean(carla), JSON.stringify(carla));
    s.ok(
      'a Carla NAO entra pronta para a IA: fica Pendente, sem responsavel inventado',
      carla?.responsavel === null && carla?.estado === 'pendente' && !carla?.aceitoPor,
      JSON.stringify({ responsavel: carla?.responsavel, estado: carla?.estado, aceitoPor: carla?.aceitoPor }),
    );
    s.ok('a Carla ganha a mensagem dela mesmo assim', base.mensagens['5581966660000']?.length === 1 && base.mensagens['5581966660000'][0].idExterno === 'liderhub:m-c1', JSON.stringify(base.mensagens['5581966660000']));

    const etiquetaHistorico = base.etiquetas.find((e) => e.nome === 'Histórico LiderHub');
    s.ok(
      'a etiqueta "Histórico LiderHub" existe e foi aplicada nos tres',
      Boolean(etiquetaHistorico) && ana.etiquetas.includes(etiquetaHistorico.id) && beto.etiquetas.includes(etiquetaHistorico.id) && carla.etiquetas.includes(etiquetaHistorico.id),
      JSON.stringify({ etiquetaHistorico, anaEtiquetas: ana?.etiquetas, betoEtiquetas: beto?.etiquetas, carlaEtiquetas: carla?.etiquetas }),
    );

    s.ok('a LiderHub falsa so recebeu requisicoes com a chave certa (nenhum 401 nos pedidos de teste)', pedidos.length > 0, pedidos.join(', '));
    s.ok(
      'o pedido de contatos leva modifiedAfter, para so trazer quem teve conversa nos ultimos 6 meses',
      pedidos.some((p) => p.startsWith('/v1/contacts') && p.includes('modifiedAfter=')),
      pedidos.join(', '),
    );

    const segunda = await importar();
    s.ok('rodar de novo termina sem erro', segunda.codigo === 0, segunda.texto.slice(-600));
    const resultado2 = JSON.parse(segunda.texto.trim().split('\n').pop());
    s.ok('rodar de novo nao importa nenhuma mensagem nova (idempotente)', resultado2.historico?.situacao === 'concluido' && resultado2.historico?.mensagensImportadas === 0, JSON.stringify(resultado2.historico));

    const depois = await lerBase();
    s.ok(
      'rodar de novo nao duplica mensagem nenhuma',
      depois.mensagens['5581977770000']?.length === 2 && depois.mensagens['5581988880000']?.length === 1 && depois.mensagens['5581966660000']?.length === 1,
      JSON.stringify({ ana: depois.mensagens['5581977770000']?.length, beto: depois.mensagens['5581988880000']?.length, carla: depois.mensagens['5581966660000']?.length }),
    );
    const carlaDepois = depois.contatos.find((c) => c.telefone === '5581966660000');
    s.ok('rodar de novo nao muda o modo da Carla (ja existia, nunca e tocada de novo)', carlaDepois?.estado === 'pendente' && carlaDepois?.responsavel === null, JSON.stringify(carlaDepois));
  } finally {
    servidor.close();
    fs.rmSync(pasta, { recursive: true, force: true });
  }
  return s;
}

/**
 * Pedido do escritorio em 15/10/2026: "a partir do momento que eu colocar a
 * chave API, eu quero que voce sincronize" — salvar a chave da LiderHub
 * (PATCH /api/integracoes) ja dispara a importacao do historico sozinha, sem
 * precisar clicar em Detectar/Importar na tela.
 *
 * Achado ao testar na tela: a primeira versao comparava a chave nova com
 * `atual.liderhub.chave` DEPOIS de already ter chamado atualizar() — como
 * atualizar() grava por cima do MESMO objeto (Object.assign em cima do que
 * achar() devolve), a chave "antiga" ja tinha virado a nova antes da
 * comparacao, e o gatilho nunca disparava. Este teste chama a rota de
 * verdade (sem subir servidor HTTP: resolve o handler no mesmo roteador que
 * o servidor usa) para travar contra essa classe de erro.
 */
export async function testarGatilhoAutomaticoDeHistorico({ raiz }) {
  const s = suite('Salvar a chave da LiderHub ja dispara a sincronizacao (PATCH /api/integracoes)');
  const urlDoBanco = pathToFileURL(path.join(raiz, 'servidor/nucleo/banco.js')).href;
  const urlDasRotas = pathToFileURL(path.join(raiz, 'servidor/rotas/integracoes.js')).href;
  const urlDoRoteador = pathToFileURL(path.join(raiz, 'servidor/nucleo/http.js')).href;
  const pasta = fs.mkdtempSync(path.join(os.tmpdir(), 'liderhub-gatilho-'));
  const porta = 8800 + Math.floor(Math.random() * 500);
  const CHAVE = 'chave-do-gatilho';

  const { servidor } = await subirLiderhubHistoricoFalsa({
    porta,
    chave: CHAVE,
    conexoes: [{ id: 'lh-conn-x', number: '5581955550000', connectionStatus: 'connected', integration: 'WHATSAPP-NON-OFFICIAL' }],
    contatosPorConexao: { 'lh-conn-x': [{ id: 'lh-contato-x', contactNumber: '5581944440000', contactName: 'Diana Gatilho' }] },
    mensagensPorContato: { 'lh-contato-x': [{ id: 'm-x1', content: 'Oi', outbound: false, createdAt: '2025-04-01T10:00:00.000Z', sentAt: '2025-04-01T10:00:00.000Z' }] },
  });

  const env = { ...process.env, CORREIA_DADOS: pasta, CORREIA_LIDERHUB_URL: `http://127.0.0.1:${porta}/v1`, CORREIA_LIDERHUB_INTERVALO: '20' };
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
inserir('agentes', { id: 'ag1', workspaceId: 'w1', nome: 'Triagem', objetivo: 'recepcionar', ativo: true, prompt: 'x' });
inserir('conexoes', {
  id: 'cnx1', workspaceId: 'w1', tipo: 'qrcode', numero: '5581955550000', estado: 'conectado',
  responsavelPadrao: { tipo: 'agente', id: 'ag1', nome: 'Triagem' },
});
await encerrarBanco();
`,
  );

  const chamarPatch = async (corpo) => {
    const script = path.join(pasta, `patch-${Date.now()}-${Math.random()}.mjs`);
    fs.writeFileSync(
      script,
      `import { iniciarBanco, achar, encerrarBanco } from ${JSON.stringify(urlDoBanco)};
import { criarRoteador } from ${JSON.stringify(urlDoRoteador)};
import { registrarIntegracoes } from ${JSON.stringify(urlDasRotas)};
iniciarBanco();
/* Marca de antes: o gatilho e fire-and-forget, entao so dar para ver o
   resultado NOVO esperando ate o 'atualizadoEm' mudar (sem isso, uma
   situacao ja 'concluido' de uma chamada anterior passaria no teste sem o
   gatilho desta chamada ter rodado nada). */
const antes = achar('integracoes', { workspaceId: 'w1' })?.liderhub?.historico?.atualizadoEm || null;
const roteador = criarRoteador();
registrarIntegracoes(roteador);
const achado = roteador.resolver('PATCH', '/api/integracoes');
const resposta = await achado.manipulador({ ctx: { papel: 'owner', workspaceId: 'w1' }, corpo: ${JSON.stringify(corpo)} });
const comeco = Date.now();
let registro = achar('integracoes', { workspaceId: 'w1' });
while (Date.now() - comeco < 2000) {
  registro = achar('integracoes', { workspaceId: 'w1' });
  const h = registro?.liderhub?.historico;
  if (h && h.atualizadoEm !== antes && h.situacao !== 'importando') break;
  await new Promise((r) => setTimeout(r, 30));
}
console.log(JSON.stringify({ resposta, mudou: registro?.liderhub?.historico?.atualizadoEm !== antes, historico: registro?.liderhub?.historico || null }));
await encerrarBanco();
process.exit(0);
`,
    );
    return rodar(script);
  };

  try {
    const m = await rodar(montagem);
    if (!s.ok('a base descartavel foi montada', m.codigo === 0, m.texto.slice(-400))) return s;

    const r1 = await chamarPatch({ liderhub: { chave: CHAVE } });
    s.ok('o primeiro PATCH (chave nova) roda sem erro', r1.codigo === 0, r1.texto.slice(-600));
    const j1 = JSON.parse(r1.texto.trim().split('\n').pop());
    s.ok(
      'salvar a chave pela primeira vez ja dispara e conclui a sincronizacao sozinha',
      j1.historico?.situacao === 'concluido' && j1.historico?.contatosProcessados === 1 && j1.historico?.mensagensImportadas === 1,
      JSON.stringify(j1.historico),
    );

    const r2 = await chamarPatch({ liderhub: { chave: CHAVE } });
    s.ok('o segundo PATCH (mesma chave) roda sem erro', r2.codigo === 0, r2.texto.slice(-600));
    const j2 = JSON.parse(r2.texto.trim().split('\n').pop());
    s.ok(
      'resalvar a MESMA chave nao reinicia a sincronizacao (nao zera o progresso)',
      j2.historico?.situacao === 'concluido' && j2.historico?.contatosProcessados === 1 && j2.historico?.mensagensImportadas === 1,
      JSON.stringify(j2.historico),
    );

    const r3 = await chamarPatch({ liderhub: { chave: `${CHAVE}-trocada` } });
    s.ok('o terceiro PATCH (chave DIFERENTE) roda sem erro', r3.codigo === 0, r3.texto.slice(-600));
    const j3 = JSON.parse(r3.texto.trim().split('\n').pop());
    s.ok(
      'trocar a chave de verdade dispara a sincronizacao de novo (com a chave nova, que a LiderHub falsa recusa)',
      j3.historico?.situacao === 'erro',
      JSON.stringify(j3.historico),
    );
  } finally {
    servidor.close();
    fs.rmSync(pasta, { recursive: true, force: true });
  }
  return s;
}
