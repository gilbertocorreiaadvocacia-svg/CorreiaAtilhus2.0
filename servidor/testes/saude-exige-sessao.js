import fs from 'node:fs';
import path from 'node:path';

import { cliente, suite } from './apoio.js';

/**
 * /api/saude deixa de ser publica (lote C-02).
 *
 * Sem cookie, com cookie que o servidor nao reconhece, ou com o cookie de uma
 * sessao ja encerrada: 401. O caminho da sessao expirada e o mesmo — lerSessao
 * devolve null e a resposta e "Sessao expirada". Dono e papel admin passam
 * (exigirAdministrador). Atendente e somente_leitura tem sessao valida e
 * recebem 403.
 *
 * A lista de rotas com { publica: true } e fixa: rota nova sem sessao faz
 * este teste falhar. /api/vivo continua nessa lista; /api/saude nao.
 */

const ROTAS_PUBLICAS = [
  'GET /api/vivo aberta',
  'GET /tiktok/retorno aberta',
  'GET /v1/agents chave',
  'GET /v1/connections chave',
  'GET /v1/connections/:id chave',
  'GET /v1/contacts chave',
  'GET /v1/message chave',
  'GET /v1/message/:id chave',
  'GET /v1/settings/departamentos chave',
  'GET /v1/settings/source chave',
  'GET /v1/settings/status chave',
  'GET /v1/settings/tags chave',
  'GET /v1/templates chave',
  'GET /v1/templates/:id chave',
  'GET /v1/users chave',
  'GET /webhook/:conexaoId aberta',
  'PATCH /v1/settings/departamentos chave',
  'PATCH /v1/settings/source chave',
  'PATCH /v1/settings/status chave',
  'PATCH /v1/settings/tags chave',
  'POST /api/sessao/2fa/confirmar aberta',
  'POST /api/sessao/2fa/entrar aberta',
  'POST /api/sessao/entrar aberta',
  'POST /api/sessao/sair aberta',
  'POST /v1/contacts chave',
  'POST /v1/contacts/:id/mark-read chave',
  'POST /v1/message/:id/cancel chave',
  'POST /v1/send/message chave',
  'POST /v1/send/template chave',
  'POST /v1/zapsign/webhook aberta',
  'POST /webhook/:conexaoId aberta',
];

function caminhoDaRota(bruto, texto) {
  if (!bruto.includes('${caminho}')) return [bruto];
  const marca = /const\s+classes\s*=\s*\[([\s\S]*?)\];/.exec(texto);
  if (!marca) return [bruto];
  const nomes = [...marca[1].matchAll(/\[\s*'([^']+)'/g)].map((achado) => achado[1]);
  if (!nomes.length) return [bruto];
  return nomes.map((nome) => bruto.replace(/\$\{caminho\}/g, nome));
}

function rotasComOpcoes(texto, nomeDaVariavel) {
  const achadas = [];
  const re = /rotas\.(get|post|put|patch|delete)\(\s*(['"`])([^'"`]+)\2/g;
  let marca = re.exec(texto);
  while (marca) {
    const proxima = texto.slice(marca.index + marca[0].length).search(/rotas\.(get|post|put|patch|delete)\(/);
    const corpo = texto.slice(marca.index, proxima < 0 ? texto.length : marca.index + marca[0].length + proxima);
    if (new RegExp(`\\b${nomeDaVariavel}\\s*\\)`).test(corpo)) {
      const tipo = 'chave';
      for (const caminho of caminhoDaRota(marca[3], texto)) {
        achadas.push(`${marca[1].toUpperCase()} ${caminho} ${tipo}`);
      }
    }
    marca = re.exec(texto);
  }
  return achadas;
}

function rotasPublicasDoArquivo(texto) {
  const achadas = [];
  const variavel = /(?:const|let)\s+(\w+)\s*=\s*\{[^}]*\bpublica\s*:\s*true\b[^}]*\}/.exec(texto);
  if (variavel) {
    const tipo = /\bchaveApi\s*:\s*true\b/.test(variavel[0]) ? 'chave' : 'aberta';
    for (const rota of rotasComOpcoes(texto, variavel[1])) {
      achadas.push(rota.replace(/ chave$/, ` ${tipo}`));
    }
  }
  const re = /rotas\.(get|post|put|patch|delete)\(\s*(['"`])([^'"`]+)\2/g;
  let marca = re.exec(texto);
  while (marca) {
    const proxima = texto.slice(marca.index + marca[0].length).search(/rotas\.(get|post|put|patch|delete)\(/);
    const corpo = texto.slice(marca.index, proxima < 0 ? texto.length : marca.index + marca[0].length + proxima);
    const inline = /\{[^}]*\bpublica\s*:\s*true\b[^}]*\}/.exec(corpo);
    if (inline) {
      const tipo = /\bchaveApi\s*:\s*true\b/.test(inline[0]) ? 'chave' : 'aberta';
      for (const caminho of caminhoDaRota(marca[3], texto)) {
        achadas.push(`${marca[1].toUpperCase()} ${caminho} ${tipo}`);
      }
    }
    marca = re.exec(texto);
  }
  return achadas;
}

function arquivosDoServidor(raiz) {
  const pasta = path.join(raiz, 'servidor');
  const arquivos = [];
  (function varrer(atual) {
    for (const item of fs.readdirSync(atual, { withFileTypes: true })) {
      if (item.name === 'testes' || item.name === 'node_modules') continue;
      const completo = path.join(atual, item.name);
      if (item.isDirectory()) varrer(completo);
      else if (item.name.endsWith('.js')) arquivos.push(completo);
    }
  })(pasta);
  return arquivos;
}

export function rotasPublicasNoCodigo(raiz) {
  const achadas = [];
  for (const arquivo of arquivosDoServidor(raiz)) {
    achadas.push(...rotasPublicasDoArquivo(fs.readFileSync(arquivo, 'utf8')));
  }
  return [...new Set(achadas)].sort();
}

function linhaPedeSaude(linha, extensao) {
  if (!linha.includes('/api/saude')) return false;
  const texto = linha.trim();
  if (extensao === '.js' && (texto.startsWith('//') || texto.startsWith('*') || texto.startsWith('/*'))) return false;
  if ((extensao === '.sh' || extensao === '.ps1') && texto.startsWith('#')) return false;
  if ((extensao === '.cmd' || extensao === '.bat') && (/^rem\b/i.test(texto) || texto.startsWith('::'))) return false;
  return true;
}

function scriptsQuePedemSaude(raiz) {
  const alvos = [];
  const pastas = ['windows', 'hospedagem', 'servidor/ferramentas'];
  for (const pasta of pastas) {
    const completo = path.join(raiz, pasta);
    if (!fs.existsSync(completo)) continue;
    for (const nome of fs.readdirSync(completo)) {
      if (/\.(js|cmd|bat|ps1|sh)$/.test(nome)) alvos.push(path.join(completo, nome));
    }
  }
  const entrada = path.join(raiz, 'servidor/entrada-docker.sh');
  if (fs.existsSync(entrada)) alvos.push(entrada);
  const achados = [];
  for (const arquivo of alvos) {
    const extensao = path.extname(arquivo);
    const linhas = fs.readFileSync(arquivo, 'utf8').split('\n');
    linhas.forEach((linha, indice) => {
      if (linhaPedeSaude(linha, extensao)) achados.push(`${path.relative(raiz, arquivo)}:${indice + 1}`);
    });
  }
  return achados;
}

export async function testarSaudeExigeSessao({ base, raiz }) {
  const s = suite('A saude exige sessao de administrador; a batida nao');

  const semCookie = await fetch(`${base}/api/saude`);
  const textoSemCookie = await semCookie.text();
  s.ok(
    '/api/saude sem cookie responde 401 e nao entrega a pasta nem o pid',
    semCookie.status === 401 && !/"raiz"/.test(textoSemCookie) && !/"pid"/.test(textoSemCookie),
    `${semCookie.status} ${textoSemCookie.slice(0, 180)}`,
  );

  const invalido = await fetch(`${base}/api/saude`, { headers: { Cookie: 'correiatendimentos=nao-e-uma-sessao' } });
  const textoInvalido = await invalido.text();
  s.ok(
    'cookie invalido responde 401 e nao entrega a pasta',
    invalido.status === 401 && /sessao expirada/i.test(textoInvalido) && !/"raiz"/.test(textoInvalido),
    `${invalido.status} ${textoInvalido.slice(0, 180)}`,
  );

  const vivo = await fetch(`${base}/api/vivo`);
  const corpoVivo = await vivo.json().catch(() => null);
  s.ok('/api/vivo sem cookie responde 200', vivo.status === 200 && corpoVivo?.ok === true, `${vivo.status} ${JSON.stringify(corpoVivo)}`);

  const dono = cliente(base);
  const entrou = await dono.entrar();
  const cookieDaSessao = dono.cookie();
  const comoDono = await dono.get('/api/saude');
  s.ok(
    'dono (administrador em exigirAdministrador) le /api/saude com 200',
    entrou.status === 200 && comoDono.status === 200 && comoDono.dados?.ok === true && typeof comoDono.dados?.raiz === 'string',
    `${entrou.status} / ${comoDono.status}`,
  );

  await dono.post('/api/sessao/sair', {});
  const encerrada = await fetch(`${base}/api/saude`, { headers: { Cookie: cookieDaSessao } });
  const textoEncerrada = await encerrada.text();
  s.ok(
    'cookie de sessao encerrada (o mesmo 401 de uma sessao expirada) nao entrega a pasta',
    encerrada.status === 401 && /sessao expirada/i.test(textoEncerrada) && !/"raiz"/.test(textoEncerrada),
    `${encerrada.status} ${textoEncerrada.slice(0, 180)}`,
  );

  await dono.entrar();

  const emailAdmin = 'admin-saude-c02@correia.adv.br';
  const emailAtendente = 'atendente-saude-c02@correia.adv.br';
  const emailLeitura = 'leitura-saude-c02@correia.adv.br';
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

    const criadoLeitura = await dono.post('/api/membros', { email: emailLeitura, nome: 'Leitura da Saude', senha, papel: 'somente_leitura' });
    const leitor = cliente(base);
    await leitor.entrar(emailLeitura, senha);
    const comoLeitor = await leitor.get('/api/saude');
    s.ok(
      'somente_leitura com sessao valida recebe 403, nao 401',
      criadoLeitura.status === 200 && comoLeitor.status === 403 && /administrador/i.test(comoLeitor.dados?.erro || ''),
      `${criadoLeitura.status} / ${comoLeitor.status} ${JSON.stringify(comoLeitor.dados)}`,
    );
  } finally {
    for (const m of (await dono.get('/api/membros')).dados || []) {
      if ([emailAdmin, emailAtendente, emailLeitura].includes(m.usuario?.email)) await dono.delete(`/api/membros/${m.id}`);
    }
  }

  const publicas = rotasPublicasNoCodigo(raiz);
  s.ok(
    'a lista de rotas publicas e esta, e so esta',
    publicas.join('\n') === ROTAS_PUBLICAS.join('\n'),
    `a mais: ${publicas.filter((r) => !ROTAS_PUBLICAS.includes(r)).join(', ') || 'nenhuma'}; a menos: ${ROTAS_PUBLICAS.filter((r) => !publicas.includes(r)).join(', ') || 'nenhuma'}`,
  );
  s.ok('GET /api/saude nao esta na lista publica', !publicas.some((r) => r.startsWith('GET /api/saude')));

  const pedidos = scriptsQuePedemSaude(raiz);
  s.ok(
    'nenhum script ou ferramenta pede /api/saude para saber se o processo esta no ar',
    pedidos.length === 0,
    pedidos.join(', '),
  );

  return s;
}
