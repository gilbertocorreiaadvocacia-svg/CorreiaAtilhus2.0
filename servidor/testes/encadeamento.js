import { cliente, suite } from './apoio.js';

/**
 * Agentes em cadeia: a secretaria passa para o especialista, e o especialista
 * responde NA HORA, lendo o resumo que recebeu.
 *
 * Antes desta versao a passagem tinha tres defeitos, e cada um e silencioso no
 * WhatsApp: o agente novo so falava quando o cliente escrevesse de novo (o
 * cliente ficava esperando uma resposta que nao vinha), o antigo ainda mandava
 * a propria fala depois de passar (duas vozes na mesma conversa), e o resumo
 * virava nota que o proximo agente nao via (ele perguntava tudo de novo).
 *
 * A Anthropic aqui e a de mentira, com roteiro: o teste diz o que cada chamada
 * do modelo responde, inclusive o pedido de ferramenta, e confere o que o
 * sistema fez com isso.
 */

/* A palavra que faz a Anthropic de mentira reconhecer os agentes desta suite. */
const MARCA = 'MARCA-DA-SUITE-DE-CADEIA';
const TELEFONE = (sufixo) => `558193000${String(sufixo).padStart(4, '0')}`;

export async function testarEncadeamento({ base, anthropic }) {
  const s = suite('Agentes em cadeia');
  const api = cliente(base);
  await api.entrar();
  const falsa = cliente(anthropic);
  const roteiro = (itens) => falsa.post('/__roteiro', { roteiro: itens, marca: MARCA });
  const registro = async () => (await falsa.get('/__chamadas')).dados;

  const conexoes = (await api.get('/api/conexoes')).dados || [];
  const simulador = conexoes.find((c) => c.tipo === 'simulador');
  if (!s.ok('ha conexao de simulador', Boolean(simulador))) return s;

  await api.patch('/api/integracoes', { ia: { chaveAnthropic: 'sk-ant-de-mentira' } });

  /* ---------------- Os agentes ---------------- */

  const criarAgente = async (nome, dados) => {
    const agente = (await api.post('/api/agentes', { nome })).dados;
    await api.patch(`/api/agentes/${agente.id}`, { delaySegundos: 60, ...dados });
    return agente;
  };
  const secretaria = await criarAgente('Secretaria da Cadeia', {
    area: 'previdenciario',
    prompt: `${MARCA}. Descubra o beneficio e passe com @responsavel para @Especialista da Cadeia.`,
  });
  const especialista = await criarAgente('Especialista da Cadeia', {
    area: 'previdenciario',
    requisitos: ['CTPS foto'],
    prompt: `${MARCA}. Confira a qualidade de segurado, peca a CTPS, use @calendario e devolva com @responsavel para @Secretaria da Cadeia se nao for BPC.`,
  });
  const trabalhista = await criarAgente('Trabalhista da Cadeia', {
    area: 'trabalhista',
    prompt: `${MARCA}. Atende causas trabalhistas.`,
  });

  const lerAgente = async (id) => ((await api.get('/api/agentes')).dados || []).find((a) => a.id === id);
  s.ok('o agente guarda a area', (await lerAgente(secretaria.id))?.area === 'previdenciario');
  s.ok(
    'o requisito escrito como texto vira a chave da variavel',
    JSON.stringify((await lerAgente(especialista.id))?.requisitos) === JSON.stringify(['ctps_foto']),
    JSON.stringify((await lerAgente(especialista.id))?.requisitos),
  );
  s.ok('area inventada nao e aceita', (await api.patch(`/api/agentes/${trabalhista.id}`, { area: 'inventada' })).dados?.area !== 'inventada');
  await api.patch(`/api/agentes/${trabalhista.id}`, { area: 'trabalhista' });

  const novaConversa = async (sufixo, agenteId) => {
    const r = await api.post('/api/simulador/mensagem', {
      conexaoId: simulador.id,
      agenteId,
      telefone: TELEFONE(sufixo),
      nome: 'Cliente da Cadeia',
      conteudo: 'Minha mae tem 67 anos e quer o BPC',
    });
    return r.dados?.contatoId;
  };
  const responderAgora = (agenteId, contatoId) => api.post(`/api/agentes/${agenteId}/responder-agora`, { contatoId });
  const conversa = async (id) => (await api.get(`/api/contatos/${id}`)).dados;
  const mensagens = async (id) => {
    const d = (await api.get(`/api/contatos/${id}/mensagens`)).dados;
    return Array.isArray(d) ? d : d?.mensagens || [];
  };

  /* ---------------- Secretaria -> especialista ---------------- */

  const contatoId = await novaConversa(1, secretaria.id);
  if (!s.ok('cria a conversa com a secretaria', Boolean(contatoId))) return s;

  await roteiro([
    {
      status: 200,
      texto: 'Vou te passar para a nossa especialista.',
      chamadas: [
        {
          nome: 'transferir_conversa',
          argumentos: {
            destino: 'Especialista da Cadeia',
            resumo_para_proximo: 'Mae de 67 anos quer BPC idoso. Ainda nao falou da renda da casa.',
          },
        },
      ],
    },
    { status: 200, texto: 'Oi! Sou a especialista. Quantas pessoas moram na casa?' },
  ]);
  await responderAgora(secretaria.id, contatoId);

  const depois = await conversa(contatoId);
  s.ok('a conversa fica com o especialista', depois?.responsavel?.id === especialista.id, JSON.stringify(depois?.responsavel));

  const bateu = await registro();
  s.ok('o especialista respondeu sem o cliente escrever de novo', bateu.total === 2, `chamadas: ${bateu.total}`);

  const doEspecialista = bateu.chamadas[1]?.sistemaCompleto || '';
  s.ok('o especialista le a passagem da secretaria', /PASSAGEM DO AGENTE ANTERIOR \(Secretaria da Cadeia\)/.test(doEspecialista));
  s.ok('com o resumo que ela escreveu', doEspecialista.includes('Mae de 67 anos quer BPC idoso'));
  s.ok('e sabe o que ainda falta coletar', /FALTA COLETAR[^\n]*ctps_foto/.test(doEspecialista));

  s.ok(
    'a secretaria so enxerga destinos da propria area',
    (bateu.chamadas[0]?.destinos || []).includes('Especialista da Cadeia') &&
      !(bateu.chamadas[0]?.destinos || []).includes('Trabalhista da Cadeia'),
    JSON.stringify(bateu.chamadas[0]?.destinos),
  );

  const saidas = (await mensagens(contatoId)).filter((m) => m.direcao === 'saida' && !m.nota);
  const falasDoEspecialista = saidas.filter((m) => m.autor?.id === especialista.id);
  s.ok('o especialista falou uma vez', falasDoEspecialista.length === 1, saidas.map((m) => `${m.autor?.nome}: ${m.conteudo}`).join(' | '));
  s.ok(
    'e a secretaria nao mandou a propria fala depois de passar',
    !saidas.some((m) => m.autor?.id === secretaria.id && /especialista/i.test(m.conteudo || '')),
    saidas.map((m) => `${m.autor?.nome}: ${m.conteudo}`).join(' | '),
  );
  s.ok(
    'a equipe ve o resumo da passagem como nota',
    (await mensagens(contatoId)).some((m) => m.nota && /Passagem para Especialista da Cadeia/.test(m.conteudo || '')),
  );

  /* ---------------- Outra area: recusado ---------------- */

  await roteiro([
    {
      status: 200,
      texto: '',
      chamadas: [{ nome: 'transferir_conversa', argumentos: { destino: 'Trabalhista da Cadeia', resumo_para_proximo: 'teste' } }],
    },
    { status: 200, texto: 'Certo, seguimos por aqui.' },
  ]);
  await responderAgora(especialista.id, contatoId);
  s.ok('passar para agente de outra area e recusado', (await conversa(contatoId))?.responsavel?.id === especialista.id);
  s.ok(
    'e o agente le o motivo da recusa',
    /outra area/.test((await registro()).chamadas[1]?.ultimaMensagem || ''),
    (await registro()).chamadas[1]?.ultimaMensagem,
  );

  /* ---------------- Sem resumo: recusado ---------------- */

  await roteiro([
    { status: 200, texto: '', chamadas: [{ nome: 'transferir_conversa', argumentos: { destino: 'Secretaria da Cadeia' } }] },
    { status: 200, texto: 'Ok.' },
  ]);
  await responderAgora(especialista.id, contatoId);
  s.ok('passar para agente sem resumo e recusado', (await conversa(contatoId))?.responsavel?.id === especialista.id);

  /* ---------------- Ligacao e reuniao dividem a agenda ---------------- */

  const status = (await api.get('/api/status')).dados || [];
  const triagem = status.find((x) => x.nome === 'Em triagem');
  if (triagem) await api.patch(`/api/contatos/${contatoId}`, { statusId: triagem.id });

  const dia = new Date(Date.now() + 9 * 86400000);
  const dois = (n) => String(n).padStart(2, '0');
  const quando = `${dia.getFullYear()}-${dois(dia.getMonth() + 1)}-${dois(dia.getDate())} 10:00`;

  await roteiro([
    { status: 200, texto: '', chamadas: [{ nome: 'agenda', argumentos: { acao: 'criar', tipo: 'ligacao', quando } }] },
    { status: 200, texto: 'Ligacao marcada.' },
  ]);
  await responderAgora(especialista.id, contatoId);
  s.ok('a ligacao marcada vira o momento do lead', (await conversa(contatoId))?.momento?.nome === 'Ligacao agendada', JSON.stringify((await conversa(contatoId))?.momento));
  s.ok('e a nota diz para qual numero ligar', (await mensagens(contatoId)).some((m) => m.nota && /Ligar para/.test(m.conteudo || '')));

  await roteiro([
    { status: 200, texto: '', chamadas: [{ nome: 'agenda', argumentos: { acao: 'criar', tipo: 'reuniao', quando } }] },
    { status: 200, texto: 'Vou ver outro horario.' },
  ]);
  await responderAgora(especialista.id, contatoId);
  s.ok(
    'reuniao no mesmo horario da ligacao e recusada',
    /ocupado/.test((await registro()).chamadas[1]?.ultimaMensagem || ''),
    (await registro()).chamadas[1]?.ultimaMensagem,
  );

  /* ---------------- Teto de saltos ---------------- */

  const idaEVolta = (destino) => ({
    status: 200,
    texto: '',
    chamadas: [{ nome: 'transferir_conversa', argumentos: { destino, resumo_para_proximo: 'de novo' } }],
  });
  const outraConversa = await novaConversa(2, secretaria.id);
  await roteiro([
    idaEVolta('Especialista da Cadeia'),
    idaEVolta('Secretaria da Cadeia'),
    idaEVolta('Especialista da Cadeia'),
    idaEVolta('Secretaria da Cadeia'),
    idaEVolta('Especialista da Cadeia'),
    idaEVolta('Secretaria da Cadeia'),
  ]);
  await responderAgora(secretaria.id, outraConversa);
  const presa = await conversa(outraConversa);
  const voltas = (await registro()).total;
  s.ok('agentes passando um para o outro param no teto', voltas === 4, `chamadas: ${voltas}`);
  s.ok('e a conversa vai para uma pessoa', presa?.responsavel?.tipo === 'membro', JSON.stringify(presa?.responsavel));

  /* ---------------- Limpeza ---------------- */

  await falsa.post('/__roteiro', { roteiro: [] });
  await api.patch('/api/integracoes', { ia: { chaveAnthropic: null } });
  for (const id of [contatoId, outraConversa]) await api.delete(`/api/contatos/${id}`);
  for (const agente of [secretaria, especialista, trabalhista]) await api.delete(`/api/agentes/${agente.id}`);

  return s;
}
