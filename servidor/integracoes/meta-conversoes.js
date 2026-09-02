import crypto from 'node:crypto';
import { achar, atualizar, registrarLog } from '../nucleo/banco.js';

const GRAPH = 'https://graph.facebook.com/v21.0';

/**
 * API de Conversao da Meta (CAPI).
 *
 * Sem ela, a Meta otimiza o anuncio por "conversa iniciada", e conversa
 * iniciada e barata e inutil. Mandando de volta o evento de contrato assinado,
 * a campanha passa a buscar quem realmente fecha, e o custo por contrato cai
 * sem mexer no orcamento.
 *
 * O que sai daqui e o minimo: o identificador do clique no anuncio
 * (CTWA Clid) e o telefone com hash. Nome, CPF e conteudo de conversa nao
 * saem, nada disso e necessario para a atribuicao funcionar.
 */

function configuracao(workspaceId) {
  const integracoes = achar('integracoes', { workspaceId });
  return integracoes?.metaConversoes || { ativo: false, pixelId: '', token: '', eventos: {} };
}

function hash(valor) {
  if (!valor) return null;
  return crypto.createHash('sha256').update(String(valor).trim().toLowerCase()).digest('hex');
}

/**
 * Envia um evento de conversao. Chamado quando o status entra em um tipo que o
 * escritorio marcou como digno de otimizacao (normalmente Qualificado e Sucesso).
 */
export async function enviarConversao({ workspaceId, contato, tipoStatus, valor = null }) {
  const cfg = configuracao(workspaceId);
  if (!cfg.ativo || !cfg.pixelId || !cfg.token) return { ok: false, motivo: 'nao configurado' };

  const nomeEvento = cfg.eventos?.[tipoStatus];
  if (!nomeEvento) return { ok: false, motivo: 'tipo de status sem evento definido' };

  const anuncio = contato.anuncio || {};
  // Sem o clique do anuncio a Meta nao sabe a qual criativo atribuir.
  if (!anuncio.ctwaClid) return { ok: false, motivo: 'lead nao veio de anuncio' };

  const corpo = {
    data: [
      {
        event_name: nomeEvento,
        event_time: Math.floor(Date.now() / 1000),
        action_source: 'business_messaging',
        messaging_channel: 'whatsapp',
        event_id: `${contato.id}-${tipoStatus}`,
        user_data: {
          ctwa_clid: anuncio.ctwaClid,
          ph: contato.telefone ? [hash(contato.telefone)] : undefined,
        },
        custom_data: valor ? { value: Number(valor), currency: 'BRL' } : undefined,
      },
    ],
  };

  try {
    const resposta = await fetch(`${GRAPH}/${cfg.pixelId}/events?access_token=${encodeURIComponent(cfg.token)}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(corpo),
    });
    const dados = await resposta.json().catch(() => ({}));

    if (!resposta.ok) {
      const erro = dados?.error?.message || `Meta respondeu ${resposta.status}`;
      registrarLog(workspaceId, contato.id, 'conversao', `Falha ao enviar "${nomeEvento}" para a Meta: ${erro}`);
      return { ok: false, erro };
    }

    registrarLog(workspaceId, contato.id, 'conversao', `Evento "${nomeEvento}" enviado para a Meta`);

    const enviados = [...(contato.conversoesEnviadas || []), { evento: nomeEvento, em: new Date().toISOString() }];
    atualizar('contatos', contato.id, { conversoesEnviadas: enviados });

    return { ok: true, evento: nomeEvento, recebidos: dados.events_received ?? 1 };
  } catch (erro) {
    registrarLog(workspaceId, contato.id, 'conversao', `Falha ao enviar evento: ${erro.message}`);
    return { ok: false, erro: erro.message };
  }
}

/** Confere as credenciais sem gerar evento de verdade. */
export async function testarConexao(workspaceId) {
  const cfg = configuracao(workspaceId);
  if (!cfg.pixelId || !cfg.token) return { ok: false, erro: 'Preencha o ID do conjunto de dados e o token.' };

  try {
    const resposta = await fetch(`${GRAPH}/${cfg.pixelId}?access_token=${encodeURIComponent(cfg.token)}`);
    const dados = await resposta.json().catch(() => ({}));
    if (!resposta.ok) return { ok: false, erro: dados?.error?.message || `Meta respondeu ${resposta.status}` };
    return { ok: true, nome: dados.name || dados.id };
  } catch (erro) {
    return { ok: false, erro: erro.message };
  }
}
