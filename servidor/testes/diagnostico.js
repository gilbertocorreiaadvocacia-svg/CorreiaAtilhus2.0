import { cliente, suite } from './apoio.js';

/**
 * O sistema conferindo a si mesmo (nucleo/diagnostico.js).
 *
 * O que nao pode falhar: o diagnostico precisa ACHAR o defeito enquanto ele
 * existe e PARAR de acusar depois de corrigido. Um diagnostico que acusa
 * sempre vira ruido e todo mundo aprende a ignorar; um que nunca acusa e uma
 * tela verde mentindo. Os dois lados sao testados aqui, para cada achado.
 *
 * E a lista descreve como o escritorio esta montado por dentro, entao quem nao
 * configura nao le: isso tambem e testado.
 */
export async function testarDiagnostico({ base }) {
  const s = suite('Diagnostico do sistema');
  const api = cliente(base);
  await api.entrar();

  const diagnosticar = async () => (await api.get('/api/diagnostico')).dados || {};
  const tem = (saude, id) => (saude.achados || []).some((a) => a.id === id);
  const achar = (saude, id) => (saude.achados || []).find((a) => a.id === id) || null;

  /* --- Sem chave de IA: o defeito que derruba todo o resto ------------- */

  /* Sem ler o estado da chave, este teste passaria pelo motivo errado caso uma
     suite anterior deixasse a chave de mentira para tras. A pergunta e a
     mesma nos dois sentidos: acusa quando falta, cala quando tem. */
  const integracoes = (await api.get('/api/integracoes')).dados || {};
  const temChave = Boolean(integracoes.ia?.chaveAnthropic);

  const inicial = await diagnosticar();
  s.ok(
    temChave
      ? 'com chave de IA cadastrada, o diagnostico nao acusa modo degradado'
      : 'sem chave de IA, o diagnostico acusa e marca como critico',
    temChave ? !tem(inicial, 'ia-sem-chave') : achar(inicial, 'ia-sem-chave')?.severidade === 'critica',
    JSON.stringify((inicial.achados || []).map((a) => [a.id, a.severidade])),
  );
  if (!temChave) {
    s.ok('o achado diz onde se resolve', achar(inicial, 'ia-sem-chave')?.onde === '#/integracoes');
    s.ok('o resumo conta o critico', inicial.resumo?.critica >= 1, JSON.stringify(inicial.resumo));
  }

  /* --- Conexao sem status/departamento padrao -------------------------- */

  const criada = await api.post('/api/conexoes', { nome: 'Diagnostico (sem padrao)', tipo: 'simulador' });
  const conexaoId = criada.dados?.id;
  if (!s.ok('conexao de teste criada', Boolean(conexaoId), JSON.stringify(criada.dados))) return s;

  /* O simulador nao conta: ele existe para experimentar, e um numero de
     mentira sem status padrao nao perde lead nenhum. So numero de verdade. */
  const comSimulador = await diagnosticar();
  const acusouSimulador = (achar(comSimulador, 'conexao-sem-padrao')?.detalhe || '').includes('Diagnostico (sem padrao)');
  s.ok('o simulador sem status padrao nao vira alarme', !acusouSimulador);

  const real = await api.post('/api/conexoes', { nome: 'Diagnostico (QR sem padrao)', tipo: 'qrcode' });
  const realId = real.dados?.id;
  if (!s.ok('conexao de QR Code criada', Boolean(realId), JSON.stringify(real.dados))) return s;

  const semPadrao = await diagnosticar();
  s.ok(
    'numero de verdade sem status padrao e acusado, com o nome dele',
    (achar(semPadrao, 'conexao-sem-padrao')?.detalhe || '').includes('Diagnostico (QR sem padrao)'),
    JSON.stringify(achar(semPadrao, 'conexao-sem-padrao')),
  );

  const status = (await api.get('/api/status')).dados || [];
  const departamentos = (await api.get('/api/departamentos')).dados || [];
  await api.patch(`/api/conexoes/${realId}`, {
    statusPadraoId: status[0]?.id,
    departamentoPadraoId: departamentos[0]?.id,
  });

  const corrigida = await diagnosticar();
  s.ok(
    'depois de preencher os padroes, o numero sai da lista',
    !(achar(corrigida, 'conexao-sem-padrao')?.detalhe || '').includes('Diagnostico (QR sem padrao)'),
    JSON.stringify(achar(corrigida, 'conexao-sem-padrao')),
  );

  /* --- Agente citando um atalho que nao existe ------------------------- */

  const agente = await api.post('/api/agentes', {
    nome: 'Diagnostico (mencao torta)',
    /* Uma mencao de uma palavra so, que e o que o analisador le, e que
       seguramente nao existe em catalogo nenhum. */
    prompt: 'Quando o cliente fechar, mova para @ColunaQueNuncaExistiu.',
    ativo: true,
  });
  const agenteId = agente.dados?.id;
  if (!s.ok('agente de teste criado', Boolean(agenteId), JSON.stringify(agente.dados))) return s;

  const comMencao = await diagnosticar();
  s.ok(
    'agente que cita atalho inexistente e acusado',
    (achar(comMencao, 'mencao-invalida')?.detalhe || '').includes('Diagnostico (mencao torta)'),
    JSON.stringify(achar(comMencao, 'mencao-invalida')),
  );

  await api.patch(`/api/agentes/${agenteId}`, { prompt: 'Atenda com educacao e pergunte o nome.' });
  const semMencao = await diagnosticar();
  s.ok(
    'corrigido o prompt, o agente sai da lista',
    !(achar(semMencao, 'mencao-invalida')?.detalhe || '').includes('Diagnostico (mencao torta)'),
    JSON.stringify(achar(semMencao, 'mencao-invalida')),
  );

  /* --- Fila humana: a IA promete uma pessoa, precisa existir a pessoa --- */

  const antesDoAtendente = await diagnosticar();
  const tinhaAviso = tem(antesDoAtendente, 'sem-atendente');

  await api.post('/api/membros', {
    nome: 'Atendente do diagnostico',
    email: 'diagnostico@correia.adv.br',
    senha: 'diagnostico2026',
    papel: 'suporte',
  });

  const comAtendente = await diagnosticar();
  s.ok(
    'com um atendente humano cadastrado, o aviso de fila vazia some',
    !tem(comAtendente, 'sem-atendente'),
    `antes tinha aviso: ${tinhaAviso}`,
  );

  /* --- Quem nao configura nao le -------------------------------------- */

  const suporte = cliente(base);
  const entrou = await suporte.entrar('diagnostico@correia.adv.br', 'diagnostico2026');
  if (s.ok('o atendente consegue entrar', entrou.status === 200, JSON.stringify(entrou.dados))) {
    const negado = await suporte.get('/api/diagnostico');
    s.ok('e o diagnostico e negado para quem nao configura', negado.status === 403, `status ${negado.status}`);
  }

  /* Limpa o que esta suite criou: a fila de conversas das outras suites e
     contada, e conexao de mentira sobrando entra na conta de alguem. */
  await api.delete(`/api/conexoes/${conexaoId}`);
  await api.delete(`/api/conexoes/${realId}`);
  await api.delete(`/api/agentes/${agenteId}`);

  return s;
}
