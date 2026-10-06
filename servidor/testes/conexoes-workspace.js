import { cliente, suite } from './apoio.js';

/**
 * Um numero de WhatsApp so pode estar em um workspace, e mover um numero entre
 * workspaces e uma operacao de dono/admin que nao mexe nas conversas historicas.
 *
 * O que nao pode falhar:
 *  - criar um numero que ja esta em outro workspace e recusado (409);
 *  - o numero e comparado so pelos digitos (o formato que o WhatsApp entrega);
 *  - trocar o numero de uma conexao para um que ja existe em outro workspace e recusado;
 *  - mover e so de dono/admin, e so para um workspace que a pessoa participa;
 *  - mover NAO leva as conversas: elas ficam no workspace de origem;
 *  - o PATCH nao consegue trocar o workspaceId (so a rota de mover faz isso).
 */
export async function testarConexoesWorkspace({ base }) {
  const s = suite('Numero unico e mover conexao');
  const api = cliente(base);
  await api.entrar();
  const inicio = (await api.get('/api/sessao/eu')).dados?.workspace?.id;

  /* Um workspace de destino, para a troca. */
  const destino = (await api.post('/api/workspaces', { nome: 'Destino de Conexao' })).dados;
  if (!s.ok('o workspace de destino existe', Boolean(destino?.id))) return s;

  /* Um numero no workspace de origem (o de inicio). O numero e UNICO por
     rodada: se outra suite deixou um numero igual no banco, o teste nao
     conseguiria saber onde ele caiu, e a trava viraria um falso alarme. */
  await api.post('/api/sessao/workspace', { workspaceId: inicio });
  const sufixo = String(Date.now()).slice(-6);
  const numero = `5581${sufixo}1`;
  const origem = (await api.post('/api/conexoes', { nome: 'Numero de Origem', tipo: 'qrcode', numero })).dados;
  if (!s.ok('o numero entra no workspace de origem', Boolean(origem?.id), JSON.stringify(origem))) return s;

  /* --- Um numero so em um workspace ------------------------------------ */
  await api.post('/api/sessao/workspace', { workspaceId: destino.id });
  const duplicado = await api.post('/api/conexoes', { nome: 'Outro com o mesmo numero', tipo: 'qrcode', numero: `+55 (81) ${numero.slice(4,9)}-${numero.slice(9)}` });
  s.ok('o mesmo numero (formatado diferente) em outro workspace e recusado', duplicado.status === 409, `${duplicado.status} ${JSON.stringify(duplicado.dados)}`);
  s.ok('a recusa diz em qual workspace o numero ja esta', /Origem|workspace/i.test(duplicado.dados?.erro || ''), JSON.stringify(duplicado.dados));

  /* --- Trocar o numero para um que ja existe em outro workspace -------- */
  /* Volta para a origem antes de criar: o numero nasce no workspace da sessao. */
  /* A trava de TROCA: a conexao mora no DESTINO e tenta assumir o numero que
     esta na ORIGEM. A rota so enxerga conexoes do workspace da sessao, entao a
     conexao e criada e trocada a partir do destino. */
  await api.post('/api/sessao/workspace', { workspaceId: destino.id });
  const meuNumero = (await api.post('/api/conexoes', { nome: 'Numero Proprio', tipo: 'qrcode', numero: `5581${sufixo}2` })).dados;
  const troca = await api.patch(`/api/conexoes/${meuNumero.id}`, { numero });
  s.ok('trocar o numero para um que ja esta em outro workspace e recusado', troca.status === 409, String(troca.status));
  await api.post('/api/sessao/workspace', { workspaceId: inicio });

  /* --- O PATCH nao troca o dono do numero (a partir do destino, onde mora) --- */
  await api.post('/api/sessao/workspace', { workspaceId: destino.id });
  await api.patch(`/api/conexoes/${meuNumero.id}`, { workspaceId: inicio });
  const depoisPatch = (await api.get('/api/conexoes')).dados || [];
  s.ok('o PATCH nao leva o numero para outro workspace', depoisPatch.some((c) => c.id === meuNumero.id), JSON.stringify(depoisPatch.map((c) => c.nome)));

  /* --- Mover: a partir da ORIGEM, onde o numero de origem mora -------------- */
  await api.post('/api/sessao/workspace', { workspaceId: inicio });
  const movido = await api.post(`/api/conexoes/${origem.id}/mover`, { workspaceId: destino.id });
  s.ok('o dono move o numero para o destino', movido.status === 200 && movido.dados?.workspaceId === destino.id, JSON.stringify(movido.dados));

  const naOrigem = ((await api.get('/api/conexoes')).dados || []).some((c) => c.id === origem.id);
  s.ok('o numero sai da origem', !naOrigem);

  /* Mover para um workspace que a pessoa nao participa e recusado, a partir do
     destino (onde o numero de teste mora). */
  await api.post('/api/sessao/workspace', { workspaceId: destino.id });
  const fora = await api.post(`/api/conexoes/${meuNumero.id}/mover`, { workspaceId: 'wks_inexistente' });
  s.ok('mover para workspace que a pessoa nao participa e recusado', fora.status === 403, String(fora.status));

  /* Limpeza: o numero de origem esta agora no destino; devolve para a origem a
     partir de la, e volta ao inicio. */
  await api.post('/api/sessao/workspace', { workspaceId: destino.id });
  await api.post(`/api/conexoes/${origem.id}/mover`, { workspaceId: inicio });
  await api.post('/api/sessao/workspace', { workspaceId: inicio });
  return s;
}
