import crypto from 'node:crypto';
import { ENDERECO_PUBLICO } from '../../config.js';
import { atualizar } from '../../nucleo/banco.js';
import { guardarBuffer } from '../../nucleo/midia.js';
import { erroDeJanela, janelaDaConversa, pedacosDeTexto } from '../canais.js';

/**
 * Direct do Instagram, pela API oficial da Meta (Instagram API com login do
 * Instagram, graph.instagram.com).
 *
 * O que a Meta exige, e que a tela de Conexoes explica passo a passo:
 *  - conta PROFISSIONAL do Instagram (comercial ou criador);
 *  - um app na Meta com "Instagram API com login do Instagram", as permissoes
 *    instagram_business_basic e instagram_business_manage_messages, e a
 *    Analise do App aprovada para falar com quem nao e testador;
 *  - endereco publico com HTTPS para o webhook (so com o sistema hospedado).
 *
 * As regras que machucam, todas aqui:
 *  - JANELA DE 24 HORAS desde a ultima mensagem do cliente. Nao ha template
 *    que fure a janela, como no WhatsApp oficial;
 *  - so o cliente comeca a conversa;
 *  - anexo sai por LINK publico: a Meta busca o arquivo no endereco do
 *    sistema, entao sem hospedagem so vai texto;
 *  - texto de ate 1.000 caracteres por mensagem (o resto vai em seguida).
 *
 * O endereco da API e trocavel por CORREIA_INSTAGRAM_URL: e por ai que a
 * suite de testes fala com uma Meta de mentira.
 */

const base = () => (process.env.CORREIA_INSTAGRAM_URL || 'https://graph.instagram.com/v25.0').replace(/\/+$/, '');

function credenciais(conexao) {
  const cfg = conexao.instagram || {};
  if (!cfg.token || !cfg.contaId) {
    throw Object.assign(new Error('Conexao do Instagram sem a conta ou o token de acesso. Configure em Conexoes.'), {
      codigoWhatsapp: 'instagram_sem_credencial',
    });
  }
  return cfg;
}

async function chamar(conexao, caminho, { metodo = 'GET', corpo = null, consulta = {} } = {}) {
  const cfg = credenciais(conexao);
  const url = new URL(`${base()}/${caminho.replace(/^\/+/, '')}`);
  for (const [chave, valor] of Object.entries(consulta)) url.searchParams.set(chave, valor);
  const resposta = await fetch(url, {
    method: metodo,
    headers: { Authorization: `Bearer ${cfg.token}`, ...(corpo ? { 'Content-Type': 'application/json' } : {}) },
    body: corpo ? JSON.stringify(corpo) : undefined,
  });
  const dados = await resposta.json().catch(() => ({}));
  if (!resposta.ok || dados?.error) {
    const erro = dados?.error || {};
    throw Object.assign(new Error(erro.message || `Instagram respondeu ${resposta.status}`), {
      codigoWhatsapp: String(erro.code || resposta.status),
      detalhe: erro,
    });
  }
  return dados;
}

/** O arquivo guardado aqui, num endereco que a Meta alcanca. */
function enderecoPublicoDa(midia) {
  const url = String(midia?.url || '');
  if (/^https?:\/\//i.test(url)) return url;
  if (url.startsWith('/midia/') && ENDERECO_PUBLICO) return `${ENDERECO_PUBLICO}${url}`;
  return null;
}

const TIPO_DO_ANEXO = { imagem: 'image', video: 'video', audio: 'audio', documento: 'file' };

/* O que a Meta manda como anexo, no formato daqui. */
const ANEXO_RECEBIDO = {
  image: 'imagem',
  video: 'video',
  audio: 'audio',
  file: 'documento',
  ig_reel: 'video',
  reel: 'video',
};

/**
 * A marca de origem de uma mensagem do Direct.
 *
 * Toda mensagem daqui veio do Instagram, entao o rastro minimo diz isso
 * (`entryPoint: 'direct'`, que o recebimento le como "so o canal"). O clique
 * num anuncio de mensagem do Instagram traz o `referral` com o anuncio: ai
 * vira trafego pago, com o titulo do anuncio guardado.
 */
function rastroDo(evento) {
  const indicacao = evento.referral || evento.message?.referral || evento.postback?.referral || null;
  const anuncio = indicacao && (indicacao.source === 'ADS' || indicacao.ad_id);
  const contexto = indicacao?.ads_context_data || {};
  return {
    sourceApp: 'instagram',
    entryPoint: anuncio ? 'instagram_ad' : 'direct',
    sourceType: anuncio ? 'ad' : null,
    sourceID: indicacao?.ad_id || null,
    title: contexto.ad_title || null,
    mediaURL: contexto.photo_url || contexto.video_url || null,
    sourceURL: null,
    ctwaClid: null,
  };
}

export const driverInstagram = {
  id: 'instagram',
  nome: 'Instagram (Direct)',
  descricao: 'Mensagens do Direct do Instagram pela API oficial da Meta. Janela de 24 horas; precisa do sistema hospedado.',
  precisaCredenciais: true,

  async enviar({ conexao, contato, tipo, conteudo, midia }) {
    const cfg = credenciais(conexao);
    if (!contato.idCanal) {
      throw Object.assign(new Error('Esta conversa nao tem a conta do Instagram de destino.'), { codigoWhatsapp: 'sem_destino' });
    }
    if (!janelaDaConversa(contato, conexao).aberta) throw erroDeJanela(conexao);

    const destino = { id: contato.idCanal };
    let ultimo = null;

    if (midia && tipo && tipo !== 'texto') {
      const endereco = enderecoPublicoDa(midia);
      if (!endereco) {
        throw Object.assign(
          new Error('O Instagram busca o anexo no endereco do sistema, e o sistema ainda nao esta hospedado. Por enquanto, so texto.'),
          { codigoWhatsapp: 'anexo_sem_endereco' },
        );
      }
      const resposta = await chamar(conexao, `${cfg.contaId}/messages`, {
        metodo: 'POST',
        corpo: {
          recipient: destino,
          message: { attachments: [{ type: TIPO_DO_ANEXO[tipo] || 'file', payload: { url: endereco } }] },
        },
      });
      ultimo = resposta.message_id || ultimo;
    }

    /* A legenda do anexo nao existe no Direct: o texto vai numa mensagem logo
       depois, e texto longo em pedacos de 1.000 caracteres. */
    for (const pedaco of pedacosDeTexto(conteudo)) {
      const resposta = await chamar(conexao, `${cfg.contaId}/messages`, {
        metodo: 'POST',
        corpo: { recipient: destino, message: { text: pedaco } },
      });
      ultimo = resposta.message_id || ultimo;
    }

    return { idExterno: ultimo };
  },

  /**
   * Confere a conta e liga a entrega de mensagens para ela.
   *
   * O `subscribed_apps` e o que faz a Meta mandar as mensagens DESTA conta
   * para o webhook do app. Sem ele o app esta configurado, o token vale, e
   * nenhuma mensagem chega — por isso o teste ja faz a inscricao.
   */
  async testar({ conexao }) {
    try {
      const conta = await chamar(conexao, 'me', { consulta: { fields: 'user_id,username,name' } });
      await chamar(conexao, 'me/subscribed_apps', {
        metodo: 'POST',
        consulta: { subscribed_fields: 'messages,messaging_postbacks,messaging_seen,messaging_referral' },
      }).catch(() => null);
      /* O id que o webhook usa e o user_id da conta profissional. */
      if (conta.user_id && conta.user_id !== conexao.instagram?.contaId) {
        atualizar('conexoes', conexao.id, { instagram: { ...conexao.instagram, contaId: String(conta.user_id) } });
      }
      return {
        ok: true,
        numero: conta.username ? `@${conta.username}` : null,
        nomeExibicao: conta.name || conta.username || null,
      };
    } catch (erro) {
      return { ok: false, erro: erro.message };
    }
  },

  async marcarLida({ conexao, contato }) {
    if (!contato?.idCanal) return;
    try {
      const cfg = credenciais(conexao);
      await chamar(conexao, `${cfg.contaId}/messages`, {
        metodo: 'POST',
        corpo: { recipient: { id: contato.idCanal }, sender_action: 'mark_seen' },
      });
    } catch {
      /* Visto no Instagram e cortesia, nunca derruba o atendimento. */
    }
  },

  /** Nome e @ da pessoa, pelo codigo que a mensagem trouxe. */
  async perfilDoContato({ conexao, idCanal }) {
    const perfil = await chamar(conexao, idCanal, { consulta: { fields: 'name,username' } });
    return { nome: perfil.name || '', usuario: perfil.username || '' };
  },

  /** Foto do perfil, para a fila de fotos (whatsapp/fotos.js). */
  async buscarFoto({ conexao, contato }) {
    if (!contato?.idCanal) return null;
    const perfil = await chamar(conexao, contato.idCanal, { consulta: { fields: 'profile_pic' } }).catch(() => null);
    return perfil?.profile_pic || null;
  },

  /**
   * O anexo chega como endereco da Meta que vence em pouco tempo: e baixado e
   * guardado aqui na hora.
   */
  async baixarMidia({ midia }) {
    if (!midia?.endereco) return null;
    try {
      const resposta = await fetch(midia.endereco);
      if (!resposta.ok) return null;
      const mime = (resposta.headers.get('content-type') || 'application/octet-stream').split(';')[0];
      const dados = Buffer.from(await resposta.arrayBuffer());
      const guardada = guardarBuffer({ nome: midia.nome || `instagram-${midia.tipo || 'anexo'}`, dados, mime });
      return { url: guardada.url, mime, nome: guardada.nome, tamanho: guardada.tamanho };
    } catch {
      return null;
    }
  },

  /**
   * Assinatura do evento (X-Hub-Signature-256), com a chave secreta do app.
   * Sem a chave, o evento nao entra: o endereco do webhook e publico, e sem
   * conferencia qualquer um fabricaria mensagem de cliente.
   */
  conferirAssinatura({ conexao, cabecalhos, corpoBruto }) {
    const segredo = conexao.instagram?.appSecret;
    if (!segredo) return false;
    const esperada = `sha256=${crypto.createHmac('sha256', segredo).update(corpoBruto).digest('hex')}`;
    const a = Buffer.from(String(cabecalhos['x-hub-signature-256'] || ''));
    const b = Buffer.from(esperada);
    return a.length === b.length && crypto.timingSafeEqual(a, b);
  },

  verificarWebhook({ conexao, query }) {
    const esperado = conexao?.instagram?.verifyToken;
    if (query['hub.mode'] === 'subscribe' && esperado && query['hub.verify_token'] === esperado) {
      return { ok: true, resposta: String(query['hub.challenge'] || '') };
    }
    return { ok: false, resposta: 'token de verificacao invalido' };
  },

  interpretarWebhook({ conexao, corpo }) {
    const saida = { mensagens: [], situacoes: [], conexao: null, templates: [] };
    if (corpo?.object !== 'instagram') return saida;
    const minhaConta = String(conexao.instagram?.contaId || '');

    for (const entrada of corpo.entry || []) {
      /* Evento de outra conta do mesmo app nao e desta conexao. */
      if (minhaConta && String(entrada.id) !== minhaConta) continue;

      for (const evento of entrada.messaging || []) {
        if (evento.read?.mid) {
          saida.situacoes.push({ idExterno: evento.read.mid, situacao: 'lida', erro: null });
          continue;
        }
        const mensagem = evento.message;
        if (!mensagem || mensagem.is_deleted || mensagem.is_unsupported) continue;

        const nossa = Boolean(mensagem.is_echo) || String(evento.sender?.id) === String(entrada.id);
        const pessoa = String((nossa ? evento.recipient?.id : evento.sender?.id) || '');
        if (!pessoa) continue;

        const anexo = (mensagem.attachments || [])[0];
        const tipoAnexo = anexo ? ANEXO_RECEBIDO[anexo.type] : null;
        let conteudo = mensagem.text || '';
        if (mensagem.reply_to?.story) conteudo = `[respondeu ao story] ${conteudo}`.trim();
        if (anexo && !tipoAnexo) {
          const url = anexo.payload?.url ? ` ${anexo.payload.url}` : '';
          conteudo = `${conteudo} [${anexo.type === 'share' ? 'publicacao compartilhada' : `anexo do tipo ${anexo.type}`}]${url}`.trim();
        }

        saida.mensagens.push({
          telefone: '',
          idCanal: pessoa,
          nome: '',
          idExterno: mensagem.mid || null,
          daPropriaConta: nossa,
          tipo: tipoAnexo || 'texto',
          conteudo,
          midia: tipoAnexo && anexo.payload?.url ? { tipo: tipoAnexo, endereco: anexo.payload.url } : null,
          metadados: nossa ? null : rastroDo(evento),
        });
      }
    }
    return saida;
  },
};

/**
 * A conexao do Instagram que responde por uma conta, em todos os escritorios.
 * O webhook do app e um so; e a conta de cada evento que diz de quem ele e.
 */
export function conexaoDaContaInstagram(contaId, listar) {
  return listar('conexoes').find((c) => c.tipo === 'instagram' && String(c.instagram?.contaId || '') === String(contaId));
}
