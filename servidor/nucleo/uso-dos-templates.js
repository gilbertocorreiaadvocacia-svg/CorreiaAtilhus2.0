import { achar, atualizar, listar } from './banco.js';
import { agora } from './util.js';

/**
 * Quantas vezes cada template saiu, e quantas vezes falhou (30/10/2026).
 *
 * Achado: o escritorio colocou o video de boas-vindas num template e, de fora,
 * nao havia como saber se ele saiu para algum lead. O envio ja grava a situacao
 * em cada mensagem, mas contar mensagem por template exigiria abrir os 45 mil
 * registros das conversas. Aqui o contador mora no proprio template (campo
 * `uso`, dois numeros e as datas), atualizado por envio.js a cada saida com
 * `templateId` — agente, follow-up, pos-assinatura ou pessoa escolhendo o
 * template na conversa.
 *
 * Medir nunca atrapalha enviar: qualquer erro aqui e engolido.
 */
export function anotarEnvioDoTemplate(templateId, { ok, erro = null }) {
  try {
    const template = templateId ? achar('templates', templateId) : null;
    if (!template) return;
    const antes = template.uso || {};
    atualizar('templates', templateId, {
      uso: {
        enviados: (antes.enviados || 0) + (ok ? 1 : 0),
        falhas: (antes.falhas || 0) + (ok ? 0 : 1),
        ultimoEnvioEm: ok ? agora() : antes.ultimoEnvioEm || null,
        ultimaFalhaEm: ok ? antes.ultimaFalhaEm || null : agora(),
        ultimaFalha: ok ? antes.ultimaFalha || null : String(erro || 'erro sem mensagem').slice(0, 200),
      },
    });
  } catch {
    /* a contagem nao derruba a mensagem */
  }
}

/* A rota de saude e aberta: o erro do WhatsApp pode trazer o telefone do cliente. */
const semNumeros = (texto) => String(texto || '').replace(/\d{6,}/g, '#').slice(0, 140);

/**
 * O que cada template ja enviou, para /api/saude: so os que tiveram saida, por
 * atalho, com o motivo da ultima falha sem numero comprido.
 */
export function usoDosTemplates(workspaceId) {
  const resumo = {};
  for (const template of listar('templates', { workspaceId })) {
    const { enviados = 0, falhas = 0, ultimoEnvioEm = null, ultimaFalhaEm = null, ultimaFalha = null } = template.uso || {};
    if (!template.atalho || (!enviados && !falhas)) continue;
    resumo[template.atalho] = {
      enviados,
      falhas,
      ultimoEnvioEm,
      ...(falhas ? { ultimaFalhaEm, ultimaFalha: semNumeros(ultimaFalha) } : {}),
    };
  }
  return resumo;
}
