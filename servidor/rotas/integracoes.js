import crypto from 'node:crypto';
import { MODELOS } from '../config.js';
import { achar, atualizar, inserir, listar, remover } from '../nucleo/banco.js';
import { agora, novoId } from '../nucleo/util.js';
import { comCodigo, exigirConfiguracao } from './sessao.js';

function integracoesDo(workspaceId) {
  let registro = achar('integracoes', { workspaceId });
  if (!registro) {
    registro = inserir('integracoes', {
      id: novoId('int'),
      workspaceId,
      zapsign: { chave: '', modelos: [], ativo: false },
      googleCalendar: { conectado: false },
      advbox: { chave: '', ativo: false, descricoesStatus: {} },
      customTools: [],
      ia: { provedor: 'anthropic', chaveAnthropic: '', chaveOpenai: '' },
    });
  }
  return registro;
}

/**
 * Nunca devolve chave em claro para a tela.
 *
 * Os cabecalhos da chamada personalizada entram aqui junto com o resto: e neles
 * que mora o Authorization Bearer do n8n, do Make ou da rota interna do
 * escritorio. A tela nem desenha esse campo, mas a resposta o entregava inteiro
 * para qualquer perfil que abrisse a aba de rede do navegador.
 */
function mascararFerramentas(lista) {
  return (lista || []).map((ferramenta) => ({
    ...ferramenta,
    cabecalhos: (ferramenta.cabecalhos || []).map((cabecalho) => ({
      ...cabecalho,
      valor: cabecalho.valor ? '***' : '',
    })),
  }));
}

function mascarar(registro) {
  const mascara = (valor) => (valor ? '***' : '');
  return {
    ...registro,
    customTools: mascararFerramentas(registro.customTools),
    zapsign: { ...registro.zapsign, chave: mascara(registro.zapsign?.chave) },
    advbox: { ...registro.advbox, chave: mascara(registro.advbox?.chave) },
    googleCalendar: {
      ...registro.googleCalendar,
      credenciais: registro.googleCalendar?.credenciais
        ? { ...registro.googleCalendar.credenciais, clientSecret: '***', refreshToken: '***' }
        : null,
    },
    ia: {
      ...registro.ia,
      chaveAnthropic: mascara(registro.ia?.chaveAnthropic),
      chaveOpenai: mascara(registro.ia?.chaveOpenai),
    },
    metaConversoes: registro.metaConversoes
      ? { ...registro.metaConversoes, token: mascara(registro.metaConversoes.token) }
      : { ativo: false, pixelId: '', token: '', eventos: {} },
  };
}

/**
 * Regras do campo de segredo:
 *   valor novo  -> troca
 *   '' ou '***' -> mantem o que ja estava (a tela nunca recebe o valor real,
 *                  entao campo vazio significa "nao mexi nisso")
 *   null        -> apaga de proposito
 *
 * Sem o caso do null, uma chave errada ficaria presa para sempre: qualquer
 * tentativa de limpar o campo seria lida como "manter".
 */
function preservarSegredo(novo, atual) {
  if (novo === null) return '';
  return novo && novo !== '***' ? novo : atual || '';
}

/**
 * Mesma regra do preservarSegredo, aplicada aos cabecalhos da chamada
 * personalizada. Como eles voltam mascarados para a tela, um PATCH que
 * devolvesse a lista como veio apagaria o token de verdade.
 */
function preservarCabecalhos(novos, atuais) {
  if (!Array.isArray(novos)) return atuais || [];
  return novos.map((cabecalho) => {
    const anterior = (atuais || []).find((c) => c.chave === cabecalho.chave);
    return { ...cabecalho, valor: preservarSegredo(cabecalho.valor, anterior?.valor) };
  });
}

export function registrarIntegracoes(rotas) {
  rotas.get('/api/integracoes', async ({ ctx }) => mascarar(integracoesDo(ctx.workspaceId)));

  rotas.patch('/api/integracoes', async ({ ctx, corpo }) => {
    exigirConfiguracao(ctx);
    const atual = integracoesDo(ctx.workspaceId);
    const mudancas = {};

    if (corpo.zapsign) {
      mudancas.zapsign = {
        ...atual.zapsign,
        ...corpo.zapsign,
        chave: preservarSegredo(corpo.zapsign.chave, atual.zapsign?.chave),
      };
    }
    if (corpo.advbox) {
      mudancas.advbox = {
        ...atual.advbox,
        ...corpo.advbox,
        chave: preservarSegredo(corpo.advbox.chave, atual.advbox?.chave),
      };
    }
    if (corpo.googleCalendar) {
      const credenciaisAtuais = atual.googleCalendar?.credenciais || {};
      mudancas.googleCalendar = {
        ...atual.googleCalendar,
        ...corpo.googleCalendar,
        credenciais: corpo.googleCalendar.credenciais
          ? {
              ...credenciaisAtuais,
              ...corpo.googleCalendar.credenciais,
              clientSecret: preservarSegredo(corpo.googleCalendar.credenciais.clientSecret, credenciaisAtuais.clientSecret),
              refreshToken: preservarSegredo(corpo.googleCalendar.credenciais.refreshToken, credenciaisAtuais.refreshToken),
            }
          : credenciaisAtuais,
      };
    }
    if (corpo.ia) {
      mudancas.ia = {
        ...atual.ia,
        ...corpo.ia,
        chaveAnthropic: preservarSegredo(corpo.ia.chaveAnthropic, atual.ia?.chaveAnthropic),
        chaveOpenai: preservarSegredo(corpo.ia.chaveOpenai, atual.ia?.chaveOpenai),
      };
    }
    if (corpo.metaConversoes) {
      mudancas.metaConversoes = {
        ...atual.metaConversoes,
        ...corpo.metaConversoes,
        token: preservarSegredo(corpo.metaConversoes.token, atual.metaConversoes?.token),
      };
    }
    if (corpo.customTools) {
      mudancas.customTools = corpo.customTools.map((ferramenta) => {
        const anterior = (atual.customTools || []).find((f) => f.id === ferramenta.id);
        return { ...ferramenta, cabecalhos: preservarCabecalhos(ferramenta.cabecalhos, anterior?.cabecalhos) };
      });
    }

    return mascarar(atualizar('integracoes', atual.id, mudancas));
  });

  rotas.post('/api/integracoes/meta-conversoes/testar', async ({ ctx }) => {
    exigirConfiguracao(ctx);
    const { testarConexao } = await import('../integracoes/meta-conversoes.js');
    return testarConexao(ctx.workspaceId);
  });

  rotas.post('/api/integracoes/zapsign/sincronizar', async ({ ctx }) => {
    exigirConfiguracao(ctx);
    const { sincronizarModelos } = await import('../integracoes/zapsign.js');
    return sincronizarModelos(ctx.workspaceId);
  });

  /**
   * Teste de conexao com o modelo.
   *
   * Ele gasta a chave paga do escritorio, entao pede a mesma permissao das
   * outras rotas de integracao, aceita so modelo do catalogo (senao um laco de
   * fetch escolhia o modelo mais caro da lista) e lanca o custo em creditos,
   * para o gasto aparecer em Configuracoes > Consumo como qualquer outro.
   */
  rotas.post('/api/integracoes/ia/testar', async ({ ctx, corpo }) => {
    exigirConfiguracao(ctx);
    const { conversar, provedorDisponivel } = await import('../ia/provedores.js');
    const { lancar } = await import('../nucleo/creditos.js');

    const modeloId = corpo.modelo || 'claude-sonnet-5';
    const modelo = MODELOS.find((m) => m.id === modeloId);
    if (!modelo) throw comCodigo('Modelo desconhecido.', 400);
    if (!provedorDisponivel(modeloId, ctx.workspaceId)) {
      return { ok: false, erro: 'Nenhuma chave configurada para o provedor deste modelo.' };
    }
    try {
      const resposta = await conversar({
        modeloId,
        workspaceId: ctx.workspaceId,
        sistema: 'Responda em portugues do Brasil com exatamente a palavra: funcionando',
        mensagens: [{ papel: 'usuario', texto: 'teste de conexao' }],
      });
      lancar(ctx.workspaceId, null, 'teste-de-conexao', modelo.creditos, modelo.nome);
      return { ok: true, resposta: resposta.texto };
    } catch (erro) {
      return { ok: false, erro: erro.message };
    }
  });

  /* ---------------- Chamadas personalizadas ---------------- */

  rotas.post('/api/custom-tools', async ({ ctx, corpo }) => {
    exigirConfiguracao(ctx);
    const atual = integracoesDo(ctx.workspaceId);
    const ferramenta = {
      id: novoId('cst'),
      nome: corpo.nome,
      descricao: corpo.descricao || '',
      url: corpo.url,
      metodo: corpo.metodo || 'POST',
      cabecalhos: corpo.cabecalhos || [],
      schema: corpo.schema || null,
      criadoEm: agora(),
    };
    if (!ferramenta.nome || !ferramenta.url) throw comCodigo('Informe nome e URL da chamada.', 400);
    atualizar('integracoes', atual.id, { customTools: [...(atual.customTools || []), ferramenta] });
    return mascararFerramentas([ferramenta])[0];
  });

  rotas.patch('/api/custom-tools/:id', async ({ ctx, params, corpo }) => {
    exigirConfiguracao(ctx);
    const atual = integracoesDo(ctx.workspaceId);
    const lista = (atual.customTools || []).map((f) =>
      f.id === params.id
        ? { ...f, ...corpo, id: f.id, cabecalhos: preservarCabecalhos(corpo.cabecalhos, f.cabecalhos) }
        : f,
    );
    atualizar('integracoes', atual.id, { customTools: lista });
    const salva = lista.find((f) => f.id === params.id);
    return { ...salva, cabecalhos: mascararFerramentas([salva])[0].cabecalhos };
  });

  rotas.delete('/api/custom-tools/:id', async ({ ctx, params }) => {
    exigirConfiguracao(ctx);
    const atual = integracoesDo(ctx.workspaceId);
    atualizar('integracoes', atual.id, {
      customTools: (atual.customTools || []).filter((f) => f.id !== params.id),
    });
    return { ok: true };
  });

  /* ---------------- Contratos ---------------- */

  rotas.get('/api/contratos', async ({ ctx }) =>
    listar('contratos', { workspaceId: ctx.workspaceId })
      .sort((a, b) => String(b.criadoEm).localeCompare(String(a.criadoEm)))
      .map((contrato) => ({
        ...contrato,
        contato: achar('contatos', contrato.contatoId)?.nome || 'conversa removida',
      })),
  );

  rotas.post('/api/contratos/:id/assinado', async ({ ctx, params }) => {
    const contrato = achar('contratos', params.id);
    if (!contrato || contrato.workspaceId !== ctx.workspaceId) throw comCodigo('Contrato nao encontrado.', 404);
    const { confirmarAssinatura } = await import('../integracoes/zapsign.js');
    return confirmarAssinatura(params.id);
  });

  /* ---------------- Compromissos ---------------- */

  rotas.get('/api/compromissos', async ({ ctx }) =>
    listar('compromissos', { workspaceId: ctx.workspaceId })
      .sort((a, b) => a.quando.localeCompare(b.quando))
      .map((c) => ({ ...c, contato: achar('contatos', c.contatoId)?.nome || null })),
  );

  rotas.delete('/api/compromissos/:id', async ({ ctx, params }) => {
    const compromisso = achar('compromissos', params.id);
    if (!compromisso || compromisso.workspaceId !== ctx.workspaceId) throw comCodigo('Compromisso nao encontrado.', 404);
    atualizar('compromissos', params.id, { situacao: 'cancelado' });
    return { ok: true };
  });

  /* ---------------- Chaves da API publica ---------------- */

  rotas.get('/api/chaves-api', async ({ ctx }) => {
    exigirConfiguracao(ctx);
    return listar('chavesApi', { workspaceId: ctx.workspaceId }).map((c) => ({
      id: c.id,
      nome: c.nome,
      prefixo: c.prefixo,
      criadoEm: c.criadoEm,
      ultimoUso: c.ultimoUso || null,
    }));
  });

  rotas.post('/api/chaves-api', async ({ ctx, corpo }) => {
    exigirConfiguracao(ctx);
    const bruta = `chk_${crypto.randomBytes(24).toString('hex')}`;
    const registro = inserir('chavesApi', {
      id: novoId('chv'),
      workspaceId: ctx.workspaceId,
      nome: corpo.nome || 'Chave sem nome',
      prefixo: bruta.slice(0, 12),
      hash: crypto.createHash('sha256').update(bruta).digest('hex'),
      criadaPor: ctx.usuario.nome,
    });
    // A chave em claro aparece uma unica vez, aqui.
    return { ...registro, hash: undefined, chave: bruta };
  });

  rotas.delete('/api/chaves-api/:id', async ({ ctx, params }) => {
    exigirConfiguracao(ctx);
    const chave = achar('chavesApi', params.id);
    if (!chave || chave.workspaceId !== ctx.workspaceId) throw comCodigo('Chave nao encontrada.', 404);
    remover('chavesApi', params.id);
    return { ok: true };
  });

  /* ---------------- Onboarding ---------------- */

  rotas.get('/api/onboarding', async ({ ctx }) => {
    const workspace = achar('workspaces', ctx.workspaceId);
    const empresa = workspace?.empresa || {};
    const conexoes = listar('conexoes', { workspaceId: ctx.workspaceId });
    const agentes = listar('agentes', { workspaceId: ctx.workspaceId });
    const templates = listar('templates', { workspaceId: ctx.workspaceId });
    const integracoes = integracoesDo(ctx.workspaceId);
    const contatos = listar('contatos', { workspaceId: ctx.workspaceId });

    return {
      passos: [
        {
          id: 'empresa',
          titulo: 'Dados do escritorio',
          descricao: 'Nome, OAB, CNPJ e endereco. Campo em branco os agentes nao usam.',
          pronto: Boolean(empresa.nomeEscritorio && empresa.oab && empresa.endereco),
          link: '#/configuracoes/escritorio',
        },
        {
          id: 'conexao',
          titulo: 'Conectar o WhatsApp',
          descricao: 'Simulador para testar hoje, API oficial da Meta para producao.',
          pronto: conexoes.some((c) => c.estado === 'conectado'),
          link: '#/conexoes',
        },
        {
          id: 'agente',
          titulo: 'Criar e testar um agente',
          descricao: 'Use o simulador e o comando /restart para rodar o fluxo do inicio.',
          pronto: agentes.some((a) => a.ativo && (a.prompt || '').length > 200),
          link: '#/agentes',
        },
        {
          id: 'templates',
          titulo: 'Personalizar as mensagens prontas',
          descricao: 'Boas-vindas, proposta em video, tutorial de assinatura e follow-ups.',
          pronto: templates.some((t) => t.midia),
          link: '#/templates',
        },
        {
          id: 'followup',
          titulo: 'Montar as sequencias de follow-up',
          descricao: 'A sequencia fica dentro de cada status. Sem status, sem follow-up.',
          pronto: listar('status', { workspaceId: ctx.workspaceId }).some((s) => (s.followups || []).length),
          link: '#/configuracoes/status',
        },
        {
          id: 'contrato',
          titulo: 'Automatizar o contrato',
          descricao: 'Chave da ZapSign, modelo em DOCX com variaveis e regras de pos-assinatura.',
          pronto: Boolean(integracoes.zapsign?.chave),
          link: '#/integracoes',
        },
        {
          id: 'ia',
          titulo: 'Ligar o modelo de IA',
          descricao: 'Sem chave, os agentes rodam pelo roteiro por regras.',
          pronto: Boolean(integracoes.ia?.chaveAnthropic || integracoes.ia?.chaveOpenai),
          link: '#/integracoes',
        },
        {
          id: 'primeiro-lead',
          titulo: 'Atender o primeiro lead',
          descricao: 'Simule uma conversa ou espere a primeira mensagem real.',
          pronto: contatos.length > 0,
          link: '#/atendimento',
        },
      ],
    };
  });
}
