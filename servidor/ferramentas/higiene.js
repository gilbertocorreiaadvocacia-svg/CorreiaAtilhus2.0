import { atualizar, encerrarBanco, iniciarBanco, inserir, listar, remover, tabela } from '../nucleo/banco.js';
import { normalizar, novoId } from '../nucleo/util.js';

/**
 * A faxina do funil, uma vez so.
 *
 * Rode com `npm run higiene` (simula e nao grava nada) e, depois de conferir a
 * conta, `npm run higiene -- --aplicar`. SEMPRE COM O SISTEMA PARADO: ela mexe
 * nos arquivos de dados, e o servidor no ar tem tudo em memoria e sobrescreve
 * a correcao no primeiro salvamento.
 *
 * O que ela conserta, e por que cada coisa existia:
 *
 * 1. O NUMERO SEM CLASSIFICACAO. O numero Trabalhista entrou sem status nem
 *    departamento padrao. Toda conversa que ele recebeu nasceu sem coluna: sao
 *    as 1.185 conversas fora do funil. Enquanto o numero ficar assim, limpar o
 *    passado nao adianta, porque amanha tem 1.186.
 *
 *    Trabalhista ganha departamento proprio e uma coluna de ENTRADA propria.
 *    A coluna precisa ser propria porque quem manda no departamento da conversa
 *    e o status, e nao a conexao (ver automacao/followup.js): apontar este
 *    numero para a coluna "NOVO lead", que e do Comercial, faria todo lead
 *    trabalhista cair no funil comercial no instante seguinte.
 *
 * 2. O PASSADO. As 1.185 sao historico do WhatsApp trazido pela importacao, e
 *    nao lead que passou pelo funil. Viram "Historico Trabalhista", uma coluna
 *    fora do funil comercial: o Kanban passa a mostrar a verdade em vez de
 *    1.185 leads novos que nunca existiram como leads.
 *
 *    A mudanca e gravada direto, sem passar por aplicarStatus. Aquele caminho
 *    dispara follow-up, marca conversao na Meta e grava uma linha de log por
 *    conversa: aqui seriam 1.185 mensagens de verdade para clientes de verdade
 *    por causa de uma arrumacao de cadastro.
 *
 * 3. AS COLUNAS REPETIDAS. Tres "Nao Qualificado" no mesmo funil, nenhuma por
 *    engano: quem precisava da coluna nao tinha como juntar duas, entao criava
 *    outra. O sistema agora recusa nome repetido e sabe unificar; aqui sobra
 *    apagar as sobras, que estao vazias.
 *
 * 4. O RUIDO NO LOG. A tela do QR Code testava a conexao de tres em tres
 *    segundos e cada teste que falhava gravava uma linha. Um diagnostico leu
 *    isso como 34 desconexoes em 99 segundos e culpou o numero. O servidor ja
 *    so registra mudanca; estas linhas sao as que ficaram para tras.
 */

const APLICAR = process.argv.includes('--aplicar');

/** Acha pelo nome, sem depender de acento nem de maiuscula. */
function porNome(colecao, workspaceId, nome) {
  return listar(colecao, { workspaceId }).find((r) => normalizar(r.nome) === normalizar(nome)) || null;
}

function passo(titulo) {
  console.log(`\n${titulo}`);
}

function feito(texto) {
  console.log(`  ${APLICAR ? '[feito]' : '[simulado]'} ${texto}`);
}

async function principal() {
  await iniciarBanco();

  const workspace = listar('workspaces')[0];
  if (!workspace) {
    console.error('Nenhum workspace na base.');
    process.exit(1);
  }
  const w = workspace.id;
  console.log(`Higiene do funil - ${workspace.nome}`);
  console.log(
    APLICAR
      ? 'MODO APLICAR: as mudancas serao gravadas.'
      : 'MODO SIMULACAO: nada sera gravado. Use --aplicar depois de conferir.',
  );

  /* 1. Departamento e coluna de entrada do Trabalhista ------------------ */

  passo('1. O numero Trabalhista');

  const conexao = listar('conexoes', { workspaceId: w }).find((c) => normalizar(c.nome) === 'trabalhista');
  if (!conexao) feito('numero "Trabalhista" nao existe nesta base: os passos 1 e 2 ficam so no que der.');

  let departamento = porNome('departamentos', w, 'Trabalhista');
  if (departamento) {
    feito(`departamento "Trabalhista" ja existe (${departamento.id}).`);
  } else {
    feito('criar departamento "Trabalhista".');
    if (APLICAR) {
      departamento = inserir('departamentos', {
        id: novoId('dep'),
        workspaceId: w,
        nome: 'Trabalhista',
        cor: 'var(--serie-5)',
      });
    }
  }

  let entrada = porNome('status', w, 'Novo lead Trabalhista');
  if (entrada) {
    feito(`coluna de entrada "Novo lead Trabalhista" ja existe (${entrada.id}).`);
  } else {
    feito('criar coluna "Novo lead Trabalhista" (tipo nova, departamento Trabalhista).');
    if (APLICAR) {
      entrada = inserir('status', {
        id: novoId('sts'),
        workspaceId: w,
        nome: 'Novo lead Trabalhista',
        cor: 'var(--serie-5)',
        descricao: 'Primeira parada de quem escreve para o numero do Trabalhista.',
        tipo: 'nova',
        departamentoId: departamento?.id || null,
        followups: [],
        momentos: [],
      });
    }
  }

  if (conexao) {
    if (conexao.statusPadraoId && conexao.departamentoPadraoId) {
      feito('o numero ja tem status e departamento padrao: nao mexo.');
    } else {
      feito(`apontar o numero "${conexao.nome}" para a coluna de entrada e o departamento Trabalhista.`);
      if (APLICAR) {
        atualizar('conexoes', conexao.id, {
          statusPadraoId: conexao.statusPadraoId || entrada?.id || null,
          departamentoPadraoId: conexao.departamentoPadraoId || departamento?.id || null,
        });
      }
    }
  }

  /* 2. As conversas sem coluna ------------------------------------------ */

  passo('2. As conversas sem coluna');

  const semStatus = listar('contatos', { workspaceId: w }).filter((c) => !c.statusId);
  if (!semStatus.length) {
    feito('nenhuma conversa sem coluna.');
  } else {
    const daConexao = conexao ? semStatus.filter((c) => c.conexaoId === conexao.id) : [];
    const deOutras = semStatus.length - daConexao.length;

    let historico = porNome('status', w, 'Historico Trabalhista');
    if (historico) {
      feito(`coluna "Historico Trabalhista" ja existe (${historico.id}).`);
    } else {
      feito('criar coluna "Historico Trabalhista" (fora do funil comercial).');
      if (APLICAR) {
        historico = inserir('status', {
          id: novoId('sts'),
          workspaceId: w,
          nome: 'Historico Trabalhista',
          cor: 'var(--texto-fraco)',
          descricao:
            'Conversas que o celular trouxe na importacao. Nao sao leads do funil: sao contexto para consultar.',
          tipo: 'nenhum',
          departamentoId: departamento?.id || null,
          followups: [],
          momentos: [],
        });
      }
    }

    feito(`mover ${daConexao.length} conversas do numero Trabalhista para "Historico Trabalhista".`);
    if (deOutras) {
      feito(`ATENCAO: ${deOutras} conversas sem coluna NAO sao deste numero. Ficam como estao, para olhar uma a uma.`);
    }
    if (APLICAR && historico) {
      for (const contato of daConexao) {
        atualizar('contatos', contato.id, { statusId: historico.id, departamentoId: departamento?.id || null });
      }
    }
  }

  /* 3. As colunas repetidas --------------------------------------------- */

  passo('3. Colunas com nome repetido');

  const porNomeNormalizado = new Map();
  for (const s of listar('status', { workspaceId: w })) {
    const chave = normalizar(s.nome);
    if (!porNomeNormalizado.has(chave)) porNomeNormalizado.set(chave, []);
    porNomeNormalizado.get(chave).push(s);
  }

  let repetidas = 0;
  for (const grupo of porNomeNormalizado.values()) {
    if (grupo.length < 2) continue;
    /* Fica a que tem conversa; empatando, fica a primeira. As outras so saem
       se estiverem vazias: apagar coluna com conversa dentro largaria a
       conversa apontando para um id que nao existe mais. */
    const contatos = listar('contatos', { workspaceId: w });
    const comContagem = grupo.map((s) => ({ s, quantas: contatos.filter((c) => c.statusId === s.id).length }));
    comContagem.sort((a, b) => b.quantas - a.quantas);
    const fica = comContagem[0].s;

    for (const { s, quantas } of comContagem.slice(1)) {
      repetidas += 1;
      if (quantas) {
        feito(`"${s.nome}" (${s.id}) tem ${quantas} conversas: NAO apago. Use Unificar na tela de Status.`);
        continue;
      }
      if (listar('conexoes', { workspaceId: w }).some((c) => c.statusPadraoId === s.id)) {
        feito(`"${s.nome}" (${s.id}) e status padrao de um numero: NAO apago.`);
        continue;
      }
      feito(`apagar a repetida "${s.nome}" (${s.id}), vazia. Fica "${fica.nome}" (${fica.id}).`);
      if (APLICAR) remover('status', s.id);
    }
  }
  if (!repetidas) feito('nenhuma coluna repetida.');

  /* 4. O ruido da sondagem antiga ---------------------------------------- */

  passo('4. Ruido no log de conexao');

  const logs = tabela('logs');
  const ruido = logs.filter(
    (l) => l.workspaceId === w && l.tipo === 'conexao_desconectado' && /^Teste falhou/.test(String(l.descricao || '')),
  );
  feito(`${ruido.length} linhas "Teste falhou" da sondagem antiga${ruido.length ? ' para apagar' : ''}.`);
  if (APLICAR && ruido.length) {
    /* Passa pelo remover() de um em um: e ele que marca a tabela como suja
       para o salvamento em disco. Mexer no array na mao grava na memoria e
       some no proximo restart. */
    for (const linha of ruido) remover('logs', linha.id);
  }

  /* Fecho ----------------------------------------------------------------- */

  if (APLICAR) {
    await encerrarBanco();
    console.log('\nPronto. Suba o sistema de novo.');
  } else {
    console.log('\nNada foi gravado. Confira a conta acima e rode de novo com --aplicar.');
  }
  process.exit(0);
}

principal().catch((erro) => {
  console.error('\nA higiene parou:', erro.message);
  console.error(erro.stack);
  process.exit(1);
});
