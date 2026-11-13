import { cliente, suite } from './apoio.js';

/**
 * Filtrar a fila por TIPO DE CASO.
 *
 * Pedido do escritorio em 13/11/2026, vindo de quem usa: "filtrar so
 * auxilio-acidente, filtrar so o trabalhista, filtrar so o salario-maternidade".
 *
 * O tipo de caso E uma etiqueta (marcada com tipo: 'caso', ver nucleo/casos.js),
 * mas no filtro geral de etiquetas ele ficava afogado no meio de todas as
 * outras. Ganhou parametro proprio, e este teste trava o que o diferencia:
 *
 *  - filtra pela CHAVE do caso ('auxilio_acidente'), e nao pelo id da etiqueta.
 *    A chave e a mesma em todo escritorio e o id nao, entao um link filtrado
 *    continua valendo em outro workspace;
 *  - convive com os outros filtros, em vez de disputar o mesmo campo: da para
 *    pedir "so o trabalhista E so os meus" na mesma consulta;
 *  - o TOTAL e as contagens por coluna acompanham o recorte. E o que o Kanban
 *    desenha no alto de cada coluna; se o numero ignorasse o filtro, a coluna
 *    diria 40 e mostraria 3.
 */
export async function testarFiltroPorCaso({ base }) {
  const s = suite('Filtrar a fila por tipo de caso');
  const api = cliente(base);
  await api.entrar();

  const simulador = ((await api.get('/api/conexoes')).dados || []).find((c) => c.tipo === 'simulador');
  if (!s.ok('ha conexao de simulador', Boolean(simulador))) return s;

  const etiquetas = (await api.get('/api/etiquetas')).dados || [];
  const casos = etiquetas.filter((e) => e.tipo === 'caso');
  const acidente = casos.find((e) => e.caso === 'auxilio_acidente');
  const trabalhista = casos.find((e) => e.caso === 'trabalhista');
  const maternidade = casos.find((e) => e.caso === 'maternidade');
  if (!s.ok('o escritorio tem os tipos de caso do pedido', Boolean(acidente && trabalhista && maternidade), JSON.stringify(casos.map((c) => c.caso)))) {
    return s;
  }

  /* Uma etiqueta comum, para provar que o filtro de caso nao a confunde com um
     tipo de caso — e para cruzar os dois filtros no fim. */
  const comum = (await api.post('/api/etiquetas', { nome: `Urgente (teste ${Date.now()})`, cor: 'var(--alerta)' })).dados;

  const criadas = [];
  const criar = async (nome, etiquetasDoCaso) => {
    const sufixo = String(Date.now()).slice(-5) + criadas.length;
    const contato = (await api.post('/api/contatos', { conexaoId: simulador.id, telefone: `3295${sufixo}0`, nome })).dados;
    criadas.push(contato.id);
    await api.patch(`/api/contatos/${contato.id}`, { etiquetas: etiquetasDoCaso });
    return contato.id;
  };

  try {
    const doAcidente = await criar('Caso de Acidente', [acidente.id]);
    const doTrabalhista = await criar('Caso Trabalhista', [trabalhista.id, comum.id]);
    const daMaternidade = await criar('Caso de Maternidade', [maternidade.id]);
    const semCaso = await criar('Sem tipo de caso', [comum.id]);

    const buscar = async (qs) => (await api.get(`/api/contatos?aba=todas&limite=400${qs}`)).dados;
    const idsDe = (r) => (r?.contatos || []).map((c) => c.id);

    /* --- Um caso de cada vez ------------------------------------------- */
    const soAcidente = await buscar('&caso=auxilio_acidente');
    s.ok(
      'filtrar por auxilio-acidente traz o dele e exclui os outros',
      idsDe(soAcidente).includes(doAcidente) && !idsDe(soAcidente).includes(doTrabalhista) && !idsDe(soAcidente).includes(daMaternidade),
      JSON.stringify(idsDe(soAcidente).length),
    );

    const soTrabalhista = await buscar('&caso=trabalhista');
    s.ok(
      'filtrar por trabalhista traz o dele',
      idsDe(soTrabalhista).includes(doTrabalhista) && !idsDe(soTrabalhista).includes(doAcidente),
      JSON.stringify(idsDe(soTrabalhista).length),
    );

    const soMaternidade = await buscar('&caso=maternidade');
    s.ok(
      'filtrar por salario-maternidade traz o dele',
      idsDe(soMaternidade).includes(daMaternidade) && !idsDe(soMaternidade).includes(doTrabalhista),
      JSON.stringify(idsDe(soMaternidade).length),
    );

    s.ok('conversa sem tipo de caso fica de fora de todos', ![soAcidente, soTrabalhista, soMaternidade].some((r) => idsDe(r).includes(semCaso)));

    /* --- A chave, e nao o id ------------------------------------------- */
    const peloId = await buscar(`&caso=${acidente.id}`);
    s.ok(
      'o filtro e pela chave do caso: passar o id da etiqueta nao acha nada',
      !idsDe(peloId).includes(doAcidente),
      `${idsDe(peloId).length} achados com o id`,
    );

    /* --- Convive com os outros ----------------------------------------- */
    const cruzado = await buscar(`&caso=trabalhista&etiqueta=${comum.id}`);
    s.ok(
      'caso e etiqueta valem juntos, cada um no seu campo',
      idsDe(cruzado).includes(doTrabalhista) && !idsDe(cruzado).includes(semCaso) && !idsDe(cruzado).includes(doAcidente),
      JSON.stringify(idsDe(cruzado).length),
    );

    /* --- O total e as contagens do Kanban acompanham -------------------- */
    s.ok(
      'o total responde ao recorte, e nao a fila inteira',
      soAcidente?.total === idsDe(soAcidente).length && soAcidente.total < (await buscar('')).total,
      JSON.stringify({ comFiltro: soAcidente?.total, semFiltro: (await buscar('')).total }),
    );
    const somaDasColunas = Object.values(soAcidente?.porStatus || {}).reduce((a, b) => a + b, 0);
    s.ok(
      'e as contagens por coluna do Kanban somam o mesmo que o total',
      somaDasColunas === soAcidente?.total,
      JSON.stringify({ colunas: somaDasColunas, total: soAcidente?.total }),
    );

    /* --- Caso que existe no sistema mas ninguem tem --------------------- */
    const vazio = await buscar('&caso=civel');
    s.ok('caso sem nenhuma conversa devolve lista vazia, e nao a fila toda', !idsDe(vazio).some((id) => criadas.includes(id)), String(vazio?.total));
  } finally {
    for (const id of criadas) await api.delete(`/api/contatos/${id}`);
  }
  return s;
}
