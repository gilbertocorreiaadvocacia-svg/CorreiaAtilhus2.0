import { achar, listar, mensagensSemGuardar } from './banco.js';
import { dentroDoHorario, horarioComercialDe, instanteLocal, partesEm } from '../automacao/horario.js';

/**
 * As contas do relatorio do fim de semana (pedido do escritorio, 03/11/2026):
 * quantos leads entraram, quantos foram atendidos, quantos foram qualificados e
 * desqualificados, com estatistica.
 *
 * Este arquivo SO CONTA. Quem escreve o texto em cima dos numeros e o agente
 * (ia/agente-de-relatorios.js), e ele so pode usar o que esta aqui: todo
 * numero do relatorio nasce nesta funcao e a IA nao calcula nada. Por isso
 * cada definicao esta escrita no proprio relatorio (`definicoes`), e a conta
 * esta num lugar so, testavel sem IA.
 *
 * AS DEFINICOES (as mesmas que aparecem na tela, em "Como contamos"):
 *  - Lead que entrou: conversa criada no periodo em que o CLIENTE escreveu.
 *    Fora: historico importado do celular, grupos e conversa aberta pela equipe
 *    sem nenhuma mensagem do cliente.
 *  - Atendido: o lead novo recebeu pelo menos uma resposta depois que escreveu
 *    (da IA, de uma pessoa ou do sistema). Nota interna e mensagem que falhou
 *    nao contam, e o video de boas-vindas automatico tambem nao: ele sai antes
 *    de a IA falar e nao e a resposta.
 *  - Qualificado: a conversa CHEGOU a etapa Qualificado, ou a uma seguinte
 *    (Proposta, Sucesso), dentro do periodo. Conta conversa, nao evento: quem
 *    passou por duas etapas conta uma vez. Vale para lead novo e antigo.
 *  - Desqualificado: a conversa chegou a etapa Desqualificado no periodo.
 *    Recusada e Desistencia sao outros encerramentos e vao separadas.
 *  - Tempo ate a primeira resposta: do primeiro "oi" do cliente ate a primeira
 *    resposta de verdade, em mediana (a media e puxada pela madrugada).
 *
 * TUDO NO FUSO DE SAO PAULO. "Sabado" e o sabado de quem esta no escritorio:
 * fatiar a data ISO jogaria a noite de sabado no domingo.
 */

const MINUTO = 60 * 1000;
const UM_DIA = 24 * 60 * MINUTO;
const LIMITE_DE_DIAS = 31;
const NOMES_DO_DIA = ['domingo', 'segunda-feira', 'terça-feira', 'quarta-feira', 'quinta-feira', 'sexta-feira', 'sábado'];
const NOMES_CURTOS = ['dom', 'seg', 'ter', 'qua', 'qui', 'sex', 'sáb'];

const pad = (n) => String(n).padStart(2, '0');
const FORMATO_DIA = /^\d{4}-\d{2}-\d{2}$/;

/** AAAA-MM-DD do calendario de Sao Paulo para um instante. */
export function diaDe(data) {
  const p = partesEm(data);
  return `${p.ano}-${pad(p.mes)}-${pad(p.dia)}`;
}

export function somarDias(dia, n) {
  const [ano, mes, d] = dia.split('-').map(Number);
  const t = new Date(Date.UTC(ano, mes - 1, d + n));
  return `${t.getUTCFullYear()}-${pad(t.getUTCMonth() + 1)}-${pad(t.getUTCDate())}`;
}

const diaDaSemana = (dia) => {
  const [ano, mes, d] = dia.split('-').map(Number);
  return new Date(Date.UTC(ano, mes - 1, d)).getUTCDay();
};
const dataCurta = (dia) => `${dia.slice(8, 10)}/${dia.slice(5, 7)}`;
const dataLonga = (dia) => `${dataCurta(dia)}/${dia.slice(0, 4)}`;

function erroDePeriodo(mensagem) {
  return Object.assign(new Error(mensagem), { periodoInvalido: true });
}

/**
 * O sabado do fim de semana a que o relatorio se refere: o que acabou de
 * terminar (de segunda a sexta) ou o que esta em curso (sabado e domingo).
 */
export function sabadoDoFimDeSemana(agoraData = new Date()) {
  const p = partesEm(agoraData);
  const hoje = `${p.ano}-${pad(p.mes)}-${pad(p.dia)}`;
  if (p.diaSemana === 6) return hoje;
  if (p.diaSemana === 0) return somarDias(hoje, -1);
  return somarDias(hoje, -(p.diaSemana + 1));
}

function rotuloDoPeriodo(de, ate) {
  if (de === ate) return `${NOMES_DO_DIA[diaDaSemana(de)]} ${dataLonga(de)}`;
  if (diaDaSemana(de) === 6 && ate === somarDias(de, 1)) {
    return `Fim de semana: sábado ${dataCurta(de)} e domingo ${dataLonga(ate)}`;
  }
  return `${dataLonga(de)} a ${dataLonga(ate)}`;
}

/**
 * O periodo com todos os instantes que as contas usam. `de` e `ate` sao dias
 * inclusive (AAAA-MM-DD). Periodo que ainda nao acabou fica `parcial`: o
 * relatorio vale ate o momento em que foi gerado, e diz isso.
 */
export function periodoDe({ de, ate }, agoraData = new Date()) {
  if (!FORMATO_DIA.test(String(de || '')) || !FORMATO_DIA.test(String(ate || ''))) {
    throw erroDePeriodo('Informe o período como AAAA-MM-DD.');
  }
  if (de > ate) throw erroDePeriodo('O dia final vem antes do inicial.');
  if (somarDias(de, LIMITE_DE_DIAS) <= ate) throw erroDePeriodo(`Escolha no máximo ${LIMITE_DE_DIAS} dias de uma vez.`);
  const inicio = instanteLocal(de, 0);
  const fim = new Date(instanteLocal(somarDias(ate, 1), 0).getTime() - 1);
  if (!inicio || inicio > agoraData) throw erroDePeriodo('Esse período ainda não começou.');
  const parcial = fim > agoraData;

  const dias = [];
  for (let dia = de; dia <= ate; dia = somarDias(dia, 1)) {
    dias.push({ dia, rotulo: `${NOMES_CURTOS[diaDaSemana(dia)]} ${dataCurta(dia)}` });
  }
  return {
    de,
    ate,
    inicio: inicio.toISOString(),
    fim: fim.toISOString(),
    parcial,
    dias,
    rotulo: rotuloDoPeriodo(de, ate),
  };
}

/**
 * O periodo com que este se compara: a mesma janela uma semana antes (um fim de
 * semana contra o fim de semana anterior) quando ele cabe em sete dias, e a
 * janela de mesmo tamanho logo antes quando e maior.
 */
export function periodoAnterior({ de, ate }) {
  const tamanho = Math.round((Date.parse(`${ate}T00:00:00Z`) - Date.parse(`${de}T00:00:00Z`)) / UM_DIA) + 1;
  const passo = tamanho <= 7 ? 7 : tamanho;
  return { de: somarDias(de, -passo), ate: somarDias(ate, -passo) };
}

/* ---------------------------------------------------------------- contas */

const arredondar = (valor, casas = 1) => {
  const f = 10 ** casas;
  return Math.round(valor * f) / f;
};
const pct = (parte, total) => (total > 0 ? arredondar((parte / total) * 100) : null);

function mediana(valores) {
  if (!valores.length) return null;
  const o = [...valores].sort((a, b) => a - b);
  const meio = Math.floor(o.length / 2);
  return o.length % 2 ? o[meio] : (o[meio - 1] + o[meio]) / 2;
}

function percentil(valores, p) {
  if (!valores.length) return null;
  const o = [...valores].sort((a, b) => a - b);
  return o[Math.min(o.length - 1, Math.ceil((p / 100) * o.length) - 1)];
}

/** "42 segundos", "7 minutos", "1 h 20 min": um texto pronto, para ninguem converter unidade. */
export function duracaoEmTexto(segundos) {
  if (segundos == null) return null;
  const s = Math.round(segundos);
  if (s < 60) return `${s} ${s === 1 ? 'segundo' : 'segundos'}`;
  const minutos = Math.round(s / 60);
  if (minutos < 60) return `${minutos} ${minutos === 1 ? 'minuto' : 'minutos'}`;
  const h = Math.floor(minutos / 60);
  const resto = minutos % 60;
  return resto ? `${h} h ${resto} min` : `${h} h`;
}

const TIPOS_QUALIFICADO = ['qualificado', 'proposta', 'sucesso'];
const TIPOS_OUTROS_ENCERRAMENTOS = ['recusada', 'desistencia'];
const TIPOS_DE_FALHA = ['erro_ia', 'erro_envio', 'erro_voz'];
const AUTORES_DE_IMPORTACAO = /liderhub/i;

/* Mesma regra de abaDe (rotas/atendimento.js), para dizer onde a conversa esta agora. */
function ondeEsta(contato) {
  if (contato.estado === 'arquivado') return 'concluidos';
  if (contato.responsavel?.tipo === 'agente') return 'comIa';
  if (contato.aceitoPor) return 'emAtendimento';
  return 'aguardandoHumano';
}

const semNumeros = (texto) => String(texto || '').replace(/\d{6,}/g, '#').slice(0, 140);
const cedo = (a, b) => (a < b ? a : b);
const tarde = (a, b) => (a > b ? a : b);
const ultimaAtividade = (c) => [c.ultimaMensagemEm, c.ultimaEntradaEm, c.ultimaSaidaEm, c.criadoEm].filter(Boolean).reduce(tarde, '');
const cedoParaLoop = () => new Promise((pronto) => setImmediate(pronto));

/**
 * Le uma vez o que as contas precisam: as conversas mexidas desde `desdeIso` e,
 * de cada uma, so as mensagens desse intervalo, em forma compacta. Serve ao
 * periodo e ao anterior ao mesmo tempo, sem reler o disco. As conversas sao
 * lidas sem ficar guardadas na memoria do servidor (mensagensSemGuardar), e o
 * laco respira a cada lote para nao segurar o atendimento.
 */
export async function carregarBase(workspaceId, desdeIso) {
  const contatos = listar('contatos', { workspaceId }).filter((c) => !c.grupo);
  const mensagens = new Map();
  let lidas = 0;
  for (const contato of contatos) {
    if (ultimaAtividade(contato) < desdeIso) continue;
    const lista = [];
    for (const m of mensagensSemGuardar(contato.id)) {
      if (!m.criadoEm || m.criadoEm < desdeIso) continue;
      lista.push({
        t: m.criadoEm,
        entrada: m.direcao === 'entrada',
        tipo: m.tipo,
        nota: Boolean(m.nota),
        erro: m.situacao === 'erro',
        autorTipo: m.autor?.tipo || null,
        autorId: m.autor?.id || null,
        autorNome: m.autor?.nome || null,
        templateId: m.templateId || null,
      });
    }
    if (lista.length) mensagens.set(contato.id, lista.sort((a, b) => (a.t < b.t ? -1 : a.t > b.t ? 1 : 0)));
    lidas += 1;
    if (lidas % 25 === 0) await cedoParaLoop();
  }
  const logs = listar('logs', { workspaceId }).filter((l) => l.criadoEm >= desdeIso && (l.tipo === 'status' || TIPOS_DE_FALHA.includes(l.tipo)));
  return { workspaceId, contatos, mensagens, logs, desdeIso };
}

function tipoDoStatus(statusId) {
  return statusId ? achar('status', statusId)?.tipo || 'nenhum' : 'nenhum';
}

/** Quem foi o primeiro a responder: so a classe (IA, pessoa, sistema) e o nome. */
function classeDoAutor(m) {
  if (m.autorTipo === 'agente') return 'ia';
  if (m.autorTipo === 'membro') return 'pessoa';
  return 'sistema';
}

/**
 * As contas de UM periodo, sobre a base ja carregada. `resumido` pula as
 * quebras (hora, origem, agente) quando o periodo so entra na comparacao.
 */
export function calcularPeriodo(base, periodo, { agora = new Date(), resumido = false } = {}) {
  const { workspaceId } = base;
  const dentro = (iso) => Boolean(iso) && iso >= periodo.inicio && iso <= periodo.fim;
  const horario = horarioComercialDe(workspaceId);
  const horarioConfigurado = Object.values(horario.dias || {}).some(Boolean);
  const welcomeDe = (c) => (c.boasVindasEnviadasEm ? c.boasVindasTemplateId : null);

  /* ---- Falhas por conversa e no total (so as do periodo). ---- */
  const falhasDoPeriodo = base.logs.filter((l) => TIPOS_DE_FALHA.includes(l.tipo) && dentro(l.criadoEm));
  const comFalha = new Set(falhasDoPeriodo.filter((l) => l.tipo !== 'erro_voz').map((l) => l.contatoId));

  /* ---- Os leads novos. ---- */
  const novos = [];
  let criadosPelaEquipe = 0;
  for (const c of base.contatos) {
    if (c.importado || !dentro(c.criadoEm)) continue;
    const mensagens = base.mensagens.get(c.id) || [];
    const primeira = mensagens.find((m) => m.entrada && m.t >= c.criadoEm);
    if (!primeira) {
      criadosPelaEquipe += 1;
      continue;
    }
    const resposta = mensagens.find(
      (m) => !m.entrada && !m.nota && !m.erro && m.t >= primeira.t && !(m.templateId && m.templateId === welcomeDe(c)),
    );
    novos.push({ contato: c, primeira, resposta });
  }
  const novosIds = new Set(novos.map((n) => n.contato.id));

  const atendidos = novos.filter((n) => n.resposta);
  const semResposta = novos.filter((n) => !n.resposta);
  const porClasse = { ia: 0, pessoa: 0, sistema: 0 };
  const esperasSeg = [];
  for (const n of atendidos) {
    porClasse[classeDoAutor(n.resposta)] += 1;
    esperasSeg.push(Math.max(0, (Date.parse(n.resposta.t) - Date.parse(n.primeira.t)) / 1000));
  }
  const medianaSeg = mediana(esperasSeg);
  const p90Seg = percentil(esperasSeg, 90);

  let foraDoHorario = null;
  if (horarioConfigurado) {
    const fora = novos.filter((n) => !dentroDoHorario(new Date(n.primeira.t), horario));
    foraDoHorario = {
      novos: fora.length,
      atendidos: fora.filter((n) => n.resposta).length,
      atendidosPorIa: fora.filter((n) => n.resposta && classeDoAutor(n.resposta) === 'ia').length,
    };
  }

  /* ---- Mudancas de etapa no periodo (todas as conversas, novas e antigas). ---- */
  const eventos = base.logs.filter((l) => l.tipo === 'status' && dentro(l.criadoEm) && !AUTORES_DE_IMPORTACAO.test(l.autor?.nome || ''));
  /* tipo -> contatoId -> primeiro evento (quem fez, quando) */
  const chegouA = new Map();
  for (const e of eventos.sort((a, b) => (a.criadoEm < b.criadoEm ? -1 : 1))) {
    const tipo = e.dados?.tipo || tipoDoStatus(e.dados?.statusId);
    if (!chegouA.has(tipo)) chegouA.set(tipo, new Map());
    if (!chegouA.get(tipo).has(e.contatoId)) chegouA.get(tipo).set(e.contatoId, e);
  }
  const contatosDe = (tipos) => {
    const mapa = new Map();
    for (const tipo of tipos) for (const [id, e] of chegouA.get(tipo) || []) if (!mapa.has(id) || e.criadoEm < mapa.get(id).criadoEm) mapa.set(id, e);
    return mapa;
  };
  const resumoDeEventos = (mapa) => {
    const porAutor = new Map();
    for (const e of mapa.values()) {
      const nome = e.autor?.nome || 'Sistema';
      const classe = e.autor?.tipo === 'agente' ? 'ia' : e.autor?.tipo === 'membro' ? 'pessoa' : 'sistema';
      const chave = `${classe}:${e.autor?.id || nome}`;
      const atual = porAutor.get(chave) || { nome, classe, quantidade: 0 };
      atual.quantidade += 1;
      porAutor.set(chave, atual);
    }
    const ids = [...mapa.keys()];
    return {
      total: ids.length,
      deLeadsNovos: ids.filter((id) => novosIds.has(id)).length,
      deConversasAntigas: ids.filter((id) => !novosIds.has(id)).length,
      porAutor: [...porAutor.values()].sort((a, b) => b.quantidade - a.quantidade).slice(0, 8),
    };
  };
  const qualificadosMapa = contatosDe(TIPOS_QUALIFICADO);
  const desqualificadosMapa = contatosDe(['desqualificado']);
  const qualificados = resumoDeEventos(qualificadosMapa);
  qualificados.porEtapa = Object.fromEntries(TIPOS_QUALIFICADO.map((t) => [t, (chegouA.get(t) || new Map()).size]));
  const desqualificados = resumoDeEventos(desqualificadosMapa);
  const outrosEncerramentos = Object.fromEntries(TIPOS_OUTROS_ENCERRAMENTOS.map((t) => [t, (chegouA.get(t) || new Map()).size]));

  /* ---- Mensagens e conversas ativas. ---- */
  let recebidas = 0;
  let enviadas = 0;
  let audiosRecebidos = 0;
  let enviadasPorIa = 0;
  let enviadasPorPessoas = 0;
  const ativas = new Set();
  const porDiaMapa = new Map(periodo.dias.map((d) => [d.dia, { dia: d.dia, rotulo: d.rotulo, novos: 0, atendidos: 0, qualificados: 0, desqualificados: 0, recebidas: 0, enviadas: 0 }]));
  const linhaDoDia = (iso) => porDiaMapa.get(diaDe(new Date(iso)));
  for (const [contatoId, lista] of base.mensagens) {
    for (const m of lista) {
      if (!dentro(m.t) || m.nota) continue;
      const dia = linhaDoDia(m.t);
      if (m.entrada) {
        recebidas += 1;
        if (m.tipo === 'audio') audiosRecebidos += 1;
        ativas.add(contatoId);
        if (dia) dia.recebidas += 1;
      } else if (!m.erro) {
        enviadas += 1;
        if (m.autorTipo === 'agente') enviadasPorIa += 1;
        else if (m.autorTipo === 'membro') enviadasPorPessoas += 1;
        if (dia) dia.enviadas += 1;
      }
    }
  }
  for (const n of novos) {
    const dia = linhaDoDia(n.primeira.t);
    if (dia) {
      dia.novos += 1;
      if (n.resposta) dia.atendidos += 1;
    }
  }
  for (const [mapa, campo] of [[qualificadosMapa, 'qualificados'], [desqualificadosMapa, 'desqualificados']]) {
    for (const e of mapa.values()) {
      const dia = linhaDoDia(e.criadoEm);
      if (dia) dia[campo] += 1;
    }
  }

  /* ---- Onde os leads novos estao agora, e em que etapa. ---- */
  const etapa = { nova: 0, analise: 0, qualificado: 0, proposta: 0, sucesso: 0, desqualificado: 0, recusada: 0, desistencia: 0, nenhum: 0 };
  const onde = { comIa: 0, aguardandoHumano: 0, emAtendimento: 0, concluidos: 0 };
  for (const n of novos) {
    const tipo = tipoDoStatus(n.contato.statusId);
    etapa[tipo in etapa ? tipo : 'nenhum'] += 1;
    onde[ondeEsta(n.contato)] += 1;
  }
  const qualificadosHoje = etapa.qualificado + etapa.proposta + etapa.sucesso;

  /* ---- Contratos e follow-ups. ---- */
  const contratos = listar('contratos', { workspaceId });
  const followups = listar('agendamentos', { workspaceId }).filter((a) => a.tipo === 'followup' && a.estado === 'enviado' && dentro(a.enviadoEm));

  /* ---- Falhas (so contagem e motivo, sem dado de cliente). ---- */
  const falhas = Object.fromEntries(TIPOS_DE_FALHA.map((t) => [t, falhasDoPeriodo.filter((l) => l.tipo === t).length]));
  const motivosMapa = new Map();
  for (const l of falhasDoPeriodo) {
    const motivo = semNumeros(String(l.descricao || '').replace(/^Falha[^:]{0,20}:\s*/i, '').trim()) || 'sem detalhe';
    motivosMapa.set(motivo, (motivosMapa.get(motivo) || 0) + 1);
  }
  const motivos = [...motivosMapa.entries()].map(([motivo, vezes]) => ({ motivo, vezes })).sort((a, b) => b.vezes - a.vezes).slice(0, 4);

  const total = novos.length;
  const resultado = {
    leads: {
      novos: total,
      atendidos: atendidos.length,
      atendidosPct: pct(atendidos.length, total),
      semResposta: semResposta.length,
      semRespostaPorFalha: semResposta.filter((n) => comFalha.has(n.contato.id)).length,
      primeiraRespostaPor: porClasse,
      primeiraResposta: {
        amostras: esperasSeg.length,
        medianaSeg: medianaSeg == null ? null : Math.round(medianaSeg),
        medianaTxt: duracaoEmTexto(medianaSeg),
        p90Seg: p90Seg == null ? null : Math.round(p90Seg),
        p90Txt: duracaoEmTexto(p90Seg),
        ate1minPct: pct(esperasSeg.filter((s) => s <= 60).length, esperasSeg.length),
        ate5minPct: pct(esperasSeg.filter((s) => s <= 300).length, esperasSeg.length),
        p90Frase: p90Seg == null ? null : `9 em cada 10 leads atendidos receberam a primeira resposta em até ${duracaoEmTexto(p90Seg)}`,
      },
      foraDoHorario,
      conversasAtivas: ativas.size,
      retornos: [...ativas].filter((id) => !novosIds.has(id)).length,
      criadosPelaEquipe,
    },
    qualificacao: {
      qualificados,
      desqualificados,
      outrosEncerramentos,
      dosLeadsNovosHoje: {
        qualificados: qualificadosHoje,
        qualificadosPct: pct(qualificadosHoje, total),
        desqualificados: etapa.desqualificado,
        desqualificadosPct: pct(etapa.desqualificado, total),
      },
    },
    etapaDosLeadsNovos: etapa,
    ondeEstaoOsLeadsNovos: onde,
    porDia: [...porDiaMapa.values()],
    mensagens: { recebidas, enviadas, audiosRecebidos, enviadasPorIa, enviadasPorPessoas },
    contratos: {
      assinados: contratos.filter((c) => c.situacao === 'assinado' && dentro(c.assinadoEm)).length,
      criados: contratos.filter((c) => dentro(c.criadoEm)).length,
    },
    followups: { enviados: followups.length },
    falhas: { ...falhas, total: falhas.erro_ia + falhas.erro_envio + falhas.erro_voz, motivos },
  };

  if (!resumido) {
    const porHora = Array.from({ length: 24 }, (_, hora) => ({ hora, novos: 0 }));
    for (const n of novos) porHora[partesEm(new Date(n.primeira.t)).hora].novos += 1;
    const pico = [...porHora].sort((a, b) => b.novos - a.novos || a.hora - b.hora)[0];
    resultado.porHora = porHora;
    resultado.picoDeEntrada = pico?.novos > 1 ? { hora: pico.hora, novos: pico.novos, txt: `entre ${pico.hora}h e ${(pico.hora + 1) % 24}h` } : null;

    const contar = (chaveDe) => {
      const mapa = new Map();
      for (const n of novos) {
        const nome = chaveDe(n.contato) || 'Sem informação';
        const atual = mapa.get(nome) || { nome, novos: 0, atendidos: 0, qualificados: 0 };
        atual.novos += 1;
        if (n.resposta) atual.atendidos += 1;
        if (qualificadosMapa.has(n.contato.id)) atual.qualificados += 1;
        mapa.set(nome, atual);
      }
      return [...mapa.values()].sort((a, b) => b.novos - a.novos).slice(0, 8);
    };
    const nomeDoCanal = { whatsapp: 'WhatsApp', instagram: 'Instagram', tiktok: 'TikTok' };
    resultado.porCanal = contar((c) => nomeDoCanal[c.canal || 'whatsapp'] || c.canal);
    resultado.porNumero = contar((c) => achar('conexoes', c.conexaoId)?.nome || null);
    resultado.porOrigem = contar((c) => (c.origemId ? achar('origens', c.origemId)?.nome : null));

    /* Quem respondeu primeiro, por agente de IA / pessoa. */
    const quem = new Map();
    for (const n of atendidos) {
      const r = n.resposta;
      const nome = r.autorNome || (classeDoAutor(r) === 'sistema' ? 'Sistema' : 'Sem nome');
      const chave = `${classeDoAutor(r)}:${r.autorId || nome}`;
      const atual = quem.get(chave) || { nome, classe: classeDoAutor(r), atendidos: 0 };
      atual.atendidos += 1;
      quem.set(chave, atual);
    }
    resultado.quemRespondeuPrimeiro = [...quem.values()].sort((a, b) => b.atendidos - a.atendidos).slice(0, 8);

    /* O retrato no momento em que o relatorio e gerado, nao no periodo. So entram
       as conversas em que o cliente escreveu desde o inicio do periodo: o resto
       da base inclui anos de historico importado, cuja ultima fala e do cliente
       e que nao tem nada a ver com este fim de semana. */
    const esperando = base.contatos.filter(
      (c) => c.estado !== 'arquivado' && c.ultimaEntradaEm >= periodo.inicio && (!c.ultimaSaidaEm || c.ultimaSaidaEm < c.ultimaEntradaEm),
    );
    resultado.noMomento = {
      geradoEm: agora.toISOString(),
      esperandoResposta: esperando.length,
      esperandoHaMaisDe1h: esperando.filter((c) => agora.getTime() - Date.parse(c.ultimaEntradaEm) > 60 * MINUTO).length,
    };
  }
  return resultado;
}

/** O que entra na comparacao com o periodo anterior. */
function cabecalhoParaComparar(r) {
  return {
    novos: r.leads.novos,
    atendidos: r.leads.atendidos,
    atendidosPct: r.leads.atendidosPct,
    qualificados: r.qualificacao.qualificados.total,
    desqualificados: r.qualificacao.desqualificados.total,
    medianaSeg: r.leads.primeiraResposta.medianaSeg,
    medianaTxt: r.leads.primeiraResposta.medianaTxt,
  };
}

function variacao(atual, anterior) {
  if (atual == null || anterior == null) return null;
  const diferenca = arredondar(atual - anterior);
  return { diferenca, pct: anterior > 0 ? arredondar(((atual - anterior) / anterior) * 100) : null };
}

export const DEFINICOES = [
  'Lead que entrou: conversa criada no período em que o cliente escreveu. Ficam de fora o histórico importado do celular, os grupos e a conversa aberta pela equipe sem mensagem do cliente.',
  'Atendido: o lead novo recebeu ao menos uma resposta depois de escrever (da IA, de uma pessoa ou do sistema). Nota interna, mensagem que falhou e o vídeo automático de boas-vindas não contam.',
  'Qualificado: a conversa chegou à etapa Qualificado, ou a uma etapa seguinte (Proposta, Sucesso), dentro do período. Conta conversa, não evento, e vale para lead novo e antigo.',
  'Desqualificado: a conversa chegou à etapa Desqualificado no período. Recusada e Desistência aparecem à parte, como outros encerramentos.',
  'Tempo até a primeira resposta: do primeiro contato do cliente até a primeira resposta de verdade, em mediana (a média seria puxada pela madrugada).',
  'Todos os horários são os de São Paulo.',
];

/**
 * O relatorio completo de um periodo: as contas, a comparacao com o anterior e
 * os pontos de atencao que o proprio codigo enxerga. `agora` e injetavel para o
 * teste nao depender do relogio.
 */
export async function estatisticasDoPeriodo(workspaceId, { de, ate }, { agora = new Date() } = {}) {
  const periodo = periodoDe({ de, ate }, agora);
  const anteriorDias = periodoAnterior({ de, ate });
  const anterior = periodoDe(anteriorDias, agora);
  const base = await carregarBase(workspaceId, cedo(periodo.inicio, anterior.inicio));

  const atual = calcularPeriodo(base, periodo, { agora });
  const antes = cabecalhoParaComparar(calcularPeriodo(base, anterior, { agora, resumido: true }));
  const agoraCab = cabecalhoParaComparar(atual);

  const atencao = [];
  if (atual.leads.semResposta > 0) {
    const porFalha = atual.leads.semRespostaPorFalha;
    atencao.push(
      `${atual.leads.semResposta} ${atual.leads.semResposta === 1 ? 'lead novo ainda não recebeu' : 'leads novos ainda não receberam'} resposta${porFalha ? ` (${porFalha} com falha da IA ou do envio registrada)` : ''}.`,
    );
  }
  if (atual.falhas.total > 0) {
    atencao.push(`Houve ${atual.falhas.total} ${atual.falhas.total === 1 ? 'falha' : 'falhas'} da IA, do envio ou da voz no período.`);
  }
  if (atual.noMomento.esperandoHaMaisDe1h > 0) {
    atencao.push(
      `${atual.noMomento.esperandoHaMaisDe1h} ${atual.noMomento.esperandoHaMaisDe1h === 1 ? 'conversa em que o cliente escreveu' : 'conversas em que o cliente escreveu'} desde o início do período ${atual.noMomento.esperandoHaMaisDe1h === 1 ? 'espera' : 'esperam'} resposta há mais de 1 hora.`,
    );
  }

  return {
    versao: 1,
    periodo: { de, ate, rotulo: periodo.rotulo, parcial: periodo.parcial, dias: periodo.dias.length },
    ...atual,
    amostraPequena: atual.leads.novos < 10,
    comparacao: {
      periodoAnterior: { de: anteriorDias.de, ate: anteriorDias.ate, rotulo: anterior.rotulo },
      anterior: antes,
      variacao: {
        novos: variacao(agoraCab.novos, antes.novos),
        atendidos: variacao(agoraCab.atendidos, antes.atendidos),
        qualificados: variacao(agoraCab.qualificados, antes.qualificados),
        desqualificados: variacao(agoraCab.desqualificados, antes.desqualificados),
      },
    },
    atencao,
    definicoes: DEFINICOES,
    semMovimento: atual.leads.novos === 0 && atual.leads.conversasAtivas === 0 && atual.qualificacao.qualificados.total === 0,
  };
}

/* ---------------------------------------------------------- texto das contas */

const num = (n) => Number(n || 0).toLocaleString('pt-BR');
const pctTxt = (p) => (p == null ? null : `${String(p).replace('.', ',')}%`);
const plural = (n, um, varios) => (n === 1 ? um : varios);

/**
 * O texto que o relatorio tem SEM a IA: as mesmas contas em frases. E o que
 * aparece quando a IA esta sem credito ou sem chave, e o que a conferencia
 * devolve se o texto do modelo trouxer um numero que nao existe nas contas.
 * Mesmo formato do texto do agente: titulos com "## ", itens com "- ".
 */
export function textoDasContas(r) {
  const l = r.leads;
  const q = r.qualificacao;
  const linhas = [];
  const periodo = r.periodo.parcial ? `${r.periodo.rotulo} (até o momento em que o relatório foi gerado)` : r.periodo.rotulo;

  linhas.push(`## ${periodo}`, '');
  if (r.semMovimento) {
    linhas.push('Não houve lead novo nem conversa com o cliente neste período.');
    return linhas.join('\n');
  }

  let abertura = `${l.novos === 1 ? 'Entrou' : 'Entraram'} ${num(l.novos)} ${plural(l.novos, 'lead novo', 'leads novos')}`;
  if (l.novos > 0) {
    abertura += `, e ${num(l.atendidos)} (${pctTxt(l.atendidosPct)}) ${plural(l.atendidos, 'foi atendido', 'foram atendidos')}`;
    const partes = [];
    if (l.primeiraRespostaPor.ia) partes.push(`a IA respondeu primeiro a ${num(l.primeiraRespostaPor.ia)}`);
    if (l.primeiraRespostaPor.pessoa) partes.push(`a equipe a ${num(l.primeiraRespostaPor.pessoa)}`);
    if (l.primeiraRespostaPor.sistema) partes.push(`o sistema a ${num(l.primeiraRespostaPor.sistema)}`);
    if (partes.length) abertura += `: ${partes.join(', ')}`;
  }
  linhas.push(`${abertura}.`);
  if (l.retornos > 0) {
    linhas.push(`Outras ${num(l.retornos)} ${plural(l.retornos, 'conversa antiga voltou', 'conversas antigas voltaram')} a falar com o escritório.`);
  }
  linhas.push('');

  linhas.push('## Qualificação');
  linhas.push(
    `- Qualificados no período: ${num(q.qualificados.total)} (${num(q.qualificados.deLeadsNovos)} ${plural(q.qualificados.deLeadsNovos, 'lead novo', 'leads novos')} e ${num(q.qualificados.deConversasAntigas)} de conversas anteriores).`,
  );
  linhas.push(`- Desqualificados no período: ${num(q.desqualificados.total)} (${num(q.desqualificados.deLeadsNovos)} ${plural(q.desqualificados.deLeadsNovos, 'lead novo', 'leads novos')} e ${num(q.desqualificados.deConversasAntigas)} de conversas anteriores).`);
  const encerramentos = q.outrosEncerramentos;
  if (encerramentos.recusada || encerramentos.desistencia) {
    linhas.push(`- Outros encerramentos: ${num(encerramentos.recusada)} ${plural(encerramentos.recusada, 'recusada', 'recusadas')} e ${num(encerramentos.desistencia)} ${plural(encerramentos.desistencia, 'desistência', 'desistências')}.`);
  }
  if (l.novos > 0) {
    const h = q.dosLeadsNovosHoje;
    linhas.push(`- Dos ${num(l.novos)} leads novos, hoje ${num(h.qualificados)} (${pctTxt(h.qualificadosPct)}) estão qualificados ou além e ${num(h.desqualificados)} (${pctTxt(h.desqualificadosPct)}) foram desqualificados.`);
  }
  linhas.push('');

  linhas.push('## Velocidade do atendimento');
  const p = l.primeiraResposta;
  if (p.amostras > 0) {
    linhas.push(`- Tempo até a primeira resposta: mediana de ${p.medianaTxt}. ${p.p90Frase}.`);
    linhas.push(`- ${pctTxt(p.ate5minPct)} dos leads atendidos receberam resposta em até 5 minutos.`);
  } else {
    linhas.push('- Nenhum lead novo recebeu resposta para medir o tempo.');
  }
  if (l.foraDoHorario && l.foraDoHorario.novos > 0) {
    linhas.push(`- ${num(l.foraDoHorario.novos)} ${plural(l.foraDoHorario.novos, 'lead chegou', 'leads chegaram')} fora do horário comercial; ${num(l.foraDoHorario.atendidos)} ${plural(l.foraDoHorario.atendidos, 'foi atendido', 'foram atendidos')}.`);
  }
  linhas.push('');

  linhas.push('## Movimento');
  const m = r.mensagens;
  linhas.push(`- Mensagens: ${num(m.recebidas)} recebidas e ${num(m.enviadas)} enviadas (${num(m.enviadasPorIa)} pela IA e ${num(m.enviadasPorPessoas)} pela equipe).`);
  if (r.picoDeEntrada) linhas.push(`- Horário de maior entrada de leads: ${r.picoDeEntrada.txt} (${num(r.picoDeEntrada.novos)} leads).`);
  if (r.contratos.assinados > 0) linhas.push(`- Contratos assinados no período: ${num(r.contratos.assinados)}.`);
  if (r.followups.enviados > 0) linhas.push(`- Follow-ups enviados: ${num(r.followups.enviados)}.`);

  const v = r.comparacao.variacao;
  if (r.comparacao.anterior.novos > 0 || r.leads.novos > 0) {
    const sinal = (x) => (x == null ? 'sem base' : x.diferenca > 0 ? `+${num(x.diferenca)}` : x.diferenca < 0 ? `${num(x.diferenca)}` : 'igual');
    const anteriorRotulo = r.comparacao.periodoAnterior.rotulo;
    linhas.push('', `## Comparação com ${anteriorRotulo.charAt(0).toLowerCase()}${anteriorRotulo.slice(1)}`);
    linhas.push(`- Leads novos: ${num(r.leads.novos)} contra ${num(r.comparacao.anterior.novos)} (${sinal(v.novos)}).`);
    linhas.push(`- Atendidos: ${num(r.leads.atendidos)} contra ${num(r.comparacao.anterior.atendidos)} (${sinal(v.atendidos)}).`);
    linhas.push(`- Qualificados: ${num(q.qualificados.total)} contra ${num(r.comparacao.anterior.qualificados)} (${sinal(v.qualificados)}).`);
    linhas.push(`- Desqualificados: ${num(q.desqualificados.total)} contra ${num(r.comparacao.anterior.desqualificados)} (${sinal(v.desqualificados)}).`);
  }

  if (r.atencao.length) {
    linhas.push('', '## Pontos de atenção');
    for (const a of r.atencao) linhas.push(`- ${a}`);
  }
  if (r.amostraPequena && l.novos > 0) {
    linhas.push('', `Com ${num(l.novos)} ${plural(l.novos, 'lead novo', 'leads novos')} a amostra é pequena: as porcentagens variam muito com poucos casos.`);
  }
  return linhas.join('\n');
}
