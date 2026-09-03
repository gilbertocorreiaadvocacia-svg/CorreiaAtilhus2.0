import { achar, atualizar, inserir, listar, registrarLog } from '../nucleo/banco.js';
import { emitir } from '../nucleo/eventos.js';
import { agora, novoId } from '../nucleo/util.js';
import { inserirNota } from '../ia/mencoes.js';

/**
 * Agenda de reunioes. Funciona sozinha, com a disponibilidade configurada nas
 * integracoes; se houver credenciais do Google, tambem cria o evento la e
 * devolve o link do Meet. Cada reuniao vira nota interna na conversa.
 */

const FUSO = 'America/Sao_Paulo';

function configuracao(workspaceId) {
  const integracoes = achar('integracoes', { workspaceId });
  return (
    integracoes?.googleCalendar || {
      conectado: false,
      duracaoPadrao: 30,
      disponibilidade: null,
      credenciais: null,
    }
  );
}

function disponibilidadePadrao() {
  return {
    dias: [1, 2, 3, 4, 5],
    de: '09:00',
    ate: '17:00',
    duracao: 30,
    antecedenciaHoras: 2,
    diasAFrente: 5,
  };
}

function formatar(data) {
  return new Intl.DateTimeFormat('pt-BR', {
    timeZone: FUSO,
    weekday: 'long',
    day: '2-digit',
    month: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  }).format(data);
}

function minutosDe(texto) {
  const [h, m] = String(texto).split(':').map(Number);
  return h * 60 + (m || 0);
}

/** Gera as proximas janelas livres, pulando o que ja esta ocupado. */
function janelasLivres(workspaceId, regras) {
  const ocupados = listar('compromissos', { workspaceId })
    .filter((c) => c.situacao !== 'cancelado')
    .map((c) => new Date(c.quando).getTime());

  const livres = [];
  const inicio = new Date(Date.now() + (regras.antecedenciaHoras || 2) * 3600000);

  for (let dia = 0; dia <= (regras.diasAFrente || 5) && livres.length < 3; dia += 1) {
    const data = new Date(inicio.getTime() + dia * 86400000);
    const diaSemana = Number(
      new Intl.DateTimeFormat('en-US', { timeZone: FUSO, weekday: 'short' })
        .format(data)
        .replace(/Sun|Mon|Tue|Wed|Thu|Fri|Sat/, (d) => ({ Sun: 0, Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6 }[d])),
    );
    if (!(regras.dias || []).includes(diaSemana)) continue;

    const base = new Date(data);
    base.setHours(0, 0, 0, 0);

    for (
      let minuto = minutosDe(regras.de);
      minuto + (regras.duracao || 30) <= minutosDe(regras.ate) && livres.length < 3;
      minuto += regras.duracao || 30
    ) {
      const candidato = new Date(base.getTime() + minuto * 60000);
      if (candidato.getTime() < inicio.getTime()) continue;
      if (ocupados.includes(candidato.getTime())) continue;
      livres.push(candidato);
    }
  }
  return livres;
}

async function criarNoGoogle(cfg, evento) {
  const cred = cfg.credenciais;
  if (!cred?.clientId || !cred?.clientSecret || !cred?.refreshToken) return null;

  const tokenResposta = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      client_id: cred.clientId,
      client_secret: cred.clientSecret,
      refresh_token: cred.refreshToken,
      grant_type: 'refresh_token',
    }),
  });
  const tokenDados = await tokenResposta.json().catch(() => ({}));
  if (!tokenResposta.ok || !tokenDados.access_token) return null;

  const agenda = cfg.agenda || 'primary';
  const resposta = await fetch(
    `https://www.googleapis.com/calendar/v3/calendars/${encodeURIComponent(agenda)}/events?conferenceDataVersion=1`,
    {
      method: 'POST',
      headers: { Authorization: `Bearer ${tokenDados.access_token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        summary: evento.assunto,
        description: evento.descricao,
        start: { dateTime: evento.inicio, timeZone: FUSO },
        end: { dateTime: evento.fim, timeZone: FUSO },
        conferenceData: {
          createRequest: { requestId: evento.id, conferenceSolutionKey: { type: 'hangoutsMeet' } },
        },
      }),
    },
  );
  const dados = await resposta.json().catch(() => ({}));
  if (!resposta.ok) return null;
  return { id: dados.id, link: dados.hangoutLink || dados.htmlLink || null };
}

export async function operarAgenda({ contato, agente, argumentos }) {
  const workspaceId = contato.workspaceId;
  const cfg = configuracao(workspaceId);
  const regras = { ...disponibilidadePadrao(), ...(cfg.disponibilidade || {}), duracao: cfg.duracaoPadrao || 30 };
  const acao = argumentos.acao;

  if (acao === 'verificar') {
    const livres = janelasLivres(workspaceId, regras);
    if (!livres.length) {
      return { erro: 'Nao ha horario livre na janela configurada. Ofereca retorno para a proxima semana.' };
    }
    return {
      resumo: 'horarios livres',
      opcoes: livres.map((d) => ({ iso: d.toISOString(), texto: formatar(d) })),
      instrucao: 'Ofereca estas opcoes ao lead e chame a acao "criar" com a escolhida.',
    };
  }

  if (acao === 'criar') {
    if (!argumentos.quando) return { erro: 'Informe a data e a hora escolhidas pelo lead.' };
    const quando = new Date(argumentos.quando.replace(' ', 'T'));
    if (Number.isNaN(quando.getTime())) return { erro: 'Data invalida. Use 2026-08-20 14:30.' };

    const compromisso = inserir('compromissos', {
      id: novoId('cmp'),
      workspaceId,
      contatoId: contato.id,
      assunto: argumentos.assunto || `Reuniao com ${contato.nome}`,
      quando: quando.toISOString(),
      duracao: regras.duracao,
      situacao: 'confirmado',
      criadoPor: agente ? { tipo: 'agente', id: agente.id, nome: agente.nome } : null,
    });

    const noGoogle = await criarNoGoogle(cfg, {
      id: compromisso.id,
      assunto: compromisso.assunto,
      descricao: `Reuniao agendada pelo CorreiaAtilhus2.0 com ${contato.nome} (${contato.telefone}).`,
      inicio: quando.toISOString(),
      fim: new Date(quando.getTime() + regras.duracao * 60000).toISOString(),
    }).catch(() => null);

    if (noGoogle) atualizar('compromissos', compromisso.id, { googleId: noGoogle.id, link: noGoogle.link });

    inserirNota(
      contato,
      `Reuniao marcada para ${formatar(quando)}${noGoogle?.link ? `\nLink: ${noGoogle.link}` : ''}`,
      { tipo: 'sistema', nome: 'Agenda' },
    );
    registrarLog(workspaceId, contato.id, 'agenda', `Reuniao marcada para ${formatar(quando)}`);
    emitir(workspaceId, 'contato', { contatoId: contato.id });

    return {
      ok: true,
      resumo: formatar(quando),
      quando: formatar(quando),
      link: noGoogle?.link || null,
    };
  }

  if (acao === 'editar' || acao === 'cancelar') {
    const compromissos = listar('compromissos', { workspaceId, contatoId: contato.id })
      .filter((c) => c.situacao !== 'cancelado')
      .sort((a, b) => a.quando.localeCompare(b.quando));
    const alvo = compromissos[0];
    if (!alvo) return { erro: 'Nao encontrei reuniao marcada para este contato.' };

    if (acao === 'cancelar') {
      atualizar('compromissos', alvo.id, { situacao: 'cancelado', canceladoEm: agora() });
      inserirNota(contato, `Reuniao de ${formatar(new Date(alvo.quando))} cancelada.`, { tipo: 'sistema', nome: 'Agenda' });
      return { ok: true, resumo: 'reuniao cancelada' };
    }

    const quando = new Date(String(argumentos.quando || '').replace(' ', 'T'));
    if (Number.isNaN(quando.getTime())) return { erro: 'Informe a nova data e hora.' };
    atualizar('compromissos', alvo.id, { quando: quando.toISOString(), remarcadoEm: agora() });
    inserirNota(contato, `Reuniao remarcada para ${formatar(quando)}.`, { tipo: 'sistema', nome: 'Agenda' });
    return { ok: true, resumo: formatar(quando) };
  }

  return { erro: `Acao "${acao}" nao reconhecida.` };
}
