import { cliente, suite } from './apoio.js';

/**
 * A bateria de teste de roteamento (aba "Testar roteamento" em Agentes,
 * POST /api/testes-de-roteamento/rodar) — pedido do escritorio em
 * 19/10/2026: testar se, ao falar de um beneficio, a conversa vai para o
 * agente certo. A mecanica de transferencia em si (Eduarda -> Andreia) ja e
 * testada a fundo em eduarda-roteamento.js; este teste cobre a ROTA da
 * bateria: ela manda a frase para o agente de ENTRADA da area (a conexao de
 * simulador nunca tem responsavelPadrao proprio, de proposito), espera a
 * resposta de verdade, e confere se quem ficou com a conversa bate com o
 * agente esperado do caso.
 */
const MARCA = 'Teste de roteamento';

export async function testarBateriaDeRoteamento({ base, anthropic }) {
  const s = suite('Bateria de teste de roteamento (Agentes)');
  const api = cliente(base);
  await api.entrar();
  const falsa = cliente(anthropic);
  const roteiro = (itens) => falsa.post('/__roteiro', { roteiro: itens, marca: MARCA });

  await api.patch('/api/integracoes', { ia: { chaveAnthropic: 'sk-ant-de-mentira' } });

  const criado = (await api.post('/api/workspaces/por-area', {})).dados;
  const previdenciario = (criado?.workspaces || []).find((w) => w.area === 'previdenciario');
  if (!s.ok('o escritorio Previdenciario existe (criado agora ou ja existia)', Boolean(previdenciario?.workspaceId))) return s;
  await api.post('/api/sessao/workspace', { workspaceId: previdenciario.workspaceId });

  const agentes = (await api.get('/api/agentes')).dados || [];
  const eduarda = agentes.find((a) => a.nome === 'Eduarda (Triagem)');
  const andreia = agentes.find((a) => a.nome === 'Andreia (BPC 1) Triagem');
  const beatriz = agentes.find((a) => a.nome === 'Beatriz (Triagem)');
  if (!s.ok('Eduarda, Andreia e Beatriz existem no pacote real', Boolean(eduarda && andreia && beatriz), JSON.stringify(agentes.map((a) => a.nome)))) {
    return s;
  }
  await api.patch(`/api/agentes/${eduarda.id}`, { ativo: true, delaySegundos: 60 });
  await api.patch(`/api/agentes/${andreia.id}`, { ativo: true, delaySegundos: 60 });

  const semConexaoDeSimulador = ((await api.get('/api/conexoes')).dados || []).find((c) => c.tipo === 'simulador');
  if (!s.ok('ha conexao de simulador no workspace', Boolean(semConexaoDeSimulador))) return s;

  /* ---------------- CRUD basico ---------------- */

  const semAgente = await api.post('/api/testes-de-roteamento', { frase: 'oi' });
  s.ok('criar sem agente esperado valido e recusado', semAgente.status >= 400, String(semAgente.status));

  const criadoCaso = await api.post('/api/testes-de-roteamento', { frase: 'Quero saber sobre o BPC LOAS da minha mae idosa', agenteEsperadoId: andreia.id });
  if (!s.ok('o caso de teste e criado', criadoCaso.status === 200 && Boolean(criadoCaso.dados?.id), JSON.stringify(criadoCaso.dados))) return s;
  const casoId = criadoCaso.dados.id;
  s.ok('a resposta ja traz o nome do agente esperado', criadoCaso.dados.agenteEsperado === 'Andreia (BPC 1) Triagem', criadoCaso.dados.agenteEsperado);

  const listados = (await api.get('/api/testes-de-roteamento')).dados || [];
  s.ok('o caso aparece na listagem', listados.some((c) => c.id === casoId), JSON.stringify(listados.map((c) => c.id)));

  const editado = await api.patch(`/api/testes-de-roteamento/${casoId}`, { frase: 'Minha mae tem deficiencia e nunca contribuiu com o INSS, posso pedir BPC?' });
  s.ok('editar a frase funciona', editado.dados?.frase?.includes('nunca contribuiu'), editado.dados?.frase);

  /* ---------------- Rodar: caso que PASSA (transfere para quem o teste espera) ---------------- */

  await roteiro([
    {
      status: 200,
      chamadas: [
        {
          nome: 'transferir_conversa',
          argumentos: {
            destino: 'Andreia (BPC 1) Triagem',
            resumo_para_proximo: 'Lead perguntou sobre BPC/LOAS.',
            mensagem_de_transicao: 'Olá! Sou a Eduarda, da equipe do escritório.',
          },
        },
      ],
    },
    { status: 200, texto: 'Olá! Sou a Andreia, vou te ajudar com o BPC/LOAS.' },
  ]);

  const rodada1 = await api.post('/api/testes-de-roteamento/rodar', {});
  if (!s.ok('rodar a bateria responde ok', rodada1.status === 200, JSON.stringify(rodada1.dados))) return s;
  const resultado1 = (rodada1.dados?.resultados || []).find((r) => r.casoId === casoId);
  s.ok('o caso aparece no resultado', Boolean(resultado1), JSON.stringify(rodada1.dados?.resultados));
  s.ok('passou: foi para a Andreia, como esperado', resultado1?.passou === true, JSON.stringify(resultado1));
  s.ok('o agente obtido no resultado e o nome certo', resultado1?.agenteObtido === 'Andreia (BPC 1) Triagem', resultado1?.agenteObtido);
  s.ok('o contatoId vem no resultado, para abrir a conversa de teste', Boolean(resultado1?.contatoId), JSON.stringify(resultado1));

  const conversaDeTeste = await api.get(`/api/contatos/${resultado1.contatoId}`);
  s.ok('a conversa de teste de verdade existe e ficou com a Andreia', conversaDeTeste.dados?.responsavel?.id === andreia.id, JSON.stringify(conversaDeTeste.dados?.responsavel));

  /* ---------------- Rodar de novo: caso que FALHA (transfere para o agente errado) ---------------- */

  await roteiro([
    {
      status: 200,
      chamadas: [
        {
          nome: 'transferir_conversa',
          argumentos: {
            destino: 'Beatriz (Triagem)',
            resumo_para_proximo: 'Lead perguntou sobre acidente (errado de proposito, para testar a falha).',
            mensagem_de_transicao: 'Olá! Sou a Eduarda.',
          },
        },
      ],
    },
    { status: 200, texto: 'Olá! Sou a Beatriz.' },
  ]);

  const rodada2 = await api.post('/api/testes-de-roteamento/rodar', {});
  const resultado2 = (rodada2.dados?.resultados || []).find((r) => r.casoId === casoId);
  s.ok(
    'passou: false quando vai para um agente diferente do esperado',
    resultado2?.passou === false && resultado2?.agenteObtido === 'Beatriz (Triagem)',
    JSON.stringify(resultado2),
  );

  /* ---------------- Excluir ---------------- */

  const excluido = await api.delete(`/api/testes-de-roteamento/${casoId}`);
  s.ok('excluir o caso funciona', excluido.status === 200, String(excluido.status));
  const depoisDeExcluir = (await api.get('/api/testes-de-roteamento')).dados || [];
  s.ok('o caso nao aparece mais na listagem', !depoisDeExcluir.some((c) => c.id === casoId), JSON.stringify(depoisDeExcluir.map((c) => c.id)));

  return s;
}
