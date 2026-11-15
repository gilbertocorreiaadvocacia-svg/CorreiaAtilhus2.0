import { cliente, suite } from './apoio.js';

/**
 * /api/saude deixa de ser publica (lote C-02).
 *
 * Sem cookie a rota responde 401: a sessao nem existe, e o corpo nao traz a
 * pasta nem o pid. Dono e papel admin passam (os dois sao administrador em
 * exigirAdministrador, rotas/sessao.js). Atendente tem sessao valida e mesmo
 * assim recebe 403 — nao 401, porque o cookie prestou; o que falta e o papel.
 *
 * /api/vivo continua publica: e a batida do HEALTHCHECK, e nao pede cookie.
 */
export async function testarSaudeExigeSessao({ base }) {
  const s = suite('A saude exige sessao de administrador; a batida nao');

  const semCookie = await fetch(`${base}/api/saude`);
  const textoSemCookie = await semCookie.text();
  s.ok(
    '/api/saude sem cookie responde 401 e nao entrega a pasta nem o pid',
    semCookie.status === 401 && !/"raiz"/.test(textoSemCookie) && !/"pid"/.test(textoSemCookie),
    `${semCookie.status} ${textoSemCookie.slice(0, 180)}`,
  );

  const vivo = await fetch(`${base}/api/vivo`);
  const corpoVivo = await vivo.json().catch(() => null);
  s.ok('/api/vivo sem cookie responde 200', vivo.status === 200 && corpoVivo?.ok === true, `${vivo.status} ${JSON.stringify(corpoVivo)}`);

  const dono = cliente(base);
  const entrou = await dono.entrar();
  const comoDono = await dono.get('/api/saude');
  s.ok(
    'dono (administrador em exigirAdministrador) le /api/saude com 200',
    entrou.status === 200 && comoDono.status === 200 && comoDono.dados?.ok === true && typeof comoDono.dados?.raiz === 'string',
    `${entrou.status} / ${comoDono.status}`,
  );

  const emailAdmin = 'admin-saude-c02@correia.adv.br';
  const emailAtendente = 'atendente-saude-c02@correia.adv.br';
  const senha = 'senha-de-teste-123';
  try {
    const criadoAdmin = await dono.post('/api/membros', { email: emailAdmin, nome: 'Admin da Saude', senha, papel: 'admin' });
    const adm = cliente(base);
    await adm.entrar(emailAdmin, senha);
    const comoAdmin = await adm.get('/api/saude');
    s.ok(
      'papel admin le /api/saude com 200',
      criadoAdmin.status === 200 && comoAdmin.status === 200 && comoAdmin.dados?.ok === true,
      `${criadoAdmin.status} / ${comoAdmin.status} ${JSON.stringify(criadoAdmin.dados?.erro || comoAdmin.dados?.erro || '')}`,
    );

    const criadoAtendente = await dono.post('/api/membros', { email: emailAtendente, nome: 'Atendente da Saude', senha, papel: 'atendente' });
    const atendente = cliente(base);
    await atendente.entrar(emailAtendente, senha);
    const comoAtendente = await atendente.get('/api/saude');
    s.ok(
      'atendente com sessao valida recebe 403, nao 401',
      criadoAtendente.status === 200 && comoAtendente.status === 403 && /administrador/i.test(comoAtendente.dados?.erro || ''),
      `${criadoAtendente.status} / ${comoAtendente.status} ${JSON.stringify(comoAtendente.dados)}`,
    );
  } finally {
    for (const m of (await dono.get('/api/membros')).dados || []) {
      if ([emailAdmin, emailAtendente].includes(m.usuario?.email)) await dono.delete(`/api/membros/${m.id}`);
    }
  }

  return s;
}
