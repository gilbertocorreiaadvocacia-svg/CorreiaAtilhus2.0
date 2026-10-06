import { cliente, esperar, suite } from './apoio.js';

/**
 * Relatorio de contratos fechados.
 *
 * Cria UM contrato assinado de verdade (pelo mesmo caminho da suite de
 * contratos: pedir -> aprovar -> ZapSign de mentira -> webhook assinado) e
 * confere que o relatorio conta certo:
 *  - entra no total e na pessoa que aprovou;
 *  - um contrato sem agente cai em "sem atribuicao" por agente;
 *  - periodo no passado nao conta o que foi assinado hoje;
 *  - a planilha sai com o nome e o total.
 *
 * Usa o delta (antes/depois), para nao depender de quantos contratos outras
 * suites deixaram assinados na mesma base.
 */
export async function testarRelatorios({ base, zapsign }) {
  const s = suite('Relatorios de contratos');
  const api = cliente(base);
  await api.entrar();
  const falsa = cliente(zapsign);

  const simulador = ((await api.get('/api/conexoes')).dados || []).find((c) => c.tipo === 'simulador');
  const bpc = ((await api.get('/api/etiquetas')).dados || []).find((e) => e.caso === 'bpc');
  if (!s.ok('ha simulador e o tipo de caso BPC', Boolean(simulador && bpc))) return s;

  /* O cliente de teste nao monta query a partir de objeto (so o api do front
     faz isso); aqui o periodo vai na propria URL. */
  const relatorio = async (qs = '') => (await api.get('/api/relatorios/contratos' + qs)).dados;
  const ate = async (fn, tentativas = 40) => {
    for (let i = 0; i < tentativas; i += 1) {
      const r = await fn();
      if (r) return r;
      await esperar(100);
    }
    return null;
  };

  const antes = await relatorio();
  if (!s.ok('o relatorio responde', antes && typeof antes.total === 'number', JSON.stringify(antes))) return s;
  const admin = 'Administrador';
  const pessoaAntes = (antes.porPessoa.lista.find((x) => x.nome === admin)?.quantidade) || 0;
  const semAgenteAntes = antes.porAgente.semAtribuicao || 0;

  /* --- Assina um contrato pelo caminho de verdade --------------------- */
  await api.patch('/api/integracoes', { zapsign: { chave: 'zs-de-mentira', segredoWebhook: 'segredo-do-rel' } });
  await api.post('/api/integracoes/zapsign/sincronizar', {});

  const contato = (await api.post('/api/contatos', { conexaoId: simulador.id, telefone: '5581980000777', nome: 'Cliente Relatorio' })).dados;
  await api.patch(`/api/contatos/${contato.id}`, {
    variaveis: { cpf: '12345678909', endereco: 'Rua do Relatorio, 10, Centro, Timbauba-PE, 55870-000', email: 'rel@exemplo.com' },
    etiquetas: [bpc.id],
  });
  const pedido = await api.post(`/api/contatos/${contato.id}/contrato`, {});
  if (!s.ok('o contrato entra em conferencia', pedido.dados?.situacao === 'em_conferencia', JSON.stringify(pedido.dados))) return s;
  const contrato = ((await api.get(`/api/contratos?contatoId=${contato.id}`)).dados || [])[0];

  const aprovado = await api.post(`/api/contratos/${contrato.id}/aprovar`, { valores: { '{{RG}}': '1234567 SDS/PE' } });
  if (!s.ok('aprovar da certo', aprovado.status === 200 && aprovado.dados?.ok, JSON.stringify(aprovado.dados))) return s;

  const enviado = ((await api.get(`/api/contratos?contatoId=${contato.id}`)).dados || [])[0];
  await falsa.post('/__documento', { token: enviado.tokenExterno, status: 'signed' });
  await api.post('/v1/zapsign/webhook', { token: enviado.tokenExterno, status: 'signed' }, { cabecalhos: { 'x-correia-segredo': 'segredo-do-rel' } });
  const assinou = await ate(async () => (((await api.get(`/api/contratos?contatoId=${contato.id}`)).dados || [])[0]?.situacao === 'assinado' ? true : null));
  if (!s.ok('o contrato fica assinado', assinou)) return s;

  /* --- O relatorio conta o contrato ----------------------------------- */
  const depois = await relatorio();
  s.ok('o total sobe em um', depois.total === antes.total + 1, `${antes.total} -> ${depois.total}`);
  const pessoaDepois = depois.porPessoa.lista.find((x) => x.nome === admin)?.quantidade || 0;
  s.ok('o contrato entra na pessoa que aprovou', pessoaDepois === pessoaAntes + 1, `${pessoaAntes} -> ${pessoaDepois}`);
  s.ok('um contrato sem agente cai em "sem atribuicao" por agente', (depois.porAgente.semAtribuicao || 0) === semAgenteAntes + 1, `${semAgenteAntes} -> ${depois.porAgente.semAtribuicao}`);

  /* --- Periodo ignora o que esta fora dele ---------------------------- */
  const passado = await relatorio('?de=2020-01-01&ate=2020-12-31');
  s.ok('periodo so no passado nao conta o que foi assinado hoje', passado.total === 0, String(passado.total));

  /* --- Planilha -------------------------------------------------------- */
  const planilha = await api.get('/api/relatorios/contratos.csv');
  s.ok('a planilha sai com o cabecalho e o total', /Total de contratos/.test(planilha.dados?.csv || ''), String(planilha.dados?.csv).slice(0, 120));
  s.ok('e traz a pessoa que aprovou', (planilha.dados?.csv || '').includes(admin), String(planilha.dados?.csv).slice(-200));

  /* Limpeza: tira a ZapSign para as suites seguintes nao herdarem a chave. */
  await api.patch('/api/integracoes', { zapsign: { chave: null, segredoWebhook: null } });
  return s;
}
