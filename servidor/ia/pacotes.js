import { inserir, listar } from '../nucleo/banco.js';
import { normalizar, novoId } from '../nucleo/util.js';
import { AUXILIO_ACIDENTE } from './pacotes/auxilio-acidente.js';
import { avaliadorDoEscritorio } from './pacotes/avaliacao.js';
import { BPC } from './pacotes/bpc.js';
import { MATERNIDADE } from './pacotes/maternidade.js';
import { AGENTE_26 } from './pacotes/suporte.js';
import { EDUARDA } from './pacotes/triagem.js';
import { TRABALHISTA } from './pacotes/trabalhista.js';

/**
 * Pacotes de agentes por area.
 *
 * Previdenciario e Trabalhista sao os squads que o escritorio usava na LiderHub
 * (prompts extraidos em 15/09/2026), cada um no seu escritorio: no
 * Previdenciario, a Eduarda recebe e passa para os squads de auxilio-acidente,
 * BPC/LOAS e salario-maternidade; no Trabalhista, o AG01 recebe e passa para os
 * membros AG02 a AG08. O Civel continua com o pacote proprio.
 *
 * As mencoes da LiderHub foram trocadas pelas deste sistema:
 *   status "#01 Novo Lead" ... "#14"   -> @status com os nomes do funil daqui
 *   etiquetas e departamentos          -> @tag e @departamento, pelo nome
 *   "altere para @agente"              -> passe com @responsavel para @agente
 *   pessoa da equipe                   -> @responsavel com o nome entre aspas
 *   @Desativar IA, @Salvar Nome        -> @desativarIA, @salvarnome
 *   @Calculadora, @Data e hora atual   -> @calculadora, @dataehora
 *   @Base de conhecimento              -> @biblioteca
 *   @CONTRATO ...                      -> @gerarcontrato (com conferencia)
 *   @video-qualificado-proposta etc.   -> templates pelo atalho
 *   @Nome do escritorio, @CNPJ...      -> DADOS DO ESCRITORIO, no contexto
 *
 * Instalar um pacote NUNCA sobrescreve: agente com o mesmo nome fica como esta,
 * porque o escritorio pode ter afinado o prompt dele. Com `substituir`, a rota
 * tira antes os agentes que o escritorio tem (ver rotas/automacoes.js). Os nomes
 * sao unicos entre as areas de proposito: a transferencia acha o destino pelo
 * nome.
 *
 * Tudo o que os prompts citam pelo nome (etiqueta, departamento, template e
 * variavel) e criado pela instalacao quando falta (prepararEscritorio):
 * mencao ao que nao existe fica vermelha na tela e deixa o agente sem a acao.
 */

/* As regras que valem para todo agente do pacote Civel. */
const REGRAS_DE_SEMPRE = [
  '',
  'REGRAS DE SEMPRE',
  '- Voce fala pelo WhatsApp do escritorio Correia Advogados Associados, em portugues do Brasil, com frases curtas, uma pergunta por vez, sem juridiques e sem emoji em excesso.',
  '- Nunca prometa resultado, valor de beneficio, indenizacao ou prazo. Diga que ha caminho e que o advogado confirma na analise.',
  '- Nunca peca senha do gov.br, de banco ou de aplicativo. Se o cliente mandar uma senha, diga que nao precisa e nao a repita em lugar nenhum, nem no resumo.',
  '- Documento em foto: leia o que estiver legivel e use o dado; peca nova foto so do campo que nao deu para ler.',
  '- A cada avanco, marque o @momento que descreve onde o lead esta agora.',
  '- Ao passar a conversa com @responsavel, escreva no resumo_para_proximo tudo o que ja foi apurado, para ninguem perguntar de novo.',
  '- Se o cliente pedir para falar com uma pessoa, estiver muito abalado ou o caso sair do seu roteiro, passe com @responsavel para "distribuir" e avise que alguem do escritorio assume em seguida.',
  '- Se o lead disser que ja tem advogado cuidando do caso, altere o @status para "Desqualificado" e encerre com cordialidade.',
];

const montar = (...blocos) => [...blocos.flat(), ...REGRAS_DE_SEMPRE].join('\n');

function proposta(explicacao) {
  return montar(
    'QUEM VOCE E',
    'Voce cuida da proposta e do fechamento. A conversa chega do especialista com o caso qualificado e um resumo: leia a passagem antes de falar e nao repita perguntas ja respondidas.',
    '',
    'ROTEIRO',
    `1. ${explicacao} Pergunte se ficou alguma duvida e marque o @momento "Tirando duvidas".`,
    '2. Responda as objecoes consultando @biblioteca, sempre terminando com uma pergunta que continue a conversa.',
    '3. Aceitando, colete um dado por vez: nome completo (corrija com @salvarnome), @cpf, @nascimento, @estado_civil, @profissao, @endereco completo com CEP e @email.',
    '4. Repita todos os dados coletados e peca a confirmacao explicita do cliente.',
    '5. Confirmado, use @gerarcontrato. O contrato e a procuracao passam pela conferencia de uma pessoa do escritorio antes de o link sair: diga isso ao cliente, e que o link para assinar chega por esta conversa.',
    '6. Altere o @status para "Assinatura pendente".',
    '',
    'REGRAS DA PROPOSTA',
    '- Nunca negocie percentual ou valor fora da tabela do escritorio: use @notificar para chamar um responsavel humano e diga que ele retorna.',
    '- Se o cliente recusar, pergunte o motivo com respeito, altere o @status para "Proposta recusada" e deixe a porta aberta.',
    '- Se ele preferir falar por telefone antes de fechar, use @calendario para marcar uma ligacao (tipo ligacao), sem sobrepor horario ocupado.',
  );
}

/* Os dados que os contratos pedem, iguais nas duas areas da LiderHub. */
const DADOS_DO_CONTRATO = [
  ['nome_completo', 'Nome completo', 'Nome completo como no documento.'],
  ['cpf', 'CPF', 'CPF do cliente, so numeros.'],
  ['rg', 'RG', 'Numero do RG.'],
  ['estado_civil', 'Estado civil', 'Solteiro, casado, uniao estavel, divorciado ou viuvo.'],
  ['profissao', 'Profissao', 'Profissao ou ultimo trabalho.'],
  ['nacionalidade', 'Nacionalidade', 'Nacionalidade do cliente.'],
  ['endereco_completo', 'Endereco completo', 'Rua, numero, bairro, cidade, estado e CEP.'],
  ['email', 'E-mail', 'E-mail do cliente, ou sem@email.com.'],
  ['telefone', 'Telefone da ficha', 'Telefone com DDD que vai no contrato.'],
  ['nome_contato_emergencia', 'Contato de recado', 'Nome e parentesco de quem pode dar recado.'],
  ['telefone_contato_emergencia', 'Telefone de recado', 'Telefone com DDD do contato de recado.'],
];

/*
 * Templates que os roteiros enviam pelo atalho. Criados so quando faltam, com
 * um texto que ja pode ir para o cliente: o escritorio anexa o video ou o audio
 * dele em Configuracoes > Templates.
 */
const TEMPLATES = {
  bemvindo: [
    'Boas-vindas',
    'Olá {{nome}}, aqui é do escritório Correia Advogados Associados. Vou te ajudar a descobrir, sem compromisso, se você tem direito. São poucas perguntas rápidas.',
  ],
  videoproposta: [
    'Vídeo da proposta',
    '{{nome}}, pelo que você me contou, há caminho para o seu caso. Neste vídeo explicamos em 1 minuto como funciona o nosso trabalho e como ficam os honorários.',
  ],
  tutorialassinatura: [
    'Tutorial de assinatura',
    'Para assinar é só abrir o link, conferir os dados, desenhar a assinatura com o dedo e confirmar. Leva menos de 2 minutos e não precisa de impressora.',
  ],
  oab: [
    'OAB do advogado',
    'Pode conferir: o escritório tem advogado responsável inscrito na OAB, e a inscrição é pública no site da OAB. Somos um escritório de verdade.',
  ],
  propostatrabalhista: [
    'Proposta trabalhista',
    '{{nome}}, funciona assim: você não paga nada para entrar com o processo. Nós só recebemos se você receber, com uma parte do que a empresa pagar.',
  ],
  propostaauxacidente: [
    'Proposta auxílio-acidente',
    '{{nome}}, você não paga nada para entrar. Só recebemos se o benefício sair: os honorários saem dos atrasados, e depois o benefício é todo seu.',
  ],
  recepcaotrabalhista: [
    'Boas-vindas trabalhista',
    'Salva este número na sua agenda, assim você não perde nenhuma mensagem nossa sobre o seu caso.',
  ],
  avaliacao: [
    'Avaliação no Google',
    '⭐ Avalie o escritório no Google: https://share.google/BQzxyIyNBxlRwmeJN',
  ],
};

export const PACOTES = {
  previdenciario: {
    nome: 'Previdenciário',
    pasta: 'Previdenciário',
    bases: ['objec', 'beneficio'],
    departamentos: [
      ['Comercial', 'var(--serie-2)'],
      ['Suporte', 'var(--serie-6)'],
      ['Juridico', 'var(--serie-1)'],
    ],
    etiquetas: [
      ['BPC/LOAS', 'var(--serie-2)'],
      ['Auxilio-acidente', 'var(--serie-3)'],
      ['Salario-maternidade', 'var(--serie-8)'],
      ['Acidente', 'var(--serie-4)'],
      ['Doença', 'var(--serie-5)'],
      ['Idoso', 'var(--serie-4)'],
      ['Tem advogado', 'var(--serie-8)'],
      ['Falta laudo', 'var(--alerta)'],
      ['Objeção', 'var(--serie-7)'],
      ['Já é cliente', 'var(--sucesso)'],
      ['Trabalhista', 'var(--serie-6)'],
    ],
    templates: ['bemvindo', 'videoproposta', 'tutorialassinatura', 'oab', 'avaliacao'],
    variaveis: [
      ...DADOS_DO_CONTRATO,
      ['nome_pai', 'Nome do pai', 'Nome do pai, como no documento.'],
      ['nome_mae', 'Nome da mae', 'Nome da mae, como no documento.'],
      ['idade', 'Idade', 'Idade em anos, so o numero.'],
      ['pessoas_casa', 'Pessoas na casa', 'Quantidade de pessoas que moram na residencia.'],
      ['renda', 'Renda familiar', 'Renda mensal da casa, so o valor numerico.'],
      ['doenca', 'Doenca ou sequela', 'Doenca, deficiencia ou sequela relatada.'],
      ['laudo', 'Tem laudo medico', 'Sim ou nao, e de quando.'],
      ['qualidade_segurado', 'Qualidade de segurado', 'Se contribuia ou tinha carteira na epoca.'],
      ['data_parto', 'Data do parto ou adocao', 'Data do nascimento, da adocao ou prevista, DD/MM/AAAA.'],
    ],
    /* As pastas com os nomes que o escritorio usava na LiderHub. */
    agentes: [
      EDUARDA,
      ...AUXILIO_ACIDENTE.map((agente) => ({ ...agente, pasta: 'Auxílio-Acidente FER MAR26' })),
      ...BPC.map((agente) => ({ ...agente, pasta: 'BPC Loas' })),
      ...MATERNIDADE.map((agente) => ({ ...agente, pasta: 'Salário Maternidade' })),
      avaliadorDoEscritorio('Previdenciário'),
    ],
  },

  trabalhista: {
    nome: 'Trabalhista',
    pasta: 'Trabalhista',
    bases: ['objec'],
    departamentos: [
      ['Comercial', 'var(--serie-2)'],
      ['Suporte', 'var(--serie-6)'],
      ['Pos-venda', 'var(--sucesso)'],
    ],
    etiquetas: [
      ['Trabalhista', 'var(--serie-6)'],
      ['Acidente de trabalho ou doença ocupacional', 'var(--serie-4)'],
      ['Reconhecimento de vínculo', 'var(--serie-2)'],
      ['Rescisão indireta', 'var(--serie-3)'],
      ['Direito suprimido', 'var(--serie-1)'],
      ['Auxilio-acidente', 'var(--serie-3)'],
      ['Objeção', 'var(--serie-7)'],
      ['Já é cliente', 'var(--sucesso)'],
      ['Tem advogado', 'var(--serie-8)'],
      ['Reunião de manhã', 'var(--serie-5)'],
      ['Reunião à tarde', 'var(--serie-5)'],
    ],
    templates: ['oab', 'propostatrabalhista', 'propostaauxacidente', 'recepcaotrabalhista', 'tutorialassinatura', 'avaliacao'],
    variaveis: [
      ...DADOS_DO_CONTRATO,
      ['funcao', 'Funcao', 'Funcao na empresa.'],
      ['salario', 'Salario', 'Salario mensal, so o valor numerico.'],
      ['data_admissao', 'Data de admissao', 'Quando comecou na empresa, DD/MM/AAAA.'],
      ['data_demissao', 'Data de saida', 'Quando saiu da empresa, DD/MM/AAAA.'],
      ['nome_reclamada', 'Empresa reclamada', 'Nome da empresa que vai no processo.'],
      ['doc_reclamada', 'CNPJ da empresa', 'CNPJ da empresa, se o cliente souber.'],
    ],
    agentes: [
      ...TRABALHISTA.map((agente) => ({ ...agente, pasta: 'Agentes Trabalhista + Auxilio acidente' })),
      avaliadorDoEscritorio('Trabalhista'),
    ],
  },

  civel: {
    nome: 'Cível / Consumidor',
    pasta: 'Cível e Consumidor',
    bases: ['objec'],
    templates: ['avaliacao'],
    variaveis: [
      ['empresa_reclamada', 'Empresa reclamada', 'Nome da empresa com quem o cliente tem o problema.'],
      ['problema_consumo', 'Problema de consumo', 'O que aconteceu e desde quando.'],
      ['profissao', 'Profissao', 'Profissao ou ultimo trabalho registrado.'],
      ['cpf', 'CPF', 'CPF do lead, so numeros.'],
      ['nascimento', 'Data de nascimento', 'Data de nascimento no formato DD/MM/AAAA.'],
      ['estado_civil', 'Estado civil', 'Solteiro, casado, uniao estavel, divorciado ou viuvo.'],
      ['endereco', 'Endereco completo', 'Endereco com rua, numero, bairro, cidade e CEP.'],
      ['email', 'E-mail', 'E-mail para envio do contrato.'],
    ],
    agentes: [
      {
        nome: 'Secretária Cível',
        objetivo: 'recepcionar',
        requisitos: [],
        prompt: montar(
          'QUEM VOCE E',
          'Voce e a secretaria do atendimento civel e do consumidor. Recebe quem escreve para este numero, entende o problema e entrega a conversa ao especialista. Voce nao analisa o direito: quem analisa e o especialista.',
          '',
          'ROTEIRO',
          '1. Cumprimente pelo nome. Se o nome parecer apelido, emoji ou numero, pergunte como a pessoa prefere ser chamada e use @salvarnome.',
          '2. Pergunte o que aconteceu, com uma pergunta aberta.',
          '3. Veja se e problema de consumo: cobranca indevida, nome negativado sem divida, desconto na aposentadoria que a pessoa nao contratou, emprestimo ou cartao nao reconhecido, produto ou servico com defeito, voo cancelado, plano de saude que negou atendimento.',
          '4. Se for, marque a etiqueta Civel/Consumidor com @tag, altere o @status para "Em triagem", marque o @momento "Coletando dados" e passe com @responsavel para @Especialista Consumidor, com resumo_para_proximo contendo o problema, a empresa envolvida e desde quando.',
          '',
          'QUANDO NAO SE ENCAIXA',
          '- Assunto do INSS ou trabalhista: explique que o escritorio atende por outro numero e passe com @responsavel para "distribuir".',
          '- Familia, inventario, imovel, contrato entre pessoas ou outro assunto civel: marque a etiqueta Civel/Consumidor com @tag e passe com @responsavel para "distribuir", para a equipe avaliar.',
          '- Ja existe processo sobre o mesmo assunto com outro advogado: altere o @status para "Desqualificado" e encerre com cordialidade.',
        ),
      },
      {
        nome: 'Especialista Consumidor',
        objetivo: 'qualificar',
        requisitos: ['empresa_reclamada', 'problema_consumo'],
        prompt: montar(
          'QUEM VOCE E',
          'Voce e a especialista em direito do consumidor. A conversa chega da secretaria com um resumo: continue de onde ela parou.',
          '',
          'O QUE VOCE APURA',
          '- Qual empresa, o que aconteceu, quando comecou e se ainda esta acontecendo.',
          '- Quanto foi cobrado ou descontado, e se o nome foi negativado.',
          '- Se a pessoa ja reclamou (protocolo, Procon, consumidor.gov.br) e o que responderam.',
          '- Provas: faturas, extratos, extrato do INSS com o desconto, prints, protocolos, notas fiscais.',
          '',
          'ROTEIRO (uma pergunta por vez)',
          '1. Nome da empresa: salve em @empresa_reclamada.',
          '2. O que aconteceu e desde quando: salve em @problema_consumo.',
          '3. Valor cobrado ou descontado, e se o nome foi negativado.',
          '4. Se ja reclamou e se tem numero de protocolo.',
          '5. Peca fotos ou prints das provas e confirme o que ficou legivel. Enquanto faltarem, mantenha o @momento "Coletando dados" e use @agendarretorno se o cliente pedir um prazo para juntar.',
          '',
          'DECISAO',
          '- Problema de consumo com prova, ou com como conseguir a prova: altere o @status para "Qualificado" e passe com @responsavel para @Proposta Cível, com resumo_para_proximo trazendo empresa, fatos, valores, protocolos e provas recebidas.',
          '- Valor alto, varias empresas ou dano grave: use @calendario para marcar uma ligacao (tipo ligacao) com a equipe.',
          '- Sem problema de consumo, ou ja resolvido: consulte @biblioteca, explique e altere o @status para "Desqualificado".',
        ),
      },
      {
        nome: 'Proposta Cível',
        objetivo: 'fechar',
        requisitos: ['cpf', 'nascimento', 'estado_civil', 'endereco', 'email'],
        prompt: proposta(
          'Explique em poucas frases como o escritorio trabalha: analise do caso por advogado, tentativa de solucao com a empresa quando couber e acao na Justica, muitas vezes no Juizado Especial; honorarios conforme a tabela do escritorio.',
        ),
      },
      avaliadorDoEscritorio('Cível'),
    ],
  },
};

/**
 * O que fica no escritorio geral (o sem area) depois de separar as areas: o
 * Agente 26, rascunho da LiderHub para quem ja e cliente, desligado. Nao entra
 * na lista de "Agentes por area" porque nao e de area nenhuma.
 */
export const ESCRITORIO_GERAL = {
  nome: 'Escritório geral',
  pasta: 'Sem pasta',
  bases: [],
  departamentos: [['Suporte', 'var(--serie-6)']],
  etiquetas: [
    ['Dúvidas', 'var(--serie-5)'],
    ['Consultas', 'var(--serie-2)'],
    ['Pagamento', 'var(--sucesso)'],
    ['Perícia', 'var(--serie-3)'],
    ['Laudo', 'var(--serie-4)'],
    ['Entrega de documentos', 'var(--serie-7)'],
    ['Solicitação de documentos', 'var(--serie-8)'],
    ['Acidente de trabalho ou doença ocupacional', 'var(--serie-4)'],
    ['Trabalhista', 'var(--serie-6)'],
  ],
  templates: ['avaliacao'],
  variaveis: [['cpf', 'CPF', 'CPF do cliente, so numeros.']],
  agentes: [AGENTE_26, avaliadorDoEscritorio('Escritório geral')],
};

/**
 * Cria no escritorio o que os prompts do pacote citam pelo nome e ainda nao
 * existe: variaveis, departamentos, etiquetas e templates. Nunca mexe no que
 * ja existe, entao rodar de novo nao duplica nem desfaz ajuste do escritorio.
 */
export function prepararEscritorio(workspaceId, pacote) {
  const criados = { variaveis: 0, departamentos: 0, etiquetas: 0, templates: 0 };
  const existe = (colecao, campo, valor) =>
    listar(colecao, { workspaceId }).some((registro) => normalizar(registro[campo]) === normalizar(valor));

  for (const [chave, nome, descricao] of pacote.variaveis || []) {
    if (existe('variaveis', 'chave', chave)) continue;
    inserir('variaveis', { id: novoId('var'), workspaceId, nome, chave, descricao, tipo: 'texto' });
    criados.variaveis += 1;
  }
  for (const [nome, cor] of pacote.departamentos || []) {
    if (existe('departamentos', 'nome', nome)) continue;
    inserir('departamentos', { id: novoId('dep'), workspaceId, nome, cor });
    criados.departamentos += 1;
  }
  for (const [nome, cor] of pacote.etiquetas || []) {
    if (existe('etiquetas', 'nome', nome)) continue;
    inserir('etiquetas', { id: novoId('etq'), workspaceId, nome, cor });
    criados.etiquetas += 1;
  }
  for (const atalho of pacote.templates || []) {
    if (existe('templates', 'atalho', atalho)) continue;
    const [nome, conteudo] = TEMPLATES[atalho];
    inserir('templates', {
      id: novoId('tpl'),
      workspaceId,
      nome,
      atalho,
      conteudo,
      midia: null,
      categoriaMeta: 'utilidade',
      aprovacaoMeta: { solicitada: false, situacao: 'nao_solicitada' },
    });
    criados.templates += 1;
  }
  return criados;
}
