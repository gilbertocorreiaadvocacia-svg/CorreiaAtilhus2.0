/**
 * Canal de tempo real (SSE). O navegador abre uma conexao em /api/eventos e o
 * servidor empurra as novidades: mensagem que chegou, status que mudou,
 * conversa que trocou de responsavel. Sem WebSocket e sem biblioteca.
 */

const inscritos = new Set();

export function inscrever(res, contexto) {
  res.writeHead(200, {
    'Content-Type': 'text/event-stream; charset=utf-8',
    'Cache-Control': 'no-cache, no-transform',
    Connection: 'keep-alive',
    'X-Accel-Buffering': 'no',
  });
  res.write(': conectado ao Correiatendimentos\n\n');

  const inscrito = { res, ...contexto };
  inscritos.add(inscrito);

  const batida = setInterval(() => {
    try {
      res.write(': ping\n\n');
    } catch {
      encerrar();
    }
  }, 25000);
  if (typeof batida.unref === 'function') batida.unref();

  function encerrar() {
    clearInterval(batida);
    inscritos.delete(inscrito);
  }

  res.on('close', encerrar);
  res.on('error', encerrar);
  return inscrito;
}

/** Envia um evento para todo mundo que esta com aquele workspace aberto. */
export function emitir(workspaceId, tipo, dados = {}) {
  const pacote = `event: ${tipo}\ndata: ${JSON.stringify({ tipo, ...dados })}\n\n`;
  for (const inscrito of inscritos) {
    if (workspaceId && inscrito.workspaceId !== workspaceId) continue;
    try {
      inscrito.res.write(pacote);
    } catch {
      inscritos.delete(inscrito);
    }
  }
}

/** Evento dirigido a uma pessoa so, usado nas notificacoes do sino. */
export function emitirParaUsuario(usuarioId, tipo, dados = {}) {
  const pacote = `event: ${tipo}\ndata: ${JSON.stringify({ tipo, ...dados })}\n\n`;
  for (const inscrito of inscritos) {
    if (inscrito.usuarioId !== usuarioId) continue;
    try {
      inscrito.res.write(pacote);
    } catch {
      inscritos.delete(inscrito);
    }
  }
}

export function totalConectados() {
  return inscritos.size;
}
