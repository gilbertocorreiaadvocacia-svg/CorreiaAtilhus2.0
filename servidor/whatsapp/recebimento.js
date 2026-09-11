import {
  achar,
  apagarMensagens,
  atualizar,
  atualizarMensagem,
  inserir,
  inserirMensagem,
  listar,
  mensagensDe,
  registrarLog,
} from '../nucleo/banco.js';
import { emitir } from '../nucleo/eventos.js';
import { membrosQuePodemVer } from '../nucleo/auth.js';
import { notificar } from '../ia/mencoes.js';
import { agora, normalizar, normalizarTelefone, normalizarTelefoneDoWhatsApp, novoId } from '../nucleo/util.js';
import { agendarResposta, agentePorPalavraChave, cancelarResposta } from '../ia/motor.js';
import { nomeNaAgenda } from './agenda.js';
import { agendarFoto } from './fotos.js';
import { SEM_IDENTIFICACAO, nomeEhProvisorio, podeTrocarNome } from './nomes.js';
import { agendarFollowupsDoStatus, cancelarFollowups, limparAgendamentosDoContato, reagendarFollowups } from '../automacao/followup.js';
import { marcarComoLida } from './envio.js';
import { driverDa } from './drivers/index.js';
import { transcrever, transcricaoDisponivel } from '../ia/audio.js';

/**
 * Porta de entrada unica: tanto o webhook da Meta quanto o simulador chamam
 * aqui. Toda regra de primeira mensagem, criar contato, aplicar os padroes da
 * conexao, detectar origem, ativar agente por palavra-chave, mora neste
 * arquivo, para nao existirem dois caminhos que divergem com o tempo.
 */

/** Guarda o @lid num contato que ainda nao tinha, para a costura futura. */
function costurarLid(contato, lid) {
  if (!lid || contato.lid === lid) return;
  atualizar('contatos', contato.id, { lid });
  contato.lid = lid;
}

export function acharOuCriarContato({
  workspaceId,
  conexao,
  telefone,
  nome = '',
  foto = null,
  doWhatsApp = false,
  lid = null,
  /* 'manual' quando alguem do escritorio digitou o nome (cadastro, CSV): ai
     ele vale mais do que a agenda do celular. Do WhatsApp, e nome de perfil. */
  nomeOrigem = null,
}) {
  /*
   * De onde veio o numero muda como ele se normaliza.
   *
   * Digitado por alguem do escritorio, ele vem sem o pais — "81 99999-8888" — e
   * o 55 precisa entrar. Vindo do WhatsApp, o pais SEMPRE ja esta la, e chutar
   * o 55 estraga todo numero estrangeiro: um suico de 11 digitos virava um
   * numero brasileiro que nao existe, e a resposta saia para o vazio sem erro
   * nenhum na tela.
   */
  const numero = doWhatsApp ? normalizarTelefoneDoWhatsApp(telefone) : normalizarTelefone(telefone);
  /* Mensagem @lid sem o telefone junto chega com o PROPRIO codigo no lugar do
     numero. Esse "numero" nao existe, e nao pode virar telefone de ninguem. */
  const soCodigo = Boolean(lid) && numero === String(lid).split('@')[0];
  let contato = soCodigo
    ? null
    : listar('contatos', { workspaceId }).find((c) => c.telefone === numero && c.conexaoId === conexao.id);
  if (contato) {
    costurarLid(contato, lid);
    return { contato, novo: false };
  }

  const daAgenda = nomeNaAgenda(conexao, { telefone: soCodigo ? '' : numero, lid });

  /*
   * A COSTURA: a conversa importada sem telefone reencontra o dono.
   *
   * O historico do WhatsApp chega enderecado por @lid, sem telefone, e a
   * importacao guarda essas conversas chaveadas pelo proprio @lid — legiveis,
   * mas anonimas. O telefone so aparece quando a pessoa escreve DE NOVO, e e
   * este o momento: em vez de abrir uma segunda conversa com a mesma pessoa,
   * a antiga recebe o telefone e o nome, e o historico inteiro passa a estar
   * embaixo do contato certo.
   *
   * Sem isto, cada pessoa que voltasse a falar apareceria duas vezes na fila:
   * uma com o historico e sem nome, outra com o nome e sem historico.
   */
  if (lid) {
    const antiga = listar('contatos', { workspaceId }).find((c) => c.lid === lid);
    if (antiga) {
      /* Ja identificada, ou mensagem de novo sem telefone: e a mesma pessoa,
         e nada ha para costurar. */
      if (antiga.telefone || soCodigo) return { contato: antiga, novo: false };

      /* O nome segue a mesma regra de sempre (ver nomes.js): o da agenda
         passa por cima do de perfil, e o perfil so preenche o que e numero. */
      const mudancas = { telefone: numero };
      if (daAgenda && antiga.nome !== daAgenda && podeTrocarNome(antiga, 'agenda')) {
        Object.assign(mudancas, { nome: daAgenda, nomeOrigem: 'agenda' });
      } else if (nome && podeTrocarNome(antiga, 'perfil')) {
        Object.assign(mudancas, { nome, nomeOrigem: 'perfil' });
      } else if (antiga.nome === SEM_IDENTIFICACAO) {
        mudancas.nome = numero;
      }
      atualizar('contatos', antiga.id, mudancas);
      Object.assign(antiga, mudancas);
      registrarLog(
        workspaceId,
        antiga.id,
        'identificacao',
        `Conversa importada sem telefone foi identificada: ${numero}`,
      );
      return { contato: antiga, novo: false };
    }
  }

  contato = inserir('contatos', {
    id: novoId('ctt'),
    workspaceId,
    conexaoId: conexao.id,
    telefone: numero,
    lid,
    ...(nome && nomeOrigem === 'manual'
      ? { nome, nomeOrigem: 'manual' }
      : { nome: daAgenda || nome || numero, nomeOrigem: daAgenda ? 'agenda' : nome ? 'perfil' : null }),
    foto,
    statusId: conexao.statusPadraoId || null,
    departamentoId: conexao.departamentoPadraoId || null,
    etiquetas: [],
    origemId: null,
    responsavel: conexao.responsavelPadrao ? { ...conexao.responsavelPadrao } : null,
    variaveis: {},
    estado: conexao.responsavelPadrao?.tipo === 'agente' ? 'ia' : 'pendente',
    naoLidas: 0,
    modoAudio: false,
    arquivos: [],
    mencoesRecentes: [],
    previa: '',
  });

  if (contato.responsavel?.tipo === 'agente') {
    const agente = achar('agentes', contato.responsavel.id);
    if (agente) contato.responsavel.nome = agente.nome;
  }

  registrarLog(workspaceId, contato.id, 'criacao', 'Conversa iniciada');

  /*
   * O status padrao da conexao tambem e uma mudanca de status, e precisa do
   * mesmo log que aplicarStatus grava. O dashboard le o funil desses
   * logs; sem ele a distribuicao (que le o status atual da conversa) mostrava a
   * conversa em Qualificado enquanto o cartao Qualificado da mesma tela ficava
   * em zero, e os dois blocos se contradiziam.
   */
  if (contato.statusId) {
    const status = achar('status', contato.statusId);
    if (status) {
      registrarLog(
        workspaceId,
        contato.id,
        'status',
        `Status: sem status -> ${status.nome}`,
        { tipo: 'sistema', nome: 'Conexao' },
        { statusId: status.id, tipo: status.tipo || 'nenhum', anteriorId: null },
      );
    }
  }

  return { contato, novo: true };
}

/**
 * Quem precisa saber que o cliente escreveu.
 *
 * Ate agora ninguem era avisado. Uma mensagem nova mexia o contador de nao
 * lidas da conversa e mais nada — quem nao estivesse com a tela de Conversas
 * aberta na aba certa nao ficava sabendo, e o sino, que existe desde sempre,
 * so tocava para mencao em nota interna e atribuicao manual. Num escritorio
 * onde o cliente escreve e espera resposta, esse era o aviso que mais faltava.
 *
 * Tres casos, tres respostas diferentes:
 *
 * - Conversa com agente: ninguem e avisado. A IA esta respondendo, e esse e o
 *   proposito dela. Avisar aqui faria o sino tocar o dia inteiro por conversa
 *   que ja tem quem responda.
 * - Conversa com dono: so o dono. E dele a resposta.
 * - Conversa sem dono: todos que podem atende-la. E o unico caso que justifica
 *   avisar mais de uma pessoa — a conversa esta na fila e nao e de ninguem,
 *   entao "alguem precisa ver" quer dizer todos que podem pegar.
 */
function avisarMensagemNova(workspaceId, contato, mensagem) {
  if (contato.responsavel?.tipo === 'agente') return;

  const previa = (mensagem.conteudo || `[${mensagem.tipo}]`).slice(0, 120);

  /*
   * Um aviso por conversa enquanto o anterior nao foi lido.
   *
   * Cliente que manda cinco mensagens seguidas — coisa comum, cada frase num
   * balao — geraria cinco linhas iguais no sino e um contador em 5 para uma
   * conversa so. O numero do sino deve dizer quantas conversas querem atencao,
   * nao quantas teclas o cliente apertou.
   */
  const jaAvisado = (membroId) =>
    listar('notificacoes', { workspaceId, membroId, contatoId: contato.id }).some(
      (n) => !n.lida && n.tipo === 'mensagem',
    );

  if (contato.responsavel?.tipo === 'membro') {
    if (!jaAvisado(contato.responsavel.id)) {
      notificar(workspaceId, contato.responsavel.id, 'mensagem', `${contato.nome} respondeu`, previa, contato.id);
    }
    return;
  }

  for (const membro of membrosQuePodemVer(workspaceId, contato)) {
    if (jaAvisado(membro.id)) continue;
    notificar(workspaceId, membro.id, 'mensagem', `Nova mensagem de ${contato.nome}`, previa, contato.id);
  }
}

function detectarOrigem(workspaceId, texto) {
  const alvo = normalizar(texto);
  if (!alvo) return null;
  for (const origem of listar('origens', { workspaceId })) {
    for (const palavra of origem.palavrasChave || []) {
      if (palavra && alvo.includes(normalizar(palavra))) return origem;
    }
  }
  return null;
}

/**
 * /restart, o mesmo atalho da auditoria. Limpa a conversa e devolve tudo ao
 * estado de lead novo, para testar o agente do comeco sem trocar de numero.
 */
function reiniciarConversa(contato, conexao) {
  cancelarResposta(contato.id);
  limparAgendamentosDoContato(contato.id);
  apagarMensagens(contato.id);

  const responsavel = conexao.responsavelPadrao ? { ...conexao.responsavelPadrao } : null;
  if (responsavel?.tipo === 'agente') {
    const agente = achar('agentes', responsavel.id);
    if (agente) responsavel.nome = agente.nome;
  }

  atualizar('contatos', contato.id, {
    statusId: conexao.statusPadraoId || null,
    departamentoId: conexao.departamentoPadraoId || null,
    etiquetas: [],
    variaveis: {},
    responsavel,
    estado: responsavel?.tipo === 'agente' ? 'ia' : 'pendente',
    naoLidas: 0,
    aceitoPor: null,
    modoAudio: false,
    previa: '',
    primeiraMensagemEm: null,
  });

  registrarLog(contato.workspaceId, contato.id, 'restart', 'Conversa reiniciada pelo comando /restart');
  emitir(contato.workspaceId, 'contato', { contatoId: contato.id });

  const atualizado = achar('contatos', contato.id);
  inserirMensagem(contato.id, {
    id: novoId('msg'),
    workspaceId: contato.workspaceId,
    direcao: 'interna',
    tipo: 'texto',
    conteudo: 'Conversa reiniciada. O agente vai atender como se fosse um lead novo.',
    autor: { tipo: 'sistema', nome: 'Sistema' },
    nota: true,
    situacao: 'enviada',
  });
  return atualizado;
}

/**
 * Processa uma mensagem que chegou. Devolve o contato e a mensagem gravada.
 */
export async function receberMensagem({
  workspaceId,
  conexao,
  telefone,
  nome = '',
  tipo = 'texto',
  conteudo = '',
  midia = null,
  idExterno = null,
  metadados = null,
  daPropriaConta = false,
  lid = null,
}) {
  const { contato, novo } = acharOuCriarContato({ workspaceId, conexao, telefone, nome, doWhatsApp: true, lid });

  /*
   * A pessoa respondeu pelo celular, e nao pela tela.
   *
   * Na sessao por QR Code o aparelho e o mesmo para os dois lados, entao tudo
   * o que sai do numero volta como evento. Ha dois casos dentro disso, e o
   * idExterno os separa: o sistema guarda esse id ao enviar (envio.js), logo
   * id JA CONHECIDO e o eco da propria mensagem — descartar e o certo, e era o
   * que a guarda antiga fazia com os dois casos de uma vez.
   *
   * Id novo e resposta digitada no celular. Ela precisa entrar, senao quem
   * abre a conversa no sistema ve a pergunta do cliente e nenhuma resposta, e
   * um atendimento que foi feito parece abandonado.
   */
  if (daPropriaConta) {
    const eco = acharEcoDoProprioEnvio(contato, idExterno, conteudo);
    if (eco) {
      /* Eco chegado antes de o envio registrar o id: aproveita para gravar o
         id, senao o recibo de entrega que vier depois nao acha a mensagem. */
      if (idExterno && !eco.idExterno) {
        eco.idExterno = idExterno;
        atualizarMensagem(contato.id, eco.id, { idExterno });
      }
      return { contato, mensagem: null, eco: true };
    }
    return registrarRespostaDoCelular({ workspaceId, conexao, contato, tipo, conteudo, midia, idExterno });
  }

  if (String(conteudo).trim().toLowerCase() === '/restart') {
    return { contato: reiniciarConversa(contato, conexao), mensagem: null, reiniciado: true };
  }

  const primeira = novo || !contato.primeiraMensagemEm;

  /*
   * O anexo chega como referencia, nunca como arquivo: um id, na Cloud API, ou
   * uma chave de mensagem cifrada, na sessao por QR Code. Nos dois casos a
   * referencia vence em minutos, entao o arquivo e buscado e guardado aqui na
   * hora em que ele chega. Quem sabe como buscar e o driver.
   */
  let anexo = midia;
  if (anexo && !anexo.url) {
    const baixado = await driverDa(conexao).baixarMidia?.({ conexao, midia: anexo });
    if (baixado) anexo = { ...anexo, ...baixado };
  }
  if (anexo) {
    /* O base64 e a chave sao andaimes do transporte: depois de o arquivo estar
       em disco eles nao dizem mais nada, e gravados na mensagem inchariam o
       JSON da conversa e o espelho do Supabase com o arquivo inteiro em texto,
       uma vez por anexo.

       Sem o arquivo (o download falhou), a chave FICA: e com ela que a tela
       pede o anexo de novo depois, pelo botao "Carregar". */
    const { base64, chave, ...guardavel } = anexo;
    anexo = guardavel.url ? guardavel : { ...guardavel, chave };
  }

  // Audio sem transcricao e uma conversa que o agente nao consegue ler.
  let transcricao = null;
  if (anexo?.tipo === 'audio' && anexo.url && transcricaoDisponivel(workspaceId)) {
    transcricao = await transcrever({ workspaceId, contatoId: contato.id, midia: anexo });
  }

  const mensagem = inserirMensagem(contato.id, {
    id: novoId('msg'),
    workspaceId,
    direcao: 'entrada',
    tipo,
    conteudo: transcricao || conteudo,
    transcricao,
    midia: anexo,
    idExterno,
    metadados,
    autor: { tipo: 'cliente', nome: contato.nome },
    situacao: 'recebida',
  });

  const mudancas = {
    ultimaMensagemEm: mensagem.criadoEm,
    ultimaEntradaEm: mensagem.criadoEm,
    naoLidas: (contato.naoLidas || 0) + 1,
    previa: (mensagem.conteudo || `[${tipo}]`).slice(0, 120),
  };

  /*
   * O nome do perfil do WhatsApp, quando a conversa ainda nao tem nome.
   *
   * Os dois drivers ja liam esse nome — profile.name na Cloud API da Meta,
   * pushName na sessao por QR Code — e ele so era usado na CRIACAO do contato.
   * Para quem ja existia, a linha `if (contato) return` de acharOuCriarContato
   * jogava fora. Na pratica: contato cadastrado a mao, ou criado numa
   * importacao sem a coluna de nome, ficava sendo um numero para sempre na
   * lista, por mais que a pessoa escrevesse todo dia.
   *
   * SO PREENCHE O QUE ESTA VAZIO. Contato sem nome nasce com o proprio numero
   * no lugar do nome, e essa igualdade e a marca de "nunca teve nome". Nome
   * que alguem escreveu nao e tocado: o cliente que se chama "Maria" no
   * WhatsApp pode ser "Maria Souza - BPC do filho" na ficha do escritorio, e
   * essa versao vale mais do que a do perfil dele.
   *
   * Pela mesma razao, trocar o nome no WhatsApp depois NAO renomeia a conversa
   * aqui. E a mesma regra que a importacao de CSV ja segue — primeiro que
   * escreve, fica. Se o escritorio preferir o contrario, o que muda e a
   * condicao desta linha.
   */
  /* A agenda do celular vem antes do perfil, pela mesma regra de nomes.js. */
  const nomeDaAgenda = nomeNaAgenda(conexao, { telefone: contato.telefone, lid: contato.lid });
  const nomeDoPerfil = String(nome || '').trim();
  if (nomeDaAgenda && nomeDaAgenda !== contato.nome && podeTrocarNome(contato, 'agenda')) {
    mudancas.nome = nomeDaAgenda;
    mudancas.nomeOrigem = 'agenda';
    registrarLog(workspaceId, contato.id, 'nome', `Nome trazido da agenda do celular: ${nomeDaAgenda}`, {
      tipo: 'sistema',
      nome: 'WhatsApp',
    });
  } else if (nomeDoPerfil && nomeDoPerfil !== contato.telefone && nomeEhProvisorio(contato)) {
    mudancas.nome = nomeDoPerfil;
    mudancas.nomeOrigem = 'perfil';
    registrarLog(
      workspaceId,
      contato.id,
      'nome',
      `Nome preenchido pelo perfil do WhatsApp: ${nomeDoPerfil}`,
      { tipo: 'sistema', nome: 'WhatsApp' },
    );
  }

  if (primeira) {
    mudancas.primeiraMensagemEm = mensagem.criadoEm;
    const origem = detectarOrigem(workspaceId, mensagem.conteudo);
    if (origem) mudancas.origemId = origem.id;
    if (metadados?.ctwaClid) {
      mudancas.anuncio = metadados;
    }
  }

  // Arquivada volta para a fila assim que o cliente escreve.
  if (contato.estado === 'arquivado') {
    mudancas.estado = contato.responsavel?.tipo === 'agente' ? 'ia' : 'pendente';
    registrarLog(workspaceId, contato.id, 'desarquivar', 'Conversa reaberta porque o cliente escreveu');
  }

  // Palavra-chave so ativa agente na abertura da conversa, nunca no meio dela.
  if (primeira && mensagem.conteudo) {
    const agente = agentePorPalavraChave(workspaceId, mensagem.conteudo);
    if (agente && (!contato.responsavel || contato.responsavel.tipo === 'agente')) {
      mudancas.responsavel = { tipo: 'agente', id: agente.id, nome: agente.nome };
      mudancas.estado = 'ia';
      registrarLog(workspaceId, contato.id, 'palavra_chave', `Agente ${agente.nome} ativado por palavra-chave`);
    }
  }

  atualizar('contatos', contato.id, mudancas);
  Object.assign(contato, mudancas);

  reagendarFollowups(contato);

  if (idExterno) marcarComoLida(conexao, idExterno, contato).catch(() => {});

  /* Depois de atualizar o contato, e nao antes: o aviso le o responsavel e o
     estado ja com o que esta mensagem mudou — uma conversa que acabou de
     reabrir precisa avisar como pendente, e nao como arquivada. */
  avisarMensagemNova(workspaceId, contato, mensagem);

  emitir(workspaceId, 'mensagem', { contatoId: contato.id, mensagem });
  emitir(workspaceId, 'contato', { contatoId: contato.id });

  if (contato.responsavel?.tipo === 'agente' && contato.estado === 'ia') {
    agendarResposta(contato);
  }

  /* A foto de perfil vem na fila, sem segurar a mensagem (ver fotos.js). */
  agendarFoto(contato);

  return { contato, mensagem, novo };
}

/**
 * Esta mensagem "nossa" e o eco de algo que o sistema acabou de enviar?
 *
 * O caminho seguro e o idExterno: o envio guarda esse id, entao id conhecido e
 * eco, sem duvida nenhuma.
 *
 * So que ha uma corrida. O servico entrega o webhook e responde ao envio pelo
 * MESMO instante, e nada garante a ordem: quando o eco chega primeiro, o id
 * ainda nao foi gravado, e so pelo id a propria resposta do agente entraria de
 * novo na conversa, agora como se tivesse sido digitada no celular. O cliente
 * veria a mesma frase duas vezes.
 *
 * Por isso a segunda rede: mensagem de saida com o MESMO texto nos ultimos
 * trinta segundos tambem e eco. A janela e curta de proposito — alguem que
 * repete a mesma frase para o mesmo cliente meio minuto depois e raro, e o
 * preco de errar para esse lado (uma repeticao nao registrada) e menor que o
 * de errar para o outro (a conversa mostrando tudo em dobro).
 */
const JANELA_DE_ECO_MS = 30 * 1000;

function acharEcoDoProprioEnvio(contato, idExterno, conteudo) {
  const minhas = mensagensDe(contato.id).filter((m) => m.direcao === 'saida');

  if (idExterno) {
    const porId = minhas.find((m) => m.idExterno === idExterno);
    if (porId) return porId;
  }

  const texto = String(conteudo || '').trim();
  if (!texto) return null;

  const limite = Date.now() - JANELA_DE_ECO_MS;
  return (
    minhas.find(
      (m) => String(m.conteudo || '').trim() === texto && new Date(m.criadoEm).getTime() >= limite,
    ) || null
  );
}

/**
 * Grava o que a equipe respondeu PELO CELULAR, em vez de pela tela.
 *
 * Existe porque a sessao por QR Code compartilha o aparelho: o advogado abre o
 * WhatsApp no proprio telefone e responde o cliente dali, e ate aqui isso nao
 * chegava ao sistema. A conversa na tela ficava com a pergunta do cliente e
 * silencio depois — e quem olhasse a fila via um atendimento abandonado que na
 * verdade tinha sido feito.
 *
 * Nao passa pelo caminho da mensagem de entrada, e nao e economia de codigo: a
 * mensagem que NOS enviamos inverte quase tudo o que aquele caminho faz.
 *
 *   nao conta como nao lida  — nao ha o que ler, fomos nos que escrevemos
 *   nao mexe em ultimaEntradaEm — o cliente nao falou; o relogio de "esperando
 *                                 resposta" nao pode reiniciar
 *   nao detecta origem       — origem se descobre no que o CLIENTE escreve
 *   nao ativa agente por palavra-chave — senao uma palavra nossa ligaria um
 *                                        agente no meio do atendimento
 *   CANCELA a resposta do agente — e o ponto mais importante: um humano acabou
 *                                  de responder, e deixar o agente responder
 *                                  atras seria o cliente recebendo duas
 *                                  respostas diferentes para a mesma pergunta
 */
async function registrarRespostaDoCelular({ workspaceId, conexao, contato, tipo, conteudo, midia, idExterno }) {
  let anexo = midia;
  if (anexo && !anexo.url) {
    const baixado = await driverDa(conexao).baixarMidia?.({ conexao, midia: anexo });
    if (baixado) anexo = { ...anexo, ...baixado };
  }
  if (anexo) {
    const { base64, chave, ...guardavel } = anexo;
    anexo = guardavel.url ? guardavel : { ...guardavel, chave };
  }

  const mensagem = inserirMensagem(contato.id, {
    id: novoId('msg'),
    workspaceId,
    direcao: 'saida',
    tipo,
    conteudo,
    midia: anexo,
    idExterno,
    /*
     * "Pelo celular" e nao o nome de quem escreveu: a sessao entrega a
     * mensagem sem dizer QUEM do escritorio a digitou — do lado do WhatsApp e
     * tudo o mesmo numero. Inventar um nome aqui poria a resposta na conta de
     * alguem que talvez nao a tenha escrito.
     */
    autor: { tipo: 'membro', nome: 'Pelo celular' },
    situacao: 'enviada',
    enviadaEm: agora(),
  });

  /*
   * A conversa volta para a fila quando o proprio escritorio escreve numa
   * arquivada: se alguem retomou o assunto pelo celular, ela nao esta mais
   * encerrada. Vai para pendente, e nao para a IA — quem respondeu foi gente.
   */
  const mudancas = {
    ultimaMensagemEm: mensagem.criadoEm,
    naoLidas: 0,
    previa: (mensagem.conteudo || `[${tipo}]`).slice(0, 120),
  };
  if (contato.estado === 'arquivado') {
    mudancas.estado = 'pendente';
    registrarLog(workspaceId, contato.id, 'desarquivar', 'Conversa reaberta: o escritorio respondeu pelo celular');
  }
  if (!contato.primeiraMensagemEm) mudancas.primeiraMensagemEm = mensagem.criadoEm;

  atualizar('contatos', contato.id, mudancas);
  Object.assign(contato, mudancas);

  cancelarResposta(contato.id);
  reagendarFollowups(contato);

  emitir(workspaceId, 'mensagem', { contatoId: contato.id, mensagem });
  emitir(workspaceId, 'contato', { contatoId: contato.id });

  return { contato, mensagem, doCelular: true };
}

/** Atualiza o estado de entrega vindo da Meta (enviada, entregue, lida, erro). */
export function atualizarSituacaoExterna(workspaceId, idExterno, situacao, erro = null) {
  for (const contato of listar('contatos', { workspaceId })) {
    const mensagem = mensagensDe(contato.id).find((m) => m.idExterno === idExterno);
    if (!mensagem) continue;
    atualizarMensagem(contato.id, mensagem.id, { situacao, erro, atualizadaEm: agora() });
    emitir(workspaceId, 'mensagem-situacao', { contatoId: contato.id, mensagemId: mensagem.id, situacao });
    return true;
  }
  return false;
}

export { agendarFollowupsDoStatus, cancelarFollowups };
