import { spawn } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

import { suite } from './apoio.js';

/**
 * A ZapSign responde 200, e sem endereco de assinatura.
 *
 * Pedido do escritorio em 16/11/2026: "os agentes ainda nao estao enviando o
 * link do contrato [...] reveja toda a parte desse processo".
 *
 * ACONTECE: a ZapSign cria o documento e devolve 200 com `signers` vazio, ou
 * com o signatario sem `sign_url` — modelo sem campo de assinante configurado,
 * por exemplo. Nao e erro de rede nem recusa: e um sucesso pela metade.
 *
 * O QUE O SISTEMA FAZIA COM ISSO, e que e o defeito de verdade:
 *
 *   const link = documento?.signers?.[0]?.sign_url || null;   // null
 *   atualizar(..., { situacao: 'link_enviado', link });        // "enviado"
 *   enviarLink(...)  ->  "...pronto para assinar:\\n\\nnull"
 *
 * O cliente recebia a palavra "null" onde deveria estar o endereco; o contrato
 * ficava marcado como enviado; `entregue` voltava true porque a mensagem SAIU;
 * e o agente era instruido a NAO repetir o link. Ninguem era avisado de nada.
 * Do lado de fora, o sintoma e exatamente "o agente nao manda o link".
 *
 * O QUE ESTA SUITE TRAVA:
 *
 *  - mensagem nenhuma com "null" no lugar do link chega ao cliente;
 *  - o contrato NAO vira "link_enviado" sem link;
 *  - o agente NAO e mandado calar: ele recebe instrucao de nao prometer o link;
 *  - a equipe fica sabendo, com o motivo e onde achar o documento;
 *  - e, com link, tudo continua como antes.
 */
export async function testarContratoSemLink({ raiz, zapsign }) {
  const s = suite('ZapSign devolve o documento sem link de assinatura');
  const url = (arquivo) => JSON.stringify(pathToFileURL(path.join(raiz, arquivo)).href);
  const pasta = fs.mkdtempSync(path.join(os.tmpdir(), 'contrato-sem-link-'));
  const script = path.join(pasta, 'sem-link.mjs');

  const CHAVE = process.env.CORREIA_ZAPSIGN_CHAVE || 'zs-de-mentira';
  const semLinkNaFalsa = (ligado) =>
    fetch(`${zapsign}/__semlink`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ semLink: ligado }) });

  /* O modelo que a ZapSign de mentira publica, para o escritorio de teste
     apontar para um que existe la. A falsa cobra a chave como a de verdade,
     entao a conversa com ela vai de fetch cru, e nao pelo cliente da suite
     (que fala com o SISTEMA, e manda cookie em vez de Bearer). */
  const modelos = await fetch(`${zapsign}/api/v1/templates/`, { headers: { Authorization: `Bearer ${CHAVE}` } })
    .then((r) => r.json())
    .catch(() => null);
  const primeiro = Array.isArray(modelos) ? modelos[0] : null;
  if (!s.ok('a ZapSign de mentira publica ao menos um modelo', Boolean(primeiro?.token), JSON.stringify(modelos).slice(0, 200))) return s;

  fs.writeFileSync(
    script,
    `import http from 'node:http';
import { iniciarBanco, achar, inserir, listar, mensagensDe, encerrarBanco } from ${url('servidor/nucleo/banco.js')};
import { pedirContrato } from ${url('servidor/integracoes/zapsign.js')};
iniciarBanco();

/*
 * Liga e desliga o "200 sem link" na ZapSign de mentira.
 *
 * http cru, e nao fetch: no Windows, a conexao que o fetch deixa viva faz o
 * process.exit do fim estourar uma assercao do libuv, e o teste reprovava por
 * causa da saida, nao do que ele afirma.
 */
const semLinkNaFalsa = (ligado) =>
  new Promise((pronto, falhou) => {
    const corpo = JSON.stringify({ semLink: ligado });
    const alvo = new URL(${JSON.stringify(zapsign)} + '/__semlink');
    const pedido = http.request(
      { hostname: alvo.hostname, port: alvo.port, path: alvo.pathname, method: 'POST', agent: false, headers: { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(corpo), Connection: 'close' } },
      (resposta) => { resposta.resume(); resposta.on('end', pronto); },
    );
    pedido.on('error', falhou);
    pedido.end(corpo);
  });

inserir('workspaces', { id: 'w1', nome: 'Correia Advogados' });
inserir('usuarios', { id: 'u1', nome: 'Administrador' });
inserir('membros', { id: 'm1', workspaceId: 'w1', usuarioId: 'u1', papel: 'admin', ativo: true });
inserir('conexoes', { id: 'cx-sim', workspaceId: 'w1', tipo: 'simulador', nome: 'Chat de teste' });
inserir('status', { id: 'st-ass', workspaceId: 'w1', nome: 'Assinatura pendente', tipo: 'proposta' });
inserir('integracoes', {
  id: 'int1',
  workspaceId: 'w1',
  zapsign: {
    chave: ${JSON.stringify(process.env.CORREIA_ZAPSIGN_CHAVE || 'zs-de-mentira')},
    ativo: true,
    envioDireto: true,
    modeloPadraoId: ${JSON.stringify(primeiro.token)},
    /* Lista vazia faria montarValores cair nos CAMPOS_PADRAO (nascimento,
       estado civil, profissao, endereco) e o pedido pararia na coleta, antes
       de falar com a ZapSign — que e justamente o que esta suite quer exercer.
       Entao o modelo declara so o que a conversa de teste ja tem. */
    modelos: [{ id: ${JSON.stringify(primeiro.token)}, nome: 'Contrato', variaveis: ['{{NOME COMPLETO}}', '{{CPF}}'], extras: [] }],
  },
});
const agente = { id: 'ag-1', workspaceId: 'w1', nome: 'Debora (Contrato)', ativo: true, prompt: 'Feche com @gerarcontrato.' };
inserir('agentes', agente);

let n = 0;
const novaConversa = (id) =>
  inserir('contatos', {
    id,
    workspaceId: 'w1',
    conexaoId: 'cx-sim',
    telefone: '5581934440' + String(++n).padStart(3, '0'),
    nome: 'Cliente ' + id,
    estado: 'ia',
    responsavel: { tipo: 'agente', id: 'ag-1', nome: agente.nome },
    variaveis: { nome_completo: 'Cliente Exemplo da Silva', cpf: '12345678909', email: 'cliente@exemplo.com' },
    etiquetas: [],
  });

const textosDe = (id) => mensagensDe(id).filter((m) => m.direcao === 'saida').map((m) => m.conteudo || '');

/* --- 1. A ZapSign devolve 200 SEM o endereco de assinatura ------------ */
await semLinkNaFalsa(true);
novaConversa('c1');
const semLink = await pedirContrato({ contato: achar('contatos', 'c1'), agente, dados: {} });
const contratoSemLink = listar('contratos', { contatoId: 'c1' })[0] || null;
const saidasSemLink = textosDe('c1');
const avisosSemLink = listar('notificacoes').map((x) => x.titulo);

/* --- 2. Com o endereco, tudo segue como antes ------------------------- */
await semLinkNaFalsa(false);
novaConversa('c2');
const comLink = await pedirContrato({ contato: achar('contatos', 'c2'), agente, dados: {} });
const contratoComLink = listar('contratos', { contatoId: 'c2' })[0] || null;
const saidasComLink = textosDe('c2');

console.log(JSON.stringify({
  semLink,
  contratoSemLink: contratoSemLink && { situacao: contratoSemLink.situacao, link: contratoSemLink.link ?? null, erro: contratoSemLink.erro || null },
  saidasSemLink,
  avisosSemLink,
  comLink,
  contratoComLink: contratoComLink && { situacao: contratoComLink.situacao, link: contratoComLink.link ?? null },
  saidasComLink,
}));
await encerrarBanco();
/*
 * Sem process.exit aqui, de proposito.
 *
 * Este e o unico escritorio de teste que chega a FALAR com a ZapSign, e o
 * fetch deixa a conexao viva por alguns segundos. Com process.exit no meio
 * disso, o Windows estoura uma assercao do libuv e o processo sai com codigo
 * de erro — o teste reprovava pela saida, e nao pelo que afirma. Deixar o laco
 * de eventos esvaziar sozinho custa poucos segundos e sai limpo.
 */
`,
  );

  try {
    const r = await new Promise((resolve) => {
      const p = spawn(process.execPath, [script], {
        env: { ...process.env, CORREIA_DADOS: pasta, CORREIA_ZAPSIGN_URL: zapsign },
        stdio: ['ignore', 'pipe', 'pipe'],
      });
      let texto = '';
      p.stdout.on('data', (d) => (texto += d));
      p.stderr.on('data', (d) => (texto += d));
      p.on('close', (codigo) => resolve({ codigo, texto }));
    });
    if (!s.ok('o escritorio de teste roda sem erro', r.codigo === 0, r.texto.slice(-800))) return s;
    const b = JSON.parse(r.texto.trim().split('\n').pop());

    /* --- O que NUNCA pode chegar ao cliente ---------------------------- */
    const juntas = (b.saidasSemLink || []).join('\n');
    s.ok(
      'o cliente NAO recebe uma mensagem com "null" no lugar do link',
      !/\bnull\b/.test(juntas),
      juntas.slice(0, 300),
    );
    s.ok(
      'nem recebe a mensagem de "pronto para assinar" sem ter o que assinar',
      !/pronto(s)? para assinar/i.test(juntas),
      juntas.slice(0, 300),
    );

    /* --- O contrato nao pode se declarar enviado ----------------------- */
    s.ok(
      'o contrato NAO fica marcado como link enviado',
      b.contratoSemLink?.situacao !== 'link_enviado',
      JSON.stringify(b.contratoSemLink),
    );
    s.ok(
      'e guarda o motivo, para a tela do contrato poder mostrar',
      /endereço de assinatura|endereco de assinatura/i.test(b.contratoSemLink?.erro || ''),
      String(b.contratoSemLink?.erro || '(sem erro guardado)'),
    );

    /* --- O agente nao pode ser mandado calar --------------------------- */
    s.ok(
      'o agente NAO e instruido a parar de falar do link',
      !/Não repita o link|Nao repita o link/i.test(b.semLink?.instrucao || ''),
      String(b.semLink?.instrucao || ''),
    );
    s.ok(
      'ele e instruido a nao prometer o link ao cliente',
      /confere|conferência|conferencia/i.test(b.semLink?.instrucao || ''),
      String(b.semLink?.instrucao || ''),
    );

    /* --- A equipe fica sabendo ----------------------------------------- */
    s.ok(
      'a equipe e avisada de que o contrato precisa de conferencia',
      (b.avisosSemLink || []).some((t) => /contrato/i.test(t)),
      JSON.stringify(b.avisosSemLink),
    );

    /* --- E com link, nada mudou ---------------------------------------- */
    s.ok('com o endereco de assinatura, o contrato e enviado', b.contratoComLink?.situacao === 'link_enviado', JSON.stringify(b.contratoComLink));
    s.ok('o link de verdade vai na mensagem', (b.saidasComLink || []).join('\n').includes(b.contratoComLink?.link || '###'), (b.saidasComLink || []).join('\n').slice(0, 200));
    s.ok('e o agente e avisado de que ja foi enviado', /já foi enviado|ja foi enviado/i.test(b.comLink?.instrucao || ''), String(b.comLink?.instrucao || ''));
  } finally {
    await semLinkNaFalsa(false).catch(() => {});
    fs.rmSync(pasta, { recursive: true, force: true });
  }
  return s;
}
