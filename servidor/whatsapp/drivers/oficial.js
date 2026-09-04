import crypto from 'node:crypto';
import fs from 'node:fs';
import { caminhoDaMidia } from '../../nucleo/midia.js';
import { baixarMidiaDaMeta } from '../midia.js';

/**
 * Driver da Cloud API da Meta, o caminho oficial.
 *
 * Nao ha risco de banimento aqui: e o WhatsApp que a propria Meta vende. O
 * preco disso sao tres regras que nao existem no caminho nao oficial, e todas
 * as tres estao neste arquivo, porque e aqui que elas machucam:
 *
 *  1. A JANELA DE 24 HORAS. Passadas 24h da ultima mensagem DO CLIENTE, so
 *     passa template aprovado. Fora dela, o envio volta com o erro 131047.
 *  2. O TEMPLATE precisa ter sido aprovado pela Meta antes, um por um.
 *  3. GRUPO nao funciona de jeito nenhum.
 *
 * O arquivo tambem sobe a midia para a Meta em vez de mandar um link: o que
 * esta guardado aqui tem URL de localhost, e a Meta nao alcanca localhost.
 */

const GRAPH = 'https://graph.facebook.com/v21.0';

/** A janela de 24 horas conta da ultima mensagem DO CLIENTE, nao da nossa. */
export function janelaAberta(contato) {
  if (!contato?.ultimaEntradaEm) return false;
  return Date.now() - new Date(contato.ultimaEntradaEm).getTime() < 1000 * 60 * 60 * 24;
}

async function chamarGraph(conexao, caminho, carga) {
  const { phoneNumberId, token } = conexao.oficial || {};
  if (!phoneNumberId || !token) {
    throw Object.assign(new Error('Conexao oficial sem phoneNumberId ou token configurado'), {
      codigoWhatsapp: '010101',
    });
  }
  const resposta = await fetch(`${GRAPH}/${phoneNumberId}/${caminho}`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ messaging_product: 'whatsapp', ...carga }),
  });
  const corpo = await resposta.json().catch(() => ({}));
  if (!resposta.ok) {
    const erro = corpo?.error || {};
    throw Object.assign(new Error(erro.message || `Graph API ${resposta.status}`), {
      codigoWhatsapp: String(erro.code || resposta.status),
      detalhe: erro,
    });
  }
  return corpo;
}

/**
 * Sobe um arquivo nosso para a Meta e devolve o id. Arquivo guardado aqui tem
 * URL local, a Meta nao alcanca localhost, entao o caminho e enviar o binario
 * e mandar a mensagem referenciando o id.
 */
async function subirMidia(conexao, midia) {
  const caminho = caminhoDaMidia(midia.url);
  if (!caminho) return null;

  const { phoneNumberId, token } = conexao.oficial || {};
  const dados = fs.readFileSync(caminho);
  const formulario = new FormData();
  formulario.append('messaging_product', 'whatsapp');
  formulario.append('type', midia.mime || 'application/octet-stream');
  formulario.append(
    'file',
    new Blob([dados], { type: midia.mime || 'application/octet-stream' }),
    midia.nome || 'arquivo',
  );

  const resposta = await fetch(`${GRAPH}/${phoneNumberId}/media`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}` },
    body: formulario,
  });
  const corpo = await resposta.json().catch(() => ({}));
  if (!resposta.ok) {
    throw Object.assign(new Error(corpo?.error?.message || 'Falha ao subir a midia para a Meta'), {
      codigoWhatsapp: String(corpo?.error?.code || '131053'),
    });
  }
  return corpo.id || null;
}

async function cargaDaMensagem({ tipo, conteudo, midia, conexao }) {
  if (tipo === 'texto' || !tipo) {
    return { type: 'text', text: { preview_url: true, body: conteudo || '' } };
  }
  const mapa = { imagem: 'image', video: 'video', audio: 'audio', documento: 'document' };
  const chave = mapa[tipo] || 'document';

  const objeto = {};
  const local = midia?.url && String(midia.url).startsWith('/midia/');
  if (local) {
    const id = await subirMidia(conexao, midia);
    if (id) objeto.id = id;
    else objeto.link = midia.url;
  } else {
    objeto.link = midia?.url;
  }

  if (conteudo && chave !== 'audio') objeto.caption = conteudo;
  if (chave === 'document' && midia?.nome) objeto.filename = midia.nome;
  return { type: chave, [chave]: objeto };
}

export const driverOficial = {
  id: 'oficial',
  nome: 'API Oficial (Meta)',
  descricao: 'Cloud API da Meta. Sem risco de banimento, com janela de 24h e template aprovado.',
  precisaCredenciais: true,

  async enviar({ conexao, contato, tipo, conteudo, midia, template }) {
    /* A janela vem antes de qualquer chamada de rede: falhar aqui custa nada e
       explica o motivo, enquanto deixar a Meta recusar devolve so o 131047. */
    if (!janelaAberta(contato) && !template) {
      throw Object.assign(
        new Error('Janela de 24 horas fechada. Fora dela a Meta so aceita template aprovado (erro 131047).'),
        { codigoWhatsapp: '131047' },
      );
    }

    const carga =
      template && template.aprovacaoMeta?.situacao === 'aprovado'
        ? {
            type: 'template',
            template: { name: template.metaNome || template.atalho, language: { code: 'pt_BR' } },
          }
        : await cargaDaMensagem({ tipo, conteudo, midia, conexao });

    const corpo = await chamarGraph(conexao, 'messages', { to: contato.telefone, ...carga });
    return { idExterno: corpo?.messages?.[0]?.id || null };
  },

  async testar({ conexao }) {
    const { phoneNumberId, token } = conexao.oficial || {};
    if (!phoneNumberId || !token) {
      return { ok: false, erro: 'Preencha o ID do numero e o token de acesso.' };
    }
    try {
      const resposta = await fetch(
        `${GRAPH}/${phoneNumberId}?fields=display_phone_number,quality_rating,verified_name`,
        { headers: { Authorization: `Bearer ${token}` } },
      );
      const dados = await resposta.json().catch(() => ({}));
      if (!resposta.ok) return { ok: false, erro: dados?.error?.message || `Graph API ${resposta.status}` };
      return {
        ok: true,
        numero: dados.display_phone_number || null,
        qualidade: dados.quality_rating || null,
        nomeExibicao: dados.verified_name || null,
      };
    } catch (erro) {
      return { ok: false, erro: erro.message };
    }
  },

  async marcarLida({ conexao, idExterno }) {
    if (!idExterno) return;
    try {
      await chamarGraph(conexao, 'messages', { status: 'read', message_id: idExterno });
    } catch {
      /* Marcar como lida nunca pode derrubar o atendimento. */
    }
  },

  /**
   * Na Cloud API a mensagem com anexo nao traz o arquivo: traz um id. A URL que
   * a Meta devolve vale poucos minutos, por isso o arquivo e guardado aqui na
   * hora em que ele chega.
   */
  async baixarMidia({ conexao, midia }) {
    if (!midia?.id) return null;
    return baixarMidiaDaMeta(conexao, midia.id, midia.nome);
  },

  /**
   * Confere a assinatura do evento com a chave secreta do app.
   *
   * Sem chave configurada nao ha o que conferir e o evento passa: e o estado em
   * que a conexao nasce, e barrar tudo deixaria o numero mudo antes de alguem
   * terminar de configurar. A tela avisa que falta.
   */
  conferirAssinatura({ conexao, cabecalhos, corpoBruto }) {
    const segredo = conexao.oficial?.appSecret;
    if (!segredo) return true;
    const esperada = `sha256=${crypto.createHmac('sha256', segredo).update(corpoBruto).digest('hex')}`;
    const a = Buffer.from(String(cabecalhos['x-hub-signature-256'] || ''));
    const b = Buffer.from(esperada);
    return a.length === b.length && crypto.timingSafeEqual(a, b);
  },

  /** Verificacao do endpoint: a Meta faz um GET quando voce salva a URL. */
  verificarWebhook({ conexao, query }) {
    const esperado = conexao?.oficial?.verifyToken;
    if (query['hub.mode'] === 'subscribe' && esperado && query['hub.verify_token'] === esperado) {
      return { ok: true, resposta: String(query['hub.challenge'] || '') };
    }
    return { ok: false, resposta: 'token de verificacao invalido' };
  },

  interpretarWebhook({ corpo }) {
    const saida = { mensagens: [], situacoes: [], conexao: null, templates: [] };

    for (const entrada of corpo.entry || []) {
      for (const alteracao of entrada.changes || []) {
        const valor = alteracao.value || {};

        for (const mensagem of valor.messages || []) {
          const perfil = valor.contacts?.find((c) => c.wa_id === mensagem.from);
          const extraido = extrairTexto(mensagem);
          const contexto = mensagem.referral || {};
          saida.mensagens.push({
            telefone: mensagem.from,
            nome: perfil?.profile?.name || '',
            idExterno: mensagem.id,
            tipo: extraido.tipo,
            conteudo: extraido.conteudo,
            midia: extraido.midia || null,
            metadados: contexto.ctwa_clid
              ? {
                  ctwaClid: contexto.ctwa_clid,
                  title: contexto.headline || null,
                  mediaURL: contexto.media_url || null,
                  sourceID: contexto.source_id || null,
                  sourceApp: contexto.source_type === 'ad' ? 'facebook' : contexto.source_type || null,
                  sourceURL: contexto.source_url || null,
                  sourceType: contexto.source_type || null,
                  clickToWhatsappCall: true,
                }
              : null,
          });
        }

        for (const situacao of valor.statuses || []) {
          const mapa = { sent: 'enviada', delivered: 'entregue', read: 'lida', failed: 'erro' };
          saida.situacoes.push({
            idExterno: situacao.id,
            situacao: mapa[situacao.status] || situacao.status,
            erro: situacao.errors?.[0]
              ? { mensagem: situacao.errors[0].title, codigo: String(situacao.errors[0].code) }
              : null,
          });
        }

        if (alteracao.field === 'message_template_status_update') {
          const mapa = { APPROVED: 'aprovado', REJECTED: 'reprovado', PAUSED: 'pausado', PENDING: 'em_analise' };
          saida.templates.push({
            metaNome: valor.message_template_name,
            situacao: mapa[valor.event] || String(valor.event || '').toLowerCase(),
            motivo: valor.reason || null,
          });
        }

        if (alteracao.field === 'phone_number_quality_update') {
          saida.conexao = {
            qualidade: valor.current_limit || valor.event || null,
            evento: `A Meta mudou a qualidade do numero para ${valor.event}.`,
          };
        }
      }
    }

    return saida;
  },
};

/** Traduz a mensagem da Cloud API para o formato interno. */
function extrairTexto(mensagem) {
  switch (mensagem.type) {
    case 'text':
      return { tipo: 'texto', conteudo: mensagem.text?.body || '' };
    case 'button':
      return { tipo: 'texto', conteudo: mensagem.button?.text || '' };
    case 'interactive':
      return {
        tipo: 'texto',
        conteudo: mensagem.interactive?.button_reply?.title || mensagem.interactive?.list_reply?.title || '',
      };
    case 'image':
      return { tipo: 'imagem', conteudo: mensagem.image?.caption || '', midia: { tipo: 'imagem', id: mensagem.image?.id } };
    case 'video':
      return { tipo: 'video', conteudo: mensagem.video?.caption || '', midia: { tipo: 'video', id: mensagem.video?.id } };
    case 'audio':
      return { tipo: 'audio', conteudo: '', midia: { tipo: 'audio', id: mensagem.audio?.id } };
    case 'document':
      return {
        tipo: 'documento',
        conteudo: mensagem.document?.caption || '',
        midia: { tipo: 'documento', id: mensagem.document?.id, nome: mensagem.document?.filename },
      };
    case 'location':
      return { tipo: 'texto', conteudo: `Localizacao: ${mensagem.location?.latitude}, ${mensagem.location?.longitude}` };
    default:
      return { tipo: 'texto', conteudo: `[mensagem do tipo ${mensagem.type} recebida]` };
  }
}
