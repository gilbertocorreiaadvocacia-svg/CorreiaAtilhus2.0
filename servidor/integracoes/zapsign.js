import fs from 'node:fs';
import path from 'node:path';
import { PASTA_ARQUIVOS } from '../config.js';
import { achar, atualizar, inserir, listar, registrarLog } from '../nucleo/banco.js';
import { membrosQuePodemVer } from '../nucleo/auth.js';
import { TIPOS_DE_CASO, definirMomento, tipoDeCasoDa } from '../nucleo/casos.js';
import { contratoAbertoDe } from '../nucleo/contratos.js';
import { quemFechou } from '../nucleo/ficha-do-contrato.js';
import { conferirTeto, motivoDoBloqueio } from '../nucleo/teto-de-casos.js';
import { emitir } from '../nucleo/eventos.js';
import { disparar } from '../nucleo/ganchos.js';
import { avisarAdministradores } from '../nucleo/avisar-administradores.js';
import { agora, formatarTelefone, garantirPasta, normalizar, novoId } from '../nucleo/util.js';
import { enviarMensagem } from '../whatsapp/envio.js';
import { aplicarStatus } from '../automacao/followup.js';
import { inserirNota, notificar } from '../ia/mencoes.js';
import { pedirAvaliacao } from '../automacao/avaliacao.js';

/**
 * Contrato e procuracao pela ZapSign.
 *
 * O caminho:
 *   1. o agente (ou alguem da equipe) PEDE o contrato. Com o ENVIO DIRETO
 *      (o padrao desde 29/10/2026, a pedido do escritorio), o contrato vai
 *      para a ZapSign na hora e o link sai — o passo 2 roda sozinho. Com ele
 *      desligado em Integracoes (a regra antiga: IA nao manda contrato nem
 *      procuracao sozinha), o contrato fica "em conferencia" com os valores que
 *      vao preencher o modelo, e a equipe e avisada.
 *   2. a pessoa confere, corrige o que precisar e APROVA. So entao o documento
 *      nasce na ZapSign (modelo do tipo de caso), a procuracao entra como
 *      documento extra, e o link sai no WhatsApp com o video de como assinar.
 *      Ou DEVOLVE ao agente, dizendo o que corrigir.
 *   3. o sistema CONSULTA o documento de tempos em tempos (este computador nao
 *      tem endereco publico, entao o webhook da ZapSign nao chega aqui). Link
 *      aberto, recusa e prazo vencido viram momento do lead; assinado, os PDFs
 *      sao baixados na hora (o endereco deles expira) e a assinatura e
 *      confirmada uma vez so.
 */

const BASE = `${String(process.env.CORREIA_ZAPSIGN_URL || 'https://api.zapsign.com.br').replace(/\/+$/, '')}/api/v1`;

/*
 * Espera entre consultas, conforme a idade do link: nas duas primeiras horas o
 * cliente costuma assinar logo; depois, de hora em hora; passados dois dias, a
 * cada seis horas. O teste encurta para milissegundos.
 */
const ESPERAS = (process.env.CORREIA_ZAPSIGN_ESPERAS || '')
  .split(',')
  .map(Number)
  .filter((n) => n > 0);
const [ESPERA_CURTA, ESPERA_MEDIA, ESPERA_LONGA] =
  ESPERAS.length === 3 ? ESPERAS : [5 * 60000, 60 * 60000, 6 * 60 * 60000];

/* Os campos que o contrato pede quando o modelo ainda nao foi sincronizado. */
const CAMPOS_PADRAO = ['nome_completo', 'cpf', 'nascimento', 'estado_civil', 'profissao', 'endereco', 'email'];

/* Nomes de variavel do modelo que querem dizer o mesmo dado da conversa. */
const APELIDOS = {
  nome: 'nome_completo',
  nome_completo: 'nome_completo',
  cliente: 'nome_completo',
  contratante: 'nome_completo',
  outorgante: 'nome_completo',
  telefone: 'telefone',
  whatsapp: 'telefone',
  celular: 'telefone',
  data: 'data_hoje',
  data_contrato: 'data_hoje',
  data_assinatura: 'data_hoje',
  data_nascimento: 'nascimento',
  nascimento: 'nascimento',
  endereco_completo: 'endereco',
  e_mail: 'email',
};

function configuracao(workspaceId) {
  const integracoes = achar('integracoes', { workspaceId });
  return integracoes?.zapsign || { chave: '', modelos: [], ativo: false };
}

const cabecalhos = (cfg) => ({ Authorization: `Bearer ${cfg.chave}`, 'Content-Type': 'application/json' });

function erroDaZapsign(status, corpo) {
  if (status === 402) return 'O plano da ZapSign nao libera a API (402).';
  if (status === 403 || status === 401) return 'Chave de API da ZapSign invalida (403).';
  return corpo?.detail || corpo?.message || `A ZapSign respondeu ${status}.`;
}

/** Traz os modelos da conta, com as variaveis de cada um, para a tela. */
export async function sincronizarModelos(workspaceId) {
  const cfg = configuracao(workspaceId);
  if (!cfg.chave) return { ok: false, erro: 'Chave de API da ZapSign nao configurada.' };

  /* Listar e detalhar modelo e /templates/; so a criacao de documento e que
     fica em /models/create-doc/. Com /models/ a ZapSign responde 404. */
  const resposta = await fetch(`${BASE}/templates/`, { headers: cabecalhos(cfg) });
  if (!resposta.ok) return { ok: false, erro: erroDaZapsign(resposta.status, await resposta.json().catch(() => ({}))) };

  const dados = await resposta.json().catch(() => []);
  const lista = Array.isArray(dados) ? dados : dados?.results || [];
  const modelos = [];
  for (const m of lista) {
    const id = String(m.token || m.id);
    let entradas = m.inputs || m.variables || null;
    /* A lista da ZapSign nem sempre traz as variaveis; o detalhe do modelo traz. */
    if (!entradas) {
      const detalhe = await fetch(`${BASE}/templates/${encodeURIComponent(id)}/`, { headers: cabecalhos(cfg) })
        .then((r) => (r.ok ? r.json() : null))
        .catch(() => null);
      entradas = detalhe?.inputs || detalhe?.variables || [];
    }
    modelos.push({
      id,
      nome: m.name || m.nome || 'Modelo sem nome',
      variaveis: entradas.map((v) => String(v.variable || v.name || v)).filter(Boolean),
      /* Modelos anexados a este na ZapSign (a procuracao do contrato). Eles
         nascem junto no create-doc: nao se manda de novo. */
      extras: (m.extra_templates || []).map((e) => String(e?.name || e?.token || e)).filter(Boolean),
    });
  }

  const integracoes = achar('integracoes', { workspaceId });
  atualizar('integracoes', integracoes.id, { zapsign: { ...cfg, modelos, ativo: true, sincronizadoEm: agora() } });
  return { ok: true, modelos };
}

/**
 * Palavras que, no NOME de um modelo da ZapSign, dizem de que tipo de caso ele e.
 * "Auxilio" sozinho nao entra: serve a doenca e ao acidente, e adivinhar mandaria o
 * contrato errado para o cliente.
 */
const PALAVRAS_DO_CASO = {
  bpc: ['bpc', 'loas', 'beneficio de prestacao continuada'],
  auxilio: ['auxilio doenca', 'auxilio por incapacidade', 'incapacidade temporaria', 'incapacidade'],
  auxilio_acidente: ['auxilio acidente', 'acidente'],
  maternidade: ['maternidade'],
  trabalhista: ['trabalhista', 'reclamacao trabalhista'],
  civel: ['civel', 'consumidor'],
};

const textoDoNome = (nome) => ` ${normalizar(String(nome || '')).replace(/[^a-z0-9]+/g, ' ').trim()} `;

/**
 * Os casos que o NOME de um modelo indica. "Auxilio acidente" tambem cita "incapacidade"
 * as vezes: quando o acidente aparece, o auxilio-doenca nao conta.
 */
const casosDoModelo = (modelo) => {
  const achados = Object.keys(PALAVRAS_DO_CASO).filter((caso) => PALAVRAS_DO_CASO[caso].some((p) => modelo.texto.includes(` ${p}`)));
  return achados.includes('auxilio_acidente') ? achados.filter((caso) => caso !== 'auxilio') : achados;
};

/**
 * Sugere que modelo da ZapSign usar para cada coisa, lendo o NOME dos modelos que
 * a sincronizacao trouxe. So devolve o que e claro: um modelo so serve a um caso se o
 * nome indica exatamente aquele caso; com dois modelos que servem, ou nenhum, a
 * escolha fica em branco e aparece em `semEscolha` — enviar o contrato errado a um
 * cliente e pior do que pedir para a pessoa escolher.
 *
 * Nao grava nada: quem chama mostra a sugestao, a pessoa confere e salva.
 */
export function sugerirModelos(modelos = []) {
  const lista = modelos.map((m) => ({ ...m, texto: textoDoNome(m.nome) })).map((m) => ({ ...m, casos: casosDoModelo(m) }));
  const ehProcuracao = (m) => m.texto.includes(' procura');
  const contratos = lista.filter((m) => !ehProcuracao(m));
  const procuracoes = lista.filter(ehProcuracao);

  const escolhas = [];
  const semEscolha = [];
  const modelosPorCaso = {};

  /* Modelo cujo nome cita mais de um caso nao vai para nenhum: a pessoa decide. */
  for (const m of lista.filter((x) => x.casos.length > 1)) {
    semEscolha.push({ para: m.nome, motivo: 'o nome cita mais de um tipo de caso', candidatos: [] });
  }

  const unicoDoCaso = (conjunto, caso) => {
    const achados = conjunto.filter((m) => m.casos.length === 1 && m.casos[0] === caso);
    return { escolhido: achados.length === 1 ? achados[0] : null, varios: achados.length > 1 ? achados : [] };
  };

  for (const tipo of TIPOS_DE_CASO) {
    const contrato = unicoDoCaso(contratos, tipo.caso);
    const procuracao = unicoDoCaso(procuracoes, tipo.caso);
    if (contrato.escolhido || procuracao.escolhido) {
      modelosPorCaso[tipo.caso] = { contratoId: contrato.escolhido?.id || null, procuracaoId: procuracao.escolhido?.id || null };
      if (contrato.escolhido) escolhas.push({ para: `${tipo.nome}: contrato`, modelo: contrato.escolhido.nome });
      if (procuracao.escolhido) escolhas.push({ para: `${tipo.nome}: procuracao`, modelo: procuracao.escolhido.nome });
    }
    if (contrato.varios.length) semEscolha.push({ para: `${tipo.nome}: contrato`, motivo: 'mais de um modelo serve', candidatos: contrato.varios.map((m) => m.nome) });
    if (procuracao.varios.length) semEscolha.push({ para: `${tipo.nome}: procuracao`, motivo: 'mais de uma procuracao serve', candidatos: procuracao.varios.map((m) => m.nome) });
  }

  /* O padrao: o modelo que nao e de caso nenhum, quando so ha um. */
  const geraisContrato = contratos.filter((m) => m.casos.length === 0);
  const geraisProcuracao = procuracoes.filter((m) => m.casos.length === 0);
  const padrao = geraisContrato.length === 1 ? geraisContrato[0] : null;
  const procuracaoPadrao = geraisProcuracao.length === 1 ? geraisProcuracao[0] : null;
  if (padrao) escolhas.push({ para: 'Modelo de contrato (padrao)', modelo: padrao.nome });
  else semEscolha.push({ para: 'Modelo de contrato (padrao)', motivo: geraisContrato.length ? 'mais de um modelo geral' : 'nenhum modelo geral', candidatos: geraisContrato.map((m) => m.nome) });
  if (procuracaoPadrao) escolhas.push({ para: 'Procuracao (padrao)', modelo: procuracaoPadrao.nome });
  else if (geraisProcuracao.length > 1) semEscolha.push({ para: 'Procuracao (padrao)', motivo: 'mais de uma procuracao geral', candidatos: geraisProcuracao.map((m) => m.nome) });

  return {
    modeloPadraoId: padrao?.id || null,
    procuracaoPadraoId: procuracaoPadrao?.id || null,
    modelosPorCaso,
    escolhas,
    semEscolha,
  };
}

/** "{{NOME COMPLETO}}" -> "nome_completo". */
const chaveDoCampo = (campo) =>
  normalizar(String(campo).replace(/[{}]/g, ''))
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '');

function destinoDoCampo(campo, cfg) {
  const chave = chaveDoCampo(campo);
  return cfg.mapaVariaveis?.[campo] || cfg.mapaVariaveis?.[chave] || APELIDOS[chave] || chave;
}

function valorDoCampo(campo, contato, cfg) {
  const destino = destinoDoCampo(campo, cfg);
  const variaveis = contato.variaveis || {};
  if (destino === 'nome_completo') return variaveis.nome_completo || contato.nome || '';
  if (destino === 'telefone') return formatarTelefone(contato.telefone);
  if (destino === 'data_hoje') return new Date().toLocaleDateString('pt-BR', { timeZone: 'America/Sao_Paulo' });
  if (destino === 'nacionalidade') return String(variaveis.nacionalidade || 'brasileira').trim();
  /* A cidade do contrato: a variavel, ou o municipio escrito no endereco
     ("..., Timbauba-PE, 55870-000"). A pessoa confere na conferencia. */
  if (destino === 'cidade') {
    const doEndereco = [...String(variaveis.endereco || '').matchAll(/([^,\d][^,]*?)\s*[-/]\s*[A-Z]{2}\b/g)].pop()?.[1];
    return String(variaveis.cidade || doEndereco || '').trim();
  }
  return String(variaveis[destino] ?? '').trim();
}

/** Modelos do contrato e da procuracao para o tipo de caso da conversa. */
function modeloDaConversa(cfg, contato) {
  const caso = tipoDeCasoDa(contato)?.caso || null;
  const porCaso = caso ? cfg.modelosPorCaso?.[caso] : null;
  return {
    caso,
    contratoId: porCaso?.contratoId || cfg.modeloPadraoId || null,
    procuracaoId: porCaso?.procuracaoId || cfg.procuracaoPadraoId || null,
  };
}

/** O modelo de contrato ja traz a procuracao anexada na ZapSign? */
const trazProcuracao = (cfg, contratoId) =>
  ((cfg.modelos || []).find((m) => m.id === contratoId)?.extras || []).length > 0;

/*
 * So nome e CPF impedem o pedido: sem eles nao ha contrato. O resto que ficar
 * em branco (RG, orgao expedidor...) vai para a conferencia, e a pessoa
 * preenche antes de aprovar — o RG sai do documento, e o agente nao o pede.
 */
const ESSENCIAIS = new Set(['nome_completo', 'cpf']);

/** Os valores que vao preencher os modelos, o que impede o pedido e o que fica para a equipe. */
function montarValores(cfg, modelo, contato) {
  const doModelo = (id) => (cfg.modelos || []).find((m) => m.id === id)?.variaveis || [];
  const daProcuracao = trazProcuracao(cfg, modelo.contratoId) ? [] : doModelo(modelo.procuracaoId);
  const campos = [...new Set([...doModelo(modelo.contratoId), ...daProcuracao])];
  const valores = {};
  for (const campo of campos.length ? campos : CAMPOS_PADRAO) valores[campo] = valorDoCampo(campo, contato, cfg);
  const vazios = Object.entries(valores).filter(([, valor]) => !String(valor).trim());
  const emBranco = vazios.map(([campo]) => chaveDoCampo(campo));
  const faltando = emBranco.filter((chave) => ESSENCIAIS.has(APELIDOS[chave] || chave));
  /* A chave em que o dado e LIDO (valorDoCampo): "data_nascimento" do modelo
     le "nascimento". E nela que o agente tem de guardar o que coletar. */
  const paraColetar = [...new Set(vazios.map(([campo]) => destinoDoCampo(campo, cfg)))];
  return { valores, faltando, emBranco, paraColetar };
}

const avisarEquipe = (contato, titulo, texto) => {
  for (const membro of membrosQuePodemVer(contato.workspaceId, contato)) {
    notificar(contato.workspaceId, membro.id, 'contrato', titulo, texto, contato.id);
  }
};

const avisadoSemModeloNoDia = new Map();

/** O que fazer quando nenhum modelo de contrato foi escolhido para esta conversa. */
function semModeloDeContrato({ contato, cfg, modelo, quem }) {
  const workspaceId = contato.workspaceId;
  const caso = modelo.caso ? tipoDeCasoDa(contato)?.nome || modelo.caso : null;
  const motivo = !cfg.chave
    ? 'A chave da ZapSign nao esta configurada em Integracoes.'
    : caso
      ? `Nao ha modelo de contrato escolhido para ${caso}, nem um modelo padrao, em Integracoes.`
      : 'Nao ha modelo de contrato padrao escolhido em Integracoes.';
  const comoResolver = `${motivo} Abra Integracoes > ZapSign, clique em "Escolher modelos automaticamente" (ou escolha o modelo na lista), salve, e peca o contrato de novo.`;

  /* Uma vez por conversa: o agente pode chamar a ferramenta a cada resposta, e a
     equipe nao precisa de um aviso por tentativa. */
  if (!contato.contratoSemModeloAvisadoEm) {
    atualizar('contatos', contato.id, { contratoSemModeloAvisadoEm: agora() });
    contato.contratoSemModeloAvisadoEm = agora();
    inserirNota(contato, `O contrato nao pode ser gerado: ${comoResolver} O cliente foi avisado de que uma pessoa do escritorio envia o contrato.`, quem);
    avisarEquipe(contato, 'Contrato sem modelo', `${contato.nome}: ${motivo} Enviem o contrato na mao ou configurem em Integracoes.`);
    registrarLog(workspaceId, contato.id, 'contrato', `Contrato nao gerado: ${motivo}`, quem);
  }

  /* Quem resolve e um administrador, e o problema trava TODOS os contratos: avisa uma vez por dia. */
  const dia = agora().slice(0, 10);
  const chaveDoDia = `${workspaceId}:${dia}`;
  for (const antiga of avisadoSemModeloNoDia.keys()) if (!antiga.endsWith(dia)) avisadoSemModeloNoDia.delete(antiga);
  if (!avisadoSemModeloNoDia.has(chaveDoDia)) {
    avisadoSemModeloNoDia.set(chaveDoDia, true);
    avisarAdministradores(workspaceId, {
      titulo: 'Os agentes nao conseguem mandar contrato',
      texto: `${motivo} Enquanto isso, nenhum contrato sai pela IA. Abra Integracoes > ZapSign e clique em "Escolher modelos automaticamente"; confira e salve. Este aviso vem uma vez por dia.`,
      tipo: 'contrato',
      contatoId: contato.id,
    });
  }

  return {
    ok: false,
    situacao: 'sem_modelo',
    erro: comoResolver,
    instrucao: 'O contrato ainda nao esta configurado no sistema. NAO peca mais dados ao cliente e NAO prometa o link na hora. Diga que uma pessoa do escritorio envia o contrato e a procuracao por esta conversa em seguida.',
  };
}

/**
 * Passo 1: pede o contrato. Nunca manda nada para a ZapSign.
 *
 * Contrato ja com a equipe nao duplica; contrato com link enviado so reenvia o
 * link. Dado faltando volta como `faltando`, para o agente coletar.
 */
export async function pedirContrato({ contato, agente = null, conexao = null, dados = {}, autor = null }) {
  const workspaceId = contato.workspaceId;
  const cfg = configuracao(workspaceId);
  const quem = autor || (agente ? { tipo: 'agente', id: agente.id, nome: agente.nome } : { tipo: 'sistema', nome: 'Sistema' });
  const saida = conexao || achar('conexoes', contato.conexaoId);

  /* O que o agente mandou junto entra nas variaveis antes de montar. */
  const novas = {};
  if (dados.nome_completo) novas.nome_completo = String(dados.nome_completo).trim();
  if (dados.cpf) novas.cpf = String(dados.cpf).replace(/\D/g, '');
  if (dados.email) novas.email = String(dados.email).trim();
  /* O resto que o modelo pede (RG, endereco...), na chave em que o contrato o le. */
  for (const [campo, valor] of Object.entries(dados.outros && typeof dados.outros === 'object' ? dados.outros : {})) {
    const chave = chaveDoCampo(campo);
    if (chave && String(valor ?? '').trim()) novas[chave] = String(valor).trim();
  }
  if (Object.keys(novas).length) {
    const variaveis = { ...(contato.variaveis || {}), ...novas };
    atualizar('contatos', contato.id, { variaveis });
    contato.variaveis = variaveis;
  }

  const aberto = contratoAbertoDe(contato.id);
  if (aberto?.situacao === 'em_conferencia') {
    return {
      ok: true,
      contrato_id: aberto.id,
      situacao: 'em_conferencia',
      instrucao: 'O contrato já está com a equipe para conferência. Diga ao cliente que o link chega por esta conversa em seguida.',
    };
  }
  if (aberto) {
    const envio = await enviarLink(aberto, contato, saida, quem, { reenvio: true });
    if (!envio.entregue) {
      avisarEquipe(contato, 'Reenvio do link falhou', `${contato.nome}: o reenvio do link do contrato falhou pelo WhatsApp${envio.erro ? ` (${envio.erro})` : ''}. Mande o link a mao: ${aberto.link}`);
      return {
        ok: true,
        contrato_id: aberto.id,
        situacao: aberto.situacao,
        reenviado: false,
        instrucao: 'O reenvio do link falhou agora (instabilidade no envio). NAO diga que ja foi mandado. Avise o cliente que houve um problema tecnico e que a equipe vai reenviar o link em instantes.',
      };
    }
    return { ok: true, contrato_id: aberto.id, situacao: aberto.situacao, reenviado: true };
  }

  /*
   * Envio direto: o contrato e a procuracao vao para a ZapSign na hora, sem
   * uma pessoa conferir. Pedido do escritorio em 29/10/2026 ("os agentes ...
   * elaborando procuracao e contrato e enviando para o ZapSign"), que trocou a
   * regra antiga de a IA nunca mandar contrato sozinha. Liga e desliga em
   * Integracoes; ligado e o padrao. Sem ninguem para preencher na conferencia
   * o que ficou em branco, o agente coleta TUDO antes, e nao so nome e CPF.
   */
  const direto = cfg.envioDireto !== false;
  const modelo = modeloDaConversa(cfg, contato);

  /*
   * Sem modelo, nao ha contrato para gerar: nem o agente nem a equipe conseguem
   * mandar. Ate 05/11/2026 isto so aparecia no FIM: o agente pedia ao cliente os
   * sete dados do modelo-padrao, o cliente respondia, e so entao o envio falhava
   * ("Escolha o modelo de contrato em Integracoes"). Em producao as chaves da
   * ZapSign e os 12 modelos estavam la, nenhum modelo escolhido, e nenhum contrato
   * foi pedido nunca. Agora a falta aparece na PRIMEIRA chamada: o agente nao pede
   * mais nada ao cliente nem promete o link na hora, a equipe e avisada na conversa
   * e os administradores no sino, com o que fazer.
   */
  if (!modelo.contratoId) return semModeloDeContrato({ contato, cfg, modelo, quem });

  const { valores, faltando, emBranco, paraColetar } = montarValores(cfg, modelo, contato);
  if (direto && paraColetar.length) {
    return {
      ok: false,
      faltando: paraColetar,
      erro: `Antes do contrato, colete com o cliente: ${paraColetar.join(', ')}. Depois chame gerar_contrato de novo, mandando cada dado em "outros" com exatamente estas chaves.`,
    };
  }
  if (faltando.length) {
    return { ok: false, faltando, erro: `Antes do contrato, colete com o cliente: ${faltando.join(', ')}.` };
  }

  const contrato = inserir('contratos', {
    id: novoId('ctr'),
    workspaceId,
    contatoId: contato.id,
    agenteId: agente?.id || null,
    caso: modelo.caso,
    modelo,
    valores,
    situacao: 'em_conferencia',
    provedor: 'zapsign',
    pedidoPor: quem,
    pedidoEm: agora(),
  });

  /* Assinatura pendente e o status desta etapa; o momento diz em que ponto. */
  const status = listar('status', { workspaceId }).find((s) => normalizar(s.nome) === 'assinatura pendente');
  if (status && contato.statusId !== status.id) await aplicarStatus(contato, status, quem);

  if (direto) {
    const enviado = await aprovarContrato(contrato.id, { autor: quem, direto: true });
    if (enviado.ok && enviado.entregue) {
      inserirNota(
        contato,
        `Contrato e procuração gerados${agente ? ` por ${agente.nome}` : ''} e enviados para assinatura, sem conferência (envio direto, em Integrações).${enviado.aviso ? ` ${enviado.aviso}` : ''}`,
        quem,
      );
      avisarEquipe(contato, 'Contrato enviado', `${contato.nome}: contrato e procuração enviados para assinar.`);
      return {
        ok: true,
        contrato_id: contrato.id,
        situacao: 'link_enviado',
        instrucao: 'O link do contrato e da procuração já foi enviado nesta conversa, com o vídeo de como assinar. Peça ao cliente para abrir, conferir os dados e assinar. Não repita o link.',
      };
    }
    if (enviado.ok && !enviado.entregue) {
      /* O documento existe na ZapSign, mas a mensagem com o link falhou ao
         sair — aprovarContrato ja avisou a equipe. O agente nao pode
         prometer algo que o cliente nao recebeu. */
      inserirNota(contato, `Contrato e procuração gerados${agente ? ` por ${agente.nome}` : ''}, mas a mensagem com o link falhou ao enviar pelo WhatsApp.`, quem);
      return {
        ok: true,
        contrato_id: contrato.id,
        situacao: 'link_enviado',
        instrucao: 'O contrato foi gerado, mas a mensagem com o link NAO chegou ao cliente agora (uma instabilidade no envio). Nao diga que ja foi enviado. Avise o cliente que houve um problema tecnico e que o link chega em instantes — a equipe ja foi avisada e vai reenviar.',
      };
    }
    /* A ZapSign recusou (chave, modelo, plano sem API): o contrato fica com a
       equipe, com o motivo, em vez de o cliente ficar sem nada. */
    definirMomento(contato, 'Contrato em conferencia', quem);
    inserirNota(contato, `O envio direto do contrato falhou: ${enviado.erro} O contrato ficou para a equipe conferir e enviar.`, quem);
    avisarEquipe(contato, 'Contrato para conferir', `${contato.nome}: o envio direto falhou (${enviado.erro}). Confira e envie o link.`);
    registrarLog(workspaceId, contato.id, 'contrato', `Envio direto falhou (${enviado.erro}); contrato aguardando conferencia`, quem);
    emitir(workspaceId, 'contrato', { contatoId: contato.id, contratoId: contrato.id });
    return {
      ok: true,
      contrato_id: contrato.id,
      situacao: 'em_conferencia',
      instrucao: 'Diga ao cliente que uma pessoa do escritório confere o contrato e a procuração, e que o link para assinar chega por esta conversa.',
    };
  }

  definirMomento(contato, 'Contrato em conferencia', quem);

  inserirNota(
    contato,
    `Contrato pedido${agente ? ` por ${agente.nome}` : ''}. Confira os dados no cartão do contrato antes de enviar o link.${emBranco.length ? ` Em branco para preencher: ${emBranco.join(', ')}.` : ''}`,
    quem,
  );
  avisarEquipe(contato, 'Contrato para conferir', `${contato.nome}: confira os dados do contrato e envie o link.`);
  registrarLog(workspaceId, contato.id, 'contrato', 'Contrato pedido; aguardando conferencia da equipe', quem);
  emitir(workspaceId, 'contrato', { contatoId: contato.id, contratoId: contrato.id });

  return {
    ok: true,
    contrato_id: contrato.id,
    situacao: 'em_conferencia',
    instrucao: 'Diga ao cliente que uma pessoa do escritório confere o contrato e a procuração, e que o link para assinar chega por esta conversa.',
  };
}

/**
 * Manda a mensagem com o link (e o video, quando ha).
 *
 * Achado em 09/11/2026: `enviarMensagem` NUNCA lanca excecao — uma falha de
 * envio (WhatsApp fora do ar, tempo esgotado) vira uma mensagem com
 * `situacao: 'erro'` na propria conversa, e a funcao devolve normalmente.
 * Esta funcao ignorava esse retorno: o contrato ficava marcado "link_enviado"
 * e a equipe nunca sabia que a mensagem com o link, a UNICA forma de o
 * cliente assinar, nunca saiu. Devolve agora se entregou de verdade, para
 * quem chama decidir o que fazer com isso.
 */
async function enviarLink(contrato, contato, conexao, autor, { reenvio = false } = {}) {
  const cfg = configuracao(contato.workspaceId);
  const primeiro = String(contato.variaveis?.nome_completo || contato.nome || '').split(' ')[0];
  const mensagem = await enviarMensagem({
    contato,
    conexao,
    conteudo: `${reenvio ? 'Aqui está de novo' : 'Pronto'}, ${primeiro}! O contrato e a procuração estão prontos para assinar:\n\n${contrato.link}\n\nÉ só abrir, conferir os dados e assinar na tela do celular. Leva menos de 2 minutos.`,
    autor,
  });
  const video = cfg.videoTutorial;
  if (video?.url && !reenvio) {
    await enviarMensagem({
      contato,
      conexao,
      tipo: video.tipo || 'video',
      conteudo: 'Este vídeo mostra o passo a passo da assinatura.',
      midia: video,
      autor,
    });
  }
  /* O video e so apoio; a mensagem com o link e a que importa de verdade. */
  return { entregue: mensagem.situacao !== 'erro', erro: mensagem.erro?.mensagem || null };
}

/**
 * Passo 2: a pessoa conferiu. Cria o documento na ZapSign, poe a procuracao,
 * manda o link e o video. `valores` traz as correcoes feitas no cartao. Com o
 * envio direto (`direto`), quem chama e o proprio pedido, sem pessoa no meio.
 */
export async function aprovarContrato(contratoId, { valores: corrigidos = {}, autor, direto = false } = {}) {
  const contrato = achar('contratos', contratoId);
  if (!contrato) return { ok: false, erro: 'Contrato nao encontrado.' };
  if (contrato.situacao !== 'em_conferencia') return { ok: false, erro: 'Este contrato nao esta aguardando conferencia.' };

  const cfg = configuracao(contrato.workspaceId);
  if (!cfg.chave) return { ok: false, erro: 'Configure a chave da ZapSign em Integracoes antes de enviar.' };
  if (!contrato.modelo?.contratoId) return { ok: false, erro: 'Escolha o modelo de contrato em Integracoes antes de enviar.' };

  /*
   * O teto de casos em aberto (nucleo/teto-de-casos.js), pedido do escritorio
   * em 11/11/2026 para ninguem acumular caso e fechar contrato atras de meta.
   *
   * Aqui e o lugar: este e o passo em que uma PESSOA fecha. O envio direto
   * (`direto`) nao passa por aqui com membro nenhum — nele quem manda e a IA,
   * e nao ha pessoa para quem contar meta. Sem teto configurado, conferirTeto
   * libera, e nada muda para quem nunca ligou isso.
   */
  if (!direto && autor?.tipo === 'membro' && autor?.id) {
    const limite = conferirTeto(contrato.workspaceId, autor.id);
    if (!limite.pode) {
      avisarAdministradores(contrato.workspaceId, {
        titulo: 'Fechamento barrado pelo limite de casos',
        texto: `${autor.nome || 'Um membro'} tentou aprovar um contrato com ${limite.abertos} casos em aberto (limite ${limite.teto}).`,
        tipo: 'contrato',
        contatoId: contrato.contatoId,
      });
      return { ok: false, erro: motivoDoBloqueio(limite), codigo: 409 };
    }
  }

  const contato = achar('contatos', contrato.contatoId);
  if (!contato) return { ok: false, erro: 'A conversa deste contrato nao existe mais.' };
  const conexao = achar('conexoes', contato.conexaoId);

  const valores = { ...contrato.valores };
  for (const [campo, valor] of Object.entries(corrigidos || {})) {
    if (campo in valores) valores[campo] = String(valor ?? '').trim();
  }
  const vazios = Object.entries(valores).filter(([, v]) => !String(v).trim()).map(([campo]) => chaveDoCampo(campo));
  if (vazios.length) return { ok: false, erro: `Preencha antes de enviar: ${vazios.join(', ')}.` };

  const campoDe = (alvo) => Object.keys(valores).find((campo) => (APELIDOS[chaveDoCampo(campo)] || chaveDoCampo(campo)) === alvo);
  const nome = valores[campoDe('nome_completo')] || contato.variaveis?.nome_completo || contato.nome;
  const email = valores[campoDe('email')] || contato.variaveis?.email || '';
  const data = Object.entries(valores).map(([campo, para]) => ({
    de: campo.includes('{{') ? campo : `{{${campo}}}`,
    para: String(para),
  }));

  let documento;
  try {
    const resposta = await fetch(`${BASE}/models/create-doc/`, {
      method: 'POST',
      headers: cabecalhos(cfg),
      body: JSON.stringify({
        template_id: contrato.modelo.contratoId,
        signer_name: nome,
        signer_email: email || undefined,
        signer_phone_country: '55',
        signer_phone_number: String(contato.telefone || '').replace(/^55/, ''),
        send_automatic_email: false,
        send_automatic_whatsapp: false,
        lang: 'pt-br',
        external_id: contrato.id,
        data,
      }),
    });
    documento = await resposta.json().catch(() => ({}));
    if (!resposta.ok) {
      const erro = erroDaZapsign(resposta.status, documento);
      atualizar('contratos', contrato.id, { erro });
      return { ok: false, erro };
    }
  } catch (erro) {
    atualizar('contratos', contrato.id, { erro: erro.message });
    return { ok: false, erro: `Nao consegui falar com a ZapSign: ${erro.message}` };
  }

  const token = documento?.token;
  const link = documento?.signers?.[0]?.sign_url || null;
  let aviso = null;

  /* Contrato que ja traz a procuracao anexada gera os dois juntos: mandar a
     procuracao de novo a duplicaria no envelope. */
  if (contrato.modelo.procuracaoId && token && !trazProcuracao(cfg, contrato.modelo.contratoId)) {
    const extra = await fetch(`${BASE}/models/${encodeURIComponent(token)}/upload-extra-doc/`, {
      method: 'POST',
      headers: cabecalhos(cfg),
      body: JSON.stringify({ template_id: contrato.modelo.procuracaoId, data }),
    }).catch((erro) => ({ ok: false, status: 0, erro }));
    /* O contrato ja existe la; nao da para desfazer. A equipe fica sabendo que
       a procuracao nao entrou e resolve na propria ZapSign. */
    if (!extra.ok) aviso = 'O contrato foi criado, mas a procuracao nao entrou no envelope. Confira na ZapSign.';
  }

  let atualizado = atualizar('contratos', contrato.id, {
    situacao: 'link_enviado',
    valores,
    tokenExterno: token,
    signerToken: documento?.signers?.[0]?.token || null,
    link,
    aprovadoPor: autor || null,
    aprovadoEm: agora(),
    erro: null,
    aviso,
    proximaConsultaEm: new Date(Date.now() + ESPERA_CURTA).toISOString(),
  });

  const envio = await enviarLink(atualizado, contato, conexao, autor || { tipo: 'sistema', nome: 'Sistema' });
  /* Achado em 09/11/2026: o contrato nascia "link_enviado" mesmo quando a
     mensagem com o link falhava ao sair pelo WhatsApp — o cliente nunca via
     nada, e nada na tela de Contratos ou na equipe contava disso. Agora o
     aviso fica no proprio contrato (a mesma caixa que ja mostra "procuracao
     nao entrou") e a equipe e avisada, para reenviar pela conversa. */
  if (!envio.entregue) {
    const avisoDeEntrega = `O contrato foi criado na ZapSign, mas a mensagem com o link falhou ao enviar pelo WhatsApp${envio.erro ? ` (${envio.erro})` : ''}. O cliente ainda não recebeu o link.`;
    aviso = [aviso, avisoDeEntrega].filter(Boolean).join(' ');
    atualizado = atualizar('contratos', contrato.id, { aviso });
    avisarEquipe(contato, 'Contrato nao chegou ao cliente', `${contato.nome}: ${avisoDeEntrega} Peca para o agente ou a equipe mandar o link de novo pela conversa.`);
  }

  /* Webhook por documento, so quando houver endereco publico configurado. O
     webhook geral da conta e do escritorio, e nao e mexido daqui. */
  if (cfg.urlWebhook && cfg.segredoWebhook && token) {
    fetch(`${BASE}/user/company/webhook/`, {
      method: 'POST',
      headers: cabecalhos(cfg),
      body: JSON.stringify({
        url: cfg.urlWebhook,
        type: 'doc_signed',
        doc_token: token,
        headers: [{ name: 'x-correia-segredo', value: cfg.segredoWebhook }],
      }),
    }).catch(() => {});
  }

  definirMomento(contato, 'Link enviado', autor);
  registrarLog(
    contrato.workspaceId,
    contato.id,
    'contrato',
    `${direto ? 'Contrato enviado direto, sem conferencia' : 'Contrato conferido e link enviado'}${envio.entregue ? '' : ' (a mensagem com o link falhou)'}`,
    autor,
  );
  if (!envio.entregue) {
    /* Nada de dar "procuracao nao entrou" duas vezes: so avisa dela aqui
       quando a mensagem do link saiu certo (senao o aviso de entrega acima
       ja cobre os dois problemas juntos). */
  } else if (aviso) {
    avisarEquipe(contato, 'Procuracao nao entrou', `${contato.nome}: ${aviso}`);
  }
  emitir(contrato.workspaceId, 'contrato', { contatoId: contato.id, contratoId: contrato.id });
  return { ok: true, link, aviso, entregue: envio.entregue };
}

/** A pessoa achou algo errado: volta ao agente com o que corrigir. */
export async function devolverContrato(contratoId, { motivo, autor } = {}) {
  const contrato = achar('contratos', contratoId);
  if (!contrato) return { ok: false, erro: 'Contrato nao encontrado.' };
  if (contrato.situacao !== 'em_conferencia') return { ok: false, erro: 'Este contrato nao esta aguardando conferencia.' };
  const texto = String(motivo || '').trim();
  if (!texto) return { ok: false, erro: 'Diga o que precisa ser corrigido.' };

  const contato = achar('contatos', contrato.contatoId);
  atualizar('contratos', contrato.id, { situacao: 'devolvido', devolvidoPor: autor || null, devolvidoEm: agora(), motivoDevolucao: texto });
  if (!contato) return { ok: true };

  /* O agente nao le nota; le a passagem. A devolucao chega a ele por ali. */
  const responsavel = contato.responsavel;
  const passagens = [
    ...(contato.passagens || []),
    {
      deId: null,
      deNome: 'Conferencia do contrato',
      paraId: responsavel?.id || null,
      paraNome: responsavel?.nome || null,
      paraTipo: responsavel?.tipo || null,
      resumo: `A equipe devolveu o contrato para correcao: ${texto}. Corrija com o cliente e peca o contrato de novo.`,
      em: agora(),
    },
  ].slice(-10);
  atualizar('contatos', contato.id, { passagens });
  contato.passagens = passagens;

  definirMomento(contato, '', autor);
  inserirNota(contato, `Contrato devolvido para correcao: ${texto}`, autor || { tipo: 'sistema', nome: 'Sistema' });
  registrarLog(contrato.workspaceId, contato.id, 'contrato', `Contrato devolvido: ${texto}`, autor);

  if (responsavel?.tipo === 'agente' && contato.estado === 'ia') {
    const { agendarResposta } = await import('../ia/motor.js');
    agendarResposta(contato);
  }
  emitir(contrato.workspaceId, 'contrato', { contatoId: contato.id, contratoId: contrato.id });
  return { ok: true };
}

/** Quando consultar de novo, pela idade do link. */
export function proximaConsulta(contrato) {
  const idade = Date.now() - Date.parse(contrato.aprovadoEm || contrato.criadoEm || agora());
  const espera = idade < 2 * 3600000 ? ESPERA_CURTA : idade < 48 * 3600000 ? ESPERA_MEDIA : ESPERA_LONGA;
  return new Date(Date.now() + espera).toISOString();
}

/* Duas consultas do mesmo documento ao mesmo tempo (o laco e o webhook)
   baixariam o PDF duas vezes. */
const consultando = new Set();

/** Passo 3: pergunta a ZapSign como esta o documento e age conforme. */
export async function consultarDocumento(contratoId) {
  if (consultando.has(contratoId)) return { ok: true, emAndamento: true };
  consultando.add(contratoId);
  try {
    const contrato = achar('contratos', contratoId);
    if (!contrato) return { ok: false, erro: 'Contrato nao encontrado.' };
    if (contrato.situacao === 'assinado') return { ok: true, situacao: 'assinado' };
    if (!contrato.tokenExterno) return { ok: false, erro: 'Este contrato ainda nao foi enviado para assinatura.' };

    const cfg = configuracao(contrato.workspaceId);
    if (!cfg.chave) return { ok: false, erro: 'Chave da ZapSign nao configurada.' };

    const resposta = await fetch(`${BASE}/docs/${encodeURIComponent(contrato.tokenExterno)}/`, { headers: cabecalhos(cfg) });
    const documento = await resposta.json().catch(() => ({}));
    if (!resposta.ok) {
      const erro = erroDaZapsign(resposta.status, documento);
      atualizar('contratos', contrato.id, { erroConsulta: erro, ultimaConsultaEm: agora(), proximaConsultaEm: proximaConsulta(contrato) });
      return { ok: false, erro };
    }

    const contato = achar('contatos', contrato.contatoId);
    const sistema = { tipo: 'sistema', nome: 'ZapSign' };
    const signatario = documento.signers?.[0] || {};

    if (documento.status === 'signed') {
      const guardados = await guardarAssinados(contrato, contato, documento);
      if (!guardados.ok) {
        /* O endereco do PDF expira; sem o arquivo o caso nao segue para o Juri.
           Tenta de novo na proxima volta, que busca um endereco novo. */
        atualizar('contratos', contrato.id, { erroArquivo: guardados.erro, ultimaConsultaEm: agora(), proximaConsultaEm: new Date(Date.now() + ESPERA_CURTA).toISOString() });
        return { ok: false, erro: guardados.erro };
      }
      await confirmarAssinatura(contrato.id);
      return { ok: true, situacao: 'assinado' };
    }

    const recusou = ['refused', 'rejected'].includes(documento.status) || signatario.status === 'refused';
    const venceu = ['expired'].includes(documento.status);
    const cancelado = ['deleted', 'canceled', 'cancelled'].includes(documento.status);
    if (recusou || venceu || cancelado) {
      const situacao = venceu ? 'expirado' : cancelado ? 'cancelado' : 'recusado';
      if (contrato.situacao !== situacao) {
        atualizar('contratos', contrato.id, { situacao, ultimaConsultaEm: agora() });
        if (contato) {
          definirMomento(contato, venceu ? 'Expirado' : 'Recusado', sistema);
          const rotulo = venceu ? 'O prazo para assinar venceu' : cancelado ? 'O documento foi cancelado na ZapSign' : 'O cliente recusou a assinatura';
          inserirNota(contato, `${rotulo}.`, sistema);
          avisarEquipe(contato, rotulo, `${contato.nome}: ${rotulo.toLowerCase()}.`);
          registrarLog(contrato.workspaceId, contato.id, 'contrato', rotulo, sistema);
        }
      }
      return { ok: true, situacao };
    }

    const mudancas = { ultimaConsultaEm: agora(), proximaConsultaEm: proximaConsulta(contrato), erroConsulta: null };
    if (signatario.status === 'link-opened' && contrato.situacao === 'link_enviado') {
      mudancas.situacao = 'link_aberto';
      mudancas.linkAbertoEm = agora();
      if (contato) {
        definirMomento(contato, 'Link aberto', sistema);
        registrarLog(contrato.workspaceId, contato.id, 'contrato', 'O cliente abriu o link do contrato', sistema);
      }
    }
    atualizar('contratos', contrato.id, mudancas);
    if (mudancas.situacao && contato) emitir(contrato.workspaceId, 'contrato', { contatoId: contato.id, contratoId });
    return { ok: true, situacao: mudancas.situacao || contrato.situacao };
  } finally {
    consultando.delete(contratoId);
  }
}

/** Baixa o contrato e a procuracao assinados para a nuvem da conversa. */
async function guardarAssinados(contrato, contato, documento) {
  if (contrato.arquivosAssinados?.length) return { ok: true };
  if (!contato) return { ok: true };

  const pedidos = [
    { url: documento.signed_file, nome: `Contrato assinado - ${contato.nome}.pdf`, tipo: 'contrato' },
    ...(documento.extra_docs || []).map((extra, indice) => ({
      url: extra.signed_file,
      nome: `Procuracao assinada${indice ? ` ${indice + 1}` : ''} - ${contato.nome}.pdf`,
      tipo: 'procuracao',
    })),
  ].filter((p) => p.url);
  if (!pedidos.length) return { ok: false, erro: 'A ZapSign disse que esta assinado, mas nao mandou o PDF.' };

  const pasta = path.join(PASTA_ARQUIVOS, contato.id);
  garantirPasta(pasta);
  const novos = [];
  try {
    for (const pedido of pedidos) {
      const resposta = await fetch(pedido.url);
      if (!resposta.ok) throw new Error(`o PDF respondeu ${resposta.status}`);
      const dados = Buffer.from(await resposta.arrayBuffer());
      const nomeSeguro = `${novoId('arq')}-${pedido.nome.replace(/[^\w.-]+/g, '_')}`;
      fs.writeFileSync(path.join(pasta, nomeSeguro), dados);
      novos.push({
        id: novoId('arq'),
        nome: pedido.nome,
        caminho: `${contato.id}/${nomeSeguro}`,
        tamanho: dados.length,
        tipo: pedido.tipo,
        enviadoPor: 'ZapSign',
        criadoEm: agora(),
      });
    }
  } catch (erro) {
    return { ok: false, erro: `Nao consegui baixar o documento assinado: ${erro.message}` };
  }

  const atual = achar('contatos', contato.id);
  atualizar('contatos', contato.id, { arquivos: [...(atual?.arquivos || []), ...novos] });
  atualizar('contratos', contrato.id, { arquivosAssinados: novos.map((a) => a.id), erroArquivo: null });
  registrarLog(contrato.workspaceId, contato.id, 'arquivo', 'Contrato e procuracao assinados guardados na conversa');
  return { ok: true };
}

/**
 * Assinado: status, responsavel e mensagem configurados para depois da
 * assinatura, momento, aviso, e o evento contrato_assinado — UMA vez.
 */
export async function confirmarAssinatura(contratoId) {
  const contrato = achar('contratos', contratoId);
  if (!contrato) return { ok: false, erro: 'Contrato nao encontrado.' };
  if (contrato.situacao === 'assinado') return { ok: true, jaAssinado: true };

  const contato = achar('contatos', contrato.contatoId);
  if (!contato) return { ok: false, erro: 'Conversa do contrato nao encontrada.' };

  const cfg = configuracao(contrato.workspaceId);
  const posAssinatura = cfg.posAssinatura || {};
  const sistema = { tipo: 'sistema', nome: 'ZapSign' };

  atualizar('contratos', contratoId, { situacao: 'assinado', assinadoEm: agora() });

  /* Sem status configurado, vale o "Contrato assinado" do funil, se existir. */
  const status = posAssinatura.statusId
    ? achar('status', posAssinatura.statusId)
    : listar('status', { workspaceId: contrato.workspaceId }).find((s) => normalizar(s.nome) === 'contrato fechado');
  if (status) await aplicarStatus(contato, status, sistema);
  definirMomento(contato, 'Aguardando pos-venda', sistema);

  const mudancas = {};
  if (posAssinatura.responsavel) {
    mudancas.responsavel = posAssinatura.responsavel;
    mudancas.estado = posAssinatura.responsavel.tipo === 'agente' ? 'ia' : 'pendente';
  }
  if (posAssinatura.departamentoId) mudancas.departamentoId = posAssinatura.departamentoId;
  if (Object.keys(mudancas).length) atualizar('contatos', contato.id, mudancas);

  if (posAssinatura.templateId) {
    const template = achar('templates', posAssinatura.templateId);
    const conexao = achar('conexoes', contato.conexaoId);
    if (template) {
      const { aplicarVariaveis } = await import('../nucleo/util.js');
      await enviarMensagem({
        contato,
        conexao,
        conteudo: aplicarVariaveis(template.conteudo, { nome: contato.nome, ...(contato.variaveis || {}) }),
        midia: template.midia,
        templateId: template.id,
        autor: { tipo: 'sistema', nome: 'Sistema' },
      });
    }
  }

  registrarLog(contrato.workspaceId, contato.id, 'contrato', `Contrato assinado (${quemFechou(contrato)})`, sistema);
  /*
   * O aviso do contrato fechado leva a atribuicao e abre a FICHA do cliente,
   * e nao mais a conversa. Pedido do escritorio em 11/11/2026: antes saia
   * "Fulano assinou o contrato" e ponto — quem recebia tinha que abrir a
   * conversa, cacar o CPF nas variaveis, descer ate os arquivos e conferir na
   * mao quem tinha conduzido. Agora a linha ja diz quem fechou, e o clique cai
   * na ficha com todos os dados e os documentos (nucleo/ficha-do-contrato.js).
   */
  const resumoDeQuemFechou = quemFechou(contrato);
  for (const membro of listar('membros', { workspaceId: contrato.workspaceId })) {
    notificar(
      contrato.workspaceId,
      membro.id,
      'contrato',
      'Contrato fechado',
      `${contato.nome} assinou o contrato — ${resumoDeQuemFechou}. Abra para ver a ficha com os dados e os documentos.`,
      contato.id,
      { contratoId },
    );
  }
  emitir(contrato.workspaceId, 'contrato', { contatoId: contato.id, contratoId, situacao: 'assinado' });

  /* Assinado, o atendimento terminou de verdade: e a hora de pedir a
     avaliacao. Pedido do escritorio em 29/10/2026, quando ela saia ao clicar
     em Concluir — no meio do atendimento. */
  pedirAvaliacao(contato.id, { tipo: 'sistema', nome: 'Contrato assinado' });

  await disparar('contrato_assinado', { workspaceId: contrato.workspaceId, contatoId: contato.id, contratoId });
  return { ok: true };
}
