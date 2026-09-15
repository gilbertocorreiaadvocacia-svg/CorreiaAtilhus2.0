import { cliente, esperar, suite } from './apoio.js';

/**
 * Contrato e procuracao pela ZapSign, com uma pessoa conferindo antes
 * (servidor/integracoes/zapsign.js).
 *
 * As tres coisas que nao podem falhar em silencio:
 *   - NADA vai para a ZapSign antes de uma pessoa aprovar;
 *   - o mesmo cliente nao recebe dois contratos;
 *   - assinado, o PDF fica guardado e o evento para o Atilhus Juri sai uma vez.
 *
 * Os dados do cliente abaixo sao inventados (o repositorio e publico).
 */

const TELEFONE = (sufixo) => `558194000${String(sufixo).padStart(4, '0')}`;

async function ate(condicao, ms = 5000) {
  const fim = Date.now() + ms;
  while (Date.now() < fim) {
    const valor = await condicao();
    if (valor) return valor;
    await esperar(100);
  }
  return null;
}

export async function testarContratos({ base, zapsign }) {
  const s = suite('Contrato pela ZapSign, com conferencia');
  const api = cliente(base);
  await api.entrar();
  const falsa = cliente(zapsign);
  const chamadasDa = async (rota) => ((await falsa.get('/__chamadas')).dados || []).filter((c) => c.rota === rota);

  /* ---------------- Configuracao ---------------- */

  await api.patch('/api/integracoes', { zapsign: { chave: 'zs-de-mentira', segredoWebhook: 'segredo-do-teste' } });
  const sincronizado = (await api.post('/api/integracoes/zapsign/sincronizar', {})).dados;
  s.ok(
    'a sincronizacao traz os modelos com as variaveis',
    sincronizado?.ok && (sincronizado.modelos.find((m) => m.id === 'mdl-contrato')?.variaveis || []).includes('{{CPF}}'),
    JSON.stringify(sincronizado),
  );
  await api.patch('/api/integracoes', {
    zapsign: {
      modeloPadraoId: 'mdl-contrato',
      procuracaoPadraoId: 'mdl-procuracao',
      modelosPorCaso: { bpc: { contratoId: 'mdl-contrato-bpc', procuracaoId: 'mdl-procuracao' } },
    },
  });
  s.ok('o segredo do webhook nunca volta em claro', (await api.get('/api/integracoes')).dados?.zapsign?.segredoWebhook === '***');

  const conexoes = (await api.get('/api/conexoes')).dados || [];
  const simulador = conexoes.find((c) => c.tipo === 'simulador');
  const bpc = ((await api.get('/api/etiquetas')).dados || []).find((e) => e.caso === 'bpc');
  if (!s.ok('ha simulador e o tipo de caso BPC', Boolean(simulador && bpc))) return s;

  const criar = async (sufixo) =>
    (await api.post('/api/contatos', { conexaoId: simulador.id, telefone: TELEFONE(sufixo), nome: 'Maria Exemplo Contrato' })).dados;
  const pedir = async (id) => (await api.post(`/api/contatos/${id}/contrato`, {})).dados;
  const contratosDe = async (id) => (await api.get(`/api/contratos?contatoId=${id}`)).dados || [];
  const conversa = async (id) => (await api.get(`/api/contatos/${id}`)).dados;
  const dadosCompletos = {
    cpf: '12345678909',
    endereco: 'Rua Inventada, 10, Centro, Timbauba-PE, 55870-000',
    email: 'maria.exemplo@exemplo.com',
  };

  /* ---------------- Pedido: dado faltando ---------------- */

  const c1 = await criar(1);
  const semDados = await pedir(c1.id);
  s.ok(
    'sem CPF, o pedido volta dizendo o que falta',
    semDados?.ok === false && (semDados.faltando || []).includes('cpf'),
    JSON.stringify(semDados),
  );
  s.ok('e nenhum contrato e criado', (await contratosDe(c1.id)).length === 0);

  /* ---------------- Pedido: vai para conferencia ---------------- */

  await api.patch(`/api/contatos/${c1.id}`, { variaveis: dadosCompletos, etiquetas: [bpc.id] });
  const pedido = await pedir(c1.id);
  s.ok('com os dados, o contrato fica em conferencia', pedido?.ok && pedido.situacao === 'em_conferencia', JSON.stringify(pedido));
  s.ok('nada foi para a ZapSign antes de uma pessoa conferir', (await chamadasDa('create-doc')).length === 0);

  const emConferencia = await conversa(c1.id);
  s.ok('a conversa vai para Assinatura pendente', emConferencia?.status?.nome === 'Assinatura pendente', emConferencia?.status?.nome);
  s.ok('com o momento Contrato em conferencia', emConferencia?.momento?.nome === 'Contrato em conferencia', JSON.stringify(emConferencia?.momento));

  await pedir(c1.id);
  const lista = await contratosDe(c1.id);
  s.ok('pedir de novo nao duplica o contrato', lista.length === 1, `contratos: ${lista.length}`);
  s.ok(
    'a lista de contratos traz o telefone da conversa, para a tela de Contratos',
    String(lista[0]?.telefone || '').endsWith('0001'),
    JSON.stringify(lista[0]?.telefone),
  );
  const contrato = lista[0];
  s.ok('o valor do modelo vem das variaveis da conversa', contrato?.valores?.['{{CPF}}'] === '12345678909', JSON.stringify(contrato?.valores));

  /* ---------------- Aprovar ---------------- */

  s.ok('RG em branco nao impede o pedido: fica para quem confere', contrato?.valores?.['{{RG}}'] === '');
  s.ok('nacionalidade padrao e cidade tirada do endereco', contrato?.valores?.['{{NACIONALIDADE}}'] === 'brasileira' && contrato?.valores?.['{{CIDADE}}'] === 'Timbauba', JSON.stringify(contrato?.valores));

  const corrigido = 'Rua Corrigida, 20, Centro, Timbauba-PE, 55870-000';
  const semRg = await api.post(`/api/contratos/${contrato.id}/aprovar`, { valores: { '{{ENDERECO}}': corrigido } });
  s.ok('mas sem RG a conferencia nao deixa enviar', semRg.status === 400 && /rg/i.test(semRg.dados?.erro || ''), JSON.stringify(semRg.dados));
  s.ok('e nada foi para a ZapSign nessa tentativa', (await chamadasDa('create-doc')).length === 0);

  const aprovado = await api.post(`/api/contratos/${contrato.id}/aprovar`, {
    valores: { '{{ENDERECO}}': corrigido, '{{RG}}': '1234567 SDS/PE' },
  });
  s.ok('aprovar da certo', aprovado.status === 200 && aprovado.dados?.ok, JSON.stringify(aprovado.dados));

  const criados = await chamadasDa('create-doc');
  s.ok('o documento nasce na ZapSign uma vez', criados.length === 1, `create-doc: ${criados.length}`);
  s.ok('com o modelo do tipo de caso', criados[0]?.corpo?.template_id === 'mdl-contrato-bpc', criados[0]?.corpo?.template_id);
  s.ok('amarrado ao contrato daqui', criados[0]?.corpo?.external_id === contrato.id);
  s.ok(
    'com a correcao feita na conferencia',
    (criados[0]?.corpo?.data || []).some((d) => d.de === '{{ENDERECO}}' && d.para === corrigido),
    JSON.stringify(criados[0]?.corpo?.data),
  );
  const extras = await chamadasDa('upload-extra-doc');
  s.ok(
    'a procuracao que ja vem anexada ao contrato do caso nao e enviada de novo',
    extras.length === 0,
    JSON.stringify(extras),
  );

  const enviado = (await contratosDe(c1.id))[0];
  s.ok('o contrato fica com link enviado', enviado?.situacao === 'link_enviado' && /verificar/.test(enviado.link || ''), JSON.stringify(enviado));
  const mensagens = (await api.get(`/api/contatos/${c1.id}/mensagens`)).dados;
  const saidas = (Array.isArray(mensagens) ? mensagens : mensagens?.mensagens || []).filter((m) => m.direcao === 'saida');
  s.ok('o link sai na conversa', saidas.some((m) => (m.conteudo || '').includes(enviado?.link)));
  s.ok('e o momento vira Link enviado', (await conversa(c1.id))?.momento?.nome === 'Link enviado');

  s.ok('aprovar de novo e recusado', (await api.post(`/api/contratos/${contrato.id}/aprovar`, {})).status === 400);

  const reenvio = await pedir(c1.id);
  s.ok('pedir com o link ja enviado so reenvia o link', reenvio?.reenviado === true && (await chamadasDa('create-doc')).length === 1, JSON.stringify(reenvio));

  /* ---------------- Acompanhamento ---------------- */

  await falsa.post('/__documento', { token: enviado.tokenExterno, signatario: 'link-opened' });
  const aberto = await ate(async () => ((await contratosDe(c1.id))[0]?.situacao === 'link_aberto' ? true : null));
  s.ok('o acompanhamento percebe sozinho que o cliente abriu o link', aberto);
  s.ok('e o momento vira Link aberto', (await conversa(c1.id))?.momento?.nome === 'Link aberto');

  /* ---------------- Webhook ---------------- */

  const webhook = (segredo, corpo) => api.post('/v1/zapsign/webhook', corpo, { cabecalhos: { 'x-correia-segredo': segredo } });
  s.ok('webhook com segredo errado e recusado', (await webhook('errado', { token: enviado.tokenExterno })).status === 401);
  s.ok('documento que nao e daqui e ignorado', (await webhook('segredo-do-teste', { token: 'doc-de-outro-sistema' })).dados?.ignorado === true);

  await falsa.post('/__documento', { token: enviado.tokenExterno, status: 'signed' });
  s.ok('webhook com o segredo certo e aceito', (await webhook('segredo-do-teste', { token: enviado.tokenExterno, status: 'signed' })).status === 200);
  const assinado = await ate(async () => ((await contratosDe(c1.id))[0]?.situacao === 'assinado' ? true : null));
  s.ok('assinado, o contrato fica assinado', assinado);

  const depois = await conversa(c1.id);
  const guardados = (depois?.arquivos || []).filter((a) => a.enviadoPor === 'ZapSign');
  s.ok(
    'o contrato e a procuracao assinados ficam na nuvem da conversa',
    guardados.some((a) => a.tipo === 'contrato') && guardados.some((a) => a.tipo === 'procuracao'),
    JSON.stringify(guardados),
  );
  const pdf = guardados[0] ? await api.get(`/api/contatos/${c1.id}/arquivos/${guardados[0].id}`) : null;
  s.ok('e o arquivo guardado e o PDF', /^%PDF/.test(pdf?.texto || ''));
  s.ok('a conversa vai para Contrato assinado', depois?.status?.nome === 'Contrato assinado', depois?.status?.nome);

  await api.post(`/api/contratos/${contrato.id}/consultar`, {});
  const logs = (await api.get(`/api/contatos/${c1.id}/logs`)).dados || [];
  s.ok(
    'o evento contrato_assinado sai uma vez so',
    logs.filter((l) => l.tipo === 'gancho' && /contrato_assinado/.test(l.descricao || '')).length === 1,
    logs.filter((l) => l.tipo === 'gancho').map((l) => l.descricao).join(' | '),
  );
  s.ok('e consultar de novo nao baixa o PDF outra vez', ((await conversa(c1.id))?.arquivos || []).filter((a) => a.enviadoPor === 'ZapSign').length === guardados.length);

  /* ---------------- Devolver ---------------- */

  const c2 = await criar(2);
  await api.patch(`/api/contatos/${c2.id}`, { variaveis: dadosCompletos });
  await pedir(c2.id);
  const doSegundo = (await contratosDe(c2.id))[0];
  s.ok('sem tipo de caso, vale o modelo padrao', doSegundo?.modelo?.contratoId === 'mdl-contrato', JSON.stringify(doSegundo?.modelo));
  s.ok('devolver sem dizer o motivo e recusado', (await api.post(`/api/contratos/${doSegundo.id}/devolver`, {})).status === 400);
  const devolvido = await api.post(`/api/contratos/${doSegundo.id}/devolver`, { motivo: 'O CPF veio com um digito a menos' });
  s.ok('devolver com motivo da certo', devolvido.status === 200);
  const c2depois = await conversa(c2.id);
  s.ok(
    'o agente recebe o motivo como passagem',
    (c2depois?.passagens || []).some((p) => /digito a menos/.test(p.resumo || '')),
    JSON.stringify(c2depois?.passagens),
  );
  s.ok('e o contrato devolvido nao pode ser aprovado', (await api.post(`/api/contratos/${doSegundo.id}/aprovar`, {})).status === 400);
  s.ok('pedir de novo depois de devolver cria outro para conferir', (await pedir(c2.id))?.situacao === 'em_conferencia');

  /* ---------------- Limpeza ---------------- */

  await api.patch('/api/integracoes', { zapsign: { chave: null, segredoWebhook: null } });
  for (const c of [c1, c2]) await api.delete(`/api/contatos/${c.id}`);
  return s;
}
