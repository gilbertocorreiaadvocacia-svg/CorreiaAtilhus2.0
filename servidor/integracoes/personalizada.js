import { achar } from '../nucleo/banco.js';
import { aplicarVariaveis, normalizar } from '../nucleo/util.js';

/**
 * Chamada personalizada: liga o agente a qualquer sistema que fale HTTP -
 * n8n, Make, Zapier ou uma rota do proprio escritorio. Cada chamada cadastrada
 * vira uma ferramenta nova para os agentes que a mencionarem.
 *
 * Em toda execucao vai junto um objeto "metadados" com o rastro do anuncio
 * (CTWA Clid), que a Meta envia quando o lead chega por Click-to-WhatsApp. E
 * assim que da para saber qual criativo gerou qual contrato.
 */
export async function executarCustomTool({ workspaceId, nomeFerramenta, contato, argumentos }) {
  const integracoes = achar('integracoes', { workspaceId });
  const ferramentas = integracoes?.customTools || [];

  const alvo = nomeFerramenta.replace(/^personalizada_/, '');
  const ferramenta = ferramentas.find(
    (f) => normalizar(f.nome).replace(/[^a-z0-9]+/g, '_') === alvo,
  );
  if (!ferramenta) return { erro: `Chamada personalizada "${alvo}" nao encontrada.` };
  if (!ferramenta.url) return { erro: `A chamada "${ferramenta.nome}" esta sem URL configurada.` };

  const valores = {
    ...(contato.variaveis || {}),
    nome: contato.nome,
    telefone: contato.telefone,
    ...argumentos,
  };

  const metadados = contato.anuncio || {};
  const url = aplicarVariaveis(ferramenta.url, valores);
  const metodo = (ferramenta.metodo || 'POST').toUpperCase();

  const opcoes = {
    method: metodo,
    headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
  };
  for (const cabecalho of ferramenta.cabecalhos || []) {
    if (cabecalho.chave) opcoes.headers[cabecalho.chave] = aplicarVariaveis(cabecalho.valor || '', valores);
  }

  if (metodo !== 'GET' && metodo !== 'DELETE') {
    opcoes.body = JSON.stringify({
      ...argumentos,
      contato: {
        id: contato.id,
        nome: contato.nome,
        telefone: contato.telefone,
        variaveis: contato.variaveis || {},
      },
      metadata: {
        ctwaClid: metadados.ctwaClid || null,
        title: metadados.title || null,
        mediaURL: metadados.mediaURL || null,
        sourceID: metadados.sourceID || null,
        sourceApp: metadados.sourceApp || null,
        sourceURL: metadados.sourceURL || null,
        sourceType: metadados.sourceType || null,
        clickToWhatsappCall: metadados.clickToWhatsappCall ?? null,
      },
    });
  }

  try {
    const controlador = new AbortController();
    const prazo = setTimeout(() => controlador.abort(), 20000);
    const resposta = await fetch(url, { ...opcoes, signal: controlador.signal });
    clearTimeout(prazo);

    const texto = await resposta.text();
    let corpo;
    try {
      corpo = JSON.parse(texto);
    } catch {
      corpo = texto.slice(0, 2000);
    }

    if (!resposta.ok) {
      return { erro: `A chamada "${ferramenta.nome}" respondeu ${resposta.status}.`, corpo };
    }
    return { ok: true, resultado: corpo };
  } catch (erro) {
    return { erro: `Falha na chamada "${ferramenta.nome}": ${erro.message}` };
  }
}
