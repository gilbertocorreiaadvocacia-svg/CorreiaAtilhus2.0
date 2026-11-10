import { spawn } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

import { PACOTES } from '../ia/pacotes.js';
import { DESQUALIFICAR_NAO_E_ENCERRAR } from '../ia/pacotes/comum.js';
import { suite } from './apoio.js';

/**
 * Desqualificar nao e encerrar (pedido do escritorio em 10/11/2026).
 *
 * "O agente trabalhista atende normalmente e, em um determinado momento, coloca
 * em Desqualificado e simplesmente para de atender." A causa nao era o status —
 * era a ordem de desligar a IA escrita na MESMA frase do roteiro. O status
 * sozinho nunca calou ninguem: as guardas do motor olham o RESPONSAVEL.
 *
 * O que nao pode falhar:
 *  - nenhum roteiro de pacote manda desligar a IA ao desqualificar;
 *  - a desqualificacao CONTINUA existindo (nao "resolvemos" apagando ela);
 *  - a linha que concede a ferramenta para passagem a humano fica intacta;
 *  - nos agentes JA instalados a ordem sai sem levar o resto do roteiro junto,
 *    uma vez por agente, e quem apagar a trava na tela nao a ve voltar;
 *  - desligando a IA de verdade, alguem do escritorio fica sabendo.
 */

/* A linha manda desligar a IA? A explicativa da passagem cita a mencao de
   proposito (e ela que concede a ferramenta) e nao conta. */
const mandaCalar = (linha) => /@desativarIA/i.test(linha) && !/PASSAGEM PARA PESSOA/i.test(linha);
const linhasQueMandamCalar = (prompt) => String(prompt || '').split('\n').filter(mandaCalar);
const agentesDoPacote = (area) => PACOTES[area].agentes;
const contar = (prompt, trecho) => String(prompt || '').split(trecho).length - 1;

/* ------------------------------------------------------------------ */
/* 1. Os roteiros de fabrica                                           */
/* ------------------------------------------------------------------ */

export async function testarDesqualificarSemSilenciar() {
  const s = suite('Desqualificar nao manda a IA parar de atender');
  const todos = Object.keys(PACOTES).flatMap((area) => agentesDoPacote(area).map((a) => ({ area, agente: a })));

  const mandam = todos.filter(({ agente }) => linhasQueMandamCalar(agente.prompt).length);
  s.ok(
    'nenhum agente de pacote manda desligar a IA no roteiro',
    mandam.length === 0,
    JSON.stringify(mandam.map(({ area, agente }) => `${area}/${agente.nome}: ${linhasQueMandamCalar(agente.prompt)[0]}`).slice(0, 3)),
  );

  const pareados = todos.filter(({ agente }) =>
    String(agente.prompt).split('\n').some((l) => /Desqualificado/.test(l) && /@desativarIA/i.test(l)),
  );
  s.ok(
    'e nenhuma linha pareia desqualificar com desligar, que era o defeito relatado',
    pareados.length === 0,
    JSON.stringify(pareados.map(({ agente }) => agente.nome)),
  );

  /* Contraprova: a desqualificacao tinha de continuar existindo. Se alguem
     "resolver" o problema apagando as desqualificacoes, isto reprova. */
  const comDesqualificacao = todos.filter(({ agente }) => /@status para "Desqualificado"/.test(agente.prompt));
  s.ok(
    'a desqualificacao continua no roteiro: o status ainda e marcado',
    comDesqualificacao.length >= 8,
    `${comDesqualificacao.length} agente(s) ainda marcam Desqualificado`,
  );

  /* A trava so faz falta em quem PODE se calar: a ferramenta vem da linha da
     passagem para pessoa. Quem desqualifica sem ter essa linha (os agentes
     civeis) nao consegue desligar nada, e nao precisa dela. */
  const podeCalarESeDesqualifica = ({ agente }) =>
    /PASSAGEM PARA PESSOA/i.test(agente.prompt) && /@status para "Desqualificado"/.test(agente.prompt);
  const semATrava = todos.filter((x) => podeCalarESeDesqualifica(x) && !x.agente.prompt.includes(DESQUALIFICAR_NAO_E_ENCERRAR));
  s.ok(
    'todo agente que desqualifica E tem a ferramenta na mao recebe a trava de continuar atendendo',
    semATrava.length === 0,
    JSON.stringify(semATrava.map(({ area, agente }) => `${area}/${agente.nome}`)),
  );

  s.ok(
    'a trava nao cita a mencao que desliga a IA (cita-la devolveria a ferramenta)',
    !/@desativarIA/i.test(DESQUALIFICAR_NAO_E_ENCERRAR),
    DESQUALIFICAR_NAO_E_ENCERRAR.slice(0, 60),
  );

  /* Nem todo agente tem a linha da passagem (pos-venda, avaliacao e os civeis
     nao tem, e por isso nem recebem a ferramenta). O que precisa continuar
     valendo e que quem a tem nao a perdeu nesta mudanca. */
  const comPassagem = todos.filter(({ agente }) => /PASSAGEM PARA PESSOA/i.test(agente.prompt));
  s.ok(
    'a linha da passagem para pessoa continua la, concedendo a ferramenta para o caso legitimo',
    comPassagem.length >= 19 && comPassagem.every(({ agente }) => /@desativarIA/i.test(agente.prompt)),
    `${comPassagem.length} agente(s) com a linha da passagem`,
  );

  /* O caso da conversa orfa: @responsavel e a ordem de desligar na mesma
     resposta desfaziam a passagem (as ferramentas rodam em sequencia). */
  const rescisao = agentesDoPacote('trabalhista').find((a) => /rescis/i.test(a.nome));
  const linhaDaPassagem = String(rescisao?.prompt || '')
    .split('\n')
    .find((l) => /Respondeu n[ãa]o para todas/i.test(l));
  s.ok(
    'a passagem da rescisao indireta nao desliga a IA depois de passar (conversa ficava orfa)',
    Boolean(linhaDaPassagem) && /@responsavel/.test(linhaDaPassagem) && !/@desativarIA/i.test(linhaDaPassagem),
    String(linhaDaPassagem).slice(0, 120),
  );

  return s;
}

/* ------------------------------------------------------------------ */
/* 2. A migracao nos agentes ja instalados                             */
/* ------------------------------------------------------------------ */

export async function testarMigrarDesqualificacao({ raiz }) {
  const s = suite('A ordem de desligar sai dos agentes ja instalados');
  const url = (arquivo) => JSON.stringify(pathToFileURL(path.join(raiz, arquivo)).href);
  const pasta = fs.mkdtempSync(path.join(os.tmpdir(), 'desqualificar-'));
  const script = path.join(pasta, 'desqualificar.mjs');

  fs.writeFileSync(
    script,
    `import { iniciarBanco, achar, atualizar, inserir, encerrarBanco } from ${url('servidor/nucleo/banco.js')};
import { desqualificarSemCalar, desqualificacaoNosAgentes } from ${url('servidor/nucleo/desqualificar-sem-calar.js')};
import { ferramentasDoAgente } from ${url('servidor/ia/mencoes.js')};
import { TRABALHISTA } from ${url('servidor/ia/pacotes/trabalhista.js')};
import { DESQUALIFICAR_NAO_E_ENCERRAR, PASSAGEM } from ${url('servidor/ia/pacotes/comum.js')};
iniciarBanco();

/* O prompt de fabrica de hoje, com a ordem REINSERIDA: e assim que o agente
   instalado em producao esta. Reconstruir a partir do pacote (em vez de uma
   copia literal) mantem o teste valido quando o roteiro mudar. */
const doPacote = TRABALHISTA[0].prompt;
const comAOrdem = doPacote
  .split('\\n')
  .map((l) => (/@status para "Desqualificado"/.test(l) ? l.replace(/\\.$/, '') + ' e use @desativarIA.' : l))
  .join('\\n')
  .replace('\\n\\n' + DESQUALIFICAR_NAO_E_ENCERRAR, '');

inserir('workspaces', { id: 'w1', nome: 'Correia Advogados' });
inserir('agentes', { id: 'intocado', workspaceId: 'w1', nome: 'Triagem Trabalhista', prompt: comAOrdem });
inserir('agentes', { id: 'editado', workspaceId: 'w1', nome: 'Editado pela equipe', prompt: comAOrdem + '\\n\\nLinha escrita pela equipe, nao mexer.\\n\\naltere o @status para "Desqualificado", use @desativarIA e encerre.' });
inserir('agentes', { id: 'invertido', workspaceId: 'w1', nome: 'Beatriz (Triagem)', prompt: 'JÁ TEM ADVOGADO: altere o @status para "Desqualificado", adicione a @tag "Tem advogado" e use @desativarIA.\\n\\n' + PASSAGEM });
inserir('agentes', { id: 'orfa', workspaceId: 'w1', nome: 'Rescisão Indireta', prompt: 'Respondeu não para todas: passe com @responsavel para "Gilberto Correia Da Silva Filho" e use @desativarIA.\\n\\n' + PASSAGEM });
inserir('agentes', { id: 'maiusculo', workspaceId: 'w1', nome: 'Maiusculo', prompt: 'altere o @status para "Desqualificado" e use @DesativarIA.' });
inserir('agentes', { id: 'so-passagem', workspaceId: 'w1', nome: 'So passagem', prompt: PASSAGEM });
inserir('agentes', { id: 'sem-nada', workspaceId: 'w1', nome: 'Sem nada', prompt: 'Analise a qualidade de segurado.' });
inserir('agentes', { id: 'windows', workspaceId: 'w1', nome: 'Windows', prompt: 'Primeira linha.\\r\\naltere o @status para "Desqualificado" e use @desativarIA.\\r\\nUltima linha.' });

const antes = desqualificacaoNosAgentes('w1');
const mudados = desqualificarSemCalar();
const prompt = (id) => achar('agentes', id).prompt;
const temFerramenta = (id) => ferramentasDoAgente(achar('agentes', id), 'w1').some((f) => f.nome === 'desativar_ia');

/* Roda de novo: nada muda (idempotente). */
const deNovo = desqualificarSemCalar();
/* Equipe apaga a trava na tela: nao volta no reinicio seguinte. */
atualizar('agentes', 'intocado', { prompt: prompt('intocado').replace('\\n\\n' + DESQUALIFICAR_NAO_E_ENCERRAR, '') });
const depoisDeApagar = desqualificarSemCalar();

console.log(JSON.stringify({
  antes,
  mudados,
  deNovo,
  depoisDeApagar,
  travaVoltou: prompt('intocado').includes(DESQUALIFICAR_NAO_E_ENCERRAR),
  depois: desqualificacaoNosAgentes('w1'),
  /* Tirando a trava dos dois lados, o roteiro migrado tem de ser identico ao
     do pacote: e a prova de que a remocao foi cirurgica. A trava fica em
     posicoes diferentes (no pacote, dentro das REGRAS; na migracao, logo
     depois da linha da passagem), entao ela sai da comparacao. */
  semATravaIgualAoPacote:
    prompt('editado').split(DESQUALIFICAR_NAO_E_ENCERRAR).join('').replace(/\\n{3,}/g, '\\n\\n').startsWith(
      doPacote.split(DESQUALIFICAR_NAO_E_ENCERRAR).join('').replace(/\\n{3,}/g, '\\n\\n'),
    ),
  linhaDaEquipe: prompt('editado').includes('Linha escrita pela equipe, nao mexer.'),
  reescritaDaEquipe: prompt('editado').split('\\n').at(-1),
  invertido: prompt('invertido').split('\\n')[0],
  orfa: prompt('orfa').split('\\n')[0],
  maiusculo: prompt('maiusculo').split('\\n')[0],
  maiusculoSemOrdem: !/@desativarIA/i.test(prompt('maiusculo')),
  soPassagem: prompt('so-passagem') === PASSAGEM,
  semNada: prompt('sem-nada') === 'Analise a qualidade de segurado.',
  semNadaTemTrava: prompt('sem-nada').includes(DESQUALIFICAR_NAO_E_ENCERRAR),
  windows: prompt('windows'),
  travaUmaVezSo: prompt('editado').split(DESQUALIFICAR_NAO_E_ENCERRAR).length - 1,
  ferramentaNoMaiusculo: temFerramenta('maiusculo'),
  ferramentaNoSoPassagem: temFerramenta('so-passagem'),
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
    if (!s.ok('o escritorio de teste roda sem erro', r.codigo === 0, r.texto.slice(-900))) return s;
    const b = JSON.parse(r.texto.trim().split('\n').pop());

    s.ok('antes da migracao, os agentes com a ordem aparecem no relatorio', b.antes.length === 6, JSON.stringify(b.antes.map((a) => a.agente)));
    s.ok('a migracao muda so quem tinha a ordem', b.mudados === 6, String(b.mudados));
    s.ok('e depois nenhum agente manda mais desligar a IA', b.depois.length === 0, JSON.stringify(b.depois));

    s.ok('o resto do roteiro fica igual ao do pacote, palavra por palavra', b.semATravaIgualAoPacote, 'o roteiro migrado deixou de bater com o do pacote');
    s.ok('a linha escrita pela equipe nao e tocada', b.linhaDaEquipe);
    s.ok(
      'a reescrita da equipe perde so a ordem, nao a frase',
      b.reescritaDaEquipe === 'altere o @status para "Desqualificado" e encerre.',
      b.reescritaDaEquipe,
    );
    s.ok(
      'a ordem invertida do auxilio-acidente tambem sai, sem deixar virgula solta',
      b.invertido === 'JÁ TEM ADVOGADO: altere o @status para "Desqualificado", adicione a @tag "Tem advogado".',
      b.invertido,
    );
    s.ok(
      'a passagem para pessoa deixa de ser desfeita: a conversa nao fica mais orfa',
      b.orfa === 'Respondeu não para todas: passe com @responsavel para "Gilberto Correia Da Silva Filho".',
      b.orfa,
    );
    s.ok(
      'a mencao em maiuscula tambem e achada',
      b.maiusculo === 'altere o @status para "Desqualificado".' && b.maiusculoSemOrdem,
      JSON.stringify({ linha: b.maiusculo, semOrdem: b.maiusculoSemOrdem }),
    );
    s.ok('a quebra de linha do Windows e preservada', b.windows.includes('\r\n') && !/@desativarIA/i.test(b.windows), JSON.stringify(b.windows));

    s.ok('a linha que concede a ferramenta para passagem a humano fica intacta', b.soPassagem);
    s.ok('quem nunca teve a ordem fica exatamente como estava', b.semNada && !b.semNadaTemTrava);
    s.ok('a trava entra uma vez so', b.travaUmaVezSo === 1, String(b.travaUmaVezSo));

    s.ok('a ferramenta some de quem so a tinha pela ordem', b.ferramentaNoMaiusculo === false);
    s.ok('e continua em quem tem a passagem para pessoa, que e o uso legitimo', b.ferramentaNoSoPassagem === true);

    s.ok('rodar de novo nao muda nada', b.deNovo === 0, String(b.deNovo));
    s.ok('e quem apagou a trava na tela nao a ve voltar no reinicio seguinte', b.depoisDeApagar === 0 && b.travaVoltou === false, JSON.stringify({ d: b.depoisDeApagar, voltou: b.travaVoltou }));
  } finally {
    fs.rmSync(pasta, { recursive: true, force: true });
  }
  return s;
}

/* ------------------------------------------------------------------ */
/* 3. Desligando a IA de verdade, alguem fica sabendo                  */
/* ------------------------------------------------------------------ */

export async function testarAvisoAoDesligarIa({ raiz }) {
  const s = suite('Desligar a IA numa conversa avisa o escritorio');
  const url = (arquivo) => JSON.stringify(pathToFileURL(path.join(raiz, arquivo)).href);
  const pasta = fs.mkdtempSync(path.join(os.tmpdir(), 'aviso-desativar-'));
  const script = path.join(pasta, 'aviso.mjs');

  fs.writeFileSync(
    script,
    `import { iniciarBanco, achar, inserir, listar, encerrarBanco } from ${url('servidor/nucleo/banco.js')};
import { executarFerramenta } from ${url('servidor/ia/mencoes.js')};
iniciarBanco();

inserir('workspaces', { id: 'w1', nome: 'Correia Advogados' });
inserir('conexoes', { id: 'cx1', workspaceId: 'w1', tipo: 'simulador', nome: 'Sim' });
for (const [id, papel] of [['dono', 'owner'], ['adm', 'admin'], ['atende', 'atendente']]) {
  inserir('usuarios', { id: 'u-' + id, nome: id });
  inserir('membros', { id: 'm-' + id, workspaceId: 'w1', usuarioId: 'u-' + id, papel, nome: id });
}
inserir('agentes', { id: 'ag1', workspaceId: 'w1', nome: 'Triagem Trabalhista', ativo: true, prompt: 'roteiro' });
inserir('contatos', { id: 'c1', workspaceId: 'w1', conexaoId: 'cx1', telefone: '5581900000001', nome: 'Maria Exemplo', estado: 'ia', responsavel: { tipo: 'agente', id: 'ag1', nome: 'Triagem Trabalhista' } });

const r = await executarFerramenta({
  nome: 'desativar_ia',
  argumentos: { motivo: 'lead ja tem advogado' },
  contato: achar('contatos', 'c1'),
  agente: achar('agentes', 'ag1'),
  conexao: achar('conexoes', 'cx1'),
  workspaceId: 'w1',
});

const avisos = listar('notificacoes', { workspaceId: 'w1' });
const contato = achar('contatos', 'c1');
console.log(JSON.stringify({
  ok: r.ok === true,
  paraDeResponder: r.pare_de_responder === true,
  quantos: avisos.length,
  papeis: avisos.map((a) => achar('membros', a.membroId)?.papel).sort(),
  tipo: avisos[0]?.tipo,
  contatoId: avisos[0]?.contatoId,
  lida: avisos[0]?.lida,
  texto: avisos[0]?.texto,
  responsavel: contato.responsavel,
  estado: contato.estado,
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
    if (!s.ok('o escritorio de teste roda sem erro', r.codigo === 0, r.texto.slice(-900))) return s;
    const b = JSON.parse(r.texto.trim().split('\n').pop());

    s.ok('a ferramenta continua respondendo o mesmo de antes', b.ok && b.paraDeResponder);
    s.ok('o dono e o administrador sao avisados, e o atendente nao', b.quantos === 2 && JSON.stringify(b.papeis) === JSON.stringify(['admin', 'owner']), JSON.stringify(b.papeis));
    s.ok('o aviso aponta a conversa e chega nao lido', b.tipo === 'ia' && b.contatoId === 'c1' && b.lida === false, JSON.stringify({ t: b.tipo, c: b.contatoId, l: b.lida }));
    s.ok('e diz quem desligou e por que', /Triagem Trabalhista/.test(b.texto) && /lead ja tem advogado/.test(b.texto), b.texto);
    s.ok('a conversa continua caindo em Pendentes, sem responsavel (nada mudou nisso)', b.responsavel === null && b.estado === 'pendente', JSON.stringify({ r: b.responsavel, e: b.estado }));
  } finally {
    fs.rmSync(pasta, { recursive: true, force: true });
  }
  return s;
}
