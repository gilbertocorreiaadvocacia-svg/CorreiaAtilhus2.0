import { cliente, suite } from './apoio.js';

/**
 * Trocar o responsavel deixa rastro: quem fez, e de quem para quem.
 *
 * Pedido do escritorio em 16/11/2026: "se um vendedor mudar o responsavel,
 * deixar registrado quem foi".
 *
 * O que havia: a troca de UMA conversa ja era registrada com o autor, e a aba
 * Historico ja mostrava "hora · Nome". Faltavam duas coisas, e a segunda e a
 * que importa de verdade:
 *
 *  1. a linha dizia so o DESTINO ("Responsavel: Alice"). De quem o caso saiu —
 *     que e o que se quer saber quando alguem pergunta o que aconteceu — nao
 *     estava em lugar nenhum;
 *
 *  2. a troca EM MASSA (selecionar varias conversas e trocar de uma vez) nao
 *     registrava NADA. Nem quem fez, nem que aconteceu. A conversa aparecia
 *     com outro dono no dia seguinte, sem uma linha em lugar nenhum — e e o
 *     caminho mais comodo para pegar o caso de um colega, justamente por ser o
 *     que some.
 *
 * Este teste trava os dois caminhos. Nao e teste de tela: e de trilha. Um
 * rastro que some nao da erro nenhum, entao so um teste percebe que ele parou
 * de ser escrito.
 */
export async function testarQuemTrocouOResponsavel({ base }) {
  const s = suite('Trocar o responsavel deixa rastro de quem foi');
  const api = cliente(base);
  await api.entrar();

  const simulador = ((await api.get('/api/conexoes')).dados || []).find((c) => c.tipo === 'simulador');
  if (!s.ok('ha conexao de simulador', Boolean(simulador))) return s;

  /* Duas pessoas, para a troca ser DE uma PARA outra. */
  const alice = await api.post('/api/membros', { nome: 'Alice do Rastro', email: 'alice.rastro@correia.adv.br', senha: 'rastro2026', papel: 'atendente' });
  const rafael = await api.post('/api/membros', { nome: 'Rafael do Rastro', email: 'rafael.rastro@correia.adv.br', senha: 'rastro2026', papel: 'atendente' });
  if (!s.ok('as duas pessoas de teste existem', Boolean(alice.dados?.id && rafael.dados?.id), JSON.stringify([alice.dados?.id, rafael.dados?.id]))) return s;

  const criadas = [];
  const novaConversa = async (nome, telefone) => {
    const r = await api.post('/api/contatos', { conexaoId: simulador.id, telefone, nome });
    criadas.push(r.dados?.id);
    return r.dados?.id;
  };
  /* O servidor entrega do MAIS RECENTE para o mais antigo (logsDe, em
     nucleo/banco.js, ordena desc). O ultimo acontecimento e o [0] — pegar o
     fim da lista leria o primeiro registro da conversa, e as assercoes
     passariam ou falhariam todas pelo mesmo motivo errado. */
  const ultimoLog = async (id) =>
    (((await api.get(`/api/contatos/${id}/logs`)).dados || []).filter((l) => l.tipo === 'responsavel'))[0] || null;

  try {
    /* --- Uma conversa de cada vez -------------------------------------- */
    const c1 = await novaConversa('Cliente do Rastro', '5581939990001');
    if (!s.ok('a conversa de teste nasceu', Boolean(c1))) return s;

    await api.patch(`/api/contatos/${c1}`, { responsavel: { tipo: 'membro', id: alice.dados.id } });
    const primeira = await ultimoLog(c1);
    s.ok('a primeira atribuicao fica registrada', Boolean(primeira), JSON.stringify(primeira));
    s.ok('dizendo para quem foi', /Alice do Rastro/.test(primeira?.descricao || ''), primeira?.descricao || '');
    s.ok(
      'e QUEM fez a troca, que e o pedido',
      primeira?.autor?.tipo === 'membro' && /Administrador/.test(primeira?.autor?.nome || ''),
      JSON.stringify(primeira?.autor),
    );

    /* Agora a troca que interessa: tirar de uma pessoa e dar a outra. */
    await api.patch(`/api/contatos/${c1}`, { responsavel: { tipo: 'membro', id: rafael.dados.id } });
    const troca = await ultimoLog(c1);
    s.ok(
      'a troca diz DE QUEM saiu e PARA QUEM foi',
      /de Alice do Rastro para Rafael do Rastro/.test(troca?.descricao || ''),
      troca?.descricao || '',
    );
    s.ok('e continua dizendo quem fez', /Administrador/.test(troca?.autor?.nome || ''), JSON.stringify(troca?.autor));

    /* Tirar o responsavel tambem e uma troca, e tambem precisa de rastro. */
    await api.patch(`/api/contatos/${c1}`, { responsavel: null });
    const tirou = await ultimoLog(c1);
    s.ok('tirar o responsavel tambem fica registrado', /de Rafael do Rastro para ninguém/.test(tirou?.descricao || ''), tirou?.descricao || '');

    /* --- EM MASSA: o caminho que nao registrava nada -------------------- */
    const c2 = await novaConversa('Cliente em Massa 1', '5581939990002');
    const c3 = await novaConversa('Cliente em Massa 2', '5581939990003');
    await api.patch(`/api/contatos/${c2}`, { responsavel: { tipo: 'membro', id: alice.dados.id } });
    await api.patch(`/api/contatos/${c3}`, { responsavel: { tipo: 'membro', id: alice.dados.id } });

    const massa = await api.post('/api/contatos/acoes-em-massa', {
      ids: [c2, c3],
      acao: 'responsavel',
      valor: `membro:${rafael.dados.id}`,
    });
    if (!s.ok('a acao em massa responde', massa.status === 200, `${massa.status} ${JSON.stringify(massa.dados).slice(0, 120)}`)) return s;

    for (const [id, qual] of [[c2, 'primeira'], [c3, 'segunda']]) {
      const log = await ultimoLog(id);
      s.ok(`a ${qual} conversa do lote ficou registrada`, Boolean(log), JSON.stringify(log));
      s.ok(
        `e a ${qual} diz de quem para quem`,
        /de Alice do Rastro para Rafael do Rastro/.test(log?.descricao || ''),
        log?.descricao || '',
      );
      s.ok(`e quem fez a ${qual}`, /Administrador/.test(log?.autor?.nome || ''), JSON.stringify(log?.autor));
    }

    /*
     * A linha diz que foi EM MASSA. Trinta conversas trocando de dono no mesmo
     * minuto e um acontecimento diferente de trinta decisoes uma a uma, e quem
     * le a trilha depois precisa conseguir distinguir os dois.
     */
    const umaDoLote = await ultimoLog(c2);
    s.ok('e diz que a troca foi em massa, e nao uma a uma', /em massa/i.test(umaDoLote?.descricao || ''), umaDoLote?.descricao || '');
  } finally {
    for (const id of criadas.filter(Boolean)) await api.delete(`/api/contatos/${id}`);
  }
  return s;
}
