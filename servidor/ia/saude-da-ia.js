import { achar, atualizar, listar, registrarLog } from '../nucleo/banco.js';
import { avisarAdministradores } from '../nucleo/avisar-administradores.js';
import { agora } from '../nucleo/util.js';

/**
 * A IA sem credito: um aviso so, e a conversa retomada quando ele volta
 * (30/10/2026).
 *
 * O que acontecia: o credito da Anthropic acabou e, durante dias, cada mensagem
 * de cliente gerava uma falha e UM aviso no sino por conversa (492 notificacoes
 * no sino, 263 falhas em 7 dias) — o aviso de verdade se perdia no meio do
 * barulho. E quando o credito voltava, ninguem tentava de novo: as conversas que
 * tinham ficado esperando continuavam esperando, a mais antiga ha quase quatro
 * dias, ate o cliente escrever outra vez ou o sistema reiniciar.
 *
 * Agora:
 *  - erro de CREDITO ou de CHAVE (os dois so passam com alguem agindo) abre um
 *    "episodio" no escritorio e avisa dono e administradores UMA vez, dizendo o
 *    que fazer. As conversas afetadas nao geram mais um aviso cada: o que ja
 *    existe no historico delas (a linha de erro) continua;
 *  - enquanto o episodio esta aberto, a cada poucos minutos uma conversa
 *    esperando serve de "sonda": se a IA responde, o credito voltou;
 *  - a primeira resposta bem-sucedida de QUALQUER conversa (ou o botao "Testar
 *    conexao") fecha o episodio, avisa que a IA voltou e retoma, sem pressa
 *    (duas por vez), as conversas que ficaram esperando.
 *
 * Erro passageiro (429, 5xx, tempo esgotado) e qualquer outro NAO abrem
 * episodio: continuam do jeito de antes.
 */

const REAVISO_MS = 24 * 60 * 60 * 1000;
/* Conversa que espera ha mais que isto ja nao e "a mesma conversa": quem a
   retoma e uma pessoa, nao a IA tres dias depois. (O reinicio do sistema, em
   retomarRespostasPendentes, continua sem esse limite, como sempre foi.) */
const IDADE_MAXIMA_MS = Number(process.env.CORREIA_RETOMADA_IA_HORAS || 72) * 60 * 60 * 1000;
const SONDA_MS = Number(process.env.CORREIA_SONDA_IA_MS) || 5 * 60 * 1000;
const ESPACO_MS = Number(process.env.CORREIA_RETOMADA_IA_ESPACO_MS ?? 2000);
const SIMULTANEAS = 2;

const dormir = (ms) => new Promise((pronto) => setTimeout(pronto, ms));

/* O motor entrega aqui o que precisa, em vez de ser importado: motor.js importa
   este arquivo, e o contrario seria um ciclo. */
let motor = { executar: null, estaRodando: () => false, cancelarCronometro: () => {} };
export function registrarMotorDaIa(funcoes) {
  motor = { ...motor, ...funcoes };
}

/** `credito` e `chave` pedem uma pessoa; `passageiro` passa sozinho; o resto e do jeito de antes. */
export function classificarErroDaIa(erro) {
  const texto = String(erro?.message || '');
  const status = Number(erro?.status || 0);
  if (
    status === 402 ||
    /credit balance is too low|insufficient[_ ]?(funds|quota|credit)|exceeded your current quota|spend limit|usage limits?/i.test(texto)
  ) {
    return 'credito';
  }
  if (status === 401 || status === 403 || /invalid x-api-key|authentication[_ ]error|incorrect api key|invalid api key/i.test(texto)) {
    return 'chave';
  }
  if (status === 408 || status === 429 || status >= 500 || /nao respondeu em|nao foi possivel falar/i.test(texto)) return 'passageiro';
  return 'outro';
}

const MENSAGENS = {
  credito: {
    titulo: 'A IA parou de responder: acabou o crédito da Anthropic',
    texto:
      'Os agentes não conseguem responder enquanto não houver crédito. Acrescente crédito em console.anthropic.com (Plans & Billing) e ligue a recarga automática; confira que o crédito está na mesma organização da chave. Em Integrações › Inteligência artificial, o botão "Testar conexão" confirma na hora. Assim que a IA voltar, o sistema retoma sozinho as conversas que ficaram esperando (até 3 dias). Este aviso vem uma vez: as conversas afetadas não geram mais um aviso cada.',
  },
  chave: {
    titulo: 'A IA parou de responder: a chave da Anthropic foi recusada',
    texto:
      'A Anthropic recusou a chave salva no sistema (inválida, revogada ou sem permissão). Confira a chave em Integrações › Inteligência artificial e use "Testar conexão". Assim que a IA voltar, o sistema retoma sozinho as conversas que ficaram esperando (até 3 dias). Este aviso vem uma vez: as conversas afetadas não geram mais um aviso cada.',
  },
};

/* ------------------------------------------------------------------ */
/* O episodio                                                          */
/* ------------------------------------------------------------------ */

export function situacaoDaIa(workspaceId) {
  const e = achar('workspaces', workspaceId)?.saudeDaIa || {};
  return {
    problema: e.problema || null,
    desde: e.desde || null,
    avisadoEm: e.avisadoEm || null,
    falhas: e.falhas || 0,
    voltouEm: e.voltouEm || null,
    retomadas: e.retomadas || 0,
  };
}

/**
 * A IA falhou numa conversa. Devolve se o aviso por conversa deve ser pulado:
 * pula quando o motivo e credito ou chave, porque o aviso unico ja diz tudo.
 */
export function iaFalhou(workspaceId, erro) {
  const classe = classificarErroDaIa(erro);
  if (classe !== 'credito' && classe !== 'chave') return { classe, suprimirAvisoPorConversa: false };
  const workspace = achar('workspaces', workspaceId);
  if (!workspace) return { classe, suprimirAvisoPorConversa: false };

  const antes = workspace.saudeDaIa || {};
  const agoraIso = agora();
  const novo = antes.problema !== classe;
  const avisadoEm = novo ? null : antes.avisadoEm || null;
  const precisaAvisar = !avisadoEm || Date.now() - new Date(avisadoEm).getTime() > REAVISO_MS;

  atualizar('workspaces', workspaceId, {
    saudeDaIa: {
      problema: classe,
      desde: novo ? agoraIso : antes.desde || agoraIso,
      avisadoEm: precisaAvisar ? agoraIso : avisadoEm,
      falhas: (novo ? 0 : antes.falhas || 0) + 1,
      ultimaFalhaEm: agoraIso,
      retomadas: novo ? 0 : antes.retomadas || 0,
      voltouEm: null,
    },
  });

  if (precisaAvisar) {
    avisarAdministradores(workspaceId, MENSAGENS[classe]);
    registrarLog(workspaceId, null, 'ia_parou', `A IA parou de responder (${classe === 'credito' ? 'sem crédito' : 'chave recusada'}); administradores avisados`);
  }
  iniciarSonda();
  return { classe, suprimirAvisoPorConversa: true };
}

/**
 * A IA respondeu. Se havia episodio aberto, fecha, avisa e retoma a fila.
 * `exceto` e a conversa que acabou de responder (ela mesma nao entra na fila).
 */
export function iaFuncionou(workspaceId, { exceto = null } = {}) {
  const workspace = achar('workspaces', workspaceId);
  const episodio = workspace?.saudeDaIa;
  if (!episodio?.problema) return;

  atualizar('workspaces', workspaceId, { saudeDaIa: { ...episodio, problema: null, voltouEm: agora() } });
  const fila = conversasEsperando(workspaceId, exceto);
  avisarAdministradores(workspaceId, {
    titulo: 'A IA voltou a responder',
    texto: fila.length
      ? `${fila.length} conversa${fila.length === 1 ? '' : 's'} que estava${fila.length === 1 ? '' : 'm'} esperando ${fila.length === 1 ? 'está' : 'estão'} sendo respondida${fila.length === 1 ? '' : 's'} agora, duas por vez.`
      : 'Os agentes voltaram a responder. Nenhuma conversa ficou esperando.',
  });
  registrarLog(workspaceId, null, 'ia_voltou', `A IA voltou a responder; ${fila.length} conversa(s) esperando serão retomadas`);
  pararSondaSeNaoHaProblema();
  if (fila.length) retomar(workspaceId, fila).catch(() => {});
}

/* ------------------------------------------------------------------ */
/* A fila                                                              */
/* ------------------------------------------------------------------ */

const estaSemResposta = (c) => Boolean(c.ultimaEntradaEm && (!c.ultimaSaidaEm || c.ultimaSaidaEm < c.ultimaEntradaEm));

/** Conversas com a IA em que o cliente falou por ultimo, do mais antigo ao mais novo, ate a idade maxima. */
export function conversasEsperando(workspaceId, exceto = null) {
  const limite = Date.now() - IDADE_MAXIMA_MS;
  return listar('contatos', { workspaceId, estado: 'ia' })
    .filter((c) => {
      if (c.id === exceto || c.grupo || c.responsavel?.tipo !== 'agente') return false;
      if (!achar('agentes', c.responsavel.id)?.ativo) return false;
      return estaSemResposta(c) && new Date(c.ultimaEntradaEm).getTime() >= limite;
    })
    .sort((a, b) => String(a.ultimaEntradaEm).localeCompare(String(b.ultimaEntradaEm)));
}

/* Duas por vez, com um respiro: a VPS tem um nucleo so e o provedor limita a rajada. */
async function retomar(workspaceId, fila) {
  if (!motor.executar) return;
  let proxima = 0;
  let feitas = 0;

  const trabalhar = async () => {
    while (proxima < fila.length) {
      const candidata = fila[proxima];
      proxima += 1;
      /* O credito acabou de novo no meio da fila: para, a sonda continua. */
      if (achar('workspaces', workspaceId)?.saudeDaIa?.problema) return;
      const atual = achar('contatos', candidata.id);
      /* Uma pessoa assumiu, ou o cliente ja foi respondido nesse meio tempo. */
      if (!atual || atual.estado !== 'ia' || atual.responsavel?.tipo !== 'agente' || !estaSemResposta(atual)) continue;
      if (motor.estaRodando(atual.id)) continue;
      /* O cronometro que o reinicio armou para ela nao pode disparar depois e
         gerar uma segunda resposta ("resposta extra"). */
      motor.cancelarCronometro(atual.id);
      try {
        await motor.executar(atual.id);
        feitas += 1;
      } catch (erro) {
        registrarLog(workspaceId, atual.id, 'erro_ia', `Falha do agente na retomada: ${erro.message}`);
        iaFalhou(workspaceId, erro);
      }
      await dormir(ESPACO_MS);
    }
  };

  await Promise.all(Array.from({ length: SIMULTANEAS }, trabalhar));

  const episodio = achar('workspaces', workspaceId)?.saudeDaIa || {};
  atualizar('workspaces', workspaceId, { saudeDaIa: { ...episodio, retomadas: (episodio.retomadas || 0) + feitas } });
}

/* ------------------------------------------------------------------ */
/* A sonda                                                             */
/* ------------------------------------------------------------------ */

let sonda = null;

const escritoriosComProblema = () => listar('workspaces').filter((w) => w.saudeDaIa?.problema);

function iniciarSonda() {
  if (sonda) return;
  sonda = setInterval(() => sondar().catch(() => {}), SONDA_MS);
  if (typeof sonda.unref === 'function') sonda.unref();
}

function pararSondaSeNaoHaProblema() {
  if (sonda && !escritoriosComProblema().length) {
    clearInterval(sonda);
    sonda = null;
  }
}

/* Uma conversa esperando serve de teste: se o modelo responde, o credito voltou
   (e quem fecha o episodio e o proprio motor, em iaFuncionou). */
async function sondar() {
  if (!motor.executar) return;
  for (const workspace of escritoriosComProblema()) {
    const candidata = conversasEsperando(workspace.id)[0];
    if (!candidata || motor.estaRodando(candidata.id)) continue;
    motor.cancelarCronometro(candidata.id);
    try {
      await motor.executar(candidata.id);
    } catch (erro) {
      iaFalhou(workspace.id, erro);
    }
  }
  pararSondaSeNaoHaProblema();
}

/** No boot: se o episodio ja estava aberto quando o sistema caiu, a sonda volta a rodar. */
export function retomarSondaDaIa() {
  if (!escritoriosComProblema().length) return 0;
  iniciarSonda();
  return escritoriosComProblema().length;
}
