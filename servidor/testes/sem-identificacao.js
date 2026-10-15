import { spawn } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

import { suite } from './apoio.js';

/**
 * Pedido do escritorio em 15/10/2026: "quando nao tiver o nome, coloca o
 * numero". Contato que ja tem telefone mas ficou gravado com "Conversa sem
 * identificacao" no nome (de antes da correcao em recebimento.js e
 * importar-historico.js) passa a mostrar o telefone — so quem nao tem
 * telefone nenhum (conversa so por @lid) continua com o texto antigo, que e
 * o unico caso em que nao ha numero para por no lugar. Roda no boot
 * (servidor/index.js); idempotente.
 */
export async function testarMigrarSemIdentificacao({ raiz }) {
  const s = suite('"Conversa sem identificacao" vira o numero, quando ha numero');
  const urlDoBanco = pathToFileURL(path.join(raiz, 'servidor/nucleo/banco.js')).href;
  const urlDaMigracao = pathToFileURL(path.join(raiz, 'servidor/whatsapp/migrar-nomes.js')).href;
  const pasta = fs.mkdtempSync(path.join(os.tmpdir(), 'sem-identificacao-'));

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
inserir('contatos', { id: 'c-com-numero', workspaceId: 'w1', telefone: '5581977770000', nome: 'Conversa sem identificacao', nomeOrigem: null });
inserir('contatos', { id: 'c-ja-identificado', workspaceId: 'w1', telefone: '5581988880000', nome: 'Maria Souza', nomeOrigem: 'perfil' });
inserir('contatos', { id: 'c-so-lid', workspaceId: 'w1', telefone: '', lid: '195550000@lid', nome: 'Conversa sem identificacao', nomeOrigem: null });
await encerrarBanco();
`,
  );

  const aplicar = async () => {
    const script = path.join(pasta, `aplicar-${Date.now()}.mjs`);
    fs.writeFileSync(
      script,
      `import { iniciarBanco, listar, encerrarBanco } from ${JSON.stringify(urlDoBanco)};
import { migrarSemIdentificacaoParaNumero } from ${JSON.stringify(urlDaMigracao)};
iniciarBanco();
const trocados = migrarSemIdentificacaoParaNumero();
console.log(JSON.stringify({ trocados, contatos: listar('contatos') }));
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
    s.ok('troca so o contato com telefone e texto antigo (1 de 3)', j1.trocados === 1, JSON.stringify(j1.trocados));

    const porId = (lista, id) => lista.find((c) => c.id === id);
    s.ok(
      'o contato com telefone passa a mostrar o numero no lugar do texto',
      porId(j1.contatos, 'c-com-numero')?.nome === '5581977770000',
      porId(j1.contatos, 'c-com-numero')?.nome,
    );
    s.ok(
      'o contato ja identificado nao e tocado',
      porId(j1.contatos, 'c-ja-identificado')?.nome === 'Maria Souza' && porId(j1.contatos, 'c-ja-identificado')?.nomeOrigem === 'perfil',
      JSON.stringify(porId(j1.contatos, 'c-ja-identificado')),
    );
    s.ok(
      'o contato so-lid (sem telefone nenhum) continua sem identificacao, nao ha numero para por',
      porId(j1.contatos, 'c-so-lid')?.nome === 'Conversa sem identificacao',
      porId(j1.contatos, 'c-so-lid')?.nome,
    );

    const r2 = await aplicar();
    s.ok('a segunda aplicacao roda sem erro', r2.codigo === 0, r2.texto.slice(-500));
    const j2 = JSON.parse(r2.texto.trim().split('\n').pop());
    s.ok('rodar de novo nao troca mais nada (idempotente)', j2.trocados === 0, JSON.stringify(j2.trocados));
  } finally {
    fs.rmSync(pasta, { recursive: true, force: true });
  }
  return s;
}
