import { cliente, esperar, suite } from './apoio.js';

/**
 * Contrato assinado vai para o Atilhus Juri (servidor/integracoes/atilhus-juri.js).
 *
 * O que nao pode falhar em silencio:
 *   - o pacote chega com os dados no vocabulario do Juri (CPF no campo, estado
 *     civil do enum, endereco em campos, area e especie pelas chaves de la);
 *   - o resumo e completo, mas nunca leva senha nem o CPF no texto;
 *   - reenviar nao abre outro caso;
 *   - Juri fora do ar deixa na fila, e a fila reenvia sozinha;
 *   - recusa por falha fechada nao fica batendo na porta.
 *
 * Dados do cliente inventados (o repositorio e publico).
 */

const TELEFONE = (sufixo) => `558195000${String(sufixo).padStart(4, '0')}`;

async function ate(condicao, ms = 6000) {
  const fim = Date.now() + ms;
  while (Date.now() < fim) {
    const valor = await condicao();
    if (valor) return valor;
    await esperar(100);
  }
  return null;
}

export async function testarJuri({ base, zapsign, juri }) {
  const s = suite('Contrato assinado vai para o Atilhus Juri');
  const api = cliente(base);
  await api.entrar();
  const falsoJuri = cliente(juri);
  const falsaZap = cliente(zapsign);
  const urlJuri = `${juri}/functions/v1/receber-contrato-assinado`;

  /* ---------------- Configuracao e teste de conexao ---------------- */

  const semNada = (await api.post('/api/integracoes/atilhus-juri/testar', {})).dados;
  s.ok('sem endereco, o teste diz o que falta', semNada?.ok === false && /endereco/i.test(semNada.erro || ''), JSON.stringify(semNada));

  await api.patch('/api/integracoes', { atilhusJuri: { url: urlJuri, segredo: 'segredo-errado', ativo: true } });
  const errado = (await api.post('/api/integracoes/atilhus-juri/testar', {})).dados;
  s.ok('com o segredo errado, o teste mostra a recusa', errado?.ok === false && /segredo/i.test(errado.erro || ''), JSON.stringify(errado));

  await api.patch('/api/integracoes', { atilhusJuri: { segredo: 'segredo-do-juri' } });
  s.ok('o segredo nunca volta em claro', (await api.get('/api/integracoes')).dados?.atilhusJuri?.segredo === '***');
  s.ok('com o segredo certo, o teste passa', (await api.post('/api/integracoes/atilhus-juri/testar', {})).dados?.ok === true);

  /* ---------------- Um contrato assinado ---------------- */

  await api.patch('/api/integracoes', {
    zapsign: { chave: 'zs-de-mentira', modeloPadraoId: 'mdl-contrato', procuracaoPadraoId: 'mdl-procuracao', modelosPorCaso: {} },
  });
  await api.post('/api/integracoes/zapsign/sincronizar', {});

  const conexoes = (await api.get('/api/conexoes')).dados || [];
  const simulador = conexoes.find((c) => c.tipo === 'simulador');
  const bpc = ((await api.get('/api/etiquetas')).dados || []).find((e) => e.caso === 'bpc');
  if (!s.ok('ha simulador e o tipo de caso BPC', Boolean(simulador && bpc))) return s;

  const contratoDe = async (id) => ((await api.get(`/api/contratos?contatoId=${id}`)).dados || [])[0];

  async function clienteAssinado(sufixo, idade) {
    const contato = (await api.post('/api/contatos', { conexaoId: simulador.id, telefone: TELEFONE(sufixo), nome: 'Joana Exemplo Juri' })).dados;
    await api.patch(`/api/contatos/${contato.id}`, {
      etiquetas: [bpc.id],
      variaveis: {
        cpf: '12345678909',
        idade: String(idade),
        nascimento: '10/05/1958',
        estado_civil: 'Casada',
        profissao: 'Agricultora',
        endereco: 'Rua Inventada, 10, Centro, Timbauba-PE, 55870-000',
        email: 'joana.exemplo@exemplo.com',
      },
    });
    await api.post(`/api/contatos/${contato.id}/mensagens`, { conteudo: 'Anotei: a senha do gov dela e Segredo123' });
    await api.post(`/api/contatos/${contato.id}/mensagens`, { conteudo: 'Conferindo o CPF 123.456.789-09 para o contrato' });
    await api.post(`/api/contatos/${contato.id}/contrato`, {});
    const contrato = await contratoDe(contato.id);
    await api.post(`/api/contratos/${contrato.id}/aprovar`, {});
    const enviado = await contratoDe(contato.id);
    await falsaZap.post('/__documento', { token: enviado.tokenExterno, status: 'signed' });
    await api.post(`/api/contratos/${contrato.id}/consultar`, {});
    return { contato, contratoId: contrato.id };
  }

  const primeiro = await clienteAssinado(1, 67);
  const enviado = await ate(async () => ((await contratoDe(primeiro.contato.id))?.juri?.situacao === 'enviado' ? true : null));
  s.ok('assinado, o contrato vai sozinho para o Juri', enviado, JSON.stringify((await contratoDe(primeiro.contato.id))?.juri));

  const recebidos = (await falsoJuri.get('/__recebidos')).dados || [];
  const pacote = recebidos[0] || {};
  s.ok('o Juri recebe um pacote so', recebidos.length === 1, `pacotes: ${recebidos.length}`);
  s.ok('com o CPF no campo proprio', pacote.contato?.documento === '12345678909');
  s.ok('estado civil no vocabulario do Juri', pacote.contato?.estado_civil === 'casado', pacote.contato?.estado_civil);
  s.ok('nascimento como data', pacote.contato?.nascimento === '1958-05-10', pacote.contato?.nascimento);
  s.ok(
    'endereco separado em campos',
    pacote.contato?.endereco?.municipio === 'Timbauba' && pacote.contato.endereco.uf === 'PE' && pacote.contato.endereco.cep === '55870000' && pacote.contato.endereco.bairro === 'Centro',
    JSON.stringify(pacote.contato?.endereco),
  );
  s.ok(
    'area e especie pelas chaves do Juri (BPC com 67 anos e idoso)',
    pacote.caso?.area_juri === 'previdenciario_administrativo' && pacote.caso?.especie_chave === 'bpc_idoso',
    JSON.stringify(pacote.caso),
  );
  s.ok('o resumo traz a conversa', /Conversa/.test(pacote.resumo || ''));
  s.ok('e nunca a senha', !/Segredo123/.test(pacote.resumo || '') && !/senha/i.test(pacote.resumo || ''));
  s.ok('nem o CPF no texto', !/123\.?456\.?789-?09/.test(pacote.resumo || ''));
  s.ok(
    'o contrato e a procuracao assinados vao junto',
    ['contrato', 'procuracao'].every((tipo) => (pacote.documentos || []).some((d) => d.tipo === tipo)) &&
      Buffer.from(pacote.documentos?.[0]?.base64 || '', 'base64').toString('utf8').startsWith('%PDF'),
  );

  const depois = (await api.get(`/api/contatos/${primeiro.contato.id}`)).dados;
  s.ok('a conversa fica com o momento Enviado ao Juri', depois?.momento?.nome === 'Enviado ao Juri', JSON.stringify(depois?.momento));
  s.ok('e o contrato guarda o caso aberto la', (await contratoDe(primeiro.contato.id))?.juri?.casoId === 'caso-1');

  const reenvio = (await api.post(`/api/contratos/${primeiro.contratoId}/juri`, {})).dados;
  s.ok('reenviar nao abre outro caso: o Juri responde repetido', reenvio?.ok && reenvio.repetido === true, JSON.stringify(reenvio));
  s.ok('e o Juri continua com um caso so', ((await falsoJuri.get('/__recebidos')).dados || []).length === 1);

  /* ---------------- Juri fora do ar ---------------- */

  await falsoJuri.post('/__modo', { status: 500 });
  const segundo = await clienteAssinado(2, 40);
  const naFila = await ate(async () => ((await contratoDe(segundo.contato.id))?.juri?.situacao === 'falhou' ? true : null));
  s.ok('com o Juri fora do ar, o contrato fica na fila', naFila, JSON.stringify((await contratoDe(segundo.contato.id))?.juri));
  await falsoJuri.post('/__modo', { status: 200 });
  const voltou = await ate(async () => ((await contratoDe(segundo.contato.id))?.juri?.situacao === 'enviado' ? true : null));
  s.ok('e a fila reenvia sozinha quando o Juri volta', voltou, JSON.stringify((await contratoDe(segundo.contato.id))?.juri));
  const ultimo = ((await falsoJuri.get('/__recebidos')).dados || []).at(-1);
  s.ok('BPC abaixo de 65 anos vai como deficiente', ultimo?.caso?.especie_chave === 'bpc_def', JSON.stringify(ultimo?.caso));

  /* ---------------- Falha fechada ---------------- */

  await falsoJuri.post('/__modo', { status: 422 });
  const terceiro = await clienteAssinado(3, 70);
  const recusou = await ate(async () => ((await contratoDe(terceiro.contato.id))?.juri?.situacao === 'recusado' ? true : null));
  s.ok('recusa do Juri por falha fechada vai para a equipe', recusou, JSON.stringify((await contratoDe(terceiro.contato.id))?.juri));
  const tentativasAntes = (await contratoDe(terceiro.contato.id))?.juri?.tentativas || 0;
  await esperar(700);
  s.ok(
    'e nao fica tentando sozinho',
    ((await contratoDe(terceiro.contato.id))?.juri?.situacao === 'recusado') && ((await contratoDe(terceiro.contato.id))?.juri?.tentativas || 0) === tentativasAntes,
  );

  /* ---------------- Limpeza ---------------- */

  await falsoJuri.post('/__modo', { status: 200 });
  await api.patch('/api/integracoes', { atilhusJuri: { url: '', segredo: null, ativo: false }, zapsign: { chave: null } });
  for (const c of [primeiro, segundo, terceiro]) await api.delete(`/api/contatos/${c.contato.id}`);
  return s;
}
