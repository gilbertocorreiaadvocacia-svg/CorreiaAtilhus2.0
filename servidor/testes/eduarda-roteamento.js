import { cliente, suite } from './apoio.js';

/**
 * Eduarda (Triagem) virou um agente de ligação em 09/10/2026 (pedido do
 * escritório): ela SEMPRE se apresenta, mas depois da apresentação o único
 * trabalho dela é identificar o assunto e passar para quem atende — nunca
 * qualifica, nunca explica o benefício, nunca conduz a proposta.
 *
 * O mecanismo de passagem com fala e ação na mesma rodada (o agente que
 * passa fala E chama a ferramenta, e quem recebe responde na hora, sem o
 * lead escrever de novo) já é testado de forma genérica em encadeamento.js,
 * com agentes de teste. Este teste exercita os agentes REAIS do pacote
 * Previdenciário (Eduarda e Andreia) para travar que o fio continua ligado
 * entre eles especificamente: a Eduarda manda EXATAMENTE a apresentação (e
 * nada de qualificação), a Andreia responde na mesma rodada, e a conversa
 * fica com ela.
 */
/*
 * A marca precisa ser um texto que REALMENTE apareca no system prompt
 * mandado para a Anthropic de mentira (ver ehDoTeste em anthropic-falsa.js):
 * diferente de encadeamento.js, que cria agentes de teste proprios com a
 * marca escrita no prompt deles, aqui o teste usa a Eduarda e a Andreia DE
 * VERDADE, do pacote real — sem marca propria no prompt. O nome do contato
 * ("Lead do BPC", escolhido abaixo) entra no contexto de todo agente via
 * montarSistema() ("Nome do contato: ..."), entao serve de marca.
 */
const MARCA = 'Lead do BPC';

export async function testarEduardaRoteamento({ base, anthropic }) {
  const s = suite('Eduarda se apresenta e roteia, sem qualificar');
  const api = cliente(base);
  await api.entrar();
  const falsa = cliente(anthropic);
  const roteiro = (itens) => falsa.post('/__roteiro', { roteiro: itens, marca: MARCA });

  await api.patch('/api/integracoes', { ia: { chaveAnthropic: 'sk-ant-de-mentira' } });

  const criado = (await api.post('/api/workspaces/por-area', {})).dados;
  const previdenciario = (criado?.workspaces || []).find((w) => w.area === 'previdenciario');
  if (!s.ok('o escritorio Previdenciario existe (criado agora ou ja existia)', Boolean(previdenciario?.workspaceId))) return s;
  await api.post('/api/sessao/workspace', { workspaceId: previdenciario.workspaceId });

  const agentes = (await api.get('/api/agentes')).dados || [];
  const eduarda = agentes.find((a) => a.nome === 'Eduarda (Triagem)');
  const andreia = agentes.find((a) => a.nome === 'Andreia (BPC 1) Triagem');
  if (!s.ok('Eduarda e a Andreia existem no pacote real', Boolean(eduarda && andreia), JSON.stringify(agentes.map((a) => a.nome)))) return s;

  /* As agentes nascem desligadas ate a configuracao chegar (ver "todos
     desligados" em testarWorkspacesPorArea) — ligar so as duas que este
     teste usa, sem mexer nas outras. */
  await api.patch(`/api/agentes/${eduarda.id}`, { ativo: true, delaySegundos: 60 });
  await api.patch(`/api/agentes/${andreia.id}`, { ativo: true, delaySegundos: 60 });

  const simulador = ((await api.get('/api/conexoes')).dados || []).find((c) => c.tipo === 'simulador');
  if (!s.ok('ha conexao de simulador', Boolean(simulador))) return s;

  /* A apresentação da Eduarda vai em `mensagem_de_transicao`, não em `texto`:
     é o único jeito de uma fala dela chegar ao cliente na mesma rodada em
     que ela passa para outro agente (ver mecânica documentada em
     pacotes/triagem.js e em ia/mencoes.js/ia/motor.js — o `texto` comum
     nunca sai quando a passagem é para um agente, só a mensagem de
     transição, mandada direto pelo próprio handler da ferramenta). */
  await roteiro([
    {
      status: 200,
      chamadas: [
        {
          nome: 'transferir_conversa',
          argumentos: {
            destino: 'Andreia (BPC 1) Triagem',
            resumo_para_proximo: 'Lead perguntou sobre BPC/LOAS.',
            mensagem_de_transicao: 'Olá! Sou a Eduarda, da equipe do escritório.',
          },
        },
      ],
    },
    { status: 200, texto: 'Olá! Sou a Andreia, vou te ajudar com o BPC/LOAS. Posso te fazer algumas perguntas?' },
  ]);

  const resultado = await api.post('/api/simulador/mensagem', {
    conexaoId: simulador.id,
    agenteId: eduarda.id,
    telefone: '5581939000001',
    nome: 'Lead do BPC',
    conteudo: 'Oi, quero saber sobre o BPC LOAS da minha mãe idosa',
  });
  if (!s.ok('a mensagem e aceita', resultado.status === 200, JSON.stringify(resultado))) return s;
  const contatoId = resultado.dados.contatoId;

  await api.post(`/api/agentes/${eduarda.id}/responder-agora`, { contatoId });

  const lista = (await api.get(`/api/contatos/${contatoId}/mensagens`)).dados;
  const mensagens = (Array.isArray(lista) ? lista : lista?.mensagens || []).filter((m) => m.direcao === 'saida' && !m.nota);
  const daEduarda = mensagens.filter((m) => m.autor?.id === eduarda.id);

  s.ok('a Eduarda manda a apresentação, e so uma mensagem', daEduarda.length === 1 && /Eduarda/.test(daEduarda[0]?.conteudo || ''), JSON.stringify(mensagens.map((m) => [m.autor?.nome, m.conteudo])));
  s.ok(
    'a Andreia ja responde na mesma rodada, sem o lead escrever de novo',
    mensagens.some((m) => m.autor?.id === andreia.id && /Andreia/.test(m.conteudo || '')),
    JSON.stringify(mensagens.map((m) => [m.autor?.nome, m.conteudo])),
  );

  const depois = await (await api.get(`/api/contatos/${contatoId}`)).dados;
  s.ok('a conversa fica com a Andreia', depois?.responsavel?.id === andreia.id, JSON.stringify(depois?.responsavel));

  return s;
}
