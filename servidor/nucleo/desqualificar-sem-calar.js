import { DESQUALIFICAR_NAO_E_ENCERRAR } from '../ia/pacotes/comum.js';
import { atualizar, listar } from './banco.js';
import { agora } from './util.js';

/**
 * Pedido do escritorio em 10/11/2026: "o agente atende normalmente e, em um
 * determinado momento, coloca em Desqualificado e simplesmente para de
 * atender". O roteiro mandava marcar o status e chamar a mencao que desliga a
 * IA na MESMA frase; a ferramenta grava responsavel: null e estado: 'pendente'
 * (ia/mencoes.js), e dali em diante nada mais responde — as guardas do motor
 * (ia/motor.js) e do recebimento (whatsapp/recebimento.js) olham o
 * RESPONSAVEL, nunca o status. O status sozinho nunca calou ninguem.
 *
 * O pacote ja nao pareia mais as duas coisas. Aqui a ordem sai dos agentes JA
 * instalados, que guardam uma copia do prompt (ia/pacotes.js nunca sobrescreve
 * agente de mesmo nome).
 *
 * LINHA A LINHA, e nao paragrafo inteiro: o escritorio edita roteiro na tela, e
 * comparar paragrafo nao bateria mais. De cada linha que MANDA desligar sai so
 * o fragmento da ordem — o resto da frase (o @status, a @tag, o @responsavel, a
 * explicacao ao cliente) fica exatamente como esta.
 *
 * A linha "PASSAGEM PARA PESSOA" (ia/pacotes/comum.js, e a copia no
 * auxilio-acidente) cita a mencao de proposito: e ela que CONCEDE a ferramenta
 * para a passagem legitima a um humano, e nao e ordem de desqualificacao. Fica
 * intocada — e e por isso que entra tambem a trava DESQUALIFICAR_NAO_E_ENCERRAR,
 * logo depois dela, dizendo que desqualificar nao e motivo para calar.
 *
 * Uma vez por agente (desqualificarSemCalarEm): quem apagar a trava na tela nao
 * a ve voltar no reinicio seguinte.
 */

/* O rotulo abre a linha explicativa nas duas variantes do codigo, e sobrevive a
   reescrita do escritorio. */
const EXPLICA_A_PASSAGEM = /PASSAGEM PARA PESSOA/i;

/*
 * A ordem de desligar, com a conjuncao e o verbo que costumam vir junto:
 * " e use @desativarIA", ", use @desativarIA", " e @desativarIA",
 * " e chame @desativarIA", "use o @desativarIA".
 *
 * Sem distincao de maiuscula: analisarPrompt (ia/mencoes.js) acha a mencao por
 * normalizar(), entao "@DesativarIA" concede a ferramenta do mesmo jeito.
 */
const ORDEM_DE_CALAR = /\s*(?:,|;)?\s*(?:\be\b\s*)?(?:use|usar|chame|chamar|acione|acionar|ative|ativar)?\s*o?\s*@desativarIA\b/gi;

/** Pontuacao orfa que a remocao deixa: " .", ",.", " e .", espaco dobrado. */
function arrumarSobras(linha) {
  return linha
    .replace(/\s+([.,;:!?])/g, '$1')
    .replace(/,\s*\./g, '.')
    .replace(/\s+\be\b\s*\./g, '.')
    .replace(/\s{2,}/g, ' ')
    .replace(/[,;]\s*$/, '.')
    .trimEnd();
}

/** A linha manda desligar a IA (e nao e a explicacao da passagem)? */
const mandaCalar = (linha) => /@desativarIA/i.test(linha) && !EXPLICA_A_PASSAGEM.test(linha);

/** Tira a ordem de todas as linhas que a tem. Devolve o prompt novo e quantas linhas mudaram. */
export function tirarAOrdemDeCalar(prompt) {
  const texto = String(prompt || '');
  const quebra = texto.includes('\r\n') ? '\r\n' : '\n';
  let linhasMudadas = 0;
  const linhas = texto.split(quebra).map((linha) => {
    if (!mandaCalar(linha)) return linha;
    const nova = arrumarSobras(linha.replace(ORDEM_DE_CALAR, ''));
    if (nova === linha) return linha;
    linhasMudadas += 1;
    return nova;
  });
  return { prompt: linhasMudadas ? linhas.join(quebra) : texto, linhasMudadas };
}

/** Poe a trava junto da linha que concede a ferramenta; sem ela, no fim do prompt. */
function comATrava(prompt) {
  if (prompt.includes(DESQUALIFICAR_NAO_E_ENCERRAR)) return prompt;
  const quebra = prompt.includes('\r\n') ? '\r\n' : '\n';
  const linhas = prompt.split(quebra);
  const i = linhas.findIndex((linha) => EXPLICA_A_PASSAGEM.test(linha));
  if (i < 0) return `${prompt.trimEnd()}${quebra}${quebra}${DESQUALIFICAR_NAO_E_ENCERRAR}`;
  linhas.splice(i + 1, 0, '', DESQUALIFICAR_NAO_E_ENCERRAR);
  return linhas.join(quebra);
}

/** Roda na subida, em todo agente de todo escritorio. Devolve quantos mudaram. */
export function desqualificarSemCalar() {
  let mudados = 0;
  for (const agente of listar('agentes')) {
    if (agente.desqualificarSemCalarEm) continue;
    const prompt = String(agente.prompt || '');
    const { prompt: semAOrdem, linhasMudadas } = tirarAOrdemDeCalar(prompt);
    /* Agente que nunca teve a ordem fica como esta — e nem ganha a trava, que so
       faz sentido para quem tinha o par desqualificar+desligar. */
    const novo = linhasMudadas ? comATrava(semAOrdem) : semAOrdem;
    atualizar('agentes', agente.id, { prompt: novo, desqualificarSemCalarEm: agora() });
    if (novo !== prompt) mudados += 1;
  }
  return mudados;
}

/** Para /api/saude: quem ainda manda desligar a IA, e quem esta sem a trava. */
export function desqualificacaoNosAgentes(workspaceId) {
  return listar('agentes', { workspaceId })
    .map((agente) => {
      const prompt = String(agente.prompt || '');
      return {
        agente: agente.nome,
        ordensDeDesligar: prompt.split(/\r?\n/).filter(mandaCalar).length,
        temATrava: prompt.includes(DESQUALIFICAR_NAO_E_ENCERRAR),
      };
    })
    .filter((a) => a.ordensDeDesligar > 0)
    .sort((a, b) => b.ordensDeDesligar - a.ordensDeDesligar);
}
