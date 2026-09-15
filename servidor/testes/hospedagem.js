import { spawn } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { cliente, esperar, esperarNoAr, suite } from './apoio.js';

/**
 * O sistema hospedado (CORREIA_HOSPEDADO=1, hospedagem/docker-compose.yml).
 *
 * O que nao pode falhar quando a tela de login estiver na internet:
 *   - a senha padrao, publicada no README, nao entra, e sem a senha do
 *     administrador no ambiente o sistema nem sobe;
 *   - o cookie da sessao so anda por HTTPS;
 *   - a conexao por QR Code aponta para a Evolution do compose, e nao para a
 *     do notebook.
 *
 * Sobe processos proprios, em portas proprias, com bases descartaveis.
 */
export async function testarHospedagem({ raiz, portaLivre }) {
  const s = suite('Hospedagem (VPS com Docker)');
  const pastas = [];
  const vivos = [];
  const novaPasta = () => {
    const pasta = fs.mkdtempSync(path.join(os.tmpdir(), 'correia-hospedado-'));
    pastas.push(pasta);
    return pasta;
  };

  function subir(porta, extra = {}) {
    const dados = novaPasta();
    return spawn(process.execPath, [path.join(raiz, 'servidor/index.js')], {
      env: {
        ...process.env,
        PORTA: String(porta),
        CORREIA_DADOS: dados,
        CORREIA_HOSPEDADO: '1',
        CORREIA_ADMIN_EMAIL: '',
        CORREIA_ADMIN_SENHA: '',
        CORREIA_EVOLUTION_URL: '',
        CORREIA_EVOLUTION_CHAVE: '',
        CORREIA_EVOLUTION_WEBHOOK: '',
        CORREIA_EVOLUTION_ENV: path.join(dados, 'sem-evolution.env'),
        ANTHROPIC_API_KEY: '',
        OPENAI_API_KEY: '',
        ...extra,
      },
      stdio: ['ignore', 'pipe', 'pipe'],
    });
  }

  /* Sobe uma instancia que deve recusar, e devolve como saiu (null se ficou no ar). */
  async function tentarSubir(extra) {
    const processo = subir(await portaLivre(), extra);
    let saida = '';
    processo.stdout.on('data', (d) => (saida += d));
    processo.stderr.on('data', (d) => (saida += d));
    const fim = new Promise((resolve) => processo.on('close', (codigo) => resolve({ codigo, saida })));
    const resultado = await Promise.race([fim, esperar(20000).then(() => null)]);
    if (!resultado) processo.kill();
    return resultado || { codigo: null, saida };
  }

  try {
    const semSenha = await tentarSubir({});
    s.ok('sem a senha do administrador no ambiente, nao sobe', semSenha.codigo === 1, `saiu com ${semSenha.codigo}`);
    s.ok('e o aviso diz o que falta', /CORREIA_ADMIN_SENHA/.test(semSenha.saida), semSenha.saida.slice(-300));

    const curta = await tentarSubir({ CORREIA_ADMIN_SENHA: 'curta123' });
    s.ok('senha do administrador curta nao sobe', curta.codigo === 1, `saiu com ${curta.codigo}`);

    const porta = await portaLivre();
    const base = `http://127.0.0.1:${porta}`;
    const senha = 'senha-de-teste-bem-comprida';
    vivos.push(
      subir(porta, {
        CORREIA_ADMIN_SENHA: senha,
        CORREIA_EVOLUTION_URL: 'http://evolution:8080',
        CORREIA_EVOLUTION_CHAVE: 'chave-da-evolution-do-compose',
        CORREIA_EVOLUTION_WEBHOOK: 'http://sistema:4477',
      }),
    );
    if (!s.ok('com a senha no ambiente, sobe', await esperarNoAr(`${base}/api/saude`))) return s;

    s.ok('a senha padrao nao entra', (await cliente(base).entrar()).status !== 200);

    const entrada = await fetch(`${base}/api/sessao/entrar`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email: 'admin@correia.adv.br', senha }),
    });
    const cookies = entrada.headers.getSetCookie?.() || [entrada.headers.get('set-cookie')].filter(Boolean);
    s.ok('a senha do ambiente entra', entrada.status === 200, String(entrada.status));
    s.ok('o cookie da sessao so anda por HTTPS (Secure)', cookies.some((c) => /;\s*Secure/i.test(c)), cookies.join(' | '));

    const api = cliente(base);
    await api.entrar('admin@correia.adv.br', senha);
    const qr = (await api.post('/api/conexoes', { nome: 'Numero hospedado', tipo: 'qrcode' })).dados;
    s.ok(
      'a conexao por QR Code nasce apontando para a Evolution do compose',
      qr?.qrcode?.servidor === 'http://evolution:8080' && qr?.qrcode?.urlWebhook === 'http://sistema:4477',
      JSON.stringify({ servidor: qr?.qrcode?.servidor, webhook: qr?.qrcode?.urlWebhook }),
    );
  } finally {
    for (const processo of vivos) {
      try {
        processo.kill();
      } catch {
        /* ja morreu */
      }
    }
    await esperar(300);
    for (const pasta of pastas) fs.rmSync(pasta, { recursive: true, force: true });
  }
  return s;
}
