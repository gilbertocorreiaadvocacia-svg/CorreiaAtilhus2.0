import { api } from '../api.js';
import { campoComDica, dica, gaveta } from '../componentes.js';
import { estado, opcoesResponsavel, podeConfigurar } from '../estado.js';
import {
  areaTexto,
  aviso,
  botao,
  campo,
  confirmar,
  el,
  entradaTexto,
  limpar,
  selecao,
} from '../ui.js';

/**
 * Integracoes.
 *
 * Cada servico e um cartao, e dentro dele um ajuste por linha: a esquerda o
 * nome e a explicacao, a direita o controle. O salvar fica no rodape do
 * proprio cartao, entao quem mexeu na agenda salva a agenda e nao arrasta
 * junto o que estava escrito no cartao do lado.
 *
 * Chave nunca volta do servidor em claro. O campo abre vazio e vazio significa
 * "nao mexi nisso", e por isso todo campo de segredo diz no lugar do valor se
 * ja existe algo salvo (servidor/rotas/integracoes.js, preservarSegredo).
 */
export async function paginaIntegracoes() {
  const container = el('div');

  async function desenhar() {
    const integracoes = await api.get('/api/integracoes');
    limpar(container);

    // O aviso de "chave ja cadastrada aparece vazia" saiu do alto da tela: cada
    // campo de segredo ja diz isso no proprio placeholder, na hora em que a
    // pessoa olha para ele. O aviso de permissao fica, porque e estado.
    container.append(
      ...[
        podeConfigurar()
          ? null
          : el('div', { class: 'alerta-caixa mb-4', texto: 'Seu perfil ve as integracoes, mas quem altera e o administrador ou o gerente do escritorio.' }),
        blocoIa(integracoes, desenhar),
        blocoZapsign(integracoes, desenhar),
        blocoAgenda(integracoes, desenhar),
        blocoAndamento(integracoes, desenhar),
        blocoMetaConversoes(integracoes, desenhar),
        blocoFerramentas(integracoes, desenhar),
      ].filter(Boolean),
    );
  }

  await desenhar();
  return container;
}

/* ------------------------------------------------------------------ */
/* Pecas do cartao de ajustes                                          */
/* ------------------------------------------------------------------ */

/**
 * Cabecalho, linhas de ajuste e rodape, tudo dentro do mesmo cartao.
 *
 * .ajuste-cabecalho mora em web/css/tema.css, junto de .ajuste-linha: e a
 * linha de uma coluna so que abre o cartao, sem respiro entre colunas.
 *
 * `balao` diz para que serve o servico inteiro. Isso e conceito, se le uma vez
 * e depois so atrapalha, entao mora na dica ao lado do titulo. A explicacao de
 * cada ajuste continua embaixo do rotulo dele, em linhaAjuste: essa e a que a
 * pessoa precisa reler justamente quando volta a mexer, seis meses depois.
 */
function cartaoAjustes(titulo, balao, ...partes) {
  return el('div', { class: 'ajustes-cartao' }, [
    el('div', { class: 'ajuste-linha ajuste-cabecalho' }, [
      el('div', {}, [
        el('h2', { class: 'ajuste-rotulo' }, [titulo, balao ? dica(balao, { largura: 360, assunto: titulo }) : null]),
      ]),
    ]),
    ...[].concat(...partes).filter(Boolean),
  ]);
}

/**
 * Uma linha de ajuste. `largo` deita a linha para o controle ocupar a largura
 * inteira, que e o unico jeito de uma area de texto ou uma lista caber. Quem
 * deita e a classe .ajuste-linha.larga, em web/css/tema.css.
 *
 * O nome do ajuste fica a esquerda e nao e um <label>, entao sem aria-label o
 * campo chegaria ao leitor de tela sem nome nenhum.
 *
 * `ajuda` e o paragrafo visivel, e so fica quando fala do estado do proprio
 * controle. `balao` e para o resto: o que o ajuste significa se le uma vez, e
 * como paragrafo empurrava o proximo controle para baixo em toda abertura.
 * Como o nome aqui e um <p>, e nao um <label>, o icone dentro dele nao entra no
 * nome acessivel do campo.
 */
function linhaAjuste(rotulo, ajuda, controle, { largo = false, balao = null } = {}) {
  const controles = [].concat(controle || []).filter(Boolean);
  for (const no of controles) {
    if (typeof no.matches !== 'function') continue;
    if (no.matches('input, select, textarea') && !no.hasAttribute('aria-label')) no.setAttribute('aria-label', rotulo);
  }

  return el('div', { class: largo ? 'ajuste-linha larga' : 'ajuste-linha' }, [
    el('div', {}, [
      el('p', { class: 'ajuste-rotulo' }, [rotulo, balao ? dica(balao, { largura: 360, assunto: rotulo }) : null]),
      ajuda ? el('p', { class: 'ajuste-ajuda', texto: ajuda }) : null,
    ]),
    controles.length ? el('div', { class: 'ajuste-controle' }, controles) : null,
  ]);
}

function rodapeAjustes(...botoes) {
  const acoes = botoes.filter(Boolean);
  if (!acoes.length) return null;
  return el('div', { class: 'ajustes-rodape' }, acoes);
}

/* ------------------------------------------------------------------ */
/* Modelo de IA                                                        */
/* ------------------------------------------------------------------ */

function blocoIa(integracoes, recarregarTela) {
  const chaveAnthropic = entradaTexto('', {
    type: 'password',
    placeholder: integracoes.ia?.chaveAnthropic ? 'ja configurada (deixe em branco para manter)' : 'sk-ant-…',
  });
  const chaveOpenai = entradaTexto('', {
    type: 'password',
    placeholder: integracoes.ia?.chaveOpenai ? 'ja configurada' : 'sk-…',
  });

  return cartaoAjustes(
    'Modelo de IA',
    'Sem chave cadastrada os agentes continuam funcionando, mas pelo roteiro por regras: seguem o prompt numerado, uma etapa por resposta, sem entender contexto.',
    // O rotulo ja diz de quem e a chave, entao a linha da Anthropic nao leva
    // explicacao. A da OpenAI leva, porque ela faz tres coisas alem do obvio,
    // e leva no balao: e conceito do servico, nao regra de preenchimento.
    linhaAjuste('Chave da Anthropic (Claude)', null, chaveAnthropic),
    linhaAjuste('Chave da OpenAI', null, chaveOpenai, {
      balao: 'Alem dos agentes em GPT, e ela que transcreve o audio do cliente e gera as vozes do escritorio.',
    }),
    rodapeAjustes(
      podeConfigurar()
        ? botao('Salvar', {
            tipo: 'principal',
            pequeno: true,
            aoClicar: async () => {
              await api.patch('/api/integracoes', {
                ia: { chaveAnthropic: chaveAnthropic.value.trim(), chaveOpenai: chaveOpenai.value.trim() },
              });
              aviso('Chaves salvas.', 'sucesso');
              await recarregarTela();
            },
          })
        : null,
      // Testar tambem gasta a chave paga do escritorio, entao entra na mesma
      // trava dos vizinhos: sem isso o botao era o unico caminho aberto para
      // qualquer perfil queimar credito clicando.
      podeConfigurar()
        ? botao('Testar conexao', {
            pequeno: true,
            aoClicar: async () => {
              const resultado = await api.post('/api/integracoes/ia/testar', {});
              aviso(resultado.ok ? `Respondeu: ${resultado.resposta}` : resultado.erro, resultado.ok ? 'sucesso' : 'erro');
            },
          })
        : null,
      podeConfigurar() && (integracoes.ia?.chaveAnthropic || integracoes.ia?.chaveOpenai)
        ? botao('Remover chaves', {
            pequeno: true,
            tipo: 'perigo',
            titulo: 'Apaga as chaves salvas. Os agentes voltam ao roteiro por regras.',
            aoClicar: () =>
              confirmar(
                'Remover as chaves de IA?',
                'Os agentes voltam a responder pelo roteiro por regras, e a transcricao e a voz param de funcionar.',
                async () => {
                  await api.patch('/api/integracoes', { ia: { chaveAnthropic: null, chaveOpenai: null } });
                  aviso('Chaves removidas.', 'sucesso');
                  await recarregarTela();
                },
                'Remover',
              ),
          })
        : null,
    ),
  );
}

/* ------------------------------------------------------------------ */
/* ZapSign                                                             */
/* ------------------------------------------------------------------ */

function blocoZapsign(integracoes, recarregarTela) {
  const chave = entradaTexto('', { type: 'password', placeholder: integracoes.zapsign?.chave ? 'ja configurada' : 'token da ZapSign' });
  const modelo = selecao(
    [
      { valor: '', rotulo: 'Escolha o modelo de contrato' },
      ...(integracoes.zapsign?.modelos || []).map((m) => ({ valor: m.id, rotulo: m.nome })),
    ],
    integracoes.zapsign?.modeloPadraoId || '',
  );
  const statusPos = selecao(
    [{ valor: '', rotulo: 'Nao alterar' }, ...estado.status.map((s) => ({ valor: s.id, rotulo: s.nome }))],
    integracoes.zapsign?.posAssinatura?.statusId || '',
  );
  const responsavelPos = selecao(
    opcoesResponsavel(),
    integracoes.zapsign?.posAssinatura?.responsavel
      ? `${integracoes.zapsign.posAssinatura.responsavel.tipo}:${integracoes.zapsign.posAssinatura.responsavel.id}`
      : '',
  );
  const templatePos = selecao(
    [{ valor: '', rotulo: 'Nao enviar' }, ...estado.templates.map((t) => ({ valor: t.id, rotulo: t.nome }))],
    integracoes.zapsign?.posAssinatura?.templateId || '',
  );

  return cartaoAjustes(
    'ZapSign (contrato com assinatura eletronica)',
    'Com a chave configurada, o agente gera o contrato ja preenchido com os dados coletados e manda o link no WhatsApp. Sem ela, o sistema cria um contrato interno para voce testar o fluxo inteiro.',
    // Os tres ajustes de "depois da assinatura" perderam a explicacao: cada uma
    // era o proprio rotulo dito de novo, e o que o campo faz ja esta na
    // primeira opcao da lista ("Nao alterar", "Nao enviar"). Ficam as duas
    // linhas que dizem algo que o rotulo nao diz: o que fazer com o erro da
    // ZapSign e de onde vem a lista de modelos.
    linhaAjuste('Chave da API', null, chave, {
      balao: 'Exige plano da ZapSign com API. Erro 402 = plano sem API, 403 = chave invalida.',
    }),
    // Esta fica visivel: fala de onde vem o conteudo do proprio controle ao
    // lado, e e o que responde "por que a lista esta vazia".
    linhaAjuste('Modelo de contrato', 'A lista vem do botao de sincronizar.', modelo),
    linhaAjuste('Status depois da assinatura', null, statusPos),
    linhaAjuste('Responsavel depois da assinatura', null, responsavelPos),
    linhaAjuste('Mensagem depois da assinatura', null, templatePos),
    rodapeAjustes(
      podeConfigurar()
        ? botao('Salvar', {
            tipo: 'principal',
            pequeno: true,
            aoClicar: async () => {
              const [tipoResp, idResp] = responsavelPos.value ? responsavelPos.value.split(':') : [null, null];
              await api.patch('/api/integracoes', {
                zapsign: {
                  chave: chave.value.trim(),
                  modeloPadraoId: modelo.value || null,
                  posAssinatura: {
                    statusId: statusPos.value || null,
                    responsavel: tipoResp ? { tipo: tipoResp, id: idResp } : null,
                    templateId: templatePos.value || null,
                  },
                },
              });
              aviso('Integracao salva.', 'sucesso');
              await recarregarTela();
            },
          })
        : null,
      podeConfigurar()
        ? botao('Sincronizar modelos', {
            pequeno: true,
            aoClicar: async () => {
              const resultado = await api.post('/api/integracoes/zapsign/sincronizar', {});
              aviso(resultado.ok ? `${resultado.modelos.length} modelos encontrados.` : resultado.erro, resultado.ok ? 'sucesso' : 'erro');
              await recarregarTela();
            },
          })
        : null,
    ),
  );
}

/* ------------------------------------------------------------------ */
/* Agenda de reunioes                                                  */
/* ------------------------------------------------------------------ */

function blocoAgenda(integracoes, recarregarTela) {
  const disponibilidade = integracoes.googleCalendar?.disponibilidade || {};
  const dias = new Set(disponibilidade.dias || [1, 2, 3, 4, 5]);

  const listaDias = el('div', { class: 'linha-botoes' });
  ['Dom', 'Seg', 'Ter', 'Qua', 'Qui', 'Sex', 'Sab'].forEach((nome, indice) => {
    // .selo-clicavel mora em web/css/tema.css, junto de .selo.
    const b = el('button', {
      type: 'button',
      class: `selo selo-clicavel ${dias.has(indice) ? 'ouro' : ''}`.trim(),
      texto: nome,
      'aria-pressed': dias.has(indice) ? 'true' : 'false',
    });
    b.addEventListener('click', () => {
      if (dias.has(indice)) dias.delete(indice);
      else dias.add(indice);
      b.classList.toggle('ouro', dias.has(indice));
      b.setAttribute('aria-pressed', dias.has(indice) ? 'true' : 'false');
    });
    listaDias.append(b);
  });

  const de = el('input', { type: 'time', value: disponibilidade.de || '09:00', 'aria-label': 'Hora inicial' });
  const ate = el('input', { type: 'time', value: disponibilidade.ate || '17:00', 'aria-label': 'Hora final' });
  const faixa = el('div', { class: 'linha' }, [de, el('span', { class: 'c-suave t-sm', texto: 'ate' }), ate]);

  const duracao = entradaTexto(String(integracoes.googleCalendar?.duracaoPadrao || 30), { type: 'number', min: '15', step: '15' });
  const clientId = entradaTexto(integracoes.googleCalendar?.credenciais?.clientId || '');
  const clientSecret = entradaTexto('', { type: 'password', placeholder: integracoes.googleCalendar?.credenciais?.clientSecret ? 'ja configurado' : '' });
  const refreshToken = entradaTexto('', { type: 'password', placeholder: integracoes.googleCalendar?.credenciais?.refreshToken ? 'ja configurado' : '' });

  return cartaoAjustes(
    'Agenda de reunioes',
    'A agenda funciona sozinha com as regras abaixo: o agente consulta os horarios livres, oferece opcoes e marca. Preenchendo as credenciais do Google, o evento tambem e criado la, com link do Meet.',
    // "Em minutos" e unidade do numero, entao cabe no proprio nome do ajuste. O
    // resto e o que cada regra significa, e vai para o balao: eram quatro
    // paragrafos empilhados antes do primeiro campo de credencial.
    linhaAjuste('Dias de atendimento', null, listaDias, {
      balao: 'Fora deles o agente nao oferece horario nenhum.',
    }),
    linhaAjuste('Horario de atendimento', null, faixa, {
      balao: 'Vale para todos os dias marcados acima.',
    }),
    linhaAjuste('Duracao da reuniao, em minutos', null, duracao),
    linhaAjuste('Client ID do Google', null, clientId, {
      balao: 'As tres credenciais abaixo sao opcionais. Com elas, a reuniao marcada aqui tambem entra no Google Calendar.',
    }),
    linhaAjuste('Client Secret do Google', null, clientSecret),
    linhaAjuste('Refresh Token do Google', null, refreshToken),
    rodapeAjustes(
      podeConfigurar()
        ? botao('Salvar', {
            tipo: 'principal',
            pequeno: true,
            aoClicar: async () => {
              await api.patch('/api/integracoes', {
                googleCalendar: {
                  duracaoPadrao: Number(duracao.value) || 30,
                  disponibilidade: {
                    dias: [...dias],
                    de: de.value,
                    ate: ate.value,
                    duracao: Number(duracao.value) || 30,
                    antecedenciaHoras: 2,
                    diasAFrente: 5,
                  },
                  credenciais: {
                    clientId: clientId.value.trim(),
                    clientSecret: clientSecret.value.trim(),
                    refreshToken: refreshToken.value.trim(),
                  },
                },
              });
              aviso('Agenda salva.', 'sucesso');
              await recarregarTela();
            },
          })
        : null,
    ),
  );
}

/* ------------------------------------------------------------------ */
/* Andamento processual                                                */
/* ------------------------------------------------------------------ */

function blocoAndamento(integracoes, recarregarTela) {
  const chave = entradaTexto('', { type: 'password', placeholder: integracoes.advbox?.chave ? 'ja configurada' : 'token da API' });
  const base = entradaTexto(integracoes.advbox?.base || 'https://app.advbox.com.br/api/v1');
  const descricoes = areaTexto(
    Object.entries(integracoes.advbox?.descricoesStatus || {})
      .map(([nome, valor]) => `${nome} = ${valor}`)
      .join('\n'),
    { placeholder: 'Aguardando pericia = O INSS ja marcou a pericia medica. Assim que houver data, avisamos.' },
  );

  return cartaoAjustes(
    'Andamento processual',
    'O cliente pergunta "como esta meu processo?", o agente pede o CPF e responde com a fase atual, em portugues comum, nao em juridiques.',
    linhaAjuste('Chave da API', null, chave, {
      balao: 'Token do sistema onde os processos do escritorio ficam cadastrados.',
    }),
    linhaAjuste('Endereco da API', null, base, {
      balao: 'Troque so se o seu sistema roda em outro endereco.',
    }),
    // A regra de escrita nao pode sumir: errar o formato faz a linha inteira
    // ser ignorada. Fica no balao porque o placeholder da area logo abaixo ja
    // mostra uma fase escrita por extenso, no formato certo.
    linhaAjuste('O que cada fase significa', null, descricoes, {
      largo: true,
      balao: 'Uma por linha, no formato "fase = explicacao".',
    }),
    rodapeAjustes(
      podeConfigurar()
        ? botao('Salvar', {
            tipo: 'principal',
            pequeno: true,
            aoClicar: async () => {
              const mapa = {};
              for (const linha of descricoes.value.split('\n')) {
                const [nome, ...resto] = linha.split('=');
                if (nome?.trim() && resto.length) mapa[nome.trim()] = resto.join('=').trim();
              }
              await api.patch('/api/integracoes', {
                advbox: { chave: chave.value.trim(), base: base.value.trim(), descricoesStatus: mapa, ativo: true },
              });
              aviso('Integracao salva.', 'sucesso');
              await recarregarTela();
            },
          })
        : null,
    ),
  );
}

/* ------------------------------------------------------------------ */
/* Meta. API de Conversao                                              */
/* ------------------------------------------------------------------ */

function blocoMetaConversoes(integracoes, recarregarTela) {
  const capi = integracoes.metaConversoes || {};

  const ativo = el('input', { type: 'checkbox' });
  ativo.checked = Boolean(capi.ativo);
  const pixelId = entradaTexto(capi.pixelId || '', { placeholder: 'ID do conjunto de dados' });
  const token = entradaTexto('', { type: 'password', placeholder: capi.token ? 'ja configurado' : 'token de acesso' });

  const eventosPorTipo = {};
  const linhasEvento = [];
  for (const tipo of estado.sessao.tiposStatus.filter((t) => t.referencia !== null)) {
    eventosPorTipo[tipo.id] = entradaTexto(capi.eventos?.[tipo.id] || '', {
      placeholder: tipo.id === 'sucesso' ? 'Purchase' : tipo.id === 'qualificado' ? 'Lead' : 'deixe vazio para nao enviar',
    });
    linhasEvento.push(linhaAjuste(tipo.nome, null, eventosPorTipo[tipo.id]));
  }

  // O que sai daqui era uma caixa fixa no meio dos ajustes. Nao e aviso de
  // estado nem dado: e a resposta a uma pergunta que se faz uma vez, na hora de
  // ligar a integracao. Foi para o balao do titulo, junto do resto.
  const balao = el('div', {}, [
    el('div', { texto: 'Sem isso, a Meta otimiza o anuncio por "conversa iniciada", que e barata e nao paga a conta. Devolvendo o evento de contrato assinado, a campanha passa a buscar quem fecha, e o custo por contrato cai sem mexer no orcamento.' }),
    el('div', { class: 'mt-2', texto: 'O que sai daqui e o minimo: o identificador do clique no anuncio e o telefone com hash.' }),
    el('div', { class: 'mt-1', texto: 'Nome, CPF e conteudo de conversa nao saem. Nada disso e necessario para a atribuicao funcionar.' }),
  ]);

  return cartaoAjustes(
    'Meta. API de Conversao',
    balao,
    // Esta fica visivel: e o estado do proprio interruptor ao lado, e explica
    // por que nada chega na Meta mesmo com tudo preenchido.
    linhaAjuste('Enviar eventos de conversao para a Meta', 'Desligado, nada e enviado, mesmo com as credenciais preenchidas.', ativo),
    linhaAjuste('Conjunto de dados', null, pixelId),
    linhaAjuste('Token de acesso', null, token, { balao: 'Gerado no Gerenciador de Eventos da Meta.' }),
    // Os nomes que a Meta reconhece ja aparecem no placeholder de cada linha
    // ("Lead", "Purchase"), entao repeti-los aqui era escrever duas vezes a
    // mesma coisa. Sobra o que o placeholder das outras etapas nao diz.
    linhaAjuste('Qual etapa vira qual evento', null, null, {
      largo: true,
      balao: 'Etapa em branco nao gera evento.',
    }),
    linhasEvento,
    rodapeAjustes(
      podeConfigurar()
        ? botao('Salvar', {
            tipo: 'principal',
            pequeno: true,
            aoClicar: async () => {
              const eventos = {};
              for (const [tipo, entrada] of Object.entries(eventosPorTipo)) {
                if (entrada.value.trim()) eventos[tipo] = entrada.value.trim();
              }
              await api.patch('/api/integracoes', {
                metaConversoes: {
                  ativo: ativo.checked,
                  pixelId: pixelId.value.trim(),
                  token: token.value.trim(),
                  eventos,
                },
              });
              aviso('Integracao salva.', 'sucesso');
              await recarregarTela();
            },
          })
        : null,
      podeConfigurar()
        ? botao('Testar credenciais', {
            pequeno: true,
            aoClicar: async () => {
              const resultado = await api.post('/api/integracoes/meta-conversoes/testar', {});
              aviso(resultado.ok ? `Conectado a "${resultado.nome}".` : resultado.erro, resultado.ok ? 'sucesso' : 'erro');
            },
          })
        : null,
    ),
  );
}

/* ------------------------------------------------------------------ */
/* Chamadas personalizadas                                             */
/* ------------------------------------------------------------------ */

function blocoFerramentas(integracoes, recarregarTela) {
  const ferramentas = integracoes.customTools || [];
  const lista = el('div', { class: 'lista-simples' });

  for (const ferramenta of ferramentas) {
    lista.append(
      el('div', { class: 'lista-item' }, [
        el('div', { class: 'corpo' }, [
          el('div', { class: 'titulo', texto: `@${ferramenta.nome}` }),
          el('div', { class: 'desc', texto: `${ferramenta.metodo} ${ferramenta.url}` }),
        ]),
        podeConfigurar() ? botao('Editar', { pequeno: true, aoClicar: () => editarFerramenta(ferramenta, recarregarTela) }) : null,
        podeConfigurar()
          ? botao('Excluir', {
              pequeno: true,
              tipo: 'perigo',
              aoClicar: () =>
                confirmar('Excluir chamada?', `"${ferramenta.nome}" deixa de existir para os agentes.`, async () => {
                  await api.delete(`/api/custom-tools/${ferramenta.id}`);
                  aviso('Chamada excluida.', 'sucesso');
                  await recarregarTela();
                }, 'Excluir'),
            })
          : null,
      ]),
    );
  }

  if (!ferramentas.length) lista.append(el('div', { class: 'vazio', texto: 'Nenhuma chamada personalizada.' }));

  return cartaoAjustes(
    'Chamadas personalizadas',
    'Ligam os agentes a qualquer sistema que fale HTTP, n8n, Make, Zapier ou uma rota do proprio escritorio. Cada chamada vira uma mencao nova. Em toda execucao vai junto o rastro do anuncio (CTWA Clid), que e o que permite saber qual criativo gerou qual contrato.',
    el('div', { class: 'ajuste-linha larga' }, [lista]),
    rodapeAjustes(
      podeConfigurar()
        ? botao('Nova chamada', { pequeno: true, icone: 'mais', aoClicar: () => editarFerramenta(null, recarregarTela) })
        : null,
    ),
  );
}

function editarFerramenta(ferramenta, recarregarTela) {
  const nome = entradaTexto(ferramenta?.nome || '', { placeholder: 'consultar_cep' });
  const descricao = entradaTexto(ferramenta?.descricao || '', { placeholder: 'Consulta o endereco pelo CEP informado pelo lead' });
  const url = entradaTexto(ferramenta?.url || '', { placeholder: 'https://seu-n8n/webhook/abc' });
  const metodo = selecao(['POST', 'GET', 'PUT', 'DELETE'].map((m) => ({ valor: m, rotulo: m })), ferramenta?.metodo || 'POST');
  const schema = areaTexto(
    ferramenta?.schema
      ? JSON.stringify(ferramenta.schema, null, 2)
      : JSON.stringify(
          {
            type: 'object',
            required: ['cpf'],
            properties: { cpf: { type: 'string', description: 'CPF do lead, so numeros' } },
          },
          null,
          2,
        ),
    // .area-m mora em web/css/tema.css: altura de area de texto em passo fixo.
    { class: 'prompt area-m' },
  );

  gaveta({
    // Sem subtitulo: "o nome vira uma mencao no prompt" ja esta na dica do
    // titulo do cartao, e a lista atras da gaveta mostra cada chamada como
    // @nome, que e a mesma frase em forma de dado.
    titulo: ferramenta ? `Editar ${ferramenta.nome}` : 'Nova chamada personalizada',
    corpo: [
      campo('Nome', nome),
      campo('Metodo', metodo),
      campoComDica('Descricao', descricao, 'E o que o agente le para decidir quando chamar.'),
      campo('URL', url),
      // A mesma frase estava escrita tambem na gaveta de variaveis, em
      // Configuracoes. Ficou uma so, curta, e nos dois lugares dentro do balao.
      campoComDica(
        'Esquema dos dados (JSON Schema)',
        schema,
        'E pela descricao de cada propriedade que a IA sabe qual dado extrair.',
      ),
    ],
    confirmar: 'Salvar',
    aoConfirmar: async () => {
      if (!nome.value.trim() || !url.value.trim()) throw new Error('Nome e URL sao obrigatorios.');
      let esquema = null;
      try {
        esquema = JSON.parse(schema.value);
      } catch {
        throw new Error('O JSON Schema esta invalido.');
      }
      const dados = {
        nome: nome.value.trim(),
        descricao: descricao.value,
        url: url.value.trim(),
        metodo: metodo.value,
        schema: esquema,
      };
      if (ferramenta) await api.patch(`/api/custom-tools/${ferramenta.id}`, dados);
      else await api.post('/api/custom-tools', dados);
      aviso('Chamada salva.', 'sucesso');
      await recarregarTela();
    },
  });
}
