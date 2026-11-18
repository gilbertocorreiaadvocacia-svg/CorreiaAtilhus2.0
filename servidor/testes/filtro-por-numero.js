import { cliente, suite } from './apoio.js';

/**
 * Filtrar a fila por NUMERO DE WHATSAPP, e junto com os outros recortes.
 *
 * Pedido do escritorio em 18/11/2026: "um filtro por numero de telefone,
 * porque em breve vamos colocar mais de um; filtrar por responsavel, ou seja,
 * Rafael, Alice, Leticia; e acao, para puxar a conversa que esta etiquetada
 * auxilio acidente, trabalhista".
 *
 * Os tres recortes ja existiam no servidor. O que NAO existia era prova de que
 * eles funcionam quando ha MAIS DE UM NUMERO — e hoje o escritorio tem um so,
 * entao o dia em que o segundo entrar e o dia em que isto seria descoberto no
 * atendimento, com a fila de um numero aparecendo dentro do outro.
 *
 * Por que este teste e sobre o numero, e nao sobre a tela: a escolha do numero
 * mora na barra de cima (web/js/app.js, seletorDeContexto) e vira `conexao` na
 * consulta. Se o servidor ignorar o parametro, ou se ele brigar com o filtro
 * de responsavel e o de tipo de caso, a tela nao tem como perceber: ela
 * desenha o que vier.
 *
 * O que fica travado:
 *
 *  - cada numero so mostra as conversas dele;
 *  - sem numero escolhido ("Todos os numeros"), vem as dos dois;
 *  - os tres filtros valem JUNTOS, que e o pedido inteiro numa consulta so
 *    ("as conversas de auxilio-acidente da Alice, no numero do trabalhista");
 *  - o TOTAL acompanha o recorte. Numero que ignora o filtro faz a fila dizer
 *    40 e mostrar 3, e foi assim que o Kanban ja enganou a equipe antes.
 */
export async function testarFiltroPorNumero({ base }) {
  const s = suite('Filtrar a fila por numero, responsavel e tipo de caso');
  const api = cliente(base);
  await api.entrar();

  /* Dois numeros, que e o cenario que ainda nao existe no escritorio. */
  const marca = String(Date.now()).slice(-6);
  const umId = (await api.post('/api/conexoes', { nome: `Comercial ${marca}`, tipo: 'qrcode' })).dados?.id;
  const doisId = (await api.post('/api/conexoes', { nome: `Trabalhista ${marca}`, tipo: 'qrcode' })).dados?.id;
  if (!s.ok('os dois numeros existem', Boolean(umId && doisId), JSON.stringify({ umId, doisId }))) return s;

  const casos = ((await api.get('/api/etiquetas')).dados || []).filter((e) => e.tipo === 'caso');
  const acidente = casos.find((e) => e.caso === 'auxilio_acidente');
  const trabalhista = casos.find((e) => e.caso === 'trabalhista');
  if (!s.ok('os tipos de caso do pedido existem', Boolean(acidente && trabalhista), JSON.stringify(casos.map((c) => c.caso)))) return s;

  /* Duas pessoas da equipe: o recorte e "as da Alice", nao "as de alguem". */
  const alice = (await api.post('/api/membros', { nome: `Alice ${marca}`, email: `alice.${marca}@correia.adv.br`, senha: 'numero2026', papel: 'atendente' })).dados;
  const rafael = (await api.post('/api/membros', { nome: `Rafael ${marca}`, email: `rafael.${marca}@correia.adv.br`, senha: 'numero2026', papel: 'atendente' })).dados;
  if (!s.ok('as duas pessoas existem', Boolean(alice?.id && rafael?.id), JSON.stringify({ alice: alice?.id, rafael: rafael?.id }))) return s;

  const criadas = [];
  let sequencia = 0;
  const criar = async (nome, conexaoId, dono, caso) => {
    sequencia += 1;
    const contato = (await api.post('/api/contatos', { conexaoId, telefone: `3391${marca}${sequencia}`, nome })).dados;
    criadas.push(contato.id);
    await api.patch(`/api/contatos/${contato.id}`, {
      etiquetas: [caso.id],
      responsavel: { tipo: 'membro', id: dono.id },
    });
    return contato.id;
  };

  const buscar = async (qs) => (await api.get(`/api/contatos?aba=todas&limite=400${qs}`)).dados;
  const idsDe = (r) => (r?.contatos || []).map((c) => c.id);

  try {
    /*
     * O cruzamento e de proposito: cada combinacao aparece uma vez, entao
     * nenhum filtro pode "acertar" por sorte. Se o servidor ignorasse o
     * numero, o teste do responsavel ainda passaria -- por isso cada conversa
     * difere das outras em exatamente um eixo.
     */
    const aliceAcidenteNoUm = await criar('Alice acidente no 1', umId, alice, acidente);
    const aliceTrabalhistaNoUm = await criar('Alice trabalhista no 1', umId, alice, trabalhista);
    const rafaelAcidenteNoUm = await criar('Rafael acidente no 1', umId, rafael, acidente);
    const aliceAcidenteNoDois = await criar('Alice acidente no 2', doisId, alice, acidente);
    const rafaelTrabalhistaNoDois = await criar('Rafael trabalhista no 2', doisId, rafael, trabalhista);

    const doUm = [aliceAcidenteNoUm, aliceTrabalhistaNoUm, rafaelAcidenteNoUm];
    const doDois = [aliceAcidenteNoDois, rafaelTrabalhistaNoDois];

    /* --- Um numero de cada vez ----------------------------------------- */
    const soUm = await buscar(`&conexao=${umId}`);
    const idsUm = idsDe(soUm);
    s.ok('o numero 1 traz as tres conversas dele', doUm.every((id) => idsUm.includes(id)), JSON.stringify(idsUm.length));
    s.ok(
      'e NAO traz nenhuma do numero 2 -- que e o erro que so apareceria com o segundo numero no ar',
      doDois.every((id) => !idsUm.includes(id)),
      JSON.stringify(doDois.filter((id) => idsUm.includes(id))),
    );

    const soDois = await buscar(`&conexao=${doisId}`);
    const idsDois = idsDe(soDois);
    s.ok('o numero 2 traz as duas dele', doDois.every((id) => idsDois.includes(id)), JSON.stringify(idsDois.length));
    s.ok('e nenhuma do numero 1', doUm.every((id) => !idsDois.includes(id)), JSON.stringify(doUm.filter((id) => idsDois.includes(id))));

    /* --- "Todos os numeros" -------------------------------------------- */
    const todos = idsDe(await buscar(''));
    s.ok(
      'sem numero escolhido, as dos dois aparecem',
      [...doUm, ...doDois].every((id) => todos.includes(id)),
      JSON.stringify([...doUm, ...doDois].filter((id) => !todos.includes(id))),
    );

    /* --- Os tres recortes juntos, que e o pedido inteiro ---------------- */
    const aliceNoUm = idsDe(await buscar(`&conexao=${umId}&responsavel=${alice.id}`));
    s.ok(
      'numero + responsavel: so as da Alice no numero 1',
      aliceNoUm.includes(aliceAcidenteNoUm) &&
        aliceNoUm.includes(aliceTrabalhistaNoUm) &&
        !aliceNoUm.includes(rafaelAcidenteNoUm) &&
        !aliceNoUm.includes(aliceAcidenteNoDois),
      JSON.stringify(aliceNoUm),
    );

    const acidenteDaAliceNoUm = await buscar(`&conexao=${umId}&responsavel=${alice.id}&caso=auxilio_acidente`);
    const idsTres = idsDe(acidenteDaAliceNoUm);
    s.ok(
      'numero + responsavel + tipo de caso: sobra exatamente uma',
      idsTres.length === 1 && idsTres[0] === aliceAcidenteNoUm,
      JSON.stringify(idsTres),
    );
    /*
     * O total e contado ANTES do corte do limite, e e ele que a fila escreve
     * no alto. Um total que ignorasse o recorte faria a equipe achar que o
     * filtro perdeu conversa.
     */
    s.ok(
      'e o total acompanha o recorte, em vez de contar a fila inteira',
      acidenteDaAliceNoUm?.total === 1,
      JSON.stringify(acidenteDaAliceNoUm?.total),
    );

    /* --- Tipo de caso sozinho, atravessando os dois numeros ------------- */
    const soTrabalhista = idsDe(await buscar('&caso=trabalhista'));
    s.ok(
      'tipo de caso sem numero atravessa os dois, como o escritorio pediu',
      soTrabalhista.includes(aliceTrabalhistaNoUm) && soTrabalhista.includes(rafaelTrabalhistaNoDois),
      JSON.stringify(soTrabalhista),
    );
    s.ok(
      'e nao traz os de auxilio-acidente',
      !soTrabalhista.includes(aliceAcidenteNoUm) && !soTrabalhista.includes(rafaelAcidenteNoUm),
      JSON.stringify(soTrabalhista),
    );
  } finally {
    for (const id of criadas) await api.delete(`/api/contatos/${id}`);
    await api.delete(`/api/conexoes/${umId}`);
    await api.delete(`/api/conexoes/${doisId}`);
  }
  return s;
}
