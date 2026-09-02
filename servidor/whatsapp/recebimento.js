import {
  achar,
  apagarMensagens,
  atualizar,
  atualizarMensagem,
  inserir,
  inserirMensagem,
  listar,
  mensagensDe,
  registrarLog,
} from '../nucleo/banco.js';
import { emitir } from '../nucleo/eventos.js';
import { agora, normalizar, normalizarTelefone, novoId } from '../nucleo/util.js';
import { agendarResposta, agentePorPalavraChave, cancelarResposta } from '../ia/motor.js';
import { agendarFollowupsDoStatus, cancelarFollowups, limparAgendamentosDoContato, reagendarFollowups } from '../automacao/followup.js';
import { marcarComoLida } from './envio.js';
import { baixarMidiaDaMeta } from './midia.js';
import { transcrever, transcricaoDisponivel } from '../ia/audio.js';

/**
 * Porta de entrada unica: tanto o webhook da Meta quanto o simulador chamam
 * aqui. Toda regra de primeira mensagem, criar contato, aplicar os padroes da
 * conexao, detectar origem, ativar agente por palavra-chave, mora neste
 * arquivo, para nao existirem dois caminhos que divergem com o tempo.
 */

export function acharOuCriarContato({ workspaceId, conexao, telefone, nome = '', foto = null }) {
  const numero = normalizarTelefone(telefone);
  let contato = listar('contatos', { workspaceId }).find(
    (c) => c.telefone === numero && c.conexaoId === conexao.id,
  );
  if (contato) return { contato, novo: false };

  contato = inserir('contatos', {
    id: novoId('ctt'),
    workspaceId,
    conexaoId: conexao.id,
    telefone: numero,
    nome: nome || numero,
    foto,
    statusId: conexao.statusPadraoId || null,
    departamentoId: conexao.departamentoPadraoId || null,
    etiquetas: [],
    origemId: null,
    responsavel: conexao.responsavelPadrao ? { ...conexao.responsavelPadrao } : null,
    variaveis: {},
    estado: conexao.responsavelPadrao?.tipo === 'agente' ? 'ia' : 'pendente',
    naoLidas: 0,
    modoAudio: false,
    arquivos: [],
    mencoesRecentes: [],
    previa: '',
  });

  if (contato.responsavel?.tipo === 'agente') {
    const agente = achar('agentes', contato.responsavel.id);
    if (agente) contato.responsavel.nome = agente.nome;
  }

  registrarLog(workspaceId, contato.id, 'criacao', 'Conversa iniciada');

  /*
   * O status padrao da conexao tambem e uma mudanca de status, e precisa do
   * mesmo log que aplicarStatus grava. O dashboard le o funil desses
   * logs; sem ele a distribuicao (que le o status atual da conversa) mostrava a
   * conversa em Qualificado enquanto o cartao Qualificado da mesma tela ficava
   * em zero, e os dois blocos se contradiziam.
   */
  if (contato.statusId) {
    const status = achar('status', contato.statusId);
    if (status) {
      registrarLog(
        workspaceId,
        contato.id,
        'status',
        `Status: sem status -> ${status.nome}`,
        { tipo: 'sistema', nome: 'Conexao' },
        { statusId: status.id, tipo: status.tipo || 'nenhum', anteriorId: null },
      );
    }
  }

  return { contato, novo: true };
}

function detectarOrigem(workspaceId, texto) {
  const alvo = normalizar(texto);
  if (!alvo) return null;
  for (const origem of listar('origens', { workspaceId })) {
    for (const palavra of origem.palavrasChave || []) {
      if (palavra && alvo.includes(normalizar(palavra))) return origem;
    }
  }
  return null;
}

/**
 * /restart, o mesmo atalho da auditoria. Limpa a conversa e devolve tudo ao
 * estado de lead novo, para testar o agente do comeco sem trocar de numero.
 */
function reiniciarConversa(contato, conexao) {
  cancelarResposta(contato.id);
  limparAgendamentosDoContato(contato.id);
  apagarMensagens(contato.id);

  const responsavel = conexao.responsavelPadrao ? { ...conexao.responsavelPadrao } : null;
  if (responsavel?.tipo === 'agente') {
    const agente = achar('agentes', responsavel.id);
    if (agente) responsavel.nome = agente.nome;
  }

  atualizar('contatos', contato.id, {
    statusId: conexao.statusPadraoId || null,
    departamentoId: conexao.departamentoPadraoId || null,
    etiquetas: [],
    variaveis: {},
    responsavel,
    estado: responsavel?.tipo === 'agente' ? 'ia' : 'pendente',
    naoLidas: 0,
    aceitoPor: null,
    modoAudio: false,
    previa: '',
    primeiraMensagemEm: null,
  });

  registrarLog(contato.workspaceId, contato.id, 'restart', 'Conversa reiniciada pelo comando /restart');
  emitir(contato.workspaceId, 'contato', { contatoId: contato.id });

  const atualizado = achar('contatos', contato.id);
  inserirMensagem(contato.id, {
    id: novoId('msg'),
    workspaceId: contato.workspaceId,
    direcao: 'interna',
    tipo: 'texto',
    conteudo: 'Conversa reiniciada. O agente vai atender como se fosse um lead novo.',
    autor: { tipo: 'sistema', nome: 'Sistema' },
    nota: true,
    situacao: 'enviada',
  });
  return atualizado;
}

/**
 * Processa uma mensagem que chegou. Devolve o contato e a mensagem gravada.
 */
export async function receberMensagem({
  workspaceId,
  conexao,
  telefone,
  nome = '',
  tipo = 'texto',
  conteudo = '',
  midia = null,
  idExterno = null,
  metadados = null,
}) {
  const { contato, novo } = acharOuCriarContato({ workspaceId, conexao, telefone, nome });

  if (String(conteudo).trim().toLowerCase() === '/restart') {
    return { contato: reiniciarConversa(contato, conexao), mensagem: null, reiniciado: true };
  }

  const primeira = novo || !contato.primeiraMensagemEm;

  // Na Cloud API o anexo chega como id. Baixamos na hora: a URL da Meta expira.
  let anexo = midia;
  if (anexo?.id && conexao.tipo === 'oficial') {
    const baixado = await baixarMidiaDaMeta(conexao, anexo.id, anexo.nome);
    if (baixado) anexo = { ...anexo, ...baixado };
  }

  // Audio sem transcricao e uma conversa que o agente nao consegue ler.
  let transcricao = null;
  if (anexo?.tipo === 'audio' && anexo.url && transcricaoDisponivel(workspaceId)) {
    transcricao = await transcrever({ workspaceId, contatoId: contato.id, midia: anexo });
  }

  const mensagem = inserirMensagem(contato.id, {
    id: novoId('msg'),
    workspaceId,
    direcao: 'entrada',
    tipo,
    conteudo: transcricao || conteudo,
    transcricao,
    midia: anexo,
    idExterno,
    metadados,
    autor: { tipo: 'cliente', nome: contato.nome },
    situacao: 'recebida',
  });

  const mudancas = {
    ultimaMensagemEm: mensagem.criadoEm,
    ultimaEntradaEm: mensagem.criadoEm,
    naoLidas: (contato.naoLidas || 0) + 1,
    previa: (mensagem.conteudo || `[${tipo}]`).slice(0, 120),
  };

  if (primeira) {
    mudancas.primeiraMensagemEm = mensagem.criadoEm;
    const origem = detectarOrigem(workspaceId, mensagem.conteudo);
    if (origem) mudancas.origemId = origem.id;
    if (metadados?.ctwaClid) {
      mudancas.anuncio = metadados;
    }
  }

  // Arquivada volta para a fila assim que o cliente escreve.
  if (contato.estado === 'arquivado') {
    mudancas.estado = contato.responsavel?.tipo === 'agente' ? 'ia' : 'pendente';
    registrarLog(workspaceId, contato.id, 'desarquivar', 'Conversa reaberta porque o cliente escreveu');
  }

  // Palavra-chave so ativa agente na abertura da conversa, nunca no meio dela.
  if (primeira && mensagem.conteudo) {
    const agente = agentePorPalavraChave(workspaceId, mensagem.conteudo);
    if (agente && (!contato.responsavel || contato.responsavel.tipo === 'agente')) {
      mudancas.responsavel = { tipo: 'agente', id: agente.id, nome: agente.nome };
      mudancas.estado = 'ia';
      registrarLog(workspaceId, contato.id, 'palavra_chave', `Agente ${agente.nome} ativado por palavra-chave`);
    }
  }

  atualizar('contatos', contato.id, mudancas);
  Object.assign(contato, mudancas);

  reagendarFollowups(contato);

  if (idExterno) marcarComoLida(conexao, idExterno).catch(() => {});

  emitir(workspaceId, 'mensagem', { contatoId: contato.id, mensagem });
  emitir(workspaceId, 'contato', { contatoId: contato.id });

  if (contato.responsavel?.tipo === 'agente' && contato.estado === 'ia') {
    agendarResposta(contato);
  }

  return { contato, mensagem, novo };
}

/** Atualiza o estado de entrega vindo da Meta (enviada, entregue, lida, erro). */
export function atualizarSituacaoExterna(workspaceId, idExterno, situacao, erro = null) {
  for (const contato of listar('contatos', { workspaceId })) {
    const mensagem = mensagensDe(contato.id).find((m) => m.idExterno === idExterno);
    if (!mensagem) continue;
    atualizarMensagem(contato.id, mensagem.id, { situacao, erro, atualizadaEm: agora() });
    emitir(workspaceId, 'mensagem-situacao', { contatoId: contato.id, mensagemId: mensagem.id, situacao });
    return true;
  }
  return false;
}

export { agendarFollowupsDoStatus, cancelarFollowups };
