import { achar, listar } from './banco.js';

/**
 * Cargos do escritorio, cada um com a sua lista de permissoes.
 *
 * Pedido do escritorio em 16/11/2026: "quero que tenha a opcao de adicionar
 * cargos e permissoes para cada cargo".
 *
 * COMO ERA. Quatro papeis fixos no codigo (Dono, Administrador, Atendente,
 * Somente leitura) e 95 guardas no servidor que perguntavam sempre a mesma
 * coisa grossa: "e administrador?". Nao havia meio-termo — ou a pessoa mexia
 * em tudo (chaves de API, roteiro dos agentes, exclusao de conversa), ou nao
 * mexia em nada. Num escritorio onde o financeiro precisa de relatorio e o
 * estagiario nao pode exportar dado de cliente, isso vira senha de
 * administrador emprestada, que e o pior dos mundos.
 *
 * COMO FICA. O papel do membro passa a aceitar TAMBEM o id de um cargo criado
 * pelo escritorio. As permissoes saem de um lugar so (`permissoesDe`), e as
 * guardas perguntam pelo NOME do que querem fazer, nao pelo nivel de quem
 * pergunta.
 *
 * NADA MUDA PARA NINGUEM ATE ALGUEM CRIAR UM CARGO. Os quatro papeis de hoje
 * continuam existindo, com exatamente as permissoes que ja tinham: admin e
 * dono com tudo, atendente e somente-leitura sem nenhuma destas. Quem nao
 * mexer em nada nao vai notar diferenca — que e a unica forma honesta de
 * mudar a fronteira de seguranca de um sistema que ja esta no ar.
 *
 * O QUE ISTO NAO E:
 *
 *  - nao e visibilidade. Quais conversas cada um ENXERGA continua vindo dos
 *    departamentos e conexoes do membro (nucleo/auth.js), que e outro eixo e
 *    ja era configuravel. Cargo diz o que a pessoa PODE FAZER, nao o que ela
 *    ve;
 *  - nao e o dono. Ser dono continua sendo uma coisa so, fora da lista: quem
 *    cria e remove outro dono, e quem nao pode ser removido. Isso nao vira
 *    caixinha para marcar, senao um cargo mal montado tranca o escritorio
 *    para fora do proprio sistema.
 */

/**
 * O catalogo. Cada permissao e uma FRASE DO QUE SE FAZ, e nao o nome de uma
 * tela: telas sao renomeadas e juntadas, e a pergunta "quem pode mexer nas
 * chaves" continua a mesma.
 */
export const PERMISSOES = [
  {
    chave: 'configurar',
    nome: 'Configurar o escritório',
    descricao: 'Status e follow-up, departamentos, etiquetas, origens, variáveis, horário comercial e templates.',
  },
  {
    chave: 'membros',
    nome: 'Gerenciar a equipe',
    descricao: 'Criar e editar membros, trocar o cargo de alguém, reiniciar a verificação em duas etapas.',
  },
  {
    chave: 'agentes',
    nome: 'Mexer nos agentes e automações',
    descricao: 'Editar o roteiro da IA, ligar e desligar agente, base de conhecimento, vozes e sequências de follow-up.',
  },
  {
    chave: 'conexoes',
    nome: 'Mexer nas conexões de WhatsApp',
    descricao: 'Conectar e desconectar número, ler QR Code, apagar conexão.',
  },
  {
    chave: 'integracoes',
    nome: 'Mexer nas integrações e chaves',
    descricao: 'ZapSign, Atilhus Júri, chaves de IA e de API. Quem tem isto alcança as credenciais do escritório.',
  },
  {
    chave: 'relatorios',
    nome: 'Ver relatórios e o ranking',
    descricao: 'Relatórios de contratos, ranking da equipe e a régua que define o caso completo.',
  },
  {
    chave: 'contratos',
    nome: 'Aprovar e enviar contrato',
    descricao: 'Conferir o contrato e mandar o link de assinatura para o cliente.',
  },
  {
    chave: 'excluir',
    nome: 'Excluir conversa definitivamente',
    descricao: 'Apagar conversa e mensagens sem volta. Pela LGPD, é o que não dá para desfazer.',
  },
  {
    chave: 'exportar',
    nome: 'Exportar dados',
    descricao: 'Baixar planilha e PDF com dados de cliente, que saem do sistema e deixam de ser rastreáveis.',
  },
];

export const CHAVES_DE_PERMISSAO = PERMISSOES.map((p) => p.chave);
const TODAS = Object.freeze([...CHAVES_DE_PERMISSAO]);

/**
 * Os quatro papeis que ja existiam, agora escritos como cargos.
 *
 * As permissoes aqui REPRODUZEM o que cada um ja podia: admin e dono passavam
 * em todas as guardas; atendente e somente-leitura nao passavam em nenhuma
 * delas. Mudar isso de passagem seria mexer em quem pode o que sem ninguem ter
 * pedido.
 */
export const CARGOS_EMBUTIDOS = {
  owner: { nome: 'Dono', descricao: 'Acesso total e não pode ser removido. Só o dono cria ou remove outro dono.', nivel: 4, permissoes: TODAS },
  admin: { nome: 'Administrador', descricao: 'Acesso total às configurações, agentes, membros, conexões e integrações.', nivel: 3, permissoes: TODAS },
  /*
   * ATENDENTE NAO NASCE VAZIO, e isso foi conferido rota a rota, nao suposto.
   *
   * Hoje, antes desta mudanca, um atendente JA consegue ver relatorio, ver o
   * ranking, baixar a planilha de contratos e aprovar contrato: nenhuma dessas
   * rotas tem guarda nenhuma. Dar a ele uma lista vazia tiraria, de passagem,
   * quatro coisas que a equipe faz todo dia — e o pedido foi acrescentar
   * cargos, nao reduzir os que ja existem.
   *
   * Entao o embutido reproduz a realidade de hoje. Quem quiser um atendente
   * que NAO exporte dado de cliente cria um cargo proprio e deixa a caixinha
   * desmarcada, que e exatamente o ponto do pedido.
   */
  atendente: {
    nome: 'Atendente',
    descricao: 'Opera as conversas dos departamentos e conexões designados, vê relatórios e fecha contrato.',
    nivel: 2,
    permissoes: ['relatorios', 'contratos', 'exportar'],
  },
  somente_leitura: {
    nome: 'Somente leitura',
    descricao: 'Só visualiza conversas e relatórios autorizados. Não envia mensagem nem altera nada.',
    nivel: 1,
    /* Relatorio e leitura, e leitura e o que este papel faz. Exportar nao: sai
       do sistema e deixa de ser rastreavel, que e mais do que "ver". */
    permissoes: ['relatorios'],
  },
};

export const ehCargoEmbutido = (chave) => Object.hasOwn(CARGOS_EMBUTIDOS, chave);

/** Um cargo pelo que o membro tem em `papel`: embutido ou criado pelo escritorio. */
export function cargoDe(workspaceId, papel) {
  if (!papel) return null;
  if (ehCargoEmbutido(papel)) return { id: papel, embutido: true, ...CARGOS_EMBUTIDOS[papel] };
  const guardado = achar('cargos', papel);
  if (!guardado || guardado.workspaceId !== workspaceId) return null;
  return {
    id: guardado.id,
    embutido: false,
    nome: guardado.nome,
    descricao: guardado.descricao || '',
    /* Nivel 2, de atendente: cargo criado aqui nao herda visibilidade de
       administrador. Quem precisa ver tudo recebe isso nos departamentos do
       membro, que e onde visibilidade mora. */
    nivel: 2,
    permissoes: (guardado.permissoes || []).filter((p) => CHAVES_DE_PERMISSAO.includes(p)),
  };
}

/** Os cargos que a tela oferece: os quatro embutidos e os do escritorio. */
export function cargosDoWorkspace(workspaceId) {
  const embutidos = Object.entries(CARGOS_EMBUTIDOS).map(([id, c]) => ({ id, embutido: true, ...c }));
  const proprios = listar('cargos', { workspaceId }).map((c) => cargoDe(workspaceId, c.id)).filter(Boolean);
  return [...embutidos, ...proprios];
}

/** As permissoes de quem esta pedindo. */
export function permissoesDe(ctx) {
  const cargo = cargoDe(ctx?.workspaceId, ctx?.papel);
  return cargo ? cargo.permissoes : [];
}

/**
 * Pode fazer isto?
 *
 * Uma pergunta so, pelo NOME da acao. As guardas do sistema passam a chamar
 * esta — em vez de perguntar o nivel de quem esta do outro lado, o que fazia
 * cada guarda nova ter de escolher sozinha entre "administrador" e "qualquer
 * um", sem nada no meio.
 */
export function pode(ctx, permissao) {
  if (!ctx || !permissao) return false;
  return permissoesDe(ctx).includes(permissao);
}

/** Limpa o que a tela mandou: so chaves que existem, sem repetidas. */
export function permissoesValidas(lista) {
  return [...new Set((Array.isArray(lista) ? lista : []).filter((p) => CHAVES_DE_PERMISSAO.includes(p)))];
}
