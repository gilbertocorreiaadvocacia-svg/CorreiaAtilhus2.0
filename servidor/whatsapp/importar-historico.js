import { atualizar, inserir, inserirMensagem, listar, mensagensDe, registrarLog } from '../nucleo/banco.js';
import { agora, normalizarTelefoneDoWhatsApp, novoId } from '../nucleo/util.js';
import { extrairMensagem } from './drivers/qrcode.js';
import { mapaDaAgenda } from './agenda.js';
import { SEM_IDENTIFICACAO, nomeValido, podeTrocarNome } from './nomes.js';

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
 * 2. Entra em ATIVOS, com a pessoa que conectou o numero como responsavel. Era
 *    arquivada, sem dono, e o escritorio pediu o contrario: quem ja conversa
 *    com o escritorio e cliente em andamento, e tem de estar a vista. Ha um
 *    efeito que vale saber — conversa com pessoa responsavel NAO e respondida
 *    por agente. Quem ja e cliente, ao escrever de novo, fala com gente; a
 *    Recepcao fica para numero que o escritorio nunca viu.
 *
 * 3. A MIDIA NAO E BAIXADA. Imagem, audio e PDF ficam registrados pelo tipo e
 *    pela legenda, sem o arquivo. Baixar o anexo de 53 mil mensagens sao muitos
 *    gigabytes e horas de espera, para um material que quase todo ja nao se vai
 *    reabrir. O que chega DEPOIS da importacao continua vindo com arquivo e
 *    tudo, pelo caminho normal.
 */

/** Chats que nao sao conversa com uma pessoa, por mais que o endereco pareca. */
const JIDS_DE_SISTEMA = new Set(['0', 'status']);

/**
 * Conversa de pessoa vem em DOIS enderecamentos, e o segundo quase passou
 * batido.
 *
 * O antigo e `numero@s.whatsapp.net`, que traz o telefone no proprio endereco.
 * O novo e `43263406899213@lid` — um identificador opaco, sem telefone
 * dentro. Neste escritorio a diferenca foi de 33 mensagens contra 28.509: quem
 * filtrar so pelo formato antigo conclui que nao ha historico, e conclui
 * errado.
 *
 * Grupo (@g.us) e canal (@newsletter) continuam de fora: o sistema modela
 * conversa como uma pessoa com um telefone.
 */
function ehConversaDePessoa(jid) {
  const texto = String(jid || '');
  if (texto.endsWith('@lid')) return true;
  if (!texto.endsWith('@s.whatsapp.net')) return false;
  return !JIDS_DE_SISTEMA.has(texto.split('@')[0]);
}

/**
 * O telefone de uma conversa, quando ele existe.
 *
 * Numa conversa @lid o telefone so aparece se alguma mensagem trouxer
 * `key.remoteJidAlt`, e isso so acontece nas conversas com trafego RECENTE: o
 * WhatsApp manda o vinculo junto com mensagem nova, nunca com o historico
 * sincronizado. Conferido no banco da Evolution — de 141 conversas @lid, 4
 * tinham o vinculo.
 *
 * Sem telefone a conversa entra assim mesmo, chaveada pelo proprio @lid. Ela
 * fica legivel e pesquisavel, e o dia em que a pessoa escrever de novo o
 * recebimento costura as duas (ver costurarLid, em recebimento.js).
 */
function telefoneDosRegistros(registros) {
  for (const item of registros) {
    const alt = String(item?.key?.remoteJidAlt || '');
    if (alt.endsWith('@s.whatsapp.net')) return alt.split('@')[0];
  }
  return '';
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

/**
 * Os nomes que a Evolution guarda, por endereco (@s.whatsapp.net e @lid).
 *
 * Nao e a mesma coisa que a agenda: o campo comeca com o nome salvo e vai sendo
 * trocado pelo de perfil a cada mensagem. Por isso vale como perfil, abaixo da
 * agenda que o sistema guardou do evento. Falhar aqui nao para a importacao —
 * so deixa menos nome para escolher.
 */
async function nomesDaEvolution(cfg, instancia) {
  const mapa = new Map();
  try {
    const lista = await chamar(cfg, `/chat/findContacts/${instancia}`, {});
    for (const c of Array.isArray(lista) ? lista : []) {
      const jid = String(c?.remoteJid || c?.id || '');
      const nome = nomeValido(c?.pushName || c?.name, jid);
      if (jid && nome) mapa.set(jid, nome);
    }
  } catch {
    /* sem a lista, seguem a agenda, o nome da conversa e o das mensagens */
  }
  return mapa;
}

/**
 * O melhor nome para a conversa, e de onde ele veio.
 *
 * Em ordem: a agenda do celular guardada pelo sistema, o que a Evolution sabe
 * do contato, o nome da conversa, o nome que a pessoa usa nas mensagens, e por
 * fim o numero. So o primeiro conta como agenda; o resto e perfil, e um nome da
 * agenda que chegar depois passa por cima (ver nomes.js).
 */
function escolherNome({ jid, telefone, chat, registros, agenda, daEvolution }) {
  const pn = telefone ? `${telefone}@s.whatsapp.net` : '';
  const salvo = agenda.get(jid) || (pn && agenda.get(pn));
  if (salvo) return { nome: salvo, origem: 'agenda' };

  const candidatos = [
    daEvolution.get(jid),
    pn && daEvolution.get(pn),
    nomeValido(chat?.name, jid),
    nomeValido(chat?.pushName, jid),
    nomeDoContato(registros),
  ];
  const perfil = candidatos.map((n) => nomeValido(n, jid)).find((n) => n && n !== telefone);
  if (perfil) return { nome: perfil, origem: 'perfil' };
  return { nome: telefone || SEM_IDENTIFICACAO, origem: null };
}

function quandoDe(item) {
  const segundos = Number(item?.messageTimestamp);
  if (!Number.isFinite(segundos) || segundos <= 0) return agora();
  return new Date(segundos * 1000).toISOString();
}

/**
 * Importa o historico de uma conexao por QR Code.
 *
 * `responsavel` e a pessoa da equipe que fica com as conversas em Ativos:
 * { tipo: 'membro', id, nome }. Sem ela a conversa nao tem como estar em
 * Ativos — a aba e, por definicao, o que alguem aceitou.
 *
 * `aoAndar` recebe o progresso, porque vinte conversas com centenas de
 * mensagens cada demoram o bastante para uma tela em branco parecer travada.
 *
 * Pode rodar quantas vezes quiser: mensagem ja gravada e reconhecida pelo id e
 * nao se repete, e conversa que ja existe nao e recriada.
 */
export async function importarHistorico({ conexao, responsavel = null, limitePorConversa = 50000, aoAndar = null }) {
  const cfg = conexao?.qrcode || {};
  if (!cfg.servidor || !cfg.chave || !cfg.instancia) {
    throw new Error('Conexao sem endereco, chave ou instancia configurada.');
  }
  if (!responsavel?.id) throw new Error('Falta a pessoa responsavel pelas conversas importadas.');

  const workspaceId = conexao.workspaceId;
  const base = { servidor: String(cfg.servidor).replace(/\/+$/, ''), chave: cfg.chave };
  const instancia = cfg.instancia;

  const agenda = mapaDaAgenda(conexao);
  const daEvolution = await nomesDaEvolution(base, instancia);
  const emAtivos = {
    responsavel: { tipo: 'membro', id: responsavel.id, nome: responsavel.nome || 'Equipe' },
    aceitoPor: responsavel.id,
    estado: 'ativo',
  };

  const chats = await chamar(base, `/chat/findChats/${instancia}`, {});
  const daPessoa = (Array.isArray(chats) ? chats : []).filter((c) => ehConversaDePessoa(c?.remoteJid));

  /* O proprio numero do escritorio aparece na lista como uma conversa consigo
     mesmo. Importa-la criaria um "cliente" que e o escritorio. */
  const meuNumero = normalizarTelefoneDoWhatsApp(conexao.numero || '');

  const relato = {
    conversasEncontradas: daPessoa.length,
    conversasImportadas: 0,
    conversasJaExistentes: 0,
    conversasRenomeadas: 0,
    comNomeDaAgenda: 0,
    semNome: 0,
    mensagensGravadas: 0,
    mensagensJaExistentes: 0,
    puladas: [],
  };

  let feitas = 0;
  for (const chat of daPessoa) {
    feitas += 1;
    const jid = String(chat.remoteJid);
    const ehLid = jid.endsWith('@lid');

    let resposta;
    try {
      resposta = await chamar(base, `/chat/findMessages/${instancia}`, {
        where: { key: { remoteJid: chat.remoteJid } },
        page: 1,
        offset: limitePorConversa,
      });
    } catch (erro) {
      /* Uma conversa que falhou nao derruba as outras. (Aqui ainda nao ha
         telefone: citar a variavel antes de ela existir derrubava a
         importacao INTEIRA na primeira conversa que falhasse.) */
      relato.puladas.push(`${jid}: ${erro.message}`);
      continue;
    }

    const registros = registrosDe(resposta);
    if (!registros.length) { relato.puladas.push(`${jid}: sem mensagens`); continue; }

    /* O telefone so da para saber depois de ler as mensagens: numa conversa
       @lid ele vem em key.remoteJidAlt, e nao no endereco. */
    const telefone = ehLid
      ? normalizarTelefoneDoWhatsApp(telefoneDosRegistros(registros))
      : normalizarTelefoneDoWhatsApp(jid.split('@')[0]);

    if (telefone && meuNumero && telefone === meuNumero) {
      relato.puladas.push(`${telefone}: e o proprio numero`);
      continue;
    }

    /* Sem telefone, a chave e o proprio @lid. Vai no campo lid, e nao no
       telefone: um identificador de 15 digitos no campo de telefone viraria
       "+43 (26) 34068-99213" na tela, um numero que nao existe. */
    const chaveLid = telefone ? null : jid;

    /* Do mais antigo para o mais novo: a conversa se le em ordem, e a previa
       do contato tem de sobrar a ultima. */
    registros.sort((a, b) => Number(a?.messageTimestamp || 0) - Number(b?.messageTimestamp || 0));

    const escolhido = escolherNome({ jid, telefone, chat, registros, agenda, daEvolution });

    let contato = listar('contatos', { workspaceId }).find((c) =>
      telefone ? c.telefone === telefone : c.lid === chaveLid,
    ) || null;
    const jaExistia = Boolean(contato);

    if (!contato) {
      contato = inserir('contatos', {
        id: novoId('ctt'),
        workspaceId,
        conexaoId: conexao.id,
        telefone: telefone || '',
        lid: ehLid ? jid : null,
        nome: escolhido.nome,
        nomeOrigem: escolhido.origem,
        /* Em Ativos, com a pessoa que conectou: ver o cabecalho, escolha 2. */
        ...emAtivos,
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
      const mudancas = {};
      /* Nome melhor que o atual, pela regra de nomes.js: agenda por cima de
         perfil, perfil so por cima de numero, e nada por cima do manual. */
      if (escolhido.origem && escolhido.nome !== contato.nome && podeTrocarNome(contato, escolhido.origem)) {
        Object.assign(mudancas, { nome: escolhido.nome, nomeOrigem: escolhido.origem });
        relato.conversasRenomeadas += 1;
      }
      /* A importacao antiga deixava tudo arquivado e sem dono. Essas voltam
         para Ativos; conversa que alguem ja mexeu fica onde esta. */
      if (contato.importado && contato.estado === 'arquivado' && !contato.responsavel) {
        Object.assign(mudancas, emAtivos);
      }
      if (Object.keys(mudancas).length) {
        atualizar('contatos', contato.id, mudancas);
        Object.assign(contato, mudancas);
      }
    }
    if (contato.nomeOrigem === 'agenda') relato.comNomeDaAgenda += 1;
    if (!contato.nomeOrigem && (contato.nome === contato.telefone || contato.nome === SEM_IDENTIFICACAO)) {
      relato.semNome += 1;
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
