import { achar, listar } from '../nucleo/banco.js';
import { filtrarConversasVisiveis } from '../nucleo/auth.js';

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
