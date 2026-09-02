import { TIPOS_STATUS } from '../config.js';
import { achar, atualizar, listar, remover } from '../nucleo/banco.js';
import { filtrarConversasVisiveis, podeVerConversa } from '../nucleo/auth.js';
import { consumoDoWorkspace } from '../nucleo/creditos.js';
import { emitir } from '../nucleo/eventos.js';
import { agora } from '../nucleo/util.js';
import { saudeDoDia } from '../automacao/followup.js';
import {
  FUSO,
  dentroDoHorario,
  horarioComercialDe,
  inicioDaProximaJanela,
  instanteLocal,
  partesEm,
  resumoDoHorario,
} from '../automacao/horario.js';
import { comCodigo, exigirConfiguracao } from './sessao.js';

/**
 * Painel comercial e central de agendamentos.
 *
 * O dashboard so faz sentido se os status estiverem encaixados nos tipos
 * padrao, e por isso que a tela avisa quando algum tipo ficou sem status.
 *
 * Duas convencoes valem para o arquivo inteiro:
 *
 * 1. Data e sempre o calendario de Sao Paulo, nunca o UTC cru. A tela manda
 *    AAAA-MM-DD do jeito que o escritorio le, e aqui isso vira o instante
 *    correspondente. Fatiar a string ISO jogaria a faixa das 21h a meia-noite
 *    no dia seguinte, e o resto do sistema ja raciocina nesse fuso.
 *
 * 2. Contagem por conversa e contagem por evento sao coisas diferentes e vao
 *    separadas na resposta. Os cards, o funil e serieConversas contam cada
 *    conversa uma vez por etapa, no primeiro evento daquele tipo; serieEventos
 *    conta cada mudanca de status registrada.
 */

/** Os tres tipos que somam o cartao de perdas. */
const TIPOS_PERDA = ['desqualificado', 'recusada', 'desistencia'];

/** Cor das categorias vazias do grafico de distribuicao ("Sem etiqueta" e afins). */
const COR_VAZIA = 'var(--texto-fraco)';

/**
 * Paleta de apoio para quem nao tem cor cadastrada, hoje responsavel e
 * departamento. A ordem importa: a fatia maior fica com a primeira cor.
 *
 * Sai como token do tema, e nao como hex, porque a mesma cor precisa funcionar
 * no claro e no escuro. Os valores estao em web/css/tema.css, na mesma ordem.
 */
const PALETA_DISTRIBUICAO = [
  'var(--serie-1)',
  'var(--serie-2)',
  'var(--serie-3)',
  'var(--serie-4)',
  'var(--serie-5)',
  'var(--serie-6)',
  'var(--serie-7)',
  'var(--serie-8)',
];

function dentroDoPeriodo(iso, de, ate) {
  if (!iso) return false;
  if (de && iso < de) return false;
  if (ate && iso > ate) return false;
  return true;
}

/** AAAA-MM-DD no calendario de Sao Paulo -> instante ISO das 00:00 daquele dia. */
function inicioDoDia(valor) {
  if (!valor) return null;
  const texto = String(valor);
  if (texto.includes('T')) return texto;
  const data = instanteLocal(texto, 0);
  return data ? data.toISOString() : null;
}

/** O mesmo, para o ultimo milissegundo do dia. */
function fimDoDia(valor) {
  if (!valor) return null;
  const texto = String(valor);
  if (texto.includes('T')) return texto;
  const data = instanteLocal(texto, 24 * 60);
  return data ? new Date(data.getTime() - 1).toISOString() : null;
}

/**
 * Duracao em texto curto: "2d 6h", "18h 40m" ou "45m". Ninguem no comercial
 * quer ler 158400000 milissegundos, e o segundo nao muda decisao nenhuma.
 */
function formatarDuracao(ms) {
  if (!Number.isFinite(ms) || ms < 0) return null;
  const minutos = Math.floor(ms / 60000);
  const dias = Math.floor(minutos / 1440);
  const horas = Math.floor(minutos / 60) % 24;
  const resto = minutos % 60;
  if (dias > 0) return `${dias}d ${horas}h`;
  if (horas > 0) return `${horas}h ${resto}m`;
  // "0m" nao informa nada e ainda parece defeito de calculo. Abaixo de um
  // minuto o que existe para dizer e que foi imediato.
  if (minutos < 1) return 'menos de 1 min';
  return `${resto}m`;
}

/**
 * Fecha uma distribuicao: ordena da maior para a menor e pinta com a paleta
 * de apoio quem ficou sem cor cadastrada.
 */
function fecharDistribuicao(mapa) {
  const linhas = [...mapa.values()].sort(
    (a, b) => b.total - a.total || String(a.nome).localeCompare(String(b.nome)),
  );
  let proxima = 0;
  for (const linha of linhas) {
    if (linha.cor) continue;
    linha.cor = PALETA_DISTRIBUICAO[proxima % PALETA_DISTRIBUICAO.length];
    proxima += 1;
  }
  return linhas;
}

/* Diagnostico de gargalos ---------------------------------------------- */

/**
 * Abaixo disto o funil nao diz nada.
 *
 * Com 6 conversas no periodo, uma unica que nao avancou derruba a etapa em 17
 * pontos e o painel apontaria um gargalo que e so o acaso de uma semana fraca.
 * Preferimos nao diagnosticar a diagnosticar errado: quem le vai mexer no
 * prompt do agente por causa do aviso.
 */
const MINIMO_PARA_DIAGNOSTICO = 20;

/** E dentro de cada etapa vale a mesma ideia, em escala menor. */
const MINIMO_NA_ETAPA = 5;

/*
 * Quanto a etapa pode ficar abaixo do esperado antes de virar aviso.
 *
 * A faixa de referencia e media de mercado, e nao meta: passar um pouco abaixo
 * dela e rotina. So vira gargalo quando fica em dois tercos do esperado, e vira
 * critico na metade.
 */
const TOLERANCIA_AVISO = 0.67;
const TOLERANCIA_CRITICA = 0.5;

/** O centro da faixa publicada, que e com o que a etapa real se compara. */
function centroDaFaixa(referencia) {
  if (!referencia) return null;
  const { min, max } = referencia;
  if (!Number.isFinite(min) || !Number.isFinite(max)) return null;
  return (min + max) / 2;
}

/**
 * Onde o funil vaza, e o que fazer a respeito.
 *
 * Cada etapa e comparada com a etapa anterior, e nao com o total: dizer que
 * Proposta esta em 4% das novas nao informa se o problema esta na proposta ou
 * mais atras, na qualificacao. A passagem de uma etapa para a proxima isola o
 * ponto exato onde as conversas param.
 *
 * O esperado de cada passagem sai das faixas de TIPOS_STATUS, e nao de numeros
 * escritos aqui: com duas listas, mexer na faixa de Qualificado deixaria o
 * diagnostico apontando para a antiga sem ninguem perceber.
 */
export function diagnosticarGargalos({ cards, perdas, base }) {
  if (!base || base < MINIMO_PARA_DIAGNOSTICO) {
    return {
      possivel: false,
      motivo: `Sao precisas ao menos ${MINIMO_PARA_DIAGNOSTICO} conversas no periodo para apontar gargalo com honestidade. Amplie a janela na barra de filtros.`,
      achados: [],
    };
  }

  const etapas = ['nova', 'analise', 'qualificado', 'proposta', 'sucesso'];
  const totalDe = (id) => Number(cards[id]?.total) || 0;
  const tipoDe = (id) => TIPOS_STATUS.find((t) => t.id === id);

  /* O que fazer em cada passagem. O texto e o do manual comercial: quem le o
     painel precisa sair dele sabendo onde mexer, e nao so que ha um problema. */
  const RECEITA = {
    analise: {
      titulo: 'Muita conversa nova, pouca chegando em Analise',
      acao: 'A conversa morre no primeiro contato. Confira o tempo de resposta e a primeira mensagem do agente de Recepcao.',
      onde: 'Agentes',
    },
    qualificado: {
      titulo: 'Muitos leads, poucos qualificados',
      acao: 'Revise os criterios de qualificacao no prompt. Criterio apertado demais descarta caso bom; frouxo demais entope o closer.',
      onde: 'Agentes',
    },
    proposta: {
      titulo: 'Qualificados que nao recebem proposta',
      acao: 'Verifique se o template de proposta esta configurado e se dispara sozinho quando o status vira Qualificado.',
      onde: 'Templates',
    },
    sucesso: {
      titulo: 'Proposta enviada, contrato nao assinado',
      acao: 'Simplifique a assinatura ou acrescente follow-up. Este e o degrau mais caro de perder: o trabalho todo ja foi feito.',
      onde: 'Templates',
    },
  };

  const achados = [];

  for (let i = 1; i < etapas.length; i += 1) {
    const anterior = etapas[i - 1];
    const atual = etapas[i];

    const entraram = totalDe(anterior);
    const avancaram = totalDe(atual);
    if (entraram < MINIMO_NA_ETAPA) continue;

    const centroAnterior = centroDaFaixa(tipoDe(anterior)?.referencia);
    const centroAtual = centroDaFaixa(tipoDe(atual)?.referencia);
    if (!centroAnterior || !centroAtual) continue;

    const esperado = centroAtual / centroAnterior;
    const real = avancaram / entraram;
    if (real >= esperado * TOLERANCIA_AVISO) continue;

    const receita = RECEITA[atual];
    achados.push({
      id: atual,
      gravidade: real < esperado * TOLERANCIA_CRITICA ? 'critico' : 'atencao',
      etapa: `${tipoDe(anterior).nome} para ${tipoDe(atual).nome}`,
      titulo: receita.titulo,
      real: Math.round(real * 100),
      esperado: Math.round(esperado * 100),
      detalhe: `${avancaram} de ${entraram} avancaram.`,
      acao: receita.acao,
      onde: receita.onde,
    });
  }

  /*
   * Desistencia entra por outra regra.
   *
   * Ela nao tem faixa publicada, e nem deveria ter: o que importa nao e quanto
   * se perde, e sim como. Perder para "nao tenho o caso" ou para "achei caro" e
   * trabalho feito; perder para o silencio e trabalho abandonado. Por isso o
   * aviso so aparece quando o silencio e a maior parte das perdas.
   */
  const desistencia = totalDe('desistencia');
  const totalPerdas = Number(perdas) || 0;
  if (totalPerdas >= MINIMO_NA_ETAPA && desistencia / totalPerdas > 0.5 && desistencia / base > 0.25) {
    achados.push({
      id: 'desistencia',
      gravidade: desistencia / base > 0.45 ? 'critico' : 'atencao',
      etapa: 'Perdas',
      titulo: 'A maior parte das perdas e silencio, nao recusa',
      real: Math.round((desistencia / totalPerdas) * 100),
      esperado: null,
      detalhe: `${desistencia} de ${totalPerdas} perdas foram por falta de resposta.`,
      acao: 'Lead que some nao disse nao. Revise a abordagem, o tempo de resposta e a sequencia de follow-up.',
      onde: 'Automacoes',
    });
  }

  return { possivel: true, motivo: null, achados };
}

export function registrarPainel(rotas) {
  rotas.get('/api/dashboard', async ({ ctx, query }) => {
    const de = inicioDoDia(query.de);
    const ate = fimDoDia(query.ate);
    const modo = query.modo === 'cohort' ? 'cohort' : 'evento';

    /*
     * Origem aceita mais de uma, separadas por virgula.
     *
     * Comparar criativo com criativo e o uso principal deste filtro: "Anuncio
     * BPC" contra "Anuncio Aposentadoria" na mesma janela. Com uma origem por
     * vez a comparacao virava trocar o filtro e anotar o numero no papel.
     */
    const origensPedidas = String(query.origem || '')
      .split(',')
      .map((valor) => valor.trim())
      .filter(Boolean);

    let contatos = filtrarConversasVisiveis(ctx, listar('contatos', { workspaceId: ctx.workspaceId }));
    if (origensPedidas.length) {
      const escolhidas = new Set(origensPedidas);
      contatos = contatos.filter((c) => escolhidas.has(c.origemId));
    }
    if (query.conexao) contatos = contatos.filter((c) => c.conexaoId === query.conexao);
    if (query.etiqueta) contatos = contatos.filter((c) => (c.etiquetas || []).includes(query.etiqueta));

    const porId = new Map(contatos.map((c) => [c.id, c]));
    const eventos = listar('logs', { workspaceId: ctx.workspaceId, tipo: 'status' }).filter((l) =>
      porId.has(l.contatoId),
    );

    const criadasNoPeriodo = contatos.filter((c) => dentroDoPeriodo(c.criadoEm, de, ate));
    const idsCriadas = new Set(criadasNoPeriodo.map((c) => c.id));

    const eventosConsiderados =
      modo === 'cohort'
        ? eventos.filter((evento) => idsCriadas.has(evento.contatoId))
        : eventos.filter((evento) => dentroDoPeriodo(evento.criadoEm, de, ate));

    /*
     * Universo de comparacao, o denominador de todo percentual desta tela.
     *
     * Em cohort e o que nasceu no periodo. Em evento sao as conversas que
     * tiveram movimento dentro dele, tenham nascido quando tiverem: com o
     * numerador contando evento no periodo e o denominador contando nascimento
     * no periodo, um dia de mutirao na fila antiga faria o cartao mostrar
     * 1333%, e um dia sem conversa nova zeraria todos os percentuais.
     */
    const idsUniverso = new Set(idsCriadas);
    if (modo === 'evento') for (const evento of eventosConsiderados) idsUniverso.add(evento.contatoId);
    const universo = contatos.filter((c) => idsUniverso.has(c.id));

    /* Evolucao temporal --------------------------------------------------- */
    const agrupamento = query.agrupamento || 'diario';
    const chaveDe = (iso) => {
      const data = new Date(iso);
      const p = partesEm(data, FUSO);
      const mes = String(p.mes).padStart(2, '0');
      if (agrupamento === 'mensal') return `${p.ano}-${mes}`;
      if (agrupamento === 'trimestral') return `${p.ano}-T${Math.floor((p.mes - 1) / 3) + 1}`;
      if (agrupamento === 'semanal') {
        const domingo = partesEm(new Date(data.getTime() - p.diaSemana * 86400000), FUSO);
        return `${domingo.ano}-${String(domingo.mes).padStart(2, '0')}-${String(domingo.dia).padStart(2, '0')}`;
      }
      return `${p.ano}-${mes}-${String(p.dia).padStart(2, '0')}`;
    };

    /*
     * O eixo nunca sai da janela pedida. No modo cohort o evento pode cair
     * meses depois de a conversa ter nascido; ele entra no ultimo periodo em
     * vez de esticar o grafico ate la. Sem isso, quem pede janeiro recebe
     * barras ate junho e le uma queda de captacao que nao existe.
     */
    const primeiraChave = de ? chaveDe(de) : null;
    const ultimaChave = ate ? chaveDe(ate) : null;
    const chaveNoEixo = (iso) => {
      const chave = chaveDe(iso);
      if (primeiraChave && chave < primeiraChave) return primeiraChave;
      if (ultimaChave && chave > ultimaChave) return ultimaChave;
      return chave;
    };

    const periodos = new Set();
    const porEvento = {};
    const porConversa = {};

    const linhaVazia = (chave) => ({
      periodo: chave,
      nova: 0,
      analise: 0,
      qualificado: 0,
      proposta: 0,
      sucesso: 0,
      desqualificado: 0,
      recusada: 0,
      desistencia: 0,
      perdas: 0,
    });

    const garantir = (mapa, chave) => {
      periodos.add(chave);
      if (!mapa[chave]) mapa[chave] = linhaVazia(chave);
      return mapa[chave];
    };

    /*
     * Todo periodo da janela entra no eixo, inclusive o que nao teve evento
     * nenhum. Sem isso o grafico pulava do dia 20 para o dia 30 e desenhava os
     * dois encostados, como se fossem consecutivos: sumia o intervalo parado,
     * que e justamente o que mostra o ritmo do escritorio.
     *
     * A volta anda de dia em dia e deixa chaveDe agrupar. Assim semanal,
     * mensal e trimestral saem da mesma passagem, sem repetir a regra de cada
     * um em outro lugar e correr o risco de as duas discordarem.
     */
    if (de && ate) {
      /* de e ate chegam como texto ISO, e nao como Date: inicioDoDia devolve
         string para o resto da rota poder comparar com o criadoEm do registro,
         que tambem e texto. */
      const passo = new Date(de);
      const fim = new Date(ate);
      let voltas = 0;
      while (passo <= fim && voltas < 4000) {
        const chave = chaveDe(passo);
        garantir(porEvento, chave);
        garantir(porConversa, chave);
        passo.setDate(passo.getDate() + 1);
        voltas += 1;
      }
    }

    /*
     * Uma unica passada pelos logs. O escritorio tem dezenas de milhares de
     * eventos, entao aqui saem de uma vez a serie de eventos e o indice do
     * primeiro evento de cada tipo por conversa, que alimenta os cards, o
     * tempo medio e a mini linha de cada cartao.
     */
    const primeiroPorTipo = new Map();
    for (const evento of eventosConsiderados) {
      const tipo = evento.dados?.tipo;
      if (!tipo || tipo === 'nenhum') continue;

      const linha = garantir(porEvento, chaveNoEixo(evento.criadoEm));
      if (linha[tipo] !== undefined && tipo !== 'nova') linha[tipo] += 1;
      if (TIPOS_PERDA.includes(tipo)) linha.perdas += 1;

      let primeiros = primeiroPorTipo.get(tipo);
      if (!primeiros) {
        primeiros = new Map();
        primeiroPorTipo.set(tipo, primeiros);
      }
      const anterior = primeiros.get(evento.contatoId);
      if (!anterior || evento.criadoEm < anterior) primeiros.set(evento.contatoId, evento.criadoEm);
    }

    /*
     * Perda e uma so por conversa, a mais antiga das tres. Somar os tres tipos
     * contaria duas vezes quem foi marcado como Desqualificado e depois movido
     * para Recusada, e o cartao mostraria 20 perdas em 10 conversas novas.
     */
    const primeiraPerda = new Map();
    for (const tipo of TIPOS_PERDA) {
      for (const [contatoId, quando] of primeiroPorTipo.get(tipo) || []) {
        const anterior = primeiraPerda.get(contatoId);
        if (!anterior || quando < anterior) primeiraPerda.set(contatoId, quando);
      }
    }

    for (const [tipo, primeiros] of primeiroPorTipo) {
      if (tipo === 'nova') continue;
      for (const quando of primeiros.values()) {
        const linha = garantir(porConversa, chaveNoEixo(quando));
        if (linha[tipo] !== undefined) linha[tipo] += 1;
      }
    }
    for (const quando of primeiraPerda.values()) garantir(porConversa, chaveNoEixo(quando)).perdas += 1;

    for (const contato of criadasNoPeriodo) {
      const chave = chaveNoEixo(contato.criadoEm);
      garantir(porEvento, chave).nova += 1;
      garantir(porConversa, chave).nova += 1;
    }

    const chaves = [...periodos].sort();
    const linhas = chaves.map((chave) => porConversa[chave] || linhaVazia(chave));
    const linhasEventos = chaves.map((chave) => porEvento[chave] || linhaVazia(chave));
    const indiceDoPeriodo = new Map(chaves.map((chave, indice) => [chave, indice]));

    /* Cards por tipo de status ------------------------------------------ */

    /** O relogio comeca na primeira mensagem; sem ela, na criacao da conversa. */
    const inicioDa = (contatoId) => {
      const contato = porId.get(contatoId);
      return contato?.primeiraMensagemEm || contato?.criadoEm || null;
    };

    /**
     * Mini linha e tempo medio de um cartao, a partir de um indice
     * contatoId -> quando. Cada conversa entra uma vez so, inclusive no cartao
     * de perdas, que ja chega com o desfecho mais antigo escolhido.
     */
    const resumoDe = (primeiros) => {
      const serieDoCartao = chaves.map(() => 0);
      let soma = 0;
      let amostras = 0;
      for (const [contatoId, quando] of primeiros || []) {
        const indice = indiceDoPeriodo.get(chaveNoEixo(quando));
        if (indice !== undefined) serieDoCartao[indice] += 1;
        const inicio = inicioDa(contatoId);
        if (!inicio) continue;
        const distancia = new Date(quando).getTime() - new Date(inicio).getTime();
        if (!Number.isFinite(distancia) || distancia < 0) continue;
        soma += distancia;
        amostras += 1;
      }
      return { serie: serieDoCartao, tempoMedio: amostras ? formatarDuracao(soma / amostras) : null };
    };

    const cards = {};
    for (const tipo of TIPOS_STATUS) {
      cards[tipo.id] = {
        tipo: tipo.id,
        nome: tipo.nome,
        cor: tipo.cor,
        total: 0,
        percentual: 0,
        tempoMedio: null,
        serie: chaves.map(() => 0),
      };
    }

    const novas = criadasNoPeriodo.length;
    const base = modo === 'cohort' ? novas : idsUniverso.size;
    /*
     * Casa decimal so quando a base sustenta. Com 14 conversas, cada uma vale
     * 7,1 pontos: escrever "85,7%" finge uma precisao que o dado nao tem, e uma
     * conversa a mais viraria 86,7%. Abaixo de cem, o numero inteiro e a
     * verdade; acima, a decima ja significa alguma coisa.
     */
    const porcentagem = (total) => {
      if (!base) return 0;
      const bruto = (total / base) * 100;
      return base < 100 ? Math.round(bruto) : Number(bruto.toFixed(1));
    };

    cards.nova.total = novas;
    // Nada de cravar 100% aqui: em modo evento a base sao as conversas com
    // movimento no periodo, e as novas sao apenas uma parte delas.
    cards.nova.percentual = porcentagem(novas);
    cards.nova.serie = linhas.map((linha) => linha.nova);

    for (const tipo of TIPOS_STATUS) {
      if (tipo.id === 'nova' || tipo.id === 'nenhum') continue;
      const cartao = cards[tipo.id];
      const primeiros = primeiroPorTipo.get(tipo.id);
      cartao.total = primeiros?.size || 0;
      cartao.percentual = porcentagem(cartao.total);
      const resumo = resumoDe(primeiros);
      cartao.serie = resumo.serie;
      cartao.tempoMedio = resumo.tempoMedio;
    }

    const perdas = primeiraPerda.size;
    const resumoPerdas = resumoDe(primeiraPerda);

    /*
     * Periodo anterior -----------------------------------------------------
     *
     * Numero sozinho nao informa: 14 conversas e muito ou pouco? A janela
     * anterior tem exatamente a mesma duracao e termina onde esta comeca,
     * entao a comparacao e justa, e conta pela mesma regra: uma conversa por
     * tipo, no primeiro evento daquele tipo.
     *
     * Quando nao ha nenhum evento antes do periodo, o sistema e novo demais
     * para comparar. Nesse caso nada aparece: "+14" contra um passado que nao
     * existe seria uma alta inventada.
     */
    const anterior = {};
    let temAnterior = false;
    if (de && ate) {
      const inicioAtual = new Date(de).getTime();
      const duracao = new Date(ate).getTime() - inicioAtual;
      const inicioAnterior = new Date(inicioAtual - duracao - 1).toISOString();
      const fimAnterior = new Date(inicioAtual - 1).toISOString();

      temAnterior = eventos.some((evento) => evento.criadoEm < de);

      const porTipo = new Map();
      for (const evento of eventos) {
        const tipo = evento.dados?.tipo;
        if (!tipo || tipo === 'nenhum') continue;
        if (evento.criadoEm < inicioAnterior || evento.criadoEm > fimAnterior) continue;
        let conjunto = porTipo.get(tipo);
        if (!conjunto) {
          conjunto = new Set();
          porTipo.set(tipo, conjunto);
        }
        conjunto.add(evento.contatoId);
      }
      for (const [tipo, conjunto] of porTipo) anterior[tipo] = conjunto.size;

      /* Perda continua sendo uma por conversa, igual ao periodo atual. */
      const perdidos = new Set();
      for (const tipo of TIPOS_PERDA) for (const id of porTipo.get(tipo) || []) perdidos.add(id);
      anterior.perdas = perdidos.size;

      anterior.nova = contatos.filter(
        (c) => c.criadoEm >= inicioAnterior && c.criadoEm <= fimAnterior,
      ).length;
    }

    for (const tipo of Object.keys(cards)) {
      cards[tipo].anterior = temAnterior ? anterior[tipo] || 0 : null;
    }

    /* Conversao ---------------------------------------------------------- */
    const conversoes = TIPOS_STATUS.filter((t) => t.referencia !== null).map((tipo) => ({
      tipo: tipo.id,
      nome: tipo.nome,
      cor: tipo.cor,
      total: cards[tipo.id].total,
      percentual: porcentagem(cards[tipo.id].total),
      referencia: tipo.referencia,
    }));

    /* Sankey por origem ---------------------------------------------------- */

    /* O denominador sai do mesmo recorte do numerador: as conversas do universo
       do periodo, e nao a carteira inteira daquela origem desde sempre. Sem
       isso o Instagram apareceria com 4000 novas e 12 qualificados no mes, uma
       conversao de 0,3% no lugar dos 60% reais. */
    const contatosPorOrigem = new Map();
    for (const contato of universo) {
      const lista = contatosPorOrigem.get(contato.origemId);
      if (lista) lista.push(contato);
      else contatosPorOrigem.set(contato.origemId, [contato]);
    }

    const origens = listar('origens', { workspaceId: ctx.workspaceId });
    const porOrigem = origens.map((origem) => {
      const daOrigem = contatosPorOrigem.get(origem.id) || [];
      const contar = (tipo) => {
        const primeiros = primeiroPorTipo.get(tipo);
        if (!primeiros) return 0;
        let total = 0;
        for (const contato of daOrigem) if (primeiros.has(contato.id)) total += 1;
        return total;
      };
      let perdasDaOrigem = 0;
      for (const contato of daOrigem) if (primeiraPerda.has(contato.id)) perdasDaOrigem += 1;
      return {
        id: origem.id,
        nome: origem.nome,
        novas: daOrigem.length,
        qualificados: contar('qualificado'),
        propostas: contar('proposta'),
        sucessos: contar('sucesso'),
        perdas: perdasDaOrigem,
      };
    });

    /* Diagnostico da configuracao ------------------------------------------ */
    const status = listar('status', { workspaceId: ctx.workspaceId });
    const tiposSemStatus = TIPOS_STATUS.filter(
      (t) => t.referencia !== null && !status.some((s) => s.tipo === t.id),
    ).map((t) => t.nome);

    /* Quais status alimentam cada cartao, para a dica de cada metrica ------- */
    const statusPorTipo = {};
    for (const tipo of TIPOS_STATUS) statusPorTipo[tipo.id] = [];
    statusPorTipo.perdas = [];
    for (const registro of status) {
      const tipo = registro.tipo || 'nenhum';
      if (!statusPorTipo[tipo]) continue;
      const resumo = { id: registro.id, nome: registro.nome, cor: registro.cor || COR_VAZIA };
      statusPorTipo[tipo].push(resumo);
      if (TIPOS_PERDA.includes(tipo)) statusPorTipo.perdas.push(resumo);
    }

    /*
     * O cartao herda a cor dos status que ele conta.
     *
     * A cor de TIPOS_STATUS e so reserva. Se o escritorio cadastrou status para
     * o tipo e todos usam a mesma cor, e essa que vale: o numero de Qualificado
     * no painel precisa sair na mesma cor da coluna Qualificado no Kanban e do
     * selo na conversa. Com duas fontes de cor, o mesmo estagio aparecia de uma
     * cor em cada tela, e ninguem sabia qual era a certa.
     *
     * Quando os status do tipo discordam entre si, nao ha cor unica que
     * represente o grupo: fica a reserva.
     */
    for (const [tipo, lista] of Object.entries(statusPorTipo)) {
      if (!cards[tipo] || !lista.length) continue;
      const cores = new Set(lista.map((item) => item.cor));
      if (cores.size === 1) cards[tipo].cor = lista[0].cor;
    }

    /*
     * Distribuicao atual das conversas visiveis, nao a do periodo. E a foto de
     * como a carteira esta agora, que e o que faz o gerente redistribuir fila.
     */
    const statusPorId = new Map(status.map((s) => [s.id, s]));
    const departamentosPorId = new Map(
      listar('departamentos', { workspaceId: ctx.workspaceId }).map((d) => [d.id, d]),
    );
    const etiquetasPorId = new Map(
      listar('etiquetas', { workspaceId: ctx.workspaceId }).map((e) => [e.id, e]),
    );

    const contarEm = (mapa, id, nome, cor) => {
      const atual = mapa.get(id);
      if (atual) {
        atual.total += 1;
        return;
      }
      mapa.set(id, { id, nome, cor: cor || null, total: 1 });
    };

    const distStatus = new Map();
    const distDepartamento = new Map();
    const distEtiqueta = new Map();
    const distResponsavel = new Map();

    for (const contato of contatos) {
      const registroStatus = contato.statusId ? statusPorId.get(contato.statusId) : null;
      if (registroStatus) {
        contarEm(distStatus, registroStatus.id, registroStatus.nome, registroStatus.cor || COR_VAZIA);
      } else {
        contarEm(distStatus, 'sem-status', 'Sem status', COR_VAZIA);
      }

      const departamento = contato.departamentoId ? departamentosPorId.get(contato.departamentoId) : null;
      if (departamento) contarEm(distDepartamento, departamento.id, departamento.nome, departamento.cor);
      else contarEm(distDepartamento, 'sem-departamento', 'Sem departamento', COR_VAZIA);

      const daConversa = (contato.etiquetas || []).map((id) => etiquetasPorId.get(id)).filter(Boolean);
      if (daConversa.length) {
        for (const etiqueta of daConversa) {
          contarEm(distEtiqueta, etiqueta.id, etiqueta.nome, etiqueta.cor || COR_VAZIA);
        }
      } else {
        contarEm(distEtiqueta, 'sem-etiqueta', 'Sem etiqueta', COR_VAZIA);
      }

      const responsavel = contato.responsavel;
      if (responsavel?.id) contarEm(distResponsavel, responsavel.id, responsavel.nome || 'Sem nome', null);
      else contarEm(distResponsavel, 'sem-responsavel', 'Sem responsavel', COR_VAZIA);
    }

    return {
      modo,
      agrupamento,
      /* Base de todo percentual da tela, com o nome do que ela representa, para
         o cartao nao dizer "das novas" quando o denominador e outro. */
      base: {
        total: base,
        rotulo: modo === 'cohort' ? 'novas do periodo' : 'conversas com movimento no periodo',
      },
      cards: {
        ...cards,
        perdas: {
          tipo: 'perdas',
          nome: 'Perdas',
          cor: 'var(--erro)',
          total: perdas,
          percentual: porcentagem(perdas),
          /* Perdas nao e um tipo de status, e a soma de tres deles, entao nao
             existe em cards quando o laco do anterior roda. O valor vem direto
             do agregado que ja foi calculado la em cima. */
          anterior: temAnterior ? anterior.perdas || 0 : null,
          tempoMedio: resumoPerdas.tempoMedio,
          serie: resumoPerdas.serie,
        },
      },
      statusPorTipo,
      conversoes,
      /* Onde o funil vaza e o que fazer. Vem do servidor porque e a mesma
         matematica do funil, e nao decoracao de tela: se a regra do gargalo
         morasse no navegador, ela e o numero que a origina poderiam divergir. */
      gargalos: diagnosticarGargalos({
        cards: { ...cards, perdas: { total: perdas } },
        perdas,
        base,
      }),
      /* As duas contagens, cada uma com o seu nome. serieConversas fecha com os
         cards; serieEventos mostra o movimento bruto, em que a mesma conversa
         aparece quantas vezes tiver mudado de status. */
      serieConversas: linhas,
      serieEventos: linhasEventos,
      porOrigem,
      distribuicao: {
        status: fecharDistribuicao(distStatus),
        departamento: fecharDistribuicao(distDepartamento),
        etiqueta: fecharDistribuicao(distEtiqueta),
        responsavel: fecharDistribuicao(distResponsavel),
      },
      tiposSemStatus,
      totalConversas: contatos.length,
    };
  });


  /* ---------------- Pos-venda ----------------
   *
   * O funil comercial responde "quantos fecharam". Depois do contrato assinado
   * a pergunta muda, e por isso esta tela nao e um segundo funil: ninguem
   * converte para fora do pos-venda. O que decide o dia aqui e OUTRA COISA,
   * "o que esta parado e o que vence", e um caso parado nao aparece em
   * contagem nenhuma: ele simplesmente nao se mexe, e some.
   *
   * O caso entra no pos-venda quando assina, e nao quando muda de departamento:
   * o log de tipo `sucesso` e o unico marco que nao depende de alguem lembrar
   * de arrastar a conversa para a coluna certa.
   *
   * NAO existe limite fixo de "parado" aqui de proposito. Documentacao
   * pendente ha 20 dias e problema; Processo em andamento ha 120 dias e o
   * ritmo normal do INSS. Um numero unico encheria a tela de alarme falso e a
   * primeira coisa que o escritorio faria era parar de olhar. Quem escolhe o
   * corte e quem conhece a operacao; a tela mostra a distribuicao inteira para
   * a escolha ser informada.
   */

  /** Faixas de idade. A ultima nao tem teto: e onde mora o caso esquecido. */
  const FAIXAS_IDADE = [
    { chave: 'ate7', rotulo: 'ate 7 dias', ate: 7 },
    { chave: 'ate30', rotulo: '8 a 30 dias', ate: 30 },
    { chave: 'ate60', rotulo: '31 a 60 dias', ate: 60 },
    { chave: 'mais60', rotulo: 'mais de 60 dias', ate: Infinity },
  ];

  const DIA = 86400000;

  /** Dias inteiros entre uma data e agora. Nunca negativo. */
  const diasDesde = (iso) => {
    if (!iso) return null;
    const quando = new Date(iso).getTime();
    if (!Number.isFinite(quando)) return null;
    return Math.max(0, Math.floor((Date.now() - quando) / DIA));
  };

  rotas.get('/api/pos-venda', async ({ ctx, query }) => {
    /*
     * O corte de "parado" vem da tela, com 30 dias de padrao. Fica preso entre
     * 1 e 365: com 0 todo caso apareceria como parado no mesmo dia da
     * assinatura, e acima de um ano a lista nunca teria ninguem.
     */
    const limite = Math.min(365, Math.max(1, Number(query.limite) || 30));

    const contatos = filtrarConversasVisiveis(ctx, listar('contatos', { workspaceId: ctx.workspaceId }));
    const porId = new Map(contatos.map((c) => [c.id, c]));

    /* Quem ja assinou alguma vez. O contrato pode ter sido assinado meses
       antes da janela que a pessoa esta olhando, e o caso continua vivo: por
       isso este recorte ignora periodo. */
    const assinaram = new Set();
    for (const log of listar('logs', { workspaceId: ctx.workspaceId, tipo: 'status' })) {
      if (log.dados?.tipo === 'sucesso' && porId.has(log.contatoId)) assinaram.add(log.contatoId);
    }

    const casos = contatos.filter((c) => assinaram.has(c.id) && c.estado !== 'arquivado');

    const statusPorId = new Map(listar('status', { workspaceId: ctx.workspaceId }).map((s) => [s.id, s]));

    /* Etapas -------------------------------------------------------------
     *
     * A etapa e o status atual do caso, e nao o tipo: os status de depois do
     * contrato (Documentacao pendente, Processo em andamento) tem tipo
     * "nenhum" de proposito, porque nao pertencem ao funil comercial. Ler o
     * tipo aqui juntaria todos eles num balde so chamado "sem classificacao".
     */
    const etapas = new Map();
    const semEtapa = { id: 'sem-status', nome: 'Sem status', cor: COR_VAZIA };

    const somarNaEtapa = (chave, nome, cor, dias) => {
      let etapa = etapas.get(chave);
      if (!etapa) {
        etapa = { id: chave, nome, cor, total: 0, maisAntigoDias: 0, faixas: {} };
        for (const faixa of FAIXAS_IDADE) etapa.faixas[faixa.chave] = 0;
        etapas.set(chave, etapa);
      }
      etapa.total += 1;
      if (dias !== null) {
        etapa.maisAntigoDias = Math.max(etapa.maisAntigoDias, dias);
        const faixa = FAIXAS_IDADE.find((f) => dias <= f.ate) || FAIXAS_IDADE[FAIXAS_IDADE.length - 1];
        etapa.faixas[faixa.chave] += 1;
      }
    };

    const parados = [];
    let semResponsavel = 0;

    for (const caso of casos) {
      const status = caso.statusId ? statusPorId.get(caso.statusId) : null;
      /* A idade conta do ultimo movimento de etapa, e nao da ultima mensagem.
         Conversa que troca "bom dia" toda semana sem sair do lugar continua
         parada, e e exatamente essa que engana quem olha a caixa de entrada. */
      const dias = diasDesde(caso.statusAlteradoEm || caso.criadoEm);

      somarNaEtapa(status?.id || semEtapa.id, status?.nome || semEtapa.nome, status?.cor || semEtapa.cor, dias);

      if (!caso.responsavel?.id) semResponsavel += 1;

      if (dias !== null && dias >= limite) {
        parados.push({
          id: caso.id,
          nome: caso.nome,
          telefone: caso.telefone,
          etapa: status?.nome || semEtapa.nome,
          cor: status?.cor || semEtapa.cor,
          dias,
          responsavel: caso.responsavel?.nome || null,
          ultimaMensagemDias: diasDesde(caso.ultimaMensagemEm),
        });
      }
    }

    /* O mais parado primeiro: e a ordem em que se resolve. */
    parados.sort((a, b) => b.dias - a.dias);

    /* O que vence -------------------------------------------------------
     *
     * Tarefa com prazo e a unica coisa do sistema que tem data marcada e
     * consequencia se passar. Vencidas entram junto, no topo e com dias
     * negativos: prazo que ja passou e mais urgente que prazo de amanha, e
     * escondendo o vencido a tela deixaria de avisar justo o que nao da mais
     * para adiar.
     */
    const JANELA_PRAZO = 7;
    const vencendo = [];
    for (const tarefa of listar('tarefas', { workspaceId: ctx.workspaceId })) {
      if (tarefa.situacao === 'concluida' || !tarefa.prazo) continue;
      if (tarefa.contatoId && !porId.has(tarefa.contatoId)) continue;

      const faltam = Math.ceil((new Date(tarefa.prazo).getTime() - Date.now()) / DIA);
      if (!Number.isFinite(faltam) || faltam > JANELA_PRAZO) continue;

      vencendo.push({
        id: tarefa.id,
        titulo: tarefa.titulo,
        prazo: tarefa.prazo,
        faltamDias: faltam,
        vencida: faltam < 0,
        contatoId: tarefa.contatoId || null,
        contato: tarefa.contatoId ? porId.get(tarefa.contatoId)?.nome || null : null,
      });
    }
    vencendo.sort((a, b) => a.faltamDias - b.faltamDias);

    return {
      limite,
      faixas: FAIXAS_IDADE.map(({ chave, rotulo }) => ({ chave, rotulo })),
      cards: {
        ativos: casos.length,
        parados: parados.length,
        vencendo: vencendo.length,
        semResponsavel,
      },
      /* Etapa com mais caso primeiro. Sem ordem, o gargalo aparecia no meio da
         lista conforme a ordem de cadastro dos status. */
      etapas: [...etapas.values()].sort((a, b) => b.total - a.total),
      parados: parados.slice(0, 25),
      vencendo,
    };
  });

  /* ---------------- Central de agendamentos ---------------- */

  rotas.get('/api/agendamentos', async ({ ctx, query }) => {
    const contatos = new Map(
      filtrarConversasVisiveis(ctx, listar('contatos', { workspaceId: ctx.workspaceId })).map((c) => [c.id, c]),
    );

    let agendamentos = listar('agendamentos', { workspaceId: ctx.workspaceId }).filter((a) =>
      contatos.has(a.contatoId),
    );

    if (query.estado) agendamentos = agendamentos.filter((a) => a.estado === query.estado);
    if (query.tipo) agendamentos = agendamentos.filter((a) => a.tipo === query.tipo);
    if (query.conexao) agendamentos = agendamentos.filter((a) => a.conexaoId === query.conexao);
    if (query.de) {
      const desde = inicioDoDia(query.de);
      agendamentos = agendamentos.filter((a) => a.quando >= desde);
    }
    if (query.ate) {
      const ateInstante = fimDoDia(query.ate);
      agendamentos = agendamentos.filter((a) => a.quando <= ateInstante);
    }

    /*
     * Dia e hora saem do mesmo calendario, o de Sao Paulo. Antes o dia vinha do
     * corte da string ISO (UTC) e a hora vinha do fuso do processo, entao o
     * agendamento da noite caia em um dia na contagem diaria e em outro na
     * barra por hora, e o alerta de risco de bloqueio media o dia errado.
     *
     * O pior numero do dia sai do mesmo laco, em um indice por dia. Antes a
     * lista inteira de chaves era varrida de novo para cada dia, o que com dois
     * anos de fila e cinco conexoes dava milhoes de comparacoes de texto por
     * requisicao, com a tela Inicio chamando essa rota no carregamento.
     */
    const porDia = new Map();
    const porHora = Array.from({ length: 24 }, (_, hora) => ({ hora, total: 0 }));

    for (const agendamento of agendamentos) {
      if (agendamento.estado !== 'pendente') continue;
      const p = partesEm(new Date(agendamento.quando), FUSO);
      const dia = `${p.ano}-${String(p.mes).padStart(2, '0')}-${String(p.dia).padStart(2, '0')}`;

      let linha = porDia.get(dia);
      if (!linha) {
        linha = { total: 0, porConexao: new Map() };
        porDia.set(dia, linha);
      }
      linha.total += 1;
      linha.porConexao.set(agendamento.conexaoId, (linha.porConexao.get(agendamento.conexaoId) || 0) + 1);

      porHora[p.hora].total += 1;
    }

    const dias = [...porDia.entries()]
      .map(([dia, linha]) => ({
        dia,
        total: linha.total,
        saude: saudeDoDia(Math.max(0, ...linha.porConexao.values())),
      }))
      .sort((a, b) => a.dia.localeCompare(b.dia));

    return {
      total: agendamentos.length,
      dias,
      porHora,
      agendamentos: agendamentos
        .sort((a, b) => a.quando.localeCompare(b.quando))
        .slice(0, 500)
        .map((a) => {
          const contato = contatos.get(a.contatoId);
          return {
            ...a,
            contato: contato ? { id: contato.id, nome: contato.nome, telefone: contato.telefone } : null,
            template: a.templateId ? achar('templates', a.templateId)?.nome : null,
            conexao: achar('conexoes', a.conexaoId)?.nome || null,
          };
        }),
    };
  });

  /**
   * Cancelar e reagendar mexem na fila de uma conversa, entao passam pela mesma
   * porta que a listagem: quem nao pode abrir o atendimento nao mexe na fila
   * dele, mesmo de posse de um id vindo de outra tela.
   */
  function agendamentoQuePodeMexer(ctx, id) {
    const agendamento = achar('agendamentos', id);
    if (!agendamento || agendamento.workspaceId !== ctx.workspaceId) return null;
    if (agendamento.estado !== 'pendente') return null;
    if (!podeVerConversa(ctx, achar('contatos', agendamento.contatoId))) return null;
    return agendamento;
  }

  rotas.post('/api/agendamentos/cancelar', async ({ ctx, corpo }) => {
    let cancelados = 0;
    for (const id of corpo.ids || []) {
      const agendamento = agendamentoQuePodeMexer(ctx, id);
      if (!agendamento) continue;
      atualizar('agendamentos', id, {
        estado: 'cancelado',
        motivoCancelamento: `cancelado por ${ctx.usuario.nome}`,
        canceladoEm: agora(),
      });
      cancelados += 1;
    }
    emitir(ctx.workspaceId, 'agendamento', {});
    return { ok: true, cancelados };
  });

  /**
   * Reagendamento em massa com intervalo entre mensagens. O intervalo curto e
   * o que mais derruba numero: 30 segundos e o minimo recomendado.
   *
   * O lote e ancorado uma vez so e caminha de intervalo em intervalo a partir
   * dali. Passar cada item por proximoHorarioValido sorteava um minuto dentro
   * da faixa para tudo que caisse fora da janela, o que jogava as 300 mensagens
   * em horarios aleatorios entre a abertura e o fechamento, varias no mesmo
   * minuto: exatamente a rajada que o intervalo existe para evitar. Quando o
   * cursor passa do fim do expediente, ele reancora na abertura seguinte.
   */
  rotas.post('/api/agendamentos/reagendar', async ({ ctx, corpo }) => {
    const inicio = new Date(corpo.inicio);
    if (Number.isNaN(inicio.getTime())) throw comCodigo('Informe o horario inicial.', 400);
    const intervalo = Math.max(1, Number(corpo.intervaloSegundos || 30));
    const respeitar = corpo.respeitarHorario !== false;
    const horario = horarioComercialDe(ctx.workspaceId);

    let cursor = respeitar ? inicioDaProximaJanela(inicio, horario) : inicio;
    const resultados = [];

    for (const id of corpo.ids || []) {
      const agendamento = agendamentoQuePodeMexer(ctx, id);
      if (!agendamento) continue;

      const quando = new Date(cursor.getTime());
      atualizar('agendamentos', id, { quando: quando.toISOString(), reagendadoEm: agora() });
      resultados.push({ id, quando: quando.toISOString() });

      cursor = new Date(cursor.getTime() + intervalo * 1000);
      if (respeitar && !dentroDoHorario(cursor, horario)) cursor = inicioDaProximaJanela(cursor, horario);
    }

    emitir(ctx.workspaceId, 'agendamento', {});
    return { ok: true, reagendados: resultados.length, resultados };
  });

  /** Projecao de saude antes de confirmar um reagendamento em massa. */
  rotas.post('/api/agendamentos/projecao', async ({ corpo }) => {
    const quantidade = Number(corpo.quantidade || 0);
    const intervalo = Math.max(1, Number(corpo.intervaloSegundos || 30));
    const porHora = Math.floor(3600 / intervalo);
    const duracaoMinutos = Math.ceil((quantidade * intervalo) / 60);
    return {
      porHora,
      duracaoMinutos,
      saude: saudeDoDia(quantidade),
      recomendacao:
        intervalo < 15
          ? 'Intervalo muito curto. Use 30 segundos ou mais para nao parecer disparo em massa.'
          : intervalo < 30
            ? 'Aceitavel, mas 30 segundos e o intervalo seguro.'
            : 'Intervalo saudavel.',
    };
  });

  /* ---------------- Consumo ---------------- */

  /*
   * O consumo segue a visibilidade da conversa. A lista de quem mais consumiu
   * carrega o nome do cliente, e um Suporte restrito ao Previdenciario nao pode
   * ler o nome de quem e do Trabalhista so porque abriu o dashboard.
   */
  rotas.get('/api/consumo', async ({ ctx, query }) => {
    const visiveis = new Map(
      filtrarConversasVisiveis(ctx, listar('contatos', { workspaceId: ctx.workspaceId })).map((c) => [c.id, c]),
    );

    const dados = consumoDoWorkspace(ctx.workspaceId, {
      de: inicioDoDia(query.de),
      ate: fimDoDia(query.ate),
      contatosPermitidos: new Set(visiveis.keys()),
    });

    return {
      ...dados,
      topContatos: dados.topContatos.map((item) => ({
        ...item,
        nome: visiveis.get(item.contatoId)?.nome || 'conversa removida',
      })),
    };
  });

  /* ---------------- Notificacoes ---------------- */

  rotas.get('/api/notificacoes', async ({ ctx }) =>
    listar('notificacoes', { workspaceId: ctx.workspaceId, usuarioId: ctx.usuarioId })
      .sort((a, b) => String(b.criadoEm).localeCompare(String(a.criadoEm)))
      .slice(0, 100),
  );

  /*
   * So marca como lida a notificacao que e desta pessoa e deste workspace. Sem
   * a conferencia de dono, quem participa de dois workspaces (ou conhece um id
   * alheio) apagava o aviso do sino de outra pessoa antes de ela ter visto. E a
   * conta devolvida e a do que mudou de verdade, nao a do que foi pedido.
   */
  rotas.post('/api/notificacoes/ler', async ({ ctx, corpo }) => {
    const minhas = listar('notificacoes', { workspaceId: ctx.workspaceId, usuarioId: ctx.usuarioId });
    const alvos = corpo.ids?.length
      ? minhas.filter((n) => corpo.ids.includes(n.id))
      : minhas.filter((n) => !n.lida);

    let lidas = 0;
    for (const notificacao of alvos) {
      if (notificacao.lida) continue;
      if (atualizar('notificacoes', notificacao.id, { lida: true })) lidas += 1;
    }
    return { ok: true, lidas };
  });

  rotas.delete('/api/notificacoes/:id', async ({ ctx, params }) => {
    const notificacao = achar('notificacoes', params.id);
    if (!notificacao || notificacao.usuarioId !== ctx.usuarioId) throw comCodigo('Notificacao nao encontrada.', 404);
    remover('notificacoes', params.id);
    return { ok: true };
  });

  /* ---------------- Horario comercial ---------------- */

  rotas.get('/api/horario-comercial', async ({ ctx }) => {
    const horario = horarioComercialDe(ctx.workspaceId);
    return { horario, resumo: resumoDoHorario(horario) };
  });

  /*
   * Mesma permissao do PATCH /api/workspaces/:id, que grava este mesmo campo:
   * duas portas para o mesmo registro nao podem ter regras diferentes. E o
   * corpo e conferido antes de entrar, porque um objeto sem dias faz
   * dentroDoHorario devolver sempre verdadeiro e o follow-up passa a sair de
   * madrugada para o escritorio inteiro.
   */
  rotas.put('/api/horario-comercial', async ({ ctx, corpo }) => {
    exigirConfiguracao(ctx);
    const workspace = atualizar('workspaces', ctx.workspaceId, {
      horarioComercial: conferirHorarioComercial(corpo),
    });
    return workspace.horarioComercial;
  });
}

/** HH:MM de 00:00 a 23:59, do jeito que o input type=time devolve. */
function conferirHora(valor, campo) {
  const texto = String(valor ?? '').trim();
  const casou = /^(\d{2}):(\d{2})$/.exec(texto);
  const hora = casou ? Number(casou[1]) : -1;
  const minuto = casou ? Number(casou[2]) : -1;
  if (hora < 0 || hora > 23 || minuto < 0 || minuto > 59) {
    throw comCodigo(`Horario invalido em ${campo}. Use o formato HH:MM.`, 400);
  }
  return texto;
}

/**
 * Confere o horario comercial antes de gravar: fuso reconhecido e os sete dias,
 * cada um nulo ou com de e ate em HH:MM, com o fim depois do comeco.
 */
function conferirHorarioComercial(corpo) {
  const fuso = String(corpo?.fuso || FUSO);
  try {
    new Intl.DateTimeFormat('en-CA', { timeZone: fuso });
  } catch {
    throw comCodigo('Fuso horario desconhecido.', 400);
  }

  const entrada = corpo?.dias;
  if (!entrada || typeof entrada !== 'object') throw comCodigo('Informe os dias do horario comercial.', 400);

  const dias = {};
  for (let dia = 0; dia <= 6; dia += 1) {
    const faixa = entrada[dia] ?? entrada[String(dia)] ?? null;
    if (!faixa) {
      dias[dia] = null;
      continue;
    }
    const de = conferirHora(faixa.de, `dia ${dia}`);
    const ate = conferirHora(faixa.ate, `dia ${dia}`);
    if (ate <= de) throw comCodigo(`No dia ${dia}, o fim do expediente precisa vir depois do comeco.`, 400);
    dias[dia] = { de, ate };
  }

  return { fuso, dias };
}
