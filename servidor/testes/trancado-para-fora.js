import { spawn } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

import { cliente, suite } from './apoio.js';
import { codigoDe, conferirCodigo, desvioDoRelogio } from '../nucleo/doisfatores.js';

/**
 * Ficar trancado do lado de fora: as duas saidas.
 *
 * Em 13/11/2026 o escritorio nao conseguiu entrar — duas contas, o mesmo
 * "Codigo incorreto", nenhuma pista. Dois defeitos juntos faziam disso um beco
 * sem saida, e os dois sao cobertos aqui:
 *
 *  1. A MENSAGEM NAO DIZIA NADA. Quando um relogio sai de hora, todo codigo
 *     falha, e "Codigo incorreto" manda cada um procurar o defeito no proprio
 *     celular — o unico lugar onde ele nao esta. Agora o servidor mede o
 *     desvio e diz qual relogio desconfiar, sem nunca deixar o codigo entrar.
 *
 *  2. NAO HAVIA VOLTA PELA TELA. O administrador reinicia o segundo fator dos
 *     colegas, mas se ELE tambem esta trancado nao sobra ninguem logado.
 *     CORREIA_RESETAR_2FA abre a porta na subida, pelo painel da hospedagem,
 *     sem SSH e sem parar o sistema na mao.
 */

/**
 * A medida do desvio.
 *
 * Teste de funcao, e nao pela porta HTTP, por um motivo honesto: para o
 * servidor so existe UM relogio, o dele. Para exercer "o servidor esta fora de
 * hora" e preciso mover a hora de alguem, e isso aqui dentro so da para fazer
 * passando o instante como argumento.
 */
export function testarDesvioDoRelogio() {
  const s = suite('Codigo recusado: de quem e o relogio errado');
  const segredo = 'JBSWY3DPEHPK3PXPJBSWY3DPEHPK3PXP';
  const instante = 1800000000;
  const doCelular = codigoDe(segredo, instante);

  s.ok('relogio na hora: nao ha desvio nenhum a relatar', desvioDoRelogio(segredo, doCelular, 20, instante) === null);

  const atrasado = desvioDoRelogio(segredo, doCelular, 20, instante - 7 * 60);
  s.ok(
    'servidor 7 minutos atrasado: o desvio e medido e vem com sinal positivo',
    atrasado?.minutos === 7 && atrasado?.segundos === 420,
    JSON.stringify(atrasado),
  );

  const adiantado = desvioDoRelogio(segredo, doCelular, 20, instante + 3 * 60);
  s.ok('servidor 3 minutos adiantado: sinal negativo, para a frase saber o lado', adiantado?.minutos === -3, JSON.stringify(adiantado));

  s.ok('codigo realmente errado continua sem explicacao de relogio', desvioDoRelogio(segredo, '000000', 20, instante) === null);
  s.ok('texto que nem e codigo nao e medido', desvioDoRelogio(segredo, 'abc', 20, instante) === null);

  /*
   * O limite da busca importa: fora da janela, o desvio nao e achado e a
   * recusa volta a ser so "Codigo incorreto". Melhor nao explicar do que
   * varrer horas de codigos procurando uma coincidencia.
   */
  s.ok('alem da janela procurada, nao ha medida', desvioDoRelogio(segredo, doCelular, 20, instante - 40 * 60) === null);

  /* Medir NAO e aceitar: quem decide entrar continua sendo conferirCodigo, com
     a folga de meio minuto de sempre. Aceitar um codigo de sete minutos atras
     seria abrir a porta que o segundo fator existe para fechar. */
  const deSeteMinutosAtras = codigoDe(segredo, instante - 7 * 60);
  s.ok(
    'medir nao e aceitar: o codigo de 7 minutos atras continua recusado',
    conferirCodigo(segredo, deSeteMinutosAtras, 1, instante) === false,
    'entrou um codigo de 7 minutos atras',
  );
  s.ok('e o da janela vizinha (±30s) continua valendo, como sempre', conferirCodigo(segredo, codigoDe(segredo, instante - 30), 1, instante) === true);

  return s;
}

/**
 * A recusa pela porta HTTP.
 *
 * Aqui o relogio do servidor esta certo e quem "sai de hora" e o codigo
 * mandado: e o mesmo numero que um celular adiantado produziria. O que se
 * afirma, entao, e o que o sistema faz com isso — explica em vez de so recusar,
 * e nao abre a porta.
 */
export async function testarRecusaExplicada({ base }) {
  const s = suite('A recusa do codigo explica, em vez de so negar');
  const admin = cliente(base);
  await admin.entrar();

  const email = 'fora-de-hora@correia.adv.br';
  const senha = 'senha-comprida-de-teste';
  const criado = await admin.post('/api/membros', { email, nome: 'Fora de Hora', senha, papel: 'atendente' });
  if (!s.ok('o membro de teste foi criado', Boolean(criado.dados?.id), JSON.stringify(criado.dados))) return s;

  const c = cliente(base);
  const adesao = await c.post('/api/sessao/entrar', { email, senha });
  const segredo = adesao.dados?.segredo;
  if (!s.ok('a conta chega na adesao, com segredo', Boolean(segredo), JSON.stringify(adesao.dados?.etapa))) return s;

  /* --- Na adesao: codigo fora de hora e explicado -------------------- */
  const foraDeHora = codigoDe(segredo, Date.now() / 1000 + 6 * 60);
  const recusado = await c.post('/api/sessao/2fa/confirmar', { desafio: adesao.dados.desafio, codigo: foraDeHora });
  s.ok('codigo fora de hora NAO entra', recusado.status === 401, String(recusado.status));
  s.ok(
    'e a recusa diz que o codigo estava certo, so fora de hora',
    /fora de hora/i.test(recusado.dados?.erro || recusado.dados?.mensagem || recusado.texto || ''),
    String(recusado.dados?.erro || recusado.dados?.mensagem || recusado.texto || '').slice(0, 160),
  );
  s.ok(
    'e diz de quantos minutos, para o escritorio saber o tamanho do problema',
    /6 minuto/.test(recusado.dados?.erro || recusado.dados?.mensagem || recusado.texto || ''),
    String(recusado.dados?.erro || recusado.dados?.mensagem || recusado.texto || '').slice(0, 160),
  );
  /*
   * Com UMA conta so, a frase nao acusa o servidor: um celular desacertado e um
   * servidor desacertado produzem o mesmo numero, e mandar o escritorio mexer
   * na hora da VPS por causa de um celular seria conselho errado.
   */
  s.ok(
    'com uma conta so, nao cravam que o relogio errado e o do servidor',
    /celular/i.test(recusado.dados?.erro || recusado.dados?.mensagem || recusado.texto || ''),
    String(recusado.dados?.erro || recusado.dados?.mensagem || recusado.texto || '').slice(0, 200),
  );

  /* --- Codigo de verdade errado continua sendo so errado ------------- */
  const erradoDeVerdade = await c.post('/api/sessao/2fa/confirmar', { desafio: adesao.dados.desafio, codigo: '000000' });
  s.ok('codigo inventado continua recusado sem explicacao de relogio', erradoDeVerdade.status === 401, String(erradoDeVerdade.status));
  s.ok(
    'e nao inventa desvio nenhum',
    !/fora de hora/i.test(erradoDeVerdade.dados?.erro || erradoDeVerdade.dados?.mensagem || erradoDeVerdade.texto || ''),
    String(erradoDeVerdade.dados?.erro || erradoDeVerdade.dados?.mensagem || erradoDeVerdade.texto || '').slice(0, 120),
  );

  /* --- O codigo na hora certa entra normalmente ----------------------- */
  const naHora = await c.post('/api/sessao/2fa/confirmar', { desafio: adesao.dados.desafio, codigo: codigoDe(segredo) });
  s.ok('e o codigo na hora certa entra, como sempre', naHora.status === 200, String(naHora.status));

  return s;
}

/**
 * A porta de emergencia da hospedagem.
 *
 * Processo proprio, com base descartavel: a variavel so e lida na SUBIDA, que
 * e o ponto do desenho — nao ha rota nenhuma que faca isso com o sistema no ar.
 */
export async function testarDestrancar2fa({ raiz }) {
  const s = suite('Porta de emergencia do segundo fator (CORREIA_RESETAR_2FA)');
  const url = (arquivo) => JSON.stringify(pathToFileURL(path.join(raiz, arquivo)).href);
  const pasta = fs.mkdtempSync(path.join(os.tmpdir(), 'destrancar-2fa-'));
  const script = path.join(pasta, 'destrancar.mjs');

  fs.writeFileSync(
    script,
    `import { iniciarBanco, inserir, achar, listar, atualizar, encerrarBanco } from ${url('servidor/nucleo/banco.js')};
import { destrancar2faPeloAmbiente } from ${url('servidor/nucleo/destrancar-2fa.js')};
iniciarBanco();

inserir('workspaces', { id: 'w1', nome: 'Correia' });
inserir('usuarios', { id: 'u1', nome: 'Dani', email: 'Dani@Correia.adv.br', doisFatores: { ativo: true, segredo: 'AAAA', confirmadoEm: '2026-01-01' } });
inserir('usuarios', { id: 'u2', nome: 'Leticia', email: 'leticia@correia.adv.br', doisFatores: { ativo: true, segredo: 'BBBB', confirmadoEm: '2026-01-01' } });
inserir('usuarios', { id: 'u3', nome: 'Intocada', email: 'intocada@correia.adv.br', doisFatores: { ativo: true, segredo: 'CCCC', confirmadoEm: '2026-01-01' } });
inserir('membros', { id: 'm1', workspaceId: 'w1', usuarioId: 'u1', papel: 'owner' });

const semVariavel = destrancar2faPeloAmbiente('');
const comEspacoENomeMaiusculo = destrancar2faPeloAmbiente(' dani@correia.adv.br , leticia@correia.adv.br , nao-existe@x.com ');
const depois = ['u1', 'u2', 'u3'].map((id) => ({ id, ativo: Boolean(achar('usuarios', id)?.doisFatores?.ativo) }));
const trilha = listar('logs', { workspaceId: 'w1', tipo: 'seguranca' }).map((l) => l.descricao);

/* A pessoa pareia um celular novo... */
atualizar('usuarios', 'u1', { doisFatores: { ativo: true, segredo: 'NOVO', confirmadoEm: '2026-11-14' } });
/* ...e o sistema sobe de novo com a MESMA variavel esquecida no painel. */
const segundaSubida = destrancar2faPeloAmbiente(' dani@correia.adv.br , leticia@correia.adv.br , nao-existe@x.com ');
const aindaPareada = Boolean(achar('usuarios', 'u1')?.doisFatores?.ativo);

/* Para destravar a mesma pessoa outra vez, muda-se o valor. */
const comSufixo = destrancar2faPeloAmbiente('dani@correia.adv.br#2');
const destravadaDeNovo = !achar('usuarios', 'u1')?.doisFatores;

console.log(JSON.stringify({
  semVariavel,
  comEspacoENomeMaiusculo,
  depois,
  trilha,
  segundaSubida,
  aindaPareada,
  comSufixo,
  destravadaDeNovo,
}));
await encerrarBanco();
process.exit(0);
`,
  );

  try {
    const r = await new Promise((resolve) => {
      const p = spawn(process.execPath, [script], { env: { ...process.env, CORREIA_DADOS: pasta }, stdio: ['ignore', 'pipe', 'pipe'] });
      let texto = '';
      p.stdout.on('data', (d) => (texto += d));
      p.stderr.on('data', (d) => (texto += d));
      p.on('close', (codigo) => resolve({ codigo, texto }));
    });
    if (!s.ok('o escritorio de teste roda sem erro', r.codigo === 0, r.texto.slice(-700))) return s;
    const b = JSON.parse(r.texto.trim().split('\n').pop());

    s.ok('sem a variavel, nao mexe em nada', b.semVariavel.ligado === false && b.semVariavel.zerados.length === 0, JSON.stringify(b.semVariavel));

    s.ok(
      'destrava as contas pedidas, sem ligar para espaco nem maiuscula no e-mail',
      b.comEspacoENomeMaiusculo.zerados.length === 2,
      JSON.stringify(b.comEspacoENomeMaiusculo.zerados),
    );
    s.ok(
      'e so as pedidas: quem nao foi citado continua com o aparelho pareado',
      b.depois.find((u) => u.id === 'u3')?.ativo === true && b.depois.filter((u) => u.ativo).length === 1,
      JSON.stringify(b.depois),
    );
    s.ok(
      'e-mail que nao existe e reclamado em voz alta, em vez de sumir calado',
      b.comEspacoENomeMaiusculo.naoEncontrados.includes('nao-existe@x.com'),
      JSON.stringify(b.comEspacoENomeMaiusculo.naoEncontrados),
    );
    s.ok(
      'cada destravamento fica na trilha de seguranca do escritorio',
      b.trilha.some((t) => /duas etapas reiniciada pela hospedagem/i.test(t) && /Dani/.test(t)),
      JSON.stringify(b.trilha),
    );

    /*
     * A assercao que mais importa deste arquivo: a variavel esquecida no painel
     * NAO pode virar uma conta sem segundo fator para sempre. Sem esta trava,
     * a porta de emergencia deixaria de ser emergencia e viraria um buraco
     * permanente que ninguem veria.
     */
    s.ok(
      'variavel esquecida no painel nao zera de novo quem ja pareou outro celular',
      b.aindaPareada === true && b.segundaSubida.zerados.length === 0,
      JSON.stringify({ aindaPareada: b.aindaPareada, segunda: b.segundaSubida }),
    );
    s.ok(
      'e ela diz que ja fez, em vez de ficar calada',
      b.segundaSubida.jaFeitos.length === 2,
      JSON.stringify(b.segundaSubida.jaFeitos),
    );
    s.ok(
      'para destravar a mesma pessoa de novo, muda-se o valor (sufixo depois de #)',
      b.destravadaDeNovo === true && b.comSufixo.zerados.length === 1,
      JSON.stringify(b.comSufixo),
    );
  } finally {
    fs.rmSync(pasta, { recursive: true, force: true });
  }
  return s;
}
