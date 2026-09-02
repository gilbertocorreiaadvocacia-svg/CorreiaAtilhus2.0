import { achar, inserir, listar, tabela } from './banco.js';
import { criarUsuario } from './auth.js';
import { novoId } from './util.js';

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
    ['posvenda', 'Pos-venda', 'var(--sucesso)'],
    ['juridico', 'Juridico', 'var(--serie-1)'],
    ['financeiro', 'Financeiro', 'var(--serie-3)'],
  ]) {
    dep[chave] = inserir('departamentos', { id: novoId('dep'), workspaceId, nome, cor }).id;
  }

  /* Status do funil ------------------------------------------------------ */
  const st = {};
  const statusIniciais = [
    ['nova', 'Nova conversa', 'var(--serie-1)', 'nova', dep.comercial, 'Lead que acabou de chamar e ainda nao foi triado.'],
    ['triagem', 'Em triagem', 'var(--serie-2)', 'analise', dep.comercial, 'Agente esta levantando os requisitos do beneficio.'],
    ['qualificado', 'Qualificado', 'var(--serie-3)', 'qualificado', dep.comercial, 'Passou nos criterios. Pode receber proposta.'],
    ['proposta', 'Proposta enviada', 'var(--serie-4)', 'proposta', dep.comercial, 'Recebeu o video e os honorarios.'],
    ['assinatura', 'Assinatura pendente', 'var(--serie-4)', 'proposta', dep.comercial, 'Contrato gerado, aguardando assinatura.'],
    ['sucesso', 'Contrato assinado', 'var(--sucesso)', 'sucesso', dep.posvenda, 'Fechou. Segue para coleta de documentos.'],
    ['documentos', 'Documentacao pendente', 'var(--serie-6)', 'nenhum', dep.posvenda, 'Cliente precisa enviar documentos.'],
    ['protocolado', 'Processo em andamento', 'var(--serie-6)', 'nenhum', dep.juridico, 'Ja protocolado. Cliente acompanha o andamento.'],
    ['desqualificado', 'Desqualificado', 'var(--serie-5)', 'desqualificado', null, 'Fora dos criterios do beneficio.'],
    ['recusada', 'Proposta recusada', 'var(--erro)', 'recusada', dep.comercial, 'Recusou os honorarios ou desistiu na proposta.'],
    ['desistencia', 'Desistencia', 'var(--serie-8)', 'desistencia', null, 'Parou de responder ate o fim da sequencia.'],
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
      'Ola {{nome}}, aqui e do escritorio Correia Advogados Associados.\n\nEu vou te ajudar a descobrir, sem compromisso, se voce tem direito ao beneficio. Sao poucas perguntas rapidas.\n\nPodemos comecar?',
    ],
    [
      'videoproposta',
      'Video da proposta',
      '{{nome}}, pelo que voce me contou, ha caminho para o seu caso.\n\nAssista ao video abaixo: em 1 minuto ele explica como funciona o nosso trabalho e como ficam os honorarios.',
    ],
    [
      'tutorialassinatura',
      'Tutorial de assinatura',
      'Enviei o contrato para o seu WhatsApp e para o seu e-mail.\n\nE so abrir o link, conferir os dados, desenhar a assinatura com o dedo e confirmar. Leva menos de 2 minutos e nao precisa de impressora.',
    ],
    [
      'contratoassinado',
      'Contrato assinado',
      'Contrato assinado, {{nome}}! Seja bem-vindo ao escritorio.\n\nA partir de agora o seu atendimento passa para a nossa equipe de documentacao, que ja vai te orientar sobre os proximos passos.',
    ],
    [
      'fu1',
      'Follow-up 1 - retomada',
      'Ola {{nome}}, vi que a nossa conversa parou. Ficou alguma duvida sobre o beneficio?\n\nEstou por aqui.',
    ],
    [
      'fu2',
      'Follow-up 2 - reforco',
      '{{nome}}, o escritorio ja ajudou centenas de pessoas na mesma situacao que a sua.\n\nSe quiser, retomamos de onde paramos, leva 2 minutos.',
    ],
    [
      'fu3',
      'Follow-up 3 - ultima tentativa',
      '{{nome}}, essa e a minha ultima tentativa de contato por aqui.\n\nSe mudar de ideia, e so responder esta mensagem que retomamos na hora. Um abraco!',
    ],
    [
      'documentos',
      'Lista de documentos',
      '{{nome}}, para dar entrada precisamos de:\n\n- RG e CPF\n- Comprovante de residencia atualizado\n- Carteira de trabalho (todas as paginas com registro)\n- Laudos, exames e receitas medicas\n- Extrato do CNIS, se ja tiver\n\nPode mandar por foto mesmo, uma de cada vez.',
    ],
    [
      'andamento',
      'Andamento do processo',
      '{{nome}}, o seu processo esta em andamento. Assim que houver movimentacao relevante eu te aviso por aqui.\n\nQualquer duvida, e so chamar.',
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
    descricao: 'Respostas para as objecoes mais comuns na fase de proposta.',
    conteudo: [
      'OBJECAO: "Quanto custa? Preciso pagar alguma coisa agora?"',
      'RESPOSTA: Nao ha nenhum custo hoje. O escritorio so recebe se o beneficio for concedido, no percentual combinado em contrato. Se nao ganhar, o cliente nao paga honorarios.',
      '',
      'OBJECAO: "Vou pensar / depois eu respondo."',
      'RESPOSTA: Combinado. So lembrando que quanto antes a gente entra, antes comeca a contar o prazo. Posso te mandar o contrato para voce ler com calma, sem compromisso?',
      '',
      'OBJECAO: "Ja tenho advogado."',
      'RESPOSTA: Entendo. Nesse caso nao seguimos, para nao atrapalhar o trabalho do colega. Se um dia precisar de uma segunda opiniao, estamos a disposicao.',
      '',
      'OBJECAO: "E se o INSS negar?"',
      'RESPOSTA: Negativa administrativa e comum e nao encerra o caso, e justamente ela que abre a via judicial. O escritorio acompanha as duas fases.',
      '',
      'OBJECAO: "Voce e robo?"',
      'RESPOSTA: Sou a assistente virtual do escritorio e faco a triagem inicial. Assim que os dados estiverem completos, um advogado assume a conversa.',
    ].join('\n'),
    arquivos: [],
  }).id;

  const baseBeneficios = inserir('conhecimento', {
    id: novoId('kb'),
    workspaceId,
    nome: 'Requisitos dos beneficios',
    descricao: 'Criterios objetivos usados na qualificacao.',
    conteudo: [
      'BPC/LOAS - Idoso: 65 anos ou mais, renda por pessoa da casa abaixo de 1/4 do salario minimo, inscricao no CadUnico.',
      'BPC/LOAS - Deficiencia: impedimento de longo prazo (2 anos ou mais) de natureza fisica, mental, intelectual ou sensorial, mesma regra de renda.',
      'Auxilio por incapacidade temporaria (auxilio-doenca): qualidade de segurado, carencia de 12 contribuicoes (dispensada em acidente) e incapacidade para o trabalho comprovada por laudo.',
      'Auxilio-acidente: sequela permanente que reduza a capacidade de trabalho, com nexo entre a lesao e o acidente. Indenizatorio, pode ser acumulado com salario.',
      'Salario-maternidade: nascimento, adocao ou guarda; carencia de 10 contribuicoes para contribuinte individual e facultativa; dispensada para empregada.',
      'Aposentadoria por tempo de contribuicao (regras de transicao): pedagio, pontos ou idade minima progressiva, conforme a data de filiacao.',
      'IMPORTANTE: nada disso vira promessa de resultado ao lead. O agente informa que ha caminho e que a analise final e do advogado.',
    ].join('\n'),
    arquivos: [],
  }).id;

  /* Agentes -------------------------------------------------------------- */
  const agentes = [
    {
      nome: 'Recepcao',
      objetivo: 'recepcionar',
      palavrasChave: [],
      prompt: [
        'Voce e a assistente virtual do escritorio Correia Advogados Associados. Fala em portugues do Brasil, com educacao e objetividade, frases curtas, sem juridiques e sem emoji em excesso.',
        '',
        'ROTEIRO OBRIGATORIO, siga na ordem, nao pule etapas mesmo que o lead pergunte outra coisa antes:',
        '1. Cumprimente pelo nome e envie @bemvindo.',
        '2. Pergunte: "Qual assunto voce precisa resolver: beneficio do INSS, questao trabalhista ou outro?"',
        '3. Conforme a resposta, transfira com @responsavel para o agente da area e ja envie a primeira pergunta dele, para o lead nao ficar esperando.',
        '',
        'REGRAS:',
        '- Nunca prometa resultado, valor ou prazo de concessao.',
        '- Se o lead disser que ja tem advogado, adicione a @tag "Tem advogado", altere o @status para "Desqualificado" e encerre com cordialidade.',
        '- Se o lead pedir atendimento humano, use @responsavel e avise que alguem do escritorio assume em seguida.',
        '- Se o nome do contato estiver estranho (apelido, emoji, numero), pergunte como prefere ser chamado e use @salvarnome.',
      ].join('\n'),
    },
    {
      nome: 'Triagem BPC/LOAS',
      objetivo: 'qualificar',
      palavrasChave: ['bpc', 'loas', 'beneficio assistencial'],
      prompt: [
        'Voce faz a triagem de BPC/LOAS para o escritorio Correia Advogados Associados.',
        '',
        'ROTEIRO (uma pergunta por vez, esperando a resposta antes da proxima:)',
        '1. "Quantos anos voce tem?" (salve em @idade.)',
        '2. Se 65 anos ou mais: siga pelo criterio de idoso. Se menos de 65: pergunte "Voce tem alguma doenca ou deficiencia que atrapalha o trabalho ou o dia a dia?" e salve em @doenca.',
        '3. "Voce ja recebe algum beneficio do INSS hoje?", se sim, explique que o BPC nao acumula com aposentadoria ou auxilio, adicione a @tag "Ja recebe beneficio" e altere o @status para "Desqualificado".',
        '4. "Quantas pessoas moram na sua casa, contando com voce?", salve em @pessoas_casa.',
        '5. "Somando tudo o que entra na casa por mes, salario, pensao, bolsa familia, quanto da mais ou menos?", salve em @renda.',
        '6. Use @calculadora e @think para dividir a renda pelo numero de pessoas e comparar com um quarto do salario minimo.',
        '',
        'DECISAO:',
        '- Dentro do criterio de renda: altere o @status para "Qualificado", adicione a @tag "BPC/LOAS", envie @videoproposta e transfira com @responsavel para o agente de proposta, ja fazendo a pergunta dele.',
        '- Fora do criterio: explique com gentileza, altere o @status para "Desqualificado" e ofereca analisar outro beneficio.',
        '- Duvida ou objecao: consulte @biblioteca antes de desqualificar.',
        '',
        'Antes de qualquer transferencia, gere @resumo com idade, doenca, renda, pessoas na casa e objecoes.',
      ].join('\n'),
    },
    {
      nome: 'Triagem Incapacidade',
      objetivo: 'qualificar',
      palavrasChave: ['auxilio doenca', 'auxilio-doenca', 'encostado', 'inss negou', 'pericia'],
      prompt: [
        'Voce faz a triagem de auxilio por incapacidade e auxilio-acidente para o escritorio Correia Advogados Associados.',
        '',
        'ROTEIRO (uma pergunta por vez:)',
        '1. "O que aconteceu com a sua saude? Foi doenca ou acidente?", salve em @doenca.',
        '2. "Voce esta trabalhando ou contribuindo para o INSS? Quando foi a ultima contribuicao?"',
        '3. "Voce tem laudo, exame ou atestado do medico?", salve em @laudo.',
        '4. "Voce ja deu entrada no INSS? Se sim, foi negado?"',
        '5. "Ficou alguma sequela que atrapalha o trabalho hoje?"',
        '',
        'DECISAO:',
        '- Com qualidade de segurado e laudo: altere o @status para "Qualificado", adicione a @tag do beneficio, envie @videoproposta e transfira com @responsavel para o agente de proposta.',
        '- Sem laudo: oriente a conseguir o documento, adicione a @tag "Urgente" se houver pressa e use @agendarretorno para o dia que ele disser que consegue. Quando ele mandar o laudo, use @removertag para tirar a etiqueta que nao vale mais.',
        '- Se o lead mandar foto de laudo, exame ou CNIS, leia o que esta escrito na imagem e use o dado. Nao peca de novo o que ja esta legivel na foto.',
        '- Sem qualidade de segurado ha muito tempo: explique o periodo de graca e consulte @biblioteca antes de alterar o @status para "Desqualificado".',
        '',
        'Antes de transferir, gere @resumo com o que foi apurado.',
        'Nunca afirme que o beneficio sera concedido. Diga que ha caminho e que o advogado confirma na analise.',
      ].join('\n'),
    },
    {
      nome: 'Proposta e Contrato',
      objetivo: 'fechar',
      palavrasChave: [],
      prompt: [
        'Voce cuida da proposta e do fechamento no escritorio Correia Advogados Associados.',
        '',
        'ROTEIRO:',
        '1. Confirme que o lead assistiu ao video e pergunte se ficou alguma duvida.',
        '2. Se houver objecao, consulte @biblioteca e responda sempre terminando com uma pergunta que continue a conversa.',
        '3. Aceitando, colete um dado por vez: nome completo, @cpf, @nascimento, @endereco e @email.',
        '4. Repita todos os dados coletados e peca a confirmacao explicita do lead.',
        '5. Confirmado, use @gerarcontrato, envie o link e em seguida @tutorialassinatura.',
        '6. Altere o @status para "Assinatura pendente".',
        '7. Quando a assinatura for confirmada, envie @contratoassinado, altere o @status para "Contrato assinado" e transfira com @responsavel para o pos-venda.',
        '',
        'REGRAS:',
        '- Prefira perguntas que pressupoem o fechamento: "voce prefere assinar pelo celular ou pelo computador?".',
        '- Se recusar, gere @resumo com o motivo, altere o @status para "Proposta recusada" e deixe a porta aberta.',
        '- Nunca negocie percentual fora da tabela do escritorio: nesse caso use @notificar e chame um responsavel humano.',
      ].join('\n'),
    },
    {
      nome: 'Pos-venda e Andamento',
      objetivo: 'atender',
      palavrasChave: ['andamento', 'meu processo', 'como esta o processo'],
      prompt: [
        'Voce atende clientes que ja assinaram contrato com o escritorio Correia Advogados Associados.',
        '',
        'ROTEIRO:',
        '1. Cumprimente pelo nome e pergunte em que pode ajudar.',
        '2. Se perguntar sobre andamento, peca o CPF, salve em @cpf e consulte @advbox.',
        '3. Explique a fase do processo em linguagem simples, sem termo tecnico, sem estimar prazo de decisao.',
        '4. Se pedir documentos, envie @documentos.',
        '5. Assunto financeiro, prazo judicial ou reclamacao: use @departamento para rotear e @notificar para avisar o responsavel.',
        '',
        'Nunca invente andamento. Se a consulta nao retornar nada, diga que vai verificar com a equipe e transfira.',
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
    responsavelPadrao: { tipo: 'agente', id: idsAgentes['Recepcao'] },
    oficial: { phoneNumberId: '', wabaId: '', token: '', verifyToken: '', appSecret: '' },
    conectadoEm: new Date().toISOString(),
  });

  /* Usuario administrador ------------------------------------------------ */
  const usuario = criarUsuario({
    nome: 'Administrador',
    email: 'admin@correia.adv.br',
    senha: 'correia2026',
  });

  inserir('membros', {
    id: novoId('mbr'),
    workspaceId,
    usuarioId: usuario.id,
    papel: 'administrador',
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
    nome: 'Nova conversa',
    cor: 'var(--serie-1)',
    tipo: 'nova',
    departamentoId: comercial,
    descricao: '',
    followups: [],
  });
}
