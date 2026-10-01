import { cliente, suite } from './apoio.js';

/**
 * Quando o agente fala E age na mesma volta, o cliente recebe a fala.
 *
 * O motor guardava `textoFinal = resposta.texto` a cada volta do laco, e isso
 * SOBRESCREVIA a fala anterior. Se o modelo dizia algo e chamava uma
 * ferramenta, a volta seguinte produzia um fecho curto e esse fecho
 * substituia a fala de verdade, que nunca chegava ao cliente.
 *
 * Foi assim que uma mae contou que o bebe ja tinha nascido e que nunca tinha
 * contribuido, e recebeu "desejo toda sorte do mundo pra voce" no lugar da
 * explicacao de por que o escritorio nao podia atender o caso dela. A
 * explicacao foi escrita pelo modelo, nao foi gravada em lugar nenhum e foi
 * jogada fora pela linha de cima.
 *
 * Valia para todo agente e toda conversa: bastava falar e agir na mesma volta.
 *
 * O que nao pode falhar: a fala que vem junto da ferramenta chega, a fala
 * seguinte chega junto, e a mesma frase repetida em sequencia sai uma vez so.
 */
const MARCA = 'MARCA-DA-SUITE-FALA-E-ACAO';

export async function testarFalaEAcao({ base, anthropic }) {
  const s = suite('Fala e acao na mesma volta');
  const api = cliente(base);
  await api.entrar();
  const falsa = cliente(anthropic);
  const roteiro = (itens) => falsa.post('/__roteiro', { roteiro: itens, marca: MARCA });

  const simulador = ((await api.get('/api/conexoes')).dados || []).find((c) => c.tipo === 'simulador');
  if (!s.ok('ha conexao de simulador', Boolean(simulador))) return s;

  await api.patch('/api/integracoes', { ia: { chaveAnthropic: 'sk-ant-de-mentira' } });

  const agente = (await api.post('/api/agentes', { nome: 'Agente que fala e age' })).dados;
  await api.patch(`/api/agentes/${agente.id}`, {
    delaySegundos: 60,
    /* @status e o que faz a ferramenta de mudar status ser oferecida ao modelo. */
    prompt: `${MARCA}. Quando o caso for recusado, altere o @status para "Desqualificado".`,
  });

  let sufixo = 0;
  const novaConversa = async () => {
    sufixo += 1;
    const r = await api.post('/api/simulador/mensagem', {
      conexaoId: simulador.id,
      agenteId: agente.id,
      telefone: `558193100${String(sufixo).padStart(4, '0')}`,
      nome: 'Cliente de Fala e Acao',
      conteudo: 'Meu bebe ja nasceu e eu nunca contribui',
    });
    return r.dados?.contatoId;
  };
  const doAgente = async (id) => {
    const d = (await api.get(`/api/contatos/${id}/mensagens`)).dados;
    const lista = Array.isArray(d) ? d : d?.mensagens || [];
    return lista.filter((m) => m.direcao === 'saida' && !m.nota).map((m) => String(m.conteudo || ''));
  };
  const mudarStatus = { nome: 'alterar_status', argumentos: { status: 'Desqualificado' } };

  /* --- 1. A fala que vem junto da ferramenta, e a que vem depois -------- */

  const RECUSA = 'Infelizmente o escritorio nao consegue atender este caso, porque a contribuicao precisa ser feita na gestacao.';
  const FECHO = 'Um beijo no bebe e muita saude para voces.';

  const a = await novaConversa();
  if (!s.ok('conversa criada', Boolean(a))) return s;
  await roteiro([
    { status: 200, texto: RECUSA, chamadas: [mudarStatus] },
    { status: 200, texto: FECHO },
  ]);
  await api.post(`/api/agentes/${agente.id}/responder-agora`, { contatoId: a });

  const enviadas = (await doAgente(a)).join('\n');
  s.ok(
    'a explicacao que veio junto da mudanca de status CHEGA ao cliente',
    enviadas.includes('nao consegue atender este caso'),
    JSON.stringify(enviadas),
  );
  s.ok('e o fecho que veio depois tambem', enviadas.includes('Um beijo no bebe'), JSON.stringify(enviadas));
  /* As duas posicoes precisam EXISTIR: com a fala perdida, indexOf devolve -1
     e "-1 < qualquer coisa" passaria por acidente — foi o que este teste fez
     contra o codigo antigo, ate ser verificado de proposito. */
  const posRecusa = enviadas.indexOf('nao consegue atender');
  const posFecho = enviadas.indexOf('Um beijo');
  s.ok(
    'a explicacao vem ANTES do fecho, na ordem em que o modelo falou',
    posRecusa >= 0 && posFecho >= 0 && posRecusa < posFecho,
    JSON.stringify({ posRecusa, posFecho }),
  );

  /* --- 2. A mesma frase em sequencia sai uma vez ------------------------ */

  const REPETIDA = 'Ja registrei o seu caso aqui.';
  const b = await novaConversa();
  await roteiro([
    { status: 200, texto: REPETIDA, chamadas: [mudarStatus] },
    { status: 200, texto: REPETIDA },
  ]);
  await api.post(`/api/agentes/${agente.id}/responder-agora`, { contatoId: b });

  const vezes = (await doAgente(b)).join('\n').split(REPETIDA).length - 1;
  s.ok(
    'o modelo reescrever a mesma frase na volta seguinte NAO manda duas vezes',
    vezes === 1,
    `a frase saiu ${vezes} vezes`,
  );

  /* --- 3. A volta sem fala nao apaga a anterior ------------------------- */

  const c = await novaConversa();
  await roteiro([
    { status: 200, texto: RECUSA, chamadas: [mudarStatus] },
    { status: 200, texto: '' },
  ]);
  await api.post(`/api/agentes/${agente.id}/responder-agora`, { contatoId: c });
  s.ok(
    'volta seguinte sem texto nenhum nao apaga a fala que ja existia',
    (await doAgente(c)).join('\n').includes('nao consegue atender este caso'),
    JSON.stringify(await doAgente(c)),
  );

  /* --- 4. Sem ferramenta, nada muda ------------------------------------- */

  const d = await novaConversa();
  await roteiro([{ status: 200, texto: 'Resposta simples, sem ferramenta nenhuma.' }]);
  await api.post(`/api/agentes/${agente.id}/responder-agora`, { contatoId: d });
  const simples = await doAgente(d);
  s.ok(
    'a resposta simples, sem ferramenta, sai como sempre saiu: uma mensagem',
    simples.length === 1 && simples[0].includes('Resposta simples'),
    JSON.stringify(simples),
  );

  /* Limpeza: a suite seguinte conta agente e depende de nao haver chave. */
  await falsa.post('/__roteiro', { roteiro: [] });
  await api.patch(`/api/agentes/${agente.id}`, { ativo: false });
  await api.delete(`/api/agentes/${agente.id}`);
  await api.patch('/api/integracoes', { ia: { chaveAnthropic: null } });

  return s;
}
