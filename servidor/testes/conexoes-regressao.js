import { cliente, esperar, suite } from './apoio.js';

/**
 * Os dois caminhos que existiam antes da camada de driver.
 *
 * Um refatoramento que troca a saida de mensagem inteira e exatamente o tipo de
 * mudanca que quebra o que ja funcionava sem ninguem perceber: o simulador
 * continua "enviando" e a Meta continua recebendo, mas o rastro do anuncio some,
 * ou o webhook para de conferir o token, e isso so aparece semanas depois, numa
 * campanha que nao atribui contrato nenhum.
 *
 * Esta suite existe para essa mudanca nao passar calada.
 */
export async function testarSimuladorEOficial({ base }) {
  const s = suite('Simulador e API Oficial');
  const api = cliente(base);
  await api.entrar();

  const conexoes = (await api.get('/api/conexoes')).dados || [];
  const simulador = conexoes.find((c) => c.tipo === 'simulador');
  s.ok('a base semeada traz uma conexao em modo simulador', Boolean(simulador));
  if (!simulador) return s;

  /* --- Simulador ------------------------------------------------------- */
  await api.post('/api/simulador/mensagem', {
    conexaoId: simulador.id,
    telefone: '5581977776666',
    nome: 'Regressao Simulador',
    conteudo: 'ola, quero saber do bpc',
  });
  await esperar(1200);

  const contatos = await api.get('/api/contatos');
  const nova = (contatos.dados?.contatos || []).find((c) => c.telefone === '5581977776666');
  s.ok('o simulador cria a conversa', Boolean(nova));
  s.ok(
    'os padroes da conexao sao aplicados na conversa nova',
    nova?.statusId === simulador.statusPadraoId && nova?.departamentoId === simulador.departamentoPadraoId,
  );
  if (!nova) return s;

  const envio = await api.post(`/api/contatos/${nova.id}/mensagens`, { conteudo: 'resposta de teste' });
  const mensagem = envio.dados?.mensagem || envio.dados;
  s.ok('o envio pelo simulador fica marcado como enviada', mensagem?.situacao === 'enviada');
  /* Id externo e o numero de protocolo do provedor. No simulador nao houve
     provedor, e inventar um deixaria a tela de entrega esperando para sempre. */
  s.ok('o simulador nao inventa protocolo de entrega', !mensagem?.idExterno);

  /* --- API Oficial ----------------------------------------------------- */
  const oficial = (await api.post('/api/conexoes', { nome: 'Regressao Oficial', tipo: 'oficial' })).dados;
  const verificacao = await fetch(
    `${base}/webhook/${oficial.id}?hub.mode=subscribe&hub.verify_token=${oficial.oficial.verifyToken}&hub.challenge=DESAFIO123`,
  );
  s.ok(
    'a verificacao do webhook devolve o desafio da Meta',
    verificacao.status === 200 && (await verificacao.text()) === 'DESAFIO123',
  );

  const errada = await fetch(
    `${base}/webhook/${oficial.id}?hub.mode=subscribe&hub.verify_token=errado&hub.challenge=X`,
  );
  s.ok('token de verificacao errado e recusado', errada.status === 403);

  const evento = await fetch(`${base}/webhook/${oficial.id}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      entry: [
        {
          changes: [
            {
              field: 'messages',
              value: {
                contacts: [{ wa_id: '5581966665555', profile: { name: 'Regressao Meta' } }],
                messages: [
                  {
                    from: '5581966665555',
                    id: 'wamid.TESTE',
                    type: 'text',
                    text: { body: 'vim pelo anuncio do facebook' },
                    referral: { ctwa_clid: 'CLID_TESTE', headline: 'Anuncio BPC', source_type: 'ad' },
                  },
                ],
              },
            },
          ],
        },
      ],
    }),
  });
  s.ok('o evento da Meta e aceito', evento.status === 200);
  await esperar(1200);

  const daMeta = (await api.get('/api/contatos')).dados?.contatos || [];
  const meta = daMeta.find((c) => c.telefone === '5581966665555');
  s.ok('a mensagem da Meta virou conversa', Boolean(meta));
  s.ok('o nome do perfil foi aproveitado', meta?.nome === 'Regressao Meta');
  /* Sem o CTWA Clid a Meta nao sabe a qual criativo atribuir o contrato, e a
     campanha volta a otimizar por "conversa iniciada", que e barata e nao paga
     a conta. E o dado mais facil de perder num refatoramento de recebimento. */
  s.ok('o rastro do anuncio foi guardado', meta?.anuncio?.ctwaClid === 'CLID_TESTE');

  /* --- Ordem ----------------------------------------------------------- */
  const todas = (await api.get('/api/conexoes')).dados || [];
  const invertida = todas.map((c) => c.id).reverse();
  const ordenar = await api.post('/api/conexoes/ordenar', { ids: invertida });
  s.ok('a ordem arrastada e salva', ordenar.dados?.ok === true);

  const relida = ((await api.get('/api/conexoes')).dados || []).map((c) => c.id);
  s.ok('a lista volta na ordem pedida', JSON.stringify(relida) === JSON.stringify(invertida));

  const forjada = await api.post('/api/conexoes/ordenar', { ids: ['cnx_de_outro_escritorio'] });
  s.ok('id de fora do workspace e recusado', forjada.status === 404);

  /* --- Tipos ------------------------------------------------------------ */
  const tipos = await api.get('/api/conexoes-tipos');
  s.ok(
    'os tres caminhos sao oferecidos pelo servidor',
    Array.isArray(tipos.dados) && ['simulador', 'oficial', 'qrcode'].every((t) => tipos.dados.some((d) => d.id === t)),
  );

  return s;
}
