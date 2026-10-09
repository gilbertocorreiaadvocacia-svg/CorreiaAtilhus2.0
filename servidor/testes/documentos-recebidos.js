import { cliente, suite } from './apoio.js';

/**
 * O agente nunca "esquece" um documento que o cliente ja mandou, mesmo numa
 * conversa com mais fotos do que o motor ainda consegue ler de verdade.
 *
 * Achado em 09/10/2026, a partir de reclamacao real do escritorio: num caso
 * previdenciario o cliente manda CTPS, laudo, CNIS, RG, comprovante — mais de
 * tres fotos — e as mais antigas viravam so "[imagem: nome]" no historico, sem
 * conteudo (ver IMAGENS_MAXIMAS em servidor/ia/motor.js). O agente lia so as
 * tres ultimas de verdade e pedia de novo o que ja tinha sido mandado.
 *
 * O que nao pode falhar: TODO documento recebido aparece, pelo nome e pela
 * data, na lista "DOCUMENTOS JA RECEBIDOS" do system prompt — mesmo o mais
 * antigo, de muito antes do teto de imagens lidas de verdade.
 */
const MARCA = 'MARCA-DA-SUITE-DOCUMENTOS';

export async function testarDocumentosRecebidos({ base, anthropic }) {
  const s = suite('Documentos recebidos nunca saem do contexto');
  const api = cliente(base);
  await api.entrar();
  const falsa = cliente(anthropic);
  const roteiro = (itens) => falsa.post('/__roteiro', { roteiro: itens, marca: MARCA });
  const sistemaDaUltimaChamada = async () => {
    const { chamadas } = (await falsa.get('/__chamadas')).dados;
    return chamadas[chamadas.length - 1]?.sistemaCompleto || '';
  };

  const simulador = ((await api.get('/api/conexoes')).dados || []).find((c) => c.tipo === 'simulador');
  if (!s.ok('ha conexao de simulador', Boolean(simulador))) return s;

  await api.patch('/api/integracoes', { ia: { chaveAnthropic: 'sk-ant-de-mentira' } });

  const agente = (await api.post('/api/agentes', { nome: 'Agente de documentos' })).dados;
  await api.patch(`/api/agentes/${agente.id}`, { delaySegundos: 60, prompt: `${MARCA}. Peca os documentos do caso.` });

  const documentos = ['ctps.jpg', 'laudo-medico.jpg', 'cnis.jpg', 'rg.jpg', 'comprovante-residencia.jpg'];
  let contatoId = null;
  for (const nome of documentos) {
    const r = await api.post('/api/simulador/mensagem', {
      conexaoId: simulador.id,
      agenteId: contatoId ? undefined : agente.id,
      telefone: '5581938000001',
      nome: 'Cliente com muitos documentos',
      tipo: 'imagem',
      midia: { tipo: 'imagem', url: `/midia/${nome}`, nome, mime: 'image/jpeg' },
    });
    contatoId = r.dados?.contatoId || contatoId;
  }
  if (!s.ok('a conversa com os 5 documentos foi criada', Boolean(contatoId))) return s;

  await roteiro([{ status: 200, texto: 'Recebi tudo, obrigado!' }]);
  await api.post(`/api/agentes/${agente.id}/responder-agora`, { contatoId });

  const sistema = await sistemaDaUltimaChamada();
  s.ok('a secao de documentos existe no prompt', /DOCUMENTOS JA RECEBIDOS/.test(sistema), sistema.slice(0, 300));
  for (const nome of documentos) {
    s.ok(`"${nome}" aparece na lista, mesmo sendo um dos mais antigos`, sistema.includes(nome), sistema.includes('DOCUMENTOS JA RECEBIDOS') ? 'secao existe mas falta o nome' : 'secao nem existe');
  }

  return s;
}
