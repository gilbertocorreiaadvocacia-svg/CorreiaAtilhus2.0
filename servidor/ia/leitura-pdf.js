import fs from 'node:fs';
import { CUSTO } from '../config.js';
import { atualizarMensagem, mensagensDe } from '../nucleo/banco.js';
import { lancar } from '../nucleo/creditos.js';
import { caminhoDaMidia } from '../nucleo/midia.js';
import { conversar } from './provedores.js';

/**
 * O PDF que o cliente manda, lido.
 *
 * Pedido do escritorio em 26/10/2026: "a IA nao consegue verificar PDF". O
 * agente enxergava as fotos (montarHistorico, em ia/motor.js), mas o PDF
 * chegava so como "[documento: CNIS.pdf]" — e o CNIS baixado do Meu INSS, o
 * laudo e o holerite costumam vir assim.
 *
 * Cada PDF e lido UMA vez, na primeira resposta do agente depois que ele
 * chega, e o que o documento diz fica gravado na mensagem (`leitura`). Dali
 * em diante o agente recebe esse texto, e nao o arquivo: um CNIS de 20
 * paginas mandado de novo a cada resposta custaria a leitura inteira a cada
 * mensagem da conversa. O que nao deu para ler fica em `leituraErro`, e o
 * agente sabe que precisa pedir de outro jeito.
 */

/* A API aceita ate 32 MB por pedido, com o base64 (que cresce um terco), e ate 100 paginas. */
const LIMITE_DO_ARQUIVO = 20 * 1024 * 1024;
const PAGINAS_MAXIMAS = 100;
/* Conversa antiga com muitos PDFs: os mais recentes primeiro, alguns por resposta. */
const POR_RESPOSTA = 3;

export const LEITURA_DE_DOCUMENTO = `LEITURA DE DOCUMENTO. Você lê um PDF que um cliente mandou pelo WhatsApp a um escritório de advocacia (previdenciário, trabalhista e cível). Escreva, em português, tudo o que o documento diz e que importa para o caso: o que ele e (CNIS, laudo, exame, receita, atestado, carteira de trabalho, holerite, TRCT, contrato, decisão, carta do INSS...), nomes, CPF, datas, empresas e períodos de trabalho, salários e contribuições, CID, diagnósticos, limitações, nome e CRM do médico, valores, números de processo e de benefício. Tabela longa, como os vínculos do CNIS: uma linha por item, com os campos principais. Copie números e datas exatamente como estão. Não invente, não complete e não interprete: o que não der para ler, diga que não deu. Sem introdução e sem conclusão.`;

export const ehPdf = (midia) =>
  Boolean(midia) && (midia.mime === 'application/pdf' || /\.pdf$/i.test(String(midia.nome || midia.arquivo || midia.url || '')));

/* Conta pelo dicionario de cada pagina. PDF com as paginas dentro de um fluxo
   comprimido nao mostra nenhuma: ai nao da para saber daqui, e ele segue. */
const contarPaginas = (dados) => (dados.toString('latin1').match(/\/Type\s*\/Page(?![a-z])/g) || []).length;

/** Le os PDFs do cliente que ainda nao foram lidos. Devolve quantos leu. */
export async function lerPdfsNovos({ contato, agente }) {
  const novos = mensagensDe(contato.id)
    .filter((m) => m.direcao === 'entrada' && !m.nota && ehPdf(m.midia) && m.midia.url && m.leitura == null && !m.leituraErro)
    .slice(-POR_RESPOSTA);

  let lidos = 0;
  for (const mensagem of novos) {
    const naoLeu = (motivo) => atualizarMensagem(contato.id, mensagem.id, { leituraErro: motivo });
    const caminho = caminhoDaMidia(mensagem.midia.url);
    if (!caminho) {
      naoLeu('o arquivo nao esta no servidor');
      continue;
    }
    const dados = fs.readFileSync(caminho);
    if (dados.length > LIMITE_DO_ARQUIVO) {
      naoLeu('o PDF passa de 20 MB');
      continue;
    }
    if (contarPaginas(dados) > PAGINAS_MAXIMAS) {
      naoLeu(`o PDF passa de ${PAGINAS_MAXIMAS} paginas`);
      continue;
    }

    let resposta;
    try {
      resposta = await conversar({
        modeloId: agente.modelo,
        workspaceId: contato.workspaceId,
        sistema: LEITURA_DE_DOCUMENTO,
        mensagens: [
          {
            papel: 'usuario',
            texto: `Arquivo: ${mensagem.midia.nome || 'documento.pdf'}`,
            documentos: [{ nome: mensagem.midia.nome, base64: dados.toString('base64') }],
          },
        ],
        aceitaCorte: true,
      });
    } catch (erro) {
      naoLeu(erro.message);
      continue;
    }
    /* Sem chave de IA nao ha leitura: fica para quando houver. */
    if (resposta.semProvedor) return lidos;

    const texto = String(resposta.texto || '').trim();
    if (!texto) {
      naoLeu('a IA nao devolveu nada do documento');
      continue;
    }
    const cortada = resposta.parada === 'max_tokens';
    atualizarMensagem(contato.id, mensagem.id, { leitura: cortada ? `${texto}\n(o documento e longo: a leitura parou aqui)` : texto });
    lancar(contato.workspaceId, contato.id, 'leitura_documento', CUSTO.leituraDocumento, null, agente.id);
    lidos += 1;
  }
  return lidos;
}
