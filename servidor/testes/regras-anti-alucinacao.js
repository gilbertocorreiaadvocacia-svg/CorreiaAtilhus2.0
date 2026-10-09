import { PACOTES } from '../ia/pacotes.js';
import { suite } from './apoio.js';

/**
 * Trava contra regressao do que foi corrigido em 09/10/2026, a partir de
 * reclamacao real do escritorio ("os agentes estao alucinando" — inventando
 * resultado/valor/prazo do processo, e respondendo fora do assunto):
 *
 * 1. maternidade.js tinha o roteiro mandando a IA dizer literalmente "voce
 *    tem direito... pode receber ate R$6.484,00" — nao era o modelo
 *    alucinando, era o proprio script prometendo. Removido.
 * 2. trabalhista.js e maternidade.js nao tinham NENHUMA linha proibindo
 *    prometer valor de beneficio/indenizacao/resultado (so a regra generica
 *    do motor.js, no fim do prompt inteiro, cobria isso). Acrescentada.
 * 3. bpc.js e auxilio-acidente.js proibiam "exito" mas nao citavam "valor de
 *    beneficio" por nome. Reforcado.
 * 4. A Triagem Trabalhista liberava responder duvida juridica "da forma bem
 *    didatica e simples", sem exigir consulta a @biblioteca — abria a porta
 *    para o modelo responder do proprio treinamento. Corrigido.
 *
 * Este teste nao prova que o modelo nunca vai alucinar (isso so a conversa
 * real com a IA prova) — prova que a INSTRUCAO que existe para evitar isso
 * continua no prompt, e que a promessa literal nao volta por engano numa
 * edicao futura.
 */
export async function testarRegrasAntiAlucinacao() {
  const s = suite('Regras anti-alucinacao nos prompts');

  const agentePorNome = (areaId, nome) => PACOTES[areaId].agentes.find((a) => a.nome === nome);
  /* Avaliacao nunca fala de caso (nao precisa da regra) e Pos-venda tem a
     propria regra, com texto diferente (ver testarPosVenda) — os dois ficam
     fora dos loops abaixo, que conferem o texto exato de cada squad. */
  const naoAvaliacao = (areaId) => PACOTES[areaId].agentes.filter((a) => a.objetivo !== 'avaliar' && !a.nome.startsWith('Pós-venda'));

  const posVenda = (areaId) => PACOTES[areaId].agentes.find((a) => a.nome.startsWith('Pós-venda'));
  for (const areaId of ['previdenciario', 'trabalhista', 'civel']) {
    const agente = posVenda(areaId);
    s.ok(`${agente?.nome}: tem a propria regra de nao prometer resultado/valor/prazo`, /nunca prometa resultado, valor, indeniza[cç][aã]o ou prazo/i.test(agente?.prompt || ''), (agente?.prompt || '').slice(0, 50));
  }

  /* 1 e 2: maternidade.js nao promete mais, e tem a regra geral. */
  const mariana = agentePorNome('previdenciario', 'Mariana (Materno 2)');
  s.ok('Mariana existe no pacote Previdenciario', Boolean(mariana));
  s.ok(
    'a promessa literal de direito e valor fixo foi removida da Mariana',
    !/voc[eê] tem direito ao sal[aá]rio maternidade.*R\$ ?6\.484/i.test(mariana?.prompt || ''),
    (mariana?.prompt || '').slice(0, 50),
  );
  s.ok(
    'a Mariana explica que o valor depende da analise do advogado',
    /an[aá]lise do advogado/i.test(mariana?.prompt || '') && /m[eé]dia salarial/i.test(mariana?.prompt || ''),
  );
  for (const agente of naoAvaliacao('previdenciario').filter((a) => ['Juliana (Materno 1)', 'Mariana (Materno 2)', 'Clousa (Materno 3)'].includes(a.nome))) {
    s.ok(
      `${agente.nome}: tem a regra de nao prometer valor/resultado/prazo`,
      /nunca prometa resultado.*valor de benef[ií]cio/i.test(agente.prompt),
      agente.prompt.slice(0, 80),
    );
  }

  /* 3: bpc e auxilio-acidente citam "valor de beneficio" nos LIMITES. */
  for (const agente of naoAvaliacao('previdenciario').filter((a) => !['Eduarda (Triagem)', 'Juliana (Materno 1)', 'Mariana (Materno 2)', 'Clousa (Materno 3)'].includes(a.nome))) {
    s.ok(`${agente.nome}: os LIMITES citam valor de beneficio por nome`, /valor de benef[ií]cio/i.test(agente.prompt), agente.prompt.slice(0, 120));
  }

  /* 2 (trabalhista) e 4: regra geral + exigencia de @biblioteca na Triagem. */
  for (const agente of naoAvaliacao('trabalhista')) {
    s.ok(`${agente.nome}: tem a regra de nao prometer resultado/indenizacao/prazo`, /nunca prometa resultado da a[cç][aã]o.*valor de indeniza[cç][aã]o/i.test(agente.prompt), agente.prompt.slice(0, 80));
  }
  const triagemTrabalhista = agentePorNome('trabalhista', 'Triagem Trabalhista');
  s.ok(
    'a Triagem Trabalhista exige @biblioteca antes de responder duvida juridica',
    /pergunta jur[ií]dica trabalhista, consulte @biblioteca/i.test(triagemTrabalhista?.prompt || ''),
    (triagemTrabalhista?.prompt || '').slice(0, 50),
  );

  /* O exemplo de honorarios nao pode mais usar dado real do cliente. */
  const propostaETrabalhista = agentePorNome('trabalhista', 'Proposta e Objeções');
  s.ok(
    'o exemplo de honorarios trabalhista proibe usar o salario/tempo real do cliente',
    /NUNCA com um valor baseado no sal[aá]rio/i.test(propostaETrabalhista?.prompt || ''),
    (propostaETrabalhista?.prompt || '').slice(0, 50),
  );

  /* Civel usa REGRAS_DE_SEMPRE (montar()), que agora tambem cobre as duas regras. */
  for (const agente of naoAvaliacao('civel')) {
    s.ok(`${agente.nome}: tem a regra de nao prometer valor/resultado/prazo`, /nunca prometa resultado.*valor de benef[ií]cio/i.test(agente.prompt), agente.prompt.slice(-400));
    s.ok(`${agente.nome}: tem a regra de consultar @biblioteca antes de responder fora do roteiro`, /pergunta fora do roteiro.*consulte @biblioteca/i.test(agente.prompt), agente.prompt.slice(-400));
  }

  return s;
}
