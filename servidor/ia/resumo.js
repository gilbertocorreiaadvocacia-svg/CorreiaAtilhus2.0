import { achar } from '../nucleo/banco.js';
import { lancar } from '../nucleo/creditos.js';
import { CUSTO } from '../config.js';
import { conversar, provedorDisponivel } from './provedores.js';

/**
 * Resumo da conversa. Com chave de IA configurada, o modelo escreve; sem ela,
 * o sistema monta um resumo estruturado a partir do que ja esta registrado -
 * nada de deixar a equipe sem resumo so porque a API nao esta ligada.
 */
export async function resumirConversa({ workspaceId, contato, mensagens, instrucao, detalhado }) {
  const transcricao = mensagens
    .map((m) => {
      const quem = m.direcao === 'entrada' ? contato.nome || 'Lead' : m.autor?.nome || 'Escritorio';
      const quando = new Date(m.criadoEm).toLocaleString('pt-BR');
      return `[${quando}] ${quem}: ${m.conteudo || `(${m.tipo})`}`;
    })
    .join('\n');

  const modeloId = achar('integracoes', { workspaceId })?.ia?.modeloResumo || 'claude-sonnet-5';

  if (provedorDisponivel(modeloId, workspaceId)) {
    try {
      const resposta = await conversar({
        modeloId,
        workspaceId,
        sistema: [
          'Voce resume conversas de atendimento de um escritorio de advocacia para a equipe interna.',
          'Escreva em portugues do Brasil, direto, sem enfeite, sem repetir a transcricao.',
          detalhado
            ? 'Formato: situacao do lead, dados coletados, objecoes levantadas, o que ja foi feito, proximo passo sugerido.'
            : 'Formato: um paragrafo curto com quem e o lead, o que ele quer e em que pe esta.',
          instrucao ? `Instrucao adicional de quem pediu o resumo: ${instrucao}` : '',
        ]
          .filter(Boolean)
          .join('\n'),
        mensagens: [{ papel: 'usuario', texto: `Conversa com ${contato.nome} (${contato.telefone}):\n\n${transcricao}` }],
      });
      lancar(workspaceId, contato.id, 'resumo_ia', CUSTO.processamentoIA);
      if (resposta.texto) return resposta.texto;
    } catch (erro) {
      return `${resumoEstruturado(contato, mensagens)}\n\n(A IA nao respondeu: ${erro.message})`;
    }
  }

  return resumoEstruturado(contato, mensagens);
}

function resumoEstruturado(contato, mensagens) {
  const status = contato.statusId ? achar('status', contato.statusId)?.nome : 'sem status';
  const entradas = mensagens.filter((m) => m.direcao === 'entrada');
  const saidas = mensagens.filter((m) => m.direcao === 'saida');
  const variaveis = Object.entries(contato.variaveis || {});
  const etiquetas = (contato.etiquetas || []).map((id) => achar('etiquetas', id)?.nome).filter(Boolean);

  return [
    `RESUMO, ${contato.nome} (${contato.telefone})`,
    `Status: ${status} | Etiquetas: ${etiquetas.join(', ') || 'nenhuma'}`,
    `Mensagens: ${entradas.length} do lead, ${saidas.length} do escritorio.`,
    `Periodo: ${new Date(mensagens[0].criadoEm).toLocaleString('pt-BR')} ate ${new Date(mensagens[mensagens.length - 1].criadoEm).toLocaleString('pt-BR')}.`,
    '',
    'DADOS COLETADOS:',
    variaveis.length ? variaveis.map(([c, v]) => `- ${c}: ${v}`).join('\n') : '- nenhum',
    '',
    'ULTIMAS FALAS DO LEAD:',
    entradas
      .slice(-5)
      .map((m) => `- "${(m.conteudo || '').slice(0, 160)}"`)
      .join('\n') || '- nenhuma',
  ].join('\n');
}
