import { achar, atualizar, listar, registrarLog } from '../nucleo/banco.js';
import { emitir } from '../nucleo/eventos.js';
import { agora } from '../nucleo/util.js';
import { importarHistorico } from './importar-historico.js';

/**
 * Traz as conversas do celular sozinho, logo depois de o numero conectar.
 *
 * O celular NAO manda o historico de uma vez. Ele sai em lotes, durante varios
 * minutos depois da leitura do QR Code — e com o historico completo pedido,
 * num numero de escritorio com anos de conversa, passa facil de quinze
 * minutos. Esperar o fim nao tem aviso confiavel.
 *
 * Por isso a importacao roda em RODADAS, e para quando o celular para de
 * mandar: 1, 3, 6, 10 e 15 minutos depois de conectar, e dali de dez em dez
 * ate uma hora. Depois de pelo menos tres rodadas, DUAS seguidas sem nada
 * novo encerram — o historico chegou inteiro. A importacao nao repete
 * mensagem nem recria conversa, entao cada rodada so acrescenta o que chegou
 * desde a anterior, e rodar a mais nao estraga nada.
 *
 * A versao anterior parava na terceira rodada, aos quinze minutos, chegasse o
 * que chegasse: num numero grande, o fim do historico ficava de fora e
 * ninguem era avisado.
 *
 * O estado mora em `conexao.historico`, e a tela le dali:
 *   { situacao: 'aguardando' | 'importando' | 'concluido' | 'erro',
 *     rodada, conversas, mensagens, atualizadoEm, concluidoEm, erro }
 *
 * CORREIA_SINCRONIA_ESPERAS existe para o teste, que nao pode esperar uma
 * hora: "100,400" roda duas rodadas em meio segundo.
 */
const ESPERAS = String(
  process.env.CORREIA_SINCRONIA_ESPERAS || '60000,180000,360000,600000,900000,1500000,2100000,2700000,3600000',
)
  .split(',')
  .map(Number)
  .filter((n) => Number.isFinite(n) && n >= 0);

/** Rodadas que acontecem de qualquer jeito, antes de a calmaria valer. */
const RODADAS_MINIMAS = Math.min(3, ESPERAS.length);
/** Rodadas seguidas sem nada novo que encerram a sincronizacao. */
const RODADAS_CALMAS = 2;

const agendadas = new Map();
/** conexaoId -> a promessa da rodada em andamento. */
const rodando = new Map();
/** conexaoId -> quantas rodadas seguidas vieram sem nada novo. */
const calmas = new Map();

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
  calmas.set(conexao.id, 0);
  anotar(conexao.id, { situacao: 'aguardando', rodada: 0, erro: null });
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
 * Uma rodada. Tambem e o que o botao "Sincronizar tudo" chama, com `rodada`
 * nulo, a pessoa que clicou como `responsavel` e `forcarFotos` — o botao e o
 * pedido explicito de trazer tudo de novo, inclusive as fotos de perfil.
 * Devolve o relato da importacao, ou null se ja havia uma rodando.
 */
export async function rodar(conexaoId, rodada = null, responsavelEscolhido = null, { forcarFotos = false } = {}) {
  const conexao = achar('conexoes', conexaoId);
  if (!conexao || conexao.tipo !== 'qrcode') return null;
  /* Na ultima rodada nao ha mais relogio armado: sai do mapa ja, para uma
     reconexao futura conseguir armar tudo de novo mesmo se esta falhar. */
  if (rodada !== null && rodada >= ESPERAS.length) agendadas.delete(conexaoId);

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

  const execucao = executar(conexao, { rodada, responsavel, forcarFotos });
  rodando.set(conexaoId, execucao);
  try {
    return await execucao;
  } finally {
    rodando.delete(conexaoId);
  }
}

async function executar(conexao, { rodada, responsavel, forcarFotos }) {
  const conexaoId = conexao.id;
  const mensagensAntes = achar('conexoes', conexaoId)?.historico?.mensagens || 0;
  anotar(conexaoId, { situacao: 'importando', ...(rodada !== null ? { rodada } : {}) });
  try {
    const relato = await importarHistorico({ conexao, responsavel, forcarFotos });

    /* Fim da sincronizacao automatica: a ultima rodada, ou a calmaria depois
       das rodadas minimas. O clique manual encerra so se nao houver rodada
       automatica por vir — senao ela mesma encerra quando chegar a hora. */
    let terminou;
    if (rodada === null) {
      terminou = !agendadas.has(conexaoId);
    } else {
      const novidade = relato.conversasImportadas + relato.mensagensGravadas > 0;
      calmas.set(conexaoId, novidade ? 0 : (calmas.get(conexaoId) || 0) + 1);
      terminou =
        rodada >= ESPERAS.length || (rodada >= RODADAS_MINIMAS && calmas.get(conexaoId) >= RODADAS_CALMAS);
      if (terminou) cancelarSincronizacao(conexaoId);
    }

    const conversas = listar('contatos', { workspaceId: conexao.workspaceId, conexaoId }).filter((c) => c.importado).length;
    anotar(conexaoId, {
      situacao: terminou ? 'concluido' : 'importando',
      conversas,
      mensagens: mensagensAntes + relato.mensagensGravadas,
      ...(terminou ? { concluidoEm: agora() } : {}),
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
