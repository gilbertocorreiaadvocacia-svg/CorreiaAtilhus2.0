import { achar, atualizar, inserir, listar } from '../nucleo/banco.js';
import { umTipoDeCaso } from '../nucleo/casos.js';
import { normalizar, novoId } from '../nucleo/util.js';
import { acharOuCriarContato } from '../whatsapp/recebimento.js';
import { aplicarStatus } from '../automacao/followup.js';

/**
 * Importa a CLASSIFICACAO dos contatos da LiderHub para este sistema.
 *
 * Primeira fase, combinada com o escritorio: traz por contato apenas o STATUS
 * (a coluna do funil), as ETIQUETAS e o DEPARTAMENTO (Comercial, Pos-venda...).
 * Nao traz mensagem, midia nem historico ainda.
 *
 * A API da LiderHub devolve o contato so com IDs (status, department, tags), e
 * os NOMES vem de tres listas a parte (/settings/status, /settings/tags,
 * /settings/departamentos). O casamento e sempre por NOME normalizado, para o
 * mapa nao depender de UUID de outro sistema.
 *
 * Duas regras que o escritorio decidiu:
 *   - STATUS sem par entre as colunas daqui: o contato fica SEM status e o nome
 *     que nao casou volta no relatorio (nunca cria coluna nova, para nao desfazer
 *     o funil que a equipe desenhou). O mesmo vale para o departamento.
 *   - ETIQUETA que ainda nao existe aqui e CRIADA (etiqueta e lista aberta).
 *
 * A chave (x-company-key) sai da configuracao do workspace (Integracoes) ou, se
 * vazia, da variavel de ambiente CORREIA_LIDERHUB_CHAVE. Nunca fica no codigo.
 */

const BASE = String(process.env.CORREIA_LIDERHUB_URL || 'https://api.liderhub.com.br/v1').replace(/\/+$/, '');

/* Limite da LiderHub: 3 pedidos por segundo. Uma folga e melhor que um 429. */
const ESPERA_ENTRE = Number(process.env.CORREIA_LIDERHUB_INTERVALO || 350);

/* Os renomes que este sistema fez nas colunas: o nome antigo da LiderHub aponta
   para o nome novo daqui, tudo normalizado (sem acento, minusculo). */
const APELIDOS_STATUS = {
  'nova conversa': 'novo lead',
  'novo lead': 'novo lead',
  'em triagem': 'em analise',
  'proposta enviada': 'preparar kit',
  'contrato assinado': 'contrato fechado',
};

const espera = (ms) => new Promise((r) => setTimeout(r, ms));
const soDigitos = (t) => String(t || '').replace(/\D+/g, '');

function chaveDe(workspaceId) {
  const registro = achar('integracoes', { workspaceId });
  return String(registro?.liderhub?.chave || process.env.CORREIA_LIDERHUB_CHAVE || '').trim();
}

async function pedir(caminho, chave, parametros = {}) {
  const url = new URL(BASE + caminho);
  for (const [k, v] of Object.entries(parametros)) if (v !== undefined && v !== null) url.searchParams.set(k, v);
  const resposta = await fetch(url, { headers: { 'x-company-key': chave, 'Content-Type': 'application/json' } });
  if (!resposta.ok) {
    const corpo = await resposta.text().catch(() => '');
    const erro = new Error(`LiderHub respondeu ${resposta.status} em ${caminho}. ${corpo.slice(0, 200)}`);
    erro.codigo = resposta.status === 401 ? 401 : 502;
    throw erro;
  }
  return resposta.json();
}

/** id -> nome, a partir de uma lista [{id, name}]. */
function dicionario(lista) {
  const mapa = new Map();
  for (const item of Array.isArray(lista) ? lista : []) {
    if (item && item.id) mapa.set(item.id, String(item.name || '').trim());
  }
  return mapa;
}

/** Percorre todas as paginas de contatos, respeitando o ritmo da API. */
async function todosOsContatos(chave) {
  const contatos = [];
  let pagina = 1;
  for (let volta = 0; volta < 1000; volta += 1) {
    const dados = await pedir('/contacts', chave, { page: pagina, limit: 100 });
    const lote = dados?.contacts || dados?.data || (Array.isArray(dados) ? dados : []);
    contatos.push(...lote);
    const paginacao = dados?.pagination;
    if (!paginacao?.hasNextPage || !lote.length) break;
    pagina += 1;
    await espera(ESPERA_ENTRE);
  }
  return contatos;
}

/**
 * Baixa da LiderHub e devolve o que MUDARIA (simular) ou aplica de fato.
 *
 * Devolve sempre um relatorio: quantos contatos, quantos casaram, e as listas
 * de nomes de status e departamento que nao tem par aqui, alem das etiquetas
 * criadas. Assim a previa mostra exatamente o que a importacao vai fazer.
 */
export async function importarClassificacao(workspaceId, { simular = true } = {}) {
  const chave = chaveDe(workspaceId);
  if (!chave) {
    const erro = new Error('Configure a chave da LiderHub em Integracoes antes de importar.');
    erro.codigo = 400;
    throw erro;
  }

  const conexao = listar('conexoes', { workspaceId })[0];
  if (!conexao) {
    const erro = new Error('Cadastre uma conexao (numero de WhatsApp ou simulador) antes de importar.');
    erro.codigo = 400;
    throw erro;
  }

  /* As tres listas de nomes, uma requisicao cada, com folga entre elas. */
  const statusLh = dicionario(await pedir('/settings/status', chave));
  await espera(ESPERA_ENTRE);
  const tagsLh = dicionario(await pedir('/settings/tags', chave));
  await espera(ESPERA_ENTRE);
  const deptLh = dicionario(await pedir('/settings/departamentos', chave));
  await espera(ESPERA_ENTRE);

  const contatosLh = await todosOsContatos(chave);

  /* Os dicionarios DESTE sistema, por nome normalizado. */
  const statusDaqui = new Map(listar('status', { workspaceId }).map((s) => [normalizar(s.nome), s]));
  const deptDaqui = new Map(listar('departamentos', { workspaceId }).map((d) => [normalizar(d.nome), d]));
  const etiquetasDaqui = new Map(listar('etiquetas', { workspaceId }).map((e) => [normalizar(e.nome), e]));
  const contatosExistentes = new Set(
    listar('contatos', { workspaceId }).map((c) => soDigitos(c.telefone)).filter(Boolean),
  );

  const casarStatus = (nome) => {
    const alvo = APELIDOS_STATUS[normalizar(nome)] || normalizar(nome);
    return statusDaqui.get(alvo) || null;
  };

  const CORES = ['var(--serie-1)', 'var(--serie-2)', 'var(--serie-3)', 'var(--serie-5)', 'var(--serie-6)', 'var(--serie-7)', 'var(--serie-8)'];
  const acharOuCriarEtiqueta = (nome) => {
    const chaveNome = normalizar(nome);
    const existente = etiquetasDaqui.get(chaveNome);
    if (existente) return { etiqueta: existente, criada: false };
    if (simular) return { etiqueta: null, criada: true };
    const nova = inserir('etiquetas', {
      id: novoId('etq'),
      workspaceId,
      nome: String(nome).trim(),
      cor: CORES[etiquetasDaqui.size % CORES.length],
    });
    etiquetasDaqui.set(chaveNome, nova);
    return { etiqueta: nova, criada: true };
  };

  const relatorio = {
    simulacao: simular,
    totalLiderhub: contatosLh.length,
    semTelefone: 0,
    novos: 0,
    atualizados: 0,
    comStatus: 0,
    comDepartamento: 0,
    statusSemPar: new Set(),
    departamentoSemPar: new Set(),
    etiquetasCriadas: new Set(),
    etiquetasAplicadas: 0,
    erros: [],
  };

  for (const c of contatosLh) {
    const telefone = String(c.contactNumber || c.number || '').trim();
    if (!soDigitos(telefone)) {
      relatorio.semTelefone += 1;
      continue;
    }

    const nomeStatus = c.status ? statusLh.get(c.status) : '';
    const nomeDept = c.department ? deptLh.get(c.department) : '';
    const nomesTags = (c.tags || []).map((id) => tagsLh.get(id)).filter(Boolean);

    const status = nomeStatus ? casarStatus(nomeStatus) : null;
    if (nomeStatus && !status) relatorio.statusSemPar.add(nomeStatus);

    const dept = nomeDept ? deptDaqui.get(normalizar(nomeDept)) : null;
    if (nomeDept && !dept) relatorio.departamentoSemPar.add(nomeDept);

    const etiquetaIds = [];
    for (const nomeTag of nomesTags) {
      const { etiqueta, criada } = acharOuCriarEtiqueta(nomeTag);
      if (criada) relatorio.etiquetasCriadas.add(String(nomeTag).trim());
      if (etiqueta) etiquetaIds.push(etiqueta.id);
    }

    try {
      const jaExiste = contatosExistentes.has(soDigitos(telefone));
      if (simular) {
        if (jaExiste) relatorio.atualizados += 1;
        else relatorio.novos += 1;
        if (status) relatorio.comStatus += 1;
        if (dept) relatorio.comDepartamento += 1;
        relatorio.etiquetasAplicadas += etiquetaIds.length;
        continue;
      }

      const { contato, novo } = acharOuCriarContato({
        workspaceId,
        conexao,
        telefone,
        nome: c.contactName || '',
        nomeOrigem: c.contactName ? 'manual' : null,
      });
      if (novo) relatorio.novos += 1;
      else relatorio.atualizados += 1;
      contatosExistentes.add(soDigitos(contato.telefone));

      /* Contato migrado nao entra na fila da IA: e um registro ja classificado,
         nao um lead que acabou de chamar. A conexao coloca o agente de triagem
         como responsavel padrao; aqui ele sai, e a conversa fica pendente. */
      if (novo) {
        atualizar('contatos', contato.id, { responsavel: null, estado: 'pendente' });
        contato.responsavel = null;
        contato.estado = 'pendente';
      }

      /* A LiderHub manda no status: casou, aplica; tinha um status que nao casa,
         o contato NOVO fica sem status (nunca herda o "NOVO lead" padrao da
         conexao); o que ja existia aqui mantem o status que tinha. */
      if (status) {
        await aplicarStatus(contato, status, { tipo: 'sistema', nome: 'Importacao LiderHub' }, { dispararFollowups: false });
        relatorio.comStatus += 1;
      } else if (novo && nomeStatus) {
        atualizar('contatos', contato.id, { statusId: null });
      }
      if (dept) {
        atualizar('contatos', contato.id, { departamentoId: dept.id });
        relatorio.comDepartamento += 1;
      } else if (novo && nomeDept) {
        atualizar('contatos', contato.id, { departamentoId: null });
      }
      if (etiquetaIds.length) {
        const juntas = [...new Set([...(contato.etiquetas || []), ...etiquetaIds])];
        atualizar('contatos', contato.id, { etiquetas: umTipoDeCaso(juntas, contato.etiquetas) });
        relatorio.etiquetasAplicadas += etiquetaIds.length;
      }
    } catch (erro) {
      relatorio.erros.push(`${telefone}: ${erro.message}`);
    }
  }

  if (!simular) {
    const registro = achar('integracoes', { workspaceId });
    if (registro) {
      atualizar('integracoes', registro.id, {
        liderhub: { ...(registro.liderhub || {}), ativo: true, ultimaImportacao: new Date().toISOString() },
      });
    }
  }

  /* Os Set viram lista para caber no JSON. */
  return {
    ...relatorio,
    statusSemPar: [...relatorio.statusSemPar],
    departamentoSemPar: [...relatorio.departamentoSemPar],
    etiquetasCriadas: [...relatorio.etiquetasCriadas],
  };
}
