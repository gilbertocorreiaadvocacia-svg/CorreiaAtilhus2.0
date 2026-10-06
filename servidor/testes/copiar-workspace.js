import { cliente, suite } from './apoio.js';

/**
 * Criar um workspace copiando a configuracao de outro.
 *
 * O que nao pode falhar: a copia duplica os registros com IDS NOVOS, as
 * referencias apontam para DENTRO da copia (status -> departamento e template
 * daqui, agente -> base daqui), a MIDIA e duplicada (arquivo proprio, nunca
 * compartilhado nem apontando para fora), e o agente copiado entra desligado.
 */
export async function testarCopiarWorkspace({ base }) {
  const s = suite('Copiar workspace');
  const api = cliente(base);
  await api.entrar();
  /* De onde a sessao comecou: volto para ca no fim, para a proxima suite (e o
     proximo login, que agora abre no ultimo workspace usado) nao herdar a fonte. */
  const inicio = (await api.get('/api/sessao/eu')).dados?.workspace?.id;

  /* --- Uma fonte controlada, com referencias entre si ------------------ */
  const fonte = (await api.post('/api/workspaces', { nome: 'Fonte de Cópia' })).dados;
  if (!s.ok('a fonte foi criada', Boolean(fonte?.id), JSON.stringify(fonte))) return s;
  await api.post('/api/sessao/workspace', { workspaceId: fonte.id });

  const dep = (await api.post('/api/departamentos', { nome: 'Vendas Fonte' })).dados;
  const baseConhecimento = (await api.post('/api/conhecimento', { nome: 'Objeções Fonte', conteudo: 'texto base' })).dados;
  const midia = (
    await api.post('/api/midia', {
      nome: 'arquivo-fonte.txt',
      mime: 'text/plain',
      conteudoBase64: `data:text/plain;base64,${Buffer.from('conteudo-da-fonte').toString('base64')}`,
    })
  ).dados;
  const tpl = (await api.post('/api/templates', { nome: 'Boas-vindas Fonte', atalho: 'bvfonte', conteudo: 'Oi {{nome}}', midia })).dados;
  const status1 = (
    await api.post('/api/status', { nome: 'Etapa Fonte', tipo: 'nenhum', departamentoId: dep.id, followups: [{ templateId: tpl.id, minutos: 60 }] })
  ).dados;
  const agente = (await api.post('/api/agentes', { nome: 'Agente Fonte', conhecimentoIds: [baseConhecimento.id] })).dados;
  if (!s.ok('a fonte tem dept, base, template com midia, status e agente', Boolean(dep?.id && baseConhecimento?.id && tpl?.id && status1?.id && agente?.id), JSON.stringify({ dep, tpl, status1, agente }))) {
    return s;
  }

  /* --- A copia --------------------------------------------------------- */
  const copia = (
    await api.post('/api/workspaces', {
      nome: 'Cópia da Fonte',
      copiarDe: fonte.id,
      copiar: ['agentes', 'templates', 'etiquetas', 'departamentos', 'status', 'conhecimento'],
    })
  ).dados;
  if (!s.ok('a copia foi criada', Boolean(copia?.id), JSON.stringify(copia))) return s;
  await api.post('/api/sessao/workspace', { workspaceId: copia.id });

  const deps = (await api.get('/api/departamentos')).dados || [];
  const bases = (await api.get('/api/conhecimento')).dados || [];
  const tpls = (await api.get('/api/templates')).dados || [];
  const statuses = (await api.get('/api/status')).dados || [];
  const agentes = (await api.get('/api/agentes')).dados || [];

  const depCopia = deps.find((d) => d.nome === 'Vendas Fonte');
  const baseCopia = bases.find((b) => b.nome === 'Objeções Fonte');
  const tplCopia = tpls.find((t) => t.nome === 'Boas-vindas Fonte');
  const statusCopia = statuses.find((x) => x.nome === 'Etapa Fonte');
  const agenteCopia = agentes.find((a) => a.nome === 'Agente Fonte');

  s.ok('os registros aparecem na copia', Boolean(depCopia && baseCopia && tplCopia && statusCopia && agenteCopia), JSON.stringify({ depCopia: depCopia?.nome, tplCopia: tplCopia?.nome, statusCopia: statusCopia?.nome, agenteCopia: agenteCopia?.nome }));
  if (!depCopia || !tplCopia || !statusCopia || !agenteCopia || !baseCopia) return s;

  s.ok('com ids novos, nao os da fonte', depCopia.id !== dep.id && tplCopia.id !== tpl.id && statusCopia.id !== status1.id && agenteCopia.id !== agente.id);
  s.ok('o status cai no departamento DAQUI', statusCopia.departamentoId === depCopia.id, `${statusCopia.departamentoId} vs ${depCopia.id}`);
  s.ok('o follow-up aponta para o template DAQUI', statusCopia.followups?.[0]?.templateId === tplCopia.id, JSON.stringify(statusCopia.followups));
  s.ok('o agente consulta a base DAQUI, nao a da fonte', (agenteCopia.conhecimentoIds || []).includes(baseCopia.id) && !(agenteCopia.conhecimentoIds || []).includes(baseConhecimento.id), JSON.stringify(agenteCopia.conhecimentoIds));
  s.ok('o agente copiado entra desligado', agenteCopia.ativo === false, String(agenteCopia.ativo));
  s.ok('a midia foi DUPLICADA (arquivo proprio)', Boolean(tplCopia.midia?.arquivo) && tplCopia.midia.arquivo !== midia.arquivo, JSON.stringify({ copia: tplCopia.midia?.arquivo, fonte: midia.arquivo }));
  s.ok('a midia aponta para o storage do sistema, nunca para fora', /^\/midia\//.test(tplCopia.midia?.url || ''), String(tplCopia.midia?.url));

  /* --- Resumo (contadores do seletor) ---------------------------------- */
  const resumo = (await api.get('/api/workspaces/resumo')).dados || [];
  const rCopia = resumo.find((r) => r.id === copia.id);
  s.ok('o resumo traz membros e numeros da copia', Boolean(rCopia) && rCopia.membros >= 1 && typeof rCopia.conexoes === 'number', JSON.stringify(rCopia));

  /* --- Isolamento: a fonte nao foi alterada pela copia ----------------- */
  await api.post('/api/sessao/workspace', { workspaceId: fonte.id });
  const agentesFonte = (await api.get('/api/agentes')).dados || [];
  s.ok('a fonte continua intacta (o agente dela segue la)', agentesFonte.some((a) => a.id === agente.id), JSON.stringify(agentesFonte.map((a) => a.nome)));

  /* Volta para onde comecou. */
  if (inicio) await api.post('/api/sessao/workspace', { workspaceId: inicio });
  return s;
}
