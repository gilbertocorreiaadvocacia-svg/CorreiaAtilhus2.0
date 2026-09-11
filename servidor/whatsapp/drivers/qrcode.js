import fs from 'node:fs';
import { caminhoDaMidia, guardarBuffer } from '../../nucleo/midia.js';

/**
 * Driver de sessao por QR Code.
 *
 * Conversa por HTTP com um servico local que segura a sessao do WhatsApp, hoje
 * a Evolution API. O CorreiaAtilhus2.0 NAO carrega a biblioteca de WhatsApp
 * dentro dele de proposito: Baileys traz umas trezentas dependencias e um
 * modulo nativo, e o sistema inteiro existe para abrir com dois cliques, sem
 * `npm install` e sem executavel novo para o Windows barrar. Falando HTTP, o
 * projeto continua com zero dependencias e o servico pesado atualiza sozinho,
 * do lado de fora.
 *
 * O QUE ESTE CAMINHO DA que o oficial nao da: QR Code em vez de aprovacao da
 * Meta, grupo, audio gravado, e mensagem a qualquer hora sem template.
 *
 * O QUE ELE CUSTA, dito sem rodeio: e conexao NAO OFICIAL. Viola os termos da
 * Meta, e o numero pode ser banido, com ou sem aviso. Por isso a doutrina dos
 * dois numeros deixa de ser conselho e vira regra aqui: o numero de pos-venda,
 * que fala com quem ja assinou contrato, nao deveria estar neste driver.
 *
 * A configuracao mora em `conexao.qrcode`:
 *   servidor   http://localhost:8080     endereco da Evolution API
 *   chave      a apikey global do servico
 *   instancia  o nome da instancia la dentro (uma por numero)
 */

/*
 * CONTACTS_UPSERT e o unico lugar onde chega o nome SALVO na agenda do
 * celular: a tabela de contatos da Evolution troca esse nome pelo de perfil a
 * cada mensagem. Sem assinar, toda conversa fica com o nome que a pessoa se da
 * no perfil, e nao com o que o escritorio conhece. Ver whatsapp/agenda.js.
 */
export const EVENTOS_ASSINADOS = [
  'MESSAGES_UPSERT',
  'MESSAGES_UPDATE',
  'CONNECTION_UPDATE',
  'QRCODE_UPDATED',
  'CONTACTS_UPSERT',
  'CONTACTS_UPDATE',
];

function configuracao(conexao) {
  const cfg = conexao?.qrcode || {};
  return {
    servidor: String(cfg.servidor || '').replace(/\/+$/, ''),
    chave: cfg.chave || '',
    instancia: cfg.instancia || conexao?.id || '',
  };
}

function faltaConfigurar(cfg) {
  if (!cfg.servidor) return 'Endereco do servico de WhatsApp nao configurado.';
  if (!cfg.chave) return 'Chave de API do servico de WhatsApp nao configurada.';
  if (!cfg.instancia) return 'Nome da instancia nao configurado.';
  return null;
}

/**
 * Uma chamada ao servico.
 *
 * O tempo limite e explicito porque o servico roda na mesma maquina e, quando
 * ele trava, `fetch` fica pendurado sem prazo: uma conversa inteira ficava
 * esperando o envio de uma mensagem que nunca ia voltar.
 */
async function chamar(cfg, caminho, { metodo = 'GET', corpo = null, prazoMs = 20000 } = {}) {
  const controlador = new AbortController();
  const prazo = setTimeout(() => controlador.abort(), prazoMs);
  try {
    const resposta = await fetch(`${cfg.servidor}${caminho}`, {
      method: metodo,
      headers: {
        apikey: cfg.chave,
        ...(corpo ? { 'Content-Type': 'application/json' } : {}),
      },
      body: corpo ? JSON.stringify(corpo) : undefined,
      signal: controlador.signal,
    });

    const texto = await resposta.text();
    let dados;
    try {
      dados = texto ? JSON.parse(texto) : {};
    } catch {
      dados = { mensagem: texto.slice(0, 300) };
    }

    if (!resposta.ok) {
      const detalhe =
        dados?.response?.message?.[0] || dados?.message || dados?.error || dados?.mensagem || `HTTP ${resposta.status}`;
      throw Object.assign(new Error(String(detalhe)), { codigoWhatsapp: String(resposta.status) });
    }
    return dados;
  } catch (erro) {
    if (erro.name === 'AbortError') {
      throw Object.assign(new Error('O servico de WhatsApp nao respondeu a tempo. Ele esta rodando?'), {
        codigoWhatsapp: 'timeout',
      });
    }
    throw erro;
  } finally {
    clearTimeout(prazo);
  }
}

/** `open` la dentro e `conectado` aqui. O resto do sistema so conhece dois. */
function traduzirEstado(bruto) {
  return String(bruto || '').toLowerCase() === 'open' ? 'conectado' : 'desconectado';
}

/** O arquivo guardado aqui vai em base64: o servico nao alcanca o localhost. */
function lerMidiaEmBase64(midia) {
  const caminho = caminhoDaMidia(midia?.url);
  if (!caminho) return null;
  try {
    return fs.readFileSync(caminho).toString('base64');
  } catch {
    return null;
  }
}

export const driverQrCode = {
  id: 'qrcode',
  nome: 'QR Code (nao oficial)',
  descricao: 'Le o QR Code pelo aplicativo. Entra em grupo e nao depende de template. Nao e oficial.',
  precisaCredenciais: true,

  async enviar({ conexao, contato, tipo, conteudo, midia }) {
    const cfg = configuracao(conexao);
    const falta = faltaConfigurar(cfg);
    if (falta) throw Object.assign(new Error(falta), { codigoWhatsapp: 'config' });

    const numero = contato.telefone;

    /* Audio vai por uma porta propria: mandado como documento, chega no celular
       do cliente como um arquivo para baixar, e nao como a bolinha de audio que
       ele sabe ouvir. */
    if (tipo === 'audio' && midia) {
      const base64 = lerMidiaEmBase64(midia);
      const resposta = await chamar(cfg, `/message/sendWhatsAppAudio/${cfg.instancia}`, {
        metodo: 'POST',
        corpo: { number: numero, audio: base64 || midia.url },
      });
      return { idExterno: resposta?.key?.id || null };
    }

    if (midia && tipo !== 'texto') {
      const base64 = lerMidiaEmBase64(midia);
      const tipos = { imagem: 'image', video: 'video', documento: 'document' };
      const resposta = await chamar(cfg, `/message/sendMedia/${cfg.instancia}`, {
        metodo: 'POST',
        corpo: {
          number: numero,
          mediatype: tipos[tipo] || 'document',
          mimetype: midia.mime || 'application/octet-stream',
          caption: conteudo || undefined,
          fileName: midia.nome || undefined,
          media: base64 || midia.url,
        },
        /* Midia em base64 num arquivo de 16 MB e um corpo grande: o servico
           precisa de mais folga do que uma mensagem de texto. */
        prazoMs: 60000,
      });
      return { idExterno: resposta?.key?.id || null };
    }

    const resposta = await chamar(cfg, `/message/sendText/${cfg.instancia}`, {
      metodo: 'POST',
      corpo: { number: numero, text: conteudo || '' },
    });
    return { idExterno: resposta?.key?.id || null };
  },

  async testar({ conexao }) {
    const cfg = configuracao(conexao);
    const falta = faltaConfigurar(cfg);
    if (falta) return { ok: false, erro: falta };

    try {
      const dados = await chamar(cfg, `/instance/connectionState/${cfg.instancia}`);
      const estado = traduzirEstado(dados?.instance?.state);
      return {
        ok: estado === 'conectado',
        estado,
        erro:
          estado === 'conectado'
            ? null
            : 'O servico respondeu, mas a sessao nao esta aberta. Leia o QR Code em Acoes > Conectar.',
      };
    } catch (erro) {
      return { ok: false, erro: erro.message };
    }
  },

  async marcarLida({ conexao, idExterno, contato }) {
    const cfg = configuracao(conexao);
    if (faltaConfigurar(cfg) || !idExterno) return;
    try {
      await chamar(cfg, `/chat/markMessageAsRead/${cfg.instancia}`, {
        metodo: 'POST',
        corpo: {
          readMessages: [
            { remoteJid: `${contato?.telefone}@s.whatsapp.net`, fromMe: false, id: idExterno },
          ],
        },
        prazoMs: 8000,
      });
    } catch {
      /* Marcar como lida nunca pode derrubar o atendimento. */
    }
  },

  /**
   * Abre a sessao e devolve o QR Code para a tela desenhar.
   *
   * Cria a instancia se ela ainda nao existe. E idempotente de proposito: a
   * pessoa clica em Conectar, o celular demora, ela clica de novo, e o segundo
   * clique nao pode derrubar a sessao que o primeiro comecou.
   *
   * `urlWebhook` e o endereco que o servico vai chamar a cada mensagem. Ele
   * chega de fora porque so a rota sabe em que endereco este sistema atende.
   */
  async conectar({ conexao, urlWebhook }) {
    const cfg = configuracao(conexao);
    const falta = faltaConfigurar(cfg);
    if (falta) return { erro: falta };

    try {
      const estadoAtual = await chamar(cfg, `/instance/connectionState/${cfg.instancia}`).catch(() => null);

      if (traduzirEstado(estadoAtual?.instance?.state) === 'conectado') {
        return { estado: 'conectado', qrCode: null };
      }

      const webhook = { url: urlWebhook, byEvents: false, base64: true, events: EVENTOS_ASSINADOS };

      if (!estadoAtual) {
        /* Instancia inexistente: cria com o webhook ja apontado para ca. Sem
           isso, a sessao abre e as mensagens do cliente nao chegam a lugar
           nenhum, que e o defeito mais dificil de diagnosticar deste caminho.

           syncFullHistory pede ao celular o historico INTEIRO, e nao so os
           ultimos meses. Tem de ir aqui, na criacao: o historico e mandado uma
           vez, na hora em que o QR Code e lido, e pedir depois nao traz nada. */
        await chamar(cfg, '/instance/create', {
          metodo: 'POST',
          corpo: {
            instanceName: cfg.instancia,
            integration: 'WHATSAPP-BAILEYS',
            qrcode: true,
            syncFullHistory: true,
            webhook,
          },
          prazoMs: 40000,
        });
      } else {
        /* Instancia que ja existia foi criada com a lista de eventos da epoca,
           talvez sem os de contato. Reapontar antes de ler o QR garante que o
           nome salvo chegue. Se falhar, a conexao segue: sem nome da agenda
           ela ainda funciona, e o nome de perfil entra no lugar. */
        await chamar(cfg, `/webhook/set/${cfg.instancia}`, {
          metodo: 'POST',
          corpo: { webhook: { enabled: true, ...webhook } },
        }).catch(() => null);

        /* E o pedido de historico completo. Instancia criada antes de o
           sistema pedir isso traria so os ultimos meses. A Evolution exige as
           seis configuracoes juntas no /settings/set, entao le as atuais e
           devolve iguais, trocando so esta — e nao mexe se ja estiver ligada.
           Vale para a proxima leitura do QR: o celular manda o historico uma
           vez, na hora do pareamento. */
        const atuais = await chamar(cfg, `/settings/find/${cfg.instancia}`).catch(() => null);
        if (atuais && atuais.syncFullHistory !== true) {
          await chamar(cfg, `/settings/set/${cfg.instancia}`, {
            metodo: 'POST',
            corpo: {
              rejectCall: Boolean(atuais.rejectCall),
              msgCall: atuais.msgCall || '',
              groupsIgnore: Boolean(atuais.groupsIgnore),
              alwaysOnline: Boolean(atuais.alwaysOnline),
              readMessages: Boolean(atuais.readMessages),
              readStatus: Boolean(atuais.readStatus),
              syncFullHistory: true,
            },
          }).catch(() => null);
        }
      }

      const dados = await chamar(cfg, `/instance/connect/${cfg.instancia}`, { prazoMs: 40000 });
      return {
        estado: 'conectando',
        /* O servico devolve o QR ora como data URI, ora como o texto cru do
           codigo. A tela sabe desenhar os dois, entao os dois sobem. */
        qrCode: dados?.base64 || dados?.qrcode?.base64 || null,
        codigo: dados?.code || dados?.qrcode?.code || null,
        codigoPareamento: dados?.pairingCode || null,
      };
    } catch (erro) {
      return { erro: erro.message };
    }
  },

  /** Encerra a sessao no celular. A instancia continua existindo, para
   *  reconectar depois sem refazer a configuracao. */
  async desconectar({ conexao }) {
    const cfg = configuracao(conexao);
    const falta = faltaConfigurar(cfg);
    if (falta) return { erro: falta };
    try {
      await chamar(cfg, `/instance/logout/${cfg.instancia}`, { metodo: 'DELETE' });
      return { ok: true };
    } catch (erro) {
      return { erro: erro.message };
    }
  },

  /**
   * Baixa o anexo que chegou.
   *
   * Com `base64: true` no webhook, o proprio evento ja traz o arquivo e nao ha
   * segunda chamada. Quando nao vier, pede ao servico: a midia do WhatsApp e
   * cifrada, e so quem tem a sessao consegue decifrar.
   */
  async baixarMidia({ conexao, midia }) {
    let base64 = midia?.base64 || null;
    let mime = midia?.mime || 'application/octet-stream';
    let nome = midia?.nome || null;

    if (!base64) {
      const cfg = configuracao(conexao);
      if (faltaConfigurar(cfg) || !midia?.chave) return null;
      try {
        const dados = await chamar(cfg, `/chat/getBase64FromMediaMessage/${cfg.instancia}`, {
          metodo: 'POST',
          corpo: { message: { key: midia.chave }, convertToMp4: false },
          prazoMs: 40000,
        });
        if (!dados?.base64) return null;
        base64 = dados.base64;
        mime = dados.mimetype || mime;
        nome = dados.fileName || nome;
      } catch {
        return null;
      }
    }

    try {
      return guardarBuffer({
        nome: nome || `whatsapp-${Date.now()}`,
        dados: Buffer.from(base64, 'base64'),
        mime,
      });
    } catch {
      return null;
    }
  },

  /**
   * O endereco da foto de perfil de alguem, ou null.
   *
   * Null e resposta normal, e nao erro: muita gente esconde a foto de quem nao
   * esta na agenda dela. O endereco devolvido e do WhatsApp e vence em poucos
   * dias — quem chama baixa o arquivo na hora (ver whatsapp/fotos.js).
   *
   * `numero` e o telefone, ou o proprio codigo @lid quando a conversa ainda nao
   * tem telefone: a Evolution aceita o endereco completo no lugar do numero.
   */
  async buscarFoto({ conexao, numero }) {
    const cfg = configuracao(conexao);
    if (faltaConfigurar(cfg) || !numero) return null;
    const dados = await chamar(cfg, `/chat/fetchProfilePictureUrl/${cfg.instancia}`, {
      metodo: 'POST',
      corpo: { number: numero },
      prazoMs: 20000,
    });
    const url = dados?.profilePictureUrl || null;
    return typeof url === 'string' && /^https?:\/\//.test(url) ? url : null;
  },

  /**
   * A Evolution nao assina o corpo do evento como a Meta faz. O que da para
   * conferir e a chave: ela vem no cabecalho `apikey` quando o servico esta
   * configurado para mandar. Sem ela, o unico segredo e a propria URL, que
   * carrega o id da conexao.
   */
  conferirAssinatura({ conexao, cabecalhos }) {
    const cfg = configuracao(conexao);
    const enviada = cabecalhos.apikey || cabecalhos['x-api-key'];
    if (!enviada) return true;
    return String(enviada) === String(cfg.chave);
  },

  interpretarWebhook({ corpo }) {
    const saida = { mensagens: [], situacoes: [], conexao: null, templates: [], agenda: [] };
    const evento = String(corpo?.event || '').toLowerCase().replace(/_/g, '.');
    const dados = corpo?.data || {};

    /*
     * A agenda do celular. A Evolution manda { remoteJid, pushName }, e nesse
     * evento o pushName e o nome SALVO (contact.name do WhatsApp); sem nome
     * salvo, ela poe o proprio numero no lugar — isso nao e nome, e cai fora em
     * guardarNaAgenda. Grupo e lista de transmissao nao sao pessoas.
     */
    if (evento === 'contacts.upsert' || evento === 'contacts.update') {
      for (const item of [].concat(dados)) {
        const jid = String(item?.remoteJid || item?.id || '');
        if (!jid.endsWith('@s.whatsapp.net') && !jid.endsWith('@lid')) continue;
        saida.agenda.push({ jid, nome: item?.pushName || item?.name || '' });
      }
      return saida;
    }

    if (evento === 'qrcode.updated') {
      saida.conexao = {
        estado: 'desconectado',
        qrCode: dados?.qrcode?.base64 || dados?.base64 || null,
        evento: 'QR Code atualizado, esperando a leitura pelo celular.',
      };
      return saida;
    }

    if (evento === 'connection.update') {
      const estado = traduzirEstado(dados?.state);
      saida.conexao = {
        estado,
        numero: (dados?.wuid || '').split('@')[0] || null,
        /* Sessao aberta e um QR que nao serve mais para nada: deixar o antigo
           na tela faz alguem tentar ler um codigo ja vencido. */
        qrCode: estado === 'conectado' ? null : undefined,
        evento:
          estado === 'conectado'
            ? 'Sessao aberta: o celular leu o QR Code.'
            : `Sessao fechada (${dados?.statusReason || dados?.state || 'sem motivo informado'}).`,
      };
      return saida;
    }

    if (evento === 'messages.update') {
      for (const item of [].concat(dados)) {
        const mapa = { PENDING: 'enviando', SERVER_ACK: 'enviada', DELIVERY_ACK: 'entregue', READ: 'lida', PLAYED: 'lida' };
        const situacao = mapa[String(item?.status || '').toUpperCase()];
        if (situacao && item?.keyId) saida.situacoes.push({ idExterno: item.keyId, situacao, erro: null });
      }
      return saida;
    }

    if (evento === 'messages.upsert') {
      for (const item of [].concat(dados)) {
        /*
         * MENSAGEM COM fromMe: DUAS COISAS BEM DIFERENTES.
         *
         * A sessao por QR Code e o mesmo aparelho para os dois lados, entao o
         * evento marcado como "minha" cobre dois casos que nao podem ser
         * tratados igual:
         *
         *   1. o que o SISTEMA acabou de enviar, que volta ecoando. Este ja
         *      esta gravado, e regrava-lo faria o agente responder a si mesmo
         *      em laco — era o motivo da guarda que existia aqui.
         *   2. o que a PESSOA digitou no celular, respondendo o cliente pelo
         *      WhatsApp em vez de pela tela. Este NAO estava em lugar nenhum:
         *      quem abrisse a conversa no sistema via a pergunta do cliente e
         *      nenhuma resposta, e o atendimento parecia abandonado.
         *
         * Os dois sao separados pelo idExterno, la no funil de recebimento: o
         * sistema guarda esse id ao enviar, entao id conhecido e eco, e id novo
         * veio do celular. Aqui o driver so marca de onde veio.
         */
        const daPropriaConta = Boolean(item?.key?.fromMe);

        const jid = item?.key?.remoteJid || '';
        /* Grupo vem como @g.us. O sistema ainda nao gerencia grupo, e tratar
           o grupo como se fosse uma pessoa criaria uma conversa por grupo com
           o numero errado no cadastro. */
        if (jid.endsWith('@g.us')) continue;

        const extraido = extrairMensagem(item);
        if (!extraido) continue;

        /*
         * O endereco novo do WhatsApp, @lid, nao tem telefone dentro. Quando a
         * mensagem e recente, ela traz o telefone em remoteJidAlt — e e so
         * ai que da para ligar a conversa a uma pessoa. Historico
         * sincronizado nao traz.
         */
        const alt = String(item?.key?.remoteJidAlt || '');
        const temTelefone = alt.endsWith('@s.whatsapp.net');

        saida.mensagens.push({
          telefone: temTelefone ? alt.split('@')[0] : jid.split('@')[0],
          lid: jid.endsWith('@lid') ? jid : null,
          /* pushName e o nome de quem ESCREVEU. Numa mensagem nossa ele e o
             nome do proprio escritorio, e gravar isso renomearia o cliente. */
          nome: daPropriaConta ? '' : item?.pushName || '',
          idExterno: item?.key?.id || null,
          daPropriaConta,
          ...extraido,
          metadados: null,
        });
      }
    }

    return saida;
  },
};

/**
 * Traduz a mensagem da Evolution para o formato interno.
 *
 * `chave` viaja junto no anexo porque e ela que `baixarMidia` usa para pedir o
 * arquivo decifrado quando o evento nao trouxe o base64.
 */
/*
 * Exportado para a importacao de historico reusar ESTE tradutor.
 *
 * Escrever um segundo mapeamento la seria criar duas verdades sobre o mesmo
 * formato: no dia em que a Evolution mudar o nome de um campo, uma metade do
 * sistema aprende e a outra nao, e a divergencia aparece meses depois como
 * mensagem em branco no historico.
 */
export function extrairMensagem(item) {
  const m = item?.message || {};
  const chave = item?.key || null;

  if (m.conversation) return { tipo: 'texto', conteudo: m.conversation, midia: null };
  if (m.extendedTextMessage?.text) return { tipo: 'texto', conteudo: m.extendedTextMessage.text, midia: null };

  const anexos = [
    ['imageMessage', 'imagem'],
    ['videoMessage', 'video'],
    ['audioMessage', 'audio'],
    ['documentMessage', 'documento'],
    ['stickerMessage', 'imagem'],
  ];

  for (const [campo, tipo] of anexos) {
    const anexo = m[campo];
    if (!anexo) continue;
    return {
      tipo,
      conteudo: anexo.caption || '',
      midia: {
        tipo,
        chave,
        mime: anexo.mimetype || null,
        nome: anexo.fileName || null,
        base64: item?.message?.base64 || item?.base64 || null,
      },
    };
  }

  if (m.locationMessage) {
    return {
      tipo: 'texto',
      conteudo: `Localizacao: ${m.locationMessage.degreesLatitude}, ${m.locationMessage.degreesLongitude}`,
      midia: null,
    };
  }

  /* Tipo que ainda nao sabemos ler vira uma linha na conversa em vez de sumir:
     o atendente ve que o cliente mandou alguma coisa e pode pedir de novo. */
  const nome = Object.keys(m).find((k) => k !== 'base64');
  return nome ? { tipo: 'texto', conteudo: `[mensagem do tipo ${nome} recebida]`, midia: null } : null;
}
