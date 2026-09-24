import { achar, atualizar, atualizarMensagem, listar, mensagensDe } from '../nucleo/banco.js';
import { emitir } from '../nucleo/eventos.js';
import { agora } from '../nucleo/util.js';
import { driverDa } from './drivers/index.js';

/**
 * Baixa, aos poucos, os arquivos das conversas trazidas do celular.
 *
 * A importacao do historico (importar-historico.js) grava cada audio, imagem,
 * video e PDF pelo TIPO, pelo NOME e pela CHAVE — sem o arquivo. Baixar tudo na
 * hora derruba o numero: a conexao e por QR Code (nao oficial), e milhares de
 * downloads em sequencia logo depois de conectar e comportamento de robo. E o
 * mesmo motivo da fila de fotos (fotos.js) andar devagar.
 *
 * Aqui a mesma ideia, para o anexo das mensagens: UM POR VEZ, com intervalo. O
 * escritorio pediu o arquivo salvo de todas as conversas (nao so sob demanda),
 * entao a fila baixa o historico inteiro em segundo plano, sem pressa, e
 * continua de onde parou quando o servidor reinicia — a proxima varredura
 * reencontra o que ainda esta sem arquivo (chave gravada, url vazia).
 *
 * O progresso mora em `conexao.historico.midia`, e a tela le dali:
 *   { situacao: 'baixando' | 'concluido', baixadas, faltam, total, atualizadoEm }
 *
 * CORREIA_MIDIA_INTERVALO existe para o teste, que nao pode esperar: "10" baixa
 * quase sem pausa.
 */

const INTERVALO = Number(process.env.CORREIA_MIDIA_INTERVALO) || 3000;

/** {contatoId, mensagemId, conexaoId} a baixar. */
const fila = [];
/** mensagemId ja na fila, para nao entrar duas vezes. */
const naFila = new Set();
/** mensagemId que falhou nesta rodada do servidor: nao insiste em laco. */
const falharam = new Set();
/** conexaoId -> quantas ja baixaram nesta contagem. */
const baixadasPorConexao = new Map();
let andando = false;

const dormir = (ms) => new Promise((r) => setTimeout(r, ms));

/** A mensagem tem anexo registrado mas sem arquivo salvo? */
function faltaArquivo(mensagem) {
  const m = mensagem?.midia;
  return Boolean(m && m.chave && !m.url);
}

function podeBaixar(conexao) {
  return Boolean(conexao && conexao.tipo === 'qrcode' && conexao.estado === 'conectado' && driverDa(conexao).baixarMidia);
}

function anotarProgresso(conexaoId, extra = {}) {
  const conexao = achar('conexoes', conexaoId);
  if (!conexao) return;
  const daConexao = fila.filter((t) => t.conexaoId === conexaoId).length;
  const baixadas = baixadasPorConexao.get(conexaoId) || 0;
  const midia = {
    ...(conexao.historico?.midia || {}),
    baixadas,
    faltam: daConexao,
    total: baixadas + daConexao,
    atualizadoEm: agora(),
    ...extra,
  };
  atualizar('conexoes', conexaoId, { historico: { ...(conexao.historico || {}), midia } });
  emitir(conexao.workspaceId, 'conexao', { conexaoId });
}

/**
 * Varre as conversas de uma conexao e poe na fila todo anexo ainda sem arquivo.
 * Idempotente: rodar de novo so acrescenta o que apareceu desde a ultima vez.
 * E o que retoma a fila depois de o servidor reiniciar.
 */
export function enfileirarMidiaDaConexao(conexao) {
  if (!podeBaixar(conexao)) return 0;
  let entraram = 0;
  for (const contato of listar('contatos', { workspaceId: conexao.workspaceId, conexaoId: conexao.id })) {
    for (const mensagem of mensagensDe(contato.id)) {
      if (!faltaArquivo(mensagem) || naFila.has(mensagem.id) || falharam.has(mensagem.id)) continue;
      naFila.add(mensagem.id);
      fila.push({ contatoId: contato.id, mensagemId: mensagem.id, conexaoId: conexao.id });
      entraram += 1;
    }
  }
  if (entraram) {
    if (!baixadasPorConexao.has(conexao.id)) baixadasPorConexao.set(conexao.id, 0);
    anotarProgresso(conexao.id, { situacao: 'baixando' });
    andar();
  }
  return entraram;
}

/** Retoma a fila de todas as conexoes conectadas (chamado ao subir o servidor). */
export function retomarMidiaHistorico() {
  for (const conexao of listar('conexoes', { tipo: 'qrcode' })) {
    if (podeBaixar(conexao)) enfileirarMidiaDaConexao(conexao);
  }
}

async function andar() {
  if (andando) return;
  andando = true;
  try {
    while (fila.length) {
      const tarefa = fila.shift();
      try {
        await baixarUma(tarefa);
      } catch {
        /* Falha de um arquivo nao para a fila: fica para a proxima varredura. */
        falharam.add(tarefa.mensagemId);
      } finally {
        naFila.delete(tarefa.mensagemId);
      }
      if (fila.length) await dormir(INTERVALO);
      else finalizar(tarefa.conexaoId);
    }
  } finally {
    andando = false;
  }
}

function finalizar(conexaoId) {
  /* Ainda pode haver tarefa de outra conexao na fila; so encerra a que zerou. */
  if (fila.some((t) => t.conexaoId === conexaoId)) return;
  anotarProgresso(conexaoId, { situacao: 'concluido', concluidoEm: agora() });
}

async function baixarUma({ contatoId, mensagemId, conexaoId }) {
  const conexao = achar('conexoes', conexaoId);
  if (!podeBaixar(conexao)) {
    /* Numero caiu no meio: devolve para a proxima retomada pegar. */
    naFila.delete(mensagemId);
    throw new Error('conexao indisponivel');
  }
  const contato = achar('contatos', contatoId);
  const mensagem = contato ? mensagensDe(contatoId).find((m) => m.id === mensagemId) : null;
  if (!mensagem || !faltaArquivo(mensagem)) return;

  const chave = mensagem.midia.chave || {
    id: mensagem.idExterno,
    remoteJid: contato.lid || `${contato.telefone}@s.whatsapp.net`,
    fromMe: mensagem.direcao === 'saida',
  };
  if (!chave.id) return;

  const baixado = await driverDa(conexao).baixarMidia({
    conexao,
    midia: { ...mensagem.midia, chave, base64: null, nome: mensagem.midia.nome || `${mensagem.tipo}-${mensagem.id}` },
  });
  if (!baixado?.url) {
    /* O WhatsApp ja nao tem mais este arquivo: nao adianta insistir. */
    falharam.add(mensagemId);
    baixadasPorConexao.set(conexaoId, (baixadasPorConexao.get(conexaoId) || 0) + 1);
    anotarProgresso(conexaoId);
    return;
  }

  const { chave: _fora, ...resto } = mensagem.midia;
  atualizarMensagem(contatoId, mensagemId, { midia: { ...resto, ...baixado, tipo: mensagem.midia.tipo || baixado.tipo } });
  baixadasPorConexao.set(conexaoId, (baixadasPorConexao.get(conexaoId) || 0) + 1);
  emitir(conexao.workspaceId, 'mensagem', { contatoId });
  anotarProgresso(conexaoId);
}
