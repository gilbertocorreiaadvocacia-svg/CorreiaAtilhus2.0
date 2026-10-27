import { atualizar, listar, mensagensDe, moverMensagens, registrarLog, remover } from '../nucleo/banco.js';
import { umTipoDeCaso } from '../nucleo/casos.js';
import { chaveDoTelefone, normalizar } from '../nucleo/util.js';
import { nomeEhProvisorio } from './nomes.js';

/**
 * Funde contatos duplicados: a mesma pessoa com dois registros no mesmo
 * workspace. Pedido do escritorio em 15/10/2026, depois de a importacao do
 * historico da LiderHub ter criado duplicados por dois motivos (os dois
 * corrigidos na fonte, em integracoes/liderhub.js, no mesmo dia):
 *
 *   1. A fase 1 (classificacao) escolhia "a primeira conexao do workspace";
 *      a fase 2 (historico) sempre escolhia a de qrcode. Workspace com
 *      qrcode E simulador (o "Chat de teste" que todo workspace ja tem) podia
 *      ter cada fase criando o contato sob uma conexao diferente.
 *   2. O numero da LiderHub ja vem com o pais, e as duas fases passavam ele
 *      por normalizarTelefone (que ASSUME numero sem pais e completa com 55)
 *      em vez de normalizarTelefoneDoWhatsApp — o mesmo bug que o comentario
 *      de nucleo/util.js documenta para a importacao do historico do
 *      WhatsApp ("telefone inventado").
 *
 * Esta funcao e o reparo dos dois: acha pares com o MESMO telefone (contando
 * a ambiguidade do 55 do motivo 2) e funde num so, sem depender da conexao
 * (motivo 1). Roda no boot, idempotente — sem duplicado, nao muda nada.
 */

/*
 * Em 26/10/2026 ("mais de 1410 ativos, parece que esta duplicado") a mesma
 * pessoa passou a ser reconhecida tambem pelo nono digito do celular (ver
 * chaveDoTelefone, em nucleo/util.js) e pelo codigo @lid do WhatsApp: a
 * importacao do historico do celular cria uma conversa por endereco, e a
 * mesma conta pode vir pelo numero e pelo @lid. O mesmo @lid e a mesma conta,
 * sem duvida nenhuma. Nome igual NAO junta ninguem: duas pessoas podem ter o
 * mesmo nome, e juntar errado mistura a conversa de dois clientes.
 */

/** Quanto este contato "pesa" ao decidir quem fica: mais mensagens, mais antigo. */
function pesoDoContato(contato) {
  return mensagensDe(contato.id).length;
}

function maisPesado(a, b) {
  const pesoA = pesoDoContato(a);
  const pesoB = pesoDoContato(b);
  if (pesoA !== pesoB) return pesoA > pesoB ? a : b;
  return String(a.criadoEm) <= String(b.criadoEm) ? a : b;
}

/** Leva tudo do duplicado para o canonico, e apaga o duplicado. Devolve quantas mensagens moveu. */
function fundirContato(canonico, duplicado) {
  const mudancas = {};

  if (nomeEhProvisorio(canonico) && !nomeEhProvisorio(duplicado)) {
    mudancas.nome = duplicado.nome;
    mudancas.nomeOrigem = duplicado.nomeOrigem;
  }
  if (!canonico.foto && duplicado.foto) mudancas.foto = duplicado.foto;
  if (!canonico.statusId && duplicado.statusId) mudancas.statusId = duplicado.statusId;
  if (!canonico.departamentoId && duplicado.departamentoId) mudancas.departamentoId = duplicado.departamentoId;
  if (!canonico.origemId && duplicado.origemId) mudancas.origemId = duplicado.origemId;
  if (duplicado.etiquetas?.length) {
    const juntas = [...new Set([...(canonico.etiquetas || []), ...duplicado.etiquetas])];
    mudancas.etiquetas = umTipoDeCaso(juntas, canonico.etiquetas);
  }
  if (duplicado.primeiraMensagemEm && (!canonico.primeiraMensagemEm || duplicado.primeiraMensagemEm < canonico.primeiraMensagemEm)) {
    mudancas.primeiraMensagemEm = duplicado.primeiraMensagemEm;
  }
  if (duplicado.ultimaMensagemEm && (!canonico.ultimaMensagemEm || duplicado.ultimaMensagemEm > canonico.ultimaMensagemEm)) {
    mudancas.ultimaMensagemEm = duplicado.ultimaMensagemEm;
    mudancas.previa = duplicado.previa;
    /* A conversa que esta andando agora e a do duplicado: quem atende fica
       quem atende ali (a IA no lead novo, nao a pessoa da importacao antiga). */
    for (const campo of ['responsavel', 'estado', 'aceitoPor', 'aceitoEm', 'atribuidoEm', 'passagens', 'ultimaEntradaEm', 'ultimaSaidaEm']) {
      if (duplicado[campo] !== undefined) mudancas[campo] = duplicado[campo];
    }
  }
  /* O telefone e o @lid sao o endereco da conversa: o que um tem e o outro
     nao, fica. Sem isso, juntar a conversa do @lid na do numero (ou o
     contrario) deixava a sobrevivente sem como responder. */
  if (!canonico.telefone && duplicado.telefone) mudancas.telefone = duplicado.telefone;
  if (!canonico.lid && duplicado.lid) mudancas.lid = duplicado.lid;
  if (duplicado.naoLidas) mudancas.naoLidas = (canonico.naoLidas || 0) + duplicado.naoLidas;

  const movidas = moverMensagens(duplicado.id, canonico.id);
  if (Object.keys(mudancas).length) {
    atualizar('contatos', canonico.id, mudancas);
    Object.assign(canonico, mudancas);
  }

  registrarLog(
    canonico.workspaceId,
    canonico.id,
    'fusao',
    `Contato duplicado (telefone ${duplicado.telefone}, ${movidas} mensagem(ns)) foi fundido aqui e removido.`,
  );
  remover('contatos', duplicado.id);

  return movidas;
}

export function deduplicarContatos() {
  let fundidos = 0;
  let mensagensMovidas = 0;

  for (const workspace of listar('workspaces')) {
    const contatos = listar('contatos', { workspaceId: workspace.id });

    /*
     * Indice, e nao comparacao par a par: milhares de contatos por workspace
     * tornavam o duplo loop original caro demais para rodar em TODO boot
     * (achado em 19/10/2026).
     *
     * Uma chave por endereco (o telefone na forma de chaveDoTelefone, e o
     * @lid): contatos que dividem qualquer chave sao a mesma pessoa, inclusive
     * em cadeia — o numero sem o 9, o numero com o 9 e o @lid da mesma conta
     * viram um so. Grupo e conversa de rede social ficam de fora.
     */
    const pai = new Map(contatos.map((c) => [c.id, c.id]));
    const raiz = (id) => {
      while (pai.get(id) !== id) id = pai.get(id);
      return id;
    };
    const dono = new Map();
    for (const contato of contatos) {
      if (contato.grupo || contato.idCanal) continue;
      const chaves = [chaveDoTelefone(contato.telefone) && `tel:${chaveDoTelefone(contato.telefone)}`, contato.lid && `lid:${contato.lid}`].filter(Boolean);
      for (const chave of chaves) {
        if (!dono.has(chave)) dono.set(chave, contato.id);
        else pai.set(raiz(contato.id), raiz(dono.get(chave)));
      }
    }

    const grupos = new Map();
    for (const contato of contatos) {
      const r = raiz(contato.id);
      if (!grupos.has(r)) grupos.set(r, []);
      grupos.get(r).push(contato);
    }

    for (const pares of grupos.values()) {
      if (pares.length < 2) continue;
      const canonico = pares.reduce((melhor, candidato) => maisPesado(melhor, candidato));
      /* Do mais antigo para o mais recente: quem atende (fundirContato) fica
         o da conversa mais recente de todas. */
      const resto = pares.filter((c) => c.id !== canonico.id).sort((a, b) => String(a.ultimaMensagemEm || '').localeCompare(String(b.ultimaMensagemEm || '')));
      for (const contato of resto) {
        mensagensMovidas += fundirContato(canonico, contato);
        fundidos += 1;
      }
    }
  }

  return { fundidos, mensagensMovidas };
}

const TRINTA_DIAS = 30 * 24 * 60 * 60 * 1000;

/**
 * De onde vem a aba Ativos, em numeros, para conferir de fora (/api/saude).
 * Pedido do escritorio em 26/10/2026: "mais de 1410 ativos, parece que esta
 * duplicado". So contagens, sem nome de ninguem: a rota de saude e aberta.
 *
 * `mesmoNome` conta as conversas cujo nome aparece em outra conversa do
 * escritorio — e um indicio de pessoa repetida, nao prova: ninguem e juntado
 * por nome (ver o comentario do topo).
 */
export function retratoDasConversas(workspaceId) {
  const contatos = listar('contatos', { workspaceId }).filter((c) => !c.grupo && !c.idCanal);
  const ativos = contatos.filter((c) => c.estado !== 'arquivado' && c.responsavel?.tipo !== 'agente' && c.aceitoPor);
  const limite = Date.now() - TRINTA_DIAS;

  const porNome = new Map();
  for (const contato of contatos) {
    const nome = normalizar(contato.nome);
    if (!nome || nomeEhProvisorio(contato) || !/[a-z]/.test(nome)) continue;
    porNome.set(nome, (porNome.get(nome) || 0) + 1);
  }

  /* Quantas conversas a importacao do celular criou em cada dia: mostra
     quando os Ativos incharam (27/10/2026, "estavam com 32 ativos e agora
     esta mais de 500"). */
  const importadosPorDia = {};
  for (const contato of contatos) {
    if (!contato.importado) continue;
    const dia = String(contato.criadoEm || '').slice(0, 10) || 'sem data';
    importadosPorDia[dia] = (importadosPorDia[dia] || 0) + 1;
  }

  return {
    total: contatos.length,
    importadosPorDia,
    ativos: ativos.length,
    ativosDoHistoricoDoCelular: ativos.filter((c) => c.importado).length,
    ativosSemMensagemHa30Dias: ativos.filter((c) => !c.ultimaMensagemEm || Date.parse(c.ultimaMensagemEm) < limite).length,
    soComCodigoDoWhatsapp: contatos.filter((c) => c.lid && !c.telefone).length,
    mesmoNome: contatos.filter((c) => (porNome.get(normalizar(c.nome)) || 0) > 1).length,
  };
}
