import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const aqui = path.dirname(fileURLToPath(import.meta.url));

export const RAIZ = path.resolve(aqui, '..');

/**
 * Le o arquivo `.env` da raiz, quando ele existe.
 *
 * Antes, a chave do Supabase morava num `segredos.bat` que so o CMD do Windows
 * sabia executar: quem abrisse o projeto pelo VS Code, pelo terminal ou em
 * outro sistema simplesmente subia sem o espelho, sem nenhum aviso. O `.env` e
 * um arquivo de texto que qualquer um le, em qualquer sistema, e o `.gitignore`
 * ja o mantem fora do repositorio.
 *
 * Variavel de ambiente de verdade vence o arquivo: quem exportou a chave no
 * terminal, ou a definiu no servidor, quis aquilo, e um arquivo esquecido na
 * pasta nao pode sobrescrever essa escolha.
 *
 * Sem biblioteca: sao quinze linhas, e o projeto inteiro existe para rodar sem
 * `npm install`.
 */
function carregarEnv() {
  let bruto;
  try {
    bruto = fs.readFileSync(path.join(RAIZ, '.env'), 'utf8');
  } catch {
    return;
  }
  for (const linha of bruto.split('\n')) {
    const limpa = linha.trim();
    if (!limpa || limpa.startsWith('#')) continue;

    const igual = limpa.indexOf('=');
    if (igual < 1) continue;

    const chave = limpa.slice(0, igual).trim();
    if (chave in process.env) continue;

    let valor = limpa.slice(igual + 1).trim();
    const aspas = valor[0];
    if ((aspas === '"' || aspas === "'") && valor.endsWith(aspas)) valor = valor.slice(1, -1);
    process.env[chave] = valor;
  }
}

carregarEnv();
export const PASTA_WEB = path.join(RAIZ, 'web');
/*
 * A pasta dos dados e configuravel por variavel de ambiente.
 *
 * No dia a dia ninguem mexe nisso: e sempre `dados/`, ao lado do programa, e e
 * essa pasta que se copia para fazer backup. A variavel existe para os testes,
 * que precisam de uma base descartavel: sem ela, rodar a suite na maquina do
 * escritorio apagaria as conversas de verdade para semear as de mentira.
 */
export const PASTA_DADOS = process.env.CORREIA_DADOS
  ? path.resolve(process.env.CORREIA_DADOS)
  : path.join(RAIZ, 'dados');
export const PASTA_MENSAGENS = path.join(PASTA_DADOS, 'mensagens');
export const PASTA_ARQUIVOS = path.join(PASTA_DADOS, 'arquivos');
export const PASTA_MIDIA = path.join(PASTA_DADOS, 'midia');

/** Teto da Meta por arquivo. Acima disso o envio volta com erro 131053. */
export const LIMITE_MIDIA = 16 * 1024 * 1024;

export const PORTA = Number(process.env.PORT || process.env.PORTA || 4477);

/**
 * Em que endereco o servidor escuta.
 *
 * O padrao continua sendo so esta maquina. Existe uma unica razao para mudar,
 * e ela e o caminho por QR Code: a Evolution API roda em contêiner, e de
 * dentro dele `localhost` e o proprio contêiner — para entregar as mensagens
 * recebidas ela precisa chamar a maquina de fora, o que um servidor presao ao
 * 127.0.0.1 recusa. Sem isso o QR conecta, a sessao abre e NENHUMA mensagem
 * chega, sem erro nenhum na tela.
 *
 * Quem precisa disso poe `set CORREIA_HOST=0.0.0.0` no segredos.bat. Mesmo
 * assim o sistema nao fica aberto para o escritorio: o filtro logo abaixo
 * recusa quem nao for desta maquina ou da rede do Docker.
 */
export const HOST = process.env.CORREIA_HOST || '127.0.0.1';

/**
 * Quem pode falar com o servidor quando ele escuta em todas as interfaces.
 *
 * Esta maquina, e as faixas privadas que o Docker usa para as suas redes
 * virtuais. Repare no que NAO esta aqui: 192.168.0.0/16 e 10.0.0.0/8 inteiras,
 * que sao as faixas de rede de escritorio. Liberar uma delas para resolver o
 * webhook entregaria a tela de login para qualquer computador da rede — e a
 * senha padrao deste sistema esta publicada no README.
 */
const FAIXAS_PERMITIDAS = [
  /^127\./,
  /^::1$/,
  /^::ffff:127\./,
  /^172\.(1[6-9]|2\d|3[01])\./, // 172.16.0.0/12, onde o Docker cria as pontes
  /^::ffff:172\.(1[6-9]|2\d|3[01])\./,
  /^192\.168\.65\./, // rede interna do Docker Desktop
  /^::ffff:192\.168\.65\./,
];

export function enderecoPermitido(endereco) {
  if (!endereco) return false;
  return FAIXAS_PERMITIDAS.some((faixa) => faixa.test(endereco));
}

/** Limite de corpo aceito em uma requisicao (uploads chegam em base64). */
export const LIMITE_CORPO = 32 * 1024 * 1024;

/** Vozes disponiveis para a resposta em audio. */
export const VOZES = [
  { id: 'nova', nome: 'Nova', descricao: 'Feminina, jovem e clara. Boa para triagem.' },
  { id: 'shimmer', nome: 'Shimmer', descricao: 'Feminina, suave e acolhedora.' },
  { id: 'alloy', nome: 'Alloy', descricao: 'Neutra e equilibrada.' },
  { id: 'echo', nome: 'Echo', descricao: 'Masculina, sobria.' },
  { id: 'onyx', nome: 'Onyx', descricao: 'Masculina, grave. Passa autoridade.' },
  { id: 'fable', nome: 'Fable', descricao: 'Masculina, narrativa.' },
];

/** Intervalo do agendador que dispara follow-ups e mensagens agendadas. */
export const INTERVALO_AGENDADOR = 15 * 1000;

/**
 * Custo em creditos de cada acao, espelhando a tabela da auditoria.
 * Serve para o painel de consumo, o sistema e proprio, entao aqui o credito
 * e uma unidade de medida de uso, nao de cobranca.
 */
export const CUSTO = {
  processamentoIA: 9,
  audioPorMinuto: 120,
  transcricaoAudioPorMinuto: 6,
  transcricaoImagem: 4,
  mencaoLeve: 9,
  mencaoBiblioteca: 11.9,
  mencaoContrato: 13.1,
  mencaoCalendario: 15.5,
  mencaoPersonalizada: 12,
};

/**
 * Catalogo de modelos disponiveis para os agentes.
 *
 * `precoEntrada` e o preco de tabela, em dolares, de um milhao de tokens
 * LIDOS pelo modelo. E o que a tela de Agentes usa para dizer quanto o prompt
 * custa a cada resposta: o prompt inteiro vai junto em toda resposta, entao
 * ele e lido de novo a cada mensagem que o agente manda.
 */
export const MODELOS = [
  {
    id: 'claude-opus-5',
    nome: 'Claude Opus 5',
    provedor: 'anthropic',
    creditos: 7,
    precoEntrada: 5,
    uso: 'Atendimentos complexos, negociacao, varias ferramentas na mesma conversa',
  },
  {
    id: 'claude-sonnet-5',
    nome: 'Claude Sonnet 5',
    provedor: 'anthropic',
    creditos: 4,
    precoEntrada: 2,
    uso: 'Triagem, qualificacao e alto volume',
  },
  {
    id: 'claude-haiku-4-5-20251001',
    nome: 'Claude Haiku 4.5',
    provedor: 'anthropic',
    creditos: 1,
    precoEntrada: 1,
    uso: 'Categorizacao, primeira resposta e tarefas simples',
  },
  {
    id: 'gpt-4.1',
    nome: 'GPT-4.1 (OpenAI)',
    provedor: 'openai',
    creditos: 8,
    precoEntrada: 2,
    uso: 'Alternativa caso o escritorio prefira OpenAI',
  },
  {
    id: 'regras',
    nome: 'Roteiro por regras (sem IA)',
    provedor: 'regras',
    creditos: 0,
    precoEntrada: 0,
    uso: 'Roda sem chave de API. Segue o roteiro do prompt em sequencia.',
  },
];

/**
 * O tamanho do prompt de um agente.
 *
 * `maximo` e a unica trava de verdade: o servidor recusa acima dele. O modelo
 * aguentaria muito mais (o Sonnet 5 le um milhao de tokens), e e justamente
 * por isso que a trava existe — sem ela, colar a lei inteira no prompt
 * funcionaria, e cada resposta do agente passaria a custar dezenas de vezes
 * mais, sem aviso. Material longo tem lugar proprio: a base de conhecimento,
 * que o agente consulta so quando a pergunta pede.
 *
 * As faixas sao as da auditoria da LiderHub, que a tela ja usava: abaixo de
 * `minimo` o agente improvisa; ate `recomendadoAte` e o ponto bom; ate
 * `longoAte` funciona, mas custa mais e comeca a misturar regras.
 *
 * `caracteresPorToken` e uma estimativa para portugues com o tokenizador dos
 * modelos atuais — conservadora, para a conta de custo errar para cima.
 */
export const PROMPT = {
  minimo: 1500,
  recomendadoAte: 7400,
  longoAte: 12000,
  maximo: 20000,
  caracteresPorToken: 3,
};

/** Tipos de status usados pelo Dashboard, o funil padrao. */
/*
 * A cor sai como token do tema, nao como hex. Ela e usada so para pintar
 * grafico e selo na tela, e em hex fixo os mesmos valores somem no tema claro.
 * Os tokens estao em web/css/tema.css, declarados nos dois temas.
 */
/*
 * A cor de cada tipo segue o funil, do degrau mais claro da rampa ao ouro da
 * marca, e so muda de familia nos desfechos: jade fecha, terracota perde.
 *
 * Estas sao as cores de RESERVA. Quando o escritorio tem status cadastrados
 * para o tipo e todos com a mesma cor, quem manda e a cor deles: a metrica do
 * painel precisa ter a mesma cor que a coluna do Kanban e o selo da conversa,
 * senao o mesmo estagio aparece de duas cores em duas telas.
 */
/*
 * `referencia` e a faixa de conversao esperada para a etapa, em percentual das
 * novas conversas. Ela existe para o numero deixar de ser solto: 8,6% de
 * Sucesso nao diz nada sozinho, mas dentro de uma faixa esperada de 2,5% a 5%
 * e um resultado acima da media, e e isso que muda a decisao de quem le.
 *
 * A faixa e ponto de partida, e nao meta do escritorio: o previdenciario tem
 * ciclo mais longo que a media de mercado. A tela mostra a faixa como
 * referencia, nunca como aprovacao ou reprovacao.
 */
export const TIPOS_STATUS = [
  { id: 'nova', nome: 'Nova conversa', cor: 'var(--serie-1)', referencia: { min: 100, max: 100 } },
  { id: 'analise', nome: 'Analise', cor: 'var(--serie-2)', referencia: { min: 50, max: 50 } },
  { id: 'qualificado', nome: 'Qualificado', cor: 'var(--serie-3)', referencia: { min: 10, max: 20 } },
  { id: 'proposta', nome: 'Proposta', cor: 'var(--serie-4)', referencia: { min: 5, max: 10 } },
  { id: 'sucesso', nome: 'Sucesso', cor: 'var(--sucesso)', referencia: { min: 2.5, max: 5 } },
  { id: 'desqualificado', nome: 'Desqualificado', cor: 'var(--serie-5)', referencia: null },
  { id: 'recusada', nome: 'Recusada', cor: 'var(--erro)', referencia: null },
  { id: 'desistencia', nome: 'Desistencia', cor: 'var(--serie-8)', referencia: null },
  { id: 'nenhum', nome: 'Sem classificacao', cor: 'var(--texto-fraco)', referencia: null },
];
