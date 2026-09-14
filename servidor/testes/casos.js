import { cliente, suite } from './apoio.js';

/**
 * Tipo de caso e momento do lead (servidor/nucleo/casos.js).
 *
 * O que se trava aqui sao as regras que a tela e o Atilhus Juri vao supor:
 *   - existe exatamente uma etiqueta por tipo de caso, e a migracao nao
 *     duplica nem renomeia a etiqueta que os prompts ja citam;
 *   - uma conversa tem um tipo de caso so, e o que acabou de entrar ganha;
 *   - o momento so aceita os do status atual, e zera quando o status muda;
 *   - o agente com @momento recebe a ferramenta.
 */

/* Faixa propria de numeros, fora das outras suites. */
const TELEFONE = (sufixo) => `558192000${String(sufixo).padStart(4, '0')}`;

export async function testarCasos({ base }) {
  const s = suite('Tipo de caso e momento do lead');
  const api = cliente(base);
  await api.entrar();

  /* ---------------- Os tipos de caso ---------------- */

  const etiquetas = (await api.get('/api/etiquetas')).dados || [];
  const casos = etiquetas.filter((e) => e.tipo === 'caso');
  const chaves = casos.map((e) => e.caso).sort();
  s.ok(
    'ha exatamente um tipo de caso para cada tipo da lista',
    JSON.stringify(chaves) === JSON.stringify(['auxilio', 'auxilio_acidente', 'bpc', 'civel', 'maternidade', 'trabalhista']),
    chaves.join(', '),
  );
  s.ok(
    'a etiqueta BPC/LOAS da semeadura foi marcada, sem copia e sem trocar o nome',
    etiquetas.filter((e) => e.nome === 'BPC/LOAS').length === 1 && casos.some((e) => e.caso === 'bpc' && e.nome === 'BPC/LOAS'),
  );
  s.ok('todo tipo de caso tem cor em token de tema', casos.every((e) => /^var\(--/.test(e.cor || '')));

  const bpc = casos.find((e) => e.caso === 'bpc');
  const trabalhista = casos.find((e) => e.caso === 'trabalhista');
  const comum = etiquetas.find((e) => e.tipo !== 'caso');
  if (!s.ok('ha etiqueta comum para misturar com os tipos', Boolean(comum && bpc && trabalhista))) return s;

  /* ---------------- Um tipo de caso por conversa ---------------- */

  const conexoes = (await api.get('/api/conexoes')).dados || [];
  const conexao = conexoes.find((c) => c.tipo === 'simulador') || conexoes[0];
  const contato = (await api.post('/api/contatos', { conexaoId: conexao.id, telefone: TELEFONE(1), nome: 'Teste Caso' })).dados;
  if (!s.ok('cria a conversa de teste', Boolean(contato?.id))) return s;

  await api.patch(`/api/contatos/${contato.id}`, { etiquetas: [bpc.id, comum.id] });
  const trocado = (await api.patch(`/api/contatos/${contato.id}`, { etiquetas: [bpc.id, comum.id, trabalhista.id] })).dados;
  s.ok(
    'marcar outro tipo de caso troca o tipo em vez de somar',
    trocado?.etiquetas?.includes(trabalhista.id) && !trocado.etiquetas.includes(bpc.id),
    JSON.stringify(trocado?.etiquetas),
  );
  s.ok('a etiqueta comum continua junto', trocado?.etiquetas?.includes(comum.id));

  /* ---------------- Momento ---------------- */

  const status = (await api.get('/api/status')).dados || [];
  const triagem = status.find((x) => x.nome === 'Em triagem');
  const qualificado = status.find((x) => x.nome === 'Qualificado');
  s.ok(
    'Em triagem traz os momentos da semeadura',
    (triagem?.momentos || []).some((m) => m.nome === 'Aguardando CTPS/laudo'),
    JSON.stringify(triagem?.momentos),
  );
  if (!triagem?.momentos?.length || !qualificado) return s;

  await api.patch(`/api/contatos/${contato.id}`, { statusId: triagem.id });
  const aguardando = triagem.momentos.find((m) => m.nome === 'Aguardando CTPS/laudo');
  const comMomento = (await api.patch(`/api/contatos/${contato.id}`, { momentoId: aguardando.id })).dados;
  s.ok(
    'o momento do status atual e aceito e guarda desde quando',
    comMomento?.momento?.nome === 'Aguardando CTPS/laudo' && Boolean(comMomento.momento.desde),
    JSON.stringify(comMomento?.momento),
  );

  const recusado = await api.patch(`/api/contatos/${contato.id}`, { momentoId: 'momento-que-nao-existe' });
  s.ok('momento que nao e do status atual e recusado com 400', recusado.status === 400, String(recusado.status));

  const depois = (await api.patch(`/api/contatos/${contato.id}`, { statusId: qualificado.id })).dados;
  s.ok('mudar de status zera o momento', !depois?.momento, JSON.stringify(depois?.momento));

  /* Status e momento na mesma chamada: o momento vale no status NOVO. */
  const juntos = (await api.patch(`/api/contatos/${contato.id}`, {
    statusId: triagem.id,
    momentoId: aguardando.id,
  })).dados;
  s.ok('status e momento na mesma chamada: o momento e aplicado depois do status', juntos?.momento?.id === aguardando.id);

  /* ---------------- Momentos editados na tela ---------------- */

  const novo = (await api.post('/api/status', { nome: 'Teste Momentos', momentos: [' Primeiro ', 'Primeiro', '', 'Segundo'] })).dados;
  s.ok(
    'a lista de momentos e limpa: sem repetido, sem vazio, nome aparado',
    JSON.stringify((novo?.momentos || []).map((m) => m.nome)) === JSON.stringify(['Primeiro', 'Segundo']),
    JSON.stringify(novo?.momentos),
  );
  if (novo?.id) await api.delete(`/api/status/${novo.id}`);

  /* ---------------- O agente ---------------- */

  const agente = (await api.post('/api/agentes', { nome: 'Teste Momento' })).dados;
  if (agente?.id) {
    await api.patch(`/api/agentes/${agente.id}`, { prompt: 'Quando o lead mandar a CTPS, marque o @momento.' });
    const lista = (await api.get('/api/agentes')).dados || [];
    const salvo = lista.find((a) => a.id === agente.id);
    s.ok(
      'agente com @momento no prompt recebe definir_momento',
      (salvo?.ferramentas || []).includes('definir_momento'),
      (salvo?.ferramentas || []).join(', '),
    );
    await api.delete(`/api/agentes/${agente.id}`);
  }

  await api.delete(`/api/contatos/${contato.id}`);
  return s;
}
