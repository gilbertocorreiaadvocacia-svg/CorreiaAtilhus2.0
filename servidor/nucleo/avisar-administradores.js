import { inserir, listar } from './banco.js';
import { emitirParaUsuario } from './eventos.js';
import { novoId } from './util.js';

/**
 * Um aviso no sino para o dono e os administradores do escritorio.
 *
 * Existia em duas formas: a copia que o aviso de template tem desde 30/10/2026 e
 * a de notificar() em ia/mencoes.js. Esta fica fora de mencoes.js de proposito:
 * quem a usa (envio.js, via uso-dos-templates.js) e importado por mencoes.js, e
 * importar de la formaria um ciclo.
 *
 * `tipo` e o mesmo campo que a tela usa para o icone; 'ia' e o de aviso do
 * sistema sobre a IA. Devolve quantas pessoas foram avisadas.
 */
export function avisarAdministradores(workspaceId, { titulo, texto, tipo = 'ia', contatoId = null }) {
  let avisados = 0;
  for (const membro of listar('membros', { workspaceId })) {
    if (!['owner', 'admin'].includes(membro.papel)) continue;
    const notificacao = inserir('notificacoes', {
      id: novoId('ntf'),
      workspaceId,
      membroId: membro.id,
      usuarioId: membro.usuarioId,
      tipo,
      titulo,
      texto,
      contatoId,
      tarefaId: null,
      conexaoId: null,
      lida: false,
    });
    emitirParaUsuario(workspaceId, membro.usuarioId, 'notificacao', { notificacao });
    avisados += 1;
  }
  return avisados;
}
