import { cliente, suite } from './apoio.js';
import { codigoDe } from '../nucleo/doisfatores.js';

/**
 * O segundo fator, de ponta a ponta, pela porta HTTP.
 *
 * O que nao pode falhar, porque e o que separa a conta de quem tem o celular de
 * quem so tem a senha:
 *  - a senha certa NAO abre sessao sozinha; leva ao codigo (ou a adesao);
 *  - adesao so vale com o codigo do app (sem codigos de reserva);
 *  - o segredo nunca volta para a tela depois de pareado;
 *  - codigo errado nao entra;
 *  - desafio vencido/invalido nao entra;
 *  - o administrador reinicia o segundo fator de quem perdeu o celular.
 */
export async function testarDoisFatores({ base }) {
  const s = suite('Segundo fator (2FA)');
  const admin = cliente(base);
  await admin.entrar();

  /* Uma conta nova, ainda sem app pareado, para exercer a adesao sem mexer no
     admin (que a semente ja deixou pareado). */
  const email = 'duas-etapas@correia.adv.br';
  const senha = 'senha-comprida-de-teste';
  const criado = await admin.post('/api/membros', { email, nome: 'Duas Etapas', senha, papel: 'atendente' });
  const membroId = criado.dados?.id;
  if (!s.ok('o membro de teste foi criado', Boolean(membroId), JSON.stringify(criado.dados))) return s;

  /* --- Senha certa nao entra direto: leva a adesao --------------------- */
  const c = cliente(base);
  const p1 = await c.post('/api/sessao/entrar', { email, senha });
  s.ok('a senha certa nao abre sessao: pede o segundo fator', p1.dados?.etapa === 'adesao', JSON.stringify(p1.dados?.etapa));
  s.ok('a adesao vem com segredo, otpauth e desafio', Boolean(p1.dados?.segredo && p1.dados?.otpauth && p1.dados?.desafio), Object.keys(p1.dados || {}).join(','));
  const segredo = p1.dados.segredo;

  /* --- Adesao exige o codigo certo ------------------------------------ */
  const erradaAdesao = await c.post('/api/sessao/2fa/confirmar', { desafio: p1.dados.desafio, codigo: '000000' });
  s.ok('adesao com codigo errado nao ativa', erradaAdesao.status === 401, String(erradaAdesao.status));

  const conf = await c.post('/api/sessao/2fa/confirmar', { desafio: p1.dados.desafio, codigo: codigoDe(segredo) });
  s.ok('adesao com o codigo do app ativa e entra', conf.status === 200, JSON.stringify(conf.dados));
  s.ok('a adesao NAO devolve codigos de reserva (so o do app)', !('codigosReserva' in (conf.dados || {})), JSON.stringify(Object.keys(conf.dados || {})));

  /* --- O segredo nunca volta para a tela ------------------------------ */
  const eu = await c.get('/api/sessao/eu');
  s.ok('a sessao nasceu (eu responde)', eu.status === 200, String(eu.status));
  s.ok('o usuario diz que o segundo fator esta ligado', eu.dados?.usuario?.doisFatoresAtivo === true, JSON.stringify(eu.dados?.usuario?.doisFatoresAtivo));
  s.ok('e NAO carrega o segredo nem os codigos de reserva', !('doisFatores' in (eu.dados?.usuario || {})) && !('segredo' in (eu.dados?.usuario || {})), Object.keys(eu.dados?.usuario || {}).join(','));

  /* --- Ja pareado: a senha leva ao passo do codigo -------------------- */
  const c2 = cliente(base);
  const p2 = await c2.post('/api/sessao/entrar', { email, senha });
  s.ok('pareado, a senha leva ao codigo (nao a adesao)', p2.dados?.etapa === 'codigo', JSON.stringify(p2.dados?.etapa));
  s.ok('e o codigo nao vem junto (sem segredo na resposta)', !p2.dados?.segredo, JSON.stringify(Object.keys(p2.dados || {})));

  const codErrado = await c2.post('/api/sessao/2fa/entrar', { desafio: p2.dados.desafio, codigo: '000000' });
  s.ok('codigo errado nao entra', codErrado.status === 401, String(codErrado.status));

  /* Desafio novo: o anterior pode ter sido marcado por tentativa, e um codigo
     so vale uma vez por janela. */
  const p2b = await c2.post('/api/sessao/entrar', { email, senha });
  const codCerto = await c2.post('/api/sessao/2fa/entrar', { desafio: p2b.dados.desafio, codigo: codigoDe(segredo) });
  s.ok('o codigo do app entra', codCerto.status === 200, JSON.stringify(codCerto.dados));

  /* --- Sem codigo de reserva: um codigo tipo reserva nao entra -------- */
  const c3 = cliente(base);
  const p3 = await c3.post('/api/sessao/entrar', { email, senha });
  const tentativaReserva = await c3.post('/api/sessao/2fa/entrar', { desafio: p3.dados.desafio, codigo: 'abcd-1234' });
  s.ok('um codigo no formato de reserva nao entra (a reserva foi retirada)', tentativaReserva.status === 401, String(tentativaReserva.status));

  /* --- Desafio invalido/vencido --------------------------------------- */
  const semDesafio = await cliente(base).post('/api/sessao/2fa/entrar', { desafio: 'dsf_inexistente', codigo: codigoDe(segredo) });
  s.ok('desafio que nao existe nao entra', semDesafio.status === 401, String(semDesafio.status));

  /* --- Administrador reinicia o segundo fator ------------------------- */
  const resetPorSuporte = await c.patch(`/api/membros/${membroId}`, { resetar2fa: true });
  s.ok('quem nao e administrador nao reinicia segundo fator', resetPorSuporte.status === 403, String(resetPorSuporte.status));

  const reset = await admin.patch(`/api/membros/${membroId}`, { resetar2fa: true });
  s.ok('o administrador reinicia o segundo fator', reset.status === 200, JSON.stringify(reset.dados));

  const c5 = cliente(base);
  const p5 = await c5.post('/api/sessao/entrar', { email, senha });
  s.ok('reiniciado, a conta volta a pedir adesao', p5.dados?.etapa === 'adesao', JSON.stringify(p5.dados?.etapa));

  /* Limpeza: tira o membro de teste para as suites seguintes nao contarem com ele. */
  await admin.delete(`/api/membros/${membroId}`);
  return s;
}
