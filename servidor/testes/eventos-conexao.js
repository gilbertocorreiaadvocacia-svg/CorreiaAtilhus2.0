import { cliente, suite } from './apoio.js';

/**
 * A trilha de eventos do numero guarda MUDANCA, e nao batimento.
 *
 * Este teste existe por causa de um diagnostico que leu 34 "desconexoes" em 99
 * segundos e concluiu que o numero do escritorio era instavel. Nao era: a tela
 * do QR Code testava a conexao de tres em tres segundos enquanto esperava
 * alguem ler o codigo, e cada teste que falhava gravava uma linha. O log
 * estava contando a propria espera, e um numero que nunca caiu apareceu no
 * relatorio como o mais problematico do sistema.
 *
 * O que nao pode falhar: falha repetida e identica entra UMA vez; a volta
 * entra UMA vez; e testar de novo, com tudo igual, nao acrescenta nada.
 */
export async function testarEventosDeConexao({ base, evolucao, chaveEvolucao }) {
  const s = suite('Trilha de eventos do numero');
  const api = cliente(base);
  await api.entrar();

  const criada = await api.post('/api/conexoes', { nome: 'Eventos (QR)', tipo: 'qrcode' });
  const id = criada.dados?.id;
  if (!s.ok('conexao de teste criada', Boolean(id), JSON.stringify(criada.dados))) return s;

  /* Porta 1 nao tem ninguem escutando: o teste falha sempre, e sempre pelo
     mesmo motivo. E exatamente a forma da espera do QR Code. */
  await api.patch(`/api/conexoes/${id}`, {
    qrcode: { servidor: 'http://127.0.0.1:1', chave: 'chave-de-mentira', instancia: 'eventos', urlWebhook: base },
  });

  const eventosDe = async (tipo) => {
    const lista = (await api.get(`/api/conexoes/${id}/eventos?limite=200`)).dados || [];
    return lista.filter((e) => e.tipo === tipo);
  };

  for (let i = 0; i < 5; i += 1) await api.post(`/api/conexoes/${id}/testar`);

  const quedas = await eventosDe('desconectado');
  s.ok(
    'cinco testes que falham pelo mesmo motivo gravam um evento so',
    quedas.length === 1,
    `${quedas.length} eventos: ${JSON.stringify(quedas.map((e) => e.descricao))}`,
  );

  /* O numero volta: o servico responde e a sessao esta aberta. */
  await api.patch(`/api/conexoes/${id}`, {
    qrcode: { servidor: evolucao, chave: chaveEvolucao, instancia: 'correia-eventos', urlWebhook: base },
  });
  await api.post(`/api/conexoes/${id}/conectar`);
  await fetch(`${evolucao}/__escanear`, { headers: { apikey: chaveEvolucao } });

  const voltou = await api.post(`/api/conexoes/${id}/testar`);
  if (!s.ok('a sessao aparece aberta depois da leitura', voltou.dados?.ok === true, JSON.stringify(voltou.dados))) {
    return s;
  }

  const subidas = await eventosDe('conectado');
  s.ok('a volta ao ar grava um evento', subidas.length === 1, JSON.stringify(subidas.map((e) => e.descricao)));

  for (let i = 0; i < 4; i += 1) await api.post(`/api/conexoes/${id}/testar`);
  const depois = await eventosDe('conectado');
  s.ok(
    'e continuar testando com tudo igual nao acrescenta nada',
    depois.length === 1,
    `${depois.length} eventos de conexao`,
  );
  s.ok('a queda anterior continua na trilha, para quem for ler depois', (await eventosDe('desconectado')).length === 1);

  /* Um motivo NOVO de queda e informacao, e entra. O servico sumiu de novo,
     agora com outro endereco, entao a mensagem de erro e outra. */
  await api.patch(`/api/conexoes/${id}`, {
    qrcode: { servidor: 'http://127.0.0.1:2', chave: 'outra', instancia: 'eventos-2', urlWebhook: base },
  });
  await api.post(`/api/conexoes/${id}/testar`);
  const comMotivoNovo = await eventosDe('desconectado');
  s.ok(
    'cair de novo, depois de ter voltado, grava a queda nova',
    comMotivoNovo.length === 2,
    JSON.stringify(comMotivoNovo.map((e) => e.descricao)),
  );

  await api.delete(`/api/conexoes/${id}`);
  return s;
}
