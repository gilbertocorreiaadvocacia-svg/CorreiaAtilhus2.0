import { achar, listar } from '../nucleo/banco.js';
import { normalizar } from '../nucleo/util.js';
import { PACOTES } from './pacotes.js';
import { agentePorPalavraChave } from './motor.js';

/**
 * Qual agente de IA atende uma conversa que ainda nao esta com nenhum.
 *
 * Pedido do escritorio em 24/10/2026, depois de dias de lead novo caindo em
 * Pendente sem ninguem responder: "toda hora, todo contato que manda
 * mensagem vai para a IA, não vai para pendente". O numero que recebe os
 * anuncios tinha uma PESSOA como responsavel padrao — criarContato
 * (whatsapp/recebimento.js) copia esse padrao, entao todo lead nascia
 * pendente com ela, e nem a reatribuicao nem a palavra-chave tinham agente
 * para escolher: as duas so olhavam o padrao do numero.
 *
 * A ordem, do mais especifico para o mais geral:
 *  1. a palavra-chave do que o cliente escreveu (o especialista do beneficio);
 *  2. o responsavel padrao do numero, quando ele e um agente;
 *  3. o agente de entrada da area (Eduarda, a Triagem Trabalhista, a
 *     Secretaria Civel) — da area da conversa, ou de qualquer area quando o
 *     escritorio nao tem uma;
 *  4. qualquer agente de recepcao ligado do escritorio.
 *
 * Sempre um agente LIGADO do proprio escritorio: entregar a conversa a um
 * desligado so troca "pendente" por um silencio escondido, porque
 * agendarResposta (ia/motor.js) ignora agente desligado. Sem nenhum, devolve
 * null e a conversa fica com quem estava — nunca inventa agente.
 */
export function escolherAgente({ workspaceId, contato = null, conexao = null, texto = '' }) {
  const ligadoDaqui = (agente) => Boolean(agente && agente.ativo && agente.workspaceId === workspaceId);
  const area = contato?.area || conexao?.area || achar('workspaces', workspaceId)?.area || null;

  const porPalavra = texto ? agentePorPalavraChave(workspaceId, texto, area) : null;
  if (ligadoDaqui(porPalavra)) return { agente: porPalavra, motivo: 'palavra-chave' };

  if (conexao?.responsavelPadrao?.tipo === 'agente') {
    const padrao = achar('agentes', conexao.responsavelPadrao.id);
    if (ligadoDaqui(padrao)) return { agente: padrao, motivo: 'padrão do número' };
  }

  const ligados = listar('agentes', { workspaceId }).filter((a) => a.ativo);
  const pacotes = area && PACOTES[area] ? [PACOTES[area]] : Object.values(PACOTES);
  const nomesDeEntrada = pacotes.map((pacote) => normalizar(pacote.agentes[0].nome));
  const entrada = ligados.find((a) => nomesDeEntrada.includes(normalizar(a.nome)));
  if (entrada) return { agente: entrada, motivo: 'entrada da área' };

  const recepcao = ligados.find((a) => a.objetivo === 'recepcionar');
  if (recepcao) return { agente: recepcao, motivo: 'recepção' };

  return null;
}
