import { achar } from '../nucleo/banco.js';

/**
 * Horario comercial existe por um motivo so: segurar follow-up fora de hora.
 * Mensagem de madrugada e das que mais rendem denuncia, e denuncia derruba
 * numero. Dentro da janela, envia na hora prevista; fora dela, joga para o
 * proximo dia util em um minuto aleatorio, para nao sair tudo junto as 9h.
 */

export const FUSO = 'America/Sao_Paulo';

/**
 * Quebra um instante nos campos do calendario de um fuso. E a unica forma
 * honesta de saber em que dia e em que hora uma coisa aconteceu para quem esta
 * no escritorio: fatiar a string ISO responde pelo UTC, que aqui esta tres
 * horas na frente e joga a noite inteira no dia seguinte.
 */
export function partesEm(data, fuso = FUSO) {
  const formatador = new Intl.DateTimeFormat('en-CA', {
    timeZone: fuso,
    weekday: 'short',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  });
  const partes = Object.fromEntries(formatador.formatToParts(data).map((p) => [p.type, p.value]));
  const semana = { Sun: 0, Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6 };
  return {
    ano: Number(partes.year),
    mes: Number(partes.month),
    dia: Number(partes.day),
    hora: Number(partes.hour) % 24,
    minuto: Number(partes.minute),
    diaSemana: semana[partes.weekday] ?? 0,
  };
}

function paraMinutos(texto) {
  const [h, m] = String(texto || '00:00').split(':').map(Number);
  return h * 60 + (m || 0);
}

/** Diferenca entre o fuso do horario comercial e o UTC, no instante dado. */
function deslocamentoMs(data, fuso = FUSO) {
  const comoUtc = new Date(data.toLocaleString('en-US', { timeZone: 'UTC' }));
  const comoLocal = new Date(data.toLocaleString('en-US', { timeZone: fuso }));
  return comoUtc.getTime() - comoLocal.getTime();
}

function montarData({ ano, mes, dia }, minutosDoDia, fuso) {
  const base = new Date(Date.UTC(ano, mes - 1, dia, 0, 0, 0));
  const alvo = new Date(base.getTime() + minutosDoDia * 60000);
  return new Date(alvo.getTime() + deslocamentoMs(alvo, fuso));
}

/**
 * Instante UTC que corresponde a um minuto do dia em uma data do calendario
 * local. `diaIso` chega no formato AAAA-MM-DD, do jeito que a tela manda.
 * Para o fim do dia, peca 24 * 60 e desconte um milissegundo.
 */
export function instanteLocal(diaIso, minutosDoDia = 0, fuso = FUSO) {
  const [ano, mes, dia] = String(diaIso || '').split('-').map(Number);
  if (!ano || !mes || !dia) return null;
  return montarData({ ano, mes, dia }, minutosDoDia, fuso);
}

export function horarioComercialDe(workspaceId) {
  const workspace = achar('workspaces', workspaceId);
  return (
    workspace?.horarioComercial || {
      fuso: FUSO,
      dias: { 0: null, 1: null, 2: null, 3: null, 4: null, 5: null, 6: null },
    }
  );
}

export function dentroDoHorario(data, horario) {
  const dias = horario?.dias || {};
  const temAlgum = Object.values(dias).some(Boolean);
  if (!temAlgum) return true; // nao configurado = sem restricao

  const p = partesEm(data, horario.fuso || FUSO);
  const faixa = dias[p.diaSemana];
  if (!faixa) return false;
  const minutos = p.hora * 60 + p.minuto;
  return minutos >= paraMinutos(faixa.de) && minutos <= paraMinutos(faixa.ate);
}

/**
 * Devolve o instante em que a mensagem pode sair. Se ja estiver dentro da
 * janela, e o proprio instante. Se nao, o proximo dia util com um minuto
 * sorteado dentro da faixa.
 */
export function proximoHorarioValido(data, horario) {
  const dias = horario?.dias || {};
  const temAlgum = Object.values(dias).some(Boolean);
  if (!temAlgum) return data;
  if (dentroDoHorario(data, horario)) return data;

  const fuso = horario.fuso || FUSO;
  let candidato = new Date(data.getTime());

  for (let salto = 0; salto <= 8; salto += 1) {
    const p = partesEm(candidato, fuso);
    const faixa = dias[p.diaSemana];
    if (faixa) {
      const inicio = paraMinutos(faixa.de);
      const fim = paraMinutos(faixa.ate);
      const minutosAgora = p.hora * 60 + p.minuto;
      if (salto === 0 && minutosAgora > fim) {
        // ja passou do expediente hoje, tenta amanha
      } else {
        const de = salto === 0 ? Math.max(inicio, minutosAgora) : inicio;
        const janela = Math.max(fim - de, 1);
        const sorteado = de + Math.floor(Math.random() * janela);
        return montarData(p, sorteado, fuso);
      }
    }
    candidato = new Date(candidato.getTime() + 24 * 60 * 60 * 1000);
    const proximo = partesEm(candidato, fuso);
    candidato = montarData(proximo, 0, fuso);
  }
  return data;
}

/**
 * Inicio da proxima janela util, sem sorteio nenhum. Serve para lote com
 * intervalo fixo: la o minuto aleatorio de proximoHorarioValido destruiria o
 * espacamento entre as mensagens, que e justamente a protecao do numero.
 */
export function inicioDaProximaJanela(data, horario) {
  const dias = horario?.dias || {};
  const temAlgum = Object.values(dias).some(Boolean);
  if (!temAlgum) return data;
  if (dentroDoHorario(data, horario)) return data;

  const fuso = horario.fuso || FUSO;
  let candidato = new Date(data.getTime());

  for (let salto = 0; salto <= 8; salto += 1) {
    const p = partesEm(candidato, fuso);
    const faixa = dias[p.diaSemana];
    if (faixa) {
      const inicio = paraMinutos(faixa.de);
      const fim = paraMinutos(faixa.ate);
      const minutosAgora = p.hora * 60 + p.minuto;
      // Chegando aqui o instante ja esta fora da janela, entao no proprio dia
      // so sobra o caso de ser cedo demais: o lote comeca na abertura.
      if (salto > 0 || minutosAgora <= fim) return montarData(p, inicio, fuso);
    }
    candidato = new Date(candidato.getTime() + 24 * 60 * 60 * 1000);
    candidato = montarData(partesEm(candidato, fuso), 0, fuso);
  }
  return data;
}

export function resumoDoHorario(horario) {
  const nomes = ['Domingo', 'Segunda', 'Terca', 'Quarta', 'Quinta', 'Sexta', 'Sabado'];
  return nomes.map((nome, indice) => {
    const faixa = horario?.dias?.[indice];
    return { dia: indice, nome, faixa: faixa || null };
  });
}
