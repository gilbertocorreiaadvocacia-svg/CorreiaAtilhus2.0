import crypto from 'node:crypto';
import { achar, atualizar, registrarLog } from '../nucleo/banco.js';

/**
 * API de Eventos do TikTok (Events API 2.0), o par da API de Conversao da Meta.
 *
 * Sem ela o TikTok otimiza a campanha por "mensagem iniciada", que e barata e
 * nao paga a conta. Devolvendo quem virou Qualificado e quem assinou, a
 * campanha passa a procurar gente parecida com quem fecha.
 *
 * SO LEAD DO TIKTOK. Mandar para o TikTok o telefone de quem veio da Meta, do
 * Google ou de indicacao nao ajuda campanha nenhuma e entrega dado de cliente
 * a quem nao precisa. Entra quem tem origem do TikTok (pago ou organico) ou
 * conversa na DM do TikTok.
 *
 * O que sai e o minimo, sempre com hash SHA-256: o telefone no formato
 * internacional (+55...), o e-mail quando o agente coletou, e um codigo nosso
 * da conversa. Nome, CPF e conteudo de conversa nao saem.
 */

const base = () => (process.env.CORREIA_TIKTOK_URL || 'https://business-api.tiktok.com/open_api/v1.3').replace(/\/+$/, '');

function configuracao(workspaceId) {
  const integracoes = achar('integracoes', { workspaceId });
  return integracoes?.tiktokEventos || { ativo: false, conjuntoId: '', token: '', fonte: 'crm', eventos: {} };
}

const hash = (valor) => crypto.createHash('sha256').update(String(valor).trim().toLowerCase()).digest('hex');

/** O lead e do TikTok? Pela origem ou pelo canal da conversa. */
export function leadDoTikTok(contato) {
  if (contato?.canal === 'tiktok') return true;
  const origem = contato?.origemId ? achar('origens', contato.origemId) : null;
  return origem?.canal === 'tiktok' || origem?.canal === 'anuncio_tiktok';
}

/* O telefone: o da conversa (WhatsApp) ou o que o agente coletou (DM). */
function telefoneDo(contato) {
  const variaveis = contato.variaveis || {};
  const coletado = Object.entries(variaveis).find(([chave, valor]) => /telefone|celular|whatsapp/i.test(chave) && valor)?.[1];
  const digitos = String(contato.telefone || coletado || '').replace(/\D+/g, '');
  if (!digitos) return null;
  return `+${digitos.length <= 11 ? `55${digitos}` : digitos}`;
}

function emailDo(contato) {
  const variaveis = contato.variaveis || {};
  const valor = Object.entries(variaveis).find(([chave, v]) => /e-?mail/i.test(chave) && /@/.test(String(v)))?.[1];
  return valor ? String(valor).trim().toLowerCase() : null;
}

async function enviar(cfg, corpo) {
  const resposta = await fetch(`${base()}/event/track/`, {
    method: 'POST',
    headers: { 'Access-Token': cfg.token, 'Content-Type': 'application/json' },
    body: JSON.stringify(corpo),
  });
  const dados = await resposta.json().catch(() => ({}));
  if (!resposta.ok || (dados.code !== undefined && dados.code !== 0)) {
    throw new Error(dados.message || `TikTok respondeu ${resposta.status}`);
  }
  return dados;
}

/** Chamado quando o status muda (automacao/followup.js), como o da Meta. */
export async function enviarEventoTikTok({ workspaceId, contato, tipoStatus, valor = null }) {
  const cfg = configuracao(workspaceId);
  if (!cfg.ativo || !cfg.conjuntoId || !cfg.token) return { ok: false, motivo: 'nao configurado' };
  const nomeEvento = cfg.eventos?.[tipoStatus];
  if (!nomeEvento) return { ok: false, motivo: 'tipo de status sem evento definido' };
  if (!leadDoTikTok(contato)) return { ok: false, motivo: 'lead nao veio do TikTok' };

  const telefone = telefoneDo(contato);
  const email = emailDo(contato);
  /* Sem telefone nem e-mail o TikTok nao tem com quem casar o evento. */
  if (!telefone && !email) return { ok: false, motivo: 'sem telefone nem e-mail para o TikTok casar' };

  const corpo = {
    event_source: cfg.fonte === 'offline' ? 'offline' : 'crm',
    event_source_id: cfg.conjuntoId,
    ...(cfg.codigoDeTeste ? { test_event_code: cfg.codigoDeTeste } : {}),
    data: [
      {
        event: nomeEvento,
        event_time: Math.floor(Date.now() / 1000),
        event_id: `${contato.id}-${tipoStatus}`,
        user: {
          ...(telefone ? { phone: hash(telefone) } : {}),
          ...(email ? { email: hash(email) } : {}),
          external_id: hash(contato.id),
        },
        ...(valor ? { properties: { value: Number(valor), currency: 'BRL' } } : {}),
      },
    ],
  };

  try {
    await enviar(cfg, corpo);
    registrarLog(workspaceId, contato.id, 'conversao', `Evento "${nomeEvento}" enviado para o TikTok`);
    const enviados = [...(contato.conversoesEnviadas || []), { evento: nomeEvento, rede: 'tiktok', em: new Date().toISOString() }];
    atualizar('contatos', contato.id, { conversoesEnviadas: enviados });
    return { ok: true, evento: nomeEvento };
  } catch (erro) {
    registrarLog(workspaceId, contato.id, 'conversao', `Falha ao enviar "${nomeEvento}" para o TikTok: ${erro.message}`);
    return { ok: false, erro: erro.message };
  }
}

/**
 * Teste sem gerar evento de verdade: so com o codigo de teste do Gerenciador
 * de Eventos do TikTok, que separa o evento de teste dos reais.
 */
export async function testarEventosTikTok(workspaceId) {
  const cfg = configuracao(workspaceId);
  if (!cfg.conjuntoId || !cfg.token) return { ok: false, erro: 'Preencha o ID do conjunto de eventos e o token.' };
  if (!cfg.codigoDeTeste) {
    return {
      ok: false,
      erro: 'Para testar sem gerar evento real, preencha o codigo de teste (Gerenciador de Eventos > Testar eventos).',
    };
  }
  try {
    await enviar(cfg, {
      event_source: cfg.fonte === 'offline' ? 'offline' : 'crm',
      event_source_id: cfg.conjuntoId,
      test_event_code: cfg.codigoDeTeste,
      data: [{ event: 'Contact', event_time: Math.floor(Date.now() / 1000), event_id: `teste-${Date.now()}`, user: { external_id: hash('teste') } }],
    });
    return { ok: true, nome: cfg.conjuntoId };
  } catch (erro) {
    return { ok: false, erro: erro.message };
  }
}
