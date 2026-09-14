import { cliente, suite } from './apoio.js';

/**
 * Pacotes de agentes por area (servidor/ia/pacotes.js).
 *
 * O que nao pode quebrar: instalar duas vezes nao duplica nem sobrescreve o
 * prompt que o escritorio afinou; todo prompt passa do minimo recomendado; e
 * nenhuma mencao fica invalida — mencao invalida e agente sem a ferramenta, e
 * isso nao da erro nenhum na tela, so um agente que "esquece" de agir.
 */
export async function testarPacotes({ base }) {
  const s = suite('Pacotes de agentes por area');
  const api = cliente(base);
  await api.entrar();

  const lista = (await api.get('/api/agentes-pacotes')).dados || [];
  s.ok(
    'ha um pacote para cada area',
    JSON.stringify(lista.map((p) => p.area).sort()) === JSON.stringify(['civel', 'previdenciario', 'trabalhista']),
    JSON.stringify(lista.map((p) => p.area)),
  );

  const conexoes = (await api.get('/api/conexoes')).dados || [];
  const simulador = conexoes.find((c) => c.tipo === 'simulador');
  const responsavelAntes = simulador?.responsavelPadrao || null;
  const areaAntes = simulador?.area || null;

  const criadosAqui = [];
  for (const pacote of lista) {
    const r = (await api.post(`/api/agentes-pacotes/${pacote.area}`, {})).dados;
    criadosAqui.push(...(r?.criados || []));
    s.ok(`o pacote ${pacote.nome} cria os ${pacote.agentes.length} agentes`, r?.criados?.length === pacote.agentes.length, JSON.stringify(r));
  }

  const agentes = (await api.get('/api/agentes')).dados || [];
  const doPacote = agentes.filter((a) => criadosAqui.some((c) => c.id === a.id));
  s.ok('cada agente nasce com a area do pacote', doPacote.every((a) => ['previdenciario', 'trabalhista', 'civel'].includes(a.area)));
  s.ok(
    'todo prompt passa do minimo recomendado (1.500 caracteres)',
    doPacote.every((a) => (a.prompt || '').length >= 1500),
    doPacote.filter((a) => (a.prompt || '').length < 1500).map((a) => `${a.nome}: ${a.prompt.length}`).join(', '),
  );
  s.ok(
    'nenhuma mencao invalida nos prompts',
    doPacote.every((a) => !(a.mencoesInvalidas || []).length),
    doPacote.filter((a) => (a.mencoesInvalidas || []).length).map((a) => `${a.nome}: ${a.mencoesInvalidas.join(',')}`).join(' | '),
  );
  const secretaria = doPacote.find((a) => a.nome === 'Secretária Previdenciária');
  s.ok(
    'a secretaria recebe as ferramentas de passar, etiquetar e marcar momento',
    ['transferir_conversa', 'adicionar_etiqueta', 'definir_momento'].every((f) => (secretaria?.ferramentas || []).includes(f)),
    (secretaria?.ferramentas || []).join(', '),
  );
  const especialista = doPacote.find((a) => a.nome === 'Especialista Auxílio-doença');
  s.ok(
    'o especialista recebe agenda, variaveis e a lista do que coletar',
    ['agenda', 'salvar_variavel'].every((f) => (especialista?.ferramentas || []).includes(f)) &&
      (especialista?.requisitos || []).includes('ctps_foto'),
    `${(especialista?.ferramentas || []).join(', ')} | ${JSON.stringify(especialista?.requisitos)}`,
  );

  /* Instalar de novo: nada duplica, e o prompt editado fica. */
  if (secretaria) await api.patch(`/api/agentes/${secretaria.id}`, { prompt: `${secretaria.prompt}\nAFINADO PELO ESCRITORIO` });
  const deNovo = (await api.post('/api/agentes-pacotes/previdenciario', { conexaoId: simulador?.id })).dados;
  s.ok('instalar de novo nao cria nada', deNovo?.criados?.length === 0 && deNovo?.mantidos?.length === 6, JSON.stringify(deNovo));
  const depois = ((await api.get('/api/agentes')).dados || []).find((a) => a.id === secretaria?.id);
  s.ok('e nao sobrescreve o prompt afinado', /AFINADO PELO ESCRITORIO/.test(depois?.prompt || ''));

  const conexao = ((await api.get('/api/conexoes')).dados || []).find((c) => c.id === simulador?.id);
  s.ok(
    'com um numero escolhido, ele vira da area e a secretaria responde por ele',
    conexao?.area === 'previdenciario' && conexao?.responsavelPadrao?.id === secretaria?.id,
    JSON.stringify({ area: conexao?.area, responsavel: conexao?.responsavelPadrao }),
  );

  s.ok('area sem pacote e recusada', (await api.post('/api/agentes-pacotes/inventada', {})).status === 404);

  /* Limpeza: o numero volta como estava e os agentes do teste saem. */
  if (simulador) await api.patch(`/api/conexoes/${simulador.id}`, { area: areaAntes, responsavelPadrao: responsavelAntes });
  for (const agente of criadosAqui) await api.delete(`/api/agentes/${agente.id}`);

  return s;
}
