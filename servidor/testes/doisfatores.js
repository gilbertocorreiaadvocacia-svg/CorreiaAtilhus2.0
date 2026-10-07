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
 *  - o administrador reinicia o segundo fator de quem perdeu o celular, mas
 *    nunca sem motivo (fica na trilha) e nunca o PROPRIO, por aqui;
 *  - quem ainda tem o aparelho troca por um novo sozinho, sem o administrador,
 *    e nunca fica sem protecao no meio do caminho: o antigo so para de valer
 *    quando o novo confirma o primeiro codigo; desistir mantem o atual;
 *  - SENHA errada trava depois de 5 tentativas, e so a troca certa nao basta
 *    mais ate passar o tempo — sem isso, a senha podia ser tentada sem fim;
 *  - o codigo da ADESAO (parear o app pela primeira vez) trava do mesmo jeito.
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
  const resetPorSuporte = await c.patch(`/api/membros/${membroId}`, { resetar2fa: true, motivoReset2fa: 'perdeu o celular' });
  s.ok('quem nao e administrador nao reinicia segundo fator', resetPorSuporte.status === 403, String(resetPorSuporte.status));

  const resetSemMotivo = await admin.patch(`/api/membros/${membroId}`, { resetar2fa: true });
  s.ok('reiniciar sem motivo e recusado', resetSemMotivo.status === 400, String(resetSemMotivo.status));

  const resetMotivoCurto = await admin.patch(`/api/membros/${membroId}`, { resetar2fa: true, motivoReset2fa: 'ab' });
  s.ok('motivo muito curto e recusado', resetMotivoCurto.status === 400, String(resetMotivoCurto.status));

  const reset = await admin.patch(`/api/membros/${membroId}`, { resetar2fa: true, motivoReset2fa: 'perdeu o celular' });
  s.ok('o administrador reinicia o segundo fator, com motivo', reset.status === 200, JSON.stringify(reset.dados));

  const c5 = cliente(base);
  const p5 = await c5.post('/api/sessao/entrar', { email, senha });
  s.ok('reiniciado, a conta volta a pedir adesao', p5.dados?.etapa === 'adesao', JSON.stringify(p5.dados?.etapa));
  // Conclui a adesao de novo, so para o membro de teste sair com conta normal.
  await c5.post('/api/sessao/2fa/confirmar', { desafio: p5.dados.desafio, codigo: codigoDe(p5.dados.segredo) });

  /* --- O administrador nao reinicia o PROPRIO segundo fator por aqui --- */
  const membroDoAdmin = (await admin.get('/api/membros')).dados?.find((m) => m.usuario?.email === 'admin@correia.adv.br');
  if (membroDoAdmin) {
    const autoReset = await admin.patch(`/api/membros/${membroDoAdmin.id}`, { resetar2fa: true, motivoReset2fa: 'teste' });
    s.ok('o administrador nao reinicia o proprio segundo fator por aqui', autoReset.status === 400, String(autoReset.status));
  }

  /* --- Troca de aparelho (self-service), sem perder a protecao -------- */
  const emailTroca = 'troca-aparelho@correia.adv.br';
  const senhaTroca = 'senha-correta-da-troca';
  const membroTroca = (await admin.post('/api/membros', { email: emailTroca, nome: 'Troca Aparelho', senha: senhaTroca, papel: 'atendente' })).dados;

  const cTroca = cliente(base);
  const p6 = await cTroca.post('/api/sessao/entrar', { email: emailTroca, senha: senhaTroca });
  const segredoAntigo = p6.dados.segredo;
  await cTroca.post('/api/sessao/2fa/confirmar', { desafio: p6.dados.desafio, codigo: codigoDe(segredoAntigo) });

  const semSessao = await cliente(base).post('/api/perfil/2fa/trocar/iniciar', {});
  s.ok('trocar aparelho exige sessao', semSessao.status === 401 || semSessao.status === 403, String(semSessao.status));

  const iniciarTroca = await cTroca.post('/api/perfil/2fa/trocar/iniciar', {});
  s.ok(
    'comeca a troca e devolve um segredo novo, diferente do atual',
    Boolean(iniciarTroca.dados?.segredo) && iniciarTroca.dados.segredo !== segredoAntigo,
    JSON.stringify(Object.keys(iniciarTroca.dados || {})),
  );
  const segredoNovo = iniciarTroca.dados.segredo;

  const p6b = await cliente(base).post('/api/sessao/entrar', { email: emailTroca, senha: senhaTroca });
  const aindaComOAntigo = await cliente(base).post('/api/sessao/2fa/entrar', { desafio: p6b.dados.desafio, codigo: codigoDe(segredoAntigo) });
  s.ok('o aparelho antigo continua valendo enquanto a troca nao confirma', aindaComOAntigo.status === 200, String(aindaComOAntigo.status));

  const confirmarComCodigoErrado = await cTroca.post('/api/perfil/2fa/trocar/confirmar', { codigo: '000000' });
  s.ok('confirmar a troca com codigo errado nao troca nada', confirmarComCodigoErrado.status === 401, String(confirmarComCodigoErrado.status));

  const confirmarTroca = await cTroca.post('/api/perfil/2fa/trocar/confirmar', { codigo: codigoDe(segredoNovo) });
  s.ok('confirma a troca com o codigo do aparelho novo', confirmarTroca.status === 200, JSON.stringify(confirmarTroca.dados));

  const p6c = await cliente(base).post('/api/sessao/entrar', { email: emailTroca, senha: senhaTroca });
  const antigoNaoEntraMais = await cliente(base).post('/api/sessao/2fa/entrar', { desafio: p6c.dados.desafio, codigo: codigoDe(segredoAntigo) });
  s.ok('depois da troca, o aparelho antigo nao entra mais', antigoNaoEntraMais.status === 401, String(antigoNaoEntraMais.status));

  const p6d = await cliente(base).post('/api/sessao/entrar', { email: emailTroca, senha: senhaTroca });
  const novoEntraNormalmente = await cliente(base).post('/api/sessao/2fa/entrar', { desafio: p6d.dados.desafio, codigo: codigoDe(segredoNovo) });
  s.ok('o aparelho novo entra normalmente', novoEntraNormalmente.status === 200, String(novoEntraNormalmente.status));

  /* Cancelar no meio do caminho: o aparelho atual continua valendo. */
  const cTroca2 = cliente(base);
  const p7 = await cTroca2.post('/api/sessao/entrar', { email: emailTroca, senha: senhaTroca });
  await cTroca2.post('/api/sessao/2fa/entrar', { desafio: p7.dados.desafio, codigo: codigoDe(segredoNovo) });
  await cTroca2.post('/api/perfil/2fa/trocar/iniciar', {});
  await cTroca2.post('/api/perfil/2fa/trocar/cancelar', {});
  const p7b = await cliente(base).post('/api/sessao/entrar', { email: emailTroca, senha: senhaTroca });
  const aindaComOAtualDepoisDeCancelar = await cliente(base).post('/api/sessao/2fa/entrar', { desafio: p7b.dados.desafio, codigo: codigoDe(segredoNovo) });
  s.ok('cancelar a troca mantem o aparelho atual valendo', aindaComOAtualDepoisDeCancelar.status === 200, String(aindaComOAtualDepoisDeCancelar.status));

  /* --- Freio na SENHA: trava depois de 5 erros seguidos ---------------- */
  const emailFreioSenha = 'freio-senha@correia.adv.br';
  const senhaFreio = 'senha-correta-do-freio';
  const membroFreioSenha = (await admin.post('/api/membros', { email: emailFreioSenha, nome: 'Freio Senha', senha: senhaFreio, papel: 'atendente' })).dados;

  let travouNaSenha = null;
  for (let tentativa = 1; tentativa <= 6; tentativa += 1) {
    const r = await cliente(base).post('/api/sessao/entrar', { email: emailFreioSenha, senha: 'senha-errada-' + tentativa });
    if (r.status === 429) {
      travouNaSenha = tentativa;
      break;
    }
    s.ok(`senha errada (tentativa ${tentativa}) nao trava sozinha`, r.status === 401, String(r.status));
  }
  s.ok('a senha trava depois de 5 erros seguidos', travouNaSenha === 6, `travou na tentativa ${travouNaSenha}`);

  const comSenhaCertaTravado = await cliente(base).post('/api/sessao/entrar', { email: emailFreioSenha, senha: senhaFreio });
  s.ok('travado, nem a senha CERTA entra ate passar o tempo', comSenhaCertaTravado.status === 429, String(comSenhaCertaTravado.status));

  /* --- Freio no CODIGO DA ADESAO: trava depois de 5 erros seguidos ----- */
  const emailFreioAdesao = 'freio-adesao@correia.adv.br';
  const senhaFreioAdesao = 'senha-correta-da-adesao';
  await admin.post('/api/membros', { email: emailFreioAdesao, nome: 'Freio Adesao', senha: senhaFreioAdesao, papel: 'atendente' });
  const pFreioAdesao = await cliente(base).post('/api/sessao/entrar', { email: emailFreioAdesao, senha: senhaFreioAdesao });
  const desafioFreioAdesao = pFreioAdesao.dados.desafio;
  const segredoFreioAdesao = pFreioAdesao.dados.segredo;

  let travouNaAdesao = null;
  for (let tentativa = 1; tentativa <= 6; tentativa += 1) {
    const r = await cliente(base).post('/api/sessao/2fa/confirmar', { desafio: desafioFreioAdesao, codigo: '000000' });
    if (r.status === 429) {
      travouNaAdesao = tentativa;
      break;
    }
  }
  s.ok('o codigo da adesao trava depois de 5 erros seguidos', travouNaAdesao === 6, `travou na tentativa ${travouNaAdesao}`);

  const adesaoComCodigoCertoTravada = await cliente(base).post('/api/sessao/2fa/confirmar', {
    desafio: desafioFreioAdesao,
    codigo: codigoDe(segredoFreioAdesao),
  });
  s.ok('travado, nem o codigo CERTO da adesao entra ate passar o tempo', adesaoComCodigoCertoTravada.status === 429, String(adesaoComCodigoCertoTravada.status));

  /* Limpeza: tira os membros de teste para as suites seguintes nao contarem com eles. */
  await admin.delete(`/api/membros/${membroId}`);
  await admin.delete(`/api/membros/${membroFreioSenha.id}`);
  await admin.delete(`/api/membros/${membroTroca.id}`);
  const membrosFinal = (await admin.get('/api/membros')).dados || [];
  const membroFreioAdesaoFinal = membrosFinal.find((m) => m.usuario?.email === emailFreioAdesao);
  if (membroFreioAdesaoFinal) await admin.delete(`/api/membros/${membroFreioAdesaoFinal.id}`);
  return s;
}
