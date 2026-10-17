import { cliente, suite } from './apoio.js';

/**
 * Excluir TODO contato do workspace de uma vez.
 *
 * Pedido do escritorio em 15/10/2026: depois de ja ter o jeito de excluir
 * uma conexao com conversas e de excluir varias conversas marcadas, faltava
 * o caso mais direto - apagar tudo do workspace de uma vez, sem depender de
 * marcar linha por linha (a tela so carrega um lote por vez) nem de uma
 * conexao existir. Duas chamadas: a primeira so avisa quantos existem
 * (sem apagar nada), a segunda, confirmando, apaga de verdade.
 *
 * Roda num workspace PROPRIO, criado so para este teste: excluir-tudo apaga
 * TODO contato do workspace ativo, e testar isso dentro do workspace
 * principal da suite arriscaria levar junto fixture de outro teste.
 *
 * IMPORTANTE: trocar de workspace (POST /api/sessao/workspace) grava
 * ultimoWorkspaceId no PROPRIO USUARIO administrador (ver rotas/sessao.js),
 * nao so nesta sessao - e e esse mesmo admin que todo outro teste da suite
 * usa para entrar. Sem voltar ao workspace original no fim, os testes que
 * rodassem DEPOIS deste entrariam de novo no workspace isolado (vazio) e
 * falhariam em cascata, por um motivo que nada tem a ver com eles mesmos.
 * O finally garante a volta mesmo se uma asserção no meio falhar.
 */
export async function testarExcluirTodosOsContatos({ base }) {
  const s = suite('Excluir todos os contatos do workspace de uma vez');
  const api = cliente(base);
  await api.entrar();

  const eu = await api.get('/api/sessao/eu');
  const workspaceOriginalId = eu.dados?.workspace?.id;
  if (!s.ok('sei qual e o workspace original, para voltar depois', Boolean(workspaceOriginalId), JSON.stringify(eu.dados?.workspace))) {
    return s;
  }

  try {
    const workspace = await api.post('/api/workspaces', { nome: `Excluir tudo (teste ${Date.now()})` });
    const workspaceId = workspace.dados?.id;
    if (!s.ok('workspace isolado criado para o teste', Boolean(workspaceId), JSON.stringify(workspace.dados))) return s;

    const trocou = await api.post('/api/sessao/workspace', { workspaceId });
    if (!s.ok('a sessao trocou para o workspace isolado', trocou.dados?.ok === true, JSON.stringify(trocou.dados))) return s;

    const simulador = await api.post('/api/conexoes', { nome: 'Simulador (teste excluir-tudo)', tipo: 'simulador' });
    const conexaoId = simulador.dados?.id;
    if (!s.ok('conexao de simulador criada no workspace isolado', Boolean(conexaoId), JSON.stringify(simulador.dados))) return s;

    const numeroNovo = () => `3292${String(Date.now()).slice(-6)}${Math.floor(Math.random() * 10)}`;
    const falar = (telefone) => api.post('/api/simulador/mensagem', { conexaoId, nome: 'Cliente de Teste', telefone, conteudo: 'oi' });

    const m1 = await falar(numeroNovo());
    const m2 = await falar(numeroNovo());
    if (!s.ok('as duas conversas de teste foram criadas', Boolean(m1.dados?.contatoId) && Boolean(m2.dados?.contatoId), JSON.stringify([m1.dados, m2.dados]))) {
      return s;
    }

    const previa = await api.post('/api/contatos/excluir-tudo', {});
    s.ok('sem confirmar, so avisa o total (2)', previa.dados?.confirmar === true && previa.dados?.total === 2, JSON.stringify(previa.dados));

    const aindaExiste = await api.get(`/api/contatos/${m1.dados.contatoId}`);
    s.ok('sem confirmar, a conversa de teste continua existindo', aindaExiste.status === 200, String(aindaExiste.status));

    const confirmado = await api.post('/api/contatos/excluir-tudo', { confirmar: true });
    s.ok('confirmando, apaga de verdade', confirmado.status === 200, JSON.stringify(confirmado.dados));
    s.ok('o total afetado bate com o total avisado antes (2)', confirmado.dados?.afetados === 2, JSON.stringify(confirmado.dados));

    const c1 = await api.get(`/api/contatos/${m1.dados.contatoId}`);
    const c2 = await api.get(`/api/contatos/${m2.dados.contatoId}`);
    s.ok('a primeira conversa de teste foi apagada', c1.status === 404, String(c1.status));
    s.ok('a segunda conversa de teste tambem', c2.status === 404, String(c2.status));

    const depois = (await api.get('/api/contatos', { limite: 1 })).dados || {};
    s.ok('nao sobra contato nenhum neste workspace', depois.total === 0, JSON.stringify(depois.total));
  } finally {
    await api.post('/api/sessao/workspace', { workspaceId: workspaceOriginalId });
  }

  return s;
}
