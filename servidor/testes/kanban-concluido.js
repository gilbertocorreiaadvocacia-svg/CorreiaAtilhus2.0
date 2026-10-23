import { cliente, suite } from './apoio.js';

/**
 * Conversa concluida (arquivada) some do Kanban, mas volta sozinha se o
 * cliente escrever de novo.
 *
 * Pedido do escritorio em 23/10/2026: o Kanban busca com aba=todas (para
 * contar toda coluna de uma vez, nao so a aba aberta), e nada ali filtrava
 * por estado — uma conversa que a pessoa concluiu em massa (justamente para
 * tirar da fila) continuava aparecendo como cartao na coluna, do mesmo jeito
 * que uma conversa aberta. O conserto e so na CONTAGEM e no CARTAO do
 * Kanban: a tabela de Contatos, que busca a mesma aba=todas para outro fim
 * (listar todo mundo, inclusive quem ja foi atendido), continua mostrando
 * arquivada normalmente — nao mexi nela.
 */
export async function testarKanbanConcluido({ base }) {
  const s = suite('Kanban: concluida some, mas volta se o cliente escrever');
  const api = cliente(base);
  await api.entrar();

  const simulador = ((await api.get('/api/conexoes')).dados || []).find((c) => c.tipo === 'simulador');
  if (!s.ok('ha conexao de simulador', Boolean(simulador))) return s;

  const agente = await api.post('/api/agentes', {
    nome: 'Kanban Concluido (teste)',
    prompt: 'Atenda com educacao.',
    ativo: true,
  });
  const agenteId = agente.dados?.id;
  if (!s.ok('o agente de teste foi criado', Boolean(agenteId))) return s;

  /* Status proprio, e nao um do seed: contar uma coluna compartilhada com
     outras suites daria um numero que nao e so meu. */
  const status = (await api.post('/api/status', { nome: 'Kanban Concluido (teste)', cor: 'var(--serie-3)' })).dados;
  if (!s.ok('o status de teste foi criado', Boolean(status?.id))) return s;

  const numeroNovo = () => `3293${String(Date.now()).slice(-6)}${Math.floor(Math.random() * 10)}`;
  const criarContato = async (nome) => {
    const r = await api.post('/api/simulador/mensagem', {
      conexaoId: simulador.id,
      telefone: numeroNovo(),
      nome,
      conteudo: 'oi',
      agenteId,
    });
    await api.patch(`/api/contatos/${r.dados.contatoId}`, { statusId: status.id });
    return r.dados.contatoId;
  };

  const idAberto = await criarContato('Conversa aberta');
  const idConcluido = await criarContato('Conversa concluida');
  if (!s.ok('os dois contatos de teste foram criados', Boolean(idAberto && idConcluido))) return s;

  await api.post(`/api/contatos/${idConcluido}/arquivar`, { arquivar: true });

  const resposta = await api.get('/api/contatos?aba=todas&limite=400');
  s.ok(
    'o Kanban (aba=todas) conta so a conversa aberta nesta coluna, nao a concluida',
    resposta.dados?.porStatus?.[status.id] === 1,
    JSON.stringify({ porStatus: resposta.dados?.porStatus, statusId: status.id }),
  );
  const idsNaResposta = (resposta.dados?.contatos || []).map((c) => c.id);
  s.ok(
    'a conversa concluida nao aparece como cartao (continua existindo, so nao soma)',
    idsNaResposta.includes(idAberto),
    JSON.stringify({ temAberto: idsNaResposta.includes(idAberto), temConcluido: idsNaResposta.includes(idConcluido) }),
  );

  /* A tabela de Contatos usa a MESMA aba=todas, mas e outra tela: continua
     mostrando a concluida, porque e ela que serve para achar quem ja foi
     atendido. So o numero que o Kanban le (porStatus) muda. */
  const contatoConcluido = (await api.get(`/api/contatos/${idConcluido}`)).dados;
  s.ok('a conversa concluida continua existindo, so com estado arquivado', contatoConcluido?.estado === 'arquivado');

  /* O cliente escreve de novo — a conversa tem que voltar a contar. */
  await api.post('/api/simulador/mensagem', {
    conexaoId: simulador.id,
    telefone: contatoConcluido.telefone,
    nome: 'Conversa concluida',
    conteudo: 'oi, ainda preciso de ajuda',
  });

  const depoisDeEscrever = (await api.get(`/api/contatos/${idConcluido}`)).dados;
  s.ok(
    'depois que o cliente escreve, a conversa sai do arquivado e volta para a IA',
    depoisDeEscrever?.estado === 'ia',
    JSON.stringify(depoisDeEscrever),
  );

  const respostaDepois = await api.get('/api/contatos?aba=todas&limite=400');
  s.ok(
    'e volta a contar no Kanban (as duas, agora)',
    respostaDepois.dados?.porStatus?.[status.id] === 2,
    JSON.stringify(respostaDepois.dados?.porStatus),
  );

  return s;
}
