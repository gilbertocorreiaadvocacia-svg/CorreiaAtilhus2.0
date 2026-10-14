import { spawn } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

import { suite } from './apoio.js';

/**
 * `aplicarStatus` (servidor/automacao/followup.js): reaplicar o MESMO status
 * nao pode reiniciar a sequencia de follow-up.
 *
 * Achado em 14/10/2026, pedido do escritorio: o follow-up estava mandando
 * mensagem com uma frequencia maior do que a sequencia configurada (1h, 1
 * dia, 3 dias) deveria permitir. A causa: a ferramenta de IA que reaplica
 * status ("alterar_status") pode confirmar o MESMO status mais de uma vez
 * na mesma negociacao — o roteiro de varios agentes manda reafirmar
 * "Qualificado" depois de responder uma objecao, por exemplo — e
 * `aplicarStatus` cancelava e recriava os tres passos do zero TODA vez que
 * era chamada, trocando de status ou nao. Cada reafirmacao reiniciava o
 * relogio, entao o "faz tempo que paramos" podia disparar de novo sempre que
 * a conversa ficasse quieta depois de uma reafirmacao, nao so na troca real
 * de etapa.
 */
export async function testarFollowup({ raiz }) {
  const s = suite('Follow-up nao reinicia sozinho');
  const urlDoBanco = pathToFileURL(path.join(raiz, 'servidor/nucleo/banco.js')).href;
  const urlDoFollowup = pathToFileURL(path.join(raiz, 'servidor/automacao/followup.js')).href;
  const pasta = fs.mkdtempSync(path.join(os.tmpdir(), 'followup-'));

  const rodar = (arquivo) =>
    new Promise((resolve) => {
      const p = spawn(process.execPath, [arquivo], { env: { ...process.env, CORREIA_DADOS: pasta }, stdio: ['ignore', 'pipe', 'pipe'] });
      let texto = '';
      p.stdout.on('data', (d) => (texto += d));
      p.stderr.on('data', (d) => (texto += d));
      p.on('close', (codigo) => resolve({ codigo, texto }));
    });

  const rodarTeste = path.join(pasta, 'rodar.mjs');
  fs.writeFileSync(
    rodarTeste,
    `import { iniciarBanco, inserir, listar, encerrarBanco } from ${JSON.stringify(urlDoBanco)};
import { aplicarStatus, agendamentosPendentes } from ${JSON.stringify(urlDoFollowup)};

iniciarBanco();
inserir('workspaces', { id: 'w1', nome: 'Escritorio de Teste' });

const tpl = inserir('templates', { id: 'tpl1', workspaceId: 'w1', nome: 'Follow-up 1', conteudo: 'Oi {{nome}}' });

const qualificado = inserir('status', {
  id: 'sts_qualificado',
  workspaceId: 'w1',
  nome: 'Qualificado',
  tipo: 'qualificado',
  followups: [
    { id: 'fup1', templateId: tpl.id, minutos: 60, desistir: null },
    { id: 'fup2', templateId: tpl.id, minutos: 60 * 24, desistir: null },
  ],
});
const proposta = inserir('status', { id: 'sts_proposta', workspaceId: 'w1', nome: 'Proposta', tipo: 'proposta', followups: [] });

const contato = inserir('contatos', { id: 'c1', workspaceId: 'w1', nome: 'Lead de Teste', telefone: '5581900000001' });

// 1. Aplica Qualificado pela primeira vez: cria os dois passos.
await aplicarStatus(contato, qualificado, { tipo: 'agente', id: 'a1', nome: 'Agente' });
const primeiraVez = agendamentosPendentes(contato.id).filter((a) => a.tipo === 'followup');

// 2. Reaplica o MESMO status (o agente "reafirma" Qualificado de novo).
await aplicarStatus(contato, qualificado, { tipo: 'agente', id: 'a1', nome: 'Agente' });
const depoisDeReafirmar = agendamentosPendentes(contato.id).filter((a) => a.tipo === 'followup');

// 3. Troca de verdade para Proposta: agora sim cancela os de Qualificado.
await aplicarStatus(contato, proposta, { tipo: 'agente', id: 'a1', nome: 'Agente' });
const depoisDeTrocarDeVerdade = agendamentosPendentes(contato.id).filter((a) => a.tipo === 'followup');

console.log(JSON.stringify({
  idsPrimeiraVez: primeiraVez.map((a) => a.id).sort(),
  idsDepoisDeReafirmar: depoisDeReafirmar.map((a) => a.id).sort(),
  quantosDepoisDeTrocarDeVerdade: depoisDeTrocarDeVerdade.length,
}));
await encerrarBanco();
process.exit(0);
`,
  );

  try {
    const r = await rodar(rodarTeste);
    if (!s.ok('roda sem erro', r.codigo === 0, r.texto.slice(-400))) return s;
    const b = JSON.parse(r.texto.trim().split('\n').pop());

    s.ok('a primeira aplicacao cria os dois passos', b.idsPrimeiraVez.length === 2, JSON.stringify(b.idsPrimeiraVez));
    s.ok(
      'reafirmar o MESMO status nao recria os agendamentos (mesmos ids, mesma hora)',
      JSON.stringify(b.idsDepoisDeReafirmar) === JSON.stringify(b.idsPrimeiraVez),
      JSON.stringify(b),
    );
    s.ok(
      'uma troca de status de verdade continua cancelando os do status anterior',
      b.quantosDepoisDeTrocarDeVerdade === 0,
      String(b.quantosDepoisDeTrocarDeVerdade),
    );
  } finally {
    fs.rmSync(pasta, { recursive: true, force: true });
  }
  return s;
}
