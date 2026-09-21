import crypto from 'node:crypto';
import fs from 'node:fs';
import { ENDERECO_PUBLICO } from '../../config.js';
import { achar, atualizar } from '../../nucleo/banco.js';
import { caminhoDaMidia, guardarBuffer } from '../../nucleo/midia.js';
import { erroDeJanela, janelaDaConversa, pedacosDeTexto } from '../canais.js';

/**
 * DM do TikTok, pela Business Messaging API do TikTok for Business.
 *
 * O que o TikTok exige, e que a tela de Conexoes explica passo a passo:
 *  - conta COMERCIAL do TikTok (Business Account), aceitando mensagem de todos;
 *  - um app no TikTok API for Business com a Business Messaging API aprovada;
 *  - endereco publico com HTTPS para o webhook e para o retorno do login.
 *
 * As regras que machucam, todas aqui:
 *  - JANELA DE 48 HORAS desde a ultima mensagem do cliente;
 *  - so o cliente comeca, e ate ele responder a empresa manda no maximo 10;
 *  - sai TEXTO e IMAGEM. Video, audio e PDF nao passam: vao como link, quando
 *    o sistema esta hospedado;
 *  - o token de acesso vence em cerca de um dia. Ele e renovado sozinho antes
 *    de cada chamada e por uma rodada periodica (renovarTokens, abaixo).
 *
 * O endereco da API e trocavel por CORREIA_TIKTOK_URL, que e por onde a suite
 * de testes fala com um TikTok de mentira.
 */

const base = () => (process.env.CORREIA_TIKTOK_URL || 'https://business-api.tiktok.com/open_api/v1.3').replace(/\/+$/, '');

/* O que o login do TikTok pede para a conta, na ordem da documentacao. */
export const ESCOPOS_TIKTOK = [
  'user.info.basic',
  'user.info.username',
  'user.info.profile',
  'user.account.type',
  'message.list.read',
  'message.list.send',
  'message.list.manage',
];

const margemDeRenovacao = 10 * 60 * 1000;

async function pedir(caminho, { metodo = 'GET', corpo = null, consulta = {}, token = null } = {}) {
  const url = new URL(`${base()}/${caminho.replace(/^\/+/, '')}`);
  for (const [chave, valor] of Object.entries(consulta)) url.searchParams.set(chave, valor);
  const resposta = await fetch(url, {
    method: metodo,
    headers: {
      Accept: 'application/json',
      ...(token ? { 'Access-Token': token } : {}),
      ...(corpo && !(corpo instanceof FormData) ? { 'Content-Type': 'application/json' } : {}),
    },
    body: corpo ? (corpo instanceof FormData ? corpo : JSON.stringify(corpo)) : undefined,
  });
  const dados = await resposta.json().catch(() => ({}));
  if (!resposta.ok || (dados.code !== undefined && dados.code !== 0)) {
    throw Object.assign(new Error(dados.message || `TikTok respondeu ${resposta.status}`), {
      codigoWhatsapp: String(dados.code ?? resposta.status),
    });
  }
  return dados.data || {};
}

/** Grava os tokens que o TikTok devolveu (login ou renovacao) na conexao. */
function guardarTokens(conexao, dados) {
  const agora = Date.now();
  const tiktok = {
    ...(achar('conexoes', conexao.id)?.tiktok || conexao.tiktok || {}),
    ...(dados.open_id ? { businessId: String(dados.open_id) } : {}),
    token: dados.access_token,
    tokenVenceEm: new Date(agora + Number(dados.expires_in || 86400) * 1000).toISOString(),
    renovacao: dados.refresh_token || conexao.tiktok?.renovacao || '',
    renovacaoVenceEm: dados.refresh_token_expires_in
      ? new Date(agora + Number(dados.refresh_token_expires_in) * 1000).toISOString()
      : conexao.tiktok?.renovacaoVenceEm || null,
  };
  atualizar('conexoes', conexao.id, { tiktok });
  conexao.tiktok = tiktok;
  return tiktok;
}

/** Troca o codigo do login do TikTok pelos tokens da conta. */
export async function concluirLoginTikTok(conexao, codigo, enderecoDeRetorno) {
  const cfg = conexao.tiktok || {};
  const dados = await pedir('tt_user/oauth2/token/', {
    metodo: 'POST',
    corpo: {
      client_id: cfg.appId,
      client_secret: cfg.appSecret,
      grant_type: 'authorization_code',
      auth_code: codigo,
      redirect_uri: enderecoDeRetorno,
    },
  });
  return guardarTokens(conexao, dados);
}

/** Renova o token se ele vence nos proximos minutos (ou se `forcar`). */
export async function renovarTokenTikTok(conexao, { forcar = false } = {}) {
  const cfg = conexao.tiktok || {};
  const vence = Date.parse(cfg.tokenVenceEm || '');
  const precisa = forcar || !Number.isFinite(vence) || vence - Date.now() < margemDeRenovacao;
  if (!precisa || !cfg.renovacao || !cfg.appId || !cfg.appSecret) return cfg;
  const dados = await pedir('tt_user/oauth2/refresh_token/', {
    metodo: 'POST',
    corpo: {
      client_id: cfg.appId,
      client_secret: cfg.appSecret,
      grant_type: 'refresh_token',
      refresh_token: cfg.renovacao,
    },
  });
  return guardarTokens(conexao, dados);
}

async function credenciais(conexao) {
  const cfg = await renovarTokenTikTok(conexao);
  if (!cfg.token || !cfg.businessId) {
    throw Object.assign(new Error('Conexao do TikTok sem login. Entre com a conta comercial em Conexoes.'), {
      codigoWhatsapp: 'tiktok_sem_credencial',
    });
  }
  return cfg;
}

/** Cadastra no TikTok o endereco que recebe as mensagens (um por app). */
export async function registrarWebhookTikTok(conexao, enderecoDoWebhook) {
  const cfg = conexao.tiktok || {};
  if (!cfg.appId || !cfg.appSecret) throw new Error('Preencha o App ID e a chave secreta do app do TikTok.');
  await pedir('business/webhook/update/', {
    metodo: 'POST',
    corpo: { app_id: cfg.appId, secret: cfg.appSecret, event_type: 'DIRECT_MESSAGE', callback_url: enderecoDoWebhook },
  });
  return { ok: true, endereco: enderecoDoWebhook };
}

async function enviarBruto(cfg, conversa, carga) {
  const dados = await pedir('business/message/send/', {
    metodo: 'POST',
    token: cfg.token,
    corpo: { business_id: cfg.businessId, recipient_type: 'CONVERSATION', recipient: conversa, ...carga },
  });
  return dados?.message?.message_id || null;
}

/** Sobe a imagem para o TikTok e devolve o id que a mensagem referencia. */
async function subirImagem(cfg, midia) {
  const caminho = caminhoDaMidia(midia.url);
  if (!caminho) return null;
  const formulario = new FormData();
  formulario.append('business_id', cfg.businessId);
  formulario.append('media_type', 'IMAGE');
  formulario.append('file', new Blob([fs.readFileSync(caminho)], { type: midia.mime || 'image/jpeg' }), midia.nome || 'imagem.jpg');
  const dados = await pedir('business/message/media/upload/', { metodo: 'POST', token: cfg.token, corpo: formulario });
  return dados.media_id || null;
}

export const driverTikTok = {
  id: 'tiktok',
  nome: 'TikTok (DM)',
  descricao: 'Mensagens diretas do TikTok pela Business Messaging API. Janela de 48 horas; precisa do sistema hospedado.',
  precisaCredenciais: true,

  async enviar({ conexao, contato, tipo, conteudo, midia }) {
    const cfg = await credenciais(conexao);
    if (!contato.idCanal) {
      throw Object.assign(new Error('Esta conversa nao tem a conversa do TikTok de destino.'), { codigoWhatsapp: 'sem_destino' });
    }
    if (!janelaDaConversa(contato, conexao).aberta) throw erroDeJanela(conexao);

    let texto = String(conteudo || '');
    let ultimo = null;

    if (midia && tipo && tipo !== 'texto') {
      const idDaImagem = tipo === 'imagem' ? await subirImagem(cfg, midia) : null;
      if (idDaImagem) {
        ultimo = await enviarBruto(cfg, contato.idCanal, { message_type: 'IMAGE', image: { media_id: idDaImagem } });
      } else {
        /* Video, audio e PDF nao passam pela DM do TikTok: vao como link. */
        const url = String(midia.url || '');
        const endereco = /^https?:\/\//i.test(url) ? url : url.startsWith('/midia/') && ENDERECO_PUBLICO ? `${ENDERECO_PUBLICO}${url}` : null;
        if (!endereco) {
          throw Object.assign(
            new Error('A DM do TikTok so aceita texto e imagem, e o link do arquivo precisa do sistema hospedado.'),
            { codigoWhatsapp: 'anexo_nao_suportado' },
          );
        }
        texto = [texto, endereco].filter(Boolean).join('\n');
      }
    }

    for (const pedaco of pedacosDeTexto(texto)) {
      ultimo = (await enviarBruto(cfg, contato.idCanal, { message_type: 'TEXT', text: { body: pedaco } })) || ultimo;
    }
    return { idExterno: ultimo };
  },

  async testar({ conexao }) {
    try {
      const cfg = await credenciais(conexao);
      const conta = await pedir('business/get/', {
        token: cfg.token,
        consulta: { business_id: cfg.businessId, fields: JSON.stringify(['username', 'display_name', 'profile_image']) },
      });
      if (conta.username && conta.username !== cfg.usuario) {
        atualizar('conexoes', conexao.id, { tiktok: { ...achar('conexoes', conexao.id).tiktok, usuario: conta.username } });
      }
      return { ok: true, numero: conta.username ? `@${conta.username}` : null, nomeExibicao: conta.display_name || null };
    } catch (erro) {
      return { ok: false, erro: erro.message };
    }
  },

  /* O TikTok nao tem "visto" pela API de envio: nada a fazer. */
  async marcarLida() {},

  /** A imagem recebida vem como id: pede o endereco e guarda o arquivo aqui. */
  async baixarMidia({ conexao, midia }) {
    if (!midia?.idMidia) return null;
    try {
      const cfg = await credenciais(conexao);
      const dados = await pedir('business/message/media/download/', {
        metodo: 'POST',
        token: cfg.token,
        corpo: {
          business_id: cfg.businessId,
          conversation_id: midia.conversa,
          message_id: midia.mensagem,
          media_id: midia.idMidia,
          media_type: 'IMAGE',
        },
      });
      if (!dados.download_url) return null;
      const resposta = await fetch(dados.download_url, { headers: { 'x-user': cfg.token } });
      if (!resposta.ok) return null;
      const mime = (resposta.headers.get('content-type') || 'image/jpeg').split(';')[0];
      const guardada = guardarBuffer({ nome: 'tiktok-imagem', dados: Buffer.from(await resposta.arrayBuffer()), mime });
      return { url: guardada.url, mime, nome: guardada.nome, tamanho: guardada.tamanho };
    } catch {
      return null;
    }
  },

  /**
   * Assinatura do TikTok: cabecalho `Tiktok-Signature: t=<segundos>,s=<hex>`,
   * HMAC-SHA256 de "<t>.<corpo>" com a chave secreta do app. Evento velho (mais
   * de cinco minutos) nao entra: e reenvio de alguem que guardou o pacote.
   */
  conferirAssinatura({ conexao, cabecalhos, corpoBruto }) {
    const segredo = conexao.tiktok?.appSecret;
    if (!segredo) return false;
    const partes = Object.fromEntries(
      String(cabecalhos['tiktok-signature'] || '')
        .split(',')
        .map((parte) => parte.split('=').map((v) => v.trim())),
    );
    const instante = Number(partes.t);
    if (!Number.isFinite(instante) || !partes.s) return false;
    if (Math.abs(Date.now() / 1000 - instante) > 300) return false;
    const esperada = crypto.createHmac('sha256', segredo).update(`${instante}.${corpoBruto}`).digest('hex');
    const a = Buffer.from(String(partes.s));
    const b = Buffer.from(esperada);
    return a.length === b.length && crypto.timingSafeEqual(a, b);
  },

  interpretarWebhook({ conexao, corpo }) {
    const saida = { mensagens: [], situacoes: [], conexao: null, templates: [] };
    const minhaConta = String(conexao.tiktok?.businessId || '');
    if (minhaConta && String(corpo?.user_openid || '') !== minhaConta) return saida;

    let conteudo;
    try {
      conteudo = typeof corpo?.content === 'string' ? JSON.parse(corpo.content) : corpo?.content || {};
    } catch {
      return saida;
    }

    if (corpo?.event === 'im_mark_read_msg') {
      if (conteudo.message_id) saida.situacoes.push({ idExterno: conteudo.message_id, situacao: 'lida', erro: null });
      return saida;
    }
    if (!['im_receive_msg', 'im_send_msg'].includes(corpo?.event) || !conteudo.conversation_id) return saida;

    const nossa = corpo.event === 'im_send_msg' || String(conteudo.from_user?.id || '') === minhaConta;
    let tipo = 'texto';
    let texto = '';
    let midia = null;
    switch (conteudo.type) {
      case 'text':
        texto = conteudo.text?.body || '';
        break;
      case 'image':
        tipo = 'imagem';
        midia = {
          tipo: 'imagem',
          idMidia: conteudo.image?.media_id,
          conversa: conteudo.conversation_id,
          mensagem: conteudo.message_id,
        };
        break;
      case 'share_post':
        texto = `[publicacao compartilhada] ${conteudo.share_post?.embed_url || ''}`.trim();
        break;
      case 'sticker':
        texto = '[figurinha]';
        break;
      default:
        texto = `[mensagem do tipo ${conteudo.type || 'desconhecido'} recebida]`;
    }

    saida.mensagens.push({
      telefone: '',
      /* A resposta do TikTok vai para a CONVERSA, e nao para a pessoa. */
      idCanal: String(conteudo.conversation_id),
      /* `from` e o @ de quem escreveu; a conversa nasce com ele ("@fulano"). */
      usuario: nossa ? conteudo.to || '' : conteudo.from || '',
      nome: '',
      idExterno: conteudo.message_id || null,
      daPropriaConta: nossa,
      tipo,
      conteudo: texto,
      midia,
      metadados: nossa ? null : { sourceApp: 'tiktok', entryPoint: 'direct' },
    });
    return saida;
  },
};
