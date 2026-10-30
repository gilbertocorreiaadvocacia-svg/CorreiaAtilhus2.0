import { atualizar, listar } from './banco.js';
import { PARES_DE_ACENTO } from './acentos-pares.js';

/**
 * O portugues dos agentes, com acento.
 *
 * Pedido do escritorio em 30/10/2026: "o portugues dos agentes esta sem acentos,
 * modifique isso em todos". Tres fontes de texto sem acento, as tres corrigidas
 * na origem (nucleo/seed.js, ia/pacotes.js, ia/motor.js, mencoes.js e as
 * mensagens escritas no codigo):
 *   - os agentes, templates e a base de conhecimento de exemplo da instalacao
 *     (a pasta "Meus Agentes");
 *   - os tres agentes do Civel;
 *   - as instrucoes que o sistema da ao modelo, que o faziam imitar a falta de
 *     acento — e a regra nova em ia/motor.js, que manda escrever com acento
 *     mesmo quando o roteiro nao esta.
 *
 * Consertar a origem nao muda o que ja esta GRAVADO no escritorio: o prompt de um
 * agente instalado e uma copia. Esta rotina troca, nessas copias, so as linhas
 * INTEIRAS que o proprio sistema escreveu (acentos-pares.js, gerado comparando o
 * texto antigo com o novo). Linha que a equipe escreveu ou mexeu nao bate com
 * nenhuma delas e fica como esta. Idempotente: depois da troca nao ha mais o que
 * trocar.
 */

const POR_LINHA = new Map(PARES_DE_ACENTO);

export function acentuarLinhas(texto) {
  if (typeof texto !== 'string' || !texto) return texto;
  const quebra = texto.includes('\r\n') ? '\r\n' : '\n';
  let mudou = false;
  const linhas = texto.split(quebra).map((linha) => {
    const certa = POR_LINHA.get(linha);
    if (certa === undefined) return linha;
    mudou = true;
    return certa;
  });
  return mudou ? linhas.join(quebra) : texto;
}

export function corrigirAcentosDosAgentes() {
  const mudados = { agentes: 0, templates: 0, conhecimento: 0 };
  for (const agente of listar('agentes')) {
    const prompt = acentuarLinhas(agente.prompt);
    if (prompt !== agente.prompt) {
      atualizar('agentes', agente.id, { prompt });
      mudados.agentes += 1;
    }
  }
  for (const template of listar('templates')) {
    const conteudo = acentuarLinhas(template.conteudo);
    if (conteudo !== template.conteudo) {
      atualizar('templates', template.id, { conteudo });
      mudados.templates += 1;
    }
  }
  for (const item of listar('conhecimento')) {
    const conteudo = acentuarLinhas(item.conteudo);
    if (conteudo !== item.conteudo) {
      atualizar('conhecimento', item.id, { conteudo });
      mudados.conhecimento += 1;
    }
  }
  return mudados;
}

/* ------------------------------------------------------------------ */
/* Conferir: quanto ainda esta sem acento                              */
/* ------------------------------------------------------------------ */

/* Palavras que nao existem sem acento no portugues, ou quase nunca (nao entram e/é, esta/está, analise, numero). */
const SEM_ACENTO = [
  'voce', 'voces', 'nao', 'tambem', 'beneficio', 'beneficios', 'informacao', 'informacoes', 'atencao', 'servico', 'servicos',
  'possivel', 'ultimo', 'ultima', 'proximo', 'proxima', 'conferencia', 'procuracao', 'entao', 'ja', 'documentacao', 'solicitacao',
  'sao', 'estao', 'ola', 'escritorio', 'escritorios', 'auxilio', 'salario', 'previdenciario', 'honorarios', 'juridico', 'apos',
  'alem', 'alguem', 'ninguem', 'porem', 'avaliacao', 'situacao', 'historico', 'codigo', 'pagina', 'decisao', 'orientacao',
  'contratacao', 'obrigatorio', 'obrigatoria', 'necessario', 'necessaria', 'periodo', 'familia', 'contribuicao', 'contribuicoes',
  'concessao', 'indenizacao', 'acao', 'acoes', 'licenca', 'deficiencia', 'carencia', 'video', 'audio', 'conteudo', 'ligacao',
  'reuniao', 'saude', 'doenca', 'laudo_', 'confirmacao', 'explicacao', 'transicao', 'transferencia',
].filter((p) => !p.endsWith('_'));
const PALAVRA_SEM_ACENTO = new RegExp(`(?<![\\p{L}@#_/\\-{])(${SEM_ACENTO.join('|')})(?![\\p{L}_\\-}])`, 'giu');

/*
 * Fora da conta: o que nao e fala. Mencao (@agente), variavel ({{nome}}) e o NOME de
 * etiqueta, status, departamento ou momento entre aspas ("Documentacao pendente"):
 * a busca desses nomes ignora acento, e eles existem sem acento em escritorios antigos.
 */
const NAO_E_FALA = [/\{\{[^}]*\}\}/g, /@(?:tag|status|departamento|momento|etiqueta)\s+(?:para\s+)?"[^"]*"/gi, /@[\p{L}\d_#\-][^\s,.;:!?)]*/gu];

export function palavrasSemAcento(texto) {
  let fala = String(texto || '');
  for (const re of NAO_E_FALA) fala = fala.replace(re, ' ');
  return [...fala.matchAll(PALAVRA_SEM_ACENTO)].map((m) => m[1].toLowerCase());
}

/** Para /api/saude: os agentes do escritorio que ainda tem palavra sem acento, e quantas. Sem o texto. */
export function agentesSemAcento(workspaceId) {
  return listar('agentes', { workspaceId })
    .map((agente) => ({ agente: agente.nome, palavras: palavrasSemAcento(agente.prompt).length }))
    .filter((a) => a.palavras > 0)
    .sort((a, b) => b.palavras - a.palavras);
}
