import { listar } from './banco.js';
import { vozDisponivel } from '../ia/audio.js';

/**
 * Como o atendimento esta andando, em numeros, para /api/saude.
 *
 * Pedido do escritorio em 28/10/2026: "uma auditoria completa de cada modulo
 * ... o que faz impedir e dar continuidade ao atendimento". O diagnostico de
 * nucleo/diagnostico.js olha a CONFIGURACAO (chave, numero, template); este
 * olha o que esta acontecendo com as conversas: quem esta esperando resposta,
 * ha quanto tempo e em qual aba, conversa presa com agente desligado ou com
 * pessoa que saiu da equipe, e as falhas de envio, da IA e da conexao que o
 * sistema ja anota nos logs.
 *
 * A rota de saude e aberta: so contagens, datas e o motivo da falha com todo
 * numero comprido trocado por "#" (o erro do WhatsApp pode trazer o telefone
 * do cliente). Nenhum nome de cliente, de pessoa ou de agente.
 */

const MINUTO = 60 * 1000;
const FAIXAS = [
  ['ate15min', 15 * MINUTO],
  ['ate1h', 60 * MINUTO],
  ['ate4h', 4 * 60 * MINUTO],
  ['ate24h', 24 * 60 * MINUTO],
];

/* Mesma regra de abaDe (rotas/atendimento.js), sem os grupos, que ficam fora. */
function abaDe(contato) {
  if (contato.estado === 'arquivado') return 'concluidos';
  if (contato.responsavel?.tipo === 'agente') return 'ia';
  if (contato.aceitoPor) return 'ativos';
  return 'pendentes';
}

/* A ultima mensagem e do cliente, e ninguem respondeu depois dela (a mesma conta de whatsapp/envio.js). */
const esperandoResposta = (c) => Boolean(c.ultimaEntradaEm) && (!c.ultimaSaidaEm || c.ultimaSaidaEm < c.ultimaEntradaEm);

function faixaDe(ms) {
  for (const [nome, limite] of FAIXAS) if (ms <= limite) return nome;
  return 'maisDe24h';
}

const semNumeros = (texto) => String(texto || '').replace(/\d{6,}/g, '#').slice(0, 140);

/* Quantas vezes cada motivo apareceu, os mais frequentes primeiro. */
function motivos(logs, prefixo) {
  const contagem = new Map();
  for (const log of logs) {
    const motivo = semNumeros(String(log.descricao || '').replace(prefixo, '').trim()) || 'sem detalhe';
    const atual = contagem.get(motivo) || { motivo, vezes: 0, ultimaEm: null };
    atual.vezes += 1;
    if (!atual.ultimaEm || log.criadoEm > atual.ultimaEm) atual.ultimaEm = log.criadoEm;
    contagem.set(motivo, atual);
  }
  return [...contagem.values()].sort((a, b) => b.vezes - a.vezes).slice(0, 6);
}

const TIPOS_DE_FALHA = ['erro_envio', 'erro_ia', 'erro_voz', 'cadeia', 'passagem_prometida', 'conexao_desconectado', 'conexao_erro', 'conexao_recuperacao'];

export function saudeDoAtendimento(workspaceId, agora = Date.now()) {
  const contatos = listar('contatos', { workspaceId }).filter((c) => !c.grupo && !c.idCanal);
  const agentes = new Map(listar('agentes', { workspaceId }).map((a) => [a.id, a]));
  const membros = new Map(listar('membros', { workspaceId }).map((m) => [m.id, m]));

  const vazio = () => ({ total: 0, ate15min: 0, ate1h: 0, ate4h: 0, ate24h: 0, maisDe24h: 0, maisAntigaHaMin: 0 });
  const esperando = { ia: vazio(), ativos: vazio(), pendentes: vazio() };
  let naIaComAgenteDesligado = 0;
  let naIaComAgenteDesligadoEsperando = 0;
  let comPessoaForaDaEquipe = 0;
  let pendentesSemNinguem = 0;

  for (const contato of contatos) {
    const aba = abaDe(contato);
    if (aba === 'concluidos') continue;

    if (esperandoResposta(contato)) {
      const ms = Math.max(0, agora - Date.parse(contato.ultimaEntradaEm));
      const grupo = esperando[aba];
      grupo.total += 1;
      grupo[faixaDe(ms)] += 1;
      grupo.maisAntigaHaMin = Math.max(grupo.maisAntigaHaMin, Math.round(ms / MINUTO));
    }

    if (contato.responsavel?.tipo === 'agente') {
      const agente = agentes.get(contato.responsavel.id);
      if (!agente || !agente.ativo) {
        naIaComAgenteDesligado += 1;
        if (esperandoResposta(contato)) naIaComAgenteDesligadoEsperando += 1;
      }
    } else if (contato.responsavel?.tipo === 'membro') {
      const membro = membros.get(contato.responsavel.id);
      if (!membro || membro.ativo === false) comPessoaForaDaEquipe += 1;
    } else if (aba === 'pendentes') {
      pendentesSemNinguem += 1;
    }
  }

  const logs = listar('logs', { workspaceId }).filter((l) => TIPOS_DE_FALHA.includes(l.tipo));
  const desde = (ms) => new Date(agora - ms).toISOString();
  const umDia = desde(24 * 60 * MINUTO);
  const seteDias = desde(7 * 24 * 60 * MINUTO);
  const falhas = {};
  for (const tipo of TIPOS_DE_FALHA) {
    const doTipo = logs.filter((l) => l.tipo === tipo);
    falhas[tipo] = {
      em24h: doTipo.filter((l) => l.criadoEm >= umDia).length,
      em7dias: doTipo.filter((l) => l.criadoEm >= seteDias).length,
      ultimaEm: doTipo.length ? doTipo[doTipo.length - 1].criadoEm : null,
    };
  }
  const recentes = logs.filter((l) => l.criadoEm >= seteDias);

  const idsDosContatos = new Set(contatos.map((c) => c.id));
  const agendamentos = listar('agendamentos').filter((a) => idsDosContatos.has(a.contatoId));
  const agendamentosAtrasados = agendamentos.filter((a) => a.estado === 'pendente' && a.quando && Date.parse(a.quando) < agora - 15 * MINUTO).length;
  const agendamentosComErro = agendamentos.filter((a) => a.estado === 'erro');
  const porEstado = {};
  for (const a of agendamentos) porEstado[a.estado || 'sem estado'] = (porEstado[a.estado || 'sem estado'] || 0) + 1;
  const enviados = agendamentos.filter((a) => a.estado === 'enviado' && a.enviadoEm);
  const pendentes = agendamentos.filter((a) => a.estado === 'pendente' && a.quando);
  const canceladosNaSemana = agendamentos.filter((a) => a.estado === 'cancelado' && (a.atualizadoEm || a.criadoEm) >= seteDias);

  /* Pedido do escritorio em 29/10/2026: "os follow-ups nao estao sendo
     enviados". A sequencia so nasce quando a conversa ENTRA num status que
     tem follow-up (automacao/followup.js): aqui fica, por status, quantos
     passos ele tem e quantas conversas estao nele. */
  const comFollowupPendente = new Set(pendentes.filter((a) => a.tipo === 'followup').map((a) => a.contatoId));
  const followupPorStatus = listar('status', { workspaceId })
    .map((status) => ({
      status: status.nome,
      passos: (status.followups || []).length,
      minutos: (status.followups || []).map((p) => Number(p.minutos) || 0),
      /* No ultimo passo: para qual status o lead vai se ninguem responder, e depois de quantos dias de espera. */
      desiste: (() => {
        const ultimo = (status.followups || []).at(-1)?.desistir;
        if (!ultimo?.ativo) return null;
        return {
          para: ultimo.statusId ? listar('status', { workspaceId }).find((x) => x.id === ultimo.statusId)?.nome || null : null,
          esperaDias: (Number(ultimo.esperaMinutos) || 0) / 1440,
          arquiva: ultimo.arquivar !== false,
        };
      })(),
      aguardandoDesistir: contatos.filter((c) => c.statusId === status.id && c.desistenciaPrevista).length,
      conversas: contatos.filter((c) => c.statusId === status.id).length,
      concluidas: contatos.filter((c) => c.statusId === status.id && c.estado === 'arquivado').length,
      /* As que estao abertas no status e NAO tem follow-up a sair nem desqualificacao
         esperando: e o que a sequencia nao alcanca sozinha (a conversa ja estava no
         status quando ela foi configurada) e o botao "Iniciar o follow-up" resolve. */
      semFollowupEmAndamento: (status.followups || []).length
        ? contatos.filter((c) => c.statusId === status.id && c.estado !== 'arquivado' && !c.grupo && !c.desistenciaPrevista && !comFollowupPendente.has(c.id)).length
        : null,
    }))
    .filter((s) => s.passos || s.conversas);

  const conexoes = listar('conexoes', { workspaceId })
    .filter((c) => c.tipo !== 'simulador')
    .map((conexao) => {
      const ultimaDoCliente = contatos
        .filter((c) => c.conexaoId === conexao.id && c.ultimaEntradaEm)
        .reduce((maior, c) => (c.ultimaEntradaEm > maior ? c.ultimaEntradaEm : maior), '');
      return { tipo: conexao.tipo, estado: conexao.estado || null, ultimaMensagemDeClienteEm: ultimaDoCliente || null };
    });

  return {
    esperandoResposta: esperando,
    naIaComAgenteDesligado,
    naIaComAgenteDesligadoEsperando,
    comPessoaForaDaEquipe,
    pendentesSemNinguem,
    falhas,
    motivosDeErroDeEnvio: motivos(recentes.filter((l) => l.tipo === 'erro_envio'), 'Falha ao enviar:'),
    motivosDeErroDaIa: motivos(recentes.filter((l) => l.tipo === 'erro_ia'), 'Falha do agente:'),
    motivosDeErroDaVoz: motivos(recentes.filter((l) => l.tipo === 'erro_voz'), 'Falha da voz:'),
    agendamentos: {
      pendentes: pendentes.length,
      atrasados: agendamentosAtrasados,
      comErro: agendamentosComErro.length,
      motivosDeErro: motivos(agendamentosComErro.map((a) => ({ descricao: a.erro, criadoEm: a.atualizadoEm || a.criadoEm })), ''),
      porEstado,
      enviadosEm7dias: enviados.filter((a) => a.enviadoEm >= seteDias).length,
      ultimoEnviadoEm: enviados.reduce((maior, a) => (a.enviadoEm > maior ? a.enviadoEm : maior), '') || null,
      proximoEm: pendentes.reduce((menor, a) => (!menor || a.quando < menor ? a.quando : menor), '') || null,
      motivosDeCancelamentoEm7dias: motivos(canceladosNaSemana.map((a) => ({ descricao: a.motivoCancelamento, criadoEm: a.atualizadoEm || a.criadoEm })), ''),
    },
    followupPorStatus,
    conexoes,
  };
}

/**
 * O que falta para o agente mandar audio e fechar contrato pela ZapSign.
 * Pedido do escritorio em 29/10/2026: "quero que os agentes enviem audio ...
 * elaborando procuracao e contrato e enviando para o ZapSign". Os dois
 * dependem de configuracao em Integracoes que daqui de fora nao se via. So
 * sim/nao e contagens: chave nenhuma sai daqui.
 */
export function prontoParaContratoEVoz(workspaceId, contatos = null) {
  const integracoes = listar('integracoes', { workspaceId })[0] || {};
  const zs = integracoes.zapsign || {};
  const contratoId = zs.modeloPadraoId || null;
  const modeloDoContrato = (zs.modelos || []).find((m) => m.id === contratoId);
  const contratos = {};
  for (const c of listar('contratos', { workspaceId })) contratos[c.situacao || 'sem situacao'] = (contratos[c.situacao || 'sem situacao'] || 0) + 1;

  /*
   * QUAIS tipos de caso conseguem gerar contrato, e nao quantas chaves existem
   * no objeto.
   *
   * Ate 19/11/2026 esta linha era `Object.keys(zs.modelosPorCaso).length`, e
   * ela MENTIA. Em sugerirModelos (integracoes/zapsign.js) a entrada do caso
   * nasce quando o contrato OU a procuracao casa com o nome do modelo — entao
   * um tipo de caso em que so a procuracao casou fica gravado com
   * `contratoId: null` e era contado como coberto.
   *
   * O escritorio relatou em 19/11/2026, pela terceira vez, que "os agentes nao
   * estao enviando o link do contrato". Daqui de fora a saude dizia
   * "modelosPorCaso: 5", que se le como cinco casos resolvidos, enquanto
   * modeloDeContrato era false e existia UM contrato no banco inteiro. Numero
   * que tranquiliza sobre um sistema parado e pior do que numero nenhum: ele
   * faz procurar no lugar errado.
   *
   * Agora saem os NOMES, dos dois lados. O diagnostico em Configuracoes ja
   * contava certo desde 14/11 (nucleo/diagnostico.js), mas ele exige entrar no
   * sistema; a saude e aberta, e e por ela que da para conferir de fora o que
   * esta acontecendo sem pedir a senha de ninguem.
   */
  const casosDoEscritorio = listar('etiquetas', { workspaceId }).filter((e) => e.tipo === 'caso');
  const temContrato = (caso) => Boolean(zs.modelosPorCaso?.[caso]?.contratoId);
  const casosComContrato = casosDoEscritorio.filter((e) => temContrato(e.caso)).map((e) => e.nome);
  const casosSemContrato = casosDoEscritorio.filter((e) => !temContrato(e.caso)).map((e) => e.nome);

  /*
   * O agente PEDIU contrato e foi recusado por falta de modelo?
   *
   * E a pergunta que separa as duas causas possiveis do mesmo sintoma: ou os
   * agentes pedem e o sistema recusa (configuracao), ou eles nunca chegam na
   * etapa do contrato (roteiro). Sem isto, as duas se parecem exatamente
   * igual de fora: nenhum link chegando ao cliente.
   *
   * O dado ja era gravado — semModeloDeContrato (integracoes/zapsign.js) marca
   * `contratoSemModeloAvisadoEm` na conversa para nao avisar a equipe duas
   * vezes. So ninguem somava.
   *
   * A LISTA VEM DE FORA de proposito. A primeira versao desta contagem fazia
   * o seu proprio `listar('contatos')`, e isso reprovou dois testes de tempo
   * na hora: e uma varredura sincrona da colecao inteira, por escritorio, a
   * cada passada do relogio — trabalho que segura o laco de eventos enquanto
   * roda. Quem chama ja tem a lista na mao (automacao/reatribuir-pendentes.js
   * monta `contatos` logo acima), entao a conta sai de graca.
   *
   * E quem nao passa a lista recebe `null`, nunca zero: zero se le como
   * "nenhuma conversa foi recusada", e seria a mesma mentira que esta funcao
   * acabou de parar de contar. Null se le como "nao medido".
   */
  const recusadas = Array.isArray(contatos)
    ? contatos
        .filter((c) => c.contratoSemModeloAvisadoEm)
        .map((c) => c.contratoSemModeloAvisadoEm)
        .sort()
    : null;
  const parados = Array.isArray(contatos) ? contatos.map((c) => c.contratoParado).filter(Boolean) : null;

  return {
    zapsign: {
      chave: Boolean(zs.chave),
      modelosSincronizados: (zs.modelos || []).length,
      modeloDeContrato: Boolean(contratoId),
      procuracao: Boolean(zs.procuracaoPadraoId) || (modeloDoContrato?.extras || []).length > 0,
      /* So os casos que tem MODELO DE CONTRATO de verdade. */
      modelosPorCaso: casosComContrato.length,
      casosComContrato,
      /* Estes nao geram contrato nenhum enquanto nao houver modelo padrao. */
      casosSemContrato,
      envioDireto: zs.envioDireto !== false,
      videoDeComoAssinar: Boolean(zs.videoTutorial?.url),
    },
    vozDaOpenai: vozDisponivel(workspaceId),
    agentesQueGeramContrato: listar('agentes', { workspaceId }).filter((a) => a.ativo && /@gerarcontrato/i.test(a.prompt || '')).length,
    pedidoRecusadoSemModelo: recusadas ? { conversas: recusadas.length, ultimoEm: recusadas.at(-1) || null } : null,
    /*
     * O outro jeito de nenhum link sair: ha modelo, mas o contrato fica
     * esperando dado do cliente. Com envio direto ligado, um campo em branco
     * do modelo (RG, orgao expedidor, endereco...) segura o contrato antes de
     * ele existir, e de fora isso e identico a "sem modelo": zero contrato.
     *
     * `camposQueMaisFaltam` e o que diz onde mexer — se a maioria para no
     * mesmo campo, ou o roteiro nao pede aquele dado, ou ele nao devia estar
     * no modelo. Sao NOMES de campo, nunca o que o cliente respondeu.
     */
    contratoParadoEsperandoDado: parados
      ? {
          conversas: parados.length,
          ultimoEm: parados.map((p) => p.em).sort().at(-1) || null,
          camposQueMaisFaltam: Object.entries(
            parados.reduce((conta, p) => {
              for (const campo of String(p.campos || '').split(',').filter(Boolean)) conta[campo] = (conta[campo] || 0) + 1;
              return conta;
            }, {}),
          )
            .sort((a, b) => b[1] - a[1])
            .slice(0, 6)
            .map(([campo, vezes]) => `${campo} (${vezes})`),
        }
      : null,
    contratos,
  };
}
