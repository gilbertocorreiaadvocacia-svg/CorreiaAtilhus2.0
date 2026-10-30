import { achar, atualizar, listar, mensagensDe, registrarLog } from './banco.js';
import { agora, aplicarVariaveis, normalizar } from './util.js';
import { enviarMensagem } from '../whatsapp/envio.js';
import { arquivoDoTemplateExiste } from '../ia/pacotes.js';

/**
 * O video de boas-vindas sai sozinho, uma vez por conversa (30/10/2026).
 *
 * Pedido do escritorio: o video de boas-vindas nao chegava aos leads. Mesmo com
 * o video salvo no template, so os tres especialistas (Beatriz, Andreia e
 * Juliana) mandavam o @bemvindo, e so quando o lead caia direto neles; a
 * Eduarda, que recebe a maior parte dos leads, nunca mandava. E quem decide
 * chamar o template e o modelo: nada garantia que ele chamasse.
 *
 * Esta e uma CHAVE por escritorio, DESLIGADA por padrao (workspace.boasVindas):
 * desligada, o comportamento e exatamente o de antes. Ligada, o sistema manda o
 * template escolhido (texto e video) antes da primeira resposta da IA, uma vez,
 * sem depender de o modelo lembrar.
 *
 * So vale para:
 *  - conversa criada DEPOIS de a chave ser ligada (`ligadaEm`): ligar a chave
 *    nao manda video para quem ja estava em atendimento;
 *  - conversa em que ninguem falou com o cliente ainda (nenhuma saida);
 *  - template com video de verdade (arquivo que existe no servidor);
 *  - quando um agente esta ligado e vai responder (o gancho fica em rodarAgente).
 *
 * Se o video for RECUSADO, tenta de novo na hora (uma segunda vez, alguns
 * segundos depois), ainda ANTES da resposta do agente. Nao da para tentar numa
 * rodada seguinte: a essa altura o agente ja falou, e um video que chegasse no
 * meio da conversa seria pior que nenhum. Falhando as duas, desiste e deixa o
 * registro na conversa e no contador do template. Se o envio estourar o TEMPO,
 * nao tenta de novo: o video pode ja ter chegado.
 */
const ATALHOS_PADRAO = ['bemvindo', 'boas-vindas'];
const MAX_TENTATIVAS = 2;
/* Ajustavel so para o teste nao esperar de verdade. */
const ESPERA_ENTRE_TENTATIVAS_MS = Number(process.env.CORREIA_BOASVINDAS_ESPERA_MS ?? 3000);
const esperar = (ms) => new Promise((pronto) => setTimeout(pronto, ms));

export function configDasBoasVindas(workspaceId) {
  const guardado = achar('workspaces', workspaceId)?.boasVindas || {};
  return {
    automatica: guardado.automatica === true,
    templateId: guardado.templateId || null,
    ligadaEm: guardado.ligadaEm || null,
  };
}

/** O template escolhido na chave, ou o @bemvindo / @boas-vindas do escritorio. */
export function templateDasBoasVindas(workspaceId) {
  const { templateId } = configDasBoasVindas(workspaceId);
  const todos = listar('templates', { workspaceId });
  if (templateId) return todos.find((t) => t.id === templateId) || null;
  return todos.find((t) => ATALHOS_PADRAO.includes(normalizar(t.atalho))) || null;
}

const temVideoDeVerdade = (template) => Boolean(template?.midia && arquivoDoTemplateExiste(template.midia));

/**
 * Este template ja saiu para este cliente pelas boas-vindas automaticas? Usada
 * por enviar_template: o especialista que tenta mandar o mesmo template de novo
 * e ignorado, em vez de o lead receber o video duas vezes.
 */
export function jaEnviouAsBoasVindas(contato, template) {
  return Boolean(contato?.boasVindasEnviadasEm && template && contato.boasVindasTemplateId === template.id);
}

/**
 * Manda as boas-vindas se for o caso. Devolve a mensagem enviada, ou null
 * quando nao havia o que fazer. Nunca lanca: um erro aqui nao pode derrubar a
 * resposta do agente.
 */
export async function enviarBoasVindasSePrecisar({ contato, agente, conexao }) {
  try {
    const { automatica, ligadaEm } = configDasBoasVindas(contato.workspaceId);
    if (!automatica || !conexao || contato.grupo) return null;
    if (contato.boasVindasEnviadasEm || (contato.boasVindasFalhas || 0) >= MAX_TENTATIVAS) return null;
    if (ligadaEm && String(contato.criadoEm || '') < ligadaEm) return null;
    if (mensagensDe(contato.id).some((m) => m.direcao === 'saida' && !m.nota)) return null;

    const template = templateDasBoasVindas(contato.workspaceId);
    if (!temVideoDeVerdade(template)) return null;

    let mensagem = null;
    for (let tentativa = 1; tentativa <= MAX_TENTATIVAS; tentativa += 1) {
      mensagem = await enviarMensagem({
        contato,
        conexao,
        tipo: template.midia.tipo || 'video',
        conteudo: aplicarVariaveis(template.conteudo, { nome: contato.nome, ...(contato.variaveis || {}) }),
        midia: template.midia,
        templateId: template.id,
        autor: { tipo: 'agente', id: agente.id, nome: agente.nome },
        /* O video NAO e a resposta ao cliente: se o modelo falhar logo depois
           (credito acabado, por exemplo), a conversa tem de continuar marcada
           como sem resposta, para a recuperacao do boot atende-la. */
        contaComoResposta: false,
      });
      if (mensagem.situacao === 'enviada') break;
      registrarLog(
        contato.workspaceId,
        contato.id,
        'boas_vindas_falhou',
        `As boas-vindas não saíram (tentativa ${tentativa} de ${MAX_TENTATIVAS}): ${mensagem.erro?.mensagem || 'sem detalhe'}`,
      );
      /* Tempo esgotado nao e recusa: o video pode ter chegado ao cliente mesmo
         sem o servico responder. Mandar de novo duplicaria o video, e cada
         tentativa de arquivo grande segura a resposta do agente por minutos. */
      if (mensagem.erro?.codigo === 'timeout') break;
      if (tentativa < MAX_TENTATIVAS) await esperar(ESPERA_ENTRE_TENTATIVAS_MS);
    }

    if (mensagem.situacao === 'enviada') {
      const quando = agora();
      atualizar('contatos', contato.id, { boasVindasEnviadasEm: quando, boasVindasTemplateId: template.id });
      contato.boasVindasEnviadasEm = quando;
      contato.boasVindasTemplateId = template.id;
      registrarLog(contato.workspaceId, contato.id, 'boas_vindas', `Boas-vindas enviadas antes da primeira resposta (@${template.atalho})`);
    } else {
      /* Desistiu: o agente responde do mesmo jeito, sem o video. */
      atualizar('contatos', contato.id, { boasVindasFalhas: MAX_TENTATIVAS });
      contato.boasVindasFalhas = MAX_TENTATIVAS;
    }
    return mensagem;
  } catch (erro) {
    registrarLog(contato.workspaceId, contato.id, 'boas_vindas_falhou', `As boas-vindas deram erro: ${erro.message}`);
    return null;
  }
}

/**
 * O que a chave mostra na tela: ligada ou nao, qual template, se ele tem video,
 * e quantas vezes ja saiu (o contador de nucleo/uso-dos-templates.js).
 */
export function situacaoDasBoasVindas(workspaceId) {
  const config = configDasBoasVindas(workspaceId);
  const template = templateDasBoasVindas(workspaceId);
  return {
    ...config,
    template: template ? { id: template.id, nome: template.nome, atalho: template.atalho, temVideo: temVideoDeVerdade(template) } : null,
    enviados: template?.uso?.enviados || 0,
    falhas: template?.uso?.falhas || 0,
    ultimaFalha: template?.uso?.falhas ? template.uso.ultimaFalha || null : null,
  };
}
