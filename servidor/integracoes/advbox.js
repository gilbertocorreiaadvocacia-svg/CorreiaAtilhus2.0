import { achar } from '../nucleo/banco.js';

/**
 * Consulta de andamento processual. A chave e o endereco ficam nas
 * configuracoes, assim o mesmo modulo serve para o ADVBox ou para qualquer
 * outro sistema do escritorio que responda JSON.
 */

function configuracao(workspaceId) {
  const integracoes = achar('integracoes', { workspaceId });
  return (
    integracoes?.advbox || { chave: '', ativo: false, base: 'https://app.advbox.com.br/api/v1', descricoesStatus: {} }
  );
}

export async function consultarProcessos({ workspaceId, cpf }) {
  const cfg = configuracao(workspaceId);
  const numero = String(cpf || '').replace(/\D+/g, '');

  if (!numero || numero.length !== 11) {
    return { erro: 'CPF invalido. Peca ao cliente os 11 digitos, sem pontos.' };
  }
  if (!cfg.chave) {
    return {
      erro: 'A consulta de processos ainda nao esta configurada. Diga ao cliente que voce vai verificar com a equipe e transfira a conversa.',
    };
  }

  const base = cfg.base || 'https://app.advbox.com.br/api/v1';

  try {
    const resposta = await fetch(`${base}/lawsuits?cpf=${numero}`, {
      headers: { Authorization: `Bearer ${cfg.chave}`, Accept: 'application/json' },
    });
    if (!resposta.ok) {
      return { erro: `A consulta respondeu ${resposta.status}. Verifique com a equipe.` };
    }
    const dados = await resposta.json().catch(() => ({}));
    const lista = Array.isArray(dados) ? dados : dados?.data || dados?.results || [];

    if (!lista.length) {
      return { resultado: 'Nenhum processo encontrado para este CPF.' };
    }

    const processos = lista.map((p) => {
      const chave = String(p.status || p.stage || p.fase || '').trim();
      return {
        numero: p.protocol_number || p.number || p.numero || 'sem numero',
        fase: chave,
        explicacao:
          cfg.descricoesStatus?.[chave] ||
          'Fase em andamento. Explique ao cliente que o processo segue seu curso normal e que o escritorio avisa a cada movimentacao relevante.',
        atualizadoEm: p.updated_at || p.last_movement || null,
      };
    });

    return { resultado: processos };
  } catch (erro) {
    return { erro: `Nao consegui consultar agora (${erro.message}). Transfira para a equipe.` };
  }
}
