import { cliente, suite } from './apoio.js';

/**
 * O atalho que o agente cita, e o que acontece quando ele deixa de existir.
 *
 * Cinco agentes de producao passaram meses no ar citando @bemvindo,
 * @videoproposta, @contratoassinado e @documentos. Ninguem escreveu errado:
 * alguem apagou esses templates, o sistema limpou tudo o que apontava para
 * eles — passo de follow-up, agendamento, ZapSign — e esqueceu do unico lugar
 * que ninguem revisa, o prompt. Os agentes seguiram mandando usar um template
 * que nao existia mais, e o modelo anunciava ao cliente que tinha enviado.
 *
 * O que nao pode falhar: nao da para apagar o que um agente NO AR usa; da para
 * apagar depois de desligar o agente; nao da para LIGAR um agente com atalho
 * quebrado; e continua dando para montar cadeia de agentes na ordem natural,
 * escrevendo o prompt do primeiro antes de o segundo existir.
 */
export async function testarAtalhos({ base }) {
  const s = suite('Atalhos do agente');
  const api = cliente(base);
  await api.entrar();

  /* --- Nao apagar o que um agente no ar esta usando -------------------- */

  const template = await api.post('/api/templates', {
    nome: 'Video da proposta (teste)',
    atalho: 'videodoteste',
    conteudo: 'Segue o video explicando a proposta.',
  });
  const templateId = template.dados?.id;
  if (!s.ok('template de teste criado', Boolean(templateId), JSON.stringify(template.dados))) return s;

  const agente = await api.post('/api/agentes', {
    nome: 'Agente que usa o video',
    prompt: 'Quando o lead pedir detalhes, mande @videodoteste e espere a resposta.',
  });
  const agenteId = agente.dados?.id;
  if (!s.ok('agente de teste criado, e ele nasce ligado', agente.dados?.ativo === true)) return s;

  const recusa = await api.delete(`/api/templates/${templateId}`);
  s.ok('apagar o template que um agente no ar usa e recusado', recusa.status === 409, `status ${recusa.status}`);
  s.ok(
    'e o recado diz QUEM depende, para nao virar adivinhacao',
    String(recusa.dados?.erro || '').includes('Agente que usa o video'),
    JSON.stringify(recusa.dados),
  );
  s.ok(
    'o template continua inteiro depois da recusa',
    (await api.get('/api/templates')).dados.some((t) => t.id === templateId),
  );

  /* Desligado, o agente nao fala com ninguem: a porta abre. */
  await api.patch(`/api/agentes/${agenteId}`, { ativo: false });
  const apagou = await api.delete(`/api/templates/${templateId}`);
  s.ok('desligando o agente, o template pode ser apagado', apagou.status === 200, `status ${apagou.status}`);

  /* --- Ligar de volta, agora com o atalho quebrado --------------------- */

  const religar = await api.patch(`/api/agentes/${agenteId}`, { ativo: true });
  s.ok('religar o agente com o atalho ja quebrado e recusado', religar.status === 409, `status ${religar.status}`);
  s.ok(
    'e o recado nomeia o atalho que quebrou',
    String(religar.dados?.erro || '').includes('@videodoteste'),
    JSON.stringify(religar.dados),
  );

  const consertado = await api.patch(`/api/agentes/${agenteId}`, {
    prompt: 'Quando o lead pedir detalhes, explique a proposta por escrito.',
    ativo: true,
  });
  s.ok('tirada a mencao, o agente liga normalmente', consertado.status === 200, JSON.stringify(consertado.dados?.erro));

  /* --- A cadeia de agentes continua possivel na ordem natural ---------- */

  /*
   * Quem monta uma cadeia escreve no prompt da secretaria que ela passa para
   * @Especialista antes de o especialista existir. Barrar isso tornaria
   * impossivel construir a cadeia pela ordem em que se pensa nela.
   */
  const secretaria = await api.post('/api/agentes', {
    nome: 'Secretaria do teste de atalho',
    prompt: 'Descubra o assunto e passe com @responsavel para @Especialista do teste de atalho.',
  });
  s.ok(
    'criar agente citando outro que ainda nao existe continua valendo',
    secretaria.status === 200,
    JSON.stringify(secretaria.dados?.erro),
  );

  const especialista = await api.post('/api/agentes', {
    nome: 'Especialista do teste de atalho',
    prompt: 'Aprofunde o caso e recolha os documentos.',
  });
  s.ok('e o segundo da cadeia entra em seguida', especialista.status === 200);

  const semQuebra = await api.get('/api/agentes');
  const secretariaAgora = (semQuebra.dados || []).find((a) => a.id === secretaria.dados?.id);
  s.ok(
    'com o par criado, a mencao deixa de aparecer como invalida',
    !(secretariaAgora?.mencoesInvalidas || []).some((m) => String(m).toLowerCase().includes('especialista')),
    JSON.stringify(secretariaAgora?.mencoesInvalidas),
  );

  /* --- A mesma porta vale para etiqueta e coluna ----------------------- */

  const etiqueta = await api.post('/api/etiquetas', { nome: 'Etiqueta do atalho' });
  const etiquetaId = etiqueta.dados?.id;
  await api.patch(`/api/agentes/${agenteId}`, {
    prompt: 'Se o lead for do interior, marque com @Etiqueta do atalho.',
    ativo: true,
  });
  const recusaEtiqueta = await api.delete(`/api/etiquetas/${etiquetaId}`);
  s.ok('etiqueta usada por agente no ar tambem nao e apagada', recusaEtiqueta.status === 409, `status ${recusaEtiqueta.status}`);

  /* Limpeza: as outras suites contam agente e etiqueta. */
  await api.patch(`/api/agentes/${agenteId}`, { prompt: 'Atenda com educacao.', ativo: false });
  await api.delete(`/api/etiquetas/${etiquetaId}`);
  await api.delete(`/api/agentes/${agenteId}`);
  if (secretaria.dados?.id) await api.delete(`/api/agentes/${secretaria.dados.id}`);
  if (especialista.dados?.id) await api.delete(`/api/agentes/${especialista.dados.id}`);

  return s;
}
