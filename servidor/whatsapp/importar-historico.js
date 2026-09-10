import { atualizar, inserir, inserirMensagem, listar, mensagensDe, registrarLog } from '../nucleo/banco.js';
import { agora, normalizarTelefoneDoWhatsApp, novoId } from '../nucleo/util.js';
import { extrairMensagem } from './drivers/qrcode.js';

/**
 * Traz para o sistema as conversas que ja estavam no celular.
 *
 * Quando um numero e ligado por QR Code, o WhatsApp sincroniza o historico
 * dele para o servico da sessao — no caso deste escritorio, 53 mil mensagens
 * em 204 conversas apareceram sozinhas do lado da Evolution. Elas nao entram
 * no sistema por conta propria, e nem deveriam: o webhook so entrega o que
 * chega a partir de agora.
 *
 * ESTA IMPORTACAO NAO PASSA PELO FUNIL DE RECEBIMENTO, e a razao e serie: o
 * funil aciona agente, agenda follow-up e notifica a equipe. Rodado sobre
 * conversas antigas, ele faria o agente de recepcao escrever para dezenas de
 * pessoas reais — muitas das quais nunca foram clientes — dizendo "vamos
 * comecar?" sobre um assunto de meses atras. Aqui a mensagem e gravada e mais
 * nada acontece.
 *
 * TRES ESCOLHAS QUE MERECEM SER DITAS
 *
 * 1. So conversa de PESSOA. Grupo e lista de transmissao ficam de fora: o
 *    sistema trata a conversa como uma pessoa com um telefone, e um grupo
 *    cadastrado assim viraria um contato com o numero errado.
 *
 * 2. Entra ARQUIVADA, sem responsavel. O pedido era historico consultavel, e
 *    nao fila de trabalho — vinte conversas antigas no topo da fila enterrariam
 *    o cliente que escreveu hoje. Se qualquer uma delas voltar a falar, o
 *    proprio recebimento a devolve para a fila (ver recebimento.js).
 *
 * 3. A MIDIA NAO E BAIXADA. Imagem, audio e PDF ficam registrados pelo tipo e
 *    pela legenda, sem o arquivo. Baixar o anexo de 53 mil mensagens sao muitos
 *    gigabytes e horas de espera, para um material que quase todo ja nao se vai
 *    reabrir. O que chega DEPOIS da importacao continua vindo com arquivo e
 *    tudo, pelo caminho normal.
 */

/** Chats que nao sao conversa com uma pessoa, por mais que o endereco pareca. */
const JIDS_DE_SISTEMA = new Set(['0', 'status']);

function ehConversaDePessoa(jid) {
  const texto = String(jid || '');
  if (!texto.endsWith('@s.whatsapp.net')) return false;
  return !JIDS_DE_SISTEMA.has(texto.split('@')[0]);
}

async function chamar(cfg, caminho, corpo) {
  const resposta = await fetch(`${cfg.servidor}${caminho}`, {
    method: 'POST',
    headers: { apikey: cfg.chave, 'Content-Type': 'application/json' },
    body: JSON.stringify(corpo || {}),
    signal: AbortSignal.timeout(60000),
  });
  if (!resposta.ok) throw new Error(`O servico respondeu ${resposta.status} em ${caminho}`);
  return resposta.json();
}

/** A Evolution ja devolveu essa lista em formatos diferentes entre versoes. */
function registrosDe(resposta) {
  if (Array.isArray(resposta)) return resposta;
  if (Array.isArray(resposta?.messages?.records)) return resposta.messages.records;
  if (Array.isArray(resposta?.records)) return resposta.records;
  return [];
}

/**
 * O nome de quem fala, olhando so as mensagens DELA.
 *
 * O pushName de uma mensagem nossa e o nome do proprio escritorio ("Voce", no
 * caso da Evolution). Tirar o nome do contato dali renomearia todo mundo para
 * a mesma coisa.
 */
function nomeDoContato(registros) {
  for (const item of registros) {
    if (item?.key?.fromMe) continue;
    const nome = String(item?.pushName || '').trim();
    if (nome) return nome;
  }
  return '';
}

function quandoDe(item) {
  const segundos = Number(item?.messageTimestamp);
  if (!Number.isFinite(segundos) || segundos <= 0) return agora();
  return new Date(segundos * 1000).toISOString();
}

/**
 * Importa o historico de uma conexao por QR Code.
 *
 * `aoAndar` recebe o progresso, porque vinte conversas com centenas de
 * mensagens cada demoram o bastante para uma tela em branco parecer travada.
 */
export async function importarHistorico({ conexao, limitePorConversa = 500, aoAndar = null }) {
  const cfg = conexao?.qrcode || {};
  if (!cfg.servidor || !cfg.chave || !cfg.instancia) {
    throw new Error('Conexao sem endereco, chave ou instancia configurada.');
  }

  const workspaceId = conexao.workspaceId;
  const base = { servidor: String(cfg.servidor).replace(/\/+$/, ''), chave: cfg.chave };
  const instancia = cfg.instancia;

  const chats = await chamar(base, `/chat/findChats/${instancia}`, {});
  const daPessoa = (Array.isArray(chats) ? chats : []).filter((c) => ehConversaDePessoa(c?.remoteJid));

  /* O proprio numero do escritorio aparece na lista como uma conversa consigo
     mesmo. Importa-la criaria um "cliente" que e o escritorio. */
  const meuNumero = normalizarTelefoneDoWhatsApp(conexao.numero || '');

  const relato = {
    conversasEncontradas: daPessoa.length,
    conversasImportadas: 0,
    conversasJaExistentes: 0,
    mensagensGravadas: 0,
    mensagensJaExistentes: 0,
    puladas: [],
  };

  let feitas = 0;
  for (const chat of daPessoa) {
    feitas += 1;
    const telefone = normalizarTelefoneDoWhatsApp(String(chat.remoteJid).split('@')[0]);
    if (!telefone) { relato.puladas.push(`${chat.remoteJid}: telefone invalido`); continue; }
    if (meuNumero && telefone === meuNumero) { relato.puladas.push(`${telefone}: e o proprio numero`); continue; }

    let resposta;
    try {
      resposta = await chamar(base, `/chat/findMessages/${instancia}`, {
        where: { key: { remoteJid: chat.remoteJid } },
        page: 1,
        offset: limitePorConversa,
      });
    } catch (erro) {
      relato.puladas.push(`${telefone}: ${erro.message}`);
      continue;
    }

    const registros = registrosDe(resposta);
    if (!registros.length) { relato.puladas.push(`${telefone}: sem mensagens`); continue; }

    /* Do mais antigo para o mais novo: a conversa se le em ordem, e a previa
       do contato tem de sobrar a ultima. */
    registros.sort((a, b) => Number(a?.messageTimestamp || 0) - Number(b?.messageTimestamp || 0));

    let contato = listar('contatos', { workspaceId }).find((c) => c.telefone === telefone) || null;
    const jaExistia = Boolean(contato);

    if (!contato) {
      contato = inserir('contatos', {
        id: novoId('ctt'),
        workspaceId,
        conexaoId: conexao.id,
        telefone,
        nome: nomeDoContato(registros) || telefone,
        /* Sem responsavel e arquivada, de proposito: ver o cabecalho. */
        responsavel: null,
        estado: 'arquivado',
        statusId: null,
        departamentoId: null,
        etiquetas: [],
        naoLidas: 0,
        arquivos: [],
        variaveis: {},
        importado: true,
      });
      registrarLog(workspaceId, contato.id, 'importacao', 'Conversa trazida do historico do WhatsApp');
      relato.conversasImportadas += 1;
    } else {
      relato.conversasJaExistentes += 1;
    }

    const idsQueJaTenho = new Set(mensagensDe(contato.id).map((m) => m.idExterno).filter(Boolean));
    let ultima = null;

    for (const item of registros) {
      const idExterno = item?.key?.id || null;
      if (idExterno && idsQueJaTenho.has(idExterno)) { relato.mensagensJaExistentes += 1; continue; }

      const extraido = extrairMensagem(item);
      if (!extraido) continue;

      const daEquipe = Boolean(item?.key?.fromMe);
      const quando = quandoDe(item);

      ultima = inserirMensagem(contato.id, {
        id: novoId('msg'),
        workspaceId,
        direcao: daEquipe ? 'saida' : 'entrada',
        tipo: extraido.tipo,
        conteudo: extraido.conteudo,
        /* Sem o arquivo: so o tipo e a legenda. Ver o cabecalho, escolha 3. */
        midia: null,
        idExterno,
        autor: daEquipe
          ? { tipo: 'membro', nome: 'Pelo celular' }
          : { tipo: 'cliente', nome: contato.nome },
        situacao: daEquipe ? 'enviada' : 'recebida',
        criadoEm: quando,
        importada: true,
      });
      if (idExterno) idsQueJaTenho.add(idExterno);
      relato.mensagensGravadas += 1;
    }

    if (ultima) {
      atualizar('contatos', contato.id, {
        ultimaMensagemEm: ultima.criadoEm,
        previa: (ultima.conteudo || `[${ultima.tipo}]`).slice(0, 120),
        ...(jaExistia ? {} : { primeiraMensagemEm: registros.length ? quandoDe(registros[0]) : ultima.criadoEm }),
      });
    }

    if (aoAndar) aoAndar({ feitas, total: daPessoa.length, telefone, nome: contato.nome });
  }

  return relato;
}
