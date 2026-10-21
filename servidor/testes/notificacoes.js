import { cliente, suite } from './apoio.js';

/**
 * Cada tipo de notificacao carrega o que o clique precisa para saber para
 * onde ir (ver web/js/notificacoes.js, destinoDaNotificacao). Pedido do
 * escritorio em 20/10/2026: "clica na notificacao e vai direto para a
 * tarefa", "vai direto para aquela conversa".
 *
 * O que nao pode falhar: notificacao de tarefa carrega tarefaId junto do
 * contatoId; notificacao de sistema (numero caiu) carrega conexaoId, mesmo
 * sem contatoId nenhum; os outros tipos continuam sem esses dois campos
 * extras, carregando so o que sempre carregaram.
 */
export async function testarNotificacoes({ base, evolucao, chaveEvolucao }) {
  const s = suite('Notificacoes carregam para onde o clique deve ir');
  const api = cliente(base);
  await api.entrar();

  /* --- Tarefa: tarefaId junto do contatoId --------------------------- */

  const outroMembro = await api.post('/api/membros', {
    nome: 'Colega da tarefa',
    email: 'colega.notificacoes@correia.adv.br',
    senha: 'colega2026',
    papel: 'atendente',
  });
  const membroId = outroMembro.dados?.id;
  if (!s.ok('o segundo membro foi criado', Boolean(membroId), JSON.stringify(outroMembro.dados))) return s;

  const simulador = ((await api.get('/api/conexoes')).dados || []).find((c) => c.tipo === 'simulador');
  const contato = (
    await api.post('/api/contatos', { conexaoId: simulador.id, telefone: '5581930009999', nome: 'Cliente da tarefa' })
  ).dados;

  const tarefa = await api.post('/api/tarefas', {
    titulo: 'Confirmar documento',
    contatoId: contato.id,
    responsavelId: membroId,
    prazo: new Date(Date.now() + 86400000).toISOString(),
    pontos: 1,
  });
  const tarefaId = tarefa.dados?.id;
  if (!s.ok('a tarefa foi criada', Boolean(tarefaId), JSON.stringify(tarefa.dados))) return s;

  const comoColega = cliente(base);
  await comoColega.entrar('colega.notificacoes@correia.adv.br', 'colega2026');
  const notificacoesDoColega = (await comoColega.get('/api/notificacoes')).dados || [];
  const deTarefa = notificacoesDoColega.find((n) => n.tipo === 'tarefa' && n.tarefaId === tarefaId);
  s.ok(
    'a notificacao de tarefa nova carrega tarefaId junto do contatoId',
    deTarefa?.contatoId === contato.id,
    JSON.stringify(deTarefa),
  );

  /* --- Sistema (numero caiu): conexaoId, mesmo sem contatoId --------- */

  /* aplicarEventoDeConexao (rotas/conexoes.js) — quem lanca a notificacao de
     "sistema" — so e chamada pelo WEBHOOK (evento connection.update vindo do
     servico), nunca por POST /api/conexoes/:id/testar: aquele endpoint so
     consulta o estado, nao reporta mudanca nenhuma por si. Entao a queda e
     simulada mandando o mesmo webhook que a Evolution de verdade manda,
     igual a conexoes-qrcode.js. */
  const criada = await api.post('/api/conexoes', { nome: 'Notificacoes (QR)', tipo: 'qrcode' });
  const conexaoId = criada.dados?.id;
  if (!s.ok('a conexao de teste foi criada', Boolean(conexaoId), JSON.stringify(criada.dados))) return s;

  const webhookDeConexao = (chaveDeApi, estado) =>
    fetch(`${base}/webhook/${conexaoId}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', apikey: chaveDeApi },
      body: JSON.stringify({ event: 'connection.update', instance: 'notificacoes-queda', data: { state: estado } }),
    });

  await api.patch(`/api/conexoes/${conexaoId}`, {
    qrcode: { servidor: evolucao, chave: chaveEvolucao, instancia: 'notificacoes-queda', urlWebhook: base },
  });

  /* Sobe (precisa ter estado 'conectado' antes para a queda contar, ver
     rotas/conexoes.js: caiuAgora exige conexao.estado !== 'desconectado'
     ANTES do evento de queda — e SUBIR nao notifica ninguem, so queda e
     troca de qualidade). */
  await webhookDeConexao(chaveEvolucao, 'open');
  const subiu = ((await api.get('/api/conexoes')).dados || []).find((c) => c.id === conexaoId);
  if (!s.ok('a conexao aparece conectada depois do webhook de abertura', subiu?.estado === 'conectado', JSON.stringify(subiu))) {
    return s;
  }

  /* Cai. */
  await webhookDeConexao(chaveEvolucao, 'close');

  const notificacoes = (await api.get('/api/notificacoes')).dados || [];
  const deSistema = notificacoes.find((n) => n.tipo === 'sistema' && n.conexaoId === conexaoId);
  s.ok(
    'a notificacao de numero caido carrega conexaoId, mesmo sem contatoId',
    Boolean(deSistema) && !deSistema.contatoId,
    JSON.stringify(deSistema),
  );

  /* --- Os outros tipos continuam do jeito que sempre foram -----------
     (notificacao de tarefa e do COLEGA, nao do admin — GET /api/notificacoes
     so devolve o que e do proprio usuario que pede, por isso reusa
     comoColega e nao `api` aqui). */

  const doColegaDeNovo = (await comoColega.get('/api/notificacoes')).dados || [];
  const deTarefaDeNovo = doColegaDeNovo.find((n) => n.tipo === 'tarefa' && n.contatoId === contato.id);
  s.ok(
    'tipos que ja apontavam certo continuam sem conexaoId de sobra',
    deTarefaDeNovo?.tarefaId === tarefaId && deTarefaDeNovo?.conexaoId === null,
    JSON.stringify(deTarefaDeNovo),
  );

  await api.delete(`/api/conexoes/${conexaoId}`);
  await api.delete(`/api/contatos/${contato.id}`);
  return s;
}
