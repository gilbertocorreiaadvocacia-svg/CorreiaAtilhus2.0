import { achar, atualizar, listar } from '../nucleo/banco.js';
import { agora, slug } from '../nucleo/util.js';

const GRAPH = 'https://graph.facebook.com/v21.0';

const CATEGORIAS = {
  servico: 'UTILITY',
  utilidade: 'UTILITY',
  marketing: 'MARKETING',
  autenticacao: 'AUTHENTICATION',
};

/**
 * Aprovacao de template na Meta. So faz sentido em conexao oficial: e o que
 * permite escrever para o cliente depois das 24 horas. Para follow-up, a
 * categoria correta e marketing.
 */
export async function solicitarAprovacao({ workspaceId, template, conexaoIds, categoria }) {
  const conexoes = (conexaoIds.length
    ? conexaoIds.map((id) => achar('conexoes', id))
    : listar('conexoes', { workspaceId })
  ).filter((c) => c && c.tipo === 'oficial');

  if (!conexoes.length) {
    return {
      ok: false,
      erro: 'Nenhuma conexao oficial. Na API nao oficial nao existe aprovacao de template, o envio e livre dentro das regras do WhatsApp.',
    };
  }

  const categoriaMeta = CATEGORIAS[categoria || template.categoriaMeta || 'utilidade'] || 'UTILITY';
  const nomeMeta = slug(template.nome).replace(/-/g, '_').slice(0, 60);
  const resultados = [];

  for (const conexao of conexoes) {
    const { wabaId, token } = conexao.oficial || {};
    if (!wabaId || !token) {
      resultados.push({ conexao: conexao.nome, ok: false, erro: 'Conexao sem WABA ID ou token.' });
      continue;
    }
    try {
      const resposta = await fetch(`${GRAPH}/${wabaId}/message_templates`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: nomeMeta,
          language: 'pt_BR',
          category: categoriaMeta,
          components: [
            {
              type: 'BODY',
              text: template.conteudo.replace(/\{\{(\w+)\}\}/g, (todo, chave, indice) => todo),
            },
          ],
        }),
      });
      const dados = await resposta.json().catch(() => ({}));
      if (!resposta.ok) {
        resultados.push({ conexao: conexao.nome, ok: false, erro: dados?.error?.message || `HTTP ${resposta.status}` });
        continue;
      }
      resultados.push({ conexao: conexao.nome, ok: true, id: dados.id, situacao: dados.status || 'PENDING' });
    } catch (erro) {
      resultados.push({ conexao: conexao.nome, ok: false, erro: erro.message });
    }
  }

  const algumOk = resultados.some((r) => r.ok);
  atualizar('templates', template.id, {
    metaNome: nomeMeta,
    categoriaMeta: categoria || template.categoriaMeta,
    aprovacaoMeta: {
      solicitada: true,
      situacao: algumOk ? 'em_analise' : 'erro',
      solicitadaEm: agora(),
      resultados,
    },
  });

  return { ok: algumOk, resultados };
}

/** Reconsulta a situacao na Meta, usado quando aparece o erro 010102 ou 132015. */
export async function revalidarNaMeta({ workspaceId, template }) {
  const conexoes = listar('conexoes', { workspaceId }).filter((c) => c.tipo === 'oficial');
  if (!conexoes.length || !template.metaNome) {
    return { ok: false, erro: 'Template ainda nao foi enviado para aprovacao em nenhuma conexao oficial.' };
  }

  for (const conexao of conexoes) {
    const { wabaId, token } = conexao.oficial || {};
    if (!wabaId || !token) continue;
    try {
      const resposta = await fetch(
        `${GRAPH}/${wabaId}/message_templates?name=${encodeURIComponent(template.metaNome)}`,
        { headers: { Authorization: `Bearer ${token}` } },
      );
      const dados = await resposta.json().catch(() => ({}));
      const encontrado = dados?.data?.[0];
      if (encontrado) {
        const mapa = { APPROVED: 'aprovado', PENDING: 'em_analise', REJECTED: 'reprovado', PAUSED: 'pausado' };
        atualizar('templates', template.id, {
          aprovacaoMeta: {
            ...(template.aprovacaoMeta || {}),
            situacao: mapa[encontrado.status] || String(encontrado.status).toLowerCase(),
            motivo: encontrado.rejected_reason || null,
            revalidadoEm: agora(),
          },
        });
        return { ok: true, situacao: encontrado.status, motivo: encontrado.rejected_reason || null };
      }
    } catch (erro) {
      return { ok: false, erro: erro.message };
    }
  }
  return { ok: false, erro: 'Template nao encontrado na Meta.' };
}
