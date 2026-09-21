import { atualizar, inserir, listar } from './banco.js';
import { normalizar, novoId } from './util.js';

/**
 * De onde o lead veio, lido na propria mensagem.
 *
 * Ate aqui a origem so saia de palavra-chave no texto ("vi no instagram"), e
 * palavra-chave nao separa o que o escritorio mais quer saber: se a pessoa
 * chegou por anuncio pago ou pelo perfil. O WhatsApp separa. A mensagem que
 * nasce do clique num anuncio traz a marca do anuncio (o CTWA Clid, o titulo,
 * o endereco do criativo); a que nasce do botao do perfil do Instagram traz o
 * aplicativo de entrada. Esta e a leitura dessa marca.
 *
 * CANAL e o que a marca diz, e a ORIGEM e o registro do escritorio que
 * responde por ele. Uma origem ganha `canal` quando e criada aqui ou quando a
 * migracao a reconhece pelo nome — "Anuncio Instagram" da semeadura antiga
 * passa a responder por anuncio_instagram e mantem o nome, porque prompt de
 * agente pode cita-la com @.
 */
export const CANAIS_DE_ORIGEM = [
  {
    canal: 'anuncio_instagram',
    nome: 'Tráfego pago · Instagram',
    curto: 'Pago · Instagram',
    pago: true,
    cor: 'var(--ouro)',
    nomesConhecidos: ['anuncio instagram', 'trafego pago instagram', 'trafego pago · instagram', 'instagram ads', 'ads instagram'],
  },
  {
    canal: 'anuncio_facebook',
    nome: 'Tráfego pago · Facebook',
    curto: 'Pago · Facebook',
    pago: true,
    cor: 'var(--ouro)',
    nomesConhecidos: ['anuncio facebook', 'trafego pago facebook', 'trafego pago · facebook', 'facebook ads', 'ads facebook'],
  },
  /* Anuncio da Meta sem sinal da rede: a marca de anuncio veio, a de
     Instagram ou Facebook nao. Melhor dizer "pago" do que chutar a rede. */
  {
    canal: 'anuncio',
    nome: 'Tráfego pago',
    curto: 'Tráfego pago',
    pago: true,
    cor: 'var(--ouro)',
    nomesConhecidos: ['trafego pago', 'anuncio', 'anuncios', 'ads'],
  },
  {
    canal: 'instagram',
    nome: 'Instagram',
    curto: 'Instagram',
    pago: false,
    cor: 'var(--serie-8)',
    nomesConhecidos: ['instagram', 'instagram organico', 'insta'],
  },
  {
    canal: 'facebook',
    nome: 'Facebook',
    curto: 'Facebook',
    pago: false,
    cor: 'var(--serie-6)',
    nomesConhecidos: ['facebook', 'facebook organico'],
  },
  /*
   * TikTok. O anuncio de mensagem do TikTok nao deixa marca que se leia na
   * mensagem, como o da Meta deixa: quem separa pago de organico e a frase
   * pronta do anuncio. Por isso o pago ja nasce com a palavra-chave "anuncio
   * no tiktok" — escreva o texto inicial do anuncio com ela ("Vi o anuncio no
   * TikTok e quero saber mais") e o lead cai aqui.
   */
  {
    canal: 'anuncio_tiktok',
    nome: 'Tráfego pago · TikTok',
    curto: 'Pago · TikTok',
    pago: true,
    cor: 'var(--ouro)',
    nomesConhecidos: ['anuncio tiktok', 'trafego pago tiktok', 'trafego pago · tiktok', 'tiktok ads', 'ads tiktok'],
    palavrasChave: ['anuncio no tiktok'],
  },
  {
    canal: 'tiktok',
    nome: 'TikTok',
    curto: 'TikTok',
    pago: false,
    cor: 'var(--serie-7)',
    nomesConhecidos: ['tiktok', 'tik tok', 'tiktok organico'],
    palavrasChave: ['tiktok', 'tik tok'],
  },
];

/* As palavras-chave com que a semeadura antiga criou os dois anuncios. Elas
   levavam "instagram" e "facebook" para a origem PAGA, e quem escreve "vi no
   instagram" quase sempre veio do perfil: o clique no anuncio agora e lido
   pela marca da mensagem, que e prova, e nao pelo texto. */
const PALAVRAS_DA_SEMEADURA = {
  anuncio_instagram: { antigas: ['instagram', 'insta'], vaiPara: 'instagram', ficam: [] },
  anuncio_facebook: { antigas: ['vi o anuncio', 'facebook'], vaiPara: 'facebook', ficam: ['vi o anuncio'] },
};

const minusculo = (valor) => String(valor || '').toLowerCase();
/* "ctwa_ad", "FB_Ads", "ad": marca de anuncio. "broadcast" tem "ad" no meio e
   nao e anuncio, por isso a palavra inteira entre sublinhados. */
const PALAVRA_ANUNCIO = /(^|[_\s-])ads?($|[_\s-])/;

/**
 * O canal que a marca da mensagem indica, ou null.
 *
 * `rastro` e o que os drivers extraem: ctwaClid, sourceURL, sourceType,
 * sourceApp, conversionSource e entryPoint. Nenhum campo e obrigatorio — cada
 * versao do WhatsApp manda um pedaco.
 */
export function canalDoRastro(rastro) {
  if (!rastro || typeof rastro !== 'object') return null;
  const endereco = minusculo(rastro.sourceURL);
  const aplicativo = minusculo(rastro.sourceApp);
  const conversao = minusculo(rastro.conversionSource);
  const entrada = minusculo(rastro.entryPoint);

  const pago =
    Boolean(rastro.ctwaClid) ||
    minusculo(rastro.sourceType) === 'ad' ||
    PALAVRA_ANUNCIO.test(conversao) ||
    PALAVRA_ANUNCIO.test(entrada);

  const tiktok = [endereco, aplicativo, conversao, entrada].some((v) => v.includes('tiktok'));
  const instagram =
    !tiktok && ([endereco, aplicativo, conversao, entrada].some((v) => v.includes('instagram')) || /(^|_)ig(_|$)/.test(entrada));
  const facebook =
    !tiktok &&
    !instagram &&
    ([aplicativo, conversao, entrada].some((v) => v.includes('facebook')) || /facebook\.com|fb\.me|fb\.com/.test(endereco));

  if (pago) return tiktok ? 'anuncio_tiktok' : instagram ? 'anuncio_instagram' : facebook ? 'anuncio_facebook' : 'anuncio';
  if (tiktok) return 'tiktok';
  if (instagram) return 'instagram';
  if (facebook) return 'facebook';
  return null;
}

/** O registro de origem que responde pelo canal neste workspace, criando se faltar. */
export function origemDoCanal(workspaceId, canal) {
  const definicao = CANAIS_DE_ORIGEM.find((c) => c.canal === canal);
  if (!definicao) return null;
  const existente = listar('origens', { workspaceId }).find((o) => o.canal === canal);
  if (existente) return existente;
  /* Palavra-chave de fabrica so entra se nenhuma outra origem ja a usa: duas
     origens com a mesma palavra fariam a escolha depender da ordem da lista. */
  const emUso = new Set(
    listar('origens', { workspaceId }).flatMap((o) => (o.palavrasChave || []).map(normalizar)),
  );
  return inserir('origens', {
    id: novoId('org'),
    workspaceId,
    nome: definicao.nome,
    cor: definicao.cor,
    canal,
    pago: definicao.pago,
    palavrasChave: (definicao.palavrasChave || []).filter((p) => !emUso.has(normalizar(p))),
  });
}

/** O rastro vale guardar? So quando traz alguma coisa. */
export function rastroUtil(rastro) {
  return Boolean(rastro && typeof rastro === 'object' && Object.values(rastro).some((v) => v !== null && v !== undefined && v !== ''));
}

/**
 * Acerta, em todo workspace, as origens que respondem por cada canal.
 *
 * Roda a cada subida, como a dos tipos de caso (nucleo/casos.js): barata e
 * idempotente. Os cuidados:
 *   - origem que ja existe com um nome conhecido e MARCADA, nao duplicada, e
 *     mantem o nome;
 *   - cor so entra onde nao havia cor;
 *   - as palavras-chave so mudam de lugar se ainda forem exatamente as da
 *     semeadura antiga; lista mexida a mao fica como esta.
 */
export function migrarCanaisDeOrigem() {
  let mudancas = 0;

  for (const workspace of listar('workspaces')) {
    const workspaceId = workspace.id;

    for (const definicao of CANAIS_DE_ORIGEM) {
      const origens = listar('origens', { workspaceId });
      if (origens.some((o) => o.canal === definicao.canal)) continue;

      const conhecidos = new Set([normalizar(definicao.nome), ...definicao.nomesConhecidos.map(normalizar)]);
      const pelaNome = origens.find((o) => !o.canal && conhecidos.has(normalizar(o.nome)));
      if (pelaNome) {
        atualizar('origens', pelaNome.id, {
          canal: definicao.canal,
          pago: definicao.pago,
          ...(pelaNome.cor ? {} : { cor: definicao.cor }),
        });
      } else {
        origemDoCanal(workspaceId, definicao.canal);
      }
      mudancas += 1;
    }

    for (const [canalPago, regra] of Object.entries(PALAVRAS_DA_SEMEADURA)) {
      const origens = listar('origens', { workspaceId });
      const paga = origens.find((o) => o.canal === canalPago);
      const organica = origens.find((o) => o.canal === regra.vaiPara);
      if (!paga || !organica) continue;
      const atuais = (paga.palavrasChave || []).map(normalizar);
      const daSemeadura =
        atuais.length === regra.antigas.length && regra.antigas.every((p) => atuais.includes(normalizar(p)));
      if (!daSemeadura) continue;
      const movidas = regra.antigas.filter((p) => !regra.ficam.includes(p));
      atualizar('origens', paga.id, { palavrasChave: regra.ficam });
      atualizar('origens', organica.id, {
        palavrasChave: [...new Set([...(organica.palavrasChave || []), ...movidas])],
      });
      mudancas += 1;
    }
  }

  return mudancas;
}

/** Nome da origem para o registro do historico, com o titulo do anuncio. */
export function descreverOrigem(origem, rastro) {
  const titulo = String(rastro?.title || '').trim();
  return titulo ? `${origem.nome} (anúncio "${titulo.slice(0, 80)}")` : origem.nome;
}
