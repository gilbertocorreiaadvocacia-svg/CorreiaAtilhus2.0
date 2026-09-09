import { cliente, suite } from './apoio.js';

/**
 * Os agentes de IA e a base de conhecimento.
 *
 * O que se testa aqui e QUAIS FERRAMENTAS o agente recebe, porque e essa lista
 * que decide o que ele consegue fazer. Ela nao e configurada: sai do proprio
 * prompt, pelas mencoes escritas nele. Mexer no catalogo de mencoes ou na
 * montagem das ferramentas tira poder de um agente em producao sem erro
 * nenhum na tela — o agente simplesmente para de conseguir mudar status, ou
 * de consultar a base, e responde de cabeca.
 *
 * A base de conhecimento tem uma regra propria e ela e o centro deste arquivo:
 * vincular a base na tela basta. Antes era preciso ALEM disso escrever
 * @biblioteca no prompt, e quem esquecia ficava com a base vinculada e muda —
 * era o caso da Recepcao, o agente que fala com todo cliente primeiro.
 */
export async function testarAgentes({ base }) {
  const s = suite('Agentes e base de conhecimento');
  const api = cliente(base);
  await api.entrar();

  const agentes = (await api.get('/api/agentes')).dados || [];
  if (!s.ok('a base semeada traz agentes', agentes.length > 0)) return s;

  const bases = (await api.get('/api/conhecimento')).dados || [];
  if (!s.ok('a base semeada traz conhecimento', bases.length > 0)) return s;

  /* ---------------- A base vinculada e sempre alcancavel ---------------- */

  const comBase = agentes.filter((a) => (a.conhecimentoIds || []).length > 0);
  s.ok('ha agente com base de conhecimento vinculada', comBase.length > 0);

  s.ok(
    'todo agente com base vinculada recebe a ferramenta de consulta',
    comBase.every((a) => (a.ferramentas || []).includes('consultar_biblioteca')),
    comBase
      .filter((a) => !(a.ferramentas || []).includes('consultar_biblioteca'))
      .map((a) => a.nome)
      .join(', '),
  );

  /*
   * O caso que estava quebrado: base vinculada e NENHUM @biblioteca escrito.
   * Se este teste falhar, a armadilha voltou — base ligada na tela, agente
   * respondendo de cabeca sobre requisito de beneficio.
   */
  const semMencao = comBase.filter((a) => !/@biblioteca/.test(a.prompt || ''));
  s.ok('ha agente com base vinculada e sem @biblioteca escrito no prompt', semMencao.length > 0);
  s.ok(
    'vincular a base basta: nao e preciso escrever @biblioteca no prompt',
    semMencao.every((a) => (a.ferramentas || []).includes('consultar_biblioteca')),
    semMencao.map((a) => `${a.nome}: ${(a.ferramentas || []).join(',')}`).join(' | '),
  );

  /* O contrario tambem vale: sem base vinculada, nao ha o que consultar. */
  const criado = (await api.post('/api/agentes', { nome: 'Teste Sem Base' })).dados;
  if (criado?.id) {
    const lista = (await api.get('/api/agentes')).dados || [];
    const semBase = lista.find((a) => a.id === criado.id);
    s.ok(
      'agente sem base vinculada nao recebe a ferramenta de consulta',
      !(semBase?.ferramentas || []).includes('consultar_biblioteca'),
      (semBase?.ferramentas || []).join(', '),
    );
    await api.delete(`/api/agentes/${criado.id}`);
  }

  /* ---------------- As outras ferramentas continuam vindo do prompt ------- */

  /*
   * A biblioteca e a UNICA excecao. Para todo o resto, a mencao escrita e o
   * que da a ferramenta — e isso e proposital: sem @status no prompt, o agente
   * nao mexe no funil do escritorio.
   */
  const comStatus = agentes.filter((a) => /@status/.test(a.prompt || ''));
  const semStatus = agentes.filter((a) => !/@status/.test(a.prompt || ''));
  s.ok('agente com @status no prompt recebe alterar_status',
    comStatus.every((a) => (a.ferramentas || []).includes('alterar_status')));
  s.ok('agente sem @status no prompt NAO recebe alterar_status',
    semStatus.every((a) => !(a.ferramentas || []).includes('alterar_status')),
    semStatus.filter((a) => (a.ferramentas || []).includes('alterar_status')).map((a) => a.nome).join(', '));

  /* ---------------- O vinculo agente <-> base sobrevive a edicao --------- */

  const alvo = comBase[0];
  const original = [...(alvo.conhecimentoIds || [])];
  await api.patch(`/api/agentes/${alvo.id}`, { conhecimentoIds: [] });
  const semVinculo = ((await api.get('/api/agentes')).dados || []).find((a) => a.id === alvo.id);
  s.ok('tirar a base tira tambem a ferramenta',
    !(semVinculo?.ferramentas || []).includes('consultar_biblioteca') || /@biblioteca/.test(alvo.prompt || ''));

  await api.patch(`/api/agentes/${alvo.id}`, { conhecimentoIds: original });
  const restaurado = ((await api.get('/api/agentes')).dados || []).find((a) => a.id === alvo.id);
  s.ok('devolver a base devolve a ferramenta',
    (restaurado?.ferramentas || []).includes('consultar_biblioteca'));
  s.ok('o vinculo volta exatamente como estava',
    JSON.stringify(restaurado?.conhecimentoIds) === JSON.stringify(original));

  return s;
}
