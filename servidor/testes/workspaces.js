import { cliente, suite } from './apoio.js';

/**
 * Um workspace por area (servidor/nucleo/workspaces-por-area.js).
 *
 * O que precisa ficar verdadeiro para o escritorio poder ligar um numero em
 * cada area sem uma fila vazar na outra:
 *   - os dois nascem, e rodar de novo nao duplica;
 *   - cada um tem numero proprio, sem agente respondendo ate a configuracao
 *     chegar, e so os tipos de caso e contratos da propria area;
 *   - a chave da IA e a conta da ZapSign vem junto, sem voltar em claro;
 *   - no Previdenciario, os agentes separados por beneficio;
 *   - o workspace de origem nao muda.
 */
export async function testarWorkspacesPorArea({ base }) {
  const s = suite('Workspaces por area');
  const api = cliente(base);
  await api.entrar();

  const origem = (await api.get('/api/sessao/eu')).dados?.workspace;
  if (!s.ok('ha um workspace de origem', Boolean(origem?.id))) return s;

  await api.patch('/api/integracoes', {
    ia: { chaveAnthropic: 'sk-ant-para-copiar' },
    zapsign: {
      chave: 'zs-para-copiar',
      modelosPorCaso: { bpc: { contratoId: 'mdl-bpc' }, trabalhista: { contratoId: 'mdl-trabalhista' } },
    },
  });

  const criado = await api.post('/api/workspaces/por-area', {});
  s.ok(
    'cria o Previdenciario e o Trabalhista',
    criado.status === 200 && (criado.dados?.workspaces || []).filter((w) => w.situacao === 'criado').length === 2,
    JSON.stringify(criado.dados),
  );
  const deNovo = (await api.post('/api/workspaces/por-area', {})).dados;
  s.ok('rodar de novo nao duplica', (deNovo?.workspaces || []).every((w) => w.situacao === 'ja existia'), JSON.stringify(deNovo));

  const lista = (await api.get('/api/sessao/eu')).dados?.workspaces || [];
  const previdenciario = lista.find((w) => w.area === 'previdenciario');
  const trabalhista = lista.find((w) => w.area === 'trabalhista');
  s.ok('os dois aparecem no seletor, junto do de origem', Boolean(previdenciario && trabalhista) && lista.some((w) => w.id === origem.id));
  if (!previdenciario || !trabalhista) return s;

  const entrar = (w) => api.post('/api/sessao/workspace', { workspaceId: w.id });

  /* ---------------- Trabalhista ---------------- */

  await entrar(trabalhista);
  const numeros = (await api.get('/api/conexoes')).dados || [];
  s.ok(
    'Trabalhista: numero proprio por QR Code, sem agente respondendo ainda',
    numeros.some((c) => c.tipo === 'qrcode' && c.area === 'trabalhista' && !c.responsavelPadrao),
    JSON.stringify(numeros.map((c) => [c.nome, c.tipo, c.area, c.responsavelPadrao])),
  );
  s.ok('Trabalhista: tem o Chat de teste', numeros.some((c) => c.tipo === 'simulador'));

  const casosTrabalhistas = ((await api.get('/api/etiquetas')).dados || []).filter((e) => e.tipo === 'caso').map((e) => e.caso);
  s.ok('Trabalhista: so o tipo de caso trabalhista', JSON.stringify(casosTrabalhistas) === JSON.stringify(['trabalhista']), JSON.stringify(casosTrabalhistas));

  const agentesTrabalhistas = (await api.get('/api/agentes')).dados || [];
  s.ok(
    'Trabalhista: os agentes da area, desligados ate a configuracao chegar',
    agentesTrabalhistas.length === 8 && agentesTrabalhistas.every((a) => !a.ativo && a.area === 'trabalhista'),
    JSON.stringify(agentesTrabalhistas.map((a) => [a.nome, a.ativo, a.area])),
  );
  s.ok('Trabalhista: nenhuma mencao invalida nos agentes', agentesTrabalhistas.every((a) => !(a.mencoesInvalidas || []).length));

  const integracoesTrabalhistas = (await api.get('/api/integracoes')).dados;
  s.ok(
    'Trabalhista: chave da IA e da ZapSign copiadas, sem voltar em claro',
    integracoesTrabalhistas?.ia?.chaveAnthropic === '***' && integracoesTrabalhistas?.zapsign?.chave === '***',
  );
  s.ok(
    'Trabalhista: so o contrato do caso trabalhista',
    JSON.stringify(Object.keys(integracoesTrabalhistas?.zapsign?.modelosPorCaso || {})) === JSON.stringify(['trabalhista']),
    JSON.stringify(integracoesTrabalhistas?.zapsign?.modelosPorCaso),
  );
  const funil = (await api.get('/api/status')).dados || [];
  s.ok('Trabalhista: o funil vem com os momentos', funil.some((x) => x.nome === 'Em triagem' && (x.momentos || []).length));
  const semConversa = (await api.get('/api/contatos?aba=todas&limite=5')).dados;
  s.ok('Trabalhista: nasce sem conversa nenhuma', (semConversa?.total ?? (semConversa?.contatos || []).length) === 0, JSON.stringify(semConversa?.total));

  /* ---------------- Previdenciario ---------------- */

  await entrar(previdenciario);
  const agentesPrevidenciarios = (await api.get('/api/agentes')).dados || [];
  const pastas = [...new Set(agentesPrevidenciarios.map((a) => a.pasta))];
  s.ok(
    'Previdenciario: agentes separados por beneficio',
    ['Triagem', 'BPC/LOAS', 'Auxílio-acidente', 'Salário-maternidade'].every((p) => pastas.includes(p)),
    JSON.stringify(pastas),
  );
  s.ok('Previdenciario: todos desligados', agentesPrevidenciarios.length === 15 && agentesPrevidenciarios.every((a) => !a.ativo));
  s.ok(
    'Previdenciario: nenhuma mencao invalida nos agentes',
    agentesPrevidenciarios.every((a) => !(a.mencoesInvalidas || []).length),
    agentesPrevidenciarios.filter((a) => (a.mencoesInvalidas || []).length).map((a) => `${a.nome}: ${a.mencoesInvalidas.join(',')}`).join(' | '),
  );

  /* Substituir: os agentes de antes saem, com copia, e o que apontava para eles passa para a Eduarda. */
  const numeroDaArea = ((await api.get('/api/conexoes')).dados || []).find((c) => c.tipo === 'qrcode');
  const umAntigo = agentesPrevidenciarios[agentesPrevidenciarios.length - 1];
  if (numeroDaArea && umAntigo) {
    await api.patch(`/api/conexoes/${numeroDaArea.id}`, { responsavelPadrao: { tipo: 'agente', id: umAntigo.id, nome: umAntigo.nome } });
  }
  const troca = (await api.post('/api/agentes-pacotes/previdenciario', { substituir: true })).dados;
  s.ok(
    'Substituir: tira os agentes de antes e poe os do pacote, com copia guardada',
    troca?.removidos?.length === 15 && troca?.criados?.length === 15 && /^agentes-.+\.json$/.test(troca?.copia || ''),
    JSON.stringify({ removidos: troca?.removidos?.length, criados: troca?.criados?.length, copia: troca?.copia }),
  );
  const depoisDaTroca = (await api.get('/api/agentes')).dados || [];
  s.ok(
    'Substituir: nenhum agente antigo sobra',
    depoisDaTroca.length === 15 && !depoisDaTroca.some((a) => agentesPrevidenciarios.some((antigo) => antigo.id === a.id)),
    JSON.stringify(depoisDaTroca.map((a) => a.nome)),
  );
  const numeroDepois = ((await api.get('/api/conexoes')).dados || []).find((c) => c.id === numeroDaArea?.id);
  s.ok(
    'Substituir: o numero que apontava para um agente antigo passa para a Eduarda',
    numeroDepois?.responsavelPadrao?.nome === 'Eduarda (Triagem)' && depoisDaTroca.some((a) => a.id === numeroDepois.responsavelPadrao.id),
    JSON.stringify(numeroDepois?.responsavelPadrao),
  );

  const casosPrevidenciarios = ((await api.get('/api/etiquetas')).dados || [])
    .filter((e) => e.tipo === 'caso')
    .map((e) => e.caso)
    .sort();
  s.ok(
    'Previdenciario: os quatro tipos de caso do INSS',
    JSON.stringify(casosPrevidenciarios) === JSON.stringify(['auxilio', 'auxilio_acidente', 'bpc', 'maternidade']),
    JSON.stringify(casosPrevidenciarios),
  );
  const integracoesPrevidenciarias = (await api.get('/api/integracoes')).dados;
  s.ok(
    'Previdenciario: so os contratos dos casos do INSS',
    JSON.stringify(Object.keys(integracoesPrevidenciarias?.zapsign?.modelosPorCaso || {})) === JSON.stringify(['bpc']),
    JSON.stringify(integracoesPrevidenciarias?.zapsign?.modelosPorCaso),
  );
  s.ok('Previdenciario: as bases de conhecimento vem junto', ((await api.get('/api/conhecimento')).dados || []).length >= 1);
  s.ok(
    'Previdenciario: numero proprio',
    ((await api.get('/api/conexoes')).dados || []).some((c) => c.tipo === 'qrcode' && c.area === 'previdenciario'),
  );

  /* ---------------- A origem nao mudou ---------------- */

  await entrar(origem);
  s.ok('volta para o workspace de origem', (await api.get('/api/sessao/eu')).dados?.workspace?.id === origem.id);
  s.ok(
    'e ele continua com todos os tipos de caso',
    ((await api.get('/api/etiquetas')).dados || []).filter((e) => e.tipo === 'caso').length === 6,
  );

  await api.patch('/api/integracoes', { ia: { chaveAnthropic: null }, zapsign: { chave: null, modelosPorCaso: {} } });
  return s;
}
