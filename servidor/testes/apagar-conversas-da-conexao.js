import { cliente, suite } from './apoio.js';

/**
 * Apagar as conversas de uma conexao, SEM excluir a conexao.
 *
 * Pedido do escritorio em 15/10/2026: depois de apagar, desconectar e
 * reconectar o numero para comecar de novo, so que trazendo do celular
 * apenas os ultimos N meses, em vez do historico inteiro. Existe porque,
 * nesta hospedagem, o Console do EasyPanel so abre terminal com o app
 * RODANDO — a ferramenta de linha de comando (que exige o app parado) nao e
 * alcancavel. Esta rota faz o mesmo, pelo site, com o app no ar.
 */
export async function testarApagarConversasDaConexao({ base }) {
  const s = suite('Apagar conversas de uma conexao (conexao continua configurada)');
  const api = cliente(base);
  await api.entrar();

  const criada = await api.post('/api/conexoes', { nome: 'Apagar conversas (teste)', tipo: 'simulador' });
  const conexaoId = criada.dados?.id;
  if (!s.ok('conexao de teste criada', Boolean(conexaoId), JSON.stringify(criada.dados))) return s;

  const numeroNovo = () => `3299${String(Date.now()).slice(-6)}${Math.floor(Math.random() * 10)}`;
  const falar = (telefone) => api.post('/api/simulador/mensagem', { conexaoId, nome: 'Cliente de Teste', telefone, conteudo: 'oi' });

  const m1 = await falar(numeroNovo());
  const m2 = await falar(numeroNovo());
  const contatoId1 = m1.dados?.contatoId;
  const contatoId2 = m2.dados?.contatoId;
  if (!s.ok('as duas conversas de teste foram criadas', Boolean(contatoId1) && Boolean(contatoId2), JSON.stringify([m1.dados, m2.dados]))) {
    await api.delete(`/api/conexoes/${conexaoId}`, { corpo: { apagarConversas: true } });
    return s;
  }

  const antes = Date.now();
  const resultado = await api.post(`/api/conexoes/${conexaoId}/apagar-conversas`, { manterMeses: 6 });
  s.ok('a rota responde ok', resultado.status === 200, JSON.stringify(resultado.dados));
  s.ok('diz quantas conversas apagou (2)', resultado.dados?.conversasExcluidas === 2, JSON.stringify(resultado.dados));

  const c1 = await api.get(`/api/contatos/${contatoId1}`);
  const c2 = await api.get(`/api/contatos/${contatoId2}`);
  s.ok('a primeira conversa foi apagada', c1.status === 404, String(c1.status));
  s.ok('a segunda conversa foi apagada', c2.status === 404, String(c2.status));

  const conexoesDepois = (await api.get('/api/conexoes')).dados || [];
  const conexaoDepois = conexoesDepois.find((c) => c.id === conexaoId);
  s.ok('a conexao continua existindo (so as conversas somem)', Boolean(conexaoDepois), JSON.stringify(conexoesDepois.map((c) => c.id)));

  const corte = Date.parse(conexaoDepois?.historico?.naoTrazerAntesDe || '');
  const seisMesesAtras = new Date(antes);
  seisMesesAtras.setMonth(seisMesesAtras.getMonth() - 6);
  const diferencaEmDias = Math.abs(corte - seisMesesAtras.getTime()) / (1000 * 60 * 60 * 24);
  s.ok(
    'o corte (naoTrazerAntesDe) fica a uns 6 meses atras, nao em "agora"',
    Number.isFinite(corte) && diferencaEmDias < 2,
    `corte: ${conexaoDepois?.historico?.naoTrazerAntesDe}, esperado perto de ${seisMesesAtras.toISOString()}`,
  );

  const semConversaNenhuma = await api.post(`/api/conexoes/${conexaoId}/apagar-conversas`, { manterMeses: 6 });
  s.ok(
    'rodar de novo sem conversa nenhuma nao da erro (idempotente)',
    semConversaNenhuma.status === 200 && semConversaNenhuma.dados?.conversasExcluidas === 0,
    JSON.stringify(semConversaNenhuma.dados),
  );

  await api.delete(`/api/conexoes/${conexaoId}`);
  return s;
}
