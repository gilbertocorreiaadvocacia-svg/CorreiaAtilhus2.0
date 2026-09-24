import { achar, atualizar, inserir, listar, registrarLog } from './banco.js';
import { emitir } from './eventos.js';
import { agora, normalizar, novoId, slug } from './util.js';

/**
 * Tipo de caso e momento do lead.
 *
 * TIPO DE CASO e uma etiqueta marcada com `tipo: 'caso'`, e nao uma colecao
 * nova: @tag, filtro, exportacao e o seletor de cor ja sabem lidar com
 * etiqueta. O que muda e a regra: uma conversa tem UM tipo de caso. Pedido de
 * BPC que vira auxilio-doenca troca de tipo, nao acumula os dois — senao o
 * cartao do kanban nao sabe de que cor e, e o Atilhus Juri nao sabe que
 * especie abrir.
 *
 * MOMENTO e o passo dentro do status. "Em triagem" diz a etapa; "Aguardando
 * CTPS" diz o que falta para sair dela. Cada status traz a propria lista de
 * momentos, e o momento zera quando o status muda: o momento de uma etapa nao
 * vale na seguinte.
 */

/*
 * A lista segue a do Atilhus Juri (tabela tipos_de_caso). `chavesJuri` e o
 * que vai para la como especie; o BPC tem duas porque o Juri separa idoso e
 * deficiente, e quem decide qual e o dado coletado na conversa. Civel nao
 * tem tipo no Juri: vai so a area.
 *
 * As cores evitam os tons 1 a 4, que sao os do funil — a cor do caso fica na
 * borda do cartao, a do status no alto da coluna, e as duas nao podem se
 * confundir onde mais importa. Sobram quatro tons para seis tipos; os dois
 * que repetem um tom do funil (Trabalhista e Civel) vivem em numero proprio,
 * e nunca dividem a coluna com os previdenciarios.
 */
export const TIPOS_DE_CASO = [
  {
    caso: 'bpc',
    nome: 'BPC/LOAS',
    area: 'previdenciario',
    chavesJuri: ['bpc_idoso', 'bpc_def'],
    cor: 'var(--serie-5)',
    nomesConhecidos: ['bpc/loas', 'bpc', 'loas', 'bpc loas'],
    corDaSemeadura: ['var(--serie-2)', '#c9a961'],
  },
  {
    caso: 'auxilio',
    nome: 'Auxilio-doenca',
    area: 'previdenciario',
    chavesJuri: ['auxilio'],
    cor: 'var(--serie-6)',
    nomesConhecidos: ['auxilio-doenca', 'auxilio doenca', 'auxilio por incapacidade temporaria'],
    corDaSemeadura: ['var(--serie-1)'],
  },
  {
    caso: 'auxilio_acidente',
    nome: 'Auxilio-acidente',
    area: 'previdenciario',
    chavesJuri: ['auxilio_acidente'],
    cor: 'var(--serie-7)',
    nomesConhecidos: ['auxilio-acidente', 'auxilio acidente'],
    corDaSemeadura: ['var(--serie-3)', '#d9a441'],
  },
  {
    caso: 'maternidade',
    nome: 'Salario-maternidade',
    area: 'previdenciario',
    chavesJuri: ['maternidade'],
    cor: 'var(--serie-8)',
    nomesConhecidos: ['salario-maternidade', 'salario maternidade', 'maternidade'],
    corDaSemeadura: [],
  },
  {
    caso: 'trabalhista',
    nome: 'Trabalhista',
    area: 'trabalhista',
    chavesJuri: ['trabalhista'],
    cor: 'var(--serie-2)',
    nomesConhecidos: ['trabalhista'],
    corDaSemeadura: ['var(--serie-6)', '#8fa9c9'],
  },
  {
    caso: 'civel',
    nome: 'Civel/Consumidor',
    area: 'civel',
    chavesJuri: [],
    cor: 'var(--serie-4)',
    nomesConhecidos: ['civel/consumidor', 'civel', 'consumidor', 'civel consumidor'],
    corDaSemeadura: [],
  },
];

/*
 * Os momentos de cada status, pelo nome do status da semeadura. Status criado
 * pelo escritorio nasce sem momento, e ganha os que alguem escrever na tela.
 */
export const MOMENTOS_POR_STATUS = {
  'novo lead': ['Identificando assunto'],
  'em analise': [
    'Coletando dados',
    'Aguardando CTPS/laudo',
    'Aguardando humano',
    'Ligacao agendada',
    'Reuniao agendada',
  ],
  qualificado: ['Assistindo video', 'Tirando duvidas'],
  'qualificado com objecao': ['Aguardando resposta', 'Negociando honorarios'],
  'preparar kit': ['Aguardando resposta', 'Negociando honorarios'],
  'assinatura pendente': ['Contrato em conferencia', 'Link enviado', 'Link aberto', 'Recusado', 'Expirado'],
  'contrato fechado': ['Enviado ao Juri', 'Aguardando pos-venda'],
  'follow up': ['Retorno combinado', 'Sem resposta'],
};

/** Lista de momentos limpa: nome aparado, id estavel pelo nome, sem repetidos. */
export function normalizarMomentos(lista) {
  if (!Array.isArray(lista)) return [];
  const vistos = new Set();
  const saida = [];
  for (const item of lista) {
    const nome = String(typeof item === 'string' ? item : item?.nome || '').trim().slice(0, 60);
    if (!nome) continue;
    const id = (typeof item === 'object' && item?.id) || slug(nome);
    if (!id || vistos.has(id)) continue;
    vistos.add(id);
    saida.push({ id, nome });
  }
  return saida;
}

const ehCaso = (etiqueta) => etiqueta?.tipo === 'caso';

/** O tipo de caso de uma conversa, ou null. */
export function tipoDeCasoDa(contato) {
  for (const id of contato?.etiquetas || []) {
    const etiqueta = achar('etiquetas', id);
    if (ehCaso(etiqueta)) return etiqueta;
  }
  return null;
}

/**
 * Deixa uma lista de etiquetas com no maximo um tipo de caso.
 *
 * Fica o tipo que acabou de entrar (o que nao estava em `anteriores`): e ele
 * que a pessoa ou o agente acabou de escolher. Se nenhum e novo — lista antiga
 * ja com dois — fica o primeiro, sem adivinhar.
 */
export function umTipoDeCaso(novas = [], anteriores = []) {
  const lista = [...new Set(novas || [])];
  const casos = lista.filter((id) => ehCaso(achar('etiquetas', id)));
  if (casos.length <= 1) return lista;
  const antes = new Set(anteriores || []);
  const recem = casos.filter((id) => !antes.has(id));
  const fica = recem.length ? recem[recem.length - 1] : casos[0];
  return lista.filter((id) => id === fica || !casos.includes(id));
}

/**
 * Poe o momento na conversa. `valor` e o id ou o nome de um dos momentos do
 * status ATUAL; vazio tira o momento. Devolve { erro } em vez de lancar: quem
 * chama e tanto a tela quanto o agente, e o agente precisa ler a recusa.
 */
export function definirMomento(contato, valor, autor) {
  if (!valor) {
    if (!contato.momento) return { ok: true, momento: null };
    atualizar('contatos', contato.id, { momento: null });
    contato.momento = null;
    registrarLog(contato.workspaceId, contato.id, 'momento', 'Momento retirado', autor);
    emitir(contato.workspaceId, 'contato', { contatoId: contato.id });
    return { ok: true, momento: null };
  }

  const status = contato.statusId ? achar('status', contato.statusId) : null;
  const momentos = status?.momentos || [];
  const alvo = normalizar(valor);
  const momento = momentos.find((m) => m.id === valor || normalizar(m.nome) === alvo);
  if (!momento) {
    return {
      erro: momentos.length
        ? `"${valor}" nao e um momento do status ${status.nome}. Use um destes: ${momentos.map((m) => m.nome).join(', ')}.`
        : `O status ${status?.nome || 'atual'} nao tem momentos.`,
    };
  }

  if (contato.momento?.id === momento.id) return { ok: true, momento: contato.momento };

  const registro = { id: momento.id, nome: momento.nome, desde: agora(), autor: autor || null };
  atualizar('contatos', contato.id, { momento: registro });
  contato.momento = registro;
  registrarLog(contato.workspaceId, contato.id, 'momento', `Momento: ${momento.nome}`, autor, { momentoId: momento.id });
  emitir(contato.workspaceId, 'contato', { contatoId: contato.id });
  return { ok: true, momento: registro };
}

/**
 * Acerta, em todo workspace, os tipos de caso e os momentos dos status.
 *
 * Roda a cada subida, como a migracao de cores (nucleo/paleta.js): e barata,
 * idempotente, e a base antiga se acerta sozinha. Tres cuidados:
 *   - etiqueta que ja existe com o nome de um tipo e MARCADA, nao duplicada, e
 *     mantem o nome — os prompts dos agentes citam esse nome com @tag;
 *   - a cor so muda se ainda for a da semeadura; cor escolhida a mao fica;
 *   - status que ja tem `momentos` (mesmo vazio) nao e tocado.
 */
export function migrarTiposDeCaso() {
  let mudancas = 0;

  for (const workspace of listar('workspaces')) {
    const workspaceId = workspace.id;
    const etiquetas = listar('etiquetas', { workspaceId });
    /* Workspace de uma area so ganha os tipos de caso dela: o Trabalhista nao
       precisa de etiqueta de BPC. Sem area, todos (o escritorio inteiro). */
    const tipos = workspace.area ? TIPOS_DE_CASO.filter((t) => t.area === workspace.area) : TIPOS_DE_CASO;

    for (const tipo of tipos) {
      const jaMarcada = etiquetas.find((e) => e.tipo === 'caso' && e.caso === tipo.caso);
      if (jaMarcada) continue;

      const conhecidos = new Set([normalizar(tipo.nome), ...tipo.nomesConhecidos.map(normalizar)]);
      const pelaNome = etiquetas.find((e) => !e.tipo && conhecidos.has(normalizar(e.nome)));

      if (pelaNome) {
        const corAntiga = String(pelaNome.cor || '').trim().toLowerCase();
        const daSemeadura = !corAntiga || tipo.corDaSemeadura.includes(corAntiga);
        atualizar('etiquetas', pelaNome.id, {
          tipo: 'caso',
          caso: tipo.caso,
          area: tipo.area,
          ...(daSemeadura ? { cor: tipo.cor } : {}),
        });
      } else {
        inserir('etiquetas', {
          id: novoId('etq'),
          workspaceId,
          nome: tipo.nome,
          cor: tipo.cor,
          tipo: 'caso',
          caso: tipo.caso,
          area: tipo.area,
        });
      }
      mudancas += 1;
    }

    for (const status of listar('status', { workspaceId })) {
      if (status.momentos !== undefined) continue;
      const nomes = MOMENTOS_POR_STATUS[normalizar(status.nome)];
      if (!nomes) continue;
      atualizar('status', status.id, { momentos: normalizarMomentos(nomes) });
      mudancas += 1;
    }
  }

  return mudancas;
}
