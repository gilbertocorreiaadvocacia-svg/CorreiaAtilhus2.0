import { suite } from './apoio.js';
import { comPassagemParaPessoa } from '../nucleo/acidente-sem-vinculo.js';
import { AUXILIO_ACIDENTE } from '../ia/pacotes/auxilio-acidente.js';

/**
 * Sem vinculo na epoca do acidente, quem decide e uma pessoa.
 *
 * Relato do escritorio em 16/11/2026: "a IA de auxilio-acidente continua o
 * atendimento ao cliente que diz que nao estava trabalhando na epoca do
 * acidente; corrija para que, tendo essa informacao, ela passe a um humano".
 *
 * A resposta "nao estava trabalhando" e a unica do roteiro que decide o caso
 * sozinha, e e tambem a que menos se decide por arvore: as saidas existem
 * (periodo de graca, segurado especial), mas sao julgamento juridico, com
 * prova. O bot percorrendo isso sozinho ou promete contrato que o INSS nega,
 * ou dispensa quem tinha direito.
 *
 * O teste roda sobre o ROTEIRO DE VERDADE, o que o pacote gera, e nao sobre um
 * texto de mentira escrito aqui. E o unico jeito de ele reprovar no dia em que
 * alguem mexer no pacote e a migracao deixar de casar — que e exatamente a
 * falha silenciosa que importa: a migracao nao estoura, ela so nao faz nada, e
 * o cliente continua sendo atendido por um bot onde devia haver um advogado.
 */
export function testarAcidenteSemVinculo() {
  const s = suite('Sem vinculo na epoca do acidente: passa para uma pessoa');

  const agentes = Array.isArray(AUXILIO_ACIDENTE) ? AUXILIO_ACIDENTE : Object.values(AUXILIO_ACIDENTE);
  const segurado = agentes.find((a) => a?.nome?.includes('#02'));
  if (!s.ok('o pacote tem o agente de qualidade de segurado', Boolean(segurado?.prompt), JSON.stringify(agentes.map((a) => a?.nome)))) return s;

  /* --- O roteiro NOVO, que escritorio novo recebe ---------------------- */
  const novo = segurado.prompt;
  s.ok('o roteiro manda PARAR e passar para uma pessoa', /PARE A ANÁLISE E PASSE PARA UMA PESSOA/.test(novo), novo.slice(0, 80));
  s.ok('e manda passar por "distribuir", que cai em quem tem menos conversa', /@responsavel para "distribuir"/.test(novo));
  s.ok(
    'reconhece as varias formas de dizer a mesma coisa',
    ['desempregado', 'sem trabalhar', 'sem registro'].every((t) => novo.includes(t)),
    novo.slice(novo.indexOf('NÃO ESTAVA TRABALHANDO'), novo.indexOf('NÃO ESTAVA TRABALHANDO') + 200),
  );
  s.ok(
    'proibe seguir perguntando, desqualificar, propor e gerar contrato',
    /NÃO pergunte mais nada/.test(novo) && /NÃO desqualifique/.test(novo) && /NÃO faça proposta/.test(novo) && /NÃO gere contrato/.test(novo),
    'faltou alguma das proibicoes',
  );
  /*
   * O conhecimento juridico nao foi jogado fora: saiu da arvore e entrou no
   * resumo da passagem, como lista do que o advogado precisa conferir. Sem
   * isso, a correcao teria custado ao escritorio a triagem de periodo de graca
   * e de segurado especial.
   */
  s.ok(
    'e o que o advogado precisa conferir vai junto, no resumo da passagem',
    ['12 meses', 'avulso', 'segurado especial', 'período de graça'].every((t) => novo.includes(t)),
    novo.slice(novo.indexOf('resumo_para_proximo'), novo.indexOf('resumo_para_proximo') + 260),
  );

  /* --- A arvore antiga saiu inteira ------------------------------------ */
  /*
   * Galho morto dentro de um roteiro nao e inofensivo: o modelo le tudo, e
   * instrucao que contradiz a de cima e a melhor forma de ele voltar a fazer o
   * que acabou de ser proibido.
   */
  for (const galho of ['NÃO TEVE nos 12 meses:', 'TRABALHADOR RURAL OU SEGURADO ESPECIAL (bloqueio):', 'PERÍODO DE GRAÇA:', 'CONTRIBUIU 10 ANOS mas NÃO tem documentos:']) {
    s.ok(`o galho morto "${galho.slice(0, 32)}…" nao ficou no roteiro`, !novo.includes(galho), galho);
  }
  s.ok('e a regra de "NAO prossiga" virou "passe para uma pessoa"', !novo.includes('NÃO prossiga)'), 'a regra antiga continua la');

  /* --- A MIGRACAO, que e o que alcanca quem ja esta no ar -------------- */
  /*
   * Reconstroi o roteiro ANTIGO a partir do novo nao da: o texto velho nao
   * existe mais no codigo. Entao o teste usa o trecho antigo escrito aqui, que
   * e como ele estava gravado no banco do escritorio.
   */
  const ANTIGO = `QUALIDADE DE SEGURADO

Altere o @status para "Em análise" e pergunte: Só para confirmar, você tinha carteira assinada na época [do acidente/dos primeiros sintomas]?

TINHA CARTEIRA, CLT OU SERVIDOR PÚBLICO: salve "sim" em @qualidade_segurado e siga para SEQUELA OU NEXO.

NÃO TINHA: pergunte Você teve carteira assinada nos 12 meses anteriores ao [acidente/sintomas]? Teve, siga para SEQUELA OU NEXO.

NÃO TEVE nos 12 meses: verifique trabalhador avulso (sindicato) ou segurado especial (agricultor, pescador) na @biblioteca.

PERÍODO DE GRAÇA: não sendo nenhum dos casos acima, dá para avaliar pelos critérios de 24 ou 36 meses.

SEQUELA OU NEXO

CASO DE ACIDENTE: diga Ótimo, então você tinha qualidade de segurado.`;

  const migrado = comPassagemParaPessoa(ANTIGO);
  s.ok('a migracao reconhece o roteiro instalado e troca', migrado !== ANTIGO && /PASSE PARA UMA PESSOA/.test(migrado), migrado.slice(0, 120));
  s.ok('tira os galhos que pendiam do "NÃO TINHA"', !migrado.includes('NÃO TEVE nos 12 meses:') && !migrado.includes('PERÍODO DE GRAÇA:'), migrado);
  s.ok(
    'e NAO mexe no que vem depois: o resto do roteiro continua inteiro',
    migrado.includes('SEQUELA OU NEXO') && migrado.includes('TINHA CARTEIRA, CLT OU SERVIDOR PÚBLICO'),
    migrado,
  );
  s.ok('rodar de novo nao muda mais nada', comPassagemParaPessoa(migrado) === migrado, 'a migracao nao e idempotente');

  /* --- O que a migracao NAO pode tocar --------------------------------- */
  /*
   * Esta e a assercao que protege o escritorio de mim: mexer no que um agente
   * fala com o cliente sozinho so vale nas frases cujo inicio e fim eu
   * conheco. Roteiro reescrito pela equipe fica como esta — e nele quem segura
   * e a pessoa que o escreveu.
   */
  const daEquipe = 'Voce e a Alice do auxilio-acidente. Pergunte se o cliente trabalhava na epoca e analise com calma.';
  s.ok('roteiro escrito pela equipe nao e tocado', comPassagemParaPessoa(daEquipe) === daEquipe, comPassagemParaPessoa(daEquipe));
  const deOutraArea = agentes.find((a) => a?.nome?.includes('#05'))?.prompt || '';
  s.ok('agente de outra etapa (proposta) nao e tocado', comPassagemParaPessoa(deOutraArea) === deOutraArea, 'a migracao mexeu onde nao devia');
  s.ok('e texto vazio ou ausente nao quebra', comPassagemParaPessoa('') === '' && comPassagemParaPessoa(null) === null && comPassagemParaPessoa(undefined) === undefined);

  return s;
}
