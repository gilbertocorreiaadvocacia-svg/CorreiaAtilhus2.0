import fs from 'node:fs';
import { achar, atualizar, inserirMensagem, registrarLog } from '../nucleo/banco.js';
import { emitir } from '../nucleo/eventos.js';
import { caminhoDaMidia } from '../nucleo/midia.js';
import { agora, novoId } from '../nucleo/util.js';

/**
 * Camada de saida. Duas conexoes possiveis:
 *
 *  - simulador: nada sai do computador. A mensagem e gravada e aparece na tela
 *    como enviada. Serve para testar agente, follow-up e funil inteiro sem chip.
 *  - oficial: Cloud API da Meta. Respeita a janela de 24 horas, fora dela so
 *    passa template aprovado, exatamente como a plataforma exige.
 */

const GRAPH = 'https://graph.facebook.com/v21.0';

export function janelaAberta(contato) {
  if (!contato?.ultimaEntradaEm) return false;
  return Date.now() - new Date(contato.ultimaEntradaEm).getTime() < 1000 * 60 * 60 * 24;
}

async function enviarPelaCloudApi(conexao, telefone, carga) {
  const { phoneNumberId, token } = conexao.oficial || {};
  if (!phoneNumberId || !token) {
    throw Object.assign(new Error('Conexao oficial sem phoneNumberId ou token configurado'), {
      codigoWhatsapp: '010101',
    });
  }
  const resposta = await fetch(`${GRAPH}/${phoneNumberId}/messages`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ messaging_product: 'whatsapp', to: telefone, ...carga }),
  });
  const corpo = await resposta.json().catch(() => ({}));
  if (!resposta.ok) {
    const erro = corpo?.error || {};
    throw Object.assign(new Error(erro.message || `Graph API ${resposta.status}`), {
      codigoWhatsapp: String(erro.code || resposta.status),
      detalhe: erro,
    });
  }
  return corpo?.messages?.[0]?.id || null;
}

/**
 * Sobe um arquivo nosso para a Meta e devolve o id. Arquivo guardado aqui tem
 * URL local, a Meta nao alcanca localhost, entao o caminho e enviar o binario
 * e mandar a mensagem referenciando o id.
 */
async function subirMidiaParaMeta(conexao, midia) {
  const caminho = caminhoDaMidia(midia.url);
  if (!caminho) return null;

  const { phoneNumberId, token } = conexao.oficial || {};
  const dados = fs.readFileSync(caminho);
  const formulario = new FormData();
  formulario.append('messaging_product', 'whatsapp');
  formulario.append('type', midia.mime || 'application/octet-stream');
  formulario.append('file', new Blob([dados], { type: midia.mime || 'application/octet-stream' }), midia.nome || 'arquivo');

  const resposta = await fetch(`${GRAPH}/${phoneNumberId}/media`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}` },
    body: formulario,
  });
  const corpo = await resposta.json().catch(() => ({}));
  if (!resposta.ok) {
    throw Object.assign(new Error(corpo?.error?.message || 'Falha ao subir a midia para a Meta'), {
      codigoWhatsapp: String(corpo?.error?.code || '131053'),
    });
  }
  return corpo.id || null;
}

async function cargaDaMensagem({ tipo, conteudo, midia, conexao }) {
  if (tipo === 'texto' || !tipo) {
    return { type: 'text', text: { preview_url: true, body: conteudo || '' } };
  }
  const mapa = { imagem: 'image', video: 'video', audio: 'audio', documento: 'document' };
  const chave = mapa[tipo] || 'document';

  const objeto = {};
  const local = midia?.url && String(midia.url).startsWith('/midia/');
  if (local && conexao?.tipo === 'oficial') {
    const id = await subirMidiaParaMeta(conexao, midia);
    if (id) objeto.id = id;
    else objeto.link = midia.url;
  } else {
    objeto.link = midia?.url;
  }

  if (conteudo && chave !== 'audio') objeto.caption = conteudo;
  if (chave === 'document' && midia?.nome) objeto.filename = midia.nome;
  return { type: chave, [chave]: objeto };
}

/**
 * Grava a mensagem, tenta entregar e devolve o registro com o resultado.
 * A gravacao vem antes do envio de proposito: se a Meta recusar, a mensagem
 * continua na tela com o erro visivel em vez de sumir sem explicacao.
 */
export async function enviarMensagem({
  contato,
  conexao,
  tipo = 'texto',
  conteudo = '',
  midia = null,
  autor,
  templateId = null,
  responderA = null,
  origemAutomacao = null,
}) {
  const mensagem = inserirMensagem(contato.id, {
    id: novoId('msg'),
    workspaceId: contato.workspaceId,
    direcao: 'saida',
    tipo,
    conteudo,
    midia,
    autor,
    templateId,
    responderA,
    origemAutomacao,
    situacao: 'enviando',
  });

  try {
    if (!conexao) throw new Error('A conversa nao tem conexao de WhatsApp associada');

    if (conexao.tipo === 'oficial') {
      if (!janelaAberta(contato) && !templateId) {
        throw Object.assign(
          new Error(
            'Janela de 24 horas fechada. Fora dela a Meta so aceita template aprovado (erro 131047).',
          ),
          { codigoWhatsapp: '131047' },
        );
      }
      const template = templateId ? achar('templates', templateId) : null;
      const carga =
        template && template.aprovacaoMeta?.situacao === 'aprovado'
          ? {
              type: 'template',
              template: {
                name: template.metaNome || template.atalho,
                language: { code: 'pt_BR' },
              },
            }
          : await cargaDaMensagem({ tipo, conteudo, midia, conexao });
      const idExterno = await enviarPelaCloudApi(conexao, contato.telefone, carga);
      Object.assign(mensagem, { situacao: 'enviada', idExterno, enviadaEm: agora() });
    } else {
      Object.assign(mensagem, { situacao: 'enviada', enviadaEm: agora() });
    }
  } catch (erro) {
    Object.assign(mensagem, {
      situacao: 'erro',
      erro: { mensagem: erro.message, codigo: erro.codigoWhatsapp || null },
    });
    registrarLog(
      contato.workspaceId,
      contato.id,
      'erro_envio',
      `Falha ao enviar: ${erro.message}${erro.codigoWhatsapp ? ` (codigo ${erro.codigoWhatsapp})` : ''}`,
    );
  }

  atualizar('contatos', contato.id, {
    ultimaMensagemEm: mensagem.criadoEm,
    ultimaSaidaEm: mensagem.criadoEm,
    previa: (conteudo || `[${tipo}]`).slice(0, 120),
  });

  emitir(contato.workspaceId, 'mensagem', { contatoId: contato.id, mensagem });
  return mensagem;
}

/** Marca como lida no WhatsApp, no simulador e apenas local. */
export async function marcarComoLida(conexao, idExterno) {
  if (!conexao || conexao.tipo !== 'oficial' || !idExterno) return;
  const { phoneNumberId, token } = conexao.oficial || {};
  if (!phoneNumberId || !token) return;
  try {
    await fetch(`${GRAPH}/${phoneNumberId}/messages`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ messaging_product: 'whatsapp', status: 'read', message_id: idExterno }),
    });
  } catch {
    /* marcar como lida nao pode derrubar o atendimento */
  }
}
