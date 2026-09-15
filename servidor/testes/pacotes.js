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
  s.ok(
    'cada squad fica na area dele',
    doPacote.filter((a) => /\[trab\]/.test(a.nome)).every((a) => a.area === 'trabalhista') &&
      doPacote.filter((a) => /Eduarda|BPC|Materno|aux acidente/.test(a.nome)).every((a) => a.area === 'previdenciario'),
    JSON.stringify(doPacote.map((a) => [a.nome, a.area])),
  );
  const secretaria = doPacote.find((a) => a.nome === 'Eduarda (Triagem)');
  s.ok(
    'a Eduarda recebe as ferramentas de passar e de etiquetar',
    ['transferir_conversa', 'adicionar_etiqueta'].every((f) => (secretaria?.ferramentas || []).includes(f)),
    (secretaria?.ferramentas || []).join(', '),
  );
  const dados = doPacote.find((a) => a.nome === 'AG07 [trab] Dados e Contrato');
  s.ok(
    'o AG07 recebe variaveis e a lista do que coletar',
    (dados?.ferramentas || []).includes('salvar_variavel') && (dados?.requisitos || []).includes('rg'),
    `${(dados?.ferramentas || []).join(', ')} | ${JSON.stringify(dados?.requisitos)}`,
  );

  /* O que os prompts citam pelo nome passa a existir no escritorio. */
  const nomes = (lista) => (Array.isArray(lista) ? lista : []).map((x) => x.nome);
  const etiquetas = nomes((await api.get('/api/etiquetas')).dados);
  s.ok('cria as etiquetas citadas', ['Objeção', 'Já é cliente', 'Rescisão indireta'].every((n) => etiquetas.includes(n)), JSON.stringify(etiquetas));
  s.ok('cria o departamento Suporte', nomes((await api.get('/api/departamentos')).dados).includes('Suporte'));
  const templates = (await api.get('/api/templates')).dados;
  const atalhos = (Array.isArray(templates) ? templates : templates?.templates || []).map((t) => t.atalho);
  s.ok('cria os templates citados', ['oab', 'propostatrabalhista', 'avaliacao'].every((a) => atalhos.includes(a)), JSON.stringify(atalhos));

  /* Instalar de novo: nada duplica, e o prompt editado fica. */
  const tamanhoPrevidenciario = lista.find((p) => p.area === 'previdenciario')?.agentes.length;
  if (secretaria) await api.patch(`/api/agentes/${secretaria.id}`, { prompt: `${secretaria.prompt}\nAFINADO PELO ESCRITORIO` });
  const deNovo = (await api.post('/api/agentes-pacotes/previdenciario', { conexaoId: simulador?.id })).dados;
  s.ok(
    'instalar de novo nao cria nada',
    deNovo?.criados?.length === 0 && deNovo?.mantidos?.length === tamanhoPrevidenciario && !deNovo?.removidos?.length,
    JSON.stringify(deNovo),
  );
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
