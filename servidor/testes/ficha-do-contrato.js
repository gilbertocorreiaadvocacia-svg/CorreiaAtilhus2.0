import { cliente, esperar, suite } from './apoio.js';

/**
 * A ficha do cliente de um contrato fechado, e o aviso que leva ate ela
 * (nucleo/ficha-do-contrato.js, rotas/integracoes.js).
 *
 * Pedido do escritorio em 11/11/2026: "todas as vezes que o contrato for
 * fechado ele tem que mandar um relatorio do cliente, dizer quem ou qual
 * agente fechou o contrato e mandar junto com a documentacao do cliente com
 * todos os dados".
 *
 * Assina um contrato pelo caminho de verdade (pedir -> aprovar -> ZapSign de
 * mentira -> webhook) e confere o que o escritorio pediu: a ficha tem os
 * dados, tem os documentos, diz quem fechou, e o aviso aponta para ela.
 */
export async function testarFichaDoContrato({ base, zapsign }) {
  const s = suite('Ficha do contrato fechado');
  const api = cliente(base);
  await api.entrar();
  const falsa = cliente(zapsign);

  const simulador = ((await api.get('/api/conexoes')).dados || []).find((c) => c.tipo === 'simulador');
  const bpc = ((await api.get('/api/etiquetas')).dados || []).find((e) => e.caso === 'bpc');
  if (!s.ok('ha simulador e o tipo de caso BPC', Boolean(simulador && bpc))) return s;

  const ate = async (fn, tentativas = 40) => {
    for (let i = 0; i < tentativas; i += 1) {
      const r = await fn();
      if (r) return r;
      await esperar(100);
    }
    return null;
  };

  await api.patch('/api/integracoes', {
    zapsign: { chave: 'zs-de-mentira', segredoWebhook: 'segredo-da-ficha', modeloPadraoId: 'mdl-contrato', envioDireto: false },
  });
  await api.post('/api/integracoes/zapsign/sincronizar', {});

  const contato = (await api.post('/api/contatos', { conexaoId: simulador.id, telefone: '5581980000911', nome: 'Cliente Da Ficha' })).dados;
  await api.patch(`/api/contatos/${contato.id}`, {
    variaveis: {
      cpf: '12345678909',
      endereco: 'Rua da Ficha, 10, Centro, Timbauba-PE, 55870-000',
      email: 'ficha@exemplo.com',
      nascimento: '12/03/1975',
    },
    etiquetas: [bpc.id],
  });

  /* Um documento do caso, para a ficha ter o que listar alem dos PDFs. */
  await api.post(`/api/contatos/${contato.id}/arquivos`, {
    nome: 'CNIS.pdf',
    conteudoBase64: `data:application/pdf;base64,${Buffer.from('%PDF-1.4 cnis de teste').toString('base64')}`,
    tipo: 'documento',
  });

  const pedido = await api.post(`/api/contatos/${contato.id}/contrato`, {});
  if (!s.ok('o contrato entra em conferencia', pedido.dados?.situacao === 'em_conferencia', JSON.stringify(pedido.dados))) return s;
  const contrato = ((await api.get(`/api/contratos?contatoId=${contato.id}`)).dados || [])[0];

  /* A ficha ja responde antes de assinar: ela e do CONTRATO, e serve para
     conferir a ficha do cliente na hora de aprovar, nao so depois. */
  const antes = await api.get(`/api/contratos/${contrato.id}/ficha`);
  s.ok('a ficha abre antes mesmo de assinar', antes.status === 200 && antes.dados?.cliente?.nome === 'Cliente Da Ficha', JSON.stringify(antes.dados?.cliente));

  const aprovado = await api.post(`/api/contratos/${contrato.id}/aprovar`, { valores: { '{{RG}}': '1234567 SDS/PE' } });
  if (!s.ok('aprovar da certo', aprovado.status === 200, JSON.stringify(aprovado.dados))) return s;

  const enviado = ((await api.get(`/api/contratos?contatoId=${contato.id}`)).dados || [])[0];
  await falsa.post('/__documento', { token: enviado.tokenExterno, status: 'signed' });
  await api.post('/v1/zapsign/webhook', { token: enviado.tokenExterno, status: 'signed' }, { cabecalhos: { 'x-correia-segredo': 'segredo-da-ficha' } });
  const assinou = await ate(async () => (((await api.get(`/api/contratos?contatoId=${contato.id}`)).dados || [])[0]?.situacao === 'assinado' ? true : null));
  if (!s.ok('o contrato fica assinado', assinou)) return s;

  /* ---------------- A ficha ---------------- */
  const ficha = (await api.get(`/api/contratos/${contrato.id}/ficha`)).dados;

  s.ok('a ficha diz que foi assinado e quando', ficha?.contrato?.situacao === 'assinado' && Boolean(ficha?.contrato?.assinadoEm), JSON.stringify(ficha?.contrato));
  s.ok(
    'e diz quem aprovou e enviou',
    ficha?.contrato?.aprovadoPor?.nome === 'Administrador',
    JSON.stringify(ficha?.contrato?.aprovadoPor),
  );

  /* Os dados do cliente, com rotulo legivel e sem campo vazio. */
  const porRotulo = Object.fromEntries((ficha?.dados || []).map((d) => [d.rotulo, d.valor]));
  s.ok('a ficha traz o CPF com rotulo legivel', porRotulo.CPF === '12345678909', JSON.stringify(porRotulo));
  s.ok('e o endereco, o e-mail e o nascimento', Boolean(porRotulo['Endereço'] && porRotulo['E-mail'] && porRotulo['Data de nascimento']), JSON.stringify(Object.keys(porRotulo)));
  s.ok('nenhum dado vem vazio', (ficha?.dados || []).every((d) => String(d.valor).trim()), JSON.stringify(ficha?.dados));
  s.ok('o telefone e a etiqueta do caso vem junto', Boolean(ficha?.cliente?.telefone) && (ficha?.cliente?.etiquetas || []).some((e) => /BPC/i.test(e.nome)), JSON.stringify(ficha?.cliente?.etiquetas));

  /* Os documentos: o que a equipe anexou E os PDFs que a ZapSign guardou. */
  const nomes = (ficha?.documentos || []).map((d) => d.nome);
  s.ok('a ficha lista o documento anexado pela equipe', nomes.includes('CNIS.pdf'), JSON.stringify(nomes));
  s.ok(
    'e o contrato assinado que a ZapSign guardou na conversa',
    nomes.some((n) => /contrato assinado/i.test(n)),
    JSON.stringify(nomes),
  );
  s.ok('cada documento vem com id, para a tela poder baixar', (ficha?.documentos || []).every((d) => d.id && d.nome), JSON.stringify(ficha?.documentos));

  /* ---------------- O aviso ---------------- */
  const notificacoes = (await api.get('/api/notificacoes')).dados;
  const lista = Array.isArray(notificacoes) ? notificacoes : notificacoes?.notificacoes || [];
  const aviso = lista.find((n) => n.tipo === 'contrato' && n.contratoId === contrato.id);
  s.ok('o aviso de contrato fechado carrega o contrato, para abrir a ficha', Boolean(aviso), JSON.stringify(lista.slice(0, 3)));
  s.ok(
    'e o texto do aviso ja diz quem fechou',
    /aprovado por Administrador/.test(aviso?.texto || ''),
    aviso?.texto || '(sem aviso)',
  );

  /* ---------------- Contrato que nao existe ---------------- */
  const inventado = await api.get('/api/contratos/ctr_naoexiste/ficha');
  s.ok('contrato que nao existe responde 404', inventado.status === 404, String(inventado.status));

  await api.patch('/api/integracoes', { zapsign: { chave: null, segredoWebhook: null, envioDireto: null } });
  return s;
}
