import { achar, listar, mensagensDe } from '../nucleo/banco.js';
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
  /* Na ordem dos pacotes, nao na ordem em que os agentes foram criados: no
     escritorio geral a Eduarda e a entrada mesmo com a Triagem Trabalhista
     morando junto — e ela quem passa o trabalhista para la. */
  for (const pacote of pacotes) {
    const entrada = ligados.find((a) => normalizar(a.nome) === normalizar(pacote.agentes[0].nome));
    if (entrada) return { agente: entrada, motivo: 'entrada da área' };
  }

  const recepcao = ligados.find((a) => a.objetivo === 'recepcionar');
  if (recepcao) return { agente: recepcao, motivo: 'recepção' };

  return null;
}

const PESSOA_SEGURA_A_CONVERSA_MS = 24 * 60 * 60 * 1000;

/*
 * Ha alguem da equipe cuidando desta conversa agora? Se ha, a mensagem do
 * cliente nao a tira dessa pessoa (whatsapp/recebimento.js) e a varredura de
 * pendentes nao mexe nela (automacao/reatribuir-pendentes.js). Vale por 24
 * horas a partir de qualquer um destes sinais:
 *  - a pessoa aceitou ou assumiu a conversa (aceitoEm);
 *  - um AGENTE passou a conversa para ela de proposito (a ultima passagem e
 *    para ela) — sem isto a varredura a devolvia para a IA em ate 10 minutos,
 *    antes de a pessoa conseguir abrir, e o agente voltava a repetir que ia
 *    passar (pedido do escritorio em 24/10/2026: a passagem tem que acontecer);
 *  - a pessoa escreveu na conversa, pela tela ou pelo celular;
 *  - alguem da equipe deu a conversa para ela (atribuidoEm) — sem isto a
 *    varredura a devolvia para a IA antes de ela aceitar. Pedido de
 *    26/10/2026: "quando a Leticia tenta assumir a conversa ela nao consegue".
 * Lead que so nasceu com a pessoa por ser o padrao do numero nao tem nenhum
 * desses sinais, e vai para a IA.
 */
export function pessoaCuidandoAgora(contato) {
  if (contato.responsavel?.tipo !== 'membro' && !contato.aceitoPor) return false;
  const limite = Date.now() - PESSOA_SEGURA_A_CONVERSA_MS;
  const recente = (quando) => Boolean(quando) && new Date(quando).getTime() > limite;

  if (contato.aceitoPor && recente(contato.aceitoEm)) return true;
  if (contato.responsavel?.tipo === 'membro' && recente(contato.atribuidoEm)) return true;
  const passagem = (contato.passagens || []).at(-1);
  if (passagem?.paraTipo === 'membro' && passagem.paraId === contato.responsavel?.id && recente(passagem.em)) return true;

  const mensagens = mensagensDe(contato.id);
  for (let i = mensagens.length - 1; i >= 0; i -= 1) {
    const mensagem = mensagens[i];
    if (mensagem.direcao === 'saida' && mensagem.autor?.tipo === 'membro') return recente(mensagem.criadoEm);
  }
  return false;
}
