import { achar, atualizar, inserir, listar } from './banco.js';
import { emitirParaUsuario } from './eventos.js';
import { agora, novoId } from './util.js';

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
 *
 * Template COM ARQUIVO que falha tambem avisa a equipe (avisarQueNaoSaiu): era
 * o que faltava para o escritorio descobrir, sem abrir conversa por conversa,
 * que o video de boas-vindas nao estava chegando.
 */
export function anotarEnvioDoTemplate(templateId, { ok, erro = null, contato = null }) {
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
    if (!ok && template.midia) avisarQueNaoSaiu(template, contato, erro);
  } catch {
    /* a contagem nao derruba a mensagem */
  }
}

/* A rota de saude e aberta: o erro do WhatsApp pode trazer o telefone do cliente. */
const semNumeros = (texto) => String(texto || '').replace(/\d{6,}/g, '#').slice(0, 140);

/*
 * Um aviso por dia por template, e nao por falha: dez leads seguidos com o mesmo
 * problema viram um sino, e nao dez. O mapa vive na memoria, entao uma
 * reinicializacao pode repetir o aviso do dia — melhor repetir do que perder.
 *
 * Fica aqui, e nao em mencoes.js, porque envio.js (que chama a contagem) e
 * importado por mencoes.js: importar de la formaria um ciclo.
 */
const avisadoNoDia = new Map();

function avisarQueNaoSaiu(template, contato, erro) {
  const dia = agora().slice(0, 10);
  for (const chave of avisadoNoDia.keys()) if (!chave.endsWith(dia)) avisadoNoDia.delete(chave);
  const chave = `${template.id}:${dia}`;
  if (avisadoNoDia.has(chave)) return;
  avisadoNoDia.set(chave, true);

  const titulo = `O template "${template.nome}" não saiu para um cliente`;
  const texto = [
    contato?.nome ? `Conversa: ${contato.nome}.` : null,
    `Motivo: ${semNumeros(erro) || 'sem detalhe'}.`,
    'O contador em Configurações › Templates mostra quantos saíram e quantos falharam. Este aviso vem uma vez por dia por template.',
  ]
    .filter(Boolean)
    .join(' ');

  for (const membro of listar('membros', { workspaceId: template.workspaceId })) {
    if (!['owner', 'admin'].includes(membro.papel)) continue;
    const notificacao = inserir('notificacoes', {
      id: novoId('ntf'),
      workspaceId: template.workspaceId,
      membroId: membro.id,
      usuarioId: membro.usuarioId,
      tipo: 'ia',
      titulo,
      texto,
      contatoId: contato?.id || null,
      tarefaId: null,
      conexaoId: null,
      lida: false,
    });
    emitirParaUsuario(template.workspaceId, membro.usuarioId, 'notificacao', { notificacao });
  }
}

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
