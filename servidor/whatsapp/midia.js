import { guardarBuffer } from '../nucleo/midia.js';

const GRAPH = 'https://graph.facebook.com/v21.0';

/**
 * Na Cloud API a mensagem com anexo nao traz o arquivo: traz um id. Para ver o
 * audio, a foto do laudo ou o PDF que o cliente mandou, e preciso pedir a URL
 * a Meta e baixar com o token. A URL vale poucos minutos, por isso guardamos
 * o arquivo aqui na hora em que ele chega.
 */
export async function baixarMidiaDaMeta(conexao, idMidia, nomeSugerido = '') {
  const token = conexao?.oficial?.token;
  if (!token || !idMidia) return null;

  try {
    const meta = await fetch(`${GRAPH}/${idMidia}`, { headers: { Authorization: `Bearer ${token}` } });
    const dados = await meta.json().catch(() => ({}));
    if (!meta.ok || !dados.url) return null;

    const arquivo = await fetch(dados.url, { headers: { Authorization: `Bearer ${token}` } });
    if (!arquivo.ok) return null;

    const conteudo = Buffer.from(await arquivo.arrayBuffer());
    return guardarBuffer({
      nome: nomeSugerido || `whatsapp-${idMidia}`,
      dados: conteudo,
      mime: dados.mime_type || arquivo.headers.get('content-type') || 'application/octet-stream',
    });
  } catch {
    return null;
  }
}
