import { achar, atualizar, listar, registrarLog } from '../nucleo/banco.js';
import { emitir } from '../nucleo/eventos.js';
import { agora } from '../nucleo/util.js';
import { importarHistorico } from './importar-historico.js';

/**
 * Traz as conversas do celular sozinho, logo depois de o numero conectar.
 *
 * O celular NAO manda o historico de uma vez. Ele sai em lotes, durante varios
 * minutos depois da leitura do QR Code — e com o historico completo pedido,
 * pode passar de dez minutos num numero antigo. Importar uma vez so, cedo,
 * pegaria so o primeiro lote; esperar o fim nao tem aviso confiavel.
 *
 * Por isso sao TRES rodadas: 1, 5 e 15 minutos depois de conectar. A
 * importacao nao repete mensagem nem recria conversa, entao cada rodada so
 * acrescenta o que chegou desde a anterior. Depois da terceira, o historico e
 * dado como concluido e nao roda de novo sozinho — quem quiser mais uma rodada
 * usa o botao da tela de Conexoes.
 *
 * O estado mora em `conexao.historico`, e a tela le dali:
 *   { situacao: 'aguardando' | 'importando' | 'concluido' | 'erro',
 *     rodada, rodadas, conversas, mensagens, atualizadoEm, concluidoEm, erro }
 *
 * CORREIA_SINCRONIA_ESPERAS existe para o teste, que nao pode esperar quinze
 * minutos: "100,400" roda duas rodadas em meio segundo.
 */
const ESPERAS = String(process.env.CORREIA_SINCRONIA_ESPERAS || '60000,300000,900000')
  .split(',')
  .map(Number)
  .filter((n) => Number.isFinite(n) && n >= 0);

const agendadas = new Map();
/** conexaoId -> a promessa da rodada em andamento. */
const rodando = new Map();

/**
 * Quem fica com as conversas: quem pediu o QR Code desta conexao; se essa
 * pessoa nao existir mais, o primeiro administrador.
 */
export function responsavelDaImportacao(conexao) {
  const doWorkspace = listar('membros', { workspaceId: conexao.workspaceId });
  const membro =
    doWorkspace.find((m) => m.id === conexao.conectadaPor) ||
    doWorkspace.find((m) => m.papel === 'administrador') ||
    null;
  if (!membro) return null;
  const usuario = achar('usuarios', membro.usuarioId);
  return { tipo: 'membro', id: membro.id, nome: usuario?.nome || 'Equipe' };
}

function anotar(conexaoId, mudancas) {
  const atual = achar('conexoes', conexaoId);
  if (!atual) return;
  atualizar('conexoes', conexaoId, { historico: { ...(atual.historico || {}), ...mudancas, atualizadoEm: agora() } });
  emitir(atual.workspaceId, 'conexao', { conexaoId });
}

/** Arma as rodadas. Chamar de novo com rodadas ja armadas nao duplica nada. */
export function agendarSincronizacao(conexao) {
  if (!conexao || conexao.tipo !== 'qrcode' || agendadas.has(conexao.id)) return;
  anotar(conexao.id, { situacao: 'aguardando', rodada: 0, rodadas: ESPERAS.length, erro: null });
  const relogios = ESPERAS.map((espera, i) => {
    /* O erro ja fica anotado na conexao e no log; sem o catch, a promessa
       rejeitada dentro do relogio derrubaria o servidor inteiro. */
    const relogio = setTimeout(() => rodar(conexao.id, i + 1).catch(() => {}), espera);
    if (typeof relogio.unref === 'function') relogio.unref();
    return relogio;
  });
  agendadas.set(conexao.id, relogios);
}

export function cancelarSincronizacao(conexaoId) {
  for (const relogio of agendadas.get(conexaoId) || []) clearTimeout(relogio);
  agendadas.delete(conexaoId);
}

/**
 * Uma rodada. Tambem e o que o botao da tela chama, com `rodada` nulo e a
 * pessoa que clicou como `responsavel`.
 * Devolve o relato da importacao, ou null se ja havia uma rodando.
 */
export async function rodar(conexaoId, rodada = null, responsavelEscolhido = null) {
  const conexao = achar('conexoes', conexaoId);
  if (!conexao || conexao.tipo !== 'qrcode') return null;
  const ultima = rodada !== null && rodada >= ESPERAS.length;
  if (rodada !== null && ultima) agendadas.delete(conexaoId);

  /* Rodada automatica com o numero caido nao tem de onde ler; a proxima tenta. */
  if (rodada !== null && conexao.estado !== 'conectado') return null;

  /* Ja ha uma rodando. O clique na tela desiste (a rota diz que ja esta em
     andamento). A rodada automatica espera e roda em seguida: pular a ULTIMA
     deixaria o historico em "importando" para sempre, e pular uma do meio
     perderia o lote que o celular mandou nesse intervalo. */
  if (rodando.has(conexaoId)) {
    if (rodada === null) return null;
    await rodando.get(conexaoId).catch(() => {});
    if (rodando.has(conexaoId)) return null;
  }

  const responsavel = responsavelEscolhido || responsavelDaImportacao(conexao);
  if (!responsavel) {
    anotar(conexaoId, { situacao: 'erro', erro: 'Nao ha pessoa da equipe para ficar com as conversas.' });
    return null;
  }

  const execucao = executar(conexao, { rodada, ultima, responsavel });
  rodando.set(conexaoId, execucao);
  try {
    return await execucao;
  } finally {
    rodando.delete(conexaoId);
  }
}

async function executar(conexao, { rodada, ultima, responsavel }) {
  const conexaoId = conexao.id;
  const mensagensAntes = achar('conexoes', conexaoId)?.historico?.mensagens || 0;
  anotar(conexaoId, { situacao: 'importando', ...(rodada !== null ? { rodada } : {}) });
  try {
    const relato = await importarHistorico({ conexao, responsavel });
    const conversas = listar('contatos', { workspaceId: conexao.workspaceId, conexaoId }).filter((c) => c.importado).length;
    anotar(conexaoId, {
      situacao: rodada === null || ultima ? 'concluido' : 'importando',
      conversas,
      mensagens: mensagensAntes + relato.mensagensGravadas,
      ...(rodada === null || ultima ? { concluidoEm: agora() } : {}),
      erro: null,
    });
    registrarLog(
      conexao.workspaceId,
      null,
      'conexao_importacao',
      `Conversas do celular: ${relato.conversasImportadas} novas, ${relato.mensagensGravadas} mensagens, ${relato.conversasRenomeadas} renomeadas`,
      null,
      { conexaoId, conexaoNome: conexao.nome },
    );
    emitir(conexao.workspaceId, 'contatos', {});
    return relato;
  } catch (erro) {
    anotar(conexaoId, { situacao: 'erro', erro: erro.message });
    registrarLog(conexao.workspaceId, null, 'conexao_erro', `Importacao das conversas falhou: ${erro.message}`, null, {
      conexaoId,
      conexaoNome: conexao.nome,
    });
    throw erro;
  }
}

/**
 * O servidor reiniciou no meio das rodadas: os relogios morreram com ele.
 * Rearma para toda conexao conectada cujo historico nao chegou ao fim.
 */
export function retomarSincronizacoes() {
  for (const conexao of listar('conexoes', { tipo: 'qrcode' })) {
    const situacao = conexao.historico?.situacao;
    if (conexao.estado === 'conectado' && (situacao === 'aguardando' || situacao === 'importando')) {
      agendarSincronizacao(conexao);
    }
  }
}
