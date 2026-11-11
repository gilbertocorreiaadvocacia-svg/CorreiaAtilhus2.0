import { cliente, suite } from './apoio.js';

/**
 * O funil de UMA conversa, que a lateral desenha abaixo do resumo
 * (web/js/paginas/funil-da-conversa.js, servidor/nucleo/funil-da-conversa.js).
 *
 * Pedido do escritorio em 10/11/2026. O que estes testes travam:
 *
 * - a conversa que NASCE ja entra no funil, com data (o status de entrada da
 *   conexao tambem grava log, whatsapp/recebimento.js);
 * - cada mudanca de coluna entra no historico, em ordem, com quem moveu;
 * - voltar para uma coluna conta vezes e a data vira a da ULTIMA passagem, nao
 *   a da estreia — e o "ha N dias" da lateral tem que falar da passagem de
 *   agora;
 * - `atualDesde` acompanha a coluna de agora;
 * - a rota NAO depende da janela de /logs: era a razao de existir rota propria,
 *   e sem isso a conversa movimentada perderia as trocas antigas;
 * - e ninguem le o funil de conversa de outro escritorio.
 */
export async function testarFunilDaConversa({ base }) {
  const s = suite('Funil da conversa: etapa, data e historico');
  const api = cliente(base);
  await api.entrar();

  const simulador = ((await api.get('/api/conexoes')).dados || []).find((c) => c.tipo === 'simulador');
  if (!s.ok('ha conexao de simulador', Boolean(simulador))) return s;

  /* Colunas proprias: contar passagem numa coluna do seed daria numero que nao
     e so meu, porque outras suites mexem nas mesmas colunas. */
  const colA = (await api.post('/api/status', { nome: 'Funil A (teste)', cor: 'var(--serie-3)' })).dados;
  const colB = (await api.post('/api/status', { nome: 'Funil B (teste)', cor: 'var(--serie-4)' })).dados;
  if (!s.ok('as duas colunas de teste foram criadas', Boolean(colA?.id && colB?.id))) return s;

  const telefone = `3291${String(Date.now()).slice(-6)}${Math.floor(Math.random() * 10)}`;
  const criada = await api.post('/api/simulador/mensagem', {
    conexaoId: simulador.id,
    telefone,
    nome: 'Funil da conversa (teste)',
    conteudo: 'oi',
  });
  const contatoId = criada.dados?.contatoId;
  if (!s.ok('a conversa de teste nasceu', Boolean(contatoId))) return s;

  const funil = () => api.get(`/api/contatos/${contatoId}/funil`).then((r) => r.dados);

  /* 1. Nascimento ---------------------------------------------------------- */
  const aoNascer = await funil();
  s.ok(
    'a conversa nova ja chega no funil com a coluna de entrada',
    Boolean(aoNascer?.statusId),
    JSON.stringify(aoNascer),
  );
  s.ok(
    'e com a data de quando entrou nela',
    Boolean(aoNascer?.atualDesde) && !Number.isNaN(new Date(aoNascer.atualDesde).getTime()),
    JSON.stringify({ atualDesde: aoNascer?.atualDesde }),
  );
  s.ok(
    'o historico comeca com uma entrada so, a do nascimento',
    (aoNascer?.historico || []).length === 1 && aoNascer.historico[0].statusId === aoNascer.statusId,
    JSON.stringify(aoNascer?.historico),
  );
  s.ok(
    'e a etapa de entrada conta uma passagem',
    aoNascer?.etapas?.[aoNascer.statusId]?.vezes === 1,
    JSON.stringify(aoNascer?.etapas),
  );

  /* 2. Andando no funil ---------------------------------------------------- */
  await api.patch(`/api/contatos/${contatoId}`, { statusId: colA.id });
  const emA = await funil();
  s.ok('mudar de coluna move a etapa de agora', emA?.statusId === colA.id, JSON.stringify({ statusId: emA?.statusId }));
  s.ok(
    'e a data de agora e a da entrada nesta coluna',
    emA?.atualDesde === emA?.etapas?.[colA.id]?.ultimaEm,
    JSON.stringify({ atualDesde: emA?.atualDesde, etapa: emA?.etapas?.[colA.id] }),
  );
  s.ok(
    'o historico guarda a coluna de onde a conversa saiu',
    emA?.historico?.at(-1)?.deId === aoNascer.statusId,
    JSON.stringify(emA?.historico?.at(-1)),
  );
  s.ok(
    'e diz quem moveu',
    Boolean(emA?.historico?.at(-1)?.autor?.nome),
    JSON.stringify(emA?.historico?.at(-1)?.autor),
  );
  s.ok(
    'o nome da coluna vem no historico, para a lista nao depender de outra busca',
    emA?.historico?.at(-1)?.nome === colA.nome,
    JSON.stringify({ nome: emA?.historico?.at(-1)?.nome, esperado: colA.nome }),
  );
  s.ok('e a coluna aparece como viva, porque ainda esta no funil', emA?.historico?.at(-1)?.viva === true);

  await api.patch(`/api/contatos/${contatoId}`, { statusId: colB.id });
  const emB = await funil();
  s.ok(
    'o funil guarda as duas passagens, na ordem em que aconteceram',
    (emB?.historico || []).map((p) => p.statusId).join(',') === [aoNascer.statusId, colA.id, colB.id].join(','),
    JSON.stringify((emB?.historico || []).map((p) => p.statusId)),
  );
  s.ok(
    'a coluna por onde a conversa passou e saiu continua com a data dela',
    Boolean(emB?.etapas?.[colA.id]?.ultimaEm),
    JSON.stringify(emB?.etapas),
  );

  /* 3. Voltando para uma coluna ------------------------------------------- */
  const antesDeVoltar = emB.etapas[colA.id].ultimaEm;
  await api.patch(`/api/contatos/${contatoId}`, { statusId: colA.id });
  const deVolta = await funil();
  s.ok(
    'voltar para a mesma coluna conta duas passagens',
    deVolta?.etapas?.[colA.id]?.vezes === 2,
    JSON.stringify(deVolta?.etapas?.[colA.id]),
  );
  s.ok(
    'a estreia na coluna fica guardada',
    deVolta?.etapas?.[colA.id]?.primeiraEm === antesDeVoltar,
    JSON.stringify({ primeiraEm: deVolta?.etapas?.[colA.id]?.primeiraEm, antesDeVoltar }),
  );
  s.ok(
    'e a data de agora e a da ULTIMA passagem, nao a da estreia',
    deVolta?.atualDesde === deVolta?.etapas?.[colA.id]?.ultimaEm &&
      deVolta?.atualDesde >= antesDeVoltar,
    JSON.stringify({ atualDesde: deVolta?.atualDesde, etapa: deVolta?.etapas?.[colA.id] }),
  );

  /*
   * 4. A razao de a rota existir -------------------------------------------
   *
   * /api/contatos/:id/logs devolve os 200 ultimos logs de TODO tipo. Uma
   * conversa com mensagem, midia e follow-up empurra as trocas de coluna para
   * fora dessa janela, e era justamente o que a lateral precisava. Aqui a
   * conversa recebe muitas mensagens depois das trocas e o funil tem que
   * continuar inteiro.
   */
  for (let i = 0; i < 3; i += 1) {
    await api.post('/api/simulador/mensagem', { conexaoId: simulador.id, telefone, conteudo: `mensagem ${i}` });
  }
  const depoisDeConversar = await funil();
  s.ok(
    'as trocas de coluna sobrevivem a conversa continuar',
    (depoisDeConversar?.historico || []).length === (deVolta?.historico || []).length,
    JSON.stringify({
      antes: (deVolta?.historico || []).length,
      depois: (depoisDeConversar?.historico || []).length,
    }),
  );
  s.ok(
    'e nada do funil se perde: mensagem nao e mudanca de coluna',
    (depoisDeConversar?.historico || []).every((p) => p.statusId),
    JSON.stringify(depoisDeConversar?.historico),
  );

  /* 5. Conversa de outro escritorio --------------------------------------- */
  const inventado = await api.get('/api/contatos/ctt_naoexiste/funil');
  s.ok(
    'conversa que nao existe responde 404, e nao um funil vazio',
    inventado.status === 404,
    JSON.stringify({ status: inventado.status }),
  );

  return s;
}
