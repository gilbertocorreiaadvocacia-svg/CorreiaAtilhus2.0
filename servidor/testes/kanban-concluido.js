import { cliente, suite } from './apoio.js';

/**
 * Conversa concluida (arquivada) CONTINUA no Kanban: concluir tira da fila de
 * atendimento, nao do funil.
 *
 * De 23/10 a 29/10/2026 ela sumia do Kanban, a pedido do escritorio. Em 29/10
 * o pedido virou o contrario: "os arquivados deveriam aparecer no Kanban, pois
 * eu arquivo apenas para nao estar nos ativos". O Kanban busca com aba=todas,
 * e a contagem da coluna (porStatus) e o cartao contam a concluida.
 */
export async function testarKanbanConcluido({ base }) {
  const s = suite('Kanban: conversa concluida continua na coluna dela');
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
    'o Kanban (aba=todas) conta a aberta e a concluida nesta coluna',
    resposta.dados?.porStatus?.[status.id] === 2,
    JSON.stringify({ porStatus: resposta.dados?.porStatus, statusId: status.id }),
  );
  const idsNaResposta = (resposta.dados?.contatos || []).map((c) => c.id);
  s.ok(
    'a conversa concluida vem na resposta, para virar cartao',
    idsNaResposta.includes(idAberto) && idsNaResposta.includes(idConcluido),
    JSON.stringify({ temAberto: idsNaResposta.includes(idAberto), temConcluido: idsNaResposta.includes(idConcluido) }),
  );

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
    'e continua contando no Kanban (as duas)',
    respostaDepois.dados?.porStatus?.[status.id] === 2,
    JSON.stringify(respostaDepois.dados?.porStatus),
  );

  return s;
}
