import { atualizar, inserir, listar, registrarLog } from '../nucleo/banco.js';
import { agora, novoId } from '../nucleo/util.js';
import { nomeValido, podeTrocarNome } from './nomes.js';

/**
 * A agenda do celular do escritorio, guardada aqui.
 *
 * Quando o numero conecta, o WhatsApp manda para o aparelho vinculado a lista
 * de contatos com o nome SALVO de cada um — e assim que o WhatsApp Web mostra
 * "Dona Maria BPC" em vez do numero. A Evolution repassa isso no evento
 * CONTACTS_UPSERT, e so nele: na tabela de contatos dela o mesmo campo e
 * sobrescrito pelo nome de PERFIL a cada mensagem que chega (conferido no
 * codigo da v2.3.7). Quem nao guarda o evento na hora perde o nome salvo.
 *
 * Um registro por contato por numero: { conexaoId, jid, telefone, nome }. O
 * jid pode ser o endereco antigo (numero@s.whatsapp.net) ou o novo
 * (codigo@lid), e os dois servem: e pelo @lid que a conversa importada sem
 * telefone ainda consegue ganhar nome.
 */

export function telefoneDoJid(jid) {
  const texto = String(jid || '');
  return texto.endsWith('@s.whatsapp.net') ? texto.split('@')[0].split(':')[0] : '';
}

/** O nome salvo para esta pessoa, pelo telefone ou pelo @lid. */
export function nomeNaAgenda(conexao, { telefone = '', lid = '' } = {}) {
  if (!conexao?.id || (!telefone && !lid)) return '';
  const registros = listar('agenda', { conexaoId: conexao.id });
  const peloLid = lid ? registros.find((r) => r.jid === lid) : null;
  if (peloLid) return peloLid.nome;
  const peloTelefone = telefone ? registros.find((r) => r.telefone === telefone) : null;
  return peloTelefone?.nome || '';
}

/** A agenda inteira de uma conexao, como mapa jid -> nome. */
export function mapaDaAgenda(conexao) {
  const mapa = new Map();
  for (const r of listar('agenda', { conexaoId: conexao.id })) mapa.set(r.jid, r.nome);
  return mapa;
}

/**
 * Guarda o que o celular mandou e renomeia as conversas que ja existem.
 *
 * Devolve quantas conversas mudaram de nome, para quem chamou saber se vale
 * avisar a tela.
 */
export function guardarNaAgenda(conexao, itens) {
  const existentes = new Map(listar('agenda', { conexaoId: conexao.id }).map((r) => [r.jid, r]));
  const novidades = [];

  for (const item of itens || []) {
    const jid = String(item?.jid || '');
    const nome = nomeValido(item?.nome, jid);
    if (!jid || !nome) continue;

    const atual = existentes.get(jid);
    if (atual?.nome === nome) continue;
    if (atual) {
      atualizar('agenda', atual.id, { nome, atualizadoEm: agora() });
      atual.nome = nome;
    } else {
      existentes.set(
        jid,
        inserir('agenda', {
          id: novoId('agd'),
          workspaceId: conexao.workspaceId,
          conexaoId: conexao.id,
          jid,
          telefone: telefoneDoJid(jid),
          nome,
        }),
      );
    }
    novidades.push({ jid, nome });
  }

  return novidades.length ? aplicarNomes(conexao, novidades) : 0;
}

function aplicarNomes(conexao, novidades) {
  const contatos = listar('contatos', { workspaceId: conexao.workspaceId });
  const porLid = new Map(contatos.filter((c) => c.lid).map((c) => [c.lid, c]));
  const porTelefone = new Map(contatos.filter((c) => c.telefone).map((c) => [c.telefone, c]));

  let renomeados = 0;
  for (const { jid, nome } of novidades) {
    const contato = porLid.get(jid) || porTelefone.get(telefoneDoJid(jid));
    if (!contato || contato.nome === nome || !podeTrocarNome(contato, 'agenda')) continue;
    atualizar('contatos', contato.id, { nome, nomeOrigem: 'agenda' });
    Object.assign(contato, { nome, nomeOrigem: 'agenda' });
    registrarLog(conexao.workspaceId, contato.id, 'nome', `Nome trazido da agenda do celular: ${nome}`, {
      tipo: 'sistema',
      nome: 'WhatsApp',
    });
    renomeados += 1;
  }
  return renomeados;
}
