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
export async function testarDiagnostico({ base, anthropic }) {
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

  /* --- Chave gravada nao e chave que funciona -------------------------- */

  /*
   * Este teste existe por causa de um engano de verdade: a chave foi
   * cadastrada, o achado "sem inteligencia artificial" sumiu do painel, e o
   * critico foi dado por resolvido. Nao estava — a Anthropic recusava toda
   * chamada, e a diferenca so apareceria quando um cliente escrevesse e o
   * agente nao respondesse. No disco, chave boa e chave recusada sao um texto
   * que comeca com sk-ant-.
   */
  await api.patch('/api/integracoes', { ia: { chaveAnthropic: 'sk-ant-de-mentira-para-o-teste' } });
  const soGravada = await diagnosticar();
  s.ok(
    'chave gravada e nunca testada vira achado proprio',
    tem(soGravada, 'ia-nao-testada'),
    JSON.stringify((soGravada.achados || []).map((a) => a.id)),
  );
  s.ok('e o critico de "sem IA" some, porque agora ha chave', !tem(soGravada, 'ia-sem-chave'));

  /*
   * Agora a recusa DE VERDADE. A Anthropic de mentira aceita qualquer chave,
   * entao sem encomendar o erro este teste passaria pelo motivo errado — foi o
   * que aconteceu na primeira versao dele.
   *
   * A mensagem e a que a Anthropic mandou de verdade no dia: chave de
   * organizacao em vez de chave de workspace.
   */
  const RECUSA = 'This API key is not scoped to a workspace';
  await cliente(anthropic).post('/__roteiro', {
    roteiro: [{ status: 400, mensagem: `${RECUSA}, so this request must include the anthropic-workspace-id header.` }],
  });

  const testou = await api.post('/api/integracoes/ia/testar', {});
  s.ok('o teste da chave responde', testou.status === 200, JSON.stringify(testou.dados));
  s.ok('e reconhece a recusa em vez de dar por boa', testou.dados?.ok === false, JSON.stringify(testou.dados));

  const recusada = await diagnosticar();
  s.ok(
    'chave recusada vira achado CRITICO, e nao some do painel',
    achar(recusada, 'ia-teste-falhou')?.severidade === 'critica',
    JSON.stringify((recusada.achados || []).map((a) => [a.id, a.severidade])),
  );
  s.ok(
    'o achado carrega o motivo da recusa, para nao virar adivinhacao',
    String(achar(recusada, 'ia-teste-falhou')?.detalhe || '').includes(RECUSA),
    achar(recusada, 'ia-teste-falhou')?.detalhe,
  );
  s.ok('e o aviso de "nunca testada" da lugar ao de recusa', !tem(recusada, 'ia-nao-testada'));

  /* Limpa a fila da Anthropic de mentira para as suites seguintes. */
  await cliente(anthropic).post('/__roteiro', { roteiro: [] });

  /* --- A chave ligada a identidade, e o cabecalho que ela exige ---------- */

  /*
   * Em 30/09/2026 o escritorio cadastrou a chave e a Anthropic recusou toda
   * chamada: era uma chave ligada a identidade de quem a criou, e nao uma
   * chave de workspace. Chave assim nao carrega onde ela vale — toda chamada
   * precisa dizer, no cabecalho anthropic-workspace-id. Nem era 401: a chave
   * estava certa, so faltava o endereco.
   *
   * O que nao pode falhar: o cabecalho vai quando ha workspace configurado, e
   * NAO vai quando nao ha. Mandar vazio seria pior do que nao mandar — a chave
   * de workspace, que ja carrega o seu, seria recusada por contradicao.
   */
  const falsa = cliente(anthropic);
  const ultimaChamada = async () => {
    const { chamadas } = (await falsa.get('/__chamadas')).dados;
    return chamadas[chamadas.length - 1] || null;
  };

  await api.patch('/api/integracoes', { ia: { workspaceAnthropic: '' } });
  await api.post('/api/integracoes/ia/testar', {});
  s.ok(
    'sem workspace configurado, o cabecalho NAO e mandado',
    (await ultimaChamada())?.workspace === null,
    JSON.stringify(await ultimaChamada()),
  );

  await api.patch('/api/integracoes', { ia: { workspaceAnthropic: 'wrkspc_01DeTeste' } });
  await api.post('/api/integracoes/ia/testar', {});
  s.ok(
    'com workspace configurado, o cabecalho vai junto',
    (await ultimaChamada())?.workspace === 'wrkspc_01DeTeste',
    JSON.stringify(await ultimaChamada()),
  );

  const salvo = (await api.get('/api/integracoes')).dados;
  s.ok(
    'e o id do workspace volta visivel na tela, para conferir se foi colado certo',
    salvo?.ia?.workspaceAnthropic === 'wrkspc_01DeTeste',
    JSON.stringify(salvo?.ia?.workspaceAnthropic),
  );

  /*
   * O escritorio colou "Atilhus Chat" — o NOME do workspace, que e o que esta
   * escrito na tela da Anthropic. O id fica no endereco. Sem conferir na hora
   * de salvar, o erro so apareceria quando um cliente escrevesse e o agente
   * nao respondesse: o pior lugar possivel para descobrir um erro de colagem.
   */
  const comNome = await api.patch('/api/integracoes', { ia: { workspaceAnthropic: 'Atilhus Chat' } });
  s.ok('o NOME do workspace no lugar do id e recusado', comNome.status === 400, `status ${comNome.status}`);
  s.ok(
    'e o recado explica a diferenca entre nome e id',
    /wrkspc_/.test(String(comNome.dados?.erro || '')) && /nome/i.test(String(comNome.dados?.erro || '')),
    JSON.stringify(comNome.dados),
  );

  /* Quem cola o endereco inteiro acerta: e o gesto natural de quem esta
     olhando para a pagina do workspace. */
  await api.patch('/api/integracoes', {
    ia: { workspaceAnthropic: 'https://console.anthropic.com/settings/workspaces/wrkspc_01ABCdef/members' },
  });
  const recortado = (await api.get('/api/integracoes')).dados;
  s.ok(
    'colar o endereco inteiro funciona: o id e recortado de dentro',
    recortado?.ia?.workspaceAnthropic === 'wrkspc_01ABCdef',
    JSON.stringify(recortado?.ia?.workspaceAnthropic),
  );

  await api.patch('/api/integracoes', { ia: { workspaceAnthropic: '' } });

  /* Tira a chave de mentira: as suites seguintes contam com o modo por regras. */
  await api.patch('/api/integracoes', { ia: { chaveAnthropic: null } });
  const semChave = await diagnosticar();
  s.ok('tirada a chave, o painel volta a acusar a falta dela', tem(semChave, 'ia-sem-chave'));
  s.ok('e para de falar em teste', !tem(semChave, 'ia-nao-testada') && !tem(semChave, 'ia-teste-falhou'));

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
