import { cliente, suite } from './apoio.js';

/**
 * Duas coisas que a equipe faz DENTRO da conversa, pedidas pelo escritorio em
 * 12/11/2026: citar um colega numa nota interna, e ligar para o cliente.
 *
 * Elas moram no mesmo arquivo porque sao o mesmo gesto — alguem da equipe
 * registra, na conversa, algo que fez fora dela — e porque as duas deixam
 * rastro nos mesmos lugares (nota, log, notificacao).
 */

/**
 * Citar um colega numa nota interna avisa ele.
 *
 * O SERVIDOR JA FAZIA ISSO; o que faltava era a tela mandar `mencoes`, e sem
 * isso o caminho inteiro era inalcancavel. Este teste trava o contrato da
 * rota, que e o que a tela passou a usar — se alguem mexer nele, o aviso para
 * de chegar e ninguem percebe, porque a nota continua aparecendo na conversa
 * do mesmo jeito.
 */
export async function testarMencaoNaNota({ base }) {
  const s = suite('Citar alguem numa nota interna avisa a pessoa');
  const api = cliente(base);
  await api.entrar();

  const colega = await api.post('/api/membros', {
    nome: 'Colega Citado',
    email: 'colega.citado@correia.adv.br',
    senha: 'colega2026',
    papel: 'atendente',
  });
  const membroId = colega.dados?.id;
  if (!s.ok('o colega foi criado', Boolean(membroId), JSON.stringify(colega.dados))) return s;

  const simulador = ((await api.get('/api/conexoes')).dados || []).find((c) => c.tipo === 'simulador');
  if (!s.ok('ha conexao de simulador', Boolean(simulador))) return s;

  const contato = (
    await api.post('/api/contatos', { conexaoId: simulador.id, telefone: '5581930001122', nome: 'Cliente da Citacao' })
  ).dados;
  if (!s.ok('a conversa de teste foi criada', Boolean(contato?.id))) return s;

  /* --- A nota com a citacao ------------------------------------------- */
  const nota = await api.post(`/api/contatos/${contato.id}/mensagens`, {
    conteudo: 'Conferir o CNIS deste cliente, @Colega Citado',
    nota: true,
    mencoes: [membroId],
  });
  s.ok('a nota e gravada como nota interna', nota.dados?.nota === true && nota.dados?.direcao === 'interna', JSON.stringify(nota.dados?.nota));
  s.ok('e guarda quem foi citado', JSON.stringify(nota.dados?.mencoes) === JSON.stringify([membroId]), JSON.stringify(nota.dados?.mencoes));

  /* --- O aviso chega para o citado, e nao para quem escreveu ---------- */
  const doColega = cliente(base);
  const entrou = await doColega.entrar('colega.citado@correia.adv.br', 'colega2026');
  if (!s.ok('o colega consegue entrar', entrou.status === 200, String(entrou.status))) return s;

  const avisos = (await doColega.get('/api/notificacoes')).dados || [];
  const citacao = avisos.find((n) => n.tipo === 'mencao' && n.contatoId === contato.id);
  s.ok('o citado recebe o aviso na caixa de notificacoes', Boolean(citacao), JSON.stringify(avisos.slice(0, 3)));
  s.ok(
    'e o aviso diz quem citou e em qual conversa',
    /Administrador/.test(citacao?.texto || '') && /Cliente da Citacao/.test(citacao?.texto || ''),
    citacao?.texto || '(sem aviso)',
  );
  s.ok('o aviso aponta para a conversa, para o clique levar ate la', citacao?.contatoId === contato.id, String(citacao?.contatoId));

  /*
   * Citar tambem DA ACESSO a conversa por 24 horas (mencoesRecentes). E efeito
   * conhecido e documentado na tela, e nao pode sumir sem alguem decidir isso:
   * um atendente citado que nao enxerga a conversa recebe um aviso que nao
   * consegue abrir.
   */
  const comoAdmin = (await api.get(`/api/contatos/${contato.id}`)).dados;
  s.ok(
    'quem foi citado passa a enxergar a conversa (mencoes recentes)',
    (comoAdmin?.mencoesRecentes || []).some((m) => m.membroId === membroId),
    JSON.stringify(comoAdmin?.mencoesRecentes),
  );

  /* --- Nota sem citacao nao avisa ninguem ----------------------------- */
  const antes = ((await doColega.get('/api/notificacoes')).dados || []).length;
  await api.post(`/api/contatos/${contato.id}/mensagens`, { conteudo: 'Nota sem citar ninguem', nota: true });
  const depois = ((await doColega.get('/api/notificacoes')).dados || []).length;
  s.ok('nota sem citacao nao avisa ninguem', depois === antes, `${antes} -> ${depois}`);

  return s;
}

/**
 * Ligar para o cliente deixa rastro na conversa.
 *
 * Quem disca e o aparelho (um link tel: na tela); o que o sistema faz e
 * registrar. O teste e sobre o REGISTRO, que e a parte que e nossa.
 */
export async function testarRegistroDeLigacao({ base }) {
  const s = suite('Ligar para o cliente fica registrado na conversa');
  const api = cliente(base);
  await api.entrar();

  const simulador = ((await api.get('/api/conexoes')).dados || []).find((c) => c.tipo === 'simulador');
  if (!s.ok('ha conexao de simulador', Boolean(simulador))) return s;

  const contato = (
    await api.post('/api/contatos', { conexaoId: simulador.id, telefone: '5581930003344', nome: 'Cliente da Ligacao' })
  ).dados;
  if (!s.ok('a conversa de teste foi criada', Boolean(contato?.id))) return s;

  const notas = async () => ((await api.get(`/api/contatos/${contato.id}/mensagens`)).dados?.mensagens || []).filter((m) => m.nota);
  const antes = (await notas()).length;

  const r = await api.post(`/api/contatos/${contato.id}/ligacao`, {});
  s.ok('a rota responde', r.status === 200, String(r.status));

  const depois = await notas();
  s.ok('entra uma nota na conversa', depois.length === antes + 1, `${antes} -> ${depois.length}`);

  const nota = depois.at(-1);
  s.ok('a nota diz quem ligou e para que numero', /Administrador/.test(nota?.conteudo || '') && /5581930003344/.test(nota?.conteudo || ''), nota?.conteudo || '');
  /*
   * "iniciou uma ligacao", e NAO "ligou": daqui nao da para saber se a chamada
   * completou, se o cliente atendeu, ou se o computador tinha um programa de
   * telefone. Quem lesse "ligou" nao tentaria de novo.
   */
  s.ok('e nao afirma que a ligacao completou', /iniciou uma liga/i.test(nota?.conteudo || '') && !/\bligou\b/i.test(nota?.conteudo || ''), nota?.conteudo || '');
  s.ok('a nota tem autor, para saber de quem foi', nota?.autor?.tipo === 'membro' && Boolean(nota?.autor?.nome), JSON.stringify(nota?.autor));

  const logs = ((await api.get(`/api/contatos/${contato.id}/logs`)).dados || []).filter((l) => l.tipo === 'ligacao');
  s.ok('e o historico da conversa tambem guarda', logs.length === 1 && /5581930003344/.test(logs[0]?.descricao || ''), JSON.stringify(logs.map((l) => l.descricao)));

  /* Ligar de novo registra de novo: duas tentativas sao dois fatos. */
  await api.post(`/api/contatos/${contato.id}/ligacao`, {});
  s.ok('ligar de novo registra outra vez', (await notas()).length === antes + 2, String((await notas()).length));

  /*
   * A GUARDA DE "SEM TELEFONE" NAO E COBERTA AQUI, e isso e uma escolha.
   *
   * Conversa sem telefone so existe no Instagram e no TikTok, e ela nasce pelo
   * webhook do canal: /api/contatos sempre cria um contato de WhatsApp com
   * numero, e o PATCH nao aceita telefone (ele e a identidade da conversa, nao
   * um campo editavel). Tentar forjar uma aqui foi o que fez este teste
   * reprovar antes — a montagem e que era invalida, nao o sistema.
   *
   * O que segura esse caso na pratica: a tela so desenha o botao quando ha
   * telefone, e a rota tem a guarda de uma linha. Montar um processo separado
   * com banco proprio para afirmar uma linha de guarda custaria mais do que
   * vale.
   */

  /* --- Conversa que nao existe ---------------------------------------- */
  const inventada = await api.post('/api/contatos/ctt_naoexiste/ligacao', {});
  s.ok('conversa que nao existe responde 404', inventada.status === 404, String(inventada.status));

  return s;
}
