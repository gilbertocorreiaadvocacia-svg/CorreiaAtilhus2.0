import { cliente, suite } from './apoio.js';

/**
 * Migracao da LiderHub: importa status, etiquetas e departamento por contato
 * (servidor/integracoes/liderhub.js). A LiderHub de mentira esta em
 * servidor/testes/liderhub-falsa.js.
 *
 * O que nao pode falhar:
 *   - a PREVIA (simular) nao grava NADA: nem contato, nem etiqueta;
 *   - status sem coluna correspondente fica em branco e volta no relatorio;
 *   - o apelido do renome funciona ("Proposta enviada" -> "Preparar kit");
 *   - etiqueta nova e criada; contato sem telefone e pulado;
 *   - contato que ja existia e ATUALIZADO, nao duplicado.
 */

const soDigitos = (t) => String(t || '').replace(/\D+/g, '');

export async function testarLiderhub({ base }) {
  const s = suite('Migração da LiderHub');
  const api = cliente(base);
  await api.entrar();

  const conexoes = (await api.get('/api/conexoes')).dados || [];
  const conexao = conexoes[0];
  if (!s.ok('ha uma conexao para receber os contatos', Boolean(conexao))) return s;

  const todos = async () => (await api.get('/api/contatos?aba=todas&limite=200')).dados?.contatos || [];
  const acharPorTel = async (tel) => (await todos()).find((c) => soDigitos(c.telefone) === soDigitos(tel));
  const etiquetas = async () => (await api.get('/api/etiquetas')).dados || [];

  /* Um contato que ja existe: a importacao deve ATUALIZAR, nao duplicar. */
  await api.post('/api/contatos', { conexaoId: conexao.id, telefone: '558199990005', nome: 'Diego Antigo' });

  const contatosAntes = (await todos()).length;
  const etiquetasAntes = (await etiquetas()).length;

  await api.patch('/api/integracoes', { liderhub: { chave: 'lh-de-mentira' } });
  s.ok('a chave da LiderHub nunca volta em claro', (await api.get('/api/integracoes')).dados?.liderhub?.chave === '***');

  /* ---------------- Previa (nao grava) ---------------- */

  const previa = (await api.post('/api/integracoes/liderhub/importar', { simular: true })).dados;
  s.ok('a previa marca que e simulacao', previa?.simulacao === true, JSON.stringify(previa)?.slice(0, 200));
  s.ok('a previa conta os 5 contatos da LiderHub', previa?.totalLiderhub === 5, String(previa?.totalLiderhub));
  s.ok('a previa pula 1 sem telefone', previa?.semTelefone === 1, String(previa?.semTelefone));
  s.ok('a previa lista o status sem par', (previa?.statusSemPar || []).includes('Em negociação'), JSON.stringify(previa?.statusSemPar));
  s.ok('a previa lista o departamento sem par', (previa?.departamentoSemPar || []).includes('Marketing'), JSON.stringify(previa?.departamentoSemPar));
  s.ok('a previa aponta a etiqueta que seria criada', (previa?.etiquetasCriadas || []).includes('Cliente VIP'), JSON.stringify(previa?.etiquetasCriadas));
  s.ok('a previa NAO cria contato', (await todos()).length === contatosAntes, `${(await todos()).length} vs ${contatosAntes}`);
  s.ok('a previa NAO cria etiqueta', (await etiquetas()).length === etiquetasAntes, `${(await etiquetas()).length} vs ${etiquetasAntes}`);

  /* ---------------- Importacao de verdade ---------------- */

  const feito = (await api.post('/api/integracoes/liderhub/importar', { simular: false })).dados;
  s.ok('importou os 3 contatos novos', feito?.novos === 3, String(feito?.novos));
  s.ok('e atualizou o que ja existia', feito?.atualizados === 1, String(feito?.atualizados));

  const ana = await acharPorTel('558199990001');
  s.ok('Ana entrou com o status NOVO lead', ana?.status?.nome === 'NOVO lead', ana?.status?.nome);
  s.ok('Ana entrou no departamento Comercial', ana?.departamento?.nome === 'Comercial', ana?.departamento?.nome);

  const bruno = await acharPorTel('558199990002');
  s.ok('o apelido do renome funciona: Proposta enviada -> Preparar kit', bruno?.status?.nome === 'Preparar kit', bruno?.status?.nome);
  s.ok('departamento sem par fica em branco', !bruno?.departamento, bruno?.departamento?.nome || 'vazio');

  const carla = await acharPorTel('558199990003');
  s.ok('status sem par deixa o contato sem status', carla && !carla.status, carla?.status?.nome || 'sem status');

  s.ok('a etiqueta nova foi criada', (await etiquetas()).some((e) => e.nome === 'Cliente VIP'));
  const vip = (await etiquetas()).find((e) => e.nome === 'Cliente VIP');
  s.ok('e foi aplicada no contato', vip && (bruno?.etiquetas || []).includes(vip.id), JSON.stringify(bruno?.etiquetas));

  const semFone = (await todos()).find((c) => c.nome === 'Sem Telefone');
  s.ok('o contato sem telefone nao foi criado', !semFone);

  return s;
}
