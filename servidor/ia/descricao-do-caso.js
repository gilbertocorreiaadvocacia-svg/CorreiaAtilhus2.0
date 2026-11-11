import { CUSTO } from '../config.js';
import { achar, atualizar, inserir, listar, mensagensDe } from '../nucleo/banco.js';
import { lancar } from '../nucleo/creditos.js';
import { agora, novoId } from '../nucleo/util.js';
import { conversar, provedorDisponivel } from './provedores.js';
import { mensagensDoResumo, redigir } from './resumo-da-conversa.js';

/**
 * A descricao do caso: texto corrido, detalhado, para o relatorio do caso.
 *
 * Pedido do escritorio em 11/11/2026: "quero bem mais detalhado e sem topicos".
 * O relatorio usava o resumo da conversa, que e curto e em campos por desenho —
 * ele existe para quem abre a conversa ter dez segundos de contexto. No
 * relatorio que acompanha o caso, isso e pouco: quem le quer a historia.
 *
 * Por isso uma REDACAO PROPRIA, e nao um ajuste no resumo. Os dois textos
 * servem a leituras diferentes e viveriam brigando por um formato so: o da
 * conversa precisa caber num cartao, e este precisa contar o caso inteiro.
 *
 * O QUE ELA LE, e isso e o que a torna detalhada: a conversa toda e tambem o
 * que o sistema ja extraiu dos PDFs que o cliente mandou (`leitura`, gravada
 * por ia/leitura-pdf.js). O CNIS, o laudo e o holerite ja foram lidos uma vez;
 * aqui esse texto volta a ser util em vez de ficar parado na mensagem.
 *
 * GUARDADA E REAPROVEITADA. Gerar custa credito e alguns segundos, e um
 * relatorio e frequentemente baixado duas ou tres vezes seguidas (conferir,
 * imprimir, anexar). A descricao fica gravada com a marca da ultima mensagem
 * que leu: sem conversa nova, o relatorio seguinte sai na hora e de graca.
 */

/* Teto de mensagens lidas. Conversa de meses nao cabe num pedido so, e o fim e
   o que conta a historia atual; o comeco entra pelo recorte das primeiras. */
const PRIMEIRAS = 20;
const ULTIMAS = 120;
/* A leitura de um CNIS de 20 paginas e enorme; cortada, ainda diz o essencial. */
const MAXIMO_DA_LEITURA = 4000;

const REGRAS = `Você escreve a DESCRIÇÃO DO CASO de um cliente de um escritório de advocacia (previdenciário, trabalhista e cível). O texto vai num relatório interno que acompanha o caso: quem lê é advogado do escritório e precisa entender o caso inteiro sem abrir a conversa.

REGRAS QUE NÃO TÊM EXCEÇÃO
1. Use SOMENTE o que está na conversa, nos documentos lidos e nos dados abaixo. Não invente, não complete e não suponha. O que não aparece, não entra.
2. Nunca escreva senha (inclusive a do gov.br e do Meu INSS) nem número de documento (CPF, RG, NIT, PIS). Se o cliente passou algum, diga apenas que passou.
3. Não dê opinião jurídica, não avalie o direito do cliente, não cite artigo de lei e não prometa resultado. Descreva o que foi dito e o que aconteceu.
4. Português do Brasil, claro e direto.

FORMATO — ISTO IMPORTA
Texto corrido, em parágrafos. NÃO use tópicos, bullets, travessões no início de linha, títulos, rótulos como "Quem é:" ou numeração. Nada de listas: tudo em frases dentro de parágrafos.
Escreva entre três e seis parágrafos, de quatro a oito linhas cada.

O QUE CONTAR, NESTA ORDEM
Comece por quem é o cliente e o que o levou a procurar o escritório, com as circunstâncias que ele relatou (o que aconteceu, quando, onde, com quem).
Depois, o que foi apurado ao longo do atendimento: o que ele respondeu às perguntas, o que confirmou e o que negou.
Depois, o que os documentos mostram, quando houver leitura deles: diga o que cada documento é e o que diz de relevante (períodos, datas, empresas, valores, diagnósticos, limitações), sem copiar número de documento pessoal.
Depois, como o atendimento andou: o que o escritório propôs, o que o cliente aceitou ou recusou, e o que ficou combinado.
Termine dizendo em que pé o caso está hoje e o que falta.

Se faltar material para algum desses trechos, simplesmente não escreva sobre ele — não anuncie que o dado falta, a não ser que a ausência seja em si relevante para o caso.`;

const horaCurta = (iso) =>
  new Date(iso).toLocaleString('pt-BR', { day: '2-digit', month: '2-digit', year: '2-digit', hour: '2-digit', minute: '2-digit', timeZone: 'America/Sao_Paulo' });

const falaDe = (m) => (m.direcao === 'entrada' ? 'Cliente' : m.nota ? 'Nota interna' : 'Escritório');

/** A mensagem como texto, com o que foi lido do PDF junto quando houver. */
function textoDaMensagem(m) {
  const rotulo = m.midia ? `[${m.tipo || 'documento'}: ${m.midia.nome || 'arquivo'}]` : '';
  let texto = m.conteudo || rotulo;
  if (m.leitura) {
    texto = `${m.conteudo && m.conteudo !== m.midia?.nome ? `${m.conteudo} ` : ''}${rotulo}\nO QUE O DOCUMENTO DIZ: ${String(m.leitura).slice(0, MAXIMO_DA_LEITURA)}`;
  }
  return texto;
}

/**
 * As mensagens que entram no pedido.
 *
 * Conversa longa nao cabe inteira, e cortar so o fim perderia o comeco — que e
 * justamente onde o cliente conta o que aconteceu. Entao vao as primeiras (o
 * relato inicial) e as ultimas (o estado de agora), com um aviso no meio para
 * o modelo nao achar que a conversa pulou de assunto sozinha.
 */
function recorte(mensagens) {
  if (mensagens.length <= PRIMEIRAS + ULTIMAS) return transcrever(mensagens);
  const inicio = transcrever(mensagens.slice(0, PRIMEIRAS));
  const fim = transcrever(mensagens.slice(-ULTIMAS));
  const pulou = mensagens.length - PRIMEIRAS - ULTIMAS;
  return `${inicio}\n\n[... ${pulou} mensagens do meio da conversa não vieram neste recorte ...]\n\n${fim}`;
}

const transcrever = (mensagens) =>
  mensagens.map((m) => `[${horaCurta(m.criadoEm)}] ${falaDe(m)}: ${textoDaMensagem(m)}`).join('\n');

/** Os dados guardados, sem o que nao pode sair escrito. */
function dadosDoContato(contato) {
  return Object.entries(contato.variaveis || {})
    .filter(([campo, valor]) => valor && !/senha|password|token|cpf|rg\b|nit\b|pis\b/i.test(campo))
    .slice(0, 14)
    .map(([campo, valor]) => `${campo}: ${valor}`);
}

export const descricaoDe = (contatoId) => achar('descricoesDoCaso', { contatoId });

/**
 * A descricao guardada, se ainda valer para a conversa de agora.
 *
 * Vale enquanto nao chegou mensagem nova depois dela: e o mesmo criterio do
 * resumo, e o que evita pagar de novo por um relatorio baixado tres vezes
 * seguidas.
 */
export function descricaoValida(contato) {
  const guardada = descricaoDe(contato.id);
  if (!guardada) return null;
  const mensagens = mensagensDoResumo(mensagensDe(contato.id));
  const ultima = mensagens[mensagens.length - 1];
  if (ultima && String(ultima.criadoEm) > String(guardada.ateEm)) return null;
  return guardada;
}

function guardar(contato, dados) {
  const anterior = descricaoDe(contato.id);
  if (anterior) return atualizar('descricoesDoCaso', anterior.id, dados);
  return inserir('descricoesDoCaso', {
    id: novoId('dsc'),
    workspaceId: contato.workspaceId,
    contatoId: contato.id,
    ...dados,
  });
}

/**
 * Escreve (ou reaproveita) a descricao do caso.
 *
 * `forcar` ignora a guardada e paga uma redacao nova — e o botao "Reescrever"
 * da ficha, para quando a equipe acha que o texto envelheceu.
 *
 * Nunca lanca: o relatorio tem que sair mesmo sem IA. Devolve `{ texto, usouIa,
 * aviso }`, e quem chama decide o que mostrar.
 */
export async function descricaoDoCaso(contato, { forcar = false } = {}) {
  if (!forcar) {
    const guardada = descricaoValida(contato);
    if (guardada?.texto) return { texto: guardada.texto, usouIa: guardada.usouIa, geradoEm: guardada.geradoEm, aviso: null, reaproveitada: true };
  }

  const mensagens = mensagensDoResumo(mensagensDe(contato.id));
  if (mensagens.length < 2) {
    return { texto: null, usouIa: false, aviso: 'A conversa é curta demais para descrever o caso.' };
  }

  const modeloId = achar('integracoes', { workspaceId: contato.workspaceId })?.ia?.modeloResumo || 'claude-sonnet-5';
  if (!provedorDisponivel(modeloId, contato.workspaceId)) {
    return { texto: null, usouIa: false, aviso: 'A IA não está configurada neste escritório, então o relatório sai sem a descrição redigida.' };
  }

  const status = contato.statusId ? achar('status', contato.statusId)?.nome : null;
  const caso = (contato.etiquetas || []).map((id) => achar('etiquetas', id)).find((e) => e?.tipo === 'caso');
  const dados = dadosDoContato(contato);

  const pedido = [
    `Cliente: ${contato.nome || 'sem nome'}.`,
    caso ? `Tipo de caso: ${caso.nome}.` : null,
    status ? `Etapa do funil agora: ${status}.` : null,
    dados.length ? `Dados que o escritório guardou:\n${dados.join('\n')}` : null,
    `CONVERSA (${mensagens.length} mensagens):\n${recorte(mensagens)}`,
  ]
    .filter(Boolean)
    .join('\n\n');

  try {
    const resposta = await conversar({
      modeloId,
      workspaceId: contato.workspaceId,
      sistema: REGRAS,
      mensagens: [{ papel: 'usuario', texto: pedido }],
    });
    const texto = redigir(String(resposta.texto || '').trim());
    if (texto.length < 200) {
      return { texto: null, usouIa: false, aviso: 'A IA não devolveu uma descrição utilizável.' };
    }
    lancar(contato.workspaceId, contato.id, 'descricao_do_caso', CUSTO.processamentoIA);
    const ultima = mensagens[mensagens.length - 1];
    const guardada = guardar(contato, {
      texto,
      usouIa: true,
      geradoEm: agora(),
      ateEm: ultima.criadoEm,
      mensagens: mensagens.length,
    });
    return { texto, usouIa: true, geradoEm: guardada.geradoEm, aviso: null, reaproveitada: false };
  } catch (erro) {
    /* Sem descricao o relatorio continua saindo, com os dados e os documentos.
       Melhor um relatorio sem a redacao do que nenhum relatorio. */
    return { texto: null, usouIa: false, aviso: `A IA não respondeu (${erro.message}); o relatório sai sem a descrição redigida.` };
  }
}

/** Para a saude e o diagnostico: quantas conversas ja tem descricao gravada. */
export const descricoesDoEscritorio = (workspaceId) => listar('descricoesDoCaso', { workspaceId }).length;
