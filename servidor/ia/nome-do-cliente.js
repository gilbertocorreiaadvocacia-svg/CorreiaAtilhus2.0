/**
 * O nome que o cliente diz, virando o nome do contato.
 *
 * Pedido do escritorio em 17/11/2026: "ao cliente dizer o seu nome, quando o
 * agente for perguntar, ele automaticamente muda o nome do contato para o
 * nome fornecido".
 *
 * O QUE JA EXISTIA. A ferramenta `salvar_nome` (ia/mencoes.js) grava o nome e
 * e antiga. O que faltava eram as duas pontas:
 *
 *  1. ela so era OFERECIDA ao agente cujo roteiro escrevia "@salvarnome".
 *     Quatro dos cinco pacotes que pedem o nome escreviam; o do BPC pede o
 *     nome e nao escrevia, entao aquele agente nunca teve a ferramenta na mao
 *     -- ele perguntava o nome, o cliente respondia, e o cartao continuava
 *     com o apelido do WhatsApp;
 *  2. nenhum roteiro mandava salvar o nome quando ele APARECE sozinho. Os que
 *     citavam a ferramenta mandavam usa-la so quando o nome do contato
 *     estivesse "estranho (apelido, emoji, numero)", que e outra coisa.
 *
 * O QUE ESTE ARQUIVO E. A trava de qualidade da outra ponta. Com a ferramenta
 * na mao de todo agente e uma regra mandando usa-la, o que chega aqui deixa de
 * ser so o nome digitado pelo cliente: vira o que o MODELO entendeu como
 * nome. E o modelo erra de formas conhecidas -- manda a frase inteira ("meu
 * nome e Joao"), manda a saudacao ("bom dia"), manda o numero do protocolo,
 * manda o "sim" da resposta anterior.
 *
 * Nome errado gravado nao e um errinho de tela: o agente passa a chamar o
 * cliente de "Bom Dia" na mensagem seguinte, e o cartao do Kanban perde a
 * unica coisa pela qual a equipe acha a conversa. Entao nada entra sem passar
 * por aqui.
 *
 * O QUE ISTO NAO FAZ: nao adivinha. Nao havendo nome reconhecivel, a resposta
 * e "nao gravei, e por que", e o agente segue o atendimento sem o nome -- que
 * e o que o motor ja manda fazer quando falta um dado.
 */

/*
 * O que nunca e nome, por mais que venha no lugar dele.
 *
 * Esta lista nao serve para LIMPAR o texto: serve para RECUSA-LO. Uma palavra
 * destas no meio do que chegou significa que o modelo mandou uma frase, nao
 * um nome -- e a frase vira nome de cliente no Kanban. Nome de gente nao tem
 * nenhuma delas; so particula ("de", "da", "dos"), que e tratada separado.
 */
const NAO_E_NOME = new Set([
  'oi', 'ola', 'alo', 'opa', 'eai', 'eae', 'oie',
  'bom', 'dia', 'boa', 'tarde', 'noite', 'bomdia', 'boatarde', 'boanoite',
  'tudo', 'bem', 'blz', 'beleza', 'certo', 'ok', 'okay', 'uhum',
  'sim', 'nao', 'claro', 'isso', 'aham', 'pois',
  'obrigado', 'obrigada', 'obg', 'vlw', 'valeu', 'agradecido',
  'eu', 'meu', 'minha', 'me', 'nome', 'chamo', 'sou',
  'voce', 'vc', 'senhor', 'senhora', 'doutor', 'doutora',
  'teste', 'testando', 'ai', 'la', 'aqui', 'cliente', 'pessoa',
  'quero', 'preciso', 'gostaria', 'queria', 'ajuda', 'informacao',
  'bot', 'atendente', 'advogado', 'advogada', 'escritorio',
  /* Verbo e pergunta, que e o que denuncia frase sem ponto de interrogacao. */
  'saber', 'atendem', 'atende', 'pode', 'podem', 'tem', 'fazer', 'falar',
  'se', 'que', 'qual', 'como', 'quanto', 'porque', 'caso', 'processo',
]);

/*
 * A saudacao que vem GRUDADA na frente do nome ("Olá, meu nome é João"). Sai
 * na frente da recusa: ela nao transforma o resto em frase.
 */
/*
 * O separador no fim de cada uma e obrigatorio, e nao enfeite: sem ele,
 * "Olavo" comecaria com "Ola" e viraria "vo". E e escrito como grupo de
 * caracteres em vez de \b porque, em "Olá,", o \b do JavaScript nao ve
 * fronteira nenhuma -- para ele a letra acentuada ja nao e letra.
 */
const SAUDACOES = [
  /^(oi+|ol[aá]+|al[oô]+|opa|oie)(?=[\s,.!?;-]|$)[\s,.!?;-]*/i,
  /^bo(m|a)\s+(dia|tarde|noite)(?=[\s,.!?;-]|$)[\s,.!?;-]*/i,
  /^tudo\s+(bem|bom|certo)(?=[\s,.!?;-]|$)[\s,.!?;-]*/i,
  /^prazer(?=[\s,.!?;-]|$)[\s,.!?;-]*/i,
];

/*
 * O que o cliente escreve ANTES do nome, e que o modelo as vezes manda junto.
 * Sai na frente da validacao: "meu nome e Joao" e um nome dito, nao uma frase
 * sem nome -- recusar isso jogaria fora justamente o caso mais comum.
 */
const ENFEITES = [
  /^(o\s+)?meu\s+nome\s+(completo\s+)?(e|eh|é)\s+/i,
  /^(eu\s+)?me\s+chamo(\s+de)?\s+/i,
  /^chamo(\s+de)?\s+/i,
  /^(eu\s+)?sou\s+(o|a|um|uma)\s+/i,
  /^(eu\s+)?sou\s+/i,
  /^aqui\s+(e|eh|é)\s+(o|a)\s+/i,
  /^(e|eh|é)\s+(o|a)\s+/i,
  /^nome:\s*/i,
  /^pode\s+(me\s+)?chamar\s+de\s+/i,
];

/* As particulas que ficam minusculas num nome brasileiro. */
const PARTICULAS = new Set(['de', 'da', 'do', 'das', 'dos', 'e', 'di', 'du', 'del', 'la', 'van', 'von', 'dell']);

const semAcento = (texto) =>
  String(texto).normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();

/**
 * Arruma a caixa do nome, SEM inventar.
 *
 * So mexe quando o texto inteiro veio de um jeito so -- tudo maiusculo
 * ("MARIA DA SILVA") ou tudo minusculo ("maria da silva"), que e como o
 * cliente digita no WhatsApp. Nome com maiuscula no meio ja foi escrito por
 * alguem que sabia o que queria ("Ana Lucia", "McDonald"), e ai e so passar.
 */
export function arrumarCaixa(nome) {
  const texto = String(nome);
  const temMinuscula = /\p{Ll}/u.test(texto);
  const temMaiuscula = /\p{Lu}/u.test(texto);
  if (temMinuscula && temMaiuscula) return texto;
  return texto
    .split(' ')
    .map((palavra, indice) => {
      if (!palavra) return palavra;
      const baixa = palavra.toLocaleLowerCase('pt-BR');
      /* Particula no meio fica minuscula; na frente, nao: ali ela e o nome. */
      if (indice > 0 && PARTICULAS.has(semAcento(baixa))) return baixa;
      return baixa.charAt(0).toLocaleUpperCase('pt-BR') + baixa.slice(1);
    })
    .join(' ');
}

/**
 * O nome do cliente, se for um nome.
 *
 * Devolve { ok: true, nome } com o nome limpo e na caixa certa, ou
 * { ok: false, motivo } com a frase que o agente le -- escrita para ele
 * entender que nao e para tentar de novo com o mesmo texto.
 */
export function nomeDoCliente(bruto) {
  if (typeof bruto !== 'string') return { ok: false, motivo: 'não veio nome nenhum' };

  /* Tira emoji, aspas, pontuacao de fim de frase e espaco repetido. */
  let texto = bruto
    .replace(/[\u{1F000}-\u{1FAFF}\u{2600}-\u{27BF}\u{FE0F}\u{20E3}]/gu, ' ')
    .replace(/["'`“”‘’]/g, '')
    .replace(/\s+/g, ' ')
    .trim();

  /* "Oi, bom dia, me chamo Ana": a saudacao pode vir em camadas. */
  for (let volta = 0; volta < 3; volta += 1) {
    const antes = texto;
    for (const saudacao of SAUDACOES) texto = texto.replace(saudacao, '').trim();
    if (texto === antes) break;
  }
  for (const enfeite of ENFEITES) {
    const antes = texto;
    texto = texto.replace(enfeite, '').trim();
    if (texto !== antes) break;
  }
  texto = texto.replace(/[.,;:!?]+$/g, '').trim();

  if (!texto) {
    /* Sobrou nada depois de tirar a saudacao: era so a saudacao. */
    return { ok: false, motivo: bruto.trim() ? 'é saudação, não nome' : 'não veio nome nenhum' };
  }
  /*
   * Numero no meio do nome e o caso do "AD1" e do numero de protocolo, que o
   * escritorio ja tinha visto gravado como nome de cliente.
   */
  if (/\d/.test(texto)) return { ok: false, motivo: 'tem número, então não é nome de pessoa' };
  if (/[@/\\<>|{}[\]()*#$%=+_]/.test(texto) || /https?:/i.test(texto)) {
    return { ok: false, motivo: 'não parece nome de pessoa' };
  }
  if (/[?!]|\n/.test(texto)) return { ok: false, motivo: 'é frase, não nome' };
  if (!/\p{L}/u.test(texto)) return { ok: false, motivo: 'não tem letra nenhuma' };

  const palavras = texto.split(' ').filter(Boolean);
  /*
   * Oito palavras, e nao cinco: "Maria Aparecida dos Santos Souza Oliveira
   * Lima Pereira" e nome de cliente de verdade, e e justamente na etapa da
   * ficha que o escritorio pede o nome COMPLETO. Apertar aqui recusaria o
   * nome mais importante de todos.
   */
  if (palavras.length > 8) return { ok: false, motivo: 'é frase, não nome' };
  if (texto.length > 60) return { ok: false, motivo: 'longo demais para ser nome' };
  if (texto.replace(/\s/g, '').length < 2) return { ok: false, motivo: 'curto demais para ser nome' };

  /*
   * A trava que separa nome de frase.
   *
   * Uma palavra da lista ja basta para recusar o conjunto: "sim", "bom dia" e
   * "queria saber se voces atendem" chegam aqui quando o modelo confunde
   * outra mensagem do cliente com a resposta a pergunta do nome. Limpar a
   * palavra e gravar o resto seria pior do que recusar -- gravaria
   * "Atendem Causa" como nome de uma pessoa.
   */
  let nomeadas = 0;
  for (const palavra of palavras) {
    const limpa = semAcento(palavra.replace(/[.,;:]/g, ''));
    if (PARTICULAS.has(limpa)) continue;
    if (NAO_E_NOME.has(limpa)) return { ok: false, motivo: 'é saudação ou frase, não nome' };
    /* Letra sozinha e inicial ("Jose M Silva"), nao nome. */
    if (limpa.length > 1) nomeadas += 1;
  }
  if (!nomeadas) return { ok: false, motivo: 'curto demais para ser nome' };

  return { ok: true, nome: arrumarCaixa(texto) };
}
