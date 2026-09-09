import { execFileSync } from 'node:child_process';
import { PORTA } from '../config.js';
import { iniciarBanco, listar } from '../nucleo/banco.js';

/**
 * Conferidor do caminho por QR Code.
 *
 * Rode com `npm run conferir-whatsapp`.
 *
 * A conexao por QR Code tem uma corrente de seis elos, e cinco deles falham em
 * silencio. O sintoma e sempre o mesmo — o QR conecta, a sessao abre e NENHUMA
 * mensagem chega — e ele nao diz qual elo quebrou. Este arquivo testa um por
 * um, na ordem, e para no primeiro que falhar dizendo o que fazer.
 *
 * O elo 6 e o que ninguem consegue testar de cabeca, e e o que mais quebra: e
 * a chamada de VOLTA, do contêiner para esta maquina. Ela nao passa pelo
 * `localhost` — la dentro `localhost` e o proprio contêiner — e ainda tem de
 * atravessar a guarda de rede em servidor/config.js. Aqui ela e testada do
 * jeito de verdade: subindo um contêiner descartavel que chama o endereco
 * exato que a Evolution vai chamar.
 */

const AZUL = (t) => `[36m${t}[0m`;
const VERDE = (t) => `[32m${t}[0m`;
const VERMELHO = (t) => `[31m${t}[0m`;
const AMARELO = (t) => `[33m${t}[0m`;

let passou = 0;
let parou = false;

function ok(titulo, detalhe = '') {
  passou += 1;
  console.log(`  ${VERDE('ok')}     ${titulo}${detalhe ? `  ${detalhe}` : ''}`);
}

/** Falha que interrompe: os elos seguintes dependem deste. */
function falhou(titulo, oQueFazer) {
  parou = true;
  console.log(`  ${VERMELHO('FALHOU')} ${titulo}`);
  console.log('');
  console.log(`  ${AMARELO('O que fazer:')}`);
  for (const linha of oQueFazer.split('\n')) console.log(`    ${linha}`);
  console.log('');
}

function aviso(titulo, texto) {
  console.log(`  ${AMARELO('atencao')} ${titulo}`);
  for (const linha of texto.split('\n')) console.log(`          ${linha}`);
}

/** Roda um comando e devolve a saida, ou null se ele nao existe / falhou. */
function rodar(comando, argumentos, { prazoMs = 20000 } = {}) {
  try {
    return execFileSync(comando, argumentos, {
      encoding: 'utf8',
      timeout: prazoMs,
      stdio: ['ignore', 'pipe', 'pipe'],
    }).trim();
  } catch {
    return null;
  }
}

async function bater(url, opcoes = {}) {
  try {
    const resposta = await fetch(url, { ...opcoes, signal: AbortSignal.timeout(8000) });
    return { status: resposta.status, corpo: await resposta.text().catch(() => '') };
  } catch (erro) {
    return { status: 0, erro: erro.message };
  }
}

async function principal() {
  console.log('');
  console.log(AZUL('  Conferindo o caminho do WhatsApp por QR Code'));
  console.log('');

  /* ---------------- 1. O sistema esta no ar ---------------- */

  const saude = await bater(`http://127.0.0.1:${PORTA}/api/saude`);
  if (saude.status !== 200) {
    falhou(
      `O CorreiaAtilhus2.0 nao responde na porta ${PORTA}`,
      'Abra o sistema (INICIAR.bat) e rode este conferidor de novo.',
    );
    return;
  }
  ok('o sistema responde', `porta ${PORTA}`);

  /* ---------------- 2. A conexao por QR Code existe e esta configurada ---- */

  iniciarBanco();
  const conexoes = listar('conexoes').filter((c) => c.tipo === 'qrcode');

  if (!conexoes.length) {
    falhou(
      'Nao ha nenhuma conexao do tipo QR Code',
      'Crie em Conexoes > Nova conexao > QR Code.',
    );
    return;
  }
  const conexao = conexoes[0];
  ok('ha uma conexao por QR Code', `"${conexao.nome}"`);

  const cfg = conexao.qrcode || {};
  const servidorEvolution = String(cfg.servidor || '').replace(/\/+$/, '');

  if (!servidorEvolution) {
    falhou(
      'A conexao nao diz onde a Evolution roda',
      'Em Conexoes, abra a conexao e preencha "Endereco do servico"\ncom http://localhost:8080',
    );
    return;
  }
  ok('a conexao sabe onde a Evolution roda', servidorEvolution);

  /*
   * O endereco de retorno e o elo que mais quebra, e ele quebra CALADO.
   * `localhost` aqui aponta o contêiner para ele mesmo.
   */
  const retorno = String(cfg.urlWebhook || '');
  if (!retorno) {
    aviso(
      'a conexao nao tem endereco de retorno',
      'Sem ele o padrao vira localhost, que dentro do contêiner e o proprio\ncontêiner. Ponha http://host.docker.internal:' + PORTA,
    );
  } else if (/localhost|127\.0\.0\.1/.test(retorno)) {
    falhou(
      `O endereco de retorno aponta para o contêiner, e nao para esta maquina (${retorno})`,
      `Dentro do contêiner, localhost e o proprio contêiner.\nTroque para http://host.docker.internal:${PORTA}`,
    );
    return;
  } else {
    ok('o endereco de retorno sai do contêiner', retorno);
  }

  /* ---------------- 3. O Docker esta de pe ---------------- */

  const versaoDocker = rodar('docker', ['--version']);
  if (!versaoDocker) {
    falhou(
      'O Docker nao esta instalado nesta maquina',
      'Instale o Docker Desktop em https://www.docker.com/products/docker-desktop\ne deixe ele ABERTO. Depois rode este conferidor de novo.',
    );
    return;
  }
  ok('o Docker esta instalado', versaoDocker);

  if (!rodar('docker', ['info', '--format', '{{.ServerVersion}}'], { prazoMs: 30000 })) {
    falhou(
      'O Docker esta instalado mas nao esta rodando',
      'Abra o Docker Desktop e espere ele dizer "Engine running".',
    );
    return;
  }
  ok('o Docker esta rodando');

  /* ---------------- 4. A Evolution responde ---------------- */

  const evolution = await bater(`${servidorEvolution}/`, { headers: { apikey: cfg.chave || 'sem-chave' } });
  if (evolution.status === 0) {
    falhou(
      `A Evolution nao responde em ${servidorEvolution}`,
      'Suba o contêiner. O comando esta no LEIA-ME.md, secao de Conexoes.\nConfira tambem se ela subiu na porta 8080.',
    );
    return;
  }
  ok('a Evolution responde', `status ${evolution.status}`);

  /*
   * A chave so e cobrada AQUI, e nao la em cima junto do resto da configuracao.
   * Ela nao e uma escolha do sistema: ela nasce no comando que sobe o
   * contêiner, em AUTHENTICATION_API_KEY. Cobra-la antes do Docker existir
   * mandava a pessoa preencher um campo cujo valor ela ainda nao tinha.
   */
  if (!cfg.chave) {
    falhou(
      'A conexao esta sem a chave da Evolution',
      'E a mesma chave que voce escolheu em AUTHENTICATION_API_KEY ao subir\no contêiner. Cole em Conexoes > a conexao > Chave de API.',
    );
    return;
  }
  ok('a conexao tem a chave da Evolution guardada');

  /* A chave errada e o caso que parece "conectado" e nao envia nada. */
  const instancias = await bater(`${servidorEvolution}/instance/fetchInstances`, {
    headers: { apikey: cfg.chave },
  });
  if (instancias.status === 401 || instancias.status === 403) {
    falhou(
      'A Evolution recusou a chave guardada na conexao',
      'A chave da conexao tem de ser IGUAL ao AUTHENTICATION_API_KEY com que\nvoce subiu o contêiner. Corrija em Conexoes > a conexao > Chave de API.',
    );
    return;
  }
  ok('a Evolution aceitou a chave', `status ${instancias.status}`);

  /* ---------------- 5. O caminho de VOLTA, que e o que quebra calado ------ */

  /*
   * Este e o teste que nao da para fazer de cabeca: um contêiner descartavel
   * chama o MESMO endereco que a Evolution vai chamar. Se voltar 200, a
   * mensagem recebida vai chegar. Se voltar 403, a guarda de rede recusou o
   * endereco do contêiner — e desde a versao de hoje o servidor escreve no log
   * qual foi.
   */
  console.log('');
  console.log(AZUL('  Testando o caminho de volta (contêiner -> esta maquina)…'));

  const alvo = retorno || `http://host.docker.internal:${PORTA}`;
  const codigo = rodar(
    'docker',
    ['run', '--rm', 'curlimages/curl:latest', '-s', '-o', '/dev/null', '-w', '%{http_code}', `${alvo}/api/saude`],
    { prazoMs: 120000 },
  );

  if (codigo === null) {
    aviso(
      'nao consegui rodar o contêiner de teste',
      'Pode ser a primeira baixada da imagem curlimages/curl demorando.\nTente de novo, ou teste a mao com:\n  docker run --rm curlimages/curl -s -i ' + alvo + '/api/saude',
    );
  } else if (codigo === '200') {
    ok('o contêiner alcanca esta maquina', `${alvo} respondeu 200`);
  } else if (codigo === '403') {
    falhou(
      `A guarda de rede recusou o contêiner (${alvo} respondeu 403)`,
      'E por isso que o QR conecta e nenhuma mensagem chega.\nOlhe o log do sistema: ele escreve qual endereco foi recusado.\nAcrescente a faixa em FAIXAS_PERMITIDAS, em servidor/config.js.',
    );
    return;
  } else if (codigo === '000') {
    falhou(
      `O contêiner nao alcancou esta maquina (${alvo})`,
      `Falta o passo do CORREIA_HOST. Ponha "set CORREIA_HOST=0.0.0.0" no\nsegredos.bat, na pasta do projeto, e reinicie o sistema.\nSem isso o servidor so escuta em 127.0.0.1 e o contêiner nao entra.`,
    );
    return;
  } else {
    aviso('o contêiner recebeu uma resposta inesperada', `codigo ${codigo}`);
  }

  /* ---------------- Veredito ---------------- */

  console.log('');
  if (!parou) {
    console.log(VERDE(`  ${passou} conferencias, nenhuma falha.`));
    console.log('');
    console.log('  A corrente esta inteira. Agora e so ler o QR Code:');
    console.log('    Conexoes > a conexao > Acoes > Conectar');
    console.log('    No celular: WhatsApp > Aparelhos conectados > Conectar um aparelho');
    console.log('');
    console.log('  Depois de conectar, mande uma mensagem de OUTRO celular para o');
    console.log('  numero. Ela tem de aparecer em Conversas em segundos.');
  }
  console.log('');
}

principal().then(
  () => process.exit(parou ? 1 : 0),
  (erro) => {
    console.error('O conferidor quebrou:', erro.message);
    process.exit(1);
  },
);
