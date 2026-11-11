import { achar, listar } from './banco.js';
import { podeVerConversa } from './auth.js';

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
export function fichaDoContrato(ctx, contratoId) {
  const contrato = achar('contratos', contratoId);
  if (!contrato || contrato.workspaceId !== ctx.workspaceId) return null;
  const contato = achar('contatos', contrato.contatoId);
  if (!contato || !podeVerConversa(ctx, contato)) return null;

  const status = contato.statusId ? achar('status', contato.statusId) : null;
  const departamento = contato.departamentoId ? achar('departamentos', contato.departamentoId) : null;
  const origem = contato.origemId ? achar('origens', contato.origemId) : null;
  const agente = contrato.agenteId ? achar('agentes', contrato.agenteId) : null;

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
      id: contrato.id,
      situacao: contrato.situacao,
      criadoEm: contrato.criadoEm || null,
      assinadoEm: contrato.assinadoEm || null,
      /* As duas maos, separadas de proposito (ver o cabecalho). */
      aprovadoPor: contrato.aprovadoPor?.nome
        ? { nome: contrato.aprovadoPor.nome, tipo: contrato.aprovadoPor.tipo || null }
        : null,
      agente: agente ? { id: agente.id, nome: agente.nome } : contrato.agenteId ? { id: contrato.agenteId, nome: 'Agente removido' } : null,
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
