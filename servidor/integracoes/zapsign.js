import fs from 'node:fs';
import path from 'node:path';
import { PASTA_ARQUIVOS } from '../config.js';
import { achar, atualizar, inserir, listar, registrarLog } from '../nucleo/banco.js';
import { membrosQuePodemVer } from '../nucleo/auth.js';
import { definirMomento, tipoDeCasoDa } from '../nucleo/casos.js';
import { contratoAbertoDe } from '../nucleo/contratos.js';
import { emitir } from '../nucleo/eventos.js';
import { disparar } from '../nucleo/ganchos.js';
import { agora, formatarTelefone, garantirPasta, normalizar, novoId } from '../nucleo/util.js';
import { enviarMensagem } from '../whatsapp/envio.js';
import { aplicarStatus } from '../automacao/followup.js';
import { inserirNota, notificar } from '../ia/mencoes.js';

/**
 * Contrato e procuracao pela ZapSign, com uma pessoa conferindo antes.
 *
 * O caminho:
 *   1. o agente (ou alguem da equipe) PEDE o contrato. Nada vai para a ZapSign:
 *      o contrato fica "em conferencia" com os valores que vao preencher o
 *      modelo, e a equipe e avisada. E a regra do escritorio: IA nao manda
 *      contrato nem procuracao sozinha.
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

  const resposta = await fetch(`${BASE}/models/`, { headers: cabecalhos(cfg) });
  if (!resposta.ok) return { ok: false, erro: erroDaZapsign(resposta.status, await resposta.json().catch(() => ({}))) };

  const dados = await resposta.json().catch(() => []);
  const lista = Array.isArray(dados) ? dados : dados?.results || [];
  const modelos = [];
  for (const m of lista) {
    const id = String(m.token || m.id);
    let entradas = m.inputs || m.variables || null;
    /* A lista da ZapSign nem sempre traz as variaveis; o detalhe do modelo traz. */
    if (!entradas) {
      const detalhe = await fetch(`${BASE}/models/${encodeURIComponent(id)}/`, { headers: cabecalhos(cfg) })
        .then((r) => (r.ok ? r.json() : null))
        .catch(() => null);
      entradas = detalhe?.inputs || detalhe?.variables || [];
    }
    modelos.push({
      id,
      nome: m.name || m.nome || 'Modelo sem nome',
      variaveis: entradas.map((v) => String(v.variable || v.name || v)).filter(Boolean),
    });
  }

  const integracoes = achar('integracoes', { workspaceId });
  atualizar('integracoes', integracoes.id, { zapsign: { ...cfg, modelos, ativo: true, sincronizadoEm: agora() } });
  return { ok: true, modelos };
}

/** "{{NOME COMPLETO}}" -> "nome_completo". */
const chaveDoCampo = (campo) =>
  normalizar(String(campo).replace(/[{}]/g, ''))
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '');

function valorDoCampo(campo, contato, cfg) {
  const chave = chaveDoCampo(campo);
  const destino = cfg.mapaVariaveis?.[campo] || cfg.mapaVariaveis?.[chave] || APELIDOS[chave] || chave;
  const variaveis = contato.variaveis || {};
  if (destino === 'nome_completo') return variaveis.nome_completo || contato.nome || '';
  if (destino === 'telefone') return formatarTelefone(contato.telefone);
  if (destino === 'data_hoje') return new Date().toLocaleDateString('pt-BR', { timeZone: 'America/Sao_Paulo' });
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

/** Os valores que vao preencher os modelos, e o que ainda falta. */
function montarValores(cfg, modelo, contato) {
  const doModelo = (id) => (cfg.modelos || []).find((m) => m.id === id)?.variaveis || [];
  const campos = [...new Set([...doModelo(modelo.contratoId), ...doModelo(modelo.procuracaoId)])];
  const valores = {};
  for (const campo of campos.length ? campos : CAMPOS_PADRAO) valores[campo] = valorDoCampo(campo, contato, cfg);
  const faltando = Object.entries(valores)
    .filter(([, valor]) => !String(valor).trim())
    .map(([campo]) => chaveDoCampo(campo));
  return { valores, faltando };
}

const avisarEquipe = (contato, titulo, texto) => {
  for (const membro of membrosQuePodemVer(contato.workspaceId, contato)) {
    notificar(contato.workspaceId, membro.id, 'contrato', titulo, texto, contato.id);
  }
};

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
      instrucao: 'O contrato ja esta com a equipe para conferencia. Diga ao cliente que o link chega por esta conversa em seguida.',
    };
  }
  if (aberto) {
    await enviarLink(aberto, contato, saida, quem, { reenvio: true });
    return { ok: true, contrato_id: aberto.id, situacao: aberto.situacao, reenviado: true };
  }

  const modelo = modeloDaConversa(cfg, contato);
  const { valores, faltando } = montarValores(cfg, modelo, contato);
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
  definirMomento(contato, 'Contrato em conferencia', quem);

  inserirNota(contato, `Contrato pedido${agente ? ` por ${agente.nome}` : ''}. Confira os dados no cartão do contrato antes de enviar o link.`, quem);
  avisarEquipe(contato, 'Contrato para conferir', `${contato.nome}: confira os dados do contrato e envie o link.`);
  registrarLog(workspaceId, contato.id, 'contrato', 'Contrato pedido; aguardando conferencia da equipe', quem);
  emitir(workspaceId, 'contrato', { contatoId: contato.id, contratoId: contrato.id });

  return {
    ok: true,
    contrato_id: contrato.id,
    situacao: 'em_conferencia',
    instrucao: 'Diga ao cliente que uma pessoa do escritorio confere o contrato e a procuracao, e que o link para assinar chega por esta conversa.',
  };
}

async function enviarLink(contrato, contato, conexao, autor, { reenvio = false } = {}) {
  const cfg = configuracao(contato.workspaceId);
  const primeiro = String(contato.variaveis?.nome_completo || contato.nome || '').split(' ')[0];
  await enviarMensagem({
    contato,
    conexao,
    conteudo: `${reenvio ? 'Aqui esta de novo' : 'Pronto'}, ${primeiro}! O contrato e a procuracao estao prontos para assinar:\n\n${contrato.link}\n\nE so abrir, conferir os dados e assinar na tela do celular. Leva menos de 2 minutos.`,
    autor,
  });
  const video = cfg.videoTutorial;
  if (video?.url && !reenvio) {
    await enviarMensagem({
      contato,
      conexao,
      tipo: video.tipo || 'video',
      conteudo: 'Este video mostra o passo a passo da assinatura.',
      midia: video,
      autor,
    });
  }
}

/**
 * Passo 2: a pessoa conferiu. Cria o documento na ZapSign, poe a procuracao,
 * manda o link e o video. `valores` traz as correcoes feitas no cartao.
 */
export async function aprovarContrato(contratoId, { valores: corrigidos = {}, autor } = {}) {
  const contrato = achar('contratos', contratoId);
  if (!contrato) return { ok: false, erro: 'Contrato nao encontrado.' };
  if (contrato.situacao !== 'em_conferencia') return { ok: false, erro: 'Este contrato nao esta aguardando conferencia.' };

  const cfg = configuracao(contrato.workspaceId);
  if (!cfg.chave) return { ok: false, erro: 'Configure a chave da ZapSign em Integracoes antes de enviar.' };
  if (!contrato.modelo?.contratoId) return { ok: false, erro: 'Escolha o modelo de contrato em Integracoes antes de enviar.' };

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

  if (contrato.modelo.procuracaoId && token) {
    const extra = await fetch(`${BASE}/models/${encodeURIComponent(token)}/upload-extra-doc/`, {
      method: 'POST',
      headers: cabecalhos(cfg),
      body: JSON.stringify({ template_id: contrato.modelo.procuracaoId, data }),
    }).catch((erro) => ({ ok: false, status: 0, erro }));
    /* O contrato ja existe la; nao da para desfazer. A equipe fica sabendo que
       a procuracao nao entrou e resolve na propria ZapSign. */
    if (!extra.ok) aviso = 'O contrato foi criado, mas a procuracao nao entrou no envelope. Confira na ZapSign.';
  }

  const atualizado = atualizar('contratos', contrato.id, {
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

  await enviarLink(atualizado, contato, conexao, autor || { tipo: 'sistema', nome: 'Sistema' });

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
  registrarLog(contrato.workspaceId, contato.id, 'contrato', 'Contrato conferido e link enviado', autor);
  if (aviso) avisarEquipe(contato, 'Procuracao nao entrou', `${contato.nome}: ${aviso}`);
  emitir(contrato.workspaceId, 'contrato', { contatoId: contato.id, contratoId: contrato.id });
  return { ok: true, link, aviso };
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
    : listar('status', { workspaceId: contrato.workspaceId }).find((s) => normalizar(s.nome) === 'contrato assinado');
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

  registrarLog(contrato.workspaceId, contato.id, 'contrato', 'Contrato assinado', sistema);
  for (const membro of listar('membros', { workspaceId: contrato.workspaceId })) {
    notificar(contrato.workspaceId, membro.id, 'contrato', 'Contrato assinado', `${contato.nome} assinou o contrato.`, contato.id);
  }
  emitir(contrato.workspaceId, 'contrato', { contatoId: contato.id, contratoId, situacao: 'assinado' });

  await disparar('contrato_assinado', { workspaceId: contrato.workspaceId, contatoId: contato.id, contratoId });
  return { ok: true };
}
