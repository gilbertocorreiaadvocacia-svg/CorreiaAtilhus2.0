import fs from 'node:fs';
import path from 'node:path';
import { PASTA_ARQUIVOS, PORTA } from '../config.js';
import {
  apagarMensagens,
  atualizar,
  encerrarBanco,
  iniciarBanco,
  listar,
  mensagensDe,
  registrarLog,
  remover,
  removerOnde,
} from '../nucleo/banco.js';
import { caminhoDaMidia } from '../nucleo/midia.js';
import { agora, garantirPasta, gravarAtomico } from '../nucleo/util.js';

/**
 * Apaga de uma vez as conversas de um escritorio, guardando tudo antes numa
 * pasta de copia, fora do sistema.
 *
 * Uso (COM O SERVIDOR PARADO):
 *   node servidor/ferramentas/apagar-conversas.js --copia <pasta nova>
 *   node servidor/ferramentas/apagar-conversas.js --copia <pasta nova> --origem <id do workspace>
 *
 * Sem --origem, o escritorio e o geral (o unico sem area).
 *
 * Apaga o mesmo que o "Excluir conversa" da tela (DELETE /api/contatos/:id):
 * mensagens, anexos, historico, creditos, compromissos, contratos, avisos,
 * tarefas e agendamentos da conversa. A diferenca e que nada some: antes, a
 * pasta --copia recebe os registros em JSON, as mensagens de cada conversa e
 * os proprios arquivos (movidos, e nao apagados). Midia que tambem e usada por
 * template, agente ou voz e COPIADA, e continua no lugar.
 *
 * Os numeros por QR Code do escritorio ficam marcados para a importacao do
 * celular nao trazer de volta nada de antes de agora (naoTrazerAntesDe, em
 * whatsapp/importar-historico.js). A agenda de nomes do celular fica.
 *
 * Imprime so contagens.
 */

const DA_CONVERSA = ['logs', 'creditos', 'compromissos', 'contratos', 'notificacoes', 'tarefas', 'agendamentos'];

async function servidorNoAr() {
  try {
    const resposta = await fetch(`http://127.0.0.1:${PORTA}/api/saude`, { signal: AbortSignal.timeout(1500) });
    return resposta.ok;
  } catch {
    return false;
  }
}

function argumento(nome) {
  const indice = process.argv.indexOf(nome);
  return indice > -1 ? process.argv[indice + 1] : null;
}

async function principal() {
  if (await servidorNoAr()) {
    console.error(`O servidor esta no ar na porta ${PORTA}. Pare o servidor antes: com ele ligado, o que esta ferramenta gravar seria sobrescrito.`);
    process.exit(1);
  }

  const pastaCopia = argumento('--copia') ? path.resolve(argumento('--copia')) : null;
  if (!pastaCopia) {
    console.error('Diga onde guardar a copia: --copia <pasta nova>');
    process.exit(1);
  }
  if (fs.existsSync(pastaCopia) && fs.readdirSync(pastaCopia).length) {
    console.error('A pasta da copia ja existe e nao esta vazia. Escolha uma pasta nova.');
    process.exit(1);
  }

  iniciarBanco();

  const semArea = listar('workspaces').filter((w) => !w.area);
  const origemId = argumento('--origem') || (semArea.length === 1 ? semArea[0].id : null);
  const workspace = listar('workspaces').find((w) => w.id === origemId);
  if (!workspace) {
    console.error('Nao sei de qual escritorio apagar. Diga qual: --origem <id>');
    for (const w of semArea) console.error(`  ${w.id}  ${w.nome}`);
    process.exit(1);
  }

  const contatos = listar('contatos', { workspaceId: workspace.id });
  const ids = new Set(contatos.map((c) => c.id));

  /* ---------------- A copia, antes de tudo ---------------- */

  garantirPasta(pastaCopia);
  const registros = Object.fromEntries(DA_CONVERSA.map((colecao) => [colecao, listar(colecao).filter((r) => ids.has(r.contatoId))]));
  gravarAtomico(
    path.join(pastaCopia, 'conversas.json'),
    JSON.stringify({ workspace: { id: workspace.id, nome: workspace.nome }, copiadoEm: agora(), contatos, ...registros }, null, 2),
  );

  /* O nome de cada arquivo de midia usado fora das conversas. */
  const usadoFora = JSON.stringify(['templates', 'agentes', 'vozes', 'workspaces', 'integracoes', 'status', 'conhecimento'].map((c) => listar(c)));
  const guardar = (origem, destino, mover) => {
    garantirPasta(path.dirname(destino));
    if (!mover) return fs.copyFileSync(origem, destino);
    try {
      fs.renameSync(origem, destino);
    } catch {
      /* Outro disco: copia e tira do lugar. */
      fs.copyFileSync(origem, destino);
      fs.unlinkSync(origem);
    }
  };

  let mensagens = 0;
  let arquivos = 0;
  for (const contato of contatos) {
    const lista = mensagensDe(contato.id);
    mensagens += lista.length;
    gravarAtomico(path.join(pastaCopia, 'mensagens', `${contato.id}.json`), JSON.stringify(lista, null, 2));

    const midias = [...lista.map((m) => m.midia?.url), contato.foto].filter(Boolean);
    for (const url of midias) {
      const caminho = caminhoDaMidia(url);
      if (!caminho) continue;
      const nome = path.basename(caminho);
      guardar(caminho, path.join(pastaCopia, 'midia', nome), !usadoFora.includes(nome));
      arquivos += 1;
    }
    for (const arquivo of contato.arquivos || []) {
      const origem = path.join(PASTA_ARQUIVOS, arquivo.caminho || '');
      if (!arquivo.caminho || !fs.existsSync(origem)) continue;
      guardar(origem, path.join(pastaCopia, 'arquivos', arquivo.caminho), true);
      arquivos += 1;
    }
  }

  /* ---------------- Tirar do sistema ---------------- */

  for (const contato of contatos) {
    apagarMensagens(contato.id);
    for (const colecao of DA_CONVERSA) removerOnde(colecao, { contatoId: contato.id });
    remover('contatos', contato.id);
  }

  const corte = agora();
  let numeros = 0;
  for (const conexao of listar('conexoes', { workspaceId: workspace.id })) {
    if (conexao.tipo !== 'qrcode') continue;
    atualizar('conexoes', conexao.id, { historico: { ...(conexao.historico || {}), situacao: 'concluido', naoTrazerAntesDe: corte } });
    numeros += 1;
  }

  registrarLog(workspace.id, null, 'exclusao', `${contatos.length} conversas apagadas de uma vez, com copia guardada fora do sistema`, {
    tipo: 'sistema',
    nome: 'Sistema',
  });

  await encerrarBanco();
  console.log(
    `${workspace.nome}: ${contatos.length} conversas e ${mensagens} mensagens apagadas, ${arquivos} arquivos guardados na copia, ${numeros} numeros marcados para nao trazer o historico antigo de volta.`,
  );
  process.exit(0);
}

principal().catch((erro) => {
  console.error(`Falhou: ${erro.message}`);
  process.exit(1);
});
