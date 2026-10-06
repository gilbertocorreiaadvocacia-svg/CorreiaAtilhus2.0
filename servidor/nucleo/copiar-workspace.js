import fs from 'node:fs';
import { atualizar, inserir, listar } from './banco.js';
import { caminhoDaMidia, guardarBuffer } from './midia.js';
import { novoId } from './util.js';

/**
 * Copia configuracoes de um workspace para outro.
 *
 * Duplica os REGISTROS e a MIDIA (nunca referencia compartilhada, e nunca um
 * link para fora), com os ids refeitos e as referencias entre eles acertadas:
 * o follow-up do status aponta para o template DAQUI, o agente consulta a base
 * DAQUI, o status cai no departamento DAQUI.
 *
 * O que copiar vem da tela (`selecao`), mas as DEPENDENCIAS entram sozinhas: nao
 * adianta copiar o agente sem a base que ele consulta, nem o funil sem os
 * templates do follow-up. Melhor trazer junto do que deixar referencia pendurada.
 *
 * Nao copia: conversas, contatos, numeros, membros, chaves (isso e isolamento,
 * nao configuracao), nem vozes (ligadas a chave de audio do outro workspace).
 */

const PREFIXO = {
  departamentos: 'dep',
  etiquetas: 'etq',
  variaveis: 'var',
  conhecimento: 'kb',
  templates: 'tpl',
  status: 'sts',
  agentes: 'agn',
};

export const SELECIONAVEIS = ['agentes', 'templates', 'etiquetas', 'departamentos', 'status', 'conhecimento'];

/** O arquivo de midia duplicado no storage do proprio sistema, nunca compartilhado. */
function duplicarMidia(midia) {
  if (!midia) return midia;
  const caminho = caminhoDaMidia(midia.url || midia.arquivo);
  if (!caminho) return midia; // o arquivo sumiu; mantem a referencia (ja e interna)
  try {
    const dados = fs.readFileSync(caminho);
    return guardarBuffer({ nome: midia.nome || midia.arquivo, dados, mime: midia.mime });
  } catch {
    return midia;
  }
}

/** Copia uma colecao inteira de um workspace para outro; devolve o mapa de id antigo -> novo. */
function copiar(colecao, origemId, destinoId, ajustar = (r) => r) {
  const mapa = new Map();
  for (const registro of listar(colecao, { workspaceId: origemId })) {
    const { id, criadoEm, atualizadoEm, ...resto } = registro;
    const idNovo = novoId(PREFIXO[colecao]);
    inserir(colecao, { ...ajustar({ ...resto }, id), workspaceId: destinoId, id: idNovo });
    mapa.set(id, idNovo);
  }
  return mapa;
}

/**
 * @param {string} destinoId  workspace que recebe
 * @param {string} origemId   workspace de onde copia
 * @param {string[]} selecao  o que a tela pediu (ver SELECIONAVEIS)
 * @returns {object} quantos de cada coisa foram copiados
 */
export function copiarConfiguracoes(destinoId, origemId, selecao = []) {
  const quer = new Set(selecao.filter((x) => SELECIONAVEIS.includes(x)));

  /* Dependencias entram sozinhas, para nao sobrar referencia pendurada. */
  if (quer.has('agentes')) {
    quer.add('conhecimento');
    quer.add('variaveis');
  }
  if (quer.has('status')) {
    quer.add('departamentos');
    quer.add('templates');
  }

  const contagem = {};
  const mapaDep = quer.has('departamentos') ? copiar('departamentos', origemId, destinoId) : new Map();
  if (quer.has('departamentos')) contagem.departamentos = mapaDep.size;
  if (quer.has('etiquetas')) contagem.etiquetas = copiar('etiquetas', origemId, destinoId).size;
  if (quer.has('variaveis')) contagem.variaveis = copiar('variaveis', origemId, destinoId).size;

  const mapaBase = quer.has('conhecimento') ? copiar('conhecimento', origemId, destinoId) : new Map();
  if (quer.has('conhecimento')) contagem.conhecimento = mapaBase.size;

  const mapaTpl = quer.has('templates')
    ? copiar('templates', origemId, destinoId, (r) => {
        if (r.midia) r.midia = duplicarMidia(r.midia);
        /* A aprovacao da Meta e por numero: a copia comeca sem ela. */
        r.aprovacaoMeta = { solicitada: false, situacao: 'nao_solicitada' };
        return r;
      })
    : new Map();
  if (quer.has('templates')) contagem.templates = mapaTpl.size;

  if (quer.has('status')) {
    const mapaStatus = copiar('status', origemId, destinoId, (r) => {
      r.departamentoId = r.departamentoId ? mapaDep.get(r.departamentoId) || null : null;
      r.followups = (r.followups || [])
        .map((p) => ({ ...p, templateId: mapaTpl.get(p.templateId) || null, desistir: p.desistir ? { ...p.desistir } : null }))
        .filter((p) => p.templateId);
      return r;
    });
    /* Segundo passo: o status de desistencia do follow-up aponta para OUTRO
       status, cujo id novo so existe agora. */
    for (const s of listar('status', { workspaceId: destinoId })) {
      if (!(s.followups || []).some((p) => p.desistir?.statusId)) continue;
      const followups = s.followups.map((p) =>
        p.desistir?.statusId ? { ...p, desistir: { ...p.desistir, statusId: mapaStatus.get(p.desistir.statusId) || null } } : p,
      );
      atualizar('status', s.id, { followups });
    }
    contagem.status = mapaStatus.size;
  }

  if (quer.has('agentes')) {
    contagem.agentes = copiar('agentes', origemId, destinoId, (r) => {
      r.ativo = false; // a copia entra desligada, como todo agente de area nova
      r.vozId = null;
      r.modoAudio = false;
      r.conhecimentoIds = (r.conhecimentoIds || []).map((id) => mapaBase.get(id)).filter(Boolean);
      return r;
    }).size;
  }

  return contagem;
}
