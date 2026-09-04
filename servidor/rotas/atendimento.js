import fs from 'node:fs';
import path from 'node:path';
import { PASTA_ARQUIVOS } from '../config.js';
import {
  achar,
  apagarMensagens,
  atualizar,
  atualizarMensagem,
  inserir,
  inserirMensagem,
  listar,
  logsDe,
  mensagensDe,
  moverMensagens,
  registrarLog,
  remover,
  removerOnde,
} from '../nucleo/banco.js';
import { aplicarModoFoco, ehAdministrador, filtrarConversasVisiveis, podeVerConversa } from '../nucleo/auth.js';
import { emitir } from '../nucleo/eventos.js';
import { agora, aplicarVariaveis, garantirPasta, normalizar, normalizarTelefone, novoId, ordenarPor } from '../nucleo/util.js';
import { enviarMensagem, janelaAberta } from '../whatsapp/envio.js';
import { acharOuCriarContato } from '../whatsapp/recebimento.js';
import { agendarFollowupsDoStatus, aplicarStatus, cancelarFollowups, limparAgendamentosDoContato, reagendarFollowups } from '../automacao/followup.js';
import { proximoHorarioValido, horarioComercialDe } from '../automacao/horario.js';
import { apagarMidia, guardarBase64 } from '../nucleo/midia.js';
import { cancelarResposta } from '../ia/motor.js';
import { inserirNota, notificar } from '../ia/mencoes.js';
import { removerTarefasDoContato } from './tarefas.js';
import { comCodigo } from './sessao.js';

function conversaOu404(ctx, id) {
  const contato = achar('contatos', id);
  if (!contato || contato.workspaceId !== ctx.workspaceId) throw comCodigo('Conversa nao encontrada.', 404);
  if (!podeVerConversa(ctx, contato)) throw comCodigo('Voce nao tem acesso a esta conversa.', 403);
  return contato;
}

function enriquecer(contato) {
  const status = contato.statusId ? achar('status', contato.statusId) : null;
  const departamento = contato.departamentoId ? achar('departamentos', contato.departamentoId) : null;
  const origem = contato.origemId ? achar('origens', contato.origemId) : null;
  return {
    ...contato,
    status: status ? { id: status.id, nome: status.nome, cor: status.cor, tipo: status.tipo } : null,
    departamento: departamento ? { id: departamento.id, nome: departamento.nome, cor: departamento.cor } : null,
    origem: origem ? { id: origem.id, nome: origem.nome } : null,
    janelaAberta: janelaAberta(contato),
    /*
     * Quanto ja se conversou com esta pessoa.
     *
     * Sai de mensagensDe(), que guarda o resultado em memoria — entao a conta
     * custa a primeira leitura de cada conversa e nada nas seguintes. E
     * enriquecer() so roda no lote que cabe no limite da resposta, nunca na
     * base inteira, entao o custo tem teto.
     *
     * O numero nao fica gravado no contato de proposito: para isso ele teria
     * de ser mantido no caminho de gravacao da mensagem, que e o caminho mais
     * critico do sistema. Errar um contador na tela e um numero errado; errar
     * naquele caminho e mensagem de cliente perdida. Se um dia a base crescer
     * a ponto de a primeira leitura pesar, o lugar certo de resolver e um
     * contador mantido por inserirMensagem, com backfill preguicoso.
     */
    totalMensagens: mensagensDe(contato.id).length,
  };
}

/** Aba de atendimento a que a conversa pertence. */
function abaDe(contato) {
  if (contato.estado === 'arquivado') return 'arquivados';
  if (contato.grupo) return 'grupos';
  if (contato.responsavel?.tipo === 'agente') return 'ia';
  if (contato.aceitoPor) return 'ativos';
  return 'pendentes';
}

export function registrarAtendimento(rotas) {
  /* ---------------- Listagem ---------------- */

  rotas.get('/api/contatos', async ({ ctx, query }) => {
    let contatos = listar('contatos', { workspaceId: ctx.workspaceId });
    contatos = filtrarConversasVisiveis(ctx, contatos);
    contatos = aplicarModoFoco(ctx, contatos);

    if (query.comMensagem === 'true') {
      contatos = contatos.filter((c) => c.ultimaMensagemEm);
    }
    if (query.status) contatos = contatos.filter((c) => c.statusId === query.status);
    if (query.departamento) {
      contatos = contatos.filter((c) =>
        query.departamento === 'sem-departamento' ? !c.departamentoId : c.departamentoId === query.departamento,
      );
    }
    if (query.conexao) contatos = contatos.filter((c) => c.conexaoId === query.conexao);
    if (query.origem) contatos = contatos.filter((c) => c.origemId === query.origem);
    if (query.etiqueta) contatos = contatos.filter((c) => (c.etiquetas || []).includes(query.etiqueta));
    if (query.responsavel) {
      contatos = contatos.filter((c) =>
        query.responsavel === 'nenhum' ? !c.responsavel : c.responsavel?.id === query.responsavel,
      );
    }
    if (query.busca) {
      const alvo = normalizar(query.busca);
      /*
       * So compara telefone quando o termo tem digito.
       *
       * Sem esta guarda, procurar por nome tirava todos os digitos do termo e
       * sobrava string vazia. String(telefone).includes(vazio) e sempre
       * verdadeiro, entao a busca por nome devolvia a lista inteira e parecia
       * que o filtro nao funcionava.
       */
      const digitos = alvo.replace(/\D+/g, '');
      contatos = contatos.filter(
        (c) =>
          normalizar(c.nome).includes(alvo) ||
          (digitos !== '' && String(c.telefone).includes(digitos)),
      );
    }

    /*
     * O contador de cada aba conta o que a aba VAI MOSTRAR.
     *
     * Ate aqui ele saia de uma varredura propria do workspace inteiro, cega a
     * busca, etiqueta, status e modo foco. Na tela isso virava aba escrita
     * "12" abrindo com 3 linhas — e o numero errado e pior do que numero
     * nenhum, porque quem confere fila decide por ele: um "0" em Pendentes
     * durante uma busca dizia que nao havia ninguem esperando.
     *
     * Por isso a aba e o ultimo filtro a entrar: tudo o mais ja foi aplicado
     * aqui em cima, e a contagem sai desta lista, nao de outra.
     */
    const contagens = { ia: 0, ativos: 0, pendentes: 0, grupos: 0, arquivados: 0, naoLidas: 0 };
    for (const contato of contatos) {
      contagens[abaDe(contato)] += 1;
      contagens.naoLidas += contato.naoLidas || 0;
    }

    if (query.aba && query.aba !== 'todas') {
      contatos = contatos.filter((c) => abaDe(c) === query.aba);
    }

    const total = contatos.length;

    // Contagem por status sobre o filtro inteiro, antes do corte do limite. O
    // kanban desenha so o lote que coube na resposta: sem este numero, a coluna
    // "Contrato assinado" com 900 conversas antigas mostrava o selo 3, que e
    // quantas entraram no lote, e o socio lia isso como tres contratos.
    const porStatus = {};
    for (const contato of contatos) {
      const chave = contato.statusId || '';
      porStatus[chave] = (porStatus[chave] || 0) + 1;
    }

    const ordenados = ordenarPor(contatos, 'ultimaMensagemEm', 'desc');
    const limite = Number(query.limite || 200);
    return {
      total,
      porStatus,
      contatos: ordenados.slice(0, limite).map(enriquecer),
      contagens,
    };
  });

  rotas.get('/api/contatos/:id', async ({ ctx, params }) => enriquecer(conversaOu404(ctx, params.id)));

  rotas.get('/api/contatos/:id/mensagens', async ({ ctx, params, query }) => {
    const contato = conversaOu404(ctx, params.id);
    const todas = mensagensDe(contato.id);
    const limite = Number(query.limite || 300);
    return {
      mensagens: todas.slice(-limite),
      total: todas.length,
    };
  });

  rotas.get('/api/contatos/:id/logs', async ({ ctx, params }) => {
    const contato = conversaOu404(ctx, params.id);
    return logsDe(contato.id);
  });

  /* ---------------- Envio ---------------- */

  rotas.post('/api/contatos/:id/mensagens', async ({ ctx, params, corpo }) => {
    const contato = conversaOu404(ctx, params.id);
    const conexao = achar('conexoes', contato.conexaoId);
    const autor = { tipo: 'membro', id: ctx.membro?.id, nome: ctx.usuario.nome };

    if (corpo.nota) {
      const mensagem = inserirNota(contato, corpo.conteudo, autor, corpo.mencoes || []);
      // Quem e mencionado ganha acesso a conversa por 24 horas.
      const recentes = [...(contato.mencoesRecentes || [])];
      for (const membroId of corpo.mencoes || []) {
        recentes.push({ membroId, em: agora() });
        notificar(ctx.workspaceId, membroId, 'mencao', 'Voce foi mencionado', `${ctx.usuario.nome} citou voce em ${contato.nome}.`, contato.id);
      }
      if (recentes.length) atualizar('contatos', contato.id, { mencoesRecentes: recentes.slice(-30) });
      emitir(ctx.workspaceId, 'mensagem', { contatoId: contato.id, mensagem });
      return mensagem;
    }

    let conteudo = corpo.conteudo || '';
    let midia = corpo.midia || null;

    if (corpo.templateId) {
      const template = achar('templates', corpo.templateId);
      if (!template) throw comCodigo('Template nao encontrado.', 404);
      conteudo = aplicarVariaveis(template.conteudo, { nome: contato.nome, ...(contato.variaveis || {}) });
      midia = template.midia || null;
    }

    if (ctx.membro?.assinaturaAtiva && conteudo) {
      conteudo = `${conteudo}\n\n_${ctx.usuario.nome}_`;
    }

    if (corpo.agendarPara) {
      const quando = new Date(corpo.agendarPara);
      if (Number.isNaN(quando.getTime())) throw comCodigo('Data de agendamento invalida.', 400);
      const agendamento = inserir('agendamentos', {
        id: novoId('agd'),
        workspaceId: ctx.workspaceId,
        contatoId: contato.id,
        conexaoId: contato.conexaoId,
        tipo: 'manual',
        conteudo,
        midia,
        templateId: corpo.templateId || null,
        quando: quando.toISOString(),
        previstoPara: quando.toISOString(),
        estado: 'pendente',
        criadoPor: autor,
      });
      registrarLog(ctx.workspaceId, contato.id, 'agendamento', `Mensagem agendada para ${quando.toLocaleString('pt-BR')}`, autor);
      emitir(ctx.workspaceId, 'agendamento', { contatoId: contato.id });
      return agendamento;
    }

    // Intervencao pontual manda a mensagem sem assumir a conversa.
    if (corpo.assumir) {
      atualizar('contatos', contato.id, {
        responsavel: { tipo: 'membro', id: ctx.membro.id, nome: ctx.usuario.nome },
        aceitoPor: ctx.membro.id,
        estado: 'ativo',
      });
      cancelarResposta(contato.id);
      registrarLog(ctx.workspaceId, contato.id, 'intervencao', `${ctx.usuario.nome} assumiu a conversa`, autor);
    }

    const mensagem = await enviarMensagem({
      contato: achar('contatos', contato.id),
      conexao: corpo.conexaoId ? achar('conexoes', corpo.conexaoId) : conexao,
      tipo: midia ? midia.tipo : 'texto',
      conteudo,
      midia,
      templateId: corpo.templateId || null,
      autor,
    });
    return mensagem;
  });

  /* ---------------- Propriedades ---------------- */

  rotas.patch('/api/contatos/:id', async ({ ctx, params, corpo }) => {
    const contato = conversaOu404(ctx, params.id);
    const autor = { tipo: 'membro', id: ctx.membro?.id, nome: ctx.usuario.nome };
    const mudancas = {};

    if (corpo.nome !== undefined) mudancas.nome = corpo.nome;
    if (corpo.foto !== undefined) mudancas.foto = corpo.foto;
    if (corpo.etiquetas !== undefined) mudancas.etiquetas = corpo.etiquetas;
    if (corpo.origemId !== undefined) mudancas.origemId = corpo.origemId || null;
    if (corpo.variaveis !== undefined) mudancas.variaveis = corpo.variaveis;
    if (corpo.modoAudio !== undefined) mudancas.modoAudio = Boolean(corpo.modoAudio);
    if (corpo.conexaoId !== undefined) mudancas.conexaoId = corpo.conexaoId;

    if (corpo.departamentoId !== undefined) {
      mudancas.departamentoId = corpo.departamentoId || null;
      registrarLog(ctx.workspaceId, contato.id, 'departamento', 'Departamento alterado manualmente', autor);
    }

    if (corpo.responsavel !== undefined) {
      const responsavel = corpo.responsavel;
      mudancas.responsavel = responsavel;
      if (!responsavel) {
        mudancas.estado = 'pendente';
        mudancas.aceitoPor = null;
        cancelarResposta(contato.id);
      } else if (responsavel.tipo === 'agente') {
        const agente = achar('agentes', responsavel.id);
        mudancas.responsavel = { tipo: 'agente', id: responsavel.id, nome: agente?.nome || 'Agente' };
        mudancas.estado = 'ia';
        mudancas.aceitoPor = null;
      } else {
        const membro = achar('membros', responsavel.id);
        const usuario = membro ? achar('usuarios', membro.usuarioId) : null;
        mudancas.responsavel = { tipo: 'membro', id: responsavel.id, nome: usuario?.nome || 'Membro' };
        mudancas.estado = responsavel.id === ctx.membro?.id ? 'ativo' : 'pendente';
        mudancas.aceitoPor = responsavel.id === ctx.membro?.id ? ctx.membro.id : null;
        cancelarResposta(contato.id);
        if (responsavel.id !== ctx.membro?.id) {
          notificar(ctx.workspaceId, responsavel.id, 'atribuicao', 'Conversa atribuida a voce', `${contato.nome} foi transferido para voce.`, contato.id);
        }
      }
      registrarLog(ctx.workspaceId, contato.id, 'responsavel', `Responsavel: ${mudancas.responsavel?.nome || 'nenhum'}`, autor);
    }

    Object.assign(contato, mudancas);
    atualizar('contatos', contato.id, mudancas);

    // Status por ultimo: ele arrasta o departamento e dispara o follow-up.
    if (corpo.statusId !== undefined && corpo.statusId !== contato.statusId) {
      const status = achar('status', corpo.statusId);
      if (!status) throw comCodigo('Status nao encontrado.', 404);
      await aplicarStatus(contato, status, autor);
    }

    emitir(ctx.workspaceId, 'contato', { contatoId: contato.id });
    return enriquecer(achar('contatos', contato.id));
  });

  /* ---------------- Acoes da conversa ---------------- */

  rotas.post('/api/contatos/:id/aceitar', async ({ ctx, params }) => {
    const contato = conversaOu404(ctx, params.id);
    atualizar('contatos', contato.id, {
      aceitoPor: ctx.membro.id,
      estado: 'ativo',
      responsavel: { tipo: 'membro', id: ctx.membro.id, nome: ctx.usuario.nome },
    });
    cancelarResposta(contato.id);
    registrarLog(ctx.workspaceId, contato.id, 'aceite', `${ctx.usuario.nome} aceitou o atendimento`);
    emitir(ctx.workspaceId, 'contato', { contatoId: contato.id });
    return enriquecer(achar('contatos', contato.id));
  });

  rotas.post('/api/contatos/:id/arquivar', async ({ ctx, params, corpo }) => {
    const contato = conversaOu404(ctx, params.id);
    const arquivar = corpo.arquivar !== false;
    atualizar('contatos', contato.id, {
      estado: arquivar ? 'arquivado' : contato.responsavel?.tipo === 'agente' ? 'ia' : 'pendente',
    });
    /* O tipo do registro continua 'arquivo' porque e ele que o historico usa
       para escolher o icone, e ha registros antigos gravados assim. O que muda
       e a frase que a pessoa le. */
    registrarLog(ctx.workspaceId, contato.id, 'arquivo', arquivar ? 'Atendimento concluido' : 'Conversa reaberta');
    emitir(ctx.workspaceId, 'contato', { contatoId: contato.id });
    return enriquecer(achar('contatos', contato.id));
  });

  rotas.post('/api/contatos/:id/ler', async ({ ctx, params }) => {
    const contato = conversaOu404(ctx, params.id);
    atualizar('contatos', contato.id, { naoLidas: 0 });
    emitir(ctx.workspaceId, 'contato', { contatoId: contato.id });
    return { ok: true };
  });

  rotas.post('/api/contatos/:id/resumo', async ({ ctx, params, corpo }) => {
    const contato = conversaOu404(ctx, params.id);
    let mensagens = mensagensDe(contato.id).filter((m) => !m.nota);
    if (corpo.de) mensagens = mensagens.filter((m) => m.criadoEm >= corpo.de);
    if (corpo.ate) mensagens = mensagens.filter((m) => m.criadoEm <= corpo.ate);
    if (!mensagens.length) throw comCodigo('Nao ha mensagens no periodo escolhido.', 400);

    const { resumirConversa } = await import('../ia/resumo.js');
    const texto = await resumirConversa({
      workspaceId: ctx.workspaceId,
      contato,
      mensagens,
      instrucao: corpo.instrucao || null,
      detalhado: corpo.modo === 'detalhado',
    });
    const nota = inserirNota(contato, texto, { tipo: 'sistema', nome: 'Resumo' });
    emitir(ctx.workspaceId, 'mensagem', { contatoId: contato.id, mensagem: nota });
    return nota;
  });

  rotas.post('/api/contatos/:id/unificar', async ({ ctx, params, corpo }) => {
    const origem = conversaOu404(ctx, params.id);
    const destino = conversaOu404(ctx, corpo.destinoId);
    if (origem.id === destino.id) throw comCodigo('Escolha duas conversas diferentes.', 400);

    const movidas = moverMensagens(origem.id, destino.id);
    const variaveis = { ...(destino.variaveis || {}), ...(origem.variaveis || {}) };
    const etiquetas = [...new Set([...(destino.etiquetas || []), ...(origem.etiquetas || [])])];
    atualizar('contatos', destino.id, {
      variaveis,
      etiquetas,
      ultimaMensagemEm: agora(),
    });
    limparAgendamentosDoContato(origem.id);
    apagarMensagens(origem.id);
    remover('contatos', origem.id);
    registrarLog(ctx.workspaceId, destino.id, 'unificacao', `${movidas} mensagens migradas de ${origem.nome}`);
    emitir(ctx.workspaceId, 'contato', { contatoId: destino.id });
    return { ok: true, movidas };
  });

  /**
   * Marca e desmarca a estrela de uma mensagem.
   *
   * A conversa de um caso previdenciario passa de cem mensagens, e o dado que
   * decide o caso (o numero do beneficio, a data da DER, a foto do laudo) fica
   * perdido entre "bom dia" e "ja te respondo". A estrela e o unico jeito de
   * marcar isso sem tirar da conversa.
   *
   * Alterna em vez de so ligar: quem marcou por engano precisa desmarcar, e um
   * segundo endpoint para isso seria a mesma regra escrita duas vezes.
   */
  rotas.post('/api/contatos/:id/mensagens/:mensagemId/favorita', async ({ ctx, params }) => {
    const contato = conversaOu404(ctx, params.id);
    const mensagem = mensagensDe(contato.id).find((m) => m.id === params.mensagemId);
    if (!mensagem) throw comCodigo('Mensagem nao encontrada.', 404);

    const favorita = !mensagem.favorita;
    atualizarMensagem(contato.id, mensagem.id, {
      favorita,
      /* Quem marcou e quando, para a lista de favoritos poder dizer de quem foi
         a marcacao quando duas pessoas atendem a mesma conversa. */
      favoritaPor: favorita ? { nome: ctx.usuario.nome, em: agora() } : null,
    });

    emitir(ctx.workspaceId, 'mensagem', { contatoId: contato.id, mensagemId: mensagem.id });
    return { ok: true, favorita };
  });

  rotas.post('/api/contatos/:id/restart', async ({ ctx, params }) => {
    const contato = conversaOu404(ctx, params.id);
    const conexao = achar('conexoes', contato.conexaoId);
    const { receberMensagem } = await import('../whatsapp/recebimento.js');
    await receberMensagem({
      workspaceId: ctx.workspaceId,
      conexao,
      telefone: contato.telefone,
      conteudo: '/restart',
    });
    return enriquecer(achar('contatos', contato.id));
  });

  /* ---------------- Criacao manual ---------------- */

  rotas.post('/api/contatos', async ({ ctx, corpo }) => {
    const conexao = achar('conexoes', corpo.conexaoId) || listar('conexoes', { workspaceId: ctx.workspaceId })[0];
    if (!conexao) throw comCodigo('Cadastre uma conexao de WhatsApp antes.', 400);
    const { contato, novo } = acharOuCriarContato({
      workspaceId: ctx.workspaceId,
      conexao,
      telefone: corpo.telefone,
      nome: corpo.nome,
    });
    if (!novo) return enriquecer(contato);
    if (corpo.statusId) {
      const status = achar('status', corpo.statusId);
      if (status) await aplicarStatus(contato, status, { tipo: 'membro', nome: ctx.usuario.nome }, { dispararFollowups: false });
    }
    emitir(ctx.workspaceId, 'contato', { contatoId: contato.id });
    return enriquecer(achar('contatos', contato.id));
  });

  /* ---------------- Acoes em massa ---------------- */

  rotas.post('/api/contatos/acoes-em-massa', async ({ ctx, corpo }) => {
    const ids = corpo.ids || [];
    const alvos = ids.map((id) => achar('contatos', id)).filter((c) => c && podeVerConversa(ctx, c));
    let afetados = 0;

    for (const contato of alvos) {
      switch (corpo.acao) {
        case 'status': {
          const status = achar('status', corpo.valor);
          if (!status) break;
          // Acao em massa nao dispara follow-up: e a trava contra disparo em lote.
          await aplicarStatus(contato, status, { tipo: 'membro', nome: ctx.usuario.nome }, { dispararFollowups: false });
          afetados += 1;
          break;
        }
        case 'departamento':
          atualizar('contatos', contato.id, { departamentoId: corpo.valor || null });
          afetados += 1;
          break;
        case 'responsavel': {
          if (!corpo.valor) {
            atualizar('contatos', contato.id, { responsavel: null, estado: 'pendente', aceitoPor: null });
          } else {
            const [tipo, id] = String(corpo.valor).split(':');
            const nome =
              tipo === 'agente'
                ? achar('agentes', id)?.nome
                : achar('usuarios', achar('membros', id)?.usuarioId)?.nome;
            atualizar('contatos', contato.id, {
              responsavel: { tipo, id, nome: nome || 'Responsavel' },
              estado: tipo === 'agente' ? 'ia' : 'pendente',
              aceitoPor: null,
            });
          }
          afetados += 1;
          break;
        }
        case 'etiquetas-adicionar': {
          const etiquetas = new Set(contato.etiquetas || []);
          for (const etiqueta of corpo.valor || []) etiquetas.add(etiqueta);
          atualizar('contatos', contato.id, { etiquetas: [...etiquetas] });
          afetados += 1;
          break;
        }
        case 'etiquetas-remover': {
          const remocao = new Set(corpo.valor || []);
          atualizar('contatos', contato.id, {
            etiquetas: (contato.etiquetas || []).filter((e) => !remocao.has(e)),
          });
          afetados += 1;
          break;
        }
        case 'etiquetas-definir':
          atualizar('contatos', contato.id, { etiquetas: corpo.valor || [] });
          afetados += 1;
          break;
        case 'arquivar':
          atualizar('contatos', contato.id, { estado: 'arquivado' });
          afetados += 1;
          break;
        case 'conexao':
          atualizar('contatos', contato.id, { conexaoId: corpo.valor });
          afetados += 1;
          break;
        default:
          break;
      }
    }

    registrarLog(ctx.workspaceId, null, 'massa', `Acao em massa "${corpo.acao}" em ${afetados} conversas`, {
      tipo: 'membro',
      nome: ctx.usuario.nome,
    });
    emitir(ctx.workspaceId, 'contatos', {});
    return { ok: true, afetados };
  });

  /**
   * Exclusao definitiva da conversa. Existe por causa da LGPD: quando o titular
   * pede a eliminacao dos dados dele, arquivar nao basta. Leva junto mensagens,
   * arquivos, agendamentos, registros de consumo e o historico, nao adianta
   * apagar a conversa e deixar rastro espalhado pelo resto do sistema.
   */
  rotas.delete('/api/contatos/:id', async ({ ctx, params }) => {
    if (!ehAdministrador(ctx)) throw comCodigo('Somente administrador pode excluir uma conversa.', 403);
    const contato = conversaOu404(ctx, params.id);

    cancelarResposta(contato.id);
    limparAgendamentosDoContato(contato.id);

    for (const arquivo of contato.arquivos || []) {
      try {
        fs.unlinkSync(path.join(PASTA_ARQUIVOS, arquivo.caminho));
      } catch {
        /* arquivo ja nao estava la */
      }
    }
    for (const mensagem of mensagensDe(contato.id)) {
      if (mensagem.midia?.url) apagarMidia(mensagem.midia.url);
    }

    apagarMensagens(contato.id);
    removerOnde('logs', { contatoId: contato.id });
    removerOnde('creditos', { contatoId: contato.id });
    removerOnde('compromissos', { contatoId: contato.id });
    removerOnde('contratos', { contatoId: contato.id });
    removerOnde('notificacoes', { contatoId: contato.id });
    removerTarefasDoContato(contato.id);
    remover('contatos', contato.id);

    registrarLog(ctx.workspaceId, null, 'exclusao', `Conversa de ${contato.nome} (${contato.telefone}) excluida definitivamente`, {
      tipo: 'membro',
      nome: ctx.usuario.nome,
    });
    emitir(ctx.workspaceId, 'contatos', {});
    return { ok: true };
  });

  /* ---------------- Upload de midia ---------------- */

  /**
   * Recebe o arquivo da tela e devolve a referencia para usar em template,
   * mensagem ou voz. Vale para os videos de proposta, que sao o material que
   * mais muda a conversao.
   */
  rotas.post('/api/midia', async ({ corpo }) => {
    if (!corpo.conteudoBase64) throw comCodigo('Envie o arquivo.', 400);
    return guardarBase64({
      nome: corpo.nome || 'arquivo',
      conteudoBase64: corpo.conteudoBase64,
      mime: corpo.mime,
    });
  });

  /* ---------------- Nuvem da conversa ---------------- */

  rotas.post('/api/contatos/:id/arquivos', async ({ ctx, params, corpo }) => {
    const contato = conversaOu404(ctx, params.id);
    if (!corpo.conteudoBase64 || !corpo.nome) throw comCodigo('Envie nome e conteudo do arquivo.', 400);

    const pasta = path.join(PASTA_ARQUIVOS, contato.id);
    garantirPasta(pasta);
    const nomeSeguro = `${novoId('arq')}-${String(corpo.nome).replace(/[^\w.-]+/g, '_')}`;
    const dados = Buffer.from(String(corpo.conteudoBase64).split(',').pop(), 'base64');
    fs.writeFileSync(path.join(pasta, nomeSeguro), dados);

    const arquivo = {
      id: novoId('arq'),
      nome: corpo.nome,
      caminho: `${contato.id}/${nomeSeguro}`,
      tamanho: dados.length,
      tipo: corpo.tipo || 'documento',
      enviadoPor: ctx.usuario.nome,
      criadoEm: agora(),
    };
    const arquivos = [...(contato.arquivos || []), arquivo];
    atualizar('contatos', contato.id, { arquivos });
    registrarLog(ctx.workspaceId, contato.id, 'arquivo', `Arquivo guardado: ${corpo.nome}`);
    return arquivo;
  });

  rotas.delete('/api/contatos/:id/arquivos/:arquivoId', async ({ ctx, params }) => {
    const contato = conversaOu404(ctx, params.id);
    const arquivos = (contato.arquivos || []).filter((a) => a.id !== params.arquivoId);
    atualizar('contatos', contato.id, { arquivos });
    return { ok: true };
  });

  /* ---------------- Migracao ---------------- */

  rotas.get('/api/contatos-exportar', async ({ ctx }) => {
    const contatos = filtrarConversasVisiveis(ctx, listar('contatos', { workspaceId: ctx.workspaceId }));
    const linhas = [
      'nome;telefone;status;departamento;etiquetas;origem;responsavel;criado_em',
      ...contatos.map((c) =>
        [
          (c.nome || '').replace(/;/g, ','),
          c.telefone,
          achar('status', c.statusId)?.nome || '',
          achar('departamentos', c.departamentoId)?.nome || '',
          (c.etiquetas || []).map((e) => achar('etiquetas', e)?.nome).filter(Boolean).join('|'),
          achar('origens', c.origemId)?.nome || '',
          c.responsavel?.nome || '',
          c.criadoEm,
        ].join(';'),
      ),
    ];
    return { csv: linhas.join('\n'), total: contatos.length };
  });

  /**
   * Exporta o historico das conversas em texto.
   *
   * Serve para treinar agente: a receita e pegar dez atendimentos exemplares -
   * lead qualificado direito, objecao contornada, contrato fechado, e usar
   * como referencia na criacao do prompt. Conversa a conversa isso levaria uma
   * tarde; aqui sai de uma vez, filtrado por status.
   */
  rotas.post('/api/historico-exportar', async ({ ctx, corpo }) => {
    let contatos = filtrarConversasVisiveis(ctx, listar('contatos', { workspaceId: ctx.workspaceId }));

    if (corpo.statusIds?.length) contatos = contatos.filter((c) => corpo.statusIds.includes(c.statusId));
    if (corpo.contatoIds?.length) contatos = contatos.filter((c) => corpo.contatoIds.includes(c.id));
    if (corpo.de) contatos = contatos.filter((c) => (c.ultimaMensagemEm || c.criadoEm) >= corpo.de);
    if (corpo.ate) contatos = contatos.filter((c) => (c.ultimaMensagemEm || c.criadoEm) <= `${corpo.ate}T23:59:59.999Z`);

    contatos = contatos.filter((c) => mensagensDe(c.id).some((m) => !m.nota));
    const limite = Math.min(Number(corpo.limite) || 30, 200);
    contatos = ordenarPor(contatos, 'ultimaMensagemEm', 'desc').slice(0, limite);

    const anonimo = corpo.anonimizar !== false;
    const blocos = [];

    for (const [indice, contato] of contatos.entries()) {
      const mensagens = mensagensDe(contato.id).filter((m) => !m.nota && (m.conteudo || '').trim());
      if (!mensagens.length) continue;

      const status = contato.statusId ? achar('status', contato.statusId)?.nome : 'sem status';
      // Anonimizado por padrao: o material vira insumo de prompt e nao precisa
      // levar nome e telefone de cliente junto.
      const identificacao = anonimo
        ? `LEAD ${indice + 1}`
        : `${contato.nome} (${contato.telefone})`;

      const linhas = [
        `===== CONVERSA ${indice + 1} =====`,
        `Identificacao: ${identificacao}`,
        `Desfecho: ${status}`,
        `Origem: ${contato.origemId ? achar('origens', contato.origemId)?.nome || '-' : '-'}`,
        '',
      ];

      for (const mensagem of mensagens) {
        const quem =
          mensagem.direcao === 'entrada'
            ? 'LEAD'
            : mensagem.autor?.tipo === 'agente'
              ? `IA (${mensagem.autor.nome})`
              : mensagem.autor?.nome || 'ESCRITORIO';
        linhas.push(`[${new Date(mensagem.criadoEm).toLocaleString('pt-BR')}] ${quem}: ${mensagem.conteudo}`);
      }

      blocos.push(linhas.join('\n'));
    }

    return {
      total: blocos.length,
      anonimizado: anonimo,
      texto: blocos.join('\n\n\n') || 'Nenhuma conversa com mensagens no filtro escolhido.',
    };
  });

  rotas.post('/api/contatos-importar', async ({ ctx, corpo }) => {
    const conexao = achar('conexoes', corpo.conexaoId);
    if (!conexao) throw comCodigo('Escolha o WhatsApp que vai ficar com estes contatos.', 400);

    const linhas = String(corpo.csv || '').split(/\r?\n/).filter((l) => l.trim());
    if (linhas.length < 2) throw comCodigo('A planilha precisa de cabecalho e ao menos uma linha.', 400);

    const separador = linhas[0].includes(';') ? ';' : ',';
    const cabecalho = linhas[0].split(separador).map((c) => normalizar(c));
    const indice = (nome) => cabecalho.indexOf(nome);

    const resultados = { importados: 0, ignorados: [], atualizados: 0 };

    for (const linha of linhas.slice(1)) {
      const colunas = linha.split(separador);
      const telefone = normalizarTelefone(colunas[indice('telefone')] || '');
      const nome = (colunas[indice('nome')] || '').trim();

      if (!telefone || telefone.length < 12) {
        resultados.ignorados.push({ linha, motivo: 'telefone invalido' });
        continue;
      }

      const { contato, novo } = acharOuCriarContato({
        workspaceId: ctx.workspaceId,
        conexao,
        telefone,
        nome,
      });

      const mudancas = {};
      if (nome && novo) mudancas.nome = nome;
      const statusNome = colunas[indice('status')];
      if (statusNome) {
        const status = listar('status', { workspaceId: ctx.workspaceId }).find(
          (s) => normalizar(s.nome) === normalizar(statusNome),
        );
        // Importacao nao dispara follow-up, por seguranca do numero, mas grava
        // o mesmo log de status que aplicarStatus grava: o dashboard le o funil
        // desses logs, e sem ele 500 leads importados como Qualificado
        // apareciam na distribuicao e nao apareciam no cartao Qualificado.
        if (status) {
          mudancas.statusId = status.id;
          mudancas.departamentoId = status.departamentoId || null;
          if (contato.statusId !== status.id) {
            const anterior = contato.statusId ? achar('status', contato.statusId) : null;
            registrarLog(
              ctx.workspaceId,
              contato.id,
              'status',
              `Status: ${anterior?.nome || 'sem status'} -> ${status.nome}`,
              { tipo: 'membro', nome: ctx.usuario.nome },
              { statusId: status.id, tipo: status.tipo || 'nenhum', anteriorId: anterior?.id || null },
            );
          }
        }
      }
      const origemNome = colunas[indice('origem')];
      if (origemNome) {
        const origem = listar('origens', { workspaceId: ctx.workspaceId }).find(
          (o) => normalizar(o.nome) === normalizar(origemNome),
        );
        if (origem) mudancas.origemId = origem.id;
      }
      const observacao = colunas[indice('observacao')];
      if (observacao) inserirNota(contato, observacao, { tipo: 'sistema', nome: 'Importacao' });

      if (Object.keys(mudancas).length) atualizar('contatos', contato.id, mudancas);
      if (novo) resultados.importados += 1;
      else resultados.atualizados += 1;
    }

    emitir(ctx.workspaceId, 'contatos', {});
    return resultados;
  });
}

/*
 * contagensPorAba() foi embora junto com o bug que ela causava.
 *
 * Ela varria o workspace por conta propria, entao existiam duas contagens da
 * mesma coisa — a dela e a lista que a tela desenhava — e as duas so
 * concordavam quando nao havia filtro nenhum. Manter a funcao "para quem
 * precisar" era manter a segunda fonte de verdade viva. A contagem agora sai
 * de dentro da rota de listagem, da mesma lista que vai para a tela.
 */

export { abaDe, enriquecer };
