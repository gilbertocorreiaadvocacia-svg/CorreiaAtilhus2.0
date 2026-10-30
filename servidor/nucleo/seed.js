import { achar, atualizar, inserir, listar, tabela } from './banco.js';
import { criarUsuario } from './auth.js';
import { novoId } from './util.js';
import { migrarTiposDeCaso } from './casos.js';
import { migrarCanaisDeOrigem } from './origens.js';

/**
 * Primeira execucao: monta o workspace do escritorio ja com um funil que faz
 * sentido para previdenciario e trabalhista, os departamentos, os templates e
 * cinco agentes prontos. Nada disso e fixo, tudo pode ser editado na tela.
 */
export function semearSePrecisar() {
  if (tabela('workspaces').length) return null;

  const workspaceId = novoId('wks');

  inserir('workspaces', {
    id: workspaceId,
    nome: 'Correia Advogados',
    empresa: {
      nomeEscritorio: 'Correia Advogados Associados',
      responsavel: '',
      cnpj: '',
      oab: '',
      endereco: '',
      telefone: '',
      email: '',
      instagram: '',
      facebook: '',
      site: '',
      areaAtuacao: 'Previdenciario e Trabalhista',
    },
    horarioComercial: {
      fuso: 'America/Sao_Paulo',
      dias: {
        0: null,
        1: { de: '09:00', ate: '18:00' },
        2: { de: '09:00', ate: '18:00' },
        3: { de: '09:00', ate: '18:00' },
        4: { de: '09:00', ate: '18:00' },
        5: { de: '09:00', ate: '18:00' },
        6: { de: '09:00', ate: '12:00' },
      },
    },
    onboarding: {},
  });

  /* Departamentos ------------------------------------------------------- */
  const dep = {};
  for (const [chave, nome, cor] of [
    ['comercial', 'Comercial', 'var(--serie-2)'],
    ['juridico', 'Juridico', 'var(--serie-1)'],
    ['financeiro', 'Financeiro', 'var(--serie-3)'],
  ]) {
    dep[chave] = inserir('departamentos', { id: novoId('dep'), workspaceId, nome, cor }).id;
  }

  /* Status do funil ------------------------------------------------------ */
  const st = {};
  /* A ordem aqui e a ordem das colunas do Kanban (escolhida pelo escritorio em
     24/09). As chaves internas (nova, triagem...) nao mudam, so o nome que
     aparece — para agentes e codigo que ainda citarem um nome antigo
     continuarem achando o status pela chave. O departamento de Pos-venda foi
     removido (pedido do escritorio em 19/10/2026: so Comercial) — os status
     de depois-da-assinatura (sucesso, documentos) ficam em Comercial tambem. */
  const statusIniciais = [
    ['nova', 'NOVO lead', 'var(--serie-1)', 'nova', dep.comercial, 'Lead que acabou de chamar e ainda nao foi triado.'],
    ['triagem', 'Em análise', 'var(--serie-2)', 'analise', dep.comercial, 'Agente esta levantando os requisitos do beneficio.'],
    ['qualificado', 'Qualificado', 'var(--serie-3)', 'qualificado', dep.comercial, 'Passou nos criterios. Pode receber proposta.'],
    ['qualificado_objecao', 'Qualificado com objeção', 'var(--alerta)', 'qualificado', dep.comercial, 'Qualificado, mas levantou objecao (preco, prazo, confianca).'],
    ['recusada', 'Proposta recusada', 'var(--erro)', 'recusada', dep.comercial, 'Recusou os honorarios ou desistiu na proposta.'],
    ['proposta', 'Preparar kit', 'var(--serie-4)', 'proposta', dep.comercial, 'Proposta aceita: preparar o contrato e a procuracao.'],
    ['assinatura', 'Assinatura pendente', 'var(--serie-4)', 'proposta', dep.comercial, 'Contrato gerado, aguardando assinatura.'],
    ['desistencia', 'Desistencia', 'var(--serie-8)', 'desistencia', null, 'Parou de responder ate o fim da sequencia.'],
    ['sucesso', 'Contrato fechado', 'var(--sucesso)', 'sucesso', dep.comercial, 'Fechou. Segue para coleta de documentos.'],
    ['desqualificado', 'Desqualificado', 'var(--serie-5)', 'desqualificado', null, 'Fora dos criterios do beneficio.'],
    ['followup', 'Follow up', 'var(--serie-6)', 'nenhum', dep.comercial, 'Retomar depois: aguardando um retorno combinado.'],
    ['documentos', 'Documentacao pendente', 'var(--serie-7)', 'nenhum', dep.comercial, 'Cliente precisa enviar documentos.'],
    ['protocolado', 'Processo em andamento', 'var(--serie-6)', 'nenhum', dep.juridico, 'Ja protocolado. Cliente acompanha o andamento.'],
  ];
  for (const [chave, nome, cor, tipo, departamentoId, descricao] of statusIniciais) {
    st[chave] = inserir('status', {
      id: novoId('sts'),
      workspaceId,
      nome,
      cor,
      tipo,
      departamentoId,
      descricao,
      followups: [],
    }).id;
  }

  /* Etiquetas ------------------------------------------------------------ */
  for (const [nome, cor] of [
    ['Urgente', 'var(--erro)'],
    ['BPC/LOAS', 'var(--serie-2)'],
    ['Auxilio-doenca', 'var(--serie-1)'],
    ['Auxilio-acidente', 'var(--serie-3)'],
    ['Aposentadoria', 'var(--sucesso)'],
    ['Trabalhista', 'var(--serie-6)'],
    ['Ja recebe beneficio', 'var(--serie-5)'],
    ['Tem advogado', 'var(--serie-8)'],
    ['Idoso', 'var(--serie-4)'],
  ]) {
    inserir('etiquetas', { id: novoId('etq'), workspaceId, nome, cor });
  }

  /* Origens -------------------------------------------------------------- */
  for (const [nome, palavrasChave] of [
    ['Anuncio Facebook', ['vi o anuncio', 'facebook']],
    ['Anuncio Instagram', ['instagram', 'insta']],
    ['Indicacao', ['indicacao', 'indicou', 'me indicaram']],
    ['Google', ['google', 'pesquisei']],
    ['Organico', []],
  ]) {
    inserir('origens', { id: novoId('org'), workspaceId, nome, palavrasChave });
  }

  /* Variaveis personalizadas -------------------------------------------- */
  for (const [nome, chave, descricao] of [
    ['CPF', 'cpf', 'CPF do lead, so numeros.'],
    ['E-mail', 'email', 'E-mail para envio do contrato.'],
    ['Data de nascimento', 'nascimento', 'Data de nascimento no formato DD/MM/AAAA.'],
    ['Idade', 'idade', 'Idade em anos, so o numero.'],
    ['Renda familiar', 'renda', 'Renda mensal da familia, so o valor numerico.'],
    ['Pessoas na casa', 'pessoas_casa', 'Quantidade de pessoas que moram na residencia.'],
    ['Cidade', 'cidade', 'Cidade onde o lead mora.'],
    ['Endereco completo', 'endereco', 'Endereco com rua, numero, bairro, cidade e CEP.'],
    ['Doenca ou lesao', 'doenca', 'Doenca, lesao ou sequela relatada pelo lead.'],
    ['Tem laudo medico', 'laudo', 'Sim ou nao.'],
    ['Profissao', 'profissao', 'Profissao ou ultimo trabalho registrado.'],
  ]) {
    inserir('variaveis', { id: novoId('var'), workspaceId, nome, chave, descricao, tipo: 'texto' });
  }

  /* Templates ------------------------------------------------------------ */
  const tpl = {};
  const templatesIniciais = [
    [
      'bemvindo',
      'Boas-vindas',
      'Olá {{nome}}, aqui é do escritório Correia Advogados Associados.\n\nEu vou te ajudar a descobrir, sem compromisso, se você tem direito ao benefício. São poucas perguntas rápidas.\n\nPodemos começar?',
    ],
    [
      'videoproposta',
      'Vídeo da proposta',
      '{{nome}}, pelo que você me contou, há caminho para o seu caso.\n\nAssista ao vídeo abaixo: em 1 minuto ele explica como funciona o nosso trabalho e como ficam os honorários.',
    ],
    [
      'tutorialassinatura',
      'Tutorial de assinatura',
      'Enviei o contrato para o seu WhatsApp e para o seu e-mail.\n\nÉ só abrir o link, conferir os dados, desenhar a assinatura com o dedo e confirmar. Leva menos de 2 minutos e não precisa de impressora.',
    ],
    [
      'contratoassinado',
      'Contrato assinado',
      'Contrato assinado, {{nome}}! Seja bem-vindo ao escritório.\n\nA partir de agora o seu atendimento passa para a nossa equipe de documentação, que já vai te orientar sobre os próximos passos.',
    ],
    [
      'fu1',
      'Follow-up 1 - retomada',
      'Olá {{nome}}, vi que a nossa conversa parou. Ficou alguma dúvida sobre o benefício?\n\nEstou por aqui.',
    ],
    [
      'fu2',
      'Follow-up 2 - reforço',
      '{{nome}}, o escritório já ajudou centenas de pessoas na mesma situação que a sua.\n\nSe quiser, retomamos de onde paramos, leva 2 minutos.',
    ],
    [
      'fu3',
      'Follow-up 3 - última tentativa',
      '{{nome}}, essa é a minha última tentativa de contato por aqui.\n\nSe mudar de ideia, é só responder esta mensagem que retomamos na hora. Um abraço!',
    ],
    [
      'documentos',
      'Lista de documentos',
      '{{nome}}, para dar entrada precisamos de:\n\n- RG e CPF\n- Comprovante de residência atualizado\n- Carteira de trabalho (todas as páginas com registro)\n- Laudos, exames e receitas médicas\n- Extrato do CNIS, se já tiver\n\nPode mandar por foto mesmo, uma de cada vez.',
    ],
    [
      'andamento',
      'Andamento do processo',
      '{{nome}}, o seu processo está em andamento. Assim que houver movimentação relevante eu te aviso por aqui.\n\nQualquer dúvida, é só chamar.',
    ],
  ];
  for (const [atalho, nome, conteudo] of templatesIniciais) {
    tpl[atalho] = inserir('templates', {
      id: novoId('tpl'),
      workspaceId,
      nome,
      atalho,
      conteudo,
      midia: null,
      categoriaMeta: 'utilidade',
      aprovacaoMeta: { solicitada: false, situacao: 'nao_solicitada' },
    }).id;
  }

  /* Follow-ups do funil -------------------------------------------------- */
  const seqPadrao = (statusFinalId) => [
    { id: novoId('fup'), templateId: tpl.fu1, minutos: 60, desistir: null },
    { id: novoId('fup'), templateId: tpl.fu2, minutos: 60 * 24, desistir: null },
    {
      id: novoId('fup'),
      templateId: tpl.fu3,
      minutos: 60 * 24 * 3,
      desistir: { ativo: true, statusId: statusFinalId, responsavel: null, arquivar: true },
    },
  ];
  const statusQualificado = achar('status', st.qualificado);
  statusQualificado.followups = seqPadrao(st.desistencia);
  const statusProposta = achar('status', st.proposta);
  statusProposta.followups = seqPadrao(st.desistencia);
  const statusAssinatura = achar('status', st.assinatura);
  statusAssinatura.followups = [
    { id: novoId('fup'), templateId: tpl.tutorialassinatura, minutos: 60 * 4, desistir: null },
    {
      id: novoId('fup'),
      templateId: tpl.fu3,
      minutos: 60 * 24 * 2,
      desistir: { ativo: true, statusId: st.desistencia, responsavel: null, arquivar: true },
    },
  ];

  /* Base de conhecimento ------------------------------------------------- */
  const baseObjecoes = inserir('conhecimento', {
    id: novoId('kb'),
    workspaceId,
    nome: 'Quebra de objecoes',
    descricao: 'Respostas para as objeções mais comuns na fase de proposta.',
    conteudo: [
      'OBJEÇÃO: "Quanto custa? Preciso pagar alguma coisa agora?"',
      'RESPOSTA: Não há nenhum custo hoje. O escritório só recebe se o benefício for concedido, no percentual combinado em contrato. Se não ganhar, o cliente não paga honorários.',
      '',
      'OBJEÇÃO: "Vou pensar / depois eu respondo."',
      'RESPOSTA: Combinado. Só lembrando que quanto antes a gente entra, antes começa a contar o prazo. Posso te mandar o contrato para você ler com calma, sem compromisso?',
      '',
      'OBJEÇÃO: "Já tenho advogado."',
      'RESPOSTA: Entendo. Nesse caso não seguimos, para não atrapalhar o trabalho do colega. Se um dia precisar de uma segunda opinião, estamos à disposição.',
      '',
      'OBJEÇÃO: "E se o INSS negar?"',
      'RESPOSTA: Negativa administrativa é comum e não encerra o caso, é justamente ela que abre a via judicial. O escritório acompanha as duas fases.',
      '',
      'OBJEÇÃO: "Você é robô?"',
      'RESPOSTA: Sou a assistente virtual do escritório e faço a triagem inicial. Assim que os dados estiverem completos, um advogado assume a conversa.',
    ].join('\n'),
    arquivos: [],
  }).id;

  const baseBeneficios = inserir('conhecimento', {
    id: novoId('kb'),
    workspaceId,
    nome: 'Requisitos dos benefícios',
    descricao: 'Critérios objetivos usados na qualificação.',
    conteudo: [
      'BPC/LOAS - Idoso: 65 anos ou mais, renda por pessoa da casa abaixo de 1/4 do salário mínimo, inscrição no CadÚnico.',
      'BPC/LOAS - Deficiência: impedimento de longo prazo (2 anos ou mais) de natureza física, mental, intelectual ou sensorial, mesma regra de renda.',
      'Auxílio por incapacidade temporária (auxílio-doença): qualidade de segurado, carência de 12 contribuições (dispensada em acidente) e incapacidade para o trabalho comprovada por laudo.',
      'Auxílio-acidente: sequela permanente que reduza a capacidade de trabalho, com nexo entre a lesão e o acidente. Indenizatório, pode ser acumulado com salário.',
      'Salário-maternidade: nascimento, adoção ou guarda; carência de 10 contribuições para contribuinte individual e facultativa; dispensada para empregada.',
      'Aposentadoria por tempo de contribuição (regras de transição): pedágio, pontos ou idade mínima progressiva, conforme a data de filiação.',
      'IMPORTANTE: nada disso vira promessa de resultado ao lead. O agente informa que há caminho e que a análise final é do advogado.',
    ].join('\n'),
    arquivos: [],
  }).id;

  /* Agentes -------------------------------------------------------------- */
  const agentes = [
    {
      nome: 'Triagem',
      objetivo: 'recepcionar',
      palavrasChave: [],
      prompt: [
        'Você é a assistente virtual do escritório Correia Advogados Associados. Fala em português do Brasil, com educação e objetividade, frases curtas, sem juridiquês e sem emoji em excesso.',
        '',
        'ROTEIRO OBRIGATÓRIO, siga na ordem, não pule etapas mesmo que o lead pergunte outra coisa antes:',
        '1. Cumprimente pelo nome e envie @bemvindo.',
        '2. Pergunte: "Qual assunto você precisa resolver: benefício do INSS, questão trabalhista ou outro?"',
        '3. Conforme a resposta, transfira com @responsavel para o agente da área e já envie a primeira pergunta dele, para o lead não ficar esperando.',
        '',
        'REGRAS:',
        '- Nunca prometa resultado, valor ou prazo de concessão.',
        '- Se o lead disser que já tem advogado, adicione a @tag "Tem advogado", altere o @status para "Desqualificado" e encerre com cordialidade.',
        '- Se o lead pedir atendimento humano, use @responsavel e avise que alguém do escritório assume em seguida.',
        '- Se o nome do contato estiver estranho (apelido, emoji, número), pergunte como prefere ser chamado e use @salvarnome.',
      ].join('\n'),
    },
    {
      nome: 'Triagem BPC/LOAS',
      objetivo: 'qualificar',
      palavrasChave: ['bpc', 'loas', 'beneficio assistencial'],
      prompt: [
        'Você faz a triagem de BPC/LOAS para o escritório Correia Advogados Associados.',
        '',
        'ROTEIRO (uma pergunta por vez, esperando a resposta antes da próxima:)',
        '1. "Quantos anos você tem?" (salve em @idade.)',
        '2. Se 65 anos ou mais: siga pelo critério de idoso. Se menos de 65: pergunte "Você tem alguma doença ou deficiência que atrapalha o trabalho ou o dia a dia?" e salve em @doenca.',
        '3. "Você já recebe algum benefício do INSS hoje?", se sim, explique que o BPC não acumula com aposentadoria ou auxílio, adicione a @tag "Já recebe benefício" e altere o @status para "Desqualificado".',
        '4. "Quantas pessoas moram na sua casa, contando com você?", salve em @pessoas_casa.',
        '5. "Somando tudo o que entra na casa por mês, salário, pensão, bolsa família, quanto dá mais ou menos?", salve em @renda.',
        '6. Use @calculadora e @think para dividir a renda pelo número de pessoas e comparar com um quarto do salário mínimo.',
        '',
        'DECISÃO:',
        '- Dentro do critério de renda: altere o @status para "Qualificado", adicione a @tag "BPC/LOAS", envie @videoproposta e transfira com @responsavel para o agente de proposta, já fazendo a pergunta dele.',
        '- Fora do critério: explique com gentileza, altere o @status para "Desqualificado" e ofereça analisar outro benefício.',
        '- Dúvida ou objeção: consulte @biblioteca antes de desqualificar.',
        '',
        'Antes de qualquer transferência, gere @resumo com idade, doença, renda, pessoas na casa e objeções.',
      ].join('\n'),
    },
    {
      nome: 'Triagem Incapacidade',
      objetivo: 'qualificar',
      palavrasChave: ['auxilio doenca', 'auxilio-doenca', 'encostado', 'inss negou', 'pericia'],
      prompt: [
        'Você faz a triagem de auxílio por incapacidade e auxílio-acidente para o escritório Correia Advogados Associados.',
        '',
        'ROTEIRO (uma pergunta por vez:)',
        '1. "O que aconteceu com a sua saúde? Foi doença ou acidente?", salve em @doenca.',
        '2. "Você está trabalhando ou contribuindo para o INSS? Quando foi a última contribuição?"',
        '3. "Você tem laudo, exame ou atestado do médico?", salve em @laudo.',
        '4. "Você já deu entrada no INSS? Se sim, foi negado?"',
        '5. "Ficou alguma sequela que atrapalha o trabalho hoje?"',
        '',
        'DECISÃO:',
        '- Com qualidade de segurado e laudo: altere o @status para "Qualificado", adicione a @tag do benefício, envie @videoproposta e transfira com @responsavel para o agente de proposta.',
        '- Sem laudo: oriente a conseguir o documento, adicione a @tag "Urgente" se houver pressa e use @agendarretorno para o dia que ele disser que consegue. Quando ele mandar o laudo, use @removertag para tirar a etiqueta que não vale mais.',
        '- Se o lead mandar foto de laudo, exame ou CNIS, leia o que está escrito na imagem e use o dado. Não peça de novo o que já está legível na foto.',
        '- Sem qualidade de segurado há muito tempo: explique o período de graça e consulte @biblioteca antes de alterar o @status para "Desqualificado".',
        '',
        'Antes de transferir, gere @resumo com o que foi apurado.',
        'Nunca afirme que o benefício será concedido. Diga que há caminho e que o advogado confirma na análise.',
      ].join('\n'),
    },
    {
      nome: 'Proposta e Contrato',
      objetivo: 'fechar',
      palavrasChave: [],
      prompt: [
        'Você cuida da proposta e do fechamento no escritório Correia Advogados Associados.',
        '',
        'ROTEIRO:',
        '1. Confirme que o lead assistiu ao vídeo e pergunte se ficou alguma dúvida.',
        '2. Se houver objeção, consulte @biblioteca e responda sempre terminando com uma pergunta que continue a conversa.',
        '3. Aceitando, colete um dado por vez: nome completo, @cpf, @nascimento, @endereco e @email.',
        '4. Repita todos os dados coletados e peça a confirmação explícita do lead.',
        '5. Confirmado, use @gerarcontrato, envie o link e em seguida @tutorialassinatura.',
        '6. Altere o @status para "Assinatura pendente".',
        '7. Quando a assinatura for confirmada, envie @contratoassinado, altere o @status para "Contrato fechado" e transfira com @responsavel para o pós-venda.',
        '',
        'REGRAS:',
        '- Prefira perguntas que pressupõem o fechamento: "você prefere assinar pelo celular ou pelo computador?".',
        '- Se recusar, gere @resumo com o motivo, altere o @status para "Proposta recusada" e deixe a porta aberta.',
        '- Nunca negocie percentual fora da tabela do escritório: nesse caso use @notificar e chame um responsável humano.',
      ].join('\n'),
    },
    {
      nome: 'Pós-venda e Andamento',
      objetivo: 'atender',
      palavrasChave: ['andamento', 'meu processo', 'como esta o processo'],
      prompt: [
        'Você atende clientes que já assinaram contrato com o escritório Correia Advogados Associados.',
        '',
        'ROTEIRO:',
        '1. Cumprimente pelo nome e pergunte em que pode ajudar.',
        '2. Se perguntar sobre andamento, peça o CPF, salve em @cpf e consulte @advbox.',
        '3. Explique a fase do processo em linguagem simples, sem termo técnico, sem estimar prazo de decisão.',
        '4. Se pedir documentos, envie @documentos.',
        '5. Assunto financeiro, prazo judicial ou reclamação: use @departamento para rotear e @notificar para avisar o responsável.',
        '',
        'Nunca invente andamento. Se a consulta não retornar nada, diga que vai verificar com a equipe e transfira.',
      ].join('\n'),
    },
  ];

  const idsAgentes = {};
  for (const dados of agentes) {
    const registro = inserir('agentes', {
      id: novoId('agn'),
      workspaceId,
      nome: dados.nome,
      objetivo: dados.objetivo,
      prompt: dados.prompt,
      palavrasChave: dados.palavrasChave,
      modelo: 'claude-sonnet-5',
      delaySegundos: 15,
      conhecimentoIds: [baseObjecoes, baseBeneficios],
      vozId: null,
      modoAudio: false,
      pasta: 'Meus Agentes',
      /* Sem foto, o avatar do sistema desenha as iniciais. O campo nasce aqui
         para o registro ter a mesma forma venha ele da semente ou da tela. */
      foto: null,
      ativo: true,
    });
    idsAgentes[dados.nome] = registro.id;
  }

  /* Conexao inicial em modo simulador ------------------------------------ */
  inserir('conexoes', {
    id: novoId('cnx'),
    workspaceId,
    nome: 'Comercial (simulador)',
    tipo: 'simulador',
    numero: '5500000000000',
    estado: 'conectado',
    statusPadraoId: st.nova,
    departamentoPadraoId: dep.comercial,
    responsavelPadrao: { tipo: 'agente', id: idsAgentes['Triagem'] },
    oficial: { phoneNumberId: '', wabaId: '', token: '', verifyToken: '', appSecret: '' },
    conectadoEm: new Date().toISOString(),
  });

  /* Usuario administrador ------------------------------------------------ */
  const usuario = criarUsuario({
    nome: 'Administrador',
    email: 'admin@correia.adv.br',
    senha: 'correia2026',
  });

  /* So nos testes: o segundo fator ja nasce pareado com um segredo conhecido,
     para a suite poder calcular o codigo e entrar. CORREIA_2FA_SEMENTE nunca e
     definida em producao — la o administrador pareia o proprio app no primeiro
     login, como todo mundo. */
  if (process.env.CORREIA_2FA_SEMENTE) {
    atualizar('usuarios', usuario.id, {
      doisFatores: { ativo: true, segredo: process.env.CORREIA_2FA_SEMENTE, codigosReserva: [], confirmadoEm: new Date().toISOString() },
    });
  }

  inserir('membros', {
    id: novoId('mbr'),
    workspaceId,
    usuarioId: usuario.id,
    papel: 'owner',
    departamentos: ['*'],
    conexoes: ['*'],
    modoFoco: false,
    assinaturaAtiva: false,
  });

  inserir('integracoes', {
    id: novoId('int'),
    workspaceId,
    zapsign: { chave: '', modelos: [], ativo: false },
    googleCalendar: { conectado: false, agenda: '', duracaoPadrao: 30, disponibilidade: null },
    advbox: { chave: '', ativo: false, descricoesStatus: {} },
    customTools: [],
    ia: { provedor: 'anthropic', chaveAnthropic: '', chaveOpenai: '' },
  });

  return { workspaceId, usuarioId: usuario.id };
}

/** Cria as classes basicas quando um workspace novo e aberto do zero. */
export function semearWorkspace(workspaceId, { clonarDe = null } = {}) {
  if (clonarDe) {
    for (const colecao of ['departamentos', 'status', 'etiquetas', 'origens', 'variaveis', 'templates']) {
      for (const registro of listar(colecao, { workspaceId: clonarDe })) {
        const { id, criadoEm, atualizadoEm, ...resto } = registro;
        inserir(colecao, { ...resto, workspaceId, id: novoId(colecao.slice(0, 3)) });
      }
    }
    return;
  }
  const comercial = inserir('departamentos', {
    id: novoId('dep'),
    workspaceId,
    nome: 'Comercial',
    cor: 'var(--serie-2)',
  }).id;
  inserir('status', {
    id: novoId('sts'),
    workspaceId,
    nome: 'NOVO lead',
    cor: 'var(--serie-1)',
    tipo: 'nova',
    departamentoId: comercial,
    descricao: '',
    followups: [],
  });
  /* Workspace novo ja nasce com os tipos de caso, os momentos e as origens de
     anuncio: sem isso so ganharia os tres na proxima vez que o servidor subisse. */
  migrarTiposDeCaso();
  migrarCanaisDeOrigem();
}
