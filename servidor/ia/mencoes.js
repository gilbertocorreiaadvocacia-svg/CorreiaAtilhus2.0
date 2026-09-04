import { achar, atualizar, inserir, inserirMensagem, listar, mensagensDe, registrarLog } from '../nucleo/banco.js';
import { emitir, emitirParaUsuario } from '../nucleo/eventos.js';
import { agora, aplicarVariaveis, normalizar, novoId } from '../nucleo/util.js';
import { custoDaMencao, lancar } from '../nucleo/creditos.js';
import { enviarMensagem } from '../whatsapp/envio.js';
import { aplicarStatus, reagendarFollowups } from '../automacao/followup.js';

/**
 * As mencoes sao o que separa um chatbot de um agente: cada @ do prompt vira
 * uma ferramenta que altera de verdade o registro da conversa, status,
 * etiqueta, responsavel, contrato, agenda. O modelo escolhe quando chamar;
 * o efeito acontece aqui, com log e cobranca de credito.
 */

/**
 * Mencoes genericas: o prompt pode dizer "@status" sem nomear qual status.
 * Elas nao apontam para um item especifico, ligam a ferramenta e deixam o
 * agente escolher entre os itens do workspace.
 */
/**
 * Escolhe para quem vai a proxima conversa, quando o prompt manda distribuir em
 * vez de nomear alguem.
 *
 * Nao e sorteio: e rodizio pela carga. O sorteio puro concentra por azar, e num
 * escritorio de tres advogados isso e visivel numa manha (um fica com seis
 * casos e outro com um). Aqui ganha quem tem menos conversa em aberto, e o
 * empate e desfeito por quem esta ha mais tempo sem receber, o que faz a fila
 * girar de verdade.
 *
 * O grupo sai, nesta ordem: da lista configurada no agente, do departamento da
 * conversa, ou de todos os membros ativos. Assim o recurso ja funciona sem
 * configuracao nenhuma e continua ajustavel quando o escritorio quiser.
 */
export function sortearResponsavel(workspaceId, contato, agente) {
  const membros = listar('membros', { workspaceId }).filter((m) => m.ativo !== false);
  if (!membros.length) return null;

  const escolhidos = new Set(agente?.distribuicao || []);
  let grupo = escolhidos.size ? membros.filter((m) => escolhidos.has(m.id)) : [];

  if (!grupo.length && contato.departamentoId) {
    grupo = membros.filter((m) => (m.departamentos || []).includes(contato.departamentoId));
  }
  if (!grupo.length) grupo = membros;

  const abertas = new Map(grupo.map((m) => [m.id, 0]));
  let ultimaEntrega = new Map();
  for (const c of listar('contatos', { workspaceId })) {
    if (c.responsavel?.tipo !== 'membro') continue;
    if (!abertas.has(c.responsavel.id)) continue;
    if (c.estado !== 'arquivado') abertas.set(c.responsavel.id, abertas.get(c.responsavel.id) + 1);
    const quando = c.responsavelDesde || c.criadoEm;
    const anterior = ultimaEntrega.get(c.responsavel.id);
    if (!anterior || quando > anterior) ultimaEntrega.set(c.responsavel.id, quando);
  }

  grupo.sort((a, b) => {
    const carga = abertas.get(a.id) - abertas.get(b.id);
    if (carga !== 0) return carga;
    return String(ultimaEntrega.get(a.id) || '').localeCompare(String(ultimaEntrega.get(b.id) || ''));
  });

  const escolhido = grupo[0];
  const usuario = achar('usuarios', escolhido.usuarioId);
  return { tipo: 'membro', id: escolhido.id, nome: usuario?.nome || 'Responsavel' };
}

const CATALOGO_GENERICO = [
  { chave: 'status', descricao: 'Altera o status da conversa no funil.' },
  { chave: 'tag', descricao: 'Adiciona etiqueta a conversa.' },
  { chave: 'etiqueta', descricao: 'Adiciona etiqueta a conversa.', equivale: 'tag' },
  { chave: 'removertag', descricao: 'Remove uma etiqueta que nao vale mais.' },
  { chave: 'agendarretorno', descricao: 'Marca um retorno no horario que o cliente combinou.' },
  { chave: 'departamento', descricao: 'Move a conversa de departamento.' },
  { chave: 'responsavel', descricao: 'Transfere a conversa para agente ou pessoa.' },
  { chave: 'template', descricao: 'Envia uma mensagem pronta.' },
  { chave: 'origem', descricao: 'Registra de onde o lead veio.' },
  { chave: 'variavel', descricao: 'Salva um dado informado pelo lead.' },
  { chave: 'personalizado', descricao: 'Chama uma integracao personalizada.' },
];

const CATALOGO_FIXO = [
  { chave: 'think', nome: 'think', descricao: 'Raciocinio mais profundo antes de responder.' },
  { chave: 'calculadora', nome: 'calculadora', descricao: 'Calculos matematicos.' },
  { chave: 'dataehora', nome: 'dataehora', descricao: 'Data e hora atuais no fuso de Brasilia.' },
  { chave: 'resumo', nome: 'resumo', descricao: 'Gera resumo da conversa como nota interna.' },
  { chave: 'biblioteca', nome: 'biblioteca', descricao: 'Consulta a base de conhecimento.' },
  { chave: 'salvarnome', nome: 'salvarnome', descricao: 'Corrige o nome do contato.' },
  { chave: 'ativaraudio', nome: 'ativaraudio', descricao: 'Liga as respostas em audio.' },
  { chave: 'desativaraudio', nome: 'desativaraudio', descricao: 'Desliga as respostas em audio.' },
  { chave: 'desativarIA', nome: 'desativarIA', descricao: 'Interrompe as respostas automaticas.' },
  { chave: 'notificar', nome: 'notificar', descricao: 'Notifica um membro sem transferir.' },
  { chave: 'gerarcontrato', nome: 'gerarcontrato', descricao: 'Gera contrato e envia o link de assinatura.' },
  { chave: 'calendario', nome: 'calendario', descricao: 'Verifica disponibilidade e agenda reuniao.' },
  { chave: 'advbox', nome: 'advbox', descricao: 'Consulta o andamento processual pelo CPF.' },
];

/**
 * Descobre quais mencoes o prompt do agente usa.
 *
 * Duas passadas: primeiro os itens cadastrados, porque nome de agente e de
 * status costumam ter espaco ("Triagem BPC/LOAS") e nao caberiam em uma
 * palavra so; depois o que sobrou, palavra a palavra. O que nao casar com
 * nada aparece em vermelho na tela, mencao invalida faz o agente se comportar
 * de um jeito que ninguem consegue explicar depois.
 */
export function analisarPrompt(prompt = '', workspaceId) {
  const encontradas = [];
  const invalidas = [];
  const vistas = new Set();

  const texto = String(prompt);
  const alvoTexto = normalizar(texto);
  const itens = catalogoDoWorkspace(workspaceId);

  const nomeados = [...itens].sort((a, b) => String(b.rotulo).length - String(a.rotulo).length);
  const faixasUsadas = [];

  for (const item of nomeados) {
    for (const candidato of [item.rotulo, item.chave]) {
      if (!candidato) continue;
      const agulha = `@${normalizar(candidato)}`;
      let posicao = alvoTexto.indexOf(agulha);
      while (posicao >= 0) {
        const fim = posicao + agulha.length;
        const jaCoberto = faixasUsadas.some((f) => posicao < f.fim && fim > f.inicio);
        if (!jaCoberto) {
          faixasUsadas.push({ inicio: posicao, fim });
          const chave = `${item.tipo}:${item.id}`;
          if (!vistas.has(chave)) {
            vistas.add(chave);
            encontradas.push({ ...item, rotulo: texto.slice(posicao + 1, fim) });
          }
        }
        posicao = alvoTexto.indexOf(agulha, posicao + 1);
      }
    }
  }

  const regex = /@([\p{L}\p{N}_-]+)/gu;
  let achado;
  while ((achado = regex.exec(texto)) !== null) {
    const inicio = achado.index;
    const fim = inicio + achado[0].length;
    if (faixasUsadas.some((f) => inicio < f.fim && fim > f.inicio)) continue;

    const bruto = achado[1];
    const alvo = normalizar(bruto);
    if (vistas.has(`sistema:${alvo}`)) continue;

    const fixa = CATALOGO_FIXO.find((c) => normalizar(c.chave) === alvo);
    if (fixa) {
      vistas.add(`sistema:${alvo}`);
      encontradas.push({ tipo: 'sistema', chave: fixa.chave, rotulo: bruto, descricao: fixa.descricao });
      continue;
    }

    const generica = CATALOGO_GENERICO.find((c) => normalizar(c.chave) === alvo);
    if (generica) {
      vistas.add(`sistema:${alvo}`);
      encontradas.push({
        tipo: 'sistema',
        chave: generica.equivale || generica.chave,
        rotulo: bruto,
        descricao: generica.descricao,
        generica: true,
      });
      continue;
    }

    if (!invalidas.includes(bruto)) invalidas.push(bruto);
  }

  return { mencoes: encontradas, invalidas };
}

function catalogoDoWorkspace(workspaceId) {
  const itens = [];
  for (const s of listar('status', { workspaceId })) {
    itens.push({ tipo: 'status', id: s.id, rotulo: s.nome, descricao: s.descricao || '' });
  }
  for (const e of listar('etiquetas', { workspaceId })) {
    itens.push({ tipo: 'tag', id: e.id, rotulo: e.nome, descricao: '' });
  }
  for (const d of listar('departamentos', { workspaceId })) {
    itens.push({ tipo: 'departamento', id: d.id, rotulo: d.nome, descricao: '' });
  }
  for (const o of listar('origens', { workspaceId })) {
    itens.push({ tipo: 'origem', id: o.id, rotulo: o.nome, descricao: '' });
  }
  for (const t of listar('templates', { workspaceId })) {
    itens.push({ tipo: 'template', id: t.id, rotulo: t.atalho, chave: t.nome, descricao: t.nome });
  }
  for (const v of listar('variaveis', { workspaceId })) {
    itens.push({ tipo: 'variavel', id: v.id, rotulo: v.chave, chave: v.nome, descricao: v.descricao || '' });
  }
  for (const a of listar('agentes', { workspaceId })) {
    itens.push({ tipo: 'agente', id: a.id, rotulo: a.nome, descricao: 'Agente de IA' });
  }
  for (const m of listar('membros', { workspaceId })) {
    const usuario = achar('usuarios', m.usuarioId);
    if (usuario) itens.push({ tipo: 'membro', id: m.id, rotulo: usuario.nome, descricao: 'Membro da equipe' });
  }
  const integracoes = achar('integracoes', { workspaceId });
  for (const ferramenta of integracoes?.customTools || []) {
    itens.push({
      tipo: 'personalizado',
      id: ferramenta.id,
      rotulo: ferramenta.nome,
      descricao: ferramenta.descricao || 'Chamada personalizada',
    });
  }
  return itens;
}

export function catalogoCompleto(workspaceId) {
  return [
    ...CATALOGO_FIXO.map((c) => ({ tipo: 'sistema', rotulo: c.chave, descricao: c.descricao })),
    ...CATALOGO_GENERICO.filter((c) => !c.equivale).map((c) => ({
      tipo: 'sistema',
      rotulo: c.chave,
      descricao: c.descricao,
      generica: true,
    })),
    ...catalogoDoWorkspace(workspaceId),
  ];
}

/* ------------------------------------------------------------------ */
/* Ferramentas expostas ao modelo                                       */
/* ------------------------------------------------------------------ */

function opcoes(lista) {
  return lista.map((i) => i.rotulo).filter(Boolean);
}

/**
 * Monta as ferramentas de acordo com o que o prompt realmente usa. Um agente
 * de triagem nao recebe a ferramenta de contrato, menos ferramenta, menos
 * chance de o modelo fazer o que nao devia.
 */
export function ferramentasDoAgente(agente, workspaceId) {
  const { mencoes } = analisarPrompt(agente.prompt || '', workspaceId);
  const tipos = new Set(mencoes.map((m) => m.tipo === 'sistema' ? m.chave : m.tipo));
  const itens = catalogoDoWorkspace(workspaceId);
  const ferramentas = [];

  const porTipo = (tipo) => itens.filter((i) => i.tipo === tipo);

  if (tipos.has('status')) {
    ferramentas.push({
      nome: 'alterar_status',
      descricao:
        'Muda o status da conversa no funil. Isso tambem troca o departamento e dispara a sequencia de follow-up daquele status.',
      parametros: {
        type: 'object',
        properties: { status: { type: 'string', enum: opcoes(porTipo('status')), description: 'Nome do status.' } },
        required: ['status'],
      },
    });
  }
  if (tipos.has('tag')) {
    ferramentas.push({
      nome: 'adicionar_etiqueta',
      descricao: 'Adiciona uma etiqueta a conversa. Nao remove as que ja existem.',
      parametros: {
        type: 'object',
        properties: { etiqueta: { type: 'string', enum: opcoes(porTipo('tag')) } },
        required: ['etiqueta'],
      },
    });
  }
  if (tipos.has('removertag')) {
    ferramentas.push({
      nome: 'remover_etiqueta',
      descricao:
        'Retira uma etiqueta que deixou de valer. Use quando a informacao mudar, por exemplo, o lead conseguiu o laudo que nao tinha.',
      parametros: {
        type: 'object',
        properties: { etiqueta: { type: 'string', enum: opcoes(porTipo('tag')) } },
        required: ['etiqueta'],
      },
    });
  }
  if (tipos.has('agendarretorno')) {
    ferramentas.push({
      nome: 'agendar_retorno',
      descricao:
        'Marca uma mensagem para sair no horario que o cliente combinou ("me chama depois das 18h", "amanha eu falo com minha mae"). Diferente do follow-up do status, aqui voce escolhe a hora e o texto.',
      parametros: {
        type: 'object',
        properties: {
          quando: {
            type: 'string',
            description: 'Data e hora no formato 2026-08-20 18:30, no horario de Brasilia.',
          },
          mensagem: { type: 'string', description: 'O que sera enviado naquele momento.' },
        },
        required: ['quando', 'mensagem'],
      },
    });
  }
  if (tipos.has('departamento')) {
    ferramentas.push({
      nome: 'alterar_departamento',
      descricao: 'Move a conversa para outro departamento.',
      parametros: {
        type: 'object',
        properties: { departamento: { type: 'string', enum: opcoes(porTipo('departamento')) } },
        required: ['departamento'],
      },
    });
  }
  if (tipos.has('agente') || tipos.has('membro') || tipos.has('responsavel')) {
    ferramentas.push({
      nome: 'transferir_conversa',
      descricao:
        'Transfere a conversa para outro agente de IA ou para uma pessoa da equipe. Ao transferir para pessoa, voce para de responder. Use "distribuir" quando o prompt mandar repassar para a equipe sem dizer para quem: cai em quem tem menos conversa aberta.',
      parametros: {
        type: 'object',
        properties: {
          destino: { type: 'string', enum: ['distribuir', ...opcoes(porTipo('agente')), ...opcoes(porTipo('membro'))] },
          mensagem_de_transicao: {
            type: 'string',
            description: 'Primeira pergunta do proximo atendente, para o lead nao ficar sem resposta.',
          },
        },
        required: ['destino'],
      },
    });
  }
  if (tipos.has('template')) {
    ferramentas.push({
      nome: 'enviar_template',
      descricao: 'Envia uma mensagem pronta, com texto e midia, ja cadastrada no sistema.',
      parametros: {
        type: 'object',
        properties: { template: { type: 'string', enum: opcoes(porTipo('template')) } },
        required: ['template'],
      },
    });
  }
  if (tipos.has('variavel')) {
    ferramentas.push({
      nome: 'salvar_variavel',
      descricao: 'Guarda um dado informado pelo lead no cadastro da conversa.',
      parametros: {
        type: 'object',
        properties: {
          campo: { type: 'string', enum: opcoes(porTipo('variavel')) },
          valor: { type: 'string' },
        },
        required: ['campo', 'valor'],
      },
    });
  }
  if (tipos.has('origem')) {
    ferramentas.push({
      nome: 'definir_origem',
      descricao: 'Registra de onde o lead veio.',
      parametros: {
        type: 'object',
        properties: { origem: { type: 'string', enum: opcoes(porTipo('origem')) } },
        required: ['origem'],
      },
    });
  }
  if (tipos.has('notificar')) {
    ferramentas.push({
      nome: 'notificar_membro',
      descricao: 'Avisa uma pessoa da equipe sem transferir a conversa.',
      parametros: {
        type: 'object',
        properties: {
          membro: { type: 'string', enum: opcoes(porTipo('membro')) },
          motivo: { type: 'string' },
        },
        required: ['membro', 'motivo'],
      },
    });
  }
  if (tipos.has('resumo')) {
    ferramentas.push({
      nome: 'gerar_resumo',
      descricao: 'Grava um resumo da conversa como nota interna, visivel so para a equipe.',
      parametros: {
        type: 'object',
        properties: { resumo: { type: 'string', description: 'O resumo ja escrito.' } },
        required: ['resumo'],
      },
    });
  }
  if (tipos.has('biblioteca')) {
    ferramentas.push({
      nome: 'consultar_biblioteca',
      descricao: 'Consulta a base de conhecimento do escritorio (objecoes, requisitos, regras).',
      parametros: {
        type: 'object',
        properties: { pergunta: { type: 'string' } },
        required: ['pergunta'],
      },
    });
  }
  if (tipos.has('calculadora')) {
    ferramentas.push({
      nome: 'calcular',
      descricao: 'Resolve uma conta. Use sempre que houver divisao de renda, percentual ou soma.',
      parametros: {
        type: 'object',
        properties: { expressao: { type: 'string', description: 'Ex: (1500+400)/4' } },
        required: ['expressao'],
      },
    });
  }
  if (tipos.has('dataehora')) {
    ferramentas.push({
      nome: 'data_e_hora',
      descricao: 'Devolve a data e a hora atuais, com o dia da semana.',
      parametros: { type: 'object', properties: {} },
    });
  }
  if (tipos.has('salvarnome')) {
    ferramentas.push({
      nome: 'salvar_nome',
      descricao: 'Corrige o nome do contato.',
      parametros: {
        type: 'object',
        properties: { nome: { type: 'string' } },
        required: ['nome'],
      },
    });
  }
  if (tipos.has('ativaraudio') || tipos.has('desativaraudio')) {
    ferramentas.push({
      nome: 'modo_audio',
      descricao: 'Liga ou desliga as respostas em audio.',
      parametros: {
        type: 'object',
        properties: { ligar: { type: 'boolean' } },
        required: ['ligar'],
      },
    });
  }
  if (tipos.has('desativarIA')) {
    ferramentas.push({
      nome: 'desativar_ia',
      descricao: 'Para de responder automaticamente e deixa a conversa para um humano.',
      parametros: {
        type: 'object',
        properties: { motivo: { type: 'string' } },
        required: ['motivo'],
      },
    });
  }
  if (tipos.has('gerarcontrato')) {
    ferramentas.push({
      nome: 'gerar_contrato',
      descricao:
        'Gera o contrato de honorarios com os dados ja coletados e envia o link de assinatura. So use depois da confirmacao explicita do lead.',
      parametros: {
        type: 'object',
        properties: {
          nome_completo: { type: 'string' },
          cpf: { type: 'string' },
          email: { type: 'string' },
        },
        required: ['nome_completo', 'cpf'],
      },
    });
  }
  if (tipos.has('calendario')) {
    ferramentas.push({
      nome: 'agenda',
      descricao: 'Verifica horarios livres, cria, altera ou cancela uma reuniao.',
      parametros: {
        type: 'object',
        properties: {
          acao: { type: 'string', enum: ['verificar', 'criar', 'editar', 'cancelar'] },
          quando: { type: 'string', description: 'Data e hora desejada, ex: 2026-08-20 14:30' },
          assunto: { type: 'string' },
        },
        required: ['acao'],
      },
    });
  }
  if (tipos.has('advbox')) {
    ferramentas.push({
      nome: 'consultar_processo',
      descricao: 'Consulta o andamento dos processos do cliente pelo CPF.',
      parametros: {
        type: 'object',
        properties: { cpf: { type: 'string' } },
        required: ['cpf'],
      },
    });
  }
  for (const ferramenta of porTipo('personalizado')) {
    ferramentas.push({
      nome: `personalizada_${normalizar(ferramenta.rotulo).replace(/[^a-z0-9]+/g, '_')}`,
      descricao: ferramenta.descricao || `Chamada personalizada ${ferramenta.rotulo}`,
      personalizadaId: ferramenta.id,
      parametros: parametrosDaFerramenta(ferramenta.id, workspaceId),
    });
  }

  return ferramentas;
}

function parametrosDaFerramenta(id, workspaceId) {
  const integracoes = achar('integracoes', { workspaceId });
  const ferramenta = (integracoes?.customTools || []).find((f) => f.id === id);
  if (ferramenta?.schema) {
    try {
      return typeof ferramenta.schema === 'string' ? JSON.parse(ferramenta.schema) : ferramenta.schema;
    } catch {
      /* schema invalido, cai no generico */
    }
  }
  return { type: 'object', properties: {} };
}

/* ------------------------------------------------------------------ */
/* Execucao                                                             */
/* ------------------------------------------------------------------ */

function porRotulo(workspaceId, tipoColecao, rotulo, campo = 'nome') {
  const alvo = normalizar(rotulo);
  return listar(tipoColecao, { workspaceId }).find((i) => normalizar(i[campo]) === alvo) || null;
}

function calcularExpressao(expressao) {
  const limpo = String(expressao).replace(/[^0-9+\-*/().,\s]/g, '').replace(/,/g, '.');
  if (!limpo.trim()) throw new Error('Expressao vazia');
  // eslint-disable-next-line no-new-func
  const resultado = Function(`"use strict"; return (${limpo});`)();
  if (!Number.isFinite(resultado)) throw new Error('Resultado invalido');
  return resultado;
}

export async function executarFerramenta({ nome, argumentos, contato, agente, conexao, workspaceId }) {
  const registrar = (texto) => registrarLog(workspaceId, contato.id, 'mencao', texto, { tipo: 'agente', id: agente.id, nome: agente.nome });

  switch (nome) {
    case 'alterar_status': {
      const status = porRotulo(workspaceId, 'status', argumentos.status);
      if (!status) return { erro: `Status "${argumentos.status}" nao existe no workspace.` };
      await aplicarStatus(contato, status, { tipo: 'agente', id: agente.id, nome: agente.nome });
      lancar(workspaceId, contato.id, 'mencao_status', custoDaMencao('status'));
      registrar(`Status alterado para ${status.nome}`);
      return { ok: true, status: status.nome };
    }

    case 'adicionar_etiqueta': {
      const etiqueta = porRotulo(workspaceId, 'etiquetas', argumentos.etiqueta);
      if (!etiqueta) return { erro: `Etiqueta "${argumentos.etiqueta}" nao existe.` };
      const atuais = new Set(contato.etiquetas || []);
      atuais.add(etiqueta.id);
      atualizar('contatos', contato.id, { etiquetas: [...atuais] });
      contato.etiquetas = [...atuais];
      lancar(workspaceId, contato.id, 'mencao_tag', custoDaMencao('tag'));
      registrar(`Etiqueta adicionada: ${etiqueta.nome}`);
      emitir(workspaceId, 'contato', { contatoId: contato.id });
      return { ok: true };
    }

    case 'remover_etiqueta': {
      const etiqueta = porRotulo(workspaceId, 'etiquetas', argumentos.etiqueta);
      if (!etiqueta) return { erro: `Etiqueta "${argumentos.etiqueta}" nao existe.` };
      const restantes = (contato.etiquetas || []).filter((id) => id !== etiqueta.id);
      atualizar('contatos', contato.id, { etiquetas: restantes });
      contato.etiquetas = restantes;
      lancar(workspaceId, contato.id, 'mencao_removertag', custoDaMencao('tag'));
      registrar(`Etiqueta removida: ${etiqueta.nome}`);
      emitir(workspaceId, 'contato', { contatoId: contato.id });
      return { ok: true };
    }

    case 'agendar_retorno': {
      const quando = new Date(String(argumentos.quando).replace(' ', 'T'));
      if (Number.isNaN(quando.getTime())) {
        return { erro: 'Data invalida. Use o formato 2026-08-20 18:30.' };
      }
      if (quando.getTime() < Date.now()) {
        return { erro: 'Esse horario ja passou. Confirme com o cliente quando ele prefere.' };
      }
      const agendamento = inserir('agendamentos', {
        id: novoId('agd'),
        workspaceId,
        contatoId: contato.id,
        conexaoId: contato.conexaoId,
        tipo: 'manual',
        conteudo: argumentos.mensagem,
        quando: quando.toISOString(),
        previstoPara: quando.toISOString(),
        estado: 'pendente',
        criadoPor: { tipo: 'agente', id: agente.id, nome: agente.nome },
      });
      lancar(workspaceId, contato.id, 'mencao_agendarretorno', custoDaMencao('agendarretorno'));
      registrar(`Retorno agendado para ${quando.toLocaleString('pt-BR')}`);
      emitir(workspaceId, 'agendamento', { contatoId: contato.id });
      return { ok: true, agendado_para: quando.toLocaleString('pt-BR'), id: agendamento.id };
    }

    case 'alterar_departamento': {
      const departamento = porRotulo(workspaceId, 'departamentos', argumentos.departamento);
      if (!departamento) return { erro: `Departamento "${argumentos.departamento}" nao existe.` };
      atualizar('contatos', contato.id, { departamentoId: departamento.id });
      contato.departamentoId = departamento.id;
      lancar(workspaceId, contato.id, 'mencao_departamento', custoDaMencao('departamento'));
      registrar(`Departamento alterado para ${departamento.nome}`);
      emitir(workspaceId, 'contato', { contatoId: contato.id });
      return { ok: true };
    }

    case 'transferir_conversa': {
      const destinoAgente = porRotulo(workspaceId, 'agentes', argumentos.destino);
      let responsavel = null;
      if (String(argumentos.destino || '').toLowerCase() === 'distribuir') {
        const sorteado = sortearResponsavel(workspaceId, contato, agente);
        if (!sorteado) return { erro: 'Nao ha membro disponivel para distribuir a conversa.' };
        responsavel = sorteado;
      } else if (destinoAgente) {
        responsavel = { tipo: 'agente', id: destinoAgente.id, nome: destinoAgente.nome };
      } else {
        const membros = listar('membros', { workspaceId });
        const membro = membros.find((m) => {
          const u = achar('usuarios', m.usuarioId);
          return u && normalizar(u.nome) === normalizar(argumentos.destino);
        });
        if (!membro) return { erro: `Nao encontrei "${argumentos.destino}" entre agentes e membros.` };
        const usuario = achar('usuarios', membro.usuarioId);
        responsavel = { tipo: 'membro', id: membro.id, nome: usuario.nome };
      }

      if (argumentos.mensagem_de_transicao) {
        await enviarMensagem({
          contato,
          conexao,
          conteudo: argumentos.mensagem_de_transicao,
          autor: { tipo: 'agente', id: agente.id, nome: agente.nome },
        });
      }

      atualizar('contatos', contato.id, {
        responsavel,
        estado: responsavel.tipo === 'agente' ? 'ia' : 'pendente',
        aceitoPor: null,
        /* Carimbo da entrega. Sem ele o rodizio nao tem como desempatar duas
           pessoas com a mesma carga, e a fila para de girar. */
        responsavelDesde: agora(),
      });
      contato.responsavel = responsavel;
      contato.estado = responsavel.tipo === 'agente' ? 'ia' : 'pendente';
      lancar(workspaceId, contato.id, 'mencao_responsavel', custoDaMencao('responsavel'));
      registrar(`Conversa transferida para ${responsavel.nome}`);
      emitir(workspaceId, 'contato', { contatoId: contato.id });

      if (responsavel.tipo === 'membro') {
        notificar(workspaceId, responsavel.id, 'atribuicao', 'Conversa atribuida a voce', `${contato.nome} foi transferido para voce.`, contato.id);
      }
      return { ok: true, transferido_para: responsavel.nome, pare_de_responder: responsavel.tipo === 'membro' };
    }

    case 'enviar_template': {
      const template =
        porRotulo(workspaceId, 'templates', argumentos.template, 'atalho') ||
        porRotulo(workspaceId, 'templates', argumentos.template, 'nome');
      if (!template) return { erro: `Template "${argumentos.template}" nao existe.` };
      const conteudo = aplicarVariaveis(template.conteudo, {
        nome: contato.nome,
        ...(contato.variaveis || {}),
      });
      await enviarMensagem({
        contato,
        conexao,
        tipo: template.midia ? template.midia.tipo : 'texto',
        conteudo,
        midia: template.midia,
        templateId: template.id,
        autor: { tipo: 'agente', id: agente.id, nome: agente.nome },
      });
      lancar(workspaceId, contato.id, 'mencao_template', custoDaMencao('template'));
      registrar(`Template enviado: ${template.nome}`);
      return { ok: true, enviado: template.nome };
    }

    case 'salvar_variavel': {
      const variavel = porRotulo(workspaceId, 'variaveis', argumentos.campo, 'chave') || porRotulo(workspaceId, 'variaveis', argumentos.campo, 'nome');
      const chave = variavel ? variavel.chave : normalizar(argumentos.campo).replace(/[^a-z0-9]+/g, '_');
      const variaveis = { ...(contato.variaveis || {}), [chave]: String(argumentos.valor) };
      atualizar('contatos', contato.id, { variaveis });
      contato.variaveis = variaveis;
      lancar(workspaceId, contato.id, 'mencao_variavel', custoDaMencao('variavel'));
      registrar(`Variavel ${chave} = ${argumentos.valor}`);
      emitir(workspaceId, 'contato', { contatoId: contato.id });
      return { ok: true };
    }

    case 'definir_origem': {
      const origem = porRotulo(workspaceId, 'origens', argumentos.origem);
      if (!origem) return { erro: `Origem "${argumentos.origem}" nao existe.` };
      atualizar('contatos', contato.id, { origemId: origem.id });
      contato.origemId = origem.id;
      lancar(workspaceId, contato.id, 'mencao_origem', custoDaMencao('origem'));
      registrar(`Origem definida: ${origem.nome}`);
      return { ok: true };
    }

    case 'notificar_membro': {
      const membros = listar('membros', { workspaceId });
      const membro = membros.find((m) => {
        const u = achar('usuarios', m.usuarioId);
        return u && normalizar(u.nome) === normalizar(argumentos.membro);
      });
      if (!membro) return { erro: `Membro "${argumentos.membro}" nao encontrado.` };
      notificar(workspaceId, membro.id, 'ia', 'Aviso do agente de IA', argumentos.motivo, contato.id);
      lancar(workspaceId, contato.id, 'mencao_notificar', custoDaMencao('notificar'));
      registrar(`Notificou ${argumentos.membro}: ${argumentos.motivo}`);
      return { ok: true };
    }

    case 'gerar_resumo': {
      const mensagem = inserirNota(contato, argumentos.resumo, { tipo: 'agente', id: agente.id, nome: agente.nome });
      lancar(workspaceId, contato.id, 'mencao_resumo', custoDaMencao('resumo'));
      registrar('Resumo gravado como nota interna');
      emitir(workspaceId, 'mensagem', { contatoId: contato.id, mensagem });
      return { ok: true };
    }

    case 'consultar_biblioteca': {
      const bases = (agente.conhecimentoIds || [])
        .map((id) => achar('conhecimento', id))
        .filter(Boolean);
      lancar(workspaceId, contato.id, 'mencao_biblioteca', custoDaMencao('biblioteca'));
      registrar(`Consultou a base de conhecimento: ${argumentos.pergunta}`);
      if (!bases.length) return { resultado: 'Nenhuma base de conhecimento vinculada a este agente.' };
      const termos = normalizar(argumentos.pergunta).split(/\s+/).filter((t) => t.length > 3);
      const trechos = [];
      for (const base of bases) {
        for (const bloco of String(base.conteudo || '').split(/\n\s*\n/)) {
          const alvo = normalizar(bloco);
          const pontos = termos.reduce((soma, termo) => soma + (alvo.includes(termo) ? 1 : 0), 0);
          if (pontos > 0) trechos.push({ pontos, bloco, base: base.nome });
        }
      }
      trechos.sort((a, b) => b.pontos - a.pontos);
      if (!trechos.length) {
        return { resultado: bases.map((b) => `# ${b.nome}\n${String(b.conteudo).slice(0, 1500)}`).join('\n\n') };
      }
      return { resultado: trechos.slice(0, 5).map((t) => `[${t.base}]\n${t.bloco}`).join('\n\n') };
    }

    case 'calcular': {
      lancar(workspaceId, contato.id, 'mencao_calculadora', custoDaMencao('calculadora'));
      try {
        const resultado = calcularExpressao(argumentos.expressao);
        registrar(`Calculou ${argumentos.expressao} = ${resultado}`);
        return { expressao: argumentos.expressao, resultado };
      } catch (erro) {
        return { erro: erro.message };
      }
    }

    case 'data_e_hora': {
      const data = new Date();
      const formatador = new Intl.DateTimeFormat('pt-BR', {
        timeZone: 'America/Sao_Paulo',
        dateStyle: 'full',
        timeStyle: 'short',
      });
      lancar(workspaceId, contato.id, 'mencao_dataehora', custoDaMencao('dataehora'));
      return { agora: formatador.format(data), iso: data.toISOString() };
    }

    case 'salvar_nome': {
      atualizar('contatos', contato.id, { nome: argumentos.nome });
      contato.nome = argumentos.nome;
      lancar(workspaceId, contato.id, 'mencao_salvarnome', custoDaMencao('salvarnome'));
      registrar(`Nome do contato ajustado para ${argumentos.nome}`);
      emitir(workspaceId, 'contato', { contatoId: contato.id });
      return { ok: true };
    }

    case 'modo_audio': {
      atualizar('contatos', contato.id, { modoAudio: Boolean(argumentos.ligar) });
      contato.modoAudio = Boolean(argumentos.ligar);
      lancar(workspaceId, contato.id, 'mencao_audio', custoDaMencao('audio'));
      registrar(`Modo audio ${argumentos.ligar ? 'ativado' : 'desativado'}`);
      return { ok: true };
    }

    case 'desativar_ia': {
      atualizar('contatos', contato.id, { responsavel: null, estado: 'pendente', aceitoPor: null });
      contato.responsavel = null;
      contato.estado = 'pendente';
      lancar(workspaceId, contato.id, 'mencao_desativarIA', custoDaMencao('desativarIA'));
      registrar(`IA desativada: ${argumentos.motivo}`);
      emitir(workspaceId, 'contato', { contatoId: contato.id });
      return { ok: true, pare_de_responder: true };
    }

    case 'gerar_contrato': {
      const { gerarContrato } = await import('../integracoes/zapsign.js');
      lancar(workspaceId, contato.id, 'mencao_gerarcontrato', custoDaMencao('gerarcontrato'));
      const resultado = await gerarContrato({ contato, agente, conexao, dados: argumentos });
      registrar(resultado.ok ? 'Contrato gerado e enviado' : `Falha ao gerar contrato: ${resultado.erro}`);
      return resultado;
    }

    case 'agenda': {
      const { operarAgenda } = await import('../integracoes/agenda.js');
      lancar(workspaceId, contato.id, 'mencao_calendario', custoDaMencao('calendario'));
      const resultado = await operarAgenda({ contato, agente, argumentos });
      registrar(`Agenda (${argumentos.acao}): ${resultado.resumo || resultado.erro || 'ok'}`);
      return resultado;
    }

    case 'consultar_processo': {
      const { consultarProcessos } = await import('../integracoes/advbox.js');
      lancar(workspaceId, contato.id, 'mencao_advbox', custoDaMencao('advbox'));
      const resultado = await consultarProcessos({ workspaceId, cpf: argumentos.cpf });
      registrar(`Consulta de processo para o CPF ${argumentos.cpf}`);
      return resultado;
    }

    default: {
      if (nome.startsWith('personalizada_')) {
        const { executarCustomTool } = await import('../integracoes/personalizada.js');
        lancar(workspaceId, contato.id, 'mencao_personalizada', custoDaMencao('personalizado'));
        const resultado = await executarCustomTool({ workspaceId, nomeFerramenta: nome, contato, argumentos });
        registrar(`Chamada personalizada ${nome}`);
        return resultado;
      }
      return { erro: `Ferramenta desconhecida: ${nome}` };
    }
  }
}

export function inserirNota(contato, texto, autor, mencoes = []) {
  const mensagem = inserirMensagem(contato.id, {
    id: novoId('msg'),
    workspaceId: contato.workspaceId,
    direcao: 'interna',
    tipo: 'texto',
    conteudo: texto,
    autor,
    nota: true,
    mencoes,
    situacao: 'enviada',
  });
  return mensagem;
}

export function notificar(workspaceId, membroId, tipo, titulo, texto, contatoId = null) {
  const membro = achar('membros', membroId);
  if (!membro) return null;
  const notificacao = inserir('notificacoes', {
    id: novoId('ntf'),
    workspaceId,
    membroId,
    usuarioId: membro.usuarioId,
    tipo,
    titulo,
    texto,
    contatoId,
    lida: false,
  });
  emitirParaUsuario(workspaceId, membro.usuarioId, 'notificacao', { notificacao });
  return notificacao;
}

export { reagendarFollowups };
export const historicoDe = mensagensDe;
export const marcaDeTempo = agora;
