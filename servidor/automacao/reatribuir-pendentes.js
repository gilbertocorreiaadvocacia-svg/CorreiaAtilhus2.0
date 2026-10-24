import { achar, atualizar, listar, mensagensDe, registrarLog } from '../nucleo/banco.js';
import { emitir } from '../nucleo/eventos.js';
import { agendarResposta } from '../ia/motor.js';
import { escolherAgente } from '../ia/escolher-agente.js';
import { garantirTriagemNoEscritorioGeral, ligarNumerosDasAreas } from '../nucleo/agentes-por-escritorio.js';

/**
 * Toda conversa pendente volta para um agente de IA. Pedidos do escritorio:
 * 19/10/2026 ("toda mensagem nova vai para os agentes"), 23/10/2026 ("quero
 * que os agentes atendam de verdade") e 24/10/2026 ("todo contato que manda
 * mensagem vai para a IA, não vai para pendente").
 *
 * Escopo (decidido com o escritorio): TODA conversa pendente, de qualquer
 * origem — inclusive as que um agente tirou da IA de proposito
 * (desativar_ia, transferencia para pessoa). So nao mexe na que uma pessoa
 * ja ACEITOU (aceitoPor): ali ha alguem atendendo.
 *
 * Qual agente: ia/escolher-agente.js (palavra-chave sobre o historico
 * inteiro do cliente, padrao do numero, entrada da area, recepcao). Ate
 * 24/10/2026 so a palavra-chave e o padrao do numero valiam — e o numero
 * dos anuncios tinha uma PESSOA como padrao, entao o lead ficava pendente
 * para sempre.
 *
 * O agente so RESPONDE quando ha mensagem do cliente sem resposta (ultima
 * entrada mais nova que a ultima saida, o mesmo calculo de envio.js). Sem
 * essa guarda, uma conversa que o agente passou de proposito para uma
 * pessoa voltava a ele a cada varredura, e ele a passava de novo — mandando
 * a mesma despedida ao cliente a cada 10 minutos. Reatribuir sem responder
 * e silencioso: quando o cliente escrever, o agente ja e o responsavel.
 */
export function reatribuirPendentes() {
  let reativados = 0;
  for (const contato of listar('contatos', { estado: 'pendente' })) {
    if (contato.grupo || contato.aceitoPor) continue;
    const conexao = achar('conexoes', contato.conexaoId);

    const textoDoCliente = mensagensDe(contato.id)
      .filter((m) => m.direcao === 'entrada' && m.conteudo)
      .map((m) => m.conteudo)
      .join(' ');
    const escolha = escolherAgente({ workspaceId: contato.workspaceId, contato, conexao, texto: textoDoCliente });
    if (!escolha) continue;
    const { agente, motivo } = escolha;

    atualizar('contatos', contato.id, {
      responsavel: { tipo: 'agente', id: agente.id, nome: agente.nome },
      estado: 'ia',
      aceitoPor: null,
    });
    registrarLog(contato.workspaceId, contato.id, 'reativacao', `Reatribuido ao agente ${agente.nome} (${motivo}, fila de pendentes)`);
    emitir(contato.workspaceId, 'contato', { contatoId: contato.id });

    const semResposta = contato.ultimaEntradaEm && (!contato.ultimaSaidaEm || contato.ultimaSaidaEm < contato.ultimaEntradaEm);
    if (semResposta) agendarResposta(contato);
    reativados += 1;
  }
  return { reativados };
}

/*
 * O que a ultima varredura fez, para /api/saude (index.js). A hospedagem nao
 * mostra o log do processo para quem atende, e foi exatamente isso que
 * escondeu, em 23/10/2026, que a varredura nao estava instalando nada no ar:
 * so com o resultado de cada etapa exposto da para saber, de fora, se ela
 * rodou, o que fez e onde falhou.
 */
const situacao = { iniciadaEm: null, ultimaEm: null, etapas: {}, escritorios: [] };

/* Uma etapa que falha nao pode levar as outras junto. Antes, um erro aqui
   subia pelo callback do listen (index.js), caia no uncaughtException — que
   so registra — e todo o resto do boot depois desta linha nunca rodava. */
function etapa(nome, executar) {
  try {
    situacao.etapas[nome] = { ok: true, resultado: executar(), em: new Date().toISOString() };
  } catch (erro) {
    situacao.etapas[nome] = { ok: false, erro: erro.message, em: new Date().toISOString() };
    console.error(`[varredura] ${nome} falhou:`, erro);
  }
}

/* So contagens, sem nome de cliente nem de pessoa: a rota de saude e aberta. */
function resumirEscritorios() {
  return listar('workspaces').map((workspace) => {
    const numeros = listar('conexoes', { workspaceId: workspace.id }).filter((c) => c.tipo !== 'simulador');
    const escolha = escolherAgente({ workspaceId: workspace.id });
    const contatos = listar('contatos', { workspaceId: workspace.id }).filter((c) => !c.grupo);
    return {
      area: workspace.area || null,
      numeros: numeros.length,
      numerosComPessoaPadrao: numeros.filter((c) => c.responsavelPadrao && c.responsavelPadrao.tipo !== 'agente').length,
      numerosSemPadrao: numeros.filter((c) => !c.responsavelPadrao).length,
      agentesLigados: listar('agentes', { workspaceId: workspace.id }).filter((a) => a.ativo).length,
      agenteDeEntrada: escolha ? `${escolha.agente.nome} (${escolha.motivo})` : null,
      triagemGeralInstalada: Boolean(workspace.triagemGeralInstaladaEm),
      pendentes: contatos.filter((c) => c.estado === 'pendente' && !c.aceitoPor).length,
      naIa: contatos.filter((c) => c.responsavel?.tipo === 'agente' && c.estado !== 'arquivado').length,
    };
  });
}

/*
 * Antes de reatribuir: garantirTriagemNoEscritorioGeral instala a Triagem no
 * escritorio geral (sem area) que nao tem nenhuma, e ligarNumerosDasAreas
 * religa numero de area sem responsavel ao agente de entrada da area (ver as
 * duas em nucleo/agentes-por-escritorio.js). Ate 23/10/2026 a segunda so
 * rodava por script com o servidor parado — na pratica, nunca.
 */
function varrerFila() {
  etapa('triagemNoEscritorioGeral', () => garantirTriagemNoEscritorioGeral());
  etapa('numerosDasAreas', () => ligarNumerosDasAreas().length);
  etapa('pendentes', () => reatribuirPendentes().reativados);
  try {
    situacao.escritorios = resumirEscritorios();
  } catch (erro) {
    situacao.escritorios = [{ erro: erro.message }];
  }
  situacao.ultimaEm = new Date().toISOString();
}

export function situacaoDaVarredura() {
  return situacao;
}

let laco = null;

/**
 * Varre a fila na hora (cuida do estoque atual) e dali em diante de tempos
 * em tempos. O intervalo e armado ANTES da primeira varredura: se ela
 * demorar ou algo der errado nela, a seguinte continua marcada.
 */
export function iniciarReatribuicaoDePendentes(intervalo) {
  if (laco) return;
  laco = setInterval(varrerFila, intervalo);
  if (typeof laco.unref === 'function') laco.unref();
  situacao.iniciadaEm = new Date().toISOString();
  varrerFila();
}

export function pararReatribuicaoDePendentes() {
  if (laco) clearInterval(laco);
  laco = null;
}
