import { cliente, suite } from './apoio.js';

/**
 * A ligacao com o modelo: tempo limite, retentativa e o que a tela sabe.
 *
 * Nada disso aparece hoje, porque o escritorio ainda nao tem chave. Aparece
 * todo no primeiro dia em que tiver — e a forma de errar aqui e das piores:
 * um 429 sem retentativa deixa o cliente sem resposta e vira uma linha de log
 * que ninguem le; um 401 COM retentativa gasta o dobro para receber o mesmo
 * erro; tres tentativas seguram o cliente meio minuto a mais por nada.
 *
 * Os testes rodam contra a Anthropic de mentira (anthropic-falsa.js), com
 * roteiro escolhido por teste. Contar as batidas no servidor falso e o unico
 * jeito de afirmar "tentou duas vezes" — pelo resultado final, uma retentativa
 * que nunca acontece e uma que sempre acontece parecem iguais.
 */
export async function testarIa(baseSistema, baseAnthropic) {
  const s = suite('Ligacao com o modelo de IA');
  const c = cliente(baseSistema);
  await c.entrar();

  const falsa = cliente(baseAnthropic);
  const roteiro = (itens) => falsa.post('/__roteiro', { roteiro: itens });
  const batidas = async () => (await falsa.get('/__chamadas')).dados.total;
  /* Afirmacao de contagem tem que dizer o numero que veio: "esperava 2" sem o
     valor real transforma a proxima investigacao em adivinhacao. */
  const bateu = async (titulo, esperado) => {
    const { total, chamadas } = (await falsa.get('/__chamadas')).dados;
    return s.ok(
      titulo,
      total === esperado,
      `esperava ${esperado}, foram ${total}: ${chamadas.map((ch) => ch.sistema).join(' | ')}`,
    );
  };

  /* ---------------- Sem chave nenhuma ---------------- */

  const semChave = await c.post('/api/integracoes/ia/testar', {});
  s.ok('sem chave, o teste recusa em vez de chamar a API', semChave.dados?.ok === false);
  s.ok(
    'e diz o motivo, em vez de um erro de rede',
    /chave/i.test(semChave.dados?.erro || ''),
    semChave.dados?.erro,
  );

  await roteiro([{ status: 200 }]);
  await bateu('sem chave, nem chegou a bater na API', 0);

  /* ---------------- A chave entra ---------------- */

  await c.patch('/api/integracoes', { ia: { chaveAnthropic: 'sk-ant-de-mentira' } });
  const depoisDeSalvar = await c.get('/api/integracoes');
  s.ok('a chave salva nunca volta em claro para a tela', depoisDeSalvar.dados?.ia?.chaveAnthropic === '***');

  /* ---------------- Caminho feliz ---------------- */

  await roteiro([{ status: 200, texto: 'funcionando' }]);
  const feliz = await c.post('/api/integracoes/ia/testar', {});
  s.ok('com chave valida, o teste passa', feliz.dados?.ok === true, JSON.stringify(feliz.dados));
  s.ok('e devolve o que o modelo respondeu', feliz.dados?.resposta === 'funcionando');
  await bateu('uma resposta boa custa uma chamada so', 1);

  const comTeste = await c.get('/api/integracoes');
  s.ok('o resultado do teste fica guardado', Boolean(comTeste.dados?.ia?.ultimoTeste));
  s.ok('e guardado como aprovado', comTeste.dados?.ia?.ultimoTeste?.ok === true);
  s.ok('com a data, para a tela poder dizer quando foi', Boolean(comTeste.dados?.ia?.ultimoTeste?.quando));

  /* ---------------- 429: tenta de novo ---------------- */

  await roteiro([{ status: 429, mensagem: 'rate limit' }, { status: 200, texto: 'funcionando' }]);
  const limite = await c.post('/api/integracoes/ia/testar', {});
  s.ok('um 429 seguido de sucesso termina bem', limite.dados?.ok === true, JSON.stringify(limite.dados));
  await bateu('porque tentou exatamente duas vezes', 2);

  /* ---------------- 500: tambem tenta de novo ---------------- */

  await roteiro([{ status: 500, mensagem: 'sobrecarga' }, { status: 200, texto: 'funcionando' }]);
  const servidor = await c.post('/api/integracoes/ia/testar', {});
  s.ok('problema do lado deles (500) tambem merece segunda chance', servidor.dados?.ok === true);
  await bateu('e tambem em duas chamadas', 2);

  /* ---------------- 429 sempre: para na segunda ---------------- */

  await roteiro([{ status: 429, mensagem: 'rate limit' }]);
  const insistente = await c.post('/api/integracoes/ia/testar', {});
  s.ok('429 que nao passa termina em erro', insistente.dados?.ok === false);
  await bateu('e para na SEGUNDA tentativa, nao na terceira', 2);
  s.ok('o erro que chega e o da API, nao um generico', /rate limit/i.test(insistente.dados?.erro || ''), insistente.dados?.erro);

  /* ---------------- 401: NAO tenta de novo ---------------- */

  await roteiro([{ status: 401, mensagem: 'invalid x-api-key' }]);
  const chaveRuim = await c.post('/api/integracoes/ia/testar', {});
  s.ok('chave errada da erro', chaveRuim.dados?.ok === false);
  await bateu('e bate UMA vez so: chave errada nao vira certa na segunda', 1);

  /* ---------------- 400: tambem nao ---------------- */

  await roteiro([{ status: 400, mensagem: 'corpo invalido' }]);
  await c.post('/api/integracoes/ia/testar', {});
  await bateu('400 tambem nao se repete', 1);

  /* ---------------- Tempo limite ---------------- */

  /* CORREIA_IA_TEMPO_LIMITE esta em 800ms no processo de teste. A demora de
     3s abaixo garante o estouro sem depender da velocidade da maquina. */
  await roteiro([{ status: 200, demora: 3000 }, { status: 200, texto: 'funcionando' }]);
  const lenta = await c.post('/api/integracoes/ia/testar', {});
  s.ok('API travada termina em erro, e nao pendurada para sempre', lenta.dados?.ok === true || lenta.dados?.ok === false);
  await bateu('e a segunda tentativa aconteceu', 2);

  await roteiro([{ status: 200, demora: 3000 }]);
  const travada = await c.post('/api/integracoes/ia/testar', {});
  s.ok('travada nas duas, o teste falha com mensagem de tempo', travada.dados?.ok === false);
  s.ok(
    'e a mensagem diz que foi tempo esgotado, nao "erro desconhecido"',
    /nao respondeu em/i.test(travada.dados?.erro || ''),
    travada.dados?.erro,
  );

  const depoisDaFalha = await c.get('/api/integracoes');
  s.ok('a falha tambem fica guardada', depoisDaFalha.dados?.ia?.ultimoTeste?.ok === false);

  /* ---------------- Trocar a chave apaga o veredito ---------------- */

  await c.patch('/api/integracoes', { ia: { chaveAnthropic: 'sk-ant-outra' } });
  const depoisDaTroca = await c.get('/api/integracoes');
  s.ok(
    'chave nova apaga o resultado da anterior',
    !depoisDaTroca.dados?.ia?.ultimoTeste,
    JSON.stringify(depoisDaTroca.dados?.ia?.ultimoTeste),
  );

  /* ---------------- Campo em branco mantem a chave ---------------- */

  await c.patch('/api/integracoes', { ia: { chaveAnthropic: '' } });
  await roteiro([{ status: 200, texto: 'funcionando' }]);
  const aindaLigada = await c.post('/api/integracoes/ia/testar', {});
  s.ok('salvar com o campo em branco NAO apaga a chave', aindaLigada.dados?.ok === true);

  /* ---------------- Remover de proposito ---------------- */

  await c.patch('/api/integracoes', { ia: { chaveAnthropic: null, chaveOpenai: null } });
  const removida = await c.post('/api/integracoes/ia/testar', {});
  s.ok('remover de proposito volta ao roteiro por regras', removida.dados?.ok === false);
  s.ok('e a mensagem fala de chave, nao de rede', /chave/i.test(removida.dados?.erro || ''), removida.dados?.erro);

  return s;
}
