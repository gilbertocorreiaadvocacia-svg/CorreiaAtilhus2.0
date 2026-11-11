import { achar, listar, mensagensDe } from './banco.js';
import { podeVerConversa } from './auth.js';
import { mensagensDoResumo, resumoPadrao, situacaoDoResumo } from '../ia/resumo-da-conversa.js';
import { passosDoFunil } from './funil-da-conversa.js';
import { tipoDeCasoDa } from './casos.js';

/**
 * A ficha do cliente de um contrato fechado.
 *
 * Pedido do escritorio em 11/11/2026: "todas as vezes que o contrato for
 * fechado ele tem que mandar um relatorio do cliente, dizer quem ou qual agente
 * fechou o contrato e mandar junto com a documentacao do cliente com todos os
 * dados".
 *
 * Ate aqui, assinar um contrato gerava uma notificacao de uma linha ("Fulano
 * assinou o contrato") e mais nada: quem recebia tinha que abrir a conversa,
 * caçar o CPF nas variaveis, descer ate os arquivos e conferir na mao quem
 * tinha conduzido. A ficha junta tudo num lugar so.
 *
 * AS DUAS MAOS QUE FECHAM NAO SE MISTURAM, e e a mesma divisao que o relatorio
 * de contratos usa (rotas/relatorios.js):
 *
 *   - QUEM APROVOU (uma pessoa): conferiu a ficha e mandou o link de
 *     assinatura. `contrato.aprovadoPor`.
 *   - QUE AGENTE CONDUZIU (a IA): pediu o contrato e tocou o atendimento.
 *     `contrato.agenteId`.
 *
 * Uma so delas nunca conta a historia inteira, e somar as duas num "fechou por"
 * unico seria escolher uma e esconder a outra.
 *
 * SO LE. Nada aqui escreve, e o que a pessoa nao pode ver na conversa ela nao
 * ve na ficha (podeVerConversa, o mesmo guarda do resto do atendimento).
 */

/** O rotulo humano de uma variavel do contato ("cpf" -> "CPF"). */
const ROTULOS = {
  cpf: 'CPF',
  rg: 'RG',
  nascimento: 'Data de nascimento',
  endereco: 'Endereço',
  email: 'E-mail',
  profissao: 'Profissão',
  estadocivil: 'Estado civil',
  nomedamae: 'Nome da mãe',
  nis: 'NIS/PIS',
  beneficio: 'Benefício',
};

const rotuloDaVariavel = (chave) =>
  ROTULOS[String(chave).toLowerCase()] || String(chave).charAt(0).toUpperCase() + String(chave).slice(1);

/**
 * A ficha de um contrato.
 *
 * `contratoId` e a porta de entrada porque e o que a notificacao carrega: o
 * contrato aponta para a conversa, e nao o contrario (uma conversa pode ter
 * mais de um contrato ao longo do tempo).
 */
/**
 * Quem fechou um caso que NAO tem contrato da ZapSign.
 *
 * A resposta esta no historico do funil: o log da troca para a coluna de tipo
 * "sucesso" guarda quem moveu — uma pessoa da equipe, a IA, ou o sistema
 * (passosDoFunil, nucleo/funil-da-conversa.js). E o unico registro de autoria
 * que existe para o caso fechado na mao.
 */
function quemMoveuParaSucesso(contato) {
  const idsDeSucesso = new Set(
    listar('status', { workspaceId: contato.workspaceId }).filter((s) => s.tipo === 'sucesso').map((s) => s.id),
  );
  if (!idsDeSucesso.size) return null;
  /* O ultimo, e nao o primeiro: se a conversa saiu e voltou para a coluna, o
     que vale e a passagem de agora. */
  const passo = [...passosDoFunil(contato.id)].reverse().find((p) => idsDeSucesso.has(p.statusId));
  return passo ? { em: passo.em, autor: passo.autor } : null;
}

/**
 * A ficha de um caso, pelo CONTRATO ou pela CONVERSA.
 *
 * Nasceu so com o contrato da ZapSign, e isso estava errado para este
 * escritorio: a maioria das conversas que chegam a coluna "Contrato fechado"
 * nunca passou pela ZapSign — sao fechadas na mao ou importadas do historico
 * antigo (esta escrito em automacao/followup.js, no gancho que manda o caso
 * para o Atilhus Juri). Preso ao contrato, o relatorio do caso simplesmente
 * nao existia para a maior parte dos casos fechados. Relatado pelo escritorio
 * em 11/11/2026, com a conversa de um caso fechado aberta e nenhum botao nela.
 *
 * Agora aceita os dois: `{ contratoId }` ou `{ contatoId }`. Pela conversa,
 * pega o contrato dela se houver (o assinado na frente), e segue sem contrato
 * se nao houver — a ficha e do CASO, e o contrato e um detalhe dele.
 */
export function fichaDoCaso(ctx, { contratoId = null, contatoId = null } = {}) {
  let contrato = null;
  let contato = null;

  if (contratoId) {
    contrato = achar('contratos', contratoId);
    if (!contrato || contrato.workspaceId !== ctx.workspaceId) return null;
    contato = achar('contatos', contrato.contatoId);
  } else if (contatoId) {
    contato = achar('contatos', contatoId);
    if (!contato || contato.workspaceId !== ctx.workspaceId) return null;
    const daConversa = listar('contratos', { contatoId: contato.id });
    contrato = daConversa.find((c) => c.situacao === 'assinado') || daConversa[0] || null;
  }
  if (!contato || !podeVerConversa(ctx, contato)) return null;

  const status = contato.statusId ? achar('status', contato.statusId) : null;
  const departamento = contato.departamentoId ? achar('departamentos', contato.departamentoId) : null;
  const origem = contato.origemId ? achar('origens', contato.origemId) : null;
  /* Sem contrato, o agente que conduziu e o que esta na conversa — que e o que
     o escritorio ve no cabecalho dela. */
  const agente = contrato?.agenteId
    ? achar('agentes', contrato.agenteId)
    : contato.responsavel?.tipo === 'agente'
      ? achar('agentes', contato.responsavel.id)
      : null;
  const fechamento = contrato ? null : quemMoveuParaSucesso(contato);

  /*
   * Os dados do cliente, um por linha, com rotulo legivel.
   *
   * Sai das `variaveis` do contato, que e onde o escritorio guarda CPF,
   * endereco, nascimento e o que mais o caso pedir — e tambem de onde o
   * contrato puxa para preencher o modelo. Valor vazio nao entra: linha com
   * rotulo e nada do lado so faz a ficha parecer incompleta quando o dado
   * simplesmente nao se aplica aquele caso.
   */
  const dados = Object.entries(contato.variaveis || {})
    .filter(([, valor]) => String(valor ?? '').trim())
    .map(([chave, valor]) => ({ chave, rotulo: rotuloDaVariavel(chave), valor: String(valor).trim() }))
    .sort((a, b) => a.rotulo.localeCompare(b.rotulo, 'pt-BR'));

  /*
   * A DESCRICAO DO CASO. Pedido do escritorio em 11/11/2026: "no relatorio
   * quero uma descricao do caso".
   *
   * Nao e campo novo para alguem preencher: o sistema JA escreve isto. O
   * resumo da conversa (ia/resumo-da-conversa.js) sai sozinho quando a conversa
   * sossega, com os campos "Quem e", "O que busca", "Em que pe esta", "Dados e
   * documentos" e "Proximo passo" — e exatamente a descricao do caso, ja
   * redigida e mantida atualizada. Pedir para a equipe digitar de novo seria
   * criar trabalho para repetir o que ja esta escrito.
   *
   * Sem resumo guardado (conversa curta, ou que nunca sossegou), entra o resumo
   * PADRAO, que e montado da propria conversa sem IA e sem custo. Nunca fica
   * vazio: um relatorio de caso sem descricao nenhuma nao serve para protocolar.
   */
  const situacao = situacaoDoResumo(contato);
  const mensagens = mensagensDoResumo(mensagensDe(contato.id));
  const campos = situacao.resumo?.campos?.length
    ? situacao.resumo.campos
    : mensagens.length
      ? resumoPadrao(contato, mensagens)
      : [];
  const tipoDeCaso = tipoDeCasoDa(contato);

  /* O caminho do caso: por onde ele passou e quando. Sai do mesmo historico do
     funil que a lateral da conversa desenha. */
  const caminho = passosDoFunil(contato.id).map((passo) => ({ em: passo.em, nome: passo.nome, autor: passo.autor?.nome || null }));

  /* Os documentos: tudo o que esta na nuvem da conversa, inclusive os PDFs do
     contrato e da procuracao assinados, que a ZapSign guarda ali quando a
     assinatura confirma (integracoes/zapsign.js). O caminho no disco nao sai
     daqui — a tela baixa pela rota que ja confere a sessao. */
  const documentos = (contato.arquivos || []).map((a) => ({
    id: a.id,
    nome: a.nome,
    tipo: a.tipo || 'documento',
    tamanho: a.tamanho || 0,
    enviadoPor: a.enviadoPor || null,
    criadoEm: a.criadoEm || null,
  }));

  return {
    contrato: {
      id: contrato?.id || null,
      /* Sem contrato da ZapSign, a situacao do caso e a da coluna do funil: e
         o que o escritorio chama de "contrato fechado" na tela. */
      situacao: contrato?.situacao || (status?.tipo === 'sucesso' ? 'fechado_sem_zapsign' : null),
      criadoEm: contrato?.criadoEm || null,
      assinadoEm: contrato?.assinadoEm || fechamento?.em || null,
      temZapsign: Boolean(contrato),
      /* As duas maos, separadas de proposito (ver o cabecalho). Sem contrato,
         "quem aprovou" vira quem moveu a conversa para a coluna de fechado. */
      aprovadoPor: contrato?.aprovadoPor?.nome
        ? { nome: contrato.aprovadoPor.nome, tipo: contrato.aprovadoPor.tipo || null }
        : fechamento?.autor?.nome
          ? { nome: fechamento.autor.nome, tipo: fechamento.autor.tipo || null, moveuAColuna: true }
          : null,
      agente: agente ? { id: agente.id, nome: agente.nome } : contrato?.agenteId ? { id: contrato.agenteId, nome: 'Agente removido' } : null,
    },
    cliente: {
      id: contato.id,
      nome: contato.nome,
      telefone: contato.telefone || null,
      criadoEm: contato.criadoEm || null,
      status: status ? { nome: status.nome, cor: status.cor } : null,
      departamento: departamento ? { nome: departamento.nome } : null,
      origem: origem ? { nome: origem.nome } : null,
      responsavel: contato.responsavel?.nome ? { nome: contato.responsavel.nome, tipo: contato.responsavel.tipo } : null,
      etiquetas: (contato.etiquetas || [])
        .map((id) => achar('etiquetas', id))
        .filter(Boolean)
        .map((e) => ({ nome: e.nome, cor: e.cor })),
    },
    dados,
    documentos,
    descricao: {
      tipoDeCaso: tipoDeCaso ? { nome: tipoDeCaso.nome, cor: tipoDeCaso.cor } : null,
      campos,
      /* De onde veio o texto: o escritorio precisa saber se leu a redacao do
         agente ou o resumo automatico montado da conversa. */
      daIa: Boolean(situacao.resumo?.usouIa && situacao.resumo?.campos?.length),
      geradoEm: situacao.resumo?.geradoEm || null,
      novasDepois: situacao.novas || 0,
      caminho,
    },
  };
}

/**
 * O texto do aviso que sai quando o contrato fecha.
 *
 * Mora aqui, e nao no ZapSign, porque e a mesma pergunta da ficha ("quem
 * fechou isto?") respondida em uma linha — as duas tem que dizer a mesma coisa.
 */
export function quemFechou(contrato) {
  const agente = contrato?.agenteId ? achar('agentes', contrato.agenteId) : null;
  const pessoa = contrato?.aprovadoPor?.nome || null;
  const partes = [];
  if (agente) partes.push(`conduzido por ${agente.nome}`);
  else if (contrato?.agenteId) partes.push('conduzido por um agente que foi removido');
  if (pessoa) partes.push(`aprovado por ${pessoa}`);
  return partes.length ? partes.join(', ') : 'sem agente nem aprovação registrados';
}

/* O nome antigo, de quando a ficha so existia para contrato da ZapSign. Mantido
   porque e assim que o relatorio do caso e a rota a chamam. */
export const fichaDoContrato = (ctx, contratoId) => fichaDoCaso(ctx, { contratoId });
