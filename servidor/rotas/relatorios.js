import { achar, listar, remover } from '../nucleo/banco.js';
import { ehAdministrador, filtrarConversasVisiveis } from '../nucleo/auth.js';
import { periodoDe, sabadoDoFimDeSemana, somarDias } from '../nucleo/relatorio-do-fim-de-semana.js';
import {
  configDoAgenteDeRelatorios,
  estaGerando,
  gerarRelatorio,
  relatoriosDoEscritorio,
  resumoDoRelatorio,
  salvarConfigDoAgenteDeRelatorios,
} from '../ia/agente-de-relatorios.js';
import { comCodigo, exigirAdministrador } from './sessao.js';

/**
 * Relatorios: quantos contratos cada pessoa e cada agente de IA fecharam.
 *
 * "Fechado" aqui e CONTRATO ASSINADO (situacao 'assinado'): o cliente assinou de
 * verdade, nao e so uma etapa do funil. Cada contrato assinado tem duas maos
 * que valem credito, e elas nao se misturam:
 *
 *  - QUEM APROVOU (uma pessoa): o membro que conferiu a ficha e mandou o link de
 *    assinatura (aprovadoPor). E a pessoa que "fechou" do lado do escritorio.
 *  - QUE AGENTE CONDUZIU (a IA): o agente que pediu o contrato (agenteId). E o
 *    quanto cada agente de IA esta rendendo em contrato.
 *
 * Por isso sao DUAS tabelas, nao uma lista so: somar pessoa e IA no mesmo balde
 * contaria o mesmo contrato duas vezes. Cada tabela soma, sozinha, perto do
 * total — a diferenca fica no "sem atribuicao" (contrato criado a mao, sem
 * agente; ou aprovado pelo proprio sistema).
 *
 * Tudo respeita o que a pessoa logada PODE VER (filtrarConversasVisiveis): um
 * membro de visao limitada ve o relatorio da propria fatia, como no painel.
 */

export function registrarRelatorios(rotas) {
  registrarAgenteDeRelatorios(rotas);

  rotas.get('/api/relatorios/contratos', async ({ ctx, query }) => montarRelatorio(ctx, query));

  rotas.get('/api/relatorios/contratos.csv', async ({ ctx, query }) => {
    const r = montarRelatorio(ctx, query);
    const linhas = [
      'Relatorio de contratos fechados (assinados)',
      `Periodo;${r.periodo.de || 'inicio'};${r.periodo.ate || 'hoje'}`,
      `Total de contratos;${r.total}`,
      '',
      'Por pessoa (quem aprovou e enviou);Contratos',
      ...r.porPessoa.lista.map((x) => `${csv(x.nome)};${x.quantidade}`),
      ...(r.porPessoa.semAtribuicao ? [`Sem pessoa (aprovado pelo sistema);${r.porPessoa.semAtribuicao}`] : []),
      '',
      'Por agente de IA (quem conduziu);Contratos',
      ...r.porAgente.lista.map((x) => `${csv(x.nome)};${x.quantidade}`),
      ...(r.porAgente.semAtribuicao ? [`Sem agente (criado a mao);${r.porAgente.semAtribuicao}`] : []),
    ];
    return { csv: linhas.join('\n'), total: r.total };
  });
}

/** Ponto e virgula e o separador do CSV; no texto vira virgula para nao quebrar a coluna. */
const csv = (texto) => String(texto || '').replace(/;/g, ',');

function dentroDoPeriodo(iso, de, ate) {
  if (!iso) return false;
  const dia = String(iso).slice(0, 10);
  if (de && dia < de) return false;
  if (ate && dia > ate) return false;
  return true;
}

function agrupar(contratos, chaveDe) {
  const mapa = new Map();
  let semAtribuicao = 0;
  for (const contrato of contratos) {
    const chave = chaveDe(contrato);
    if (!chave?.id) {
      semAtribuicao += 1;
      continue;
    }
    const atual = mapa.get(chave.id) || { id: chave.id, nome: chave.nome, quantidade: 0 };
    atual.quantidade += 1;
    if (chave.nome) atual.nome = chave.nome;
    mapa.set(chave.id, atual);
  }
  return { lista: [...mapa.values()].sort((a, b) => b.quantidade - a.quantidade), semAtribuicao };
}

function montarRelatorio(ctx, query = {}) {
  const w = ctx.workspaceId;
  const de = String(query.de || '').slice(0, 10);
  const ate = String(query.ate || '').slice(0, 10);

  const visiveis = new Set(filtrarConversasVisiveis(ctx, listar('contatos', { workspaceId: w })).map((c) => c.id));
  const assinados = listar('contratos', { workspaceId: w }).filter(
    (c) => c.situacao === 'assinado' && visiveis.has(c.contatoId) && dentroDoPeriodo(c.assinadoEm, de, ate),
  );

  const porPessoa = agrupar(assinados, (c) =>
    c.aprovadoPor?.tipo === 'membro' || c.aprovadoPor?.tipo === 'usuario'
      ? { id: c.aprovadoPor.id, nome: c.aprovadoPor.nome }
      : null,
  );
  const porAgente = agrupar(assinados, (c) =>
    c.agenteId ? { id: c.agenteId, nome: achar('agentes', c.agenteId)?.nome || 'Agente removido' } : null,
  );

  return {
    periodo: { de, ate },
    total: assinados.length,
    porPessoa,
    porAgente,
  };
}

/**
 * O agente de relatorios (ia/agente-de-relatorios.js): o relatorio do fim de
 * semana, a configuracao e o historico. So dono e administrador: o relatorio
 * soma o escritorio inteiro, e quem tem visao limitada nao deve ver as contas
 * de conversas que nao pode abrir. Para os demais, GET devolve permitido:false
 * e a tela simplesmente nao mostra o cartao.
 */
const FINS_DE_SEMANA_NA_LISTA = 8;

function opcoesDeFimDeSemana(agora = new Date()) {
  const atual = sabadoDoFimDeSemana(agora);
  return Array.from({ length: FINS_DE_SEMANA_NA_LISTA }, (_, i) => {
    const de = somarDias(atual, -7 * i);
    const ate = somarDias(de, 1);
    return { de, ate, rotulo: periodoDe({ de, ate }, agora).rotulo };
  });
}

function registrarAgenteDeRelatorios(rotas) {
  const doEscritorio = (ctx, id) => {
    const r = achar('relatoriosDoAgente', id);
    if (!r || r.workspaceId !== ctx.workspaceId) throw comCodigo('Esse relatório não existe.', 404);
    return r;
  };

  rotas.get('/api/relatorios/agente', async ({ ctx }) => {
    if (!ehAdministrador(ctx)) return { permitido: false };
    const historico = relatoriosDoEscritorio(ctx.workspaceId);
    const opcoes = opcoesDeFimDeSemana();
    return {
      permitido: true,
      config: configDoAgenteDeRelatorios(ctx.workspaceId),
      gerando: estaGerando(ctx.workspaceId),
      opcoes,
      padrao: opcoes[0],
      atual: historico[0] || null,
      historico: historico.map(resumoDoRelatorio),
    };
  });

  rotas.get('/api/relatorios/agente/:id', async ({ ctx, params }) => {
    exigirAdministrador(ctx);
    return doEscritorio(ctx, params.id);
  });

  rotas.post('/api/relatorios/agente/gerar', async ({ ctx, corpo }) => {
    exigirAdministrador(ctx);
    const padrao = opcoesDeFimDeSemana()[0];
    const de = String(corpo?.de || padrao.de).slice(0, 10);
    const ate = String(corpo?.ate || (corpo?.de ? corpo.de : padrao.ate)).slice(0, 10);
    try {
      return await gerarRelatorio({
        workspaceId: ctx.workspaceId,
        de,
        ate,
        origem: 'manual',
        geradoPor: { tipo: 'membro', id: ctx.membro?.id || null, nome: ctx.usuario?.nome || null },
      });
    } catch (erro) {
      if (erro.periodoInvalido) throw comCodigo(erro.message, 400);
      if (erro.ocupado) throw comCodigo(erro.message, 409);
      throw erro;
    }
  });

  rotas.put('/api/relatorios/agente/config', async ({ ctx, corpo }) => {
    exigirAdministrador(ctx);
    return salvarConfigDoAgenteDeRelatorios(ctx.workspaceId, {
      automatico: corpo?.automatico,
      instrucoes: corpo?.instrucoes,
    });
  });

  rotas.delete('/api/relatorios/agente/:id', async ({ ctx, params }) => {
    exigirAdministrador(ctx);
    doEscritorio(ctx, params.id);
    remover('relatoriosDoAgente', params.id);
    return { ok: true };
  });
}
