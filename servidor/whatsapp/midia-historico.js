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
 *
 * ACHADO EM 09/11/2026: um anexo que falhasse (a Evolution fora do ar um
 * instante, um tempo limite, qualquer blip) ficava marcado como "ja tentei,
 * nao insisto" PARA SEMPRE — ate o proximo deploy reiniciar o processo e
 * zerar essa marca. Um fim de semana inteiro sem deploy (ver vida das
 * subidas no /api/saude) e um anexo perdido vira um anexo perdido ATE
 * SEGUNDA: o cliente manda a foto do RG, a equipe (ou o agente de IA, que le
 * so o texto da conversa) nunca ve nada alem do cartao "ainda nao baixado".
 * Agora a falha espera e tenta de novo sozinha (ESPERAS_DA_FALHA), e uma
 * varredura periodica (nao so a do boot) reencontra o que ainda falta —
 * sem precisar reiniciar o servidor nem alguem clicar em Carregar.
 */

const INTERVALO = Number(process.env.CORREIA_MIDIA_INTERVALO) || 3000;
const INTERVALO_DA_VARREDURA = Number(process.env.CORREIA_MIDIA_VARREDURA_INTERVALO) || 15 * 60 * 1000;
const ESPERAS_DA_FALHA = (() => {
  const doAmbiente = (process.env.CORREIA_MIDIA_ESPERAS || '').split(',').map(Number).filter((n) => n > 0);
  return doAmbiente.length ? doAmbiente : [5 * 60000, 15 * 60000, 60 * 60000, 6 * 60 * 60000, 24 * 60 * 60000];
})();

/** {contatoId, mensagemId, conexaoId} a baixar. */
const fila = [];
/** mensagemId ja na fila, para nao entrar duas vezes. */
const naFila = new Set();
/** mensagemId que falhou: quantas vezes, e quando vale tentar de novo — nunca
    para sempre, um blip da Evolution nao pode travar o anexo ate o proximo deploy. */
const falharam = new Map();
/** conexaoId -> quantas ja baixaram nesta contagem. */
const baixadasPorConexao = new Map();
let andando = false;
let varreduraPeriodicaIniciada = false;

const dormir = (ms) => new Promise((r) => setTimeout(r, ms));
const aindaNaEspera = (mensagemId) => {
  const registro = falharam.get(mensagemId);
  return Boolean(registro && registro.proximaTentativaEm > Date.now());
};

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
      if (!faltaArquivo(mensagem) || naFila.has(mensagem.id) || aindaNaEspera(mensagem.id)) continue;
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

function varrerTodasAsConexoes() {
  for (const conexao of listar('conexoes', { tipo: 'qrcode' })) {
    if (podeBaixar(conexao)) enfileirarMidiaDaConexao(conexao);
  }
}

/**
 * Retoma a fila de todas as conexoes conectadas (chamado ao subir o servidor),
 * e arma a varredura periodica — para o anexo que falhou sozinho ser
 * reencontrado sem precisar de um deploy para isso.
 */
export function retomarMidiaHistorico() {
  varrerTodasAsConexoes();
  if (varreduraPeriodicaIniciada) return;
  varreduraPeriodicaIniciada = true;
  setInterval(varrerTodasAsConexoes, INTERVALO_DA_VARREDURA);
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
        /* Falha de um arquivo nao para a fila: fica para a proxima varredura
           (achado em 09/11/2026: `falharam` virou Map nesse mesmo dia, e este
           catch — o de QUANDO A PROPRIA TAREFA LANCA, como a conexao caindo no
           meio — ainda chamava o `.add` de Set, derrubando o laco inteiro). */
        const tentativas = (falharam.get(tarefa.mensagemId)?.tentativas || 0) + 1;
        const espera = ESPERAS_DA_FALHA[Math.min(tentativas - 1, ESPERAS_DA_FALHA.length - 1)];
        falharam.set(tarefa.mensagemId, { tentativas, proximaTentativaEm: Date.now() + espera });
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
    /* Pode ser a Evolution fora do ar um instante, pode ser o WhatsApp ter
       perdido o arquivo de verdade — dali nao da para saber qual dos dois.
       Entao espera e tenta de novo sozinha (a varredura periodica reencontra),
       em vez de desistir de uma vez para o resto da vida do processo. */
    const tentativas = (falharam.get(mensagemId)?.tentativas || 0) + 1;
    const espera = ESPERAS_DA_FALHA[Math.min(tentativas - 1, ESPERAS_DA_FALHA.length - 1)];
    falharam.set(mensagemId, { tentativas, proximaTentativaEm: Date.now() + espera });
    baixadasPorConexao.set(conexaoId, (baixadasPorConexao.get(conexaoId) || 0) + 1);
    anotarProgresso(conexaoId);
    return;
  }

  falharam.delete(mensagemId);
  const { chave: _fora, ...resto } = mensagem.midia;
  atualizarMensagem(contatoId, mensagemId, { midia: { ...resto, ...baixado, tipo: mensagem.midia.tipo || baixado.tipo } });
  baixadasPorConexao.set(conexaoId, (baixadasPorConexao.get(conexaoId) || 0) + 1);
  emitir(conexao.workspaceId, 'mensagem', { contatoId });
  anotarProgresso(conexaoId);
}
