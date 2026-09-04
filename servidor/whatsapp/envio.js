import { atualizar, inserirMensagem, registrarLog } from '../nucleo/banco.js';
import { emitir } from '../nucleo/eventos.js';
import { achar } from '../nucleo/banco.js';
import { agora, novoId } from '../nucleo/util.js';
import { driverDa } from './drivers/index.js';
import { janelaAberta as janelaOficial } from './drivers/oficial.js';

/**
 * Camada de saida, unica para o sistema inteiro.
 *
 * O motor de IA, o follow-up, a mencao, a integracao e a API publica mandam
 * mensagem por aqui, e nenhum deles sabe de que tipo e a conexao. Quem sabe
 * disso e o driver, em `drivers/`: simulador, API oficial da Meta ou sessao por
 * QR Code. Ligar um numero novo por um caminho diferente nao toca em nada
 * acima desta linha.
 *
 * A ordem das operacoes e proposital e vale para os tres caminhos: a mensagem e
 * GRAVADA ANTES de sair. Se o provedor recusar, ela continua na conversa com o
 * erro visivel, em vez de sumir da tela sem explicacao, que e o defeito mais
 * caro num atendimento (o atendente reescreve tudo achando que nao clicou).
 */

/**
 * A janela de 24 horas so existe no caminho oficial da Meta. Fica reexportada
 * aqui porque a tela de atendimento pergunta por ela ao montar a conversa, e
 * ela nao deveria precisar saber em que driver a regra mora.
 */
export const janelaAberta = janelaOficial;

/**
 * Grava a mensagem, tenta entregar e devolve o registro com o resultado.
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

    const driver = driverDa(conexao);
    const template = templateId ? achar('templates', templateId) : null;

    const { idExterno } = await driver.enviar({
      conexao,
      contato,
      tipo,
      conteudo,
      midia,
      template,
    });

    Object.assign(mensagem, { situacao: 'enviada', idExterno: idExterno || null, enviadaEm: agora() });
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

/**
 * Marca como lida no WhatsApp do cliente. E cortesia, nao funcionalidade: falha
 * aqui nunca sobe, porque nao vale interromper um atendimento por causa do
 * segundo tique azul.
 */
export async function marcarComoLida(conexao, idExterno, contato = null) {
  if (!conexao || !idExterno) return;
  try {
    await driverDa(conexao).marcarLida({ conexao, idExterno, contato });
  } catch {
    /* nunca derruba o atendimento */
  }
}
