import { spawn } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

import { cliente, suite } from './apoio.js';

/**
 * Ranking por qualidade do caso fechado (nucleo/ranking.js).
 *
 * Pedido do escritorio em 13/11/2026: "quem fecha mais contratos, com
 * pontuacao, uma especie de dashboard por qualidade do contrato fechado". Sao
 * duas qualidades, nas palavras dele: o fechado "com a documentacao completa e
 * com as informacoes do caso completo", e o fechado "com as documentacoes
 * basicas".
 *
 * O QUE NAO PODE FALHAR:
 *
 *  - CONTA CASO FECHADO, E NAO CONTRATO DA ZAPSIGN. E a assercao mais
 *    importante do arquivo, e ela vem de um erro que ja custou uma entrega
 *    nesta semana: a MAIORIA dos casos que chegam a coluna "Contrato fechado"
 *    deste escritorio nunca passou pela ZapSign (sao fechados na mao ou vieram
 *    do historico antigo). Um ranking presa ao contrato assinado mostraria
 *    quase ninguem, e as pessoas seriam julgadas por um numero que nao e o
 *    trabalho delas;
 *  - caso SEM DONO nao pontua para ninguem. Dar o ponto "ao mais provavel"
 *    seria premiar quem nao fez, e ninguem conferiria;
 *  - a REGUA e do escritorio. O sistema nasce com um palpite e DIZ que e um
 *    palpite (reguaConferida), porque um ranking que julga gente por regua que
 *    ninguem conferiu nao pode parecer oficial;
 *  - quem nao enxerga a conversa nao a ve no ranking. Ranking e informacao de
 *    gestao, mas nao e uma porta lateral para a fila de quem nao tem acesso.
 */
export async function testarRanking({ raiz }) {
  const s = suite('Ranking por qualidade do caso fechado');
  const url = (arquivo) => JSON.stringify(pathToFileURL(path.join(raiz, arquivo)).href);
  const pasta = fs.mkdtempSync(path.join(os.tmpdir(), 'ranking-'));
  const script = path.join(pasta, 'ranking.mjs');

  fs.writeFileSync(
    script,
    `import { iniciarBanco, inserir, encerrarBanco } from ${url('servidor/nucleo/banco.js')};
import { configDoRanking, salvarConfigDoRanking, qualidadeDoCaso, ranking } from ${url('servidor/nucleo/ranking.js')};
iniciarBanco();

inserir('workspaces', { id: 'w1', nome: 'Correia' });
inserir('usuarios', { id: 'u1', nome: 'Dani' });
inserir('usuarios', { id: 'u2', nome: 'Milena' });
inserir('membros', { id: 'm1', workspaceId: 'w1', usuarioId: 'u1', papel: 'atendente', departamentos: ['dep1'] });
inserir('membros', { id: 'm2', workspaceId: 'w1', usuarioId: 'u2', papel: 'atendente', departamentos: ['dep2'] });
inserir('status', { id: 'st-nova', workspaceId: 'w1', nome: 'Nova', tipo: 'nova' });
inserir('status', { id: 'st-ok', workspaceId: 'w1', nome: 'Contrato fechado', tipo: 'sucesso' });
inserir('etiquetas', { id: 'et-aux', workspaceId: 'w1', nome: 'Auxilio-acidente', tipo: 'caso', caso: 'auxilio_acidente' });
inserir('etiquetas', { id: 'et-urg', workspaceId: 'w1', nome: 'Urgente' });
inserir('agentes', { id: 'ag1', workspaceId: 'w1', nome: 'Rafaela' });

const CONFIG = configDoRanking('w1');
/* A regua sugerida para auxilio-acidente: laudo + cnis, e cpf + endereco +
   data_acidente. Os casos abaixo sao montados contra ela. */

let n = 0;
/* Uma conversa fechada: entra na coluna de sucesso por um log de funil, que e
   como o sistema registra a passagem de verdade. */
function fechada({ quem, em, etiquetas = ['et-aux'], arquivos = [], variaveis = {}, departamentoId = 'dep1' }) {
  const id = 'c' + (n += 1);
  inserir('contatos', { id, workspaceId: 'w1', nome: 'Cliente ' + id, etiquetas, arquivos, variaveis, departamentoId });
  inserir('logs', {
    workspaceId: 'w1',
    contatoId: id,
    tipo: 'status',
    descricao: 'Status: Contrato fechado',
    criadoEm: em,
    autor: quem,
    dados: { statusId: 'st-ok', anteriorId: 'st-nova' },
  });
  return id;
}

const DANI = { tipo: 'membro', id: 'm1', nome: 'Dani' };
const MILENA = { tipo: 'membro', id: 'm2', nome: 'Milena' };
/* Documentos pelo NOME do arquivo: "laudo-pericial-2026.pdf" vale "laudo" e
   "CNIS_Joao.pdf" vale "cnis", com maiuscula e tudo. */
const COMPLETO = {
  arquivos: [{ id: 'a1', nome: 'laudo-pericial-2026.pdf' }, { id: 'a2', nome: 'CNIS_Joao.pdf' }],
  variaveis: { cpf: '111', endereco: 'Rua A', data_acidente: '2026-02-01' },
};

/* Dani: dois completos e um basico, nenhum com contrato da ZapSign. */
fechada({ quem: DANI, em: '2026-11-03T10:00:00.000Z', ...COMPLETO });
fechada({ quem: DANI, em: '2026-11-04T10:00:00.000Z', ...COMPLETO });
fechada({ quem: DANI, em: '2026-11-05T10:00:00.000Z', arquivos: [{ id: 'a3', nome: 'rg.jpg' }], variaveis: { cpf: '222' } });
/* Milena: um completo. */
fechada({ quem: MILENA, em: '2026-11-06T10:00:00.000Z', departamentoId: 'dep2', ...COMPLETO });
/* Sem autor no log: fechado, mas sem dono. */
fechada({ quem: null, em: '2026-11-07T10:00:00.000Z', ...COMPLETO });
/* Sem tipo de caso: nao da para exigir nada, entao conta como basico. */
fechada({ quem: MILENA, em: '2026-11-08T10:00:00.000Z', etiquetas: ['et-urg'], departamentoId: 'dep2', ...COMPLETO });
/* Fora do periodo: mesmo fechamento, mes passado. */
fechada({ quem: DANI, em: '2026-10-02T10:00:00.000Z', ...COMPLETO });
/* Aberta: nunca passou pela coluna de sucesso. */
inserir('contatos', { id: 'aberta', workspaceId: 'w1', nome: 'Em andamento', etiquetas: ['et-aux'], departamentoId: 'dep1' });

const ADMIN = { workspaceId: 'w1', papel: 'owner', membro: { id: 'mOwner' } };
const periodo = { de: '2026-11-01', ate: '2026-11-30' };
const semZapsign = ranking(ADMIN, periodo);

/* --- Agora com contrato: quem APROVOU vence quem moveu a coluna ------ */
const comContrato = fechada({ quem: MILENA, em: '2026-11-09T10:00:00.000Z', ...COMPLETO });
inserir('contratos', {
  id: 'ct1',
  workspaceId: 'w1',
  contatoId: comContrato,
  situacao: 'assinado',
  assinadoEm: '2026-11-09T12:00:00.000Z',
  aprovadoPor: { id: 'm1', nome: 'Dani' },
  agenteId: 'ag1',
});
const comZapsign = ranking(ADMIN, periodo);

/* --- A regua do escritorio -------------------------------------------- */
const antesDeConferir = comZapsign.reguaConferida;
const salva = salvarConfigDoRanking('w1', {
  /* O escritorio diz que auxilio-acidente nao exige nada: lista VAZIA e uma
     escolha, e nao "use a sugestao". */
  exigencias: { auxilio_acidente: { documentos: [], dados: [] }, inventado: { documentos: ['x'] } },
  pontos: { completo: 10, basico: 2 },
});
const comReguaDoEscritorio = ranking(ADMIN, periodo);
const basicoVirouCompleto = qualidadeDoCaso({ id: 'x', etiquetas: ['et-aux'], arquivos: [], variaveis: {} }, configDoRanking('w1'));

/* --- Quem so enxerga o proprio departamento --------------------------- */
const daDani = ranking({ workspaceId: 'w1', papel: 'atendente', membro: { id: 'm1', departamentos: ['dep1'] } }, periodo);

console.log(JSON.stringify({
  semZapsign,
  comZapsign,
  antesDeConferir,
  salva: { pontos: salva.pontos, aux: salva.exigencias.auxilio_acidente, bpcIntacto: salva.exigencias.bpc, chaves: Object.keys(salva.exigencias) },
  comReguaDoEscritorio,
  basicoVirouCompleto,
  daDani,
  sugestao: { aux: CONFIG.exigencias.auxilio_acidente, pontos: CONFIG.pontos },
}));
await encerrarBanco();
process.exit(0);
`,
  );

  try {
    const r = await new Promise((resolve) => {
      const p = spawn(process.execPath, [script], { env: { ...process.env, CORREIA_DADOS: pasta }, stdio: ['ignore', 'pipe', 'pipe'] });
      let texto = '';
      p.stdout.on('data', (d) => (texto += d));
      p.stderr.on('data', (d) => (texto += d));
      p.on('close', (codigo) => resolve({ codigo, texto }));
    });
    if (!s.ok('o escritorio de teste roda sem erro', r.codigo === 0, r.texto.slice(-700))) return s;
    const b = JSON.parse(r.texto.trim().split('\n').pop());

    /* --- Conta caso fechado, e nao contrato assinado -------------------- */
    const dani = b.semZapsign.pessoas.find((p) => p.nome === 'Dani');
    s.ok(
      'conta o caso fechado SEM contrato da ZapSign — e a maioria dos casos deste escritorio',
      dani?.fechados === 3,
      JSON.stringify(b.semZapsign.pessoas),
    );
    s.ok(
      'e diz quantos vieram sem ZapSign, para o numero nao passar por outra coisa',
      b.semZapsign.totais.semZapsign === b.semZapsign.totais.fechados,
      JSON.stringify(b.semZapsign.totais),
    );

    /* --- Completo x basico ---------------------------------------------- */
    s.ok('separa o completo do basico', dani?.completos === 2 && dani?.basicos === 1, JSON.stringify(dani));
    s.ok(
      'o documento conta por um pedaco do NOME do arquivo (laudo-pericial-2026.pdf vale "laudo", CNIS_Joao.pdf vale "cnis")',
      dani?.completos === 2,
      JSON.stringify(dani),
    );
    s.ok('e pontua 3 pelo completo e 1 pelo basico', dani?.pontos === 2 * 3 + 1, String(dani?.pontos));

    /* --- Sem tipo de caso ------------------------------------------------ */
    s.ok(
      'caso fechado sem tipo de caso conta como basico e aparece separado',
      b.semZapsign.totais.semTipoDeCaso === 1,
      JSON.stringify(b.semZapsign.totais),
    );

    /* --- Sem dono -------------------------------------------------------- */
    const somaDasPessoas = b.semZapsign.pessoas.reduce((a, p) => a + p.fechados, 0);
    s.ok(
      'caso sem registro de quem fechou nao pontua para ninguem',
      b.semZapsign.totais.semAtribuicao === 1 && somaDasPessoas === b.semZapsign.totais.fechados - 1,
      JSON.stringify({ semAtribuicao: b.semZapsign.totais.semAtribuicao, somaDasPessoas, fechados: b.semZapsign.totais.fechados }),
    );

    /* --- Periodo ---------------------------------------------------------- */
    s.ok('o fechamento do mes passado fica de fora do recorte', b.semZapsign.totais.fechados === 6, JSON.stringify(b.semZapsign.totais));
    s.ok('e conversa que nunca chegou na coluna de sucesso nao entra', !JSON.stringify(b.semZapsign).includes('aberta'));

    /* --- Ordem ------------------------------------------------------------ */
    s.ok(
      'quem tem mais pontos vem na frente, com a posicao preenchida',
      b.semZapsign.pessoas[0]?.nome === 'Dani' && b.semZapsign.pessoas[0]?.posicao === 1,
      JSON.stringify(b.semZapsign.pessoas.map((p) => `${p.posicao} ${p.nome} ${p.pontos}`)),
    );

    /* --- O que mais faltou -------------------------------------------------- */
    const faltou = b.semZapsign.faltas.map((f) => `${f.tipo}:${f.nome}`);
    s.ok(
      'a tela mostra o que mais faltou, documento e dado separados',
      faltou.includes('documento:laudo') && faltou.includes('dado:endereco'),
      JSON.stringify(b.semZapsign.faltas),
    );

    /* --- Quem aprovou o contrato vence quem moveu a coluna ------------------ */
    const daniComContrato = b.comZapsign.pessoas.find((p) => p.nome === 'Dani');
    const milenaComContrato = b.comZapsign.pessoas.find((p) => p.nome === 'Milena');
    s.ok(
      'com contrato assinado, o ponto vai para quem APROVOU, e nao para quem moveu a coluna',
      daniComContrato?.fechados === 4 && milenaComContrato?.fechados === 2,
      JSON.stringify({ dani: daniComContrato?.fechados, milena: milenaComContrato?.fechados }),
    );
    s.ok(
      'e o agente que conduziu aparece na lista dele, sem disputar com a equipe',
      b.comZapsign.agentes.some((a) => a.nome === 'Rafaela' && a.fechados === 1),
      JSON.stringify(b.comZapsign.agentes),
    );

    /* --- A regua e do escritorio --------------------------------------------- */
    s.ok('o sistema nasce com um palpite e avisa que e um palpite', b.antesDeConferir === false, String(b.antesDeConferir));
    s.ok(
      'a sugestao de auxilio-acidente e laudo + cnis, com cpf, endereco e data do acidente',
      JSON.stringify(b.sugestao.aux.documentos) === JSON.stringify(['laudo', 'cnis']) && b.sugestao.aux.dados.includes('data_acidente'),
      JSON.stringify(b.sugestao.aux),
    );
    s.ok('e o palpite de pontos e 3 e 1', b.sugestao.pontos.completo === 3 && b.sugestao.pontos.basico === 1, JSON.stringify(b.sugestao.pontos));
    s.ok('depois de salvar, o aviso some', b.comReguaDoEscritorio.reguaConferida === true, String(b.comReguaDoEscritorio.reguaConferida));
    s.ok('os pontos escolhidos pelo escritorio valem', b.salva.pontos.completo === 10 && b.salva.pontos.basico === 2, JSON.stringify(b.salva.pontos));
    s.ok(
      'lista VAZIA gravada e uma escolha ("este caso nao exige nada"), e nao volta para a sugestao',
      b.salva.aux.documentos.length === 0 && b.salva.aux.dados.length === 0 && b.basicoVirouCompleto.completo === true,
      JSON.stringify({ aux: b.salva.aux, qualidade: b.basicoVirouCompleto }),
    );
    s.ok(
      'mexer num tipo de caso nao mexe nos outros, que seguem na sugestao',
      b.salva.bpcIntacto.conferida === false && b.salva.bpcIntacto.documentos.includes('cadunico'),
      JSON.stringify(b.salva.bpcIntacto),
    );
    s.ok(
      'tipo de caso inventado e ignorado, em vez de entrar no banco',
      !b.salva.chaves.includes('inventado'),
      JSON.stringify(b.salva.chaves),
    );
    const daniNova = b.comReguaDoEscritorio.pessoas.find((p) => p.nome === 'Dani');
    s.ok(
      'com a regua nova todos os casos dela viram completos e a pontuacao acompanha',
      daniNova?.completos === 4 && daniNova?.pontos === 40,
      JSON.stringify(daniNova),
    );

    /* --- Visibilidade --------------------------------------------------------- */
    s.ok(
      'quem so enxerga o proprio departamento ve o ranking da propria fatia',
      b.daDani.pessoas.length === 1 && b.daDani.pessoas[0]?.nome === 'Dani',
      JSON.stringify(b.daDani.pessoas),
    );
    s.ok(
      'e os totais dela tambem sao os da fatia, e nao os do escritorio',
      b.daDani.totais.fechados < b.comReguaDoEscritorio.totais.fechados,
      JSON.stringify({ dela: b.daDani.totais.fechados, todos: b.comReguaDoEscritorio.totais.fechados }),
    );
  } finally {
    fs.rmSync(pasta, { recursive: true, force: true });
  }
  return s;
}

/**
 * As rotas do ranking.
 *
 * O numero quem calcula e o nucleo, travado acima. Aqui so o que e da rota, e
 * o que e da rota e PERMISSAO: a regua decide a pontuacao de cada pessoa, e
 * quem e pontuado nao pode mudar a propria regua.
 */
export async function testarRotasDoRanking({ base }) {
  const s = suite('Rotas do ranking');
  const api = cliente(base);
  await api.entrar();

  const lista = await api.get('/api/ranking?de=2026-11-01&ate=2026-11-30');
  s.ok('a rota do ranking responde', lista.status === 200, String(lista.status));
  s.ok(
    'e devolve as duas listas, os totais e os pontos',
    Array.isArray(lista.dados?.pessoas) &&
      Array.isArray(lista.dados?.agentes) &&
      typeof lista.dados?.totais?.fechados === 'number' &&
      lista.dados?.pontos?.completo > 0,
    JSON.stringify(Object.keys(lista.dados || {})),
  );
  s.ok('o recorte pedido volta na resposta, para a tela nao mentir o periodo', lista.dados?.periodo?.de === '2026-11-01', JSON.stringify(lista.dados?.periodo));

  const regua = await api.get('/api/ranking/exigencias');
  s.ok('o administrador le a regua', regua.status === 200 && Boolean(regua.dados?.exigencias?.bpc), String(regua.status));

  const salvou = await api.put('/api/ranking/exigencias', {
    exigencias: { bpc: { documentos: ['rg', 'cadunico'], dados: ['cpf'] } },
    pontos: { completo: 5, basico: 2 },
  });
  s.ok('e salva', salvou.status === 200 && salvou.dados?.pontos?.completo === 5, JSON.stringify(salvou.dados?.pontos));
  s.ok(
    'a lista salva volta do jeito que foi escrita',
    JSON.stringify(salvou.dados?.exigencias?.bpc?.documentos) === JSON.stringify(['rg', 'cadunico']),
    JSON.stringify(salvou.dados?.exigencias?.bpc),
  );

  const depois = await api.get('/api/ranking?de=2026-11-01&ate=2026-11-30');
  s.ok('e o ranking passa a usar os pontos novos', depois.dados?.pontos?.completo === 5, JSON.stringify(depois.dados?.pontos));
  s.ok('e para de avisar que a regua e um palpite', depois.dados?.reguaConferida === true, String(depois.dados?.reguaConferida));

  /* --- Quem e pontuado nao mexe na propria regua -------------------------- */
  const criado = await api.post('/api/membros', {
    nome: 'Vendedor do Ranking',
    email: 'vendedor.ranking@correia.adv.br',
    senha: 'ranking2026',
    papel: 'atendente',
  });
  if (!s.ok('o atendente de teste foi criado', Boolean(criado.dados?.id), JSON.stringify(criado.dados))) return s;

  const dele = cliente(base);
  const entrou = await dele.entrar('vendedor.ranking@correia.adv.br', 'ranking2026');
  if (!s.ok('o atendente consegue entrar', entrou.status === 200, String(entrou.status))) return s;

  s.ok('o atendente ve o ranking', (await dele.get('/api/ranking')).status === 200);
  const leu = await dele.get('/api/ranking/exigencias');
  s.ok('mas nao LE a regua que o pontua', leu.status === 403, String(leu.status));
  const tentou = await dele.put('/api/ranking/exigencias', { pontos: { completo: 999, basico: 999 } });
  s.ok('nem a muda', tentou.status === 403, String(tentou.status));
  s.ok(
    'e a tentativa nao deixou rastro na pontuacao',
    (await api.get('/api/ranking')).dados?.pontos?.completo === 5,
    JSON.stringify((await api.get('/api/ranking')).dados?.pontos),
  );

  return s;
}
