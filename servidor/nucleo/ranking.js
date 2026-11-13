import { achar, atualizar, listar } from './banco.js';
import { ehAdministrador, filtrarConversasVisiveis } from './auth.js';
import { TIPOS_DE_CASO, tipoDeCasoDa } from './casos.js';
import { passosDoFunil } from './funil-da-conversa.js';
import { normalizar } from './util.js';

/**
 * Ranking: quem fecha mais casos, e com que qualidade.
 *
 * Pedido do escritorio em 13/11/2026: "um modulo de ranking [...] de quem fecha
 * mais contratos. Com pontuacao [...] por qualidade do contrato fechado". Sao
 * duas qualidades, nas palavras dele: o caso fechado "com a documentacao
 * completa e com as informacoes do caso completo", e o fechado "com as
 * documentacoes basicas".
 *
 * CONTA CASO FECHADO, E NAO CONTRATO ASSINADO. Esta e a decisao que mais muda
 * o resultado, e ela vem de um erro que ja custou uma entrega esta semana: a
 * MAIORIA das conversas que chegam a coluna "Contrato fechado" deste escritorio
 * nunca passou pela ZapSign (sao fechadas na mao ou vieram do historico
 * antigo). Um ranking preso ao contrato assinado deixaria de fora quase todo
 * mundo, e as pessoas seriam julgadas por um numero que nao e o trabalho delas.
 * Esta escrito em automacao/followup.js, no gancho que manda o caso ao Juri.
 *
 * QUEM FECHOU sai, nesta ordem:
 *   1. quem APROVOU o contrato na ZapSign (contrato.aprovadoPor), quando ha um;
 *   2. quem MOVEU a conversa para a coluna de sucesso (log do funil).
 * Sem nenhum dos dois, o caso entra como "sem atribuicao" e nao pontua para
 * ninguem — melhor um caso orfao do que um ponto dado a quem nao fez.
 *
 * A REGUA DO "COMPLETO" E DO ESCRITORIO, nao minha: cada tipo de caso tem a
 * propria lista de documentos e dados, editavel na tela. O sistema nasce com um
 * palpite (EXIGENCIAS_SUGERIDAS) que serve para o ranking funcionar no primeiro
 * dia, e que o escritorio corrige sem mexer em codigo. Chutar uma lista juridica
 * e crava-la seria julgar a equipe por uma regua inventada.
 */

/* Quanto vale cada desfecho. Editavel junto das exigencias. */
export const PONTOS_PADRAO = { completo: 3, basico: 1 };

/**
 * O palpite inicial, por tipo de caso.
 *
 * `documentos` sao PEDACOS DE NOME de arquivo: o sistema nao sabe o que ha
 * dentro de um PDF, entao um documento conta quando o nome do arquivo anexado
 * contem a palavra. E imperfeito e o escritorio precisa saber disso — por isso
 * a tela diz, com todas as letras, que a conferencia e pelo nome do arquivo.
 *
 * `dados` sao chaves das variaveis do contato, as mesmas que o contrato
 * preenche (ver as variaveis do escritorio em Configuracoes > Classes).
 */
export const EXIGENCIAS_SUGERIDAS = {
  bpc: { documentos: ['rg', 'cpf', 'cadunico'], dados: ['cpf', 'endereco', 'renda', 'pessoas_casa'] },
  auxilio: { documentos: ['laudo', 'cnis'], dados: ['cpf', 'endereco', 'doenca', 'ultima_contribuicao'] },
  auxilio_acidente: { documentos: ['laudo', 'cnis'], dados: ['cpf', 'endereco', 'data_acidente'] },
  maternidade: { documentos: ['certidao', 'cnis'], dados: ['cpf', 'endereco', 'data_parto'] },
  trabalhista: { documentos: ['ctps', 'holerite'], dados: ['cpf', 'empresa_reclamada', 'data_admissao', 'data_demissao'] },
  civel: { documentos: ['comprovante'], dados: ['cpf', 'endereco', 'problema_consumo'] },
};

/** A configuracao do escritorio: exigencias por caso e os pontos. */
export function configDoRanking(workspaceId) {
  const guardado = achar('workspaces', workspaceId)?.ranking || {};
  const exigencias = {};
  for (const tipo of TIPOS_DE_CASO) {
    const doEscritorio = guardado.exigencias?.[tipo.caso];
    const sugerida = EXIGENCIAS_SUGERIDAS[tipo.caso] || { documentos: [], dados: [] };
    exigencias[tipo.caso] = {
      caso: tipo.caso,
      nome: tipo.nome,
      /* `|| sugerida` e nao `?? sugerida`: lista vazia gravada pelo escritorio
         e uma escolha ("este caso nao exige nada"), e precisa valer. Por isso o
         teste e por Array.isArray, e nao por verdade. */
      documentos: Array.isArray(doEscritorio?.documentos) ? doEscritorio.documentos : sugerida.documentos,
      dados: Array.isArray(doEscritorio?.dados) ? doEscritorio.dados : sugerida.dados,
      /* O escritorio ja mexeu nesta lista? A tela avisa enquanto for so o
         palpite do sistema — um ranking medido por regua que ninguem conferiu
         nao deveria parecer oficial. */
      conferida: Boolean(doEscritorio),
    };
  }
  return {
    exigencias,
    pontos: {
      completo: Number(guardado.pontos?.completo) > 0 ? Number(guardado.pontos.completo) : PONTOS_PADRAO.completo,
      basico: Number(guardado.pontos?.basico) > 0 ? Number(guardado.pontos.basico) : PONTOS_PADRAO.basico,
    },
  };
}

export function salvarConfigDoRanking(workspaceId, { exigencias, pontos } = {}) {
  const atual = achar('workspaces', workspaceId)?.ranking || {};
  const novas = { ...(atual.exigencias || {}) };
  for (const [caso, valor] of Object.entries(exigencias || {})) {
    if (!TIPOS_DE_CASO.some((t) => t.caso === caso)) continue;
    novas[caso] = {
      documentos: (Array.isArray(valor?.documentos) ? valor.documentos : []).map((d) => String(d).trim()).filter(Boolean),
      dados: (Array.isArray(valor?.dados) ? valor.dados : []).map((d) => String(d).trim()).filter(Boolean),
    };
  }
  const inteiro = Number(pontos?.completo);
  const simples = Number(pontos?.basico);
  atualizar('workspaces', workspaceId, {
    ranking: {
      exigencias: novas,
      pontos: {
        completo: Number.isFinite(inteiro) && inteiro > 0 ? Math.floor(inteiro) : atual.pontos?.completo || PONTOS_PADRAO.completo,
        basico: Number.isFinite(simples) && simples > 0 ? Math.floor(simples) : atual.pontos?.basico || PONTOS_PADRAO.basico,
      },
    },
  });
  return configDoRanking(workspaceId);
}

/**
 * A qualidade do caso: completo ou basico, e o que falta.
 *
 * Sem tipo de caso marcado nao da para exigir nada — a lista e por caso. Esse
 * caso entra como basico e o que falta e o proprio tipo: e informacao util,
 * porque um caso fechado sem tipo e um caso que ninguem vai achar depois.
 */
export function qualidadeDoCaso(contato, config) {
  const tipo = tipoDeCasoDa(contato);
  if (!tipo?.caso) {
    return { completo: false, caso: null, faltando: { documentos: [], dados: [], tipoDeCaso: true } };
  }
  const exigencia = config.exigencias[tipo.caso] || { documentos: [], dados: [] };

  /* O documento conta pelo NOME do arquivo: o sistema nao le o conteudo. */
  const nomes = (contato.arquivos || []).map((a) => normalizar(a.nome || ''));
  const faltamDocumentos = exigencia.documentos.filter((pedaco) => {
    const alvo = normalizar(pedaco);
    return alvo && !nomes.some((nome) => nome.includes(alvo));
  });

  const variaveis = contato.variaveis || {};
  const faltamDados = exigencia.dados.filter((chave) => !String(variaveis[chave] ?? '').trim());

  return {
    completo: faltamDocumentos.length === 0 && faltamDados.length === 0,
    caso: tipo.caso,
    nomeDoCaso: tipo.nome,
    faltando: { documentos: faltamDocumentos, dados: faltamDados, tipoDeCaso: false },
  };
}

const dentroDoPeriodo = (iso, de, ate) => {
  if (!iso) return false;
  const dia = String(iso).slice(0, 10);
  if (de && dia < de) return false;
  if (ate && dia > ate) return false;
  return true;
};

/**
 * Quando e por quem o caso foi fechado.
 *
 * Devolve null quando ele nao foi fechado: o ranking so conta quem chegou na
 * coluna de sucesso.
 */
function fechamentoDo(contato, idsDeSucesso, contratos) {
  const assinado = contratos.find((c) => c.contatoId === contato.id && c.situacao === 'assinado');
  /* A entrada mais recente na coluna de sucesso. Sair e voltar acontece, e o
     que vale e a passagem de agora. */
  const passo = [...passosDoFunil(contato.id)].reverse().find((p) => idsDeSucesso.has(p.statusId));
  if (!assinado && !passo) return null;

  /* Quem aprovou o contrato vem na frente de quem moveu a coluna: aprovar e o
     ato deliberado de fechar, e mover pode ser arrumacao de quadro. */
  const quem = assinado?.aprovadoPor?.nome
    ? { nome: assinado.aprovadoPor.nome, id: assinado.aprovadoPor.id || null, como: 'aprovou o contrato' }
    : passo?.autor?.tipo === 'membro' && passo.autor.nome
      ? { nome: passo.autor.nome, id: passo.autor.id || null, como: 'moveu para a coluna' }
      : null;

  return {
    em: assinado?.assinadoEm || passo?.em || null,
    quem,
    agenteId: assinado?.agenteId || (contato.responsavel?.tipo === 'agente' ? contato.responsavel.id : null),
    comZapsign: Boolean(assinado),
  };
}

/** O balde de cada pessoa, zerado. */
const baldeVazio = (id, nome) => ({ id, nome, completos: 0, basicos: 0, pontos: 0, assumidas: 0, emAberto: 0 });

/** Soma um caso no balde de alguem. */
function somar(mapa, chave, nome, qualidade, pontos) {
  const atual = mapa.get(chave) || baldeVazio(chave, nome);
  if (qualidade.completo) {
    atual.completos += 1;
    atual.pontos += pontos.completo;
  } else {
    atual.basicos += 1;
    atual.pontos += pontos.basico;
  }
  if (nome) atual.nome = nome;
  mapa.set(chave, atual);
}

/**
 * O ranking do periodo.
 *
 * Respeita o que a pessoa logada pode ver, como o resto do sistema: quem tem
 * visao limitada ve o ranking da propria fatia. E informacao de gestao, mas a
 * regra de visibilidade das conversas nao muda por causa disso.
 */
export function ranking(ctx, { de = '', ate = '' } = {}) {
  const workspaceId = ctx.workspaceId;
  const config = configDoRanking(workspaceId);
  const idsDeSucesso = new Set(
    listar('status', { workspaceId })
      .filter((s) => s.tipo === 'sucesso')
      .map((s) => s.id),
  );
  const contratos = listar('contratos', { workspaceId });
  const visiveis = filtrarConversasVisiveis(ctx, listar('contatos', { workspaceId }));

  /*
   * A EQUIPE INTEIRA ENTRA NA LISTA, inclusive quem nao fechou nada.
   *
   * Pedido do escritorio em 13/11/2026: "quero que possa aparecer todos os
   * usuarios e as estatisticas, de quem ta atendendo mais, quem e que ta
   * fechando contrato mais".
   *
   * E a correcao de um defeito de desenho do primeiro ranking: montado so a
   * partir dos fechamentos, ele fazia sumir da tela exatamente quem o
   * escritorio mais precisa enxergar — quem atende muito e fecha pouco. Linha
   * zerada tambem e informacao, e some de proposito nao e o mesmo que nao ter
   * acontecido.
   */
  const pessoas = new Map();
  /*
   * A equipe inteira so para quem ENXERGA a equipe inteira.
   *
   * Para quem tem visao recortada (departamento, conexao), a conta e feita so
   * sobre as conversas que ela pode abrir. Listar o colega nessa tela o
   * mostraria com "0 fechados" quando ele pode ter fechado dez casos fora da
   * fatia dela — e zero mentiroso e pior que linha ausente: um diz uma coisa
   * falsa, o outro nao diz nada. Quem tem visao recortada ve quem apareceu no
   * proprio recorte.
   */
  const equipeInteira = ehAdministrador(ctx);
  if (equipeInteira) {
    for (const membro of listar('membros', { workspaceId })) {
      const usuario = achar('usuarios', membro.usuarioId);
      pessoas.set(membro.id, baldeVazio(membro.id, usuario?.nome || 'Sem nome'));
    }
  }

  const agentes = new Map();
  const totais = { completos: 0, basicos: 0, semAtribuicao: 0, semTipoDeCaso: 0, semZapsign: 0, assumidas: 0, emAberto: 0 };
  const faltas = new Map();

  for (const contato of visiveis) {
    /*
     * ATENDIMENTO, antes do fechamento: o balde de quem assumiu a conversa.
     *
     * `aceitoPor` guarda quem esta com a conversa na mao, e `aceitoEm` quando
     * ela foi pega. Nao e um historico: se a conversa for transferida, o campo
     * passa a ser do novo dono e a passagem anterior nao fica em lugar nenhum
     * que de para contar. Entao "assumidas" e quem esta com ela HOJE, e a tela
     * diz isso — numero que parece historico e nao e seria pior que numero
     * nenhum.
     */
    let dela = contato.aceitoPor ? pessoas.get(contato.aceitoPor) : null;
    /* Visao recortada: a lista nao nasceu com a equipe toda, entao a linha de
       quem atende aparece quando a primeira conversa dela e vista. */
    if (!dela && contato.aceitoPor && !equipeInteira) {
      const membro = achar('membros', contato.aceitoPor);
      const usuario = membro ? achar('usuarios', membro.usuarioId) : null;
      dela = baldeVazio(contato.aceitoPor, usuario?.nome || 'Sem nome');
      pessoas.set(contato.aceitoPor, dela);
    }
    if (dela) {
      if (dentroDoPeriodo(contato.aceitoEm, de, ate)) {
        dela.assumidas += 1;
        totais.assumidas += 1;
      }
      /* Em aberto e RETRATO DE AGORA, nao do periodo: conversa que ninguem
         concluiu continua pesando na pessoa hoje, tenha ela chegado neste mes
         ou no passado. E a mesma conta do Limite de casos. */
      if (contato.estado !== 'arquivado') {
        dela.emAberto += 1;
        totais.emAberto += 1;
      }
    }

    if (!idsDeSucesso.size) continue;
    const fechamento = fechamentoDo(contato, idsDeSucesso, contratos);
    if (!fechamento || !dentroDoPeriodo(fechamento.em, de, ate)) continue;

    const qualidade = qualidadeDoCaso(contato, config);
    if (qualidade.completo) totais.completos += 1;
    else totais.basicos += 1;
    if (qualidade.faltando.tipoDeCaso) totais.semTipoDeCaso += 1;
    if (!fechamento.comZapsign) totais.semZapsign += 1;

    /* O que mais falta, no escritorio inteiro: e com isso que se melhora a
       qualidade, em vez de so cobrar o numero. */
    for (const doc of qualidade.faltando.documentos) faltas.set(`documento:${doc}`, (faltas.get(`documento:${doc}`) || 0) + 1);
    for (const dado of qualidade.faltando.dados) faltas.set(`dado:${dado}`, (faltas.get(`dado:${dado}`) || 0) + 1);

    if (fechamento.quem?.id) somar(pessoas, fechamento.quem.id, fechamento.quem.nome, qualidade, config.pontos);
    else totais.semAtribuicao += 1;

    if (fechamento.agenteId) {
      const agente = achar('agentes', fechamento.agenteId);
      somar(agentes, fechamento.agenteId, agente?.nome || 'Agente removido', qualidade, config.pontos);
    }
  }

  /* Mais pontos na frente; empate desempata por completos, depois por quem
     assumiu mais (entre duas pessoas sem fechamento, quem esta atendendo vem
     antes de quem nao esta) e por fim pelo nome, para a ordem nao dancar a
     cada carregamento. */
  const ordenar = (mapa) =>
    [...mapa.values()]
      .sort(
        (a, b) =>
          b.pontos - a.pontos ||
          b.completos - a.completos ||
          (b.assumidas || 0) - (a.assumidas || 0) ||
          a.nome.localeCompare(b.nome, 'pt-BR'),
      )
      .map((linha, i) => ({ ...linha, posicao: i + 1, fechados: linha.completos + linha.basicos }));

  return {
    periodo: { de, ate },
    pontos: config.pontos,
    /* A tela avisa quando a regua ainda e o palpite do sistema. */
    reguaConferida: Object.values(config.exigencias).some((e) => e.conferida),
    /* A lista tras a equipe inteira, ou so quem apareceu na fatia de quem
       pergunta? A tela precisa saber para nao prometer o que nao mostra. */
    equipeInteira,
    pessoas: ordenar(pessoas),
    agentes: ordenar(agentes),
    totais: { ...totais, fechados: totais.completos + totais.basicos },
    /* O que mais falta, do pior para o menos pior, so os cinco primeiros. */
    faltas: [...faltas.entries()]
      .map(([chave, vezes]) => ({ tipo: chave.split(':')[0], nome: chave.split(':').slice(1).join(':'), vezes }))
      .sort((a, b) => b.vezes - a.vezes)
      .slice(0, 5),
  };
}
