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

  /* ---------------- Dados que a linha da lista desenha ---------------- */

  /*
   * O total de mensagens vem junto da conversa.
   *
   * A lista mostra esse numero ao lado da hora, e ele separa dois casos que
   * antes se liam igual: conversa de 200 mensagens parada ha tres dias e
   * conversa de duas mensagens parada ha tres dias.
   */
  const listadas = (await api.get('/api/contatos?aba=todas&limite=1000')).dados?.contatos || [];
  const comMensagemNaLista = listadas.find((c) => c.id === voltou.id);
  const semMensagemNaLista = listadas.find((c) => c.id === pendente.id);
  s.ok('a conversa traz quantas mensagens ja teve',
    comMensagemNaLista?.totalMensagens >= 1, `veio ${comMensagemNaLista?.totalMensagens}`);
  s.ok('conversa que nunca trocou mensagem vem com zero, e nao sem o campo',
    semMensagemNaLista?.totalMensagens === 0, `veio ${semMensagemNaLista?.totalMensagens}`);

  /*
   * As fontes que as abas do painel da direita leem.
   *
   * Sao tres rotas por conversa, e o que importa aqui nao e o conteudo (base
   * de teste tem pouco), e sim que cada uma responda so sobre a conversa
   * pedida e recuse conversa de fora. O painel mostra dado de cliente; uma
   * dessas rotas devolvendo a conversa errada seria vazamento entre casos.
   */
  const logs = (await api.get(`/api/contatos/${voltou.id}/logs`)).dados || [];
  s.ok('o historico da conversa traz os registros dela', Array.isArray(logs) && logs.length > 0);
  s.ok('o historico vem do mais recente para o mais antigo',
    logs.every((l, i) => i === 0 || l.criadoEm <= logs[i - 1].criadoEm));
  s.ok('todo registro do historico e da propria conversa',
    logs.every((l) => l.contatoId === voltou.id));

  const agenda = (await api.get(`/api/contatos/${voltou.id}/agendamentos`)).dados;
  s.ok('a rota de agendamentos da conversa responde uma lista', Array.isArray(agenda));
  s.ok('todo agendamento devolvido e da propria conversa',
    (agenda || []).every((a) => a.contatoId === voltou.id));

  const tarefas = (await api.get(`/api/tarefas?contato=${voltou.id}`)).dados;
  const listaTarefas = tarefas?.tarefas || tarefas || [];
  s.ok('a rota de tarefas aceita o filtro por conversa',
    Array.isArray(listaTarefas) && listaTarefas.every((t) => t.contatoId === voltou.id));

  const inexistente = await api.get('/api/contatos/ctt_nao_existe/agendamentos');
  s.ok('agendamentos de conversa inexistente e recusado', inexistente.status === 404,
    `veio ${inexistente.status}`);

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
   * O contador de cada aba conta o que a aba vai mostrar.
   *
   * Este era o bug travado antes como CARACTERIZACAO: a contagem saia de uma
   * varredura propria do workspace, cega a busca, etiqueta, status e modo
   * foco, entao a aba escrevia "12" e abria com 3 linhas. Numero errado e pior
   * do que numero nenhum numa fila — um "0" em Pendentes durante uma busca
   * dizia que ninguem estava esperando.
   *
   * A afirmacao e a mesma para qualquer filtro: contador e lista sao a mesma
   * conta, feita uma vez.
   */
  const comBusca = (await api.get('/api/contatos?aba=todas&busca=Teste&limite=1')).dados?.contagens || {};
  for (const aba of ['ia', 'ativos', 'pendentes', 'arquivados']) {
    const lista = (await api.get(`/api/contatos?aba=${aba}&busca=Teste&limite=1000`)).dados?.contatos || [];
    s.ok(`com busca, o contador de ${aba} bate com a lista`,
      comBusca[aba] === lista.length, `contador ${comBusca[aba]}, lista ${lista.length}`);
  }

  const comEtiqueta = (await api.get('/api/contatos?aba=todas&etiqueta=etq-teste-conversas&limite=1')).dados?.contagens || {};
  s.ok('com filtro de etiqueta, o contador so conta quem tem a etiqueta',
    comEtiqueta.pendentes === 1 && comEtiqueta.ia === 0 && comEtiqueta.ativos === 0,
    JSON.stringify(comEtiqueta));

  /* Um filtro que nao casa com nada zera todos os contadores. Antes eles
     continuavam mostrando a base inteira embaixo de uma lista vazia. */
  const semNenhum = (await api.get('/api/contatos?aba=todas&busca=zzzznaoexistezzzz&limite=1')).dados?.contagens || {};
  s.ok('busca sem resultado zera os contadores das abas',
    ['ia', 'ativos', 'pendentes', 'grupos', 'arquivados'].every((a) => semNenhum[a] === 0),
    JSON.stringify(semNenhum));

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

  /* ---------------- O nome que vem do perfil do WhatsApp ---------------- */

  /*
   * Tres regras, e as tres importam pelo mesmo motivo: o nome na lista e como
   * o escritorio reconhece o caso.
   *
   * 1. Conversa sem nome ganha o do perfil quando a pessoa escreve.
   * 2. Nome escrito por alguem do escritorio nunca e substituido.
   * 3. Trocar o nome no WhatsApp depois nao renomeia a conversa aqui.
   *
   * A terceira e a que sustenta a segunda: sem ela, bastaria o cliente mudar o
   * proprio nome para apagar a anotacao que o escritorio fez.
   */
  const lerContato = async (id) => (await api.get(`/api/contatos/${id}`)).dados;

  /* 1. Contato criado sem nome fica com o proprio numero no lugar do nome. */
  const semNome = (
    await api.post('/api/contatos', { conexaoId: conexao.id, telefone: TELEFONE(20) })
  ).dados;
  s.ok('contato criado sem nome fica com o numero no lugar do nome',
    semNome.nome === semNome.telefone, `nome veio "${semNome.nome}"`);

  await api.post('/api/simulador/mensagem', {
    conexaoId: conexao.id,
    telefone: TELEFONE(20),
    nome: 'Joana da Silva',
    conteudo: 'boa tarde',
  });
  await esperar(900);
  s.ok('o nome do perfil do WhatsApp preenche a conversa que estava sem nome',
    (await lerContato(semNome.id))?.nome === 'Joana da Silva');

  /* 2. Nome escrito por gente do escritorio nao e sobrescrito. */
  await api.patch(`/api/contatos/${semNome.id}`, { nome: 'Joana - BPC do filho' });
  await api.post('/api/simulador/mensagem', {
    conexaoId: conexao.id,
    telefone: TELEFONE(20),
    nome: 'Joana da Silva',
    conteudo: 'mais uma',
  });
  await esperar(900);
  s.ok('nome escrito pelo escritorio nao e substituido pelo do perfil',
    (await lerContato(semNome.id))?.nome === 'Joana - BPC do filho');

  /* 3. Cliente que troca o nome no WhatsApp nao renomeia a conversa. */
  await api.post('/api/simulador/mensagem', {
    conexaoId: conexao.id,
    telefone: TELEFONE(20),
    nome: 'Jojo 2026',
    conteudo: 'troquei meu nome',
  });
  await esperar(900);
  s.ok('cliente que troca o nome no WhatsApp nao renomeia a conversa',
    (await lerContato(semNome.id))?.nome === 'Joana - BPC do filho');

  /* A mudanca fica registrada no historico, senao um nome que aparece sozinho
     na lista se le como erro do sistema. */
  const logsDoNome = ((await api.get(`/api/contatos/${semNome.id}/logs`)).dados || []).filter(
    (l) => l.tipo === 'nome',
  );
  s.ok('o preenchimento do nome fica no historico da conversa',
    logsDoNome.length === 1 && logsDoNome[0].descricao.includes('Joana da Silva'),
    JSON.stringify(logsDoNome.map((l) => l.descricao)));

  /* Mensagem sem nome de perfil nao apaga o que ja existe. */
  const semPerfil = (
    await api.post('/api/contatos', { conexaoId: conexao.id, telefone: TELEFONE(21), nome: 'Cadastro Manual' })
  ).dados;
  await api.post('/api/simulador/mensagem', { conexaoId: conexao.id, telefone: TELEFONE(21), conteudo: 'oi' });
  await esperar(900);
  s.ok('mensagem sem nome de perfil nao apaga o nome que ja existia',
    (await lerContato(semPerfil.id))?.nome === 'Cadastro Manual');

  /* ---------------- Aviso de mensagem nova ---------------- */

  /*
   * Quem e avisado quando o cliente escreve.
   *
   * Sao tres regras diferentes para tres situacoes, e errar qualquer uma custa
   * caro nos dois sentidos: avisar demais e treinar a equipe a ignorar o sino;
   * avisar de menos e cliente esperando resposta que ninguem sabe que chegou.
   */
  const naoLidasDe = async (contatoId) =>
    ((await api.get('/api/notificacoes')).dados || []).filter(
      (n) => n.contatoId === contatoId && !n.lida && n.tipo === 'mensagem',
    );

  const escrever = async (telefone, conteudo) => {
    await api.post('/api/simulador/mensagem', { conexaoId: conexao.id, telefone, conteudo });
    await esperar(900);
  };

  /* Com dono: so o dono, e uma vez so por mais que o cliente escreva. */
  const comDono = await criar(10, 'Teste Aviso Dono');
  await api.post(`/api/contatos/${comDono.id}/aceitar`);
  await escrever(TELEFONE(10), 'bom dia');
  await escrever(TELEFONE(10), 'queria saber do processo');
  const avisosDoDono = await naoLidasDe(comDono.id);
  s.ok('mensagem de cliente vira aviso para quem atende', avisosDoDono.length >= 1,
    `veio ${avisosDoDono.length}`);
  s.ok('cliente que manda varias mensagens seguidas gera um aviso so',
    avisosDoDono.length === 1, `veio ${avisosDoDono.length}`);
  s.ok('o aviso leva o nome de quem escreveu e o comeco da mensagem',
    Boolean(avisosDoDono[0]?.titulo?.includes(comDono.nome)) && Boolean(avisosDoDono[0]?.texto));

  /* Com agente: ninguem. A IA responde, e esse e o proposito dela. */
  const comAgente = await criar(11, 'Teste Aviso IA');
  await api.patch(`/api/contatos/${comAgente.id}`, { responsavel: { tipo: 'agente', id: agenteId } });
  await escrever(TELEFONE(11), 'ola');
  s.ok('conversa que a IA esta atendendo nao gera aviso',
    (await naoLidasDe(comAgente.id)).length === 0);

  /* Sem dono: quem pode atender precisa ver. */
  const semDono = await criar(12, 'Teste Aviso Fila');
  await api.patch(`/api/contatos/${semDono.id}`, { responsavel: null });
  await escrever(TELEFONE(12), 'alguem me atende?');
  s.ok('conversa sem responsavel avisa quem pode atende-la',
    (await naoLidasDe(semDono.id)).length >= 1);

  /* Depois de lido, a proxima mensagem avisa de novo — senao o segundo dia de
     conversa passaria em silencio. */
  await api.post('/api/notificacoes/ler', {});
  await escrever(TELEFONE(10), 'ainda estou aqui');
  s.ok('depois de lido, a proxima mensagem avisa de novo',
    (await naoLidasDe(comDono.id)).length === 1);

  /* ---------------- Limpeza ---------------- */

  for (const contato of [pendente, naIa, ativo, arquivado, voltou, comDono, comAgente, semDono, semNome, semPerfil]) {
    await api.delete(`/api/contatos/${contato.id}`);
  }

  return s;
}
