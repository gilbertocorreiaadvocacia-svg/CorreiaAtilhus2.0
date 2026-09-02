import { achar, atualizar, inserir, registrarLog } from '../nucleo/banco.js';
import { emitir } from '../nucleo/eventos.js';
import { agora, novoId } from '../nucleo/util.js';
import { enviarMensagem } from '../whatsapp/envio.js';
import { notificar } from '../ia/mencoes.js';

const BASE = 'https://api.zapsign.com.br/api/v1';

function configuracao(workspaceId) {
  const integracoes = achar('integracoes', { workspaceId });
  return integracoes?.zapsign || { chave: '', modelos: [], ativo: false };
}

/** Traz os modelos da conta para a tela de configuracao. */
export async function sincronizarModelos(workspaceId) {
  const cfg = configuracao(workspaceId);
  if (!cfg.chave) return { ok: false, erro: 'Chave de API da ZapSign nao configurada.' };

  const resposta = await fetch(`${BASE}/models/`, {
    headers: { Authorization: `Bearer ${cfg.chave}` },
  });

  if (resposta.status === 402) {
    return { ok: false, erro: 'Erro 402: o plano atual da ZapSign nao libera a API. E preciso um plano com API.' };
  }
  if (resposta.status === 403) {
    return { ok: false, erro: 'Erro 403: chave de API invalida.' };
  }
  if (!resposta.ok) {
    return { ok: false, erro: `A ZapSign respondeu ${resposta.status}.` };
  }

  const dados = await resposta.json().catch(() => []);
  const lista = Array.isArray(dados) ? dados : dados?.results || [];
  const modelos = lista.map((m) => ({
    id: String(m.token || m.id),
    nome: m.name || m.nome || 'Modelo sem nome',
    variaveis: (m.inputs || m.variables || []).map((v) => v.variable || v.name || v),
  }));

  const integracoes = achar('integracoes', { workspaceId });
  atualizar('integracoes', integracoes.id, {
    zapsign: { ...cfg, modelos, ativo: true, sincronizadoEm: agora() },
  });

  return { ok: true, modelos };
}

/**
 * Gera o contrato com os dados que o agente coletou e manda o link no WhatsApp.
 * Sem chave configurada, cria um contrato interno com link local, assim o
 * fluxo comercial pode ser testado de ponta a ponta antes de contratar a
 * assinatura eletronica.
 */
export async function gerarContrato({ contato, agente, conexao, dados }) {
  const workspaceId = contato.workspaceId;
  const cfg = configuracao(workspaceId);
  const variaveis = { ...(contato.variaveis || {}) };

  const valores = {
    nome: dados.nome_completo || contato.nome,
    nome_completo: dados.nome_completo || contato.nome,
    cpf: dados.cpf || variaveis.cpf || '',
    email: dados.email || variaveis.email || '',
    telefone: contato.telefone,
    endereco: variaveis.endereco || '',
    data: new Date().toLocaleDateString('pt-BR'),
  };

  const contrato = inserir('contratos', {
    id: novoId('ctr'),
    workspaceId,
    contatoId: contato.id,
    agenteId: agente?.id || null,
    valores,
    situacao: 'assinatura_pendente',
    provedor: cfg.chave ? 'zapsign' : 'interno',
  });

  let linkAssinatura = null;

  if (cfg.chave && cfg.modeloPadraoId) {
    try {
      const resposta = await fetch(`${BASE}/models/create-doc/`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${cfg.chave}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({
          template_id: cfg.modeloPadraoId,
          signer_name: valores.nome,
          signer_email: valores.email || undefined,
          signer_phone_country: '55',
          signer_phone_number: contato.telefone.replace(/^55/, ''),
          lang: 'pt-br',
          data: Object.entries(valores).map(([chave, valor]) => ({
            de: `{{${chave}}}`,
            para: String(valor ?? ''),
          })),
        }),
      });
      const corpo = await resposta.json().catch(() => ({}));
      if (!resposta.ok) {
        const erro =
          resposta.status === 402
            ? 'O plano da ZapSign nao libera a API (402).'
            : resposta.status === 403
              ? 'Chave de API da ZapSign invalida (403).'
              : corpo?.detail || `ZapSign respondeu ${resposta.status}`;
        atualizar('contratos', contrato.id, { situacao: 'erro', erro });
        return { ok: false, erro };
      }
      linkAssinatura = corpo?.signers?.[0]?.sign_url || corpo?.sign_url || null;
      atualizar('contratos', contrato.id, {
        tokenExterno: corpo?.token || null,
        link: linkAssinatura,
      });
    } catch (erro) {
      atualizar('contratos', contrato.id, { situacao: 'erro', erro: erro.message });
      return { ok: false, erro: erro.message };
    }
  } else {
    linkAssinatura = `/assinar/${contrato.id}`;
    atualizar('contratos', contrato.id, { link: linkAssinatura });
  }

  await enviarMensagem({
    contato,
    conexao,
    conteudo: `Pronto, ${valores.nome.split(' ')[0]}! Seu contrato ja esta disponivel para assinatura:\n\n${linkAssinatura}\n\nE so abrir, conferir os dados e assinar com o dedo. Leva menos de 2 minutos.`,
    autor: agente ? { tipo: 'agente', id: agente.id, nome: agente.nome } : { tipo: 'sistema', nome: 'Sistema' },
  });

  registrarLog(workspaceId, contato.id, 'contrato', `Contrato gerado (${contrato.provedor})`);
  emitir(workspaceId, 'contrato', { contatoId: contato.id, contratoId: contrato.id });

  return { ok: true, link: linkAssinatura, contrato_id: contrato.id };
}

/**
 * Pos-assinatura: aplica as regras configuradas, novo responsavel, novo
 * status, mensagem de sucesso e departamento de destino.
 */
export async function confirmarAssinatura(contratoId) {
  const contrato = achar('contratos', contratoId);
  if (!contrato) return { ok: false, erro: 'Contrato nao encontrado.' };
  if (contrato.situacao === 'assinado') return { ok: true, jaAssinado: true };

  const contato = achar('contatos', contrato.contatoId);
  if (!contato) return { ok: false, erro: 'Conversa do contrato nao encontrada.' };

  const cfg = configuracao(contrato.workspaceId);
  const posAssinatura = cfg.posAssinatura || {};

  atualizar('contratos', contratoId, { situacao: 'assinado', assinadoEm: agora() });

  if (posAssinatura.statusId) {
    const status = achar('status', posAssinatura.statusId);
    if (status) {
      const { aplicarStatus } = await import('../automacao/followup.js');
      await aplicarStatus(contato, status, { tipo: 'sistema', nome: 'ZapSign' });
    }
  }

  const mudancas = {};
  if (posAssinatura.responsavel) {
    mudancas.responsavel = posAssinatura.responsavel;
    mudancas.estado = posAssinatura.responsavel.tipo === 'agente' ? 'ia' : 'pendente';
  }
  if (posAssinatura.departamentoId) mudancas.departamentoId = posAssinatura.departamentoId;
  if (Object.keys(mudancas).length) atualizar('contatos', contato.id, mudancas);

  if (posAssinatura.templateId) {
    const template = achar('templates', posAssinatura.templateId);
    const conexao = achar('conexoes', contato.conexaoId);
    if (template) {
      const { aplicarVariaveis } = await import('../nucleo/util.js');
      await enviarMensagem({
        contato,
        conexao,
        conteudo: aplicarVariaveis(template.conteudo, { nome: contato.nome, ...(contato.variaveis || {}) }),
        midia: template.midia,
        templateId: template.id,
        autor: { tipo: 'sistema', nome: 'Sistema' },
      });
    }
  }

  registrarLog(contrato.workspaceId, contato.id, 'contrato', 'Contrato assinado');
  for (const membro of (await import('../nucleo/banco.js')).listar('membros', { workspaceId: contrato.workspaceId })) {
    notificar(contrato.workspaceId, membro.id, 'contrato', 'Contrato assinado', `${contato.nome} assinou o contrato.`, contato.id);
  }
  emitir(contrato.workspaceId, 'contrato', { contatoId: contato.id, contratoId, situacao: 'assinado' });

  return { ok: true };
}
