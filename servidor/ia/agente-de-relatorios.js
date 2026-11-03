import { achar, atualizar, inserir, listar, remover } from '../nucleo/banco.js';
import { avisarAdministradores } from '../nucleo/avisar-administradores.js';
import { lancar } from '../nucleo/creditos.js';
import { novoId } from '../nucleo/util.js';
import { CUSTO } from '../config.js';
import { partesEm } from '../automacao/horario.js';
import {
  estatisticasDoPeriodo,
  periodoDe,
  sabadoDoFimDeSemana,
  somarDias,
  textoDasContas,
} from '../nucleo/relatorio-do-fim-de-semana.js';
import { conversar, provedorDisponivel } from './provedores.js';

/**
 * O agente de relatorios (pedido do escritorio, 03/11/2026): fica na tela de
 * Relatorios e conta tudo o que aconteceu no fim de semana — quantos leads
 * entraram e foram atendidos, quantos foram qualificados e desqualificados, com
 * estatistica.
 *
 * A DIVISAO DE TRABALHO E O QUE TORNA O RELATORIO CONFIAVEL:
 *  - quem CONTA e o codigo (nucleo/relatorio-do-fim-de-semana.js): determinista,
 *    com as definicoes escritas no proprio relatorio, testado sem IA;
 *  - quem ESCREVE e o modelo, em cima desses numeros e so deles;
 *  - e depois de escrever, o codigo CONFERE: todo numero do texto tem de existir
 *    nas contas. Se o modelo trouxer um numero que nao esta la, o texto dele e
 *    descartado e entra o texto padrao (as mesmas contas em frases), com o aviso
 *    do que aconteceu. O mesmo vale quando a IA esta sem credito ou sem chave:
 *    o relatorio sai do mesmo jeito, so sem o toque do modelo.
 *
 * Nao e um agente de conversa: nao esta na colecao `agentes`, nao recebe
 * mensagem de cliente e nao entra no roteamento. Vive em `workspace.
 * agenteDeRelatorios` (configuracao) e `relatoriosDoAgente` (o que ja escreveu).
 *
 * Sai sozinho toda segunda, a partir das 7h (Sao Paulo), e fica guardado. Quem e
 * dono ou administrador recebe um aviso no sino. A tela tambem gera na hora,
 * para o fim de semana que acabou ou para outro periodo.
 */

const MAXIMO_GUARDADO = 26; // meio ano de fins de semana
const HORA_DA_SEGUNDA = 7;
const INTERVALO_MS = Number(process.env.CORREIA_RELATORIO_VERIFICACAO_MS ?? 15 * 60 * 1000);
/* Espera depois de subir antes da primeira conferencia: na implantacao os dois
   containers convivem alguns segundos, e dois gerando o mesmo relatorio gravariam
   sobre o mesmo arquivo. */
const PRIMEIRA_MS = Number(process.env.CORREIA_RELATORIO_PRIMEIRA_MS ?? 3 * 60 * 1000);
const LIMITE_DAS_INSTRUCOES = 2000;

export function configDoAgenteDeRelatorios(workspaceId) {
  const guardado = achar('workspaces', workspaceId)?.agenteDeRelatorios || {};
  return {
    /* Ligado por padrao: custa uma chamada por semana, e o relatorio pronto na
       segunda e o motivo de o agente existir. A tela tem a chave. */
    automatico: guardado.automatico !== false,
    instrucoes: String(guardado.instrucoes || ''),
  };
}

export function salvarConfigDoAgenteDeRelatorios(workspaceId, { automatico, instrucoes }) {
  const atual = configDoAgenteDeRelatorios(workspaceId);
  const novo = {
    automatico: automatico === undefined ? atual.automatico : automatico === true,
    instrucoes: instrucoes === undefined ? atual.instrucoes : String(instrucoes || '').slice(0, LIMITE_DAS_INSTRUCOES).trim(),
  };
  atualizar('workspaces', workspaceId, { agenteDeRelatorios: novo });
  return novo;
}

/* ---------------------------------------------------- o texto, com conferencia */

const REGRAS = `Você é o agente de relatórios de um escritório de advocacia. Toda semana escreve, para quem decide, o relatório do que aconteceu no atendimento (WhatsApp, Instagram e TikTok) em um período, normalmente o último fim de semana.

REGRAS QUE NÃO TÊM EXCEÇÃO
1. Use SOMENTE os números que estão nos dados. Não calcule, não some, não subtraia, não arredonde e não estime. Se precisar de um valor que não está nos dados, diga que esse dado não existe.
2. Campos terminados em "Txt" ou "Frase", e os campos "rotulo", vêm prontos: copie exatamente, sem converter unidade.
3. Não invente causa. Você pode apontar o que os números mostram (por exemplo, "a maior parte dos leads chegou entre 19h e 20h"), mas não afirme o motivo de nada que os dados não tragam.
4. O relatório é estatístico: nunca cite nome, telefone ou dado de cliente.
5. Português do Brasil, direto, sem enfeite nem elogio. No máximo 350 palavras.
6. Se "amostraPequena" for verdadeiro, avise em uma frase que, com poucos casos, as porcentagens mudam muito.
7. Se "periodo.parcial" for verdadeiro, diga que o período ainda não terminou e que os números valem até o momento em que o relatório foi gerado.
8. "Qualificados" e "desqualificados" do período são os de "qualificacao.qualificados" e "qualificacao.desqualificados" (conversas que chegaram a essa etapa no período, novas ou antigas). Os de "dosLeadsNovosHoje" são a situação atual dos leads que entraram: não misture os dois.

FORMATO
Títulos de seção em linha própria começando por "## ", itens começando por "- ", parágrafos curtos. Nada de tabela, negrito, numeração ou outro recurso de formatação.
Seções, nesta ordem: "## Resumo" (leads novos, quantos atendidos, qualificados e desqualificados, em duas ou três frases); "## Qualificação"; "## Velocidade do atendimento"; "## Comparação com o período anterior" (use "comparacao"); "## Pontos de atenção" (só se houver algo em "atencao" ou falhas); "## Por onde eu começaria" (uma ou duas ações que decorram direto dos números, por exemplo conversas sem resposta).`;

function montarSistema(workspaceId) {
  const nome = achar('workspaces', workspaceId)?.nome;
  const { instrucoes } = configDoAgenteDeRelatorios(workspaceId);
  return [
    nome ? `${REGRAS}\n\nEscritório: ${nome}.` : REGRAS,
    instrucoes
      ? `INSTRUÇÕES DO ESCRITÓRIO (valem desde que não contrariem as regras acima):\n${instrucoes}`
      : '',
  ]
    .filter(Boolean)
    .join('\n\n');
}

/** O que o modelo recebe: as contas, sem as definicoes (que ja estao nas regras). */
function dadosParaOModelo(estatisticas) {
  const { definicoes, ...resto } = estatisticas;
  return JSON.stringify(resto);
}

/* --- A conferencia: todo numero do texto existe nas contas? --- */

const chaveDoNumero = (n) => String(Math.round(n * 10) / 10);

/** "1.234" e "45,5" do jeito brasileiro, "45.5" do jeito do JSON. */
function lerNumero(token) {
  if (/^\d{1,3}(\.\d{3})+(,\d+)?$/.test(token)) return Number(token.replace(/\./g, '').replace(',', '.'));
  if (/^\d+,\d+$/.test(token)) return Number(token.replace(',', '.'));
  if (/^\d+\.\d+$/.test(token)) return Number(token);
  return Number(token.replace(/[.,]/g, ''));
}

const numerosDoTexto = (texto) => (String(texto).match(/\d+(?:[.,]\d+)*/g) || []).map(lerNumero).filter(Number.isFinite);

function coletarNumeros(valor, saida) {
  if (valor == null) return;
  if (typeof valor === 'number') {
    if (!Number.isFinite(valor)) return;
    saida.add(chaveDoNumero(valor));
    /* O modelo pode arredondar 45,5% para 46%. */
    if (!Number.isInteger(valor)) saida.add(chaveDoNumero(Math.round(valor)));
  } else if (typeof valor === 'string') {
    for (const n of numerosDoTexto(valor)) saida.add(chaveDoNumero(n));
  } else if (Array.isArray(valor)) {
    for (const item of valor) coletarNumeros(item, saida);
  } else if (typeof valor === 'object') {
    for (const item of Object.values(valor)) coletarNumeros(item, saida);
  }
}

/**
 * Todo numero que o texto cita existe nas contas? Os marcadores de lista no
 * comeco da linha ("1." ou "2)") nao contam. Devolve os numeros que nao existem.
 */
export function conferirNumeros(texto, estatisticas) {
  const permitidos = new Set();
  coletarNumeros(estatisticas, permitidos);
  const semMarcadores = String(texto)
    .split('\n')
    .map((linha) => linha.replace(/^\s*\d+[.)]\s+/, ''))
    .join('\n');
  const estranhos = [...new Set(numerosDoTexto(semMarcadores).filter((n) => !permitidos.has(chaveDoNumero(n))))];
  return { ok: estranhos.length === 0, estranhos };
}

const semSegredo = (texto) =>
  String(texto || '')
    .replace(/sk-[A-Za-z0-9_-]{6,}/g, 'sk-…')
    .replace(/\d{6,}/g, '#')
    .slice(0, 160);

async function escreverTexto(workspaceId, estatisticas) {
  const padrao = (avisoDaIa) => ({ texto: textoDasContas(estatisticas), usouIa: false, avisoDaIa, modeloId: null });
  if (estatisticas.semMovimento) return padrao(null);

  const modeloId = achar('integracoes', { workspaceId })?.ia?.modeloResumo || 'claude-sonnet-5';
  if (!provedorDisponivel(modeloId, workspaceId)) {
    return padrao('A IA não está configurada neste escritório; este é o texto padrão, com os mesmos números.');
  }
  try {
    const resposta = await conversar({
      modeloId,
      workspaceId,
      sistema: montarSistema(workspaceId),
      mensagens: [{ papel: 'usuario', texto: `Dados do período, em JSON. Escreva o relatório.\n\n${dadosParaOModelo(estatisticas)}` }],
    });
    const texto = String(resposta.texto || '').trim();
    if (texto.length < 80) return padrao('A IA não devolveu um texto utilizável; este é o texto padrão, com os mesmos números.');

    const conferencia = conferirNumeros(texto, estatisticas);
    if (!conferencia.ok) {
      return padrao(
        `O texto da IA citava número que não está nas contas (${conferencia.estranhos.slice(0, 3).join(', ')}); por segurança, este é o texto padrão, com os mesmos números.`,
      );
    }
    lancar(workspaceId, null, 'relatorio_ia', CUSTO.processamentoIA);
    return { texto, usouIa: true, avisoDaIa: null, modeloId };
  } catch (erro) {
    return padrao(`A IA não respondeu (${semSegredo(erro.message)}); este é o texto padrão, com os mesmos números.`);
  }
}

/* -------------------------------------------------------------- gerar e guardar */

const gerando = new Set();

export const estaGerando = (workspaceId) => gerando.has(workspaceId);

/** A linha do historico: o suficiente para listar, sem as contas inteiras. */
export function resumoDoRelatorio(r) {
  return {
    id: r.id,
    origem: r.origem,
    geradoEm: r.geradoEm,
    periodo: r.periodo,
    usouIa: r.usouIa,
    novos: r.estatisticas?.leads?.novos ?? 0,
    atendidos: r.estatisticas?.leads?.atendidos ?? 0,
    qualificados: r.estatisticas?.qualificacao?.qualificados?.total ?? 0,
    desqualificados: r.estatisticas?.qualificacao?.desqualificados?.total ?? 0,
  };
}

/* Do mais novo para o mais antigo; o horario em que foi guardado desempata dois gerados no mesmo instante. */
export function relatoriosDoEscritorio(workspaceId) {
  return listar('relatoriosDoAgente', { workspaceId }).sort((a, b) => String(b.geradoEm).localeCompare(String(a.geradoEm)) || String(b.criadoEm).localeCompare(String(a.criadoEm)));
}

/**
 * O que /api/saude diz do agente: so contagens e datas, sem nome nem texto do
 * relatorio. Serve para conferir de fora que a geracao de segunda rodou, e por
 * que o texto caiu no padrao quando caiu (o aviso ja vem sem numero comprido).
 */
export function resumoPublicoDoAgente(workspaceId) {
  const lista = relatoriosDoEscritorio(workspaceId);
  const ultimo = lista[0];
  return {
    automatico: configDoAgenteDeRelatorios(workspaceId).automatico,
    total: lista.length,
    ultimo: ultimo
      ? {
          geradoEm: ultimo.geradoEm,
          origem: ultimo.origem,
          de: ultimo.periodo?.de || null,
          ate: ultimo.periodo?.ate || null,
          usouIa: Boolean(ultimo.usouIa),
          avisoDaIa: ultimo.avisoDaIa ? semSegredo(ultimo.avisoDaIa) : null,
          ...resumoDoRelatorio(ultimo),
        }
      : null,
  };
}

function aparar(workspaceId) {
  for (const velho of relatoriosDoEscritorio(workspaceId).slice(MAXIMO_GUARDADO)) remover('relatoriosDoAgente', velho.id);
}

/**
 * Conta, escreve, confere e guarda. Um por escritorio de cada vez: o segundo
 * pedido enquanto o primeiro roda recebe erro `ocupado`, em vez de gastar duas
 * chamadas de IA para o mesmo relatorio.
 */
export async function gerarRelatorio({ workspaceId, de, ate, origem = 'manual', geradoPor = null, agora = new Date() }) {
  if (gerando.has(workspaceId)) {
    throw Object.assign(new Error('Já estou gerando um relatório deste escritório. Aguarde alguns instantes.'), { ocupado: true });
  }
  gerando.add(workspaceId);
  try {
    const estatisticas = await estatisticasDoPeriodo(workspaceId, { de, ate }, { agora });
    const { texto, usouIa, avisoDaIa, modeloId } = await escreverTexto(workspaceId, estatisticas);
    const relatorio = inserir('relatoriosDoAgente', {
      id: novoId('rel'),
      workspaceId,
      origem,
      geradoPor,
      geradoEm: agora.toISOString(),
      periodo: estatisticas.periodo,
      estatisticas,
      texto,
      usouIa,
      avisoDaIa,
      modeloId,
    });
    aparar(workspaceId);
    return relatorio;
  } finally {
    gerando.delete(workspaceId);
  }
}

/* ------------------------------------------------------------- toda segunda */

let verificando = false;
/* Escritorio sem movimento naquele fim de semana: nao confere de novo a cada 15 minutos. */
const semMovimento = new Set();

function houveMovimento(workspaceId, periodo) {
  return listar('contatos', { workspaceId }).some(
    (c) => !c.grupo && ((!c.importado && c.criadoEm >= periodo.inicio && c.criadoEm <= periodo.fim) || (c.ultimaEntradaEm >= periodo.inicio && c.ultimaEntradaEm <= periodo.fim)),
  );
}

/**
 * Gera o relatorio do ultimo fim de semana de todo escritorio que tem o agente
 * ligado e ainda nao tem esse relatorio. Roda de segunda (a partir das 7h) a
 * sexta: se o servidor estava fora na segunda, o relatorio sai quando ele volta.
 * Sabado e domingo nao geram sozinhos — o fim de semana ainda esta em curso.
 * Devolve os relatorios gerados nesta passada.
 */
export async function verificarRelatoriosSemanais(agora = new Date()) {
  if (verificando) return [];
  verificando = true;
  const gerados = [];
  try {
    const p = partesEm(agora);
    if (p.diaSemana === 0 || p.diaSemana === 6) return gerados;
    if (p.diaSemana === 1 && p.hora < HORA_DA_SEGUNDA) return gerados;

    const sabado = sabadoDoFimDeSemana(agora);
    const domingo = somarDias(sabado, 1);
    const periodo = periodoDe({ de: sabado, ate: domingo }, agora);

    for (const workspace of listar('workspaces')) {
      if (!configDoAgenteDeRelatorios(workspace.id).automatico) continue;
      const chave = `${workspace.id}:${sabado}`;
      if (semMovimento.has(chave)) continue;
      const jaTem = listar('relatoriosDoAgente', { workspaceId: workspace.id }).some(
        (r) => r.periodo?.de === sabado && r.periodo?.ate === domingo && !r.periodo?.parcial,
      );
      if (jaTem) continue;
      if (!houveMovimento(workspace.id, periodo)) {
        semMovimento.add(chave);
        continue;
      }
      try {
        const relatorio = await gerarRelatorio({ workspaceId: workspace.id, de: sabado, ate: domingo, origem: 'automatico', agora });
        gerados.push(relatorio);
        const r = resumoDoRelatorio(relatorio);
        avisarAdministradores(workspace.id, {
          titulo: 'O relatório do fim de semana está pronto',
          texto: `${r.novos} ${r.novos === 1 ? 'lead novo' : 'leads novos'}, ${r.atendidos} ${r.atendidos === 1 ? 'atendido' : 'atendidos'}, ${r.qualificados} ${r.qualificados === 1 ? 'qualificado' : 'qualificados'} e ${r.desqualificados} ${r.desqualificados === 1 ? 'desqualificado' : 'desqualificados'} (${relatorio.periodo.rotulo}). Abra em Relatórios.`,
          tipo: 'ia',
        });
      } catch (erro) {
        if (!erro.ocupado) console.error(`[relatorio] ${workspace.nome || workspace.id}: ${erro.message}`);
      }
    }
    return gerados;
  } finally {
    verificando = false;
  }
}

export function iniciarRelatorioSemanal() {
  const rodar = () => verificarRelatoriosSemanais().catch((erro) => console.error('[relatorio] falhou:', erro.message));
  const primeira = setTimeout(rodar, PRIMEIRA_MS);
  if (typeof primeira.unref === 'function') primeira.unref();
  const relogio = setInterval(rodar, INTERVALO_MS);
  if (typeof relogio.unref === 'function') relogio.unref();
  return relogio;
}
