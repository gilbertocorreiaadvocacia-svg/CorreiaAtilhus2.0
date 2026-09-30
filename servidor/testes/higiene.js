import { cliente, suite } from './apoio.js';

/**
 * As duas portas que deixaram o funil virar bagunca.
 *
 * O escritorio acabou com TRES colunas "Nao Qualificado". Nenhuma foi criada
 * por engano: o sistema aceitava nome repetido sem piscar, e quem quisesse
 * juntar duas colunas parecidas encontrava so o excluir, que se recusa
 * enquanto houver conversa dentro. Sem jeito de esvaziar em lote, a saida era
 * deixar as duas de pe — e o relatorio saiu partido em tres.
 *
 * O que nao pode falhar: nome repetido e recusado (com o acento e a maiuscula
 * nao servindo de disfarce), e unificar leva TUDO junto — conversa, status
 * padrao do numero e o destino da desistencia do follow-up — sem disparar o
 * funil de cada conversa movida.
 */
export async function testarHigiene({ base }) {
  const s = suite('Higiene do funil');
  const api = cliente(base);
  await api.entrar();

  /* --- Nome repetido nao entra ---------------------------------------- */

  const primeira = await api.post('/api/status', { nome: 'Coluna Repetida', tipo: 'nenhum' });
  const primeiraId = primeira.dados?.id;
  if (!s.ok('a primeira coluna com esse nome entra', Boolean(primeiraId), JSON.stringify(primeira.dados))) return s;

  const segunda = await api.post('/api/status', { nome: 'Coluna Repetida', tipo: 'nenhum' });
  s.ok('a segunda com o mesmo nome e recusada', segunda.status === 409, `status ${segunda.status}`);
  s.ok(
    'e o recado aponta a que ja existe, em vez de so dizer nao',
    String(segunda.dados?.erro || '').includes('Coluna Repetida'),
    JSON.stringify(segunda.dados),
  );

  /* Acento e maiuscula sao o disfarce mais comum: "Nao Qualificado" e
     "Não qualificado" sao a mesma coluna para quem le o relatorio. */
  const disfarcada = await api.post('/api/status', { nome: 'cóluna repetída', tipo: 'nenhum' });
  s.ok('acento e maiuscula nao servem de disfarce', disfarcada.status === 409, `status ${disfarcada.status}`);

  const outra = await api.post('/api/status', { nome: 'Coluna Destino', tipo: 'nenhum' });
  const destinoId = outra.dados?.id;
  if (!s.ok('uma coluna de nome diferente entra normalmente', Boolean(destinoId))) return s;

  const renomear = await api.patch(`/api/status/${destinoId}`, { nome: 'Coluna Repetida' });
  s.ok('renomear para um nome que ja existe tambem e recusado', renomear.status === 409, `status ${renomear.status}`);

  const mesmoNome = await api.patch(`/api/status/${destinoId}`, { nome: 'Coluna Destino', descricao: 'mexi na descricao' });
  s.ok(
    'mas salvar o proprio nome sem mexer nele continua valendo',
    mesmoNome.status === 200,
    JSON.stringify(mesmoNome.dados),
  );

  /* A mesma porta vale para as outras classes da conversa. */
  const dep1 = await api.post('/api/departamentos', { nome: 'Area Repetida' });
  const dep2 = await api.post('/api/departamentos', { nome: 'area repetida' });
  s.ok('departamento repetido e recusado', dep2.status === 409, `status ${dep2.status}`);
  const etq1 = await api.post('/api/etiquetas', { nome: 'Etiqueta Repetida' });
  const etq2 = await api.post('/api/etiquetas', { nome: 'Etiqueta Repetida' });
  s.ok('etiqueta repetida e recusada', etq2.status === 409, `status ${etq2.status}`);
  const org2 = await api.post('/api/origens', { nome: 'Indicacao' });
  s.ok('origem repetida e recusada', org2.status === 409, `status ${org2.status}`);

  /* --- Unificar leva tudo junto ---------------------------------------- */

  /* Uma conversa na coluna que vai sumir. */
  const conversa = await api.post('/api/contatos', { nome: 'Cliente da unificacao', telefone: '5581900001111' });
  const contatoId = conversa.dados?.id;
  if (!s.ok('conversa de teste criada', Boolean(contatoId), JSON.stringify(conversa.dados))) return s;
  await api.patch(`/api/contatos/${contatoId}`, { statusId: primeiraId });

  /* Um numero cujo status padrao e a coluna que vai sumir. */
  const conexao = await api.post('/api/conexoes', { nome: 'Numero da unificacao', tipo: 'simulador' });
  const conexaoId = conexao.dados?.id;
  await api.patch(`/api/conexoes/${conexaoId}`, { statusPadraoId: primeiraId });

  /* Um follow-up que desiste mandando o lead para a coluna que vai sumir. */
  const templates = (await api.get('/api/templates')).dados || [];
  const comDesistencia = await api.patch(`/api/status/${destinoId}`, {
    followups: [
      {
        templateId: templates[0]?.id,
        minutos: 60,
        desistir: { ativo: true, statusId: primeiraId, arquivar: true },
      },
    ],
  });
  const temDesistencia = comDesistencia.dados?.followups?.[0]?.desistir?.statusId === primeiraId;

  const previa = await api.post(`/api/status/${primeiraId}/unificar`, { destinoId, simular: true });
  s.ok('a previa conta as conversas antes de mexer', previa.dados?.conversas === 1, JSON.stringify(previa.dados));
  s.ok('a previa avisa qual numero perde o status padrao', (previa.dados?.conexoes || []).includes('Numero da unificacao'));
  s.ok('a previa nao executa nada', (await api.get('/api/status')).dados.some((x) => x.id === primeiraId));

  const feito = await api.post(`/api/status/${primeiraId}/unificar`, { destinoId });
  s.ok('unificar responde ok', feito.status === 200 && feito.dados?.ok === true, JSON.stringify(feito.dados));

  const status = (await api.get('/api/status')).dados || [];
  s.ok('a coluna de origem deixou de existir', !status.some((x) => x.id === primeiraId));

  const depois = (await api.get(`/api/contatos/${contatoId}`)).dados;
  s.ok('a conversa foi para a coluna de destino', depois?.statusId === destinoId, JSON.stringify(depois?.statusId));

  const conexaoDepois = (await api.get('/api/conexoes')).dados.find((c) => c.id === conexaoId);
  s.ok(
    'o numero passou a ter a coluna de destino como padrao',
    conexaoDepois?.statusPadraoId === destinoId,
    JSON.stringify(conexaoDepois?.statusPadraoId),
  );

  if (temDesistencia) {
    const destinoDepois = status.find((x) => x.id === destinoId);
    s.ok(
      'o follow-up que desistia para a coluna que sumiu foi reapontado',
      destinoDepois?.followups?.[0]?.desistir?.statusId === destinoId,
      JSON.stringify(destinoDepois?.followups?.[0]?.desistir),
    );
  }

  const naMesma = await api.post(`/api/status/${destinoId}/unificar`, { destinoId });
  s.ok('unificar uma coluna com ela mesma e recusado', naMesma.status === 400, `status ${naMesma.status}`);

  /* Limpeza: as outras suites contam fila, coluna e etiqueta. */
  await api.delete(`/api/contatos/${contatoId}`);
  await api.delete(`/api/conexoes/${conexaoId}`);
  await api.patch(`/api/status/${destinoId}`, { followups: [] });
  await api.delete(`/api/status/${destinoId}`);
  if (dep1.dados?.id) await api.delete(`/api/departamentos/${dep1.dados.id}`);
  if (etq1.dados?.id) await api.delete(`/api/etiquetas/${etq1.dados.id}`);

  return s;
}
