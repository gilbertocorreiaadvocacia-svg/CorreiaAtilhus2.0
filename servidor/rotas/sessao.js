
import { achar, atualizar, inserir, listar, registrarLog, remover } from '../nucleo/banco.js';
import {
  PAPEIS,
  autenticar,
  criarSessao,
  criarUsuario,
  encerrarOutrasSessoes,
  encerrarSessao,
  ehAdministrador,
  podeConfigurar,
  sessoesDoUsuario,
  trocarWorkspaceDaSessao,
  workspacesDoUsuario,
} from '../nucleo/auth.js';
import { definirCookie } from '../nucleo/http.js';
import {
  conferirCodigo,
  consumirCodigoReserva,
  gerarCodigosReserva,
  gerarSegredo,
  segredoLegivel,
  uriOtpauth,
} from '../nucleo/doisfatores.js';
import { agora, conferirSenha, hashSenha, normalizar, normalizarTelefone, novoId } from '../nucleo/util.js';
import { semearWorkspace } from '../nucleo/seed.js';
import { criarWorkspacesPorArea } from '../nucleo/workspaces-por-area.js';
import { AREAS, MODELOS, PROMPT, TIPOS_STATUS } from '../config.js';

export const COOKIE_SESSAO = 'correiatendimentos';

/*
 * O usuario que sai para a tela nunca leva o que abre a conta: nem a senha, nem
 * o segredo do segundo fator, nem os codigos de reserva. No lugar vai so o
 * ESTADO do segundo fator (ligado ou nao), que a tela de perfil precisa mostrar.
 */
function limpar(usuario) {
  if (!usuario) return null;
  const { senha, doisFatores, ...resto } = usuario;
  return { ...resto, doisFatoresAtivo: Boolean(doisFatores?.ativo) };
}

/* ------------------------------------------------------------------ */
/* Freio da troca de senha                                             */
/* ------------------------------------------------------------------ */

/**
 * Contador de tentativas erradas por usuario, em memoria.
 *
 * A troca de senha cobra a senha atual, o que so vale enquanto nao der para
 * chutar a senha atual em laco: alguem sentado na maquina destravada de um
 * colega na hora do almoco rodava fetch em cima de /api/perfil/senha ate
 * acertar, e nada limitava nem registrava. Depois de TENTATIVAS_ATE_BLOQUEIO
 * erros a conta para de aceitar a troca por alguns minutos, e cada tentativa
 * entra no log.
 *
 * Em memoria de proposito: reiniciar o servidor limpa a contagem, e o custo
 * disso e menor que gravar tentativa de senha em disco.
 */
const TENTATIVAS_ATE_BLOQUEIO = 5;
const BLOQUEIO_MINUTOS = 10;
const tentativasDeSenha = new Map();

function bloqueioDeSenha(usuarioId) {
  const registro = tentativasDeSenha.get(usuarioId);
  if (!registro) return 0;
  const restante = registro.bloqueadoAte - Date.now();
  return restante > 0 ? Math.ceil(restante / 60000) : 0;
}

function contarErroDeSenha(usuarioId) {
  const registro = tentativasDeSenha.get(usuarioId) || { erros: 0, bloqueadoAte: 0 };
  registro.erros += 1;
  if (registro.erros >= TENTATIVAS_ATE_BLOQUEIO) {
    registro.bloqueadoAte = Date.now() + BLOQUEIO_MINUTOS * 60000;
    registro.erros = 0;
  }
  tentativasDeSenha.set(usuarioId, registro);
}

function limparErrosDeSenha(usuarioId) {
  tentativasDeSenha.delete(usuarioId);
}

/* ------------------------------------------------------------------ */
/* Segundo fator: o passo entre a senha certa e a sessao               */
/* ------------------------------------------------------------------ */

/**
 * Desafios de segundo fator, em memoria.
 *
 * A senha certa NAO cria sessao sozinha: cria um desafio curto, que so vale
 * para digitar o codigo do app (ou aderir, se a conta ainda nao tem segundo
 * fator). Dura DEZ MINUTOS e some ao ser usado. Vive so na memoria de proposito,
 * como as outras travas daqui: reiniciar o servidor derruba os desafios em
 * aberto, e no maximo a pessoa entra a senha de novo.
 *
 * Na adesao, o desafio guarda o `segredoPendente`: o segredo so vai para o
 * usuario DEPOIS que o primeiro codigo confirmar que o celular foi pareado.
 * Assim um pareamento que a pessoa comecou e nao terminou nao deixa a conta com
 * um segredo que ninguem tem no telefone.
 */
const DESAFIO_MINUTOS = 10;
const desafios = new Map();

function criarDesafio(dados) {
  /* Limpa os vencidos nesta hora mesmo: sem um varredor em separado, a memoria
     nao cresce com tentativa que ninguem terminou. */
  const agoraMs = Date.now();
  for (const [t, d] of desafios) {
    if (agoraMs - d.criadoEm > DESAFIO_MINUTOS * 60000) desafios.delete(t);
  }
  const token = novoId('dsf');
  desafios.set(token, { ...dados, criadoEm: agoraMs });
  return token;
}

function lerDesafio(token) {
  const d = desafios.get(token);
  if (!d) return null;
  if (Date.now() - d.criadoEm > DESAFIO_MINUTOS * 60000) {
    desafios.delete(token);
    return null;
  }
  return d;
}

/** A sessao de verdade, o cookie e o corpo de resposta: um lugar so, tres portas. */
function concluirEntrada(res, usuario, workspaces, extra = {}) {
  limparErrosDeSenha(usuario.id);
  const token = criarSessao(usuario.id, workspaces[0].id);
  definirCookie(res, COOKIE_SESSAO, token, { maxIdade: 60 * 60 * 24 * 30 });
  return { usuario: limpar(usuario), workspaces, ...extra };
}

export function registrarSessao(rotas) {
  rotas.post('/api/sessao/entrar', async ({ res, corpo }) => {
    const usuario = autenticar(corpo.email, corpo.senha);
    if (!usuario) {
      const erro = new Error('E-mail ou senha incorretos.');
      erro.codigo = 401;
      throw erro;
    }
    const workspaces = workspacesDoUsuario(usuario.id);
    if (!workspaces.length) {
      const erro = new Error('Este usuario nao esta em nenhum workspace.');
      erro.codigo = 403;
      throw erro;
    }

    /* Segundo fator obrigatorio: a senha certa nunca entra direto. Quem ja tem
       o app pareado passa pelo codigo; quem ainda nao tem e levado a parear
       agora, antes de entrar pela primeira vez. */
    if (usuario.doisFatores?.ativo) {
      const desafio = criarDesafio({ usuarioId: usuario.id, workspaceId: workspaces[0].id });
      return { etapa: 'codigo', desafio };
    }

    const segredo = gerarSegredo();
    const desafio = criarDesafio({ usuarioId: usuario.id, workspaceId: workspaces[0].id, segredoPendente: segredo });
    return {
      etapa: 'adesao',
      desafio,
      segredo,
      segredoLegivel: segredoLegivel(segredo),
      otpauth: uriOtpauth({ segredo, conta: usuario.email }),
      conta: usuario.email,
    };
  }, { publica: true });

  /**
   * Passo do codigo, para quem JA tem segundo fator. Aceita o codigo de 6
   * digitos do app ou um codigo de reserva. O codigo de reserva usado some da
   * lista aqui mesmo, para nao valer duas vezes.
   */
  rotas.post('/api/sessao/2fa/entrar', async ({ res, corpo }) => {
    const desafio = lerDesafio(corpo.desafio);
    if (!desafio) {
      const erro = new Error('O tempo para digitar o codigo acabou. Entre com a senha de novo.');
      erro.codigo = 401;
      throw erro;
    }
    const usuario = achar('usuarios', desafio.usuarioId);
    if (!usuario?.doisFatores?.ativo) {
      const erro = new Error('Esta conta nao tem segundo fator. Entre de novo.');
      erro.codigo = 409;
      throw erro;
    }
    const preso = bloqueioDeSenha(usuario.id);
    if (preso) {
      const erro = new Error(`Muitas tentativas. Espere ${preso} minuto(s) e tente de novo.`);
      erro.codigo = 429;
      throw erro;
    }

    if (conferirCodigo(usuario.doisFatores.segredo, corpo.codigo)) {
      desafios.delete(corpo.desafio);
      registrarLog(desafio.workspaceId, null, 'seguranca', 'Entrou com segundo fator (app)', { tipo: 'usuario', id: usuario.id, nome: usuario.nome });
      const workspaces = workspacesDoUsuario(usuario.id);
      return concluirEntrada(res, usuario, workspaces);
    }

    const restantes = consumirCodigoReserva(corpo.codigo, usuario.doisFatores.codigosReserva);
    if (restantes) {
      atualizar('usuarios', usuario.id, { doisFatores: { ...usuario.doisFatores, codigosReserva: restantes } });
      desafios.delete(corpo.desafio);
      registrarLog(desafio.workspaceId, null, 'seguranca', `Entrou com codigo de reserva (restam ${restantes.length})`, { tipo: 'usuario', id: usuario.id, nome: usuario.nome });
      const workspaces = workspacesDoUsuario(usuario.id);
      return concluirEntrada(res, usuario, workspaces, { reservaRestante: restantes.length });
    }

    contarErroDeSenha(usuario.id);
    registrarLog(desafio.workspaceId, null, 'seguranca', 'Codigo de segundo fator incorreto', { tipo: 'usuario', id: usuario.id, nome: usuario.nome });
    const erro = new Error('Codigo incorreto.');
    erro.codigo = 401;
    throw erro;
  }, { publica: true });

  /**
   * Passo da adesao: o primeiro codigo confirma que o app foi pareado. So
   * entao o segredo passa a valer na conta e os codigos de reserva nascem —
   * mostrados UMA vez, aqui, para a pessoa guardar.
   */
  rotas.post('/api/sessao/2fa/confirmar', async ({ res, corpo }) => {
    const desafio = lerDesafio(corpo.desafio);
    if (!desafio?.segredoPendente) {
      const erro = new Error('A configuracao expirou. Entre com a senha de novo.');
      erro.codigo = 401;
      throw erro;
    }
    if (!conferirCodigo(desafio.segredoPendente, corpo.codigo)) {
      const erro = new Error('O codigo nao confere. Confira a hora do celular e tente o codigo atual do app.');
      erro.codigo = 401;
      throw erro;
    }
    const usuario = achar('usuarios', desafio.usuarioId);
    if (!usuario) {
      const erro = new Error('Conta nao encontrada.');
      erro.codigo = 404;
      throw erro;
    }
    const { emClaro, hashes } = gerarCodigosReserva();
    atualizar('usuarios', usuario.id, {
      doisFatores: { ativo: true, segredo: desafio.segredoPendente, codigosReserva: hashes, confirmadoEm: agora() },
    });
    desafios.delete(corpo.desafio);
    registrarLog(desafio.workspaceId, null, 'seguranca', 'Ativou o segundo fator', { tipo: 'usuario', id: usuario.id, nome: usuario.nome });
    const workspaces = workspacesDoUsuario(usuario.id);
    return concluirEntrada(res, achar('usuarios', usuario.id), workspaces, { codigosReserva: emClaro });
  }, { publica: true });

  rotas.post('/api/sessao/sair', async ({ res, ctx }) => {
    if (ctx?.token) encerrarSessao(ctx.token);
    definirCookie(res, COOKIE_SESSAO, '', { expirar: true });
    return { ok: true };
  }, { publica: true });

  rotas.get('/api/sessao/eu', async ({ ctx }) => ({
    usuario: limpar(ctx.usuario),
    membro: ctx.membro,
    papel: ctx.papel,
    papeis: PAPEIS,
    workspace: ctx.workspace,
    workspaces: ctx.workspaces,
    modelos: MODELOS,
    tiposStatus: TIPOS_STATUS,
    /* As faixas de tamanho do prompt, para a tela de Agentes nao ter a sua
       propria copia dos numeros (ver PROMPT em config.js). */
    prompt: PROMPT,
    areas: AREAS,
  }));

  rotas.post('/api/sessao/workspace', async ({ ctx, corpo }) => {
    const alvo = ctx.workspaces.find((w) => w.id === corpo.workspaceId);
    if (!alvo) {
      const erro = new Error('Voce nao participa deste workspace.');
      erro.codigo = 403;
      throw erro;
    }
    trocarWorkspaceDaSessao(ctx.token, alvo.id);
    return { ok: true, workspaceId: alvo.id };
  });

  /* ---------------- Perfil ---------------- */

  /**
   * Perfil e o que a pessoa muda sozinha, sem depender de um administrador.
   * Por isso a lista de campos e fechada: e-mail e a identidade de quem entra
   * e papel decide o que a pessoa alcanca, os dois so mudam pela tela de
   * membros, que ja cobra permissao. Campo que chegar fora da lista e ignorado
   * em silencio, nao ha motivo para devolver erro por algo que a tela nem
   * oferece.
   */
  rotas.patch('/api/perfil', async ({ ctx, corpo }) => {
    const mudancas = {};

    if (corpo.nome !== undefined) {
      const nome = String(corpo.nome).trim();
      if (!nome) throw comCodigo('Informe seu nome.', 400);
      mudancas.nome = nome;
    }

    if (corpo.foto !== undefined) mudancas.foto = corpo.foto || null;

    if (corpo.whatsapp !== undefined) {
      // Guardado no mesmo formato que o resto do sistema usa para falar com a
      // Meta, assim o numero do perfil serve para aviso sem conversao no meio.
      mudancas.whatsapp = normalizarTelefone(corpo.whatsapp) || null;
    }

    if (!Object.keys(mudancas).length) return limpar(ctx.usuario);
    return limpar(atualizar('usuarios', ctx.usuarioId, mudancas));
  });

  /**
   * Troca de senha do proprio usuario. A senha atual e pedida de proposito:
   * sem ela, uma tela deixada aberta na copa vira conta tomada por quem passar
   * na frente do computador.
   */
  rotas.post('/api/perfil/senha', async ({ ctx, corpo }) => {
    const senhaAtual = String(corpo.senhaAtual || '');
    const senhaNova = String(corpo.senhaNova || '');

    const espera = bloqueioDeSenha(ctx.usuarioId);
    if (espera) {
      throw comCodigo(`Muitas tentativas seguidas. Tente de novo em ${espera} minutos.`, 429);
    }

    // A senha atual e conferida antes de tudo de proposito: quem esta chutando
    // recebe sempre a mesma resposta e nao aprende a regra da senha nova.
    if (!conferirSenha(senhaAtual, ctx.usuario.senha)) {
      contarErroDeSenha(ctx.usuarioId);
      registrarLog(
        ctx.workspaceId,
        null,
        'seguranca',
        'Tentativa de troca de senha recusada: senha atual incorreta.',
        { tipo: 'membro', id: ctx.membro?.id, nome: ctx.usuario.nome },
      );
      throw comCodigo('A senha atual esta incorreta.', 403);
    }
    if (senhaNova.length < 8) {
      throw comCodigo('A senha nova precisa ter no minimo 8 caracteres.', 400);
    }
    if (conferirSenha(senhaNova, ctx.usuario.senha)) {
      throw comCodigo('A senha nova precisa ser diferente da senha atual.', 400);
    }

    limparErrosDeSenha(ctx.usuarioId);
    atualizar('usuarios', ctx.usuarioId, {
      senha: hashSenha(senhaNova),
      senhaAlteradaEm: agora(),
    });
    registrarLog(ctx.workspaceId, null, 'seguranca', 'Senha trocada pelo proprio usuario.', {
      tipo: 'membro',
      id: ctx.membro?.id,
      nome: ctx.usuario.nome,
    });

    // Trocar a senha sem derrubar as outras sessoes nao resolve nada: quem ja
    // estava dentro continua dentro, porque o cookie vale trinta dias.
    const sessoesEncerradas = encerrarOutrasSessoes(ctx.usuarioId, ctx.token);
    return { ok: true, sessoesEncerradas };
  });

  /**
   * Aparelhos conectados nesta conta. O token nunca sai daqui: a resposta leva
   * so quando a sessao nasceu e qual delas e a atual, que e o suficiente para a
   * pessoa reconhecer um acesso que nao foi dela.
   */
  rotas.get('/api/perfil/sessoes', async ({ ctx }) => {
    const sessoes = sessoesDoUsuario(ctx.usuarioId);
    return {
      total: sessoes.length,
      sessoes: sessoes.map((sessao) => ({
        criadaEm: sessao.criadaEm,
        expiraEm: sessao.expiraEm,
        atual: sessao.token === ctx.token,
      })),
    };
  });

  /* ---------------- Workspaces ---------------- */

  rotas.post('/api/workspaces', async ({ ctx, corpo }) => {
    exigirAdministrador(ctx);
    const workspace = inserir('workspaces', {
      id: novoId('wks'),
      nome: corpo.nome || 'Novo workspace',
      empresa: corpo.clonarDe ? { ...(ctx.workspace?.empresa || {}) } : {},
      horarioComercial: ctx.workspace?.horarioComercial || null,
      onboarding: {},
    });
    semearWorkspace(workspace.id, { clonarDe: corpo.clonarDe ? ctx.workspaceId : null });
    inserir('membros', {
      id: novoId('mbr'),
      workspaceId: workspace.id,
      usuarioId: ctx.usuarioId,
      papel: 'administrador',
      departamentos: ['*'],
      conexoes: ['*'],
      modoFoco: false,
    });
    inserir('integracoes', {
      id: novoId('int'),
      workspaceId: workspace.id,
      zapsign: { chave: '', modelos: [], ativo: false },
      googleCalendar: { conectado: false },
      advbox: { chave: '', ativo: false, descricoesStatus: {} },
      customTools: [],
      ia: { provedor: 'anthropic', chaveAnthropic: '', chaveOpenai: '' },
    });
    return workspace;
  });

  /* Previdenciario e Trabalhista a partir deste workspace, que fica como esta
     (ver nucleo/workspaces-por-area.js). Rodar de novo nao duplica. */
  rotas.post('/api/workspaces/por-area', async ({ ctx }) => {
    exigirAdministrador(ctx);
    return { ok: true, workspaces: criarWorkspacesPorArea({ baseWorkspaceId: ctx.workspaceId }) };
  });

  /**
   * Lista fechada, como em PATCH /api/perfil. Repassar o corpo inteiro para
   * atualizar deixava qualquer campo do registro ao alcance de quem pode
   * configurar, inclusive o id e o horario comercial, que tem rota propria com
   * conferencia de formato (PUT /api/horario-comercial).
   */
  rotas.patch('/api/workspaces/:id', async ({ ctx, params, corpo }) => {
    exigirConfiguracao(ctx);
    if (params.id !== ctx.workspaceId) exigirAdministrador(ctx);

    const mudancas = {};
    if (corpo.nome !== undefined) {
      const nome = String(corpo.nome).trim();
      if (!nome) throw comCodigo('Informe o nome do workspace.', 400);
      mudancas.nome = nome;
    }
    if (corpo.empresa && typeof corpo.empresa === 'object') mudancas.empresa = corpo.empresa;
    if (corpo.onboarding && typeof corpo.onboarding === 'object') mudancas.onboarding = corpo.onboarding;

    if (!Object.keys(mudancas).length) return achar('workspaces', params.id);
    return atualizar('workspaces', params.id, mudancas);
  });

  /* ---------------- Membros ---------------- */

  /**
   * A lista e carregada por todo mundo no inicio da sessao: e dela que sai o
   * nome do responsavel na conversa, na tarefa e na mencao. Por isso ela nao
   * exige configuracao, mas quem nao pode configurar recebe so o que a tela
   * precisa desenhar. E-mail, WhatsApp, departamentos e conexoes de toda a
   * equipe sao dado de cadastro, e ficam para a tela de Membros.
   */
  rotas.get('/api/membros', async ({ ctx }) => {
    const completo = podeConfigurar(ctx);
    return listar('membros', { workspaceId: ctx.workspaceId }).map((membro) => {
      const usuario = limpar(achar('usuarios', membro.usuarioId));
      if (completo) return { ...membro, usuario };
      return {
        id: membro.id,
        workspaceId: membro.workspaceId,
        usuarioId: membro.usuarioId,
        papel: membro.papel,
        usuario: usuario ? { id: usuario.id, nome: usuario.nome, foto: usuario.foto || null } : null,
      };
    });
  });

  rotas.post('/api/membros', async ({ ctx, corpo }) => {
    exigirConfiguracao(ctx);
    const email = String(corpo.email || '').trim();
    if (!email) throw comCodigo('Informe o e-mail do membro.', 400);

    // A mesma trava do PATCH: sem ela o gerente contornava a regra criando um
    // administrador novo em vez de promover alguem.
    if (corpo.papel === 'administrador' && !ehAdministrador(ctx)) {
      throw comCodigo('Somente administrador cria outro administrador.', 403);
    }
    if (corpo.papel && !PAPEIS[corpo.papel]) throw comCodigo('Permissao desconhecida.', 400);

    let usuario = listar('usuarios').find((u) => normalizar(u.email) === normalizar(email));
    if (!usuario) {
      if (!corpo.senha) throw comCodigo('Defina uma senha inicial para o novo membro.', 400);
      usuario = criarUsuario({
        nome: corpo.nome || email,
        email,
        senha: corpo.senha,
        foto: corpo.foto || null,
        whatsapp: corpo.whatsapp || null,
      });
    }

    const jaEsta = achar('membros', { workspaceId: ctx.workspaceId, usuarioId: usuario.id });
    if (jaEsta) throw comCodigo('Esta pessoa ja e membro deste workspace.', 409);

    const membro = inserir('membros', {
      id: novoId('mbr'),
      workspaceId: ctx.workspaceId,
      usuarioId: usuario.id,
      papel: corpo.papel || 'suporte',
      departamentos: corpo.departamentos || [],
      conexoes: corpo.conexoes || [],
      modoFoco: Boolean(corpo.modoFoco),
      assinaturaAtiva: false,
    });
    return { ...membro, usuario: limpar(usuario) };
  });

  /**
   * As travas olham o alvo, e nao o corpo.
   *
   * Antes elas dependiam de corpo.papel chegar preenchido, entao um gerente
   * podia mandar so { usuario: { senha } } para o membro administrador e sair
   * com a conta dele. E o proprio corpo ia inteiro para atualizar, o que punha
   * workspaceId e usuarioId ao alcance de quem pode configurar: trocando o
   * workspaceId do proprio registro, o gerente entrava no workspace do vizinho
   * com o papel que ja tinha.
   *
   * Agora: administrador so e alterado por administrador, promover alguem a
   * administrador exige ser administrador, ninguem mexe no proprio nivel de
   * acesso por aqui, senha de outra pessoa so o administrador troca, e o que
   * chega a atualizar e uma lista fechada.
   */
  rotas.patch('/api/membros/:id', async ({ ctx, params, corpo }) => {
    const membro = achar('membros', params.id);
    if (!membro || membro.workspaceId !== ctx.workspaceId) throw comCodigo('Membro nao encontrado.', 404);

    // Cada um pode ajustar as proprias preferencias sem ser administrador.
    const soPreferencias = Object.keys(corpo).every((c) => ['assinaturaAtiva', 'modoFoco'].includes(c));
    const ehOProprio = membro.id === ctx.membro?.id;
    if (!soPreferencias || !ehOProprio) {
      exigirConfiguracao(ctx);

      if (membro.papel === 'administrador' && !ehAdministrador(ctx)) {
        throw comCodigo('Somente administrador altera um administrador.', 403);
      }
      if (corpo.papel === 'administrador' && !ehAdministrador(ctx)) {
        throw comCodigo('Somente administrador promove alguem a administrador.', 403);
      }
      if (corpo.papel && corpo.papel !== membro.papel && ehOProprio) {
        throw comCodigo('Ninguem muda o proprio nivel de acesso por aqui.', 403);
      }
    }

    if (corpo.usuario) {
      const { nome, email, whatsapp, foto, senha } = corpo.usuario;
      const mudancas = {};
      if (nome) mudancas.nome = String(nome).trim();
      if (email) mudancas.email = String(email).trim();
      if (whatsapp !== undefined) mudancas.whatsapp = whatsapp;
      if (foto !== undefined) mudancas.foto = foto;
      if (senha) {
        // Senha de outra pessoa e reset, nao edicao de cadastro: quem faz e o
        // administrador. A propria senha muda em POST /api/perfil/senha, que
        // cobra a senha atual.
        if (!ehOProprio) exigirAdministrador(ctx);
        mudancas.senha = hashSenha(senha);
      }
      if (Object.keys(mudancas).length) atualizar('usuarios', membro.usuarioId, mudancas);
    }

    /* Reiniciar o segundo fator: a saida para quem perdeu o celular. So o
       administrador faz, e a conta volta a ter de parear um app no proximo
       login (o segundo fator continua obrigatorio, so o aparelho muda). */
    if (corpo.resetar2fa) {
      exigirAdministrador(ctx);
      atualizar('usuarios', membro.usuarioId, { doisFatores: null });
      registrarLog(ctx.workspaceId, null, 'seguranca', `Segundo fator reiniciado para ${achar('usuarios', membro.usuarioId)?.nome || membro.usuarioId}`, {
        tipo: 'membro',
        id: ctx.membro?.id,
        nome: ctx.usuario?.nome,
      });
    }

    const mudancasDoMembro = {};
    if (corpo.papel !== undefined && PAPEIS[corpo.papel]) mudancasDoMembro.papel = corpo.papel;
    if (Array.isArray(corpo.departamentos)) mudancasDoMembro.departamentos = corpo.departamentos;
    if (Array.isArray(corpo.conexoes)) mudancasDoMembro.conexoes = corpo.conexoes;
    if (corpo.modoFoco !== undefined) mudancasDoMembro.modoFoco = Boolean(corpo.modoFoco);
    if (corpo.assinaturaAtiva !== undefined) mudancasDoMembro.assinaturaAtiva = Boolean(corpo.assinaturaAtiva);

    const atualizado = Object.keys(mudancasDoMembro).length
      ? atualizar('membros', params.id, mudancasDoMembro)
      : achar('membros', params.id);
    return { ...atualizado, usuario: limpar(achar('usuarios', atualizado.usuarioId)) };
  });

  rotas.delete('/api/membros/:id', async ({ ctx, params }) => {
    exigirConfiguracao(ctx);
    const membro = achar('membros', params.id);
    if (!membro || membro.workspaceId !== ctx.workspaceId) throw comCodigo('Membro nao encontrado.', 404);
    if (membro.papel === 'administrador' && !ehAdministrador(ctx)) {
      throw comCodigo('Gerente nao remove administrador.', 403);
    }
    if (membro.usuarioId === ctx.usuarioId) throw comCodigo('Voce nao pode remover a si mesmo.', 400);
    remover('membros', params.id);
    return { ok: true };
  });
}

export function comCodigo(mensagem, codigo) {
  const erro = new Error(mensagem);
  erro.codigo = codigo;
  return erro;
}

export function exigirAdministrador(ctx) {
  if (!ehAdministrador(ctx)) throw comCodigo('Somente administrador pode fazer isso.', 403);
}

export function exigirConfiguracao(ctx) {
  if (!podeConfigurar(ctx)) throw comCodigo('Seu perfil nao tem acesso as configuracoes.', 403);
}
