import { atualizar, listar, mensagensDe, moverMensagens, registrarLog, remover } from '../nucleo/banco.js';
import { umTipoDeCaso } from '../nucleo/casos.js';
import { nomeEhProvisorio } from './nomes.js';

/**
 * Funde contatos duplicados: a mesma pessoa com dois registros no mesmo
 * workspace. Pedido do escritorio em 15/10/2026, depois de a importacao do
 * historico da LiderHub ter criado duplicados por dois motivos (os dois
 * corrigidos na fonte, em integracoes/liderhub.js, no mesmo dia):
 *
 *   1. A fase 1 (classificacao) escolhia "a primeira conexao do workspace";
 *      a fase 2 (historico) sempre escolhia a de qrcode. Workspace com
 *      qrcode E simulador (o "Chat de teste" que todo workspace ja tem) podia
 *      ter cada fase criando o contato sob uma conexao diferente.
 *   2. O numero da LiderHub ja vem com o pais, e as duas fases passavam ele
 *      por normalizarTelefone (que ASSUME numero sem pais e completa com 55)
 *      em vez de normalizarTelefoneDoWhatsApp — o mesmo bug que o comentario
 *      de nucleo/util.js documenta para a importacao do historico do
 *      WhatsApp ("telefone inventado").
 *
 * Esta funcao e o reparo dos dois: acha pares com o MESMO telefone (contando
 * a ambiguidade do 55 do motivo 2) e funde num so, sem depender da conexao
 * (motivo 1). Roda no boot, idempotente — sem duplicado, nao muda nada.
 */

const soDigitos = (t) => String(t || '').replace(/\D+/g, '');

/** Duas strings de telefone sao a mesma pessoa real: iguais, ou uma e a outra com o 55 do Brasil na frente. */
function mesmoTelefone(a, b) {
  const x = soDigitos(a);
  const y = soDigitos(b);
  if (!x || !y) return false;
  if (x === y) return true;
  return x === `55${y}` || y === `55${x}`;
}

/** Quanto este contato "pesa" ao decidir quem fica: mais mensagens, mais antigo. */
function pesoDoContato(contato) {
  return mensagensDe(contato.id).length;
}

function maisPesado(a, b) {
  const pesoA = pesoDoContato(a);
  const pesoB = pesoDoContato(b);
  if (pesoA !== pesoB) return pesoA > pesoB ? a : b;
  return String(a.criadoEm) <= String(b.criadoEm) ? a : b;
}

/** Leva tudo do duplicado para o canonico, e apaga o duplicado. Devolve quantas mensagens moveu. */
function fundirContato(canonico, duplicado) {
  const mudancas = {};

  if (nomeEhProvisorio(canonico) && !nomeEhProvisorio(duplicado)) {
    mudancas.nome = duplicado.nome;
    mudancas.nomeOrigem = duplicado.nomeOrigem;
  }
  if (!canonico.foto && duplicado.foto) mudancas.foto = duplicado.foto;
  if (!canonico.statusId && duplicado.statusId) mudancas.statusId = duplicado.statusId;
  if (!canonico.departamentoId && duplicado.departamentoId) mudancas.departamentoId = duplicado.departamentoId;
  if (!canonico.origemId && duplicado.origemId) mudancas.origemId = duplicado.origemId;
  if (duplicado.etiquetas?.length) {
    const juntas = [...new Set([...(canonico.etiquetas || []), ...duplicado.etiquetas])];
    mudancas.etiquetas = umTipoDeCaso(juntas, canonico.etiquetas);
  }
  if (duplicado.primeiraMensagemEm && (!canonico.primeiraMensagemEm || duplicado.primeiraMensagemEm < canonico.primeiraMensagemEm)) {
    mudancas.primeiraMensagemEm = duplicado.primeiraMensagemEm;
  }
  if (duplicado.ultimaMensagemEm && (!canonico.ultimaMensagemEm || duplicado.ultimaMensagemEm > canonico.ultimaMensagemEm)) {
    mudancas.ultimaMensagemEm = duplicado.ultimaMensagemEm;
    mudancas.previa = duplicado.previa;
  }

  const movidas = moverMensagens(duplicado.id, canonico.id);
  if (Object.keys(mudancas).length) {
    atualizar('contatos', canonico.id, mudancas);
    Object.assign(canonico, mudancas);
  }

  registrarLog(
    canonico.workspaceId,
    canonico.id,
    'fusao',
    `Contato duplicado (telefone ${duplicado.telefone}, ${movidas} mensagem(ns)) foi fundido aqui e removido.`,
  );
  remover('contatos', duplicado.id);

  return movidas;
}

export function deduplicarContatos() {
  let fundidos = 0;
  let mensagensMovidas = 0;

  for (const workspace of listar('workspaces')) {
    const contatos = listar('contatos', { workspaceId: workspace.id });
    const usados = new Set();

    for (let i = 0; i < contatos.length; i += 1) {
      const atual = contatos[i];
      if (usados.has(atual.id) || !atual.telefone) continue;

      const pares = [atual];
      for (let j = i + 1; j < contatos.length; j += 1) {
        const outro = contatos[j];
        if (usados.has(outro.id) || !outro.telefone) continue;
        if (mesmoTelefone(atual.telefone, outro.telefone)) pares.push(outro);
      }
      if (pares.length < 2) continue;

      const canonico = pares.reduce((melhor, candidato) => maisPesado(melhor, candidato));
      for (const contato of pares) {
        usados.add(contato.id);
        if (contato.id === canonico.id) continue;
        mensagensMovidas += fundirContato(canonico, contato);
        fundidos += 1;
      }
    }
  }

  return { fundidos, mensagensMovidas };
}
