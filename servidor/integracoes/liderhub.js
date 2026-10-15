import { achar, atualizar, inserir, inserirMensagem, listar, mensagensDe } from '../nucleo/banco.js';
import { umTipoDeCaso } from '../nucleo/casos.js';
import { agora, normalizar, novoId } from '../nucleo/util.js';
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

/* Pedido do escritorio em 15/10/2026: o historico completo (fase 2) vinha
   com contato demais sem identificacao (gente que nunca chegou a dar o
   nome, parada ha anos na LiderHub). Trazer so quem teve conversa nos
   ultimos MESES_DO_HISTORICO meses reduz esse lixo acumulado e deixa a
   fila de Atendimento enxuta. Calculada na hora da chamada (nao uma vez so
   no boot), para o "ha 6 meses" andar com o relogio de verdade. */
const MESES_DO_HISTORICO = 6;
function dataLimiteDoHistorico() {
  const limite = new Date();
  limite.setMonth(limite.getMonth() - MESES_DO_HISTORICO);
  return limite.toISOString();
}

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

/* As tres listas de nomes da LiderHub (status, tags, departamentos) e os
   mapas DESTE sistema por nome normalizado — usados tanto pela fase 1
   (classificacao) quanto pela fase 2 (historico completo), para as duas
   tratarem status/etiqueta/departamento do mesmo jeito. */
async function buscarListasDaLiderhub(chave) {
  const statusLh = dicionario(await pedir('/settings/status', chave));
  await espera(ESPERA_ENTRE);
  const tagsLh = dicionario(await pedir('/settings/tags', chave));
  await espera(ESPERA_ENTRE);
  const deptLh = dicionario(await pedir('/settings/departamentos', chave));
  await espera(ESPERA_ENTRE);
  return { statusLh, tagsLh, deptLh };
}

function dicionariosDaqui(workspaceId) {
  return {
    statusDaqui: new Map(listar('status', { workspaceId }).map((s) => [normalizar(s.nome), s])),
    deptDaqui: new Map(listar('departamentos', { workspaceId }).map((d) => [normalizar(d.nome), d])),
    etiquetasDaqui: new Map(listar('etiquetas', { workspaceId }).map((e) => [normalizar(e.nome), e])),
  };
}

/** Casa o nome do status da LiderHub com uma coluna do funil daqui, pelos apelidos conhecidos. */
function casarStatus(nome, statusDaqui) {
  const alvo = APELIDOS_STATUS[normalizar(nome)] || normalizar(nome);
  return statusDaqui.get(alvo) || null;
}

const CORES_DE_ETIQUETA = ['var(--serie-1)', 'var(--serie-2)', 'var(--serie-3)', 'var(--serie-5)', 'var(--serie-6)', 'var(--serie-7)', 'var(--serie-8)'];

/** Acha a etiqueta pelo nome normalizado, ou cria (etiqueta e lista aberta). Nunca cria em modo simular. */
function acharOuCriarEtiqueta(workspaceId, nome, etiquetasDaqui, { simular = false } = {}) {
  const chaveNome = normalizar(nome);
  const existente = etiquetasDaqui.get(chaveNome);
  if (existente) return { etiqueta: existente, criada: false };
  if (simular) return { etiqueta: null, criada: true };
  const nova = inserir('etiquetas', {
    id: novoId('etq'),
    workspaceId,
    nome: String(nome).trim(),
    cor: CORES_DE_ETIQUETA[etiquetasDaqui.size % CORES_DE_ETIQUETA.length],
  });
  etiquetasDaqui.set(chaveNome, nova);
  return { etiqueta: nova, criada: true };
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

  const { statusLh, tagsLh, deptLh } = await buscarListasDaLiderhub(chave);
  const contatosLh = await todosOsContatos(chave);

  const { statusDaqui, deptDaqui, etiquetasDaqui } = dicionariosDaqui(workspaceId);
  const contatosExistentes = new Set(
    listar('contatos', { workspaceId }).map((c) => soDigitos(c.telefone)).filter(Boolean),
  );

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

    const status = nomeStatus ? casarStatus(nomeStatus, statusDaqui) : null;
    if (nomeStatus && !status) relatorio.statusSemPar.add(nomeStatus);

    const dept = nomeDept ? deptDaqui.get(normalizar(nomeDept)) : null;
    if (nomeDept && !dept) relatorio.departamentoSemPar.add(nomeDept);

    const etiquetaIds = [];
    for (const nomeTag of nomesTags) {
      const { etiqueta, criada } = acharOuCriarEtiqueta(workspaceId, nomeTag, etiquetasDaqui, { simular });
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

/**
 * Segunda fase: o historico COMPLETO (contato + conversa inteira) de UMA
 * conexao da LiderHub — a que tiver o mesmo numero da conexao deste
 * workspace. Pedido do escritorio em 15/10/2026, depois da fase 1
 * (classificacao) ja estar no ar: so o numero do Trabalhista, sem mandar
 * nenhuma mensagem agora.
 *
 * Contato NOVO entra pronto para a IA por padrao (responsavel = o agente de
 * entrada da conexao, o mesmo que qualquer lead novo receberia) — a IA so
 * fala se a PESSOA escrever de novo. Excecao, pedida em 15/10/2026: a
 * LiderHub manda, por contato, quem cuidava dele la (`user` = uma pessoa,
 * `agent` = um agente de IA dela). Contato que tinha PESSOA cuidando nao
 * entra pronto para a IA: fica Pendente, esperando a equipe olhar e decidir
 * (nunca inventa quem seria essa pessoa no nosso sistema).
 *
 * Contato que ja existe aqui (de uso real ou da fase 1) NUNCA tem
 * responsavel, status, departamento ou etiqueta tocados: so ganha as
 * mensagens que ainda nao tinha.
 *
 * So os ultimos MESES_DO_HISTORICO meses (pedido do escritorio, mesmo dia):
 * o historico completo estava trazendo contato demais sem identificacao —
 * gente parada ha anos na LiderHub, sem nome nem conversa recente. Limitar
 * pela ultima modificacao (modifiedAfter) deixa a fila de Atendimento
 * enxuta, sem o lixo acumulado de contas antigas.
 */

/** Acha a conexao da LiderHub com o mesmo numero da conexao real daqui. */
async function conexaoNaLiderhub(chave, numeroDaqui) {
  const dados = await pedir('/connections', chave);
  const lista = dados?.connections || [];
  const achada = lista.find((c) => soDigitos(c.number) === numeroDaqui);
  if (!achada) {
    const erro = new Error(`Nenhuma conexao na LiderHub com o numero ${numeroDaqui}.`);
    erro.codigo = 404;
    throw erro;
  }
  return achada;
}

function conexaoQrcodeDoWorkspace(workspaceId) {
  const conexao = listar('conexoes', { workspaceId, tipo: 'qrcode' })[0];
  if (!conexao || !soDigitos(conexao.numero)) {
    const erro = new Error('Conecte o numero de WhatsApp deste workspace (em Conexoes) antes de importar o historico.');
    erro.codigo = 400;
    throw erro;
  }
  return conexao;
}

/** O que a tela mostra antes de importar: qual conexao bateu, e quantos contatos tem. */
export async function detectarHistoricoLiderhub(workspaceId) {
  const chave = chaveDe(workspaceId);
  if (!chave) {
    const erro = new Error('Configure a chave da LiderHub em Integracoes antes de importar.');
    erro.codigo = 400;
    throw erro;
  }
  const conexao = conexaoQrcodeDoWorkspace(workspaceId);
  const numeroDaqui = soDigitos(conexao.numero);
  const conexaoLh = await conexaoNaLiderhub(chave, numeroDaqui);
  await espera(ESPERA_ENTRE);
  const pagina1 = await pedir('/contacts', chave, { connection: conexaoLh.id, page: 1, limit: 1, modifiedAfter: dataLimiteDoHistorico() });
  return { numero: conexao.numero, conexaoLiderhubId: conexaoLh.id, totalContatos: pagina1?.pagination?.total ?? 0, meses: MESES_DO_HISTORICO };
}

/* Uma fila por workspace: nunca duas importacoes do mesmo workspace ao
   mesmo tempo, mas workspaces diferentes podem rodar em paralelo. */
const filasHistorico = new Map();
const andandoHistorico = new Set();
/* O contador de status/etiqueta/departamento de uma rodada — uma referencia
   SO, compartilhada por todas as tarefas da fila daquele workspace. */
const contadoresHistorico = new Map();

function novoContador() {
  return { comStatus: 0, comDepartamento: 0, etiquetasAplicadas: 0, etiquetasCriadas: new Set(), statusSemPar: new Set(), departamentoSemPar: new Set() };
}

function anotarHistorico(workspaceId, extra = {}) {
  const registro = achar('integracoes', { workspaceId });
  if (!registro) return;
  const historico = { ...(registro.liderhub?.historico || {}), atualizadoEm: agora(), ...extra };
  atualizar('integracoes', registro.id, { liderhub: { ...(registro.liderhub || {}), historico } });
}

/** Garante a etiqueta que marca quem veio do historico da LiderHub, sem duplicar. */
function etiquetaDoHistorico(workspaceId) {
  const nome = 'Histórico LiderHub';
  const existente = listar('etiquetas', { workspaceId }).find((e) => normalizar(e.nome) === normalizar(nome));
  if (existente) return existente.id;
  return inserir('etiquetas', { id: novoId('etq'), workspaceId, nome, cor: 'var(--serie-6)' }).id;
}

/**
 * Um contato da LiderHub: acha-ou-cria aqui, aplica status/etiquetas/
 * departamento (mesmas regras da fase 1 — ver importarClassificacao),
 * marca a etiqueta do historico e traz a conversa inteira.
 *
 * Status e departamento SO para contato NOVO (o que ja existia aqui nunca
 * tem isso tocado); etiqueta e sempre somada, em contato novo ou nao — e
 * so acrescenta, nunca tira o que ja estava la.
 */
async function processarContatoHistorico({ workspaceId, conexao, chave, contatoLh, etiquetaHistoricoId, classificacao, contador }) {
  const telefone = String(contatoLh.contactNumber || contatoLh.number || '').trim();
  if (!soDigitos(telefone)) return { mensagens: 0 };

  const { contato, novo } = acharOuCriarContato({
    workspaceId,
    conexao,
    telefone,
    nome: contatoLh.contactName || '',
    nomeOrigem: contatoLh.contactName ? 'manual' : null,
  });

  const { statusLh, tagsLh, deptLh, statusDaqui, deptDaqui, etiquetasDaqui } = classificacao;
  const nomeStatus = contatoLh.status ? statusLh.get(contatoLh.status) : '';
  const nomeDept = contatoLh.department ? deptLh.get(contatoLh.department) : '';
  const nomesTags = (contatoLh.tags || []).map((id) => tagsLh.get(id)).filter(Boolean);

  const status = nomeStatus ? casarStatus(nomeStatus, statusDaqui) : null;
  const dept = nomeDept ? deptDaqui.get(normalizar(nomeDept)) : null;

  const etiquetaIds = etiquetaHistoricoId ? [etiquetaHistoricoId] : [];
  for (const nomeTag of nomesTags) {
    const { etiqueta, criada } = acharOuCriarEtiqueta(workspaceId, nomeTag, etiquetasDaqui, { simular: false });
    if (criada) contador.etiquetasCriadas.add(String(nomeTag).trim());
    if (etiqueta) etiquetaIds.push(etiqueta.id);
  }
  const etiquetasNovas = etiquetaIds.filter((id) => !(contato.etiquetas || []).includes(id));
  if (etiquetasNovas.length) {
    const juntas = [...(contato.etiquetas || []), ...etiquetasNovas];
    atualizar('contatos', contato.id, { etiquetas: umTipoDeCaso(juntas, contato.etiquetas) });
    contador.etiquetasAplicadas += etiquetasNovas.length;
  }

  if (novo) {
    if (status) {
      await aplicarStatus(contato, status, { tipo: 'sistema', nome: 'Histórico LiderHub' }, { dispararFollowups: false });
      contador.comStatus += 1;
    } else if (nomeStatus) {
      contador.statusSemPar.add(nomeStatus);
    }
    if (dept) {
      atualizar('contatos', contato.id, { departamentoId: dept.id });
      contador.comDepartamento += 1;
    } else if (nomeDept) {
      contador.departamentoSemPar.add(nomeDept);
    }
  }

  /* So decide o modo de um contato NOVO (o que ja existia aqui nunca tem
     responsavel/estado tocados). Por padrao, acharOuCriarContato ja deixa
     pronto para a IA (responsavelPadrao da conexao). Mas a LiderHub manda,
     por contato, quem cuidava la — "user" e uma PESSOA; "agent" e um agente
     de IA dela. Quem tinha pessoa cuidando nao entra pronto para a IA daqui:
     fica Pendente, esperando a equipe olhar e decidir (nunca inventa quem
     seria essa pessoa no nosso sistema). */
  if (novo && contatoLh.user) {
    atualizar('contatos', contato.id, { responsavel: null, estado: 'pendente', aceitoPor: null });
    contato.responsavel = null;
    contato.estado = 'pendente';
  }

  const idsQueJaTenho = new Set(mensagensDe(contato.id).map((m) => m.idExterno).filter(Boolean));
  let importadas = 0;
  let primeira = null;
  let ultima = null;
  let pagina = 1;
  for (let volta = 0; volta < 1000; volta += 1) {
    await espera(ESPERA_ENTRE);
    const dados = await pedir('/message', chave, { contact: contatoLh.id, page: pagina, limit: 100 });
    const lote = dados?.messages || [];
    for (const msg of lote) {
      const idExterno = msg.id ? `liderhub:${msg.id}` : null;
      if (idExterno && idsQueJaTenho.has(idExterno)) continue;
      const outbound = Boolean(msg.outbound);
      ultima = inserirMensagem(contato.id, {
        workspaceId,
        direcao: outbound ? 'saida' : 'entrada',
        tipo: 'texto',
        conteudo: typeof msg.content === 'string' ? msg.content : '',
        midia: msg.mediaUrl ? { url: msg.mediaUrl, caption: msg.mediaCaption || null } : null,
        idExterno,
        autor: outbound ? { tipo: 'membro', nome: 'LiderHub (histórico)' } : { tipo: 'cliente', nome: contato.nome },
        situacao: outbound ? 'enviada' : 'recebida',
        criadoEm: msg.sentAt || msg.createdAt || agora(),
        importada: true,
      });
      if (!primeira) primeira = ultima;
      if (idExterno) idsQueJaTenho.add(idExterno);
      importadas += 1;
    }
    if (!dados?.pagination?.hasNextPage || !lote.length) break;
    pagina += 1;
  }

  /* Sem isso, o contato nao aparece direito na fila de Atendimento: la, a
     ordenacao e a previa dependem de ultimaMensagemEm/previa no proprio
     contato, nao so das mensagens (mesmo padrao de importar-historico.js).
     Contato que ja existia pode ter conversa mais recente que a importada
     (uso real, depois da LiderHub): so pisa em ultimaMensagemEm/previa se o
     historico trazido for mais novo do que o que ja estava la. */
  if (ultima) {
    const atual = achar('contatos', contato.id);
    const maisRecente = !atual.ultimaMensagemEm || String(ultima.criadoEm) > String(atual.ultimaMensagemEm);
    if (maisRecente) {
      atualizar('contatos', contato.id, { ultimaMensagemEm: ultima.criadoEm, previa: (ultima.conteudo || '').slice(0, 120) });
    }
    if (novo && primeira) atualizar('contatos', contato.id, { primeiraMensagemEm: primeira.criadoEm });
  }

  return { importadas };
}

/** O laco que esvazia a fila de um workspace, um contato por vez. */
async function andarHistorico(workspaceId) {
  if (andandoHistorico.has(workspaceId)) return;
  andandoHistorico.add(workspaceId);
  try {
    const fila = filasHistorico.get(workspaceId);
    const contador = contadoresHistorico.get(workspaceId) || novoContador();
    while (fila && fila.length) {
      const tarefa = fila.shift();
      try {
        const { importadas } = await processarContatoHistorico(tarefa);
        const registro = achar('integracoes', { workspaceId });
        anotarHistorico(workspaceId, {
          situacao: 'importando',
          contatosProcessados: (registro?.liderhub?.historico?.contatosProcessados || 0) + 1,
          mensagensImportadas: (registro?.liderhub?.historico?.mensagensImportadas || 0) + importadas,
          comStatus: contador.comStatus,
          comDepartamento: contador.comDepartamento,
          etiquetasAplicadas: contador.etiquetasAplicadas,
          etiquetasCriadas: [...contador.etiquetasCriadas],
          statusSemPar: [...contador.statusSemPar],
          departamentoSemPar: [...contador.departamentoSemPar],
        });
      } catch (erro) {
        anotarHistorico(workspaceId, { erro: erro.message });
      }
    }
    anotarHistorico(workspaceId, { situacao: 'concluido', concluidoEm: agora() });
  } finally {
    andandoHistorico.delete(workspaceId);
    filasHistorico.delete(workspaceId);
    contadoresHistorico.delete(workspaceId);
  }
}

/**
 * Dispara a importacao do historico completo. Nao espera terminar: poe tudo
 * na fila (detecta a conexao, pagina os contatos da LiderHub) e devolve so
 * quando a fila ja esta montada — o processamento em si (uma conversa por
 * vez) continua em segundo plano depois que a funcao retorna.
 */
export async function enfileirarHistoricoLiderhub(workspaceId) {
  if (andandoHistorico.has(workspaceId)) {
    const erro = new Error('Ja ha uma importacao de historico em andamento neste workspace.');
    erro.codigo = 409;
    throw erro;
  }
  const chave = chaveDe(workspaceId);
  if (!chave) {
    const erro = new Error('Configure a chave da LiderHub em Integracoes antes de importar.');
    erro.codigo = 400;
    throw erro;
  }
  const conexao = conexaoQrcodeDoWorkspace(workspaceId);
  const numeroDaqui = soDigitos(conexao.numero);
  const conexaoLh = await conexaoNaLiderhub(chave, numeroDaqui);

  anotarHistorico(workspaceId, {
    situacao: 'importando',
    numero: conexao.numero,
    contatosTotal: 0,
    contatosProcessados: 0,
    mensagensImportadas: 0,
    comStatus: 0,
    comDepartamento: 0,
    etiquetasAplicadas: 0,
    etiquetasCriadas: [],
    statusSemPar: [],
    departamentoSemPar: [],
    erro: null,
    concluidoEm: null,
  });

  /* Mesma classificacao da fase 1 (status, etiquetas, departamento) — pedido
     do escritorio em 15/10/2026: o historico completo tambem traz isso,
     nao so a conversa. */
  const { statusLh, tagsLh, deptLh } = await buscarListasDaLiderhub(chave);
  const { statusDaqui, deptDaqui, etiquetasDaqui } = dicionariosDaqui(workspaceId);
  const classificacao = { statusLh, tagsLh, deptLh, statusDaqui, deptDaqui, etiquetasDaqui };
  const contador = novoContador();
  contadoresHistorico.set(workspaceId, contador);

  const etiquetaHistoricoId = etiquetaDoHistorico(workspaceId);
  const limite = dataLimiteDoHistorico();
  const fila = [];
  let pagina = 1;
  for (let volta = 0; volta < 1000; volta += 1) {
    await espera(ESPERA_ENTRE);
    const dados = await pedir('/contacts', chave, { connection: conexaoLh.id, page: pagina, limit: 100, modifiedAfter: limite });
    const lote = dados?.contacts || [];
    for (const contatoLh of lote) fila.push({ workspaceId, conexao, chave, contatoLh, etiquetaHistoricoId, classificacao, contador });
    anotarHistorico(workspaceId, { contatosTotal: fila.length });
    if (!dados?.pagination?.hasNextPage || !lote.length) break;
    pagina += 1;
  }

  /* fila.length precisa ser lido ANTES de chamar andarHistorico: o trecho
     sincrono de uma funcao async roda na hora, ate o primeiro await la
     dentro — andar() ja da um fila.shift() antes de suspender, entao ler
     fila.length depois daria o numero errado (um a menos). */
  const contatosTotal = fila.length;
  filasHistorico.set(workspaceId, fila);
  andarHistorico(workspaceId).catch((erro) => anotarHistorico(workspaceId, { situacao: 'erro', erro: erro.message }));
  return { iniciado: true, contatosTotal };
}

/** Retomada apos reiniciar: workspace que ficou "importando" comeca de novo
    (idempotente por idExterno, entao so repete trabalho ja feito). */
export function retomarHistoricoLiderhub() {
  let retomados = 0;
  for (const registro of listar('integracoes')) {
    if (registro.liderhub?.historico?.situacao !== 'importando') continue;
    retomados += 1;
    enfileirarHistoricoLiderhub(registro.workspaceId).catch((erro) =>
      anotarHistorico(registro.workspaceId, { situacao: 'erro', erro: erro.message }),
    );
  }
  return retomados;
}
