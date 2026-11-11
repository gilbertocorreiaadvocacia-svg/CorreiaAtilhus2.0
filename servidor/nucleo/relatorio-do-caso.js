import fs from 'node:fs';
import path from 'node:path';
import { PDFDocument, StandardFonts, rgb } from 'pdf-lib';
import { PASTA_ARQUIVOS } from '../config.js';
import { achar } from './banco.js';
import { fichaDoCaso } from './ficha-do-contrato.js';

/**
 * O relatorio do caso num PDF so: o relatorio e, logo atras, os documentos do
 * cliente, pagina apos pagina.
 *
 * Pedido do escritorio em 11/11/2026: "eu quero que ao fechar o contrato ele
 * tenha um botao em que ao clicar ele vai fazer o relatorio do caso, com todos
 * os dados do cliente e com suas documentacoes". A ficha na tela ja mostrava
 * tudo, mas imprimir dali dava o relatorio com a LISTA dos anexos; os
 * documentos em si ficavam de fora, e e com eles que se protocola.
 *
 * POR QUE PDF-LIB, E O QUE ISSO CUSTOU. O sistema nao tinha dependencia
 * nenhuma, e essa era uma escolha do projeto (ver o Dockerfile). Juntar PDF
 * com PDF e a unica parte que o navegador nao faz: ele imprime a pagina que
 * voce desenhar e embute imagem, mas nao costura um PDF que ja existe. O
 * escritorio escolheu o PDF unico sabendo do custo — o build passou a ter um
 * `npm ci`. pdf-lib e JS puro, sem compilacao nativa: nao traz toolchain para
 * a imagem nem alonga a implantacao na VPS de 1 vCPU alem do download.
 *
 * O QUE ENTRA, NESTA ORDEM: a capa com o relatorio (quem fechou, os dados do
 * cliente, a lista do que vem atras) e depois cada documento. PDF entra com as
 * paginas dele; imagem entra numa pagina A4, encaixada sem distorcer. O que
 * nao der para ler nao derruba o relatorio: entra como uma pagina dizendo o
 * nome do arquivo e o motivo, porque um documento que falhou em silencio e
 * pior do que um que avisa — quem protocola precisa saber que falta peca.
 */

/* A4 em pontos (72 por polegada), que e a unidade do PDF. */
const A4 = { largura: 595.28, altura: 841.89 };
const MARGEM = 56;
const PRETO = rgb(0.08, 0.08, 0.08);
const CINZA = rgb(0.42, 0.42, 0.42);
const LINHA = rgb(0.85, 0.85, 0.85);

const EXTENSOES_DE_IMAGEM = /\.(png|jpe?g)$/i;

const brData = (iso) => {
  if (!iso) return '';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  return d.toLocaleString('pt-BR', { dateStyle: 'short', timeStyle: 'short', timeZone: 'America/Sao_Paulo' });
};

/**
 * O WinAnsi das fontes padrao do PDF nao tem todo caractere que aparece numa
 * conversa de WhatsApp (emoji, por exemplo), e um caractere fora da tabela faz
 * pdf-lib LANCAR no meio do desenho. Trocar e melhor do que o relatorio inteiro
 * falhar por causa de um coracao no nome do contato.
 */
const semCaractereEstranho = (texto) =>
  String(texto ?? '')
    .normalize('NFC')
    .replace(/[‘’]/g, "'")
    .replace(/[“”]/g, '"')
    .replace(/[–—]/g, '-')
    .replace(/…/g, '...')
    /* Sobrou algo fora do Latin-1? Vira interrogacao, e o resto da linha se
       salva. Acento NAO entra aqui: "Conceicao" cabe no WinAnsi e continua
       escrito certo — o que cai sao emoji e sinais de outros alfabetos. */
    .replace(/[^\x09\x0A\x0D\x20-\x7E\xA0-\xFF]/g, '?')
    /* Uma interrogacao por trecho, e nenhuma sobrando na ponta: um nome com
       emoji no fim virava "Conceicao Araujo ??" no titulo do documento, que
       parece arquivo corrompido. No meio da frase a marca fica, para ninguem
       achar que o texto estava escrito assim. */
    .replace(/\?{2,}/g, '?')
    .replace(/^[\s?]+|[\s?]+$/g, '')
    .replace(/\s{2,}/g, ' ');

/** Quebra o texto na largura disponivel, medindo com a propria fonte. */
function quebrar(texto, fonte, tamanho, largura) {
  const palavras = semCaractereEstranho(texto).split(/\s+/).filter(Boolean);
  const linhas = [];
  let atual = '';
  for (const palavra of palavras) {
    const tentativa = atual ? `${atual} ${palavra}` : palavra;
    if (fonte.widthOfTextAtSize(tentativa, tamanho) <= largura) {
      atual = tentativa;
      continue;
    }
    if (atual) linhas.push(atual);
    /* Palavra sozinha maior que a linha (um endereco colado, uma URL): corta
       no limite em vez de estourar a margem. */
    if (fonte.widthOfTextAtSize(palavra, tamanho) > largura) {
      let pedaco = '';
      for (const letra of palavra) {
        if (fonte.widthOfTextAtSize(pedaco + letra, tamanho) > largura) {
          linhas.push(pedaco);
          pedaco = letra;
        } else {
          pedaco += letra;
        }
      }
      atual = pedaco;
    } else {
      atual = palavra;
    }
  }
  if (atual) linhas.push(atual);
  return linhas.length ? linhas : [''];
}

/** Escritor sequencial: vai descendo na pagina e abre outra quando acaba. */
function folha(pdf, fontes) {
  let pagina = pdf.addPage([A4.largura, A4.altura]);
  let y = A4.altura - MARGEM;
  const util = A4.largura - MARGEM * 2;

  const espaco = (altura) => {
    if (y - altura >= MARGEM) return;
    pagina = pdf.addPage([A4.largura, A4.altura]);
    y = A4.altura - MARGEM;
  };

  return {
    get pagina() {
      return pagina;
    },
    util,
    pular(altura) {
      espaco(altura);
      y -= altura;
    },
    titulo(texto, tamanho = 16) {
      espaco(tamanho + 10);
      y -= tamanho;
      pagina.drawText(semCaractereEstranho(texto), { x: MARGEM, y, size: tamanho, font: fontes.negrito, color: PRETO });
      y -= 8;
    },
    paragrafo(texto, { tamanho = 10, cor = PRETO, fonte = fontes.normal } = {}) {
      for (const linha of quebrar(texto, fonte, tamanho, util)) {
        espaco(tamanho + 4);
        y -= tamanho + 3;
        pagina.drawText(linha, { x: MARGEM, y, size: tamanho, font: fonte, color: cor });
      }
    },
    /* Rotulo a esquerda em coluna fixa e valor a direita: e o que deixa a
       ficha conferivel de relance, igual a tela. */
    campo(rotulo, valor) {
      const tamanho = 10;
      const colunaRotulo = 150;
      const linhas = quebrar(valor, fontes.normal, tamanho, util - colunaRotulo - 10);
      espaco(linhas.length * (tamanho + 4) + 6);
      y -= tamanho + 3;
      pagina.drawText(semCaractereEstranho(rotulo), { x: MARGEM, y, size: tamanho, font: fontes.normal, color: CINZA });
      pagina.drawText(linhas[0], { x: MARGEM + colunaRotulo, y, size: tamanho, font: fontes.normal, color: PRETO });
      for (const extra of linhas.slice(1)) {
        y -= tamanho + 3;
        pagina.drawText(extra, { x: MARGEM + colunaRotulo, y, size: tamanho, font: fontes.normal, color: PRETO });
      }
      y -= 4;
      pagina.drawLine({ start: { x: MARGEM, y }, end: { x: MARGEM + util, y }, thickness: 0.5, color: LINHA });
    },
  };
}

/** Le o arquivo do disco, sem deixar sair da pasta de arquivos. */
function lerDocumento(caminhoRelativo) {
  const raiz = path.resolve(PASTA_ARQUIVOS);
  const completo = path.resolve(raiz, caminhoRelativo || '');
  if (!completo.startsWith(raiz + path.sep) || !fs.existsSync(completo)) return null;
  return fs.readFileSync(completo);
}

/**
 * Monta o PDF do caso. Devolve { nome, bytes } ou null quando o contrato nao
 * existe (ou a pessoa nao pode ver a conversa — fichaDoContrato ja decide).
 */
export async function relatorioDoCaso(ctx, alvo) {
  /* Aceita o id do contrato ou o da conversa: a maioria dos casos fechados
     deste escritorio nao tem contrato da ZapSign (ver fichaDoCaso). */
  const ficha = fichaDoCaso(ctx, typeof alvo === 'string' ? { contratoId: alvo } : alvo);
  if (!ficha) return null;

  const { contrato, cliente, dados, documentos } = ficha;

  /*
   * O caminho no disco vem do contato, e nao da ficha: a ficha e a resposta de
   * uma rota, e caminho de arquivo do servidor nao tem por que trafegar ate o
   * navegador. Quem ja passou por fichaDoContrato passou pelo guarda de quem
   * pode ver a conversa, entao ler o contato aqui nao abre porta nenhuma.
   */
  const contato = achar('contatos', cliente.id);
  const caminhoPorId = new Map((contato?.arquivos || []).map((a) => [a.id, a.caminho]));
  const pdf = await PDFDocument.create();
  const fontes = {
    normal: await pdf.embedFont(StandardFonts.Helvetica),
    negrito: await pdf.embedFont(StandardFonts.HelveticaBold),
  };

  pdf.setTitle(`Relatorio do caso - ${semCaractereEstranho(cliente.nome)}`);
  pdf.setProducer('Atilhus Chat');
  pdf.setCreationDate(new Date());

  /* ---------------- A capa: o relatorio ---------------- */
  const f = folha(pdf, fontes);
  f.titulo('Correia Advogados Associados', 13);
  f.paragrafo('Relatório do caso', { tamanho: 20, fonte: fontes.negrito });
  f.paragrafo(cliente.nome, { tamanho: 14, fonte: fontes.negrito });
  /* Sem contrato da ZapSign o caso nao fica sem data: vale a entrada na coluna
     de fechado, que e o que o escritorio chama de fechamento. */
  f.paragrafo(
    contrato.assinadoEm
      ? `${contrato.temZapsign ? 'Contrato assinado' : 'Caso fechado'} em ${brData(contrato.assinadoEm)}.`
      : `Caso em ${contrato.situacao || 'situação desconhecida'}.`,
    { cor: CINZA },
  );
  f.pular(10);

  f.titulo('Quem fechou', 12);
  if (contrato.agente) f.campo('Conduziu o atendimento', `${contrato.agente.nome} (agente de IA)`);
  if (contrato.aprovadoPor) {
    f.campo(contrato.aprovadoPor.moveuAColuna ? 'Fechou o caso' : 'Aprovou e enviou', contrato.aprovadoPor.nome);
  }
  if (!contrato.agente && !contrato.aprovadoPor) {
    f.campo('Atribuição', 'Sem agente e sem registro de quem fechou.');
  }
  if (!contrato.temZapsign) {
    f.campo('Contrato', 'Fechado fora do sistema: não há contrato assinado pela ZapSign nesta conversa.');
  }
  f.pular(14);

  f.titulo('Dados do cliente', 12);
  if (cliente.telefone) f.campo('Telefone', cliente.telefone);
  for (const dado of dados) f.campo(dado.rotulo, dado.valor);
  if (cliente.origem?.nome) f.campo('Origem', cliente.origem.nome);
  if (cliente.departamento?.nome) f.campo('Departamento', cliente.departamento.nome);
  if (cliente.etiquetas.length) f.campo('Etiquetas', cliente.etiquetas.map((e) => e.nome).join(', '));
  if (cliente.criadoEm) f.campo('Cliente desde', brData(cliente.criadoEm));
  f.pular(14);

  /* A lista do que vem atras: quem recebe o PDF sabe quantas pecas sao antes
     de rolar ate o fim, e percebe na hora se faltou alguma. */
  f.titulo(`Documentos anexados (${documentos.length})`, 12);
  if (documentos.length) {
    documentos.forEach((doc, i) => f.paragrafo(`${i + 1}. ${doc.nome}${doc.enviadoPor ? ` — ${doc.enviadoPor}` : ''}`));
  } else {
    f.paragrafo('Nenhum documento guardado nesta conversa.', { cor: CINZA });
  }
  f.pular(16);
  f.paragrafo(`Gerado em ${brData(new Date().toISOString())} pelo Atilhus Chat.`, { tamanho: 8, cor: CINZA });

  /* ---------------- Os documentos, um atras do outro ---------------- */
  const falhas = [];
  for (const doc of documentos) {
    const bytes = lerDocumento(caminhoPorId.get(doc.id));
    if (!bytes) {
      falhas.push({ nome: doc.nome, motivo: 'o arquivo não está mais no disco' });
      continue;
    }
    try {
      if (EXTENSOES_DE_IMAGEM.test(doc.nome)) {
        const imagem = /\.png$/i.test(doc.nome) ? await pdf.embedPng(bytes) : await pdf.embedJpg(bytes);
        const pagina = pdf.addPage([A4.largura, A4.altura]);
        /* Encaixa dentro da margem sem distorcer: a mesma escala nos dois
           lados, limitada pelo que estourar primeiro. */
        const caixa = { largura: A4.largura - MARGEM, altura: A4.altura - MARGEM * 2 };
        const escala = Math.min(caixa.largura / imagem.width, caixa.altura / imagem.height, 1);
        const largura = imagem.width * escala;
        const altura = imagem.height * escala;
        pagina.drawText(semCaractereEstranho(doc.nome), {
          x: MARGEM / 2,
          y: A4.altura - MARGEM / 2,
          size: 9,
          font: fontes.normal,
          color: CINZA,
        });
        pagina.drawImage(imagem, {
          x: (A4.largura - largura) / 2,
          y: (A4.altura - altura) / 2 - MARGEM / 4,
          width: largura,
          height: altura,
        });
        continue;
      }

      /* PDF: entra com as paginas dele. `ignoreEncryption` porque documento de
         orgao publico (INSS, tribunal) costuma vir com protecao so de
         impressao — recusar por isso deixaria o relatorio sem o CNIS. */
      const origem = await PDFDocument.load(bytes, { ignoreEncryption: true });
      const paginas = await pdf.copyPages(origem, origem.getPageIndices());
      for (const pagina of paginas) pdf.addPage(pagina);
    } catch (erro) {
      falhas.push({ nome: doc.nome, motivo: erro.message || 'não deu para ler o arquivo' });
    }
  }

  /*
   * O que falhou vai para o FIM, escrito. Um anexo que some em silencio e o
   * pior desfecho possivel aqui: quem protocola confia no PDF e so descobre a
   * falta no balcao.
   */
  if (falhas.length) {
    const aviso = folha(pdf, fontes);
    aviso.titulo('Documentos que não entraram', 13);
    aviso.paragrafo(
      'Os arquivos abaixo estão na conversa, mas não foi possível incluí-los neste PDF. Baixe-os à parte antes de protocolar.',
      { cor: CINZA },
    );
    aviso.pular(8);
    for (const falha of falhas) aviso.campo(falha.nome, falha.motivo);
  }

  const bytes = await pdf.save();
  const nomeLimpo = String(cliente.nome || 'cliente')
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[^\w]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 60) || 'cliente';

  return {
    nome: `${nomeLimpo}-caso.pdf`,
    bytes: Buffer.from(bytes),
    documentos: documentos.length,
    falhas,
  };
}
