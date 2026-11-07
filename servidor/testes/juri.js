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

  /* ---------------- Botao do cartao "Contrato fechado" ---------------- */

  const cartao = (await api.get(`/api/contatos/${primeiro.contato.id}`)).dados;
  s.ok('o cartao ja sabe que o contrato foi ao Juri (campo juri enviado)', cartao?.juri?.situacao === 'enviado', JSON.stringify(cartao?.juri));

  const reContato = (await api.post(`/api/contatos/${primeiro.contato.id}/enviar-juri`, {})).dados;
  s.ok('o botao do cartao reenvia pelo contato, sem duplicar', reContato?.ok && reContato.repetido === true, JSON.stringify(reContato));
  s.ok('e o Juri segue com um caso so depois do botao', ((await falsoJuri.get('/__recebidos')).dados || []).length === 1);

  const semContrato = (await api.post('/api/contatos', { conexaoId: simulador.id, telefone: TELEFONE(9), nome: 'Sem Contrato' })).dados;
  const semEnvio = await api.post(`/api/contatos/${semContrato.id}/enviar-juri`, {});
  s.ok('sem contrato assinado, o botao recusa com aviso claro', semEnvio.status === 400 && /assinado/i.test(semEnvio.dados?.erro || ''), JSON.stringify(semEnvio.dados));

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

  /* ---------------- "Contrato fechado" sem ter passado pelo ZapSign (06/11/2026) ----------------
   * Pedido do escritorio: TODA conversa que entra num status "sucesso" vai ao
   * Juri, nao so a que foi assinada por aqui — a maioria nunca passa pelo
   * ZapSign (fechada a mao, importada do historico). O que nao pode falhar:
   *  - vai sozinha, com o resumo e a nuvem de arquivos da conversa, NUNCA um
   *    token de contrato de verdade;
   *  - sem CPF ou sem tipo de caso, recusa com motivo claro, sem travar nada;
   *  - quem JA tem um contrato assinado nunca manda pelos dois caminhos (isso
   *    abriria dois casos no Juri para o mesmo cliente);
   *  - sair do status e voltar nao abre um segundo caso;
   *  - Juri fora do ar deixa na fila e reenvia sozinho, como o outro caminho.
   */

  await falsoJuri.post('/__modo', { status: 200 });
  const todosOsStatus = (await api.get('/api/status')).dados || [];
  const emAnalise = todosOsStatus.find((st) => st.nome === 'Em análise');
  const fechado = todosOsStatus.find((st) => st.nome === 'Contrato fechado');
  if (!s.ok('ha os status "Em análise" e "Contrato fechado"', Boolean(emAnalise && fechado))) return s;

  const contatosDoFechamento = [];
  async function leadFechado(sufixo, variaveis, { comEtiqueta = true, antesDeFechar } = {}) {
    const contato = (
      await api.post('/api/contatos', { conexaoId: simulador.id, telefone: TELEFONE(sufixo), nome: `Fechamento Sem Contrato ${sufixo}` })
    ).dados;
    contatosDoFechamento.push(contato.id);
    await api.patch(`/api/contatos/${contato.id}`, {
      statusId: emAnalise.id,
      etiquetas: comEtiqueta ? [bpc.id] : [],
      variaveis,
    });
    await api.post(`/api/contatos/${contato.id}/mensagens`, { conteudo: 'Fechamos direto com o cliente, por fora do sistema.' });
    if (antesDeFechar) await antesDeFechar(contato);
    await api.patch(`/api/contatos/${contato.id}`, { statusId: fechado.id });
    return contato;
  }
  const juriDoFechamentoDe = async (id) => (await api.get(`/api/contatos/${id}`)).dados?.juriDoFechamento;

  const dadosCompletos = { cpf: '98765432100', idade: '70', nascimento: '10/05/1956', estado_civil: 'Casada', endereco: 'Rua Inventada, 20, Centro, Timbauba-PE, 55870-000' };

  /* O arquivo precisa estar na nuvem ANTES do status virar "fechado": o
     disparo para o Juri e assincrono e dispara na hora, sem esperar um
     upload que so comecasse depois. */
  const quarto = await leadFechado(4, dadosCompletos, {
    antesDeFechar: (contato) =>
      api.post(`/api/contatos/${contato.id}/arquivos`, { nome: 'rg.jpg', tipo: 'rg', conteudoBase64: 'data:image/jpeg;base64,/9j/4AAQSkZJRgABAQEAYABgAAD/2wBDAAEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQH/2wBDAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQH/wAARCAABAAEDASIAAhEBAxEB/8QAHwAAAQUBAQEBAQEAAAAAAAAAAAECAwQFBgcICQoL/8QAtRAAAgEDAwIEAwUFBAQAAAF9AQIDAAQRBRIhMUEGE1FhByJxFDKBkaEII0KxwRVS0fAkM2JyggkKFhcYGRolJicoKSo0NTY3ODk6Q0RFRkdISUpTVFVWV1hZWmNkZWZnaGlqc3R1dnd4eXqDhIWGh4iJipKTlJWWl5iZmqKjpKWmp6ipqrKztLW2t7i5usLDxMXGx8jJytLT1NXW19jZ2uHi4+Tl5ufo6erx8vP09fb3+Pn6/8QAHwEAAwEBAQEBAQEBAQAAAAAAAAECAwQFBgcICQoL/8QAtREAAgECBAQDBAcFBAQAAQJ3AAECAxEEBSExBhJBUQdhcRMiMoEIFEKRobHBCSMzUvAVYnLRChYkNOEl8RcYGRomJygpKjU2Nzg5OkNERUZHSElKU1RVVldYWVpjZGVmZ2hpanN0dXZ3eHl6goOEhYaHiImKkpOUlZaXmJmaoqOkpaanqKmqsrO0tba3uLm6wsPExcbHyMnK0tPU1dbX2Nna4uPk5ebn6Onq8vP09fb3+Pn6/9oADAMBAAIRAxEAPwD9/KKKKAP/2Q==' }),
  });
  const foiEnviado = await ate(async () => ((await juriDoFechamentoDe(quarto.id))?.situacao === 'enviado' ? true : null));
  s.ok('conversa fechada sem contrato: vai sozinha ao Juri', foiEnviado, JSON.stringify(await juriDoFechamentoDe(quarto.id)));

  const recebidosDoFechamento = (await falsoJuri.get('/__recebidos')).dados || [];
  const pacoteDoQuarto = recebidosDoFechamento.find((p) => p.token_documento === `chat-fechamento-${quarto.id}`);
  s.ok('token proprio desta conversa, nunca um token de contrato de verdade', Boolean(pacoteDoQuarto), JSON.stringify(pacoteDoQuarto?.token_documento));
  s.ok(
    'o resumo fala em status alterado, nao em "contrato assinado" (nunca houve um)',
    /Status alterado para/.test(pacoteDoQuarto?.resumo || '') && !/Contrato assinado em/.test(pacoteDoQuarto?.resumo || ''),
    String(pacoteDoQuarto?.resumo).slice(0, 160),
  );
  s.ok('e o CPF certo, no campo proprio', pacoteDoQuarto?.contato?.documento === '98765432100', pacoteDoQuarto?.contato?.documento);
  s.ok('o arquivo anexado na nuvem da conversa vai junto', (pacoteDoQuarto?.documentos || []).some((d) => d.nome === 'rg.jpg' && d.mime === 'image/jpeg'), JSON.stringify((pacoteDoQuarto?.documentos || []).map((d) => [d.nome, d.mime])));

  /* Sair do status e voltar: ja enviado, nao abre um segundo caso. */
  await api.patch(`/api/contatos/${quarto.id}`, { statusId: emAnalise.id });
  await api.patch(`/api/contatos/${quarto.id}`, { statusId: fechado.id });
  await esperar(400);
  s.ok(
    'sair do status e voltar nao abre outro caso (ja estava enviado)',
    ((await falsoJuri.get('/__recebidos')).dados || []).length === recebidosDoFechamento.length,
    `${((await falsoJuri.get('/__recebidos')).dados || []).length} vs ${recebidosDoFechamento.length}`,
  );

  /* Quem ja tem um contrato assinado (o `primeiro` deste arquivo) nunca manda
     pelo novo caminho: abriria um segundo caso no Juri para o mesmo cliente. */
  const antesDoPrimeiroFechar = ((await falsoJuri.get('/__recebidos')).dados || []).length;
  await api.patch(`/api/contatos/${primeiro.contato.id}`, { statusId: fechado.id });
  await esperar(400);
  s.ok(
    'quem ja tem contrato assinado NUNCA manda pelo novo caminho',
    ((await falsoJuri.get('/__recebidos')).dados || []).length === antesDoPrimeiroFechar,
    `${((await falsoJuri.get('/__recebidos')).dados || []).length} vs ${antesDoPrimeiroFechar}`,
  );
  s.ok('e o campo fica marcado, em vez de ficar tentando de novo sem parar', (await juriDoFechamentoDe(primeiro.contato.id))?.situacao === 'ignorado', JSON.stringify(await juriDoFechamentoDe(primeiro.contato.id)));

  /* Sem CPF: recusa com motivo claro, sem travar o resto. */
  const semCpf = await leadFechado(5, { idade: '70' });
  const recusouPorCpf = await ate(async () => ((await juriDoFechamentoDe(semCpf.id))?.situacao === 'recusado' ? true : null));
  s.ok('sem CPF: recusado com o motivo certo', recusouPorCpf && /CPF/i.test((await juriDoFechamentoDe(semCpf.id))?.erro || ''), JSON.stringify(await juriDoFechamentoDe(semCpf.id)));

  /* Sem tipo de caso (sem a etiqueta): recusa tambem, em vez de mandar vazio. */
  const semCaso = await leadFechado(6, dadosCompletos, { comEtiqueta: false });
  const recusouPorCaso = await ate(async () => ((await juriDoFechamentoDe(semCaso.id))?.situacao === 'recusado' ? true : null));
  s.ok('sem tipo de caso identificado: recusado tambem, nao manda vazio', recusouPorCaso && /tipo de caso/i.test((await juriDoFechamentoDe(semCaso.id))?.erro || ''), JSON.stringify(await juriDoFechamentoDe(semCaso.id)));

  /* Juri fora do ar: fica na fila e reenvia sozinho, como o outro caminho. */
  await falsoJuri.post('/__modo', { status: 500 });
  const setimo = await leadFechado(7, { ...dadosCompletos, cpf: '11122233344' });
  const naFilaFechamento = await ate(async () => ((await juriDoFechamentoDe(setimo.id))?.situacao === 'falhou' ? true : null));
  s.ok('Juri fora do ar: fica na fila', naFilaFechamento, JSON.stringify(await juriDoFechamentoDe(setimo.id)));
  await falsoJuri.post('/__modo', { status: 200 });
  const voltouFechamento = await ate(async () => ((await juriDoFechamentoDe(setimo.id))?.situacao === 'enviado' ? true : null));
  s.ok('e a fila reenvia sozinha quando o Juri volta', voltouFechamento, JSON.stringify(await juriDoFechamentoDe(setimo.id)));

  /* ---------------- Limpeza ---------------- */

  await falsoJuri.post('/__modo', { status: 200 });
  await api.patch('/api/integracoes', { atilhusJuri: { url: '', segredo: null, ativo: false }, zapsign: { chave: null } });
  for (const c of [primeiro, segundo, terceiro]) await api.delete(`/api/contatos/${c.contato.id}`);
  for (const id of contatosDoFechamento) await api.delete(`/api/contatos/${id}`);
  return s;
}
