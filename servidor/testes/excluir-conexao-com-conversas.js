import { cliente, suite } from './apoio.js';

/**
 * Excluir uma conexao com conversas ligadas a ela.
 *
 * Pedido do escritorio em 15/10/2026: a possibilidade de apagar o numero e as
 * conversas juntos precisa continuar existindo mesmo com MUITAS conversas —
 * sem ter de migrar uma a uma so para poder excluir. O padrao continua
 * seguro (recusa sem confirmar), mas confirmando (apagarConversas: true) a
 * exclusao acontece de verdade, levando as conversas junto.
 */
export async function testarExcluirConexaoComConversas({ base }) {
  const s = suite('Excluir conexao com conversas (confirmando, apaga tudo)');
  const api = cliente(base);
  await api.entrar();

  const criada = await api.post('/api/conexoes', { nome: 'Exclusao com conversas (teste)', tipo: 'simulador' });
  const conexaoId = criada.dados?.id;
  if (!s.ok('conexao de teste criada', Boolean(conexaoId), JSON.stringify(criada.dados))) return s;

  const telefone = `3298${String(Date.now()).slice(-7)}`;
  const mensagem = await api.post('/api/simulador/mensagem', { conexaoId, nome: 'Cliente de Teste', telefone, conteudo: 'oi' });
  const contatoId = mensagem.dados?.contatoId;
  if (!s.ok('a conversa de teste foi criada nesta conexao', Boolean(contatoId), JSON.stringify(mensagem.dados))) {
    await api.delete(`/api/conexoes/${conexaoId}`);
    return s;
  }

  const semConfirmar = await api.delete(`/api/conexoes/${conexaoId}`);
  s.ok('sem confirmar, a exclusao e recusada (409)', semConfirmar.status === 409, JSON.stringify(semConfirmar.dados));
  s.ok('a recusa diz quantas conversas tem', String(semConfirmar.dados?.erro || '').includes('1 conversa'), semConfirmar.dados?.erro);

  const aindaExiste = await api.get(`/api/contatos/${contatoId}`);
  s.ok('a recusa nao apaga nada: a conversa continua la', aindaExiste.status === 200, String(aindaExiste.status));

  const comConfirmar = await api.delete(`/api/conexoes/${conexaoId}`, { corpo: { apagarConversas: true } });
  s.ok('confirmando, a exclusao acontece', comConfirmar.status === 200, JSON.stringify(comConfirmar.dados));
  s.ok('a resposta diz quantas conversas foram apagadas junto', comConfirmar.dados?.conversasExcluidas === 1, JSON.stringify(comConfirmar.dados));

  const conexaoSumiu = await api.get('/api/conexoes');
  s.ok(
    'a conexao nao existe mais',
    !(conexaoSumiu.dados || []).some((c) => c.id === conexaoId),
    JSON.stringify((conexaoSumiu.dados || []).map((c) => c.id)),
  );

  const contatoSumiu = await api.get(`/api/contatos/${contatoId}`);
  s.ok('a conversa foi apagada junto', contatoSumiu.status === 404, String(contatoSumiu.status));

  return s;
}
