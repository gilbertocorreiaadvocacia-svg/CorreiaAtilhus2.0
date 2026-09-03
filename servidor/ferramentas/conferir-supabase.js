import fs from 'node:fs';
import path from 'node:path';
import { PASTA_DADOS, PASTA_MENSAGENS } from '../config.js';

/**
 * Conferencia JSON x Supabase.
 *
 * A escrita dupla sempre prometeu poder conferir os dois lados antes de virar a
 * chave. Este script cumpre a promessa: conta cada coleção no disco e compara
 * com a contagem que o Supabase devolve pela funcao `contar_atendimento`.
 *
 * Nao muda nada em lugar nenhum — so le e compara. Serve para dizer, com numero,
 * se a carga inicial pegou tudo e se o espelho continuo esta acompanhando.
 *
 * Mesmas variaveis do espelho:
 *   set CORREIA_SUPABASE_URL=...   set CORREIA_SUPABASE_CHAVE=<service_role>
 *   node servidor/ferramentas/conferir-supabase.js
 */

const URL_BASE = (process.env.CORREIA_SUPABASE_URL || '').replace(/\/+$/, '');
const CHAVE = process.env.CORREIA_SUPABASE_CHAVE || '';

const COLECOES = [
  'workspaces', 'usuarios', 'membros', 'conexoes', 'status', 'departamentos',
  'etiquetas', 'origens', 'variaveis', 'agentes', 'conhecimento', 'templates',
  'contatos', 'tarefas', 'agendamentos', 'contratos', 'compromissos', 'logs',
  'notificacoes', 'creditos', 'integracoes', 'vozes', 'chavesApi', 'configuracoes',
];
const TABELA_DA_COLECAO = { chavesApi: 'chaves_api' };

function contarDisco() {
  const conta = {};
  for (const colecao of COLECOES) {
    const tabela = TABELA_DA_COLECAO[colecao] || colecao;
    try {
      const arr = JSON.parse(fs.readFileSync(path.join(PASTA_DADOS, `${colecao}.json`), 'utf8'));
      conta[tabela] = Array.isArray(arr) ? arr.length : 0;
    } catch {
      conta[tabela] = 0;
    }
  }
  let mensagens = 0;
  if (fs.existsSync(PASTA_MENSAGENS)) {
    for (const arquivo of fs.readdirSync(PASTA_MENSAGENS)) {
      if (!arquivo.endsWith('.json')) continue;
      try {
        const lista = JSON.parse(fs.readFileSync(path.join(PASTA_MENSAGENS, arquivo), 'utf8'));
        if (Array.isArray(lista)) mensagens += lista.length;
      } catch {
        /* arquivo quebrado nao conta */
      }
    }
  }
  conta.mensagens = mensagens;
  return conta;
}

async function contarSupabase() {
  const resposta = await fetch(`${URL_BASE}/rest/v1/rpc/contar_atendimento`, {
    method: 'POST',
    headers: {
      apikey: CHAVE,
      Authorization: `Bearer ${CHAVE}`,
      'Content-Type': 'application/json',
    },
    body: '{}',
  });
  if (!resposta.ok) {
    throw new Error(`HTTP ${resposta.status}: ${(await resposta.text()).slice(0, 300)}`);
  }
  return resposta.json();
}

async function conferir() {
  if (!URL_BASE || !CHAVE) {
    console.error('Faltam as variaveis CORREIA_SUPABASE_URL e CORREIA_SUPABASE_CHAVE.');
    process.exit(1);
  }

  const disco = contarDisco();
  const nuvem = await contarSupabase();

  const tabelas = [...new Set([...Object.keys(disco), ...Object.keys(nuvem)])].sort();
  let divergencias = 0;

  console.log(`\n  ${'tabela'.padEnd(16)} ${'JSON'.padStart(7)} ${'Supabase'.padStart(9)}  situacao`);
  console.log(`  ${'-'.repeat(16)} ${'-'.repeat(7)} ${'-'.repeat(9)}  ${'-'.repeat(8)}`);
  for (const tabela of tabelas) {
    const d = disco[tabela] ?? 0;
    const n = Number(nuvem[tabela] ?? 0);
    const bate = d === n;
    if (!bate) divergencias += 1;
    console.log(
      `  ${tabela.padEnd(16)} ${String(d).padStart(7)} ${String(n).padStart(9)}  ${bate ? 'ok' : 'DIVERGE'}`,
    );
  }

  console.log('');
  if (divergencias === 0) {
    console.log('  Tudo bate: o Supabase esta igual ao JSON.');
  } else {
    console.log(`  ${divergencias} tabela(s) divergem. Rode a carga (carregar-supabase.js) para acertar.`);
  }
  process.exit(divergencias === 0 ? 0 : 2);
}

conferir().catch((erro) => {
  console.error('\n  Falha na conferencia:', erro.message);
  process.exit(1);
});
