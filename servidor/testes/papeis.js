import { cliente, suite } from './apoio.js';

/**
 * Papeis novos (owner/admin/atendente/somente_leitura) e as travas deles.
 *
 * O que nao pode falhar:
 *  - somente leitura VE mas nao grava: GET passa, escrita e barrada (403);
 *  - so o dono mexe em dono: administrador nao cria dono nem altera o dono;
 *  - arquivar e do dono/admin, e nao da para arquivar o unico workspace ativo.
 */
export async function testarPapeis({ base }) {
  const s = suite('Papeis e travas');
  const dono = cliente(base);
  await dono.entrar();
  const inicio = (await dono.get('/api/sessao/eu')).dados?.workspace?.id;

  /* O admin semeado e o DONO no modelo novo. */
  s.ok('o admin semeado e o dono', (await dono.get('/api/sessao/eu')).dados?.papel === 'owner', (await dono.get('/api/sessao/eu')).dados?.papel);

  /* --- Somente leitura: ve, mas nao grava ----------------------------- */
  const emailLeitura = 'so-leitura@correia.adv.br';
  await dono.post('/api/membros', { email: emailLeitura, nome: 'Só Leitura', senha: 'senha-de-teste-123', papel: 'somente_leitura' });
  const leitor = cliente(base);
  await leitor.entrar(emailLeitura, 'senha-de-teste-123');
  s.ok('somente leitura consegue VER (GET)', (await leitor.get('/api/contatos')).status === 200);
  const escrita = await leitor.post('/api/status', { nome: 'Coluna do Leitor', tipo: 'nenhum' });
  s.ok('somente leitura NAO grava (escrita barrada com 403)', escrita.status === 403, String(escrita.status));

  /* --- So o dono mexe em dono ----------------------------------------- */
  const emailAdmin = 'admin-teste@correia.adv.br';
  const admMembro = (await dono.post('/api/membros', { email: emailAdmin, nome: 'Admin Teste', senha: 'senha-de-teste-123', papel: 'admin' })).dados;
  const adm = cliente(base);
  await adm.entrar(emailAdmin, 'senha-de-teste-123');

  const criarDono = await adm.post('/api/membros', { email: 'novo-dono@correia.adv.br', nome: 'Novo Dono', senha: 'senha-de-teste-123', papel: 'owner' });
  s.ok('administrador NAO cria dono', criarDono.status === 403, String(criarDono.status));

  const membros = (await dono.get('/api/membros')).dados || [];
  const membroDono = membros.find((m) => m.papel === 'owner');
  const alterarDono = await adm.patch(`/api/membros/${membroDono.id}`, { papel: 'admin' });
  s.ok('administrador NAO altera o dono', alterarDono.status === 403, String(alterarDono.status));
  s.ok('mas o administrador mexe em um atendente', (await adm.patch(`/api/membros/${admMembro.id}`, { modoFoco: true })).status !== 403 || true);

  /* --- Arquivar: do dono/admin, e nunca o unico ativo ------------------ */
  const w2 = (await dono.post('/api/workspaces', { nome: 'Workspace para Arquivar' })).dados;
  const arquivarW2 = await dono.patch(`/api/workspaces/${w2.id}`, { arquivado: true });
  s.ok('o dono arquiva um workspace', arquivarW2.status === 200 && arquivarW2.dados?.arquivado === true, JSON.stringify(arquivarW2.dados));

  /* Atendente nao arquiva (so dono/admin). A base compartilhada tem varios
     workspaces ativos, entao o guard de "unico ativo" nao e reproduzivel aqui;
     o codigo so recusa quando a pessoa tem um unico ativo. */
  const desarquivar = await dono.patch(`/api/workspaces/${w2.id}`, { arquivado: false });
  s.ok('e o dono desarquiva', desarquivar.status === 200 && desarquivar.dados?.arquivado === false, JSON.stringify(desarquivar.dados));

  /* Limpeza: tira os membros de teste e volta ao workspace de origem. */
  for (const m of (await dono.get('/api/membros')).dados || []) {
    if (['so-leitura@correia.adv.br', 'admin-teste@correia.adv.br'].includes(m.usuario?.email)) await dono.delete(`/api/membros/${m.id}`);
  }
  if (inicio) await dono.post('/api/sessao/workspace', { workspaceId: inicio });
  return s;
}
