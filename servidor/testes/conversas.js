import { cliente, esperar, suite } from './apoio.js';

/**
 * A rede de protecao do modulo de Conversas.
 *
 * Conversas e a tela que o escritorio passa o dia inteiro dentro, e ate aqui
 * era a unica parte grande do sistema sem teste nenhum. Isso e um problema
 * especifico: a classificacao das abas nao mora num campo do banco, ela e
 * DEDUZIDA a cada leitura por abaDe(), a partir de quatro campos diferentes
 * (estado, grupo, responsavel, aceitoPor). Quem mexe em qualquer um desses
 * quatro pode mudar em que aba uma conversa aparece sem nunca ter aberto o
 * arquivo de atendimento, e o sintoma no escritorio nao e um erro na tela: e
 * uma conversa de cliente que sumiu da fila de quem devia responder.
 *
 * Por isso o teste aqui nao afirma "a funcao devolve tal string". Ele afirma
 * as coisas que precisam continuar verdadeiras para a fila funcionar:
 *
 *   - cada conversa cai em UMA aba, nunca em duas e nunca em nenhuma;
 *   - arquivado ganha de todo o resto;
 *   - reabrir devolve a conversa para a fila de onde ela saiu;
 *   - a busca por nome nao devolve a base inteira;
 *   - o filtro combina com a aba em vez de substitui-la.
 *
 * Duas afirmacoes abaixo travam um comportamento que eu considero ERRADO e
 * pretendo corrigir (o contador que ignora o filtro, e a aba Grupos que e
 * fachada). Elas estao marcadas com CARACTERIZACAO: existem para a correcao
 * ser deliberada. No dia em que o conserto entrar, elas falham, e falhar ali
 * e o aviso de "voce mudou isto de proposito, atualize o teste" — nao um bug.
 */

/* Faixa propria de numeros, para nao esbarrar na base semeada nem nas outras
   suites, que usam 55819777xxxx. */
const TELEFONE = (sufixo) => `558191000${String(sufixo).padStart(4, '0')}`;

const ABAS = ['ia', 'ativos', 'pendentes', 'grupos', 'arquivados'];

export async function testarConversas({ base }) {
  const s = suite('Conversas');
  const api = cliente(base);
  await api.entrar();

  const conexoes = (await api.get('/api/conexoes')).dados || [];
  const conexao = conexoes.find((c) => c.tipo === 'simulador') || conexoes[0];
  if (!s.ok('ha uma conexao para pendurar as conversas de teste', Boolean(conexao))) return s;

  const agentes = (await api.get('/api/agentes')).dados || [];
  const agenteId = agentes[0]?.id || 'agt-inexistente';

  /** Cria uma conversa limpa. Sem mensagem: quem precisa de mensagem manda uma. */
  const criar = async (sufixo, nome) =>
    (await api.post('/api/contatos', { conexaoId: conexao.id, telefone: TELEFONE(sufixo), nome })).dados;

  /** Em que abas o servidor diz que esta conversa aparece. */
  const abasDe = async (id) => {
    const achadas = [];
    for (const aba of ABAS) {
      const lista = (await api.get(`/api/contatos?aba=${aba}&limite=1000`)).dados?.contatos || [];
      if (lista.some((c) => c.id === id)) achadas.push(aba);
    }
    return achadas;
  };

  /* ---------------- Classificacao ---------------- */

  const pendente = await criar(1, 'Teste Pendente');
  await api.patch(`/api/contatos/${pendente.id}`, { responsavel: null });

  const naIa = await criar(2, 'Teste IA');
  await api.patch(`/api/contatos/${naIa.id}`, { responsavel: { tipo: 'agente', id: agenteId } });

  const ativo = await criar(3, 'Teste Ativo');
  await api.post(`/api/contatos/${ativo.id}/aceitar`);

  /*
   * Sem responsavel de proposito, e nao por descuido.
   *
   * A conexao nasce com um agente como responsavel padrao, entao TODA conversa
   * nova comeca em IA — Pendentes so enche quando alguem tira o responsavel ou
   * o agente devolve o atendimento. Sem esta linha o cenario "arquivada sem
   * dono" nao existiria, e o teste de reabrir estaria medindo o caso do agente
   * pela segunda vez.
   */
  const arquivado = await criar(4, 'Teste Arquivado');
  await api.patch(`/api/contatos/${arquivado.id}`, { responsavel: null });
  await api.post(`/api/contatos/${arquivado.id}/arquivar`, { arquivar: true });

  const esperado = [
    ['sem responsavel cai em Pendentes', pendente, 'pendentes'],
    ['com agente cai em IA', naIa, 'ia'],
    ['aceita por uma pessoa cai em Ativos', ativo, 'ativos'],
    ['arquivada cai em Arquivados', arquivado, 'arquivados'],
  ];

  for (const [titulo, contato, aba] of esperado) {
    const achadas = await abasDe(contato.id);
    s.ok(titulo, achadas.length === 1 && achadas[0] === aba, `apareceu em: ${achadas.join(', ') || 'nenhuma aba'}`);
  }

  /*
   * A soma das cinco abas tem de dar a lista inteira.
   *
   * E o teste que pega o furo silencioso: uma conversa que nao se encaixa em
   * regra nenhuma nao aparece em aba nenhuma, e ninguem descobre olhando a
   * tela — a fila so fica menor do que deveria.
   */
  const todas = (await api.get('/api/contatos?aba=todas&limite=1000')).dados?.contatos || [];
  let somaDasAbas = 0;
  for (const aba of ABAS) {
    somaDasAbas += ((await api.get(`/api/contatos?aba=${aba}&limite=1000`)).dados?.contatos || []).length;
  }
  s.ok(
    'toda conversa aparece em exatamente uma aba',
    somaDasAbas === todas.length,
    `soma das abas ${somaDasAbas}, lista inteira ${todas.length}`,
  );

  /* ---------------- Precedencia e volta ---------------- */

  await api.post(`/api/contatos/${naIa.id}/arquivar`, { arquivar: true });
  s.ok(
    'arquivar ganha do agente: sai de IA e vai para Arquivados',
    (await abasDe(naIa.id)).join() === 'arquivados',
  );

  await api.post(`/api/contatos/${naIa.id}/arquivar`, { arquivar: false });
  s.ok(
    'reabrir devolve a conversa do agente para IA, e nao para Pendentes',
    (await abasDe(naIa.id)).join() === 'ia',
  );

  await api.post(`/api/contatos/${arquivado.id}/arquivar`, { arquivar: false });
  s.ok(
    'reabrir conversa sem responsavel devolve para Pendentes',
    (await abasDe(arquivado.id)).join() === 'pendentes',
  );

  /*
   * Arquivada volta sozinha quando o cliente escreve.
   *
   * E a regra que sustenta a decisao de "Concluido = Arquivado": um
   * atendimento dado por encerrado reabre sozinho se o cliente voltar a
   * falar. Se isso parar de valer, cliente que responde depois do fim do
   * atendimento cai num silencio que ninguem ve.
   */
  const voltou = await criar(5, 'Teste Reabre');
  await api.patch(`/api/contatos/${voltou.id}`, { responsavel: null });
  await api.post(`/api/contatos/${voltou.id}/arquivar`, { arquivar: true });
  await api.post('/api/simulador/mensagem', {
    conexaoId: conexao.id,
    telefone: TELEFONE(5),
    nome: 'Teste Reabre',
    conteudo: 'voltei para perguntar mais uma coisa',
  });
  await esperar(1200);
  s.ok(
    'conversa arquivada reabre quando o cliente escreve de novo',
    (await abasDe(voltou.id)).join() === 'pendentes',
  );

  /* ---------------- Busca ---------------- */

  /*
   * A guarda dos digitos.
   *
   * Procurar por nome tirava os digitos do termo e sobrava string vazia;
   * includes(vazio) e sempre verdadeiro, entao a busca por nome devolvia a
   * base inteira. Passava despercebido porque a tela ficava cheia, e nao
   * vazia — parecia que a busca so nao tinha filtrado ainda.
   */
  const porNome = (await api.get('/api/contatos?aba=todas&busca=Teste%20Pendente&limite=1000')).dados?.contatos || [];
  s.ok('busca por nome nao devolve a base inteira', porNome.length < todas.length && porNome.length > 0,
    `${porNome.length} de ${todas.length}`);
  s.ok('busca por nome acha quem tem o nome', porNome.some((c) => c.id === pendente.id));

  const porNumero = (await api.get(`/api/contatos?aba=todas&busca=${TELEFONE(1)}&limite=1000`)).dados?.contatos || [];
  s.ok('busca por numero acha pelo telefone', porNumero.some((c) => c.id === pendente.id));

  const semNada = (await api.get('/api/contatos?aba=todas&busca=zzzznaoexistezzzz&limite=1000')).dados?.contatos || [];
  s.ok('busca sem resultado devolve lista vazia', semNada.length === 0);

  /* ---------------- Filtros ---------------- */

  await api.patch(`/api/contatos/${pendente.id}`, { etiquetas: ['etq-teste-conversas'] });
  const porEtiqueta = (await api.get('/api/contatos?aba=todas&etiqueta=etq-teste-conversas&limite=1000')).dados?.contatos || [];
  s.ok('filtro por etiqueta devolve so quem tem a etiqueta',
    porEtiqueta.length === 1 && porEtiqueta[0].id === pendente.id);

  /* O filtro tem de COMBINAR com a aba, nao substitui-la: a etiqueta esta numa
     conversa pendente, entao ela nao pode aparecer filtrando dentro de Ativos. */
  const etiquetaEmAtivos = (await api.get('/api/contatos?aba=ativos&etiqueta=etq-teste-conversas&limite=1000')).dados?.contatos || [];
  s.ok('filtro e aba se somam, um nao anula o outro', etiquetaEmAtivos.length === 0);

  const semResponsavel = (await api.get('/api/contatos?aba=todas&responsavel=nenhum&limite=1000')).dados?.contatos || [];
  s.ok('filtro responsavel=nenhum so traz conversa sem dono',
    semResponsavel.every((c) => !c.responsavel));

  /* Conversa criada pela tela nunca teve mensagem. O filtro existe para o
     kanban e o funil nao contarem cadastro de agenda como atendimento. */
  const comMensagem = (await api.get('/api/contatos?aba=todas&comMensagem=true&limite=1000')).dados?.contatos || [];
  s.ok('comMensagem=true exclui quem nunca trocou mensagem',
    comMensagem.every((c) => c.ultimaMensagemEm) && !comMensagem.some((c) => c.id === pendente.id));

  /* ---------------- Total x limite ---------------- */

  /* Contado agora, e nao la em cima: entre uma coisa e outra o teste criou
     mais conversas, e comparar com o numero velho reprovaria por engano. */
  const quantasExistem = ((await api.get('/api/contatos?aba=todas&limite=1000')).dados?.contatos || []).length;
  const cortada = (await api.get('/api/contatos?aba=todas&limite=2')).dados;
  s.ok('o limite corta a lista', (cortada?.contatos || []).length <= 2);
  s.ok('o total continua contando tudo, e nao so o que coube no limite',
    cortada?.total === quantasExistem, `total ${cortada?.total}, esperado ${quantasExistem}`);

  /* ---------------- Caracterizacoes (comportamento que vou corrigir) -------- */

  /*
   * CARACTERIZACAO 1 - o contador ignora o filtro.
   *
   * As contagens das abas saem de contagensPorAba(), que le o workspace
   * inteiro e nao enxerga busca, etiqueta, status nem modo foco. Na tela isso
   * aparece como aba escrita "12" mostrando 3 linhas. Vou corrigir na fase da
   * lista; ate la, o teste registra o que o sistema faz hoje.
   */
  const semBusca = (await api.get('/api/contatos?aba=todas&limite=1')).dados?.contagens;
  const comBusca = (await api.get('/api/contatos?aba=todas&busca=Teste%20Pendente&limite=1')).dados?.contagens;
  s.ok('CARACTERIZACAO: hoje o contador da aba ignora a busca',
    JSON.stringify(semBusca) === JSON.stringify(comBusca),
    'se falhou, o contador passou a respeitar o filtro — atualize este teste');

  /*
   * CARACTERIZACAO 2 - a aba Grupos e fachada.
   *
   * Nenhum lugar do sistema escreve contato.grupo, e o driver de QR Code
   * descarta mensagem de grupo de proposito. Entao a aba existe, tem contador,
   * e o contador e sempre zero. Fica registrado para a decisao de implementar
   * ou remover ser tomada de olho aberto.
   */
  const contagens = (await api.get('/api/contatos?aba=todas&limite=1')).dados?.contagens || {};
  s.ok('CARACTERIZACAO: a aba Grupos esta sempre vazia (nada escreve contato.grupo)',
    contagens.grupos === 0, `grupos = ${contagens.grupos}`);

  /* ---------------- Contadores batem com as listas ---------------- */

  /*
   * Fora do filtro, contador e lista tem de concordar. Este teste continua
   * valendo depois da correcao do contador — e o piso que a correcao nao pode
   * quebrar.
   */
  for (const aba of ['ia', 'ativos', 'pendentes', 'arquivados']) {
    const lista = (await api.get(`/api/contatos?aba=${aba}&limite=1000`)).dados?.contatos || [];
    s.ok(`sem filtro, o contador de ${aba} bate com a lista`,
      contagens[aba] === lista.length, `contador ${contagens[aba]}, lista ${lista.length}`);
  }

  /* ---------------- Limpeza ---------------- */

  for (const contato of [pendente, naIa, ativo, arquivado, voltou]) {
    await api.delete(`/api/contatos/${contato.id}`);
  }

  return s;
}
