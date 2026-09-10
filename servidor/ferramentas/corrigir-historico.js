import { atualizar, iniciarBanco, encerrarBanco, listar, mensagensDe, registrarLog } from '../nucleo/banco.js';

/**
 * Conserta duas sequelas da importacao de historico.
 *
 * Rode com `npm run corrigir-historico`, com o SISTEMA PARADO — ela mexe nos
 * arquivos de dados, e o servidor no ar tem tudo em memoria e sobrescreveria a
 * correcao no primeiro salvamento.
 *
 * 1. A ORDEM DAS MENSAGENS
 *
 * A importacao grava em lotes, e um segundo lote trazendo mensagens antigas as
 * poe no FIM da lista. A tela mostra as ultimas 300 da lista, o que numa
 * conversa remendada assim significa mostrar um pedaco do meio: uma conversa
 * que ia ate hoje aparecia terminando em 18 de agosto.
 *
 * A rota ja passou a ordenar por data ao servir, entao a tela esta certa mesmo
 * sem esta correcao. Ela existe porque a ordem no disco alimenta outras coisas
 * — a previa da lista, a exportacao, o espelho — e deixar o arquivo torto
 * significa consertar o mesmo defeito de novo em cada lugar que o le.
 *
 * 2. O NOME DE QUEM FALA
 *
 * A conversa importada por telefone entrou com o numero no lugar do nome. A
 * Evolution guarda 1.202 nomes, chaveados por telefone, e ninguem os tinha
 * lido: o importador so olhava o pushName das mensagens, que muitas vezes vem
 * vazio no historico sincronizado.
 *
 * Isto NAO resolve as conversas que entraram so com o codigo @lid: para elas
 * nao ha telefone, e sem telefone nao ha o que casar. Nesta versao da Evolution
 * (v2.3.7) o vinculo @lid -> telefone e gravado como a palavra literal "lid",
 * tanto na tabela IsOnWhatsapp quanto na resposta de whatsappNumbers — ou seja,
 * o dado nao existe para ser lido.
 */

function ordenarMensagens() {
  let conversasTortas = 0;
  let mensagensMovidas = 0;

  for (const contato of listar('contatos')) {
    const lista = mensagensDe(contato.id);
    if (lista.length < 2) continue;

    let torta = false;
    for (let i = 1; i < lista.length; i += 1) {
      if (String(lista[i].criadoEm) < String(lista[i - 1].criadoEm)) { torta = true; break; }
    }
    if (!torta) continue;

    const ordenada = [...lista].sort((a, b) => String(a.criadoEm).localeCompare(String(b.criadoEm)));
    /* Escreve NO MESMO array: e ele que o banco guarda e salva em disco.
       Trocar a referencia deixaria o arquivo como estava. */
    lista.length = 0;
    lista.push(...ordenada);

    conversasTortas += 1;
    mensagensMovidas += ordenada.length;

    /* A previa e a data da conversa vinham da ultima da LISTA, que era do lote
       antigo: a fila mostrava a conversa como parada ha semanas. */
    const ultima = ordenada[ordenada.length - 1];
    atualizar('contatos', contato.id, {
      ultimaMensagemEm: ultima.criadoEm,
      primeiraMensagemEm: ordenada[0].criadoEm,
      previa: (ultima.conteudo || `[${ultima.tipo}]`).slice(0, 120),
    });
  }

  return { conversasTortas, mensagensMovidas };
}

async function nomearPelaAgenda(base, chave, instancia) {
  const resposta = await fetch(`${base}/chat/findContacts/${instancia}`, {
    method: 'POST',
    headers: { apikey: chave, 'Content-Type': 'application/json' },
    body: '{}',
    signal: AbortSignal.timeout(60000),
  });
  if (!resposta.ok) throw new Error(`A Evolution respondeu ${resposta.status} ao listar contatos.`);

  const contatos = await resposta.json();
  const porTelefone = new Map();
  for (const c of Array.isArray(contatos) ? contatos : []) {
    const jid = String(c?.remoteJid || '');
    if (!jid.endsWith('@s.whatsapp.net')) continue;
    const telefone = jid.split('@')[0];
    const nome = String(c?.pushName || '').trim();
    /* Nome que e o proprio numero nao e nome. */
    if (!nome || nome === telefone) continue;
    porTelefone.set(telefone, nome);
  }

  let nomeados = 0;
  const exemplos = [];
  for (const contato of listar('contatos')) {
    if (!contato.telefone) continue;
    const nome = porTelefone.get(contato.telefone);
    if (!nome) continue;
    /* So renomeia quem esta sem nome de verdade — nunca por cima do que
       alguem do escritorio escreveu a mao. */
    const semNome = !contato.nome || contato.nome === contato.telefone || contato.nome === 'Conversa sem identificacao';
    if (!semNome) continue;

    atualizar('contatos', contato.id, { nome });
    registrarLog(contato.workspaceId, contato.id, 'nome', `Nome trazido da agenda do WhatsApp: ${nome}`);
    nomeados += 1;
    if (exemplos.length < 8) exemplos.push(`${contato.telefone} -> ${nome}`);
  }

  return { disponiveis: porTelefone.size, nomeados, exemplos };
}

async function principal() {
  iniciarBanco();

  const conexao = listar('conexoes').find((c) => c.tipo === 'qrcode');
  if (!conexao) { console.log('Nao ha conexao por QR Code.'); encerrarBanco(); return; }

  console.log('\n  Corrigindo o historico importado\n');

  const ordem = ordenarMensagens();
  console.log(`  ordem das mensagens: ${ordem.conversasTortas} conversas reordenadas (${ordem.mensagensMovidas} mensagens)`);

  const cfg = conexao.qrcode || {};
  if (!cfg.servidor || !cfg.chave) {
    console.log('  nomes: conexao sem endereco ou chave, pulado');
  } else {
    try {
      const nomes = await nomearPelaAgenda(String(cfg.servidor).replace(/\/+$/, ''), cfg.chave, cfg.instancia);
      console.log(`  nomes na agenda do WhatsApp: ${nomes.disponiveis}`);
      console.log(`  conversas nomeadas: ${nomes.nomeados}`);
      for (const e of nomes.exemplos) console.log(`     ${e}`);
    } catch (erro) {
      console.log(`  nomes: ${erro.message}`);
    }
  }

  const semNome = listar('contatos').filter((c) => !c.telefone).length;
  if (semNome) {
    console.log(`\n  ${semNome} conversas continuam sem telefone e sem nome.`);
    console.log('  Elas vieram do historico enderecadas so por codigo interno, e esta');
    console.log('  versao da Evolution nao guarda o vinculo com o telefone. Cada uma');
    console.log('  se identifica sozinha quando a pessoa voltar a escrever.');
  }

  encerrarBanco();
  console.log('');
}

principal().catch((erro) => {
  console.error('A correcao quebrou:', erro.message);
  process.exit(1);
});
