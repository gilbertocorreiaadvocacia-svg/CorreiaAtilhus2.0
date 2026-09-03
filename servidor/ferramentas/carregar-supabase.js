import fs from 'node:fs';
import path from 'node:path';
import { PASTA_DADOS, PASTA_MENSAGENS } from '../config.js';

/**
 * Carga inicial do Supabase (backfill), rodada uma vez.
 *
 * O espelho da escrita dupla so copia o que MUDA depois que o servidor sobe. Os
 * dados que ja existiam antes disso (os contatos, os logs, as mensagens de hoje)
 * nunca passaram pelo espelho. Este script pega tudo o que esta em `dados/` e
 * empurra pela mesma porta que o espelho usa (a funcao `espelhar_atendimento`),
 * para o Supabase comecar do mesmo ponto em que o JSON esta.
 *
 * Idempotente: a funcao faz `on conflict do update`, entao rodar de novo nao
 * duplica nada, so reescreve com o estado atual. Pode rodar quantas vezes quiser.
 *
 * NAO sobe junto com o servidor de proposito: e uma acao explicita, que o
 * escritorio dispara quando decide preparar o Supabase. Precisa das mesmas
 * variaveis do espelho:
 *
 *   set CORREIA_SUPABASE_URL=https://xxxx.supabase.co
 *   set CORREIA_SUPABASE_CHAVE=<service_role>
 *   node servidor/ferramentas/carregar-supabase.js
 */

const URL_BASE = (process.env.CORREIA_SUPABASE_URL || '').replace(/\/+$/, '');
const CHAVE = process.env.CORREIA_SUPABASE_CHAVE || '';

/* As 24 colecoes do banco, na mesma ordem em que o banco.js as declara. As de
   configuracao vao primeiro por clareza; a ordem nao muda o resultado, porque
   cada linha e um upsert independente por id. */
const COLECOES = [
  'workspaces', 'usuarios', 'membros', 'conexoes', 'status', 'departamentos',
  'etiquetas', 'origens', 'variaveis', 'agentes', 'conhecimento', 'templates',
  'contatos', 'tarefas', 'agendamentos', 'contratos', 'compromissos', 'logs',
  'notificacoes', 'creditos', 'integracoes', 'vozes', 'chavesApi', 'configuracoes',
];

/* O nome da colecao no codigo nem sempre e o nome da tabela no Postgres. Mesma
   traducao do espelho, para os dois falarem a mesma lingua. */
const TABELA_DA_COLECAO = { chavesApi: 'chaves_api' };

const LOTE_MAXIMO = 500;

function lerJson(caminho) {
  try {
    return JSON.parse(fs.readFileSync(caminho, 'utf8'));
  } catch {
    return null;
  }
}

async function enviarLote(lote) {
  const resposta = await fetch(`${URL_BASE}/rest/v1/rpc/espelhar_atendimento`, {
    method: 'POST',
    headers: {
      apikey: CHAVE,
      Authorization: `Bearer ${CHAVE}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ lote }),
  });
  if (!resposta.ok) {
    throw new Error(`HTTP ${resposta.status}: ${(await resposta.text()).slice(0, 300)}`);
  }
  return resposta.json();
}

async function carregar() {
  if (!URL_BASE || !CHAVE) {
    console.error('Faltam as variaveis CORREIA_SUPABASE_URL e CORREIA_SUPABASE_CHAVE.');
    console.error('Rode pelo segredos.bat, ou defina-as antes de chamar o script.');
    process.exit(1);
  }

  const porColecao = {};
  let total = 0;
  let fila = [];

  const despejar = async () => {
    if (!fila.length) return;
    await enviarLote(fila);
    total += fila.length;
    fila = [];
  };

  const empurrar = async (tabela, registro) => {
    if (!registro?.id) return;
    fila.push({ t: tabela, id: registro.id, d: registro });
    if (fila.length >= LOTE_MAXIMO) await despejar();
  };

  /* Coleções normais, um arquivo por coleção. */
  for (const colecao of COLECOES) {
    const tabela = TABELA_DA_COLECAO[colecao] || colecao;
    const registros = lerJson(path.join(PASTA_DADOS, `${colecao}.json`));
    if (!Array.isArray(registros)) {
      porColecao[tabela] = 0;
      continue;
    }
    for (const registro of registros) await empurrar(tabela, registro);
    porColecao[tabela] = registros.length;
    process.stdout.write(`  ${tabela.padEnd(16)} ${String(registros.length).padStart(5)}\n`);
  }

  /* Mensagens: um arquivo por conversa. */
  let mensagens = 0;
  if (fs.existsSync(PASTA_MENSAGENS)) {
    for (const arquivo of fs.readdirSync(PASTA_MENSAGENS)) {
      if (!arquivo.endsWith('.json')) continue;
      const lista = lerJson(path.join(PASTA_MENSAGENS, arquivo));
      if (!Array.isArray(lista)) continue;
      for (const msg of lista) await empurrar('mensagens', msg);
      mensagens += lista.length;
    }
  }
  porColecao.mensagens = mensagens;
  process.stdout.write(`  ${'mensagens'.padEnd(16)} ${String(mensagens).padStart(5)}\n`);

  await despejar();

  console.log(`\n  Total enviado ao Supabase: ${total} registros.`);
  return { total, porColecao };
}

carregar().catch((erro) => {
  console.error('\n  Falha na carga:', erro.message);
  process.exit(1);
});
