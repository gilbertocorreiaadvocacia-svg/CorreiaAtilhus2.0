import { cliente, suite } from './apoio.js';

/**
 * Excluir varias conversas de uma vez, pela tela de Contatos.
 *
 * Pedido do escritorio em 15/10/2026: depois de excluir uma conexao sem
 * excluir as conversas dela antes (ou qualquer outro jeito de sobrar
 * conversa sem a conexao que a criou), precisa dar para apagar essas
 * conversas direto, sem depender de uma conexao existir. A acao em massa
 * "excluir" (reaproveitando excluirConversa, a mesma limpeza completa da
 * exclusao individual) e esse caminho.
 */
export async function testarExcluirEmMassa({ base }) {
  const s = suite('Excluir varias conversas de uma vez (acao em massa)');
  const api = cliente(base);
  await api.entrar();

  const conexoes = (await api.get('/api/conexoes')).dados || [];
  const simulador = conexoes.find((c) => c.tipo === 'simulador');
  if (!s.ok('ha conexao de simulador para criar as conversas de teste', Boolean(simulador))) return s;

  const numeroNovo = () => `3291${String(Date.now()).slice(-6)}${Math.floor(Math.random() * 10)}`;
  const falar = (telefone) => api.post('/api/simulador/mensagem', { conexaoId: simulador.id, nome: 'Cliente de Teste', telefone, conteudo: 'oi' });

  const m1 = await falar(numeroNovo());
  const m2 = await falar(numeroNovo());
  const m3 = await falar(numeroNovo());
  const idExcluir1 = m1.dados?.contatoId;
  const idExcluir2 = m2.dados?.contatoId;
  const idIntocado = m3.dados?.contatoId;
  if (!s.ok('as tres conversas de teste foram criadas', [idExcluir1, idExcluir2, idIntocado].every(Boolean), JSON.stringify([m1.dados, m2.dados, m3.dados]))) {
    return s;
  }

  const resultado = await api.post('/api/contatos/acoes-em-massa', { ids: [idExcluir1, idExcluir2], acao: 'excluir' });
  s.ok('a rota responde ok', resultado.status === 200, JSON.stringify(resultado.dados));
  s.ok('diz quantas conversas afetou (2)', resultado.dados?.afetados === 2, JSON.stringify(resultado.dados));

  const c1 = await api.get(`/api/contatos/${idExcluir1}`);
  const c2 = await api.get(`/api/contatos/${idExcluir2}`);
  const c3 = await api.get(`/api/contatos/${idIntocado}`);
  s.ok('a primeira foi excluida', c1.status === 404, String(c1.status));
  s.ok('a segunda foi excluida', c2.status === 404, String(c2.status));
  s.ok('a que nao foi marcada continua existindo', c3.status === 200, String(c3.status));

  await api.post('/api/contatos/acoes-em-massa', { ids: [idIntocado], acao: 'excluir' });
  return s;
}
