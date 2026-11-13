import { spawn } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

import { suite } from './apoio.js';
import { comExcecaoDaRecepcao } from '../nucleo/recepcao-nao-repete.js';

/**
 * O agente para de cumprimentar depois da recepcao automatica.
 *
 * Pedido do escritorio em 13/11/2026, pela SEGUNDA vez: "tem alguns agentes que
 * esta enviando ola, duas mensagens de bem-vindo duas vezes".
 *
 * A primeira correcao tratou dois TEMPLATES de recepcao na mesma conversa e
 * ficou de pe (ver testes/boas-vindas-automaticas.js). O que sobrou e outro
 * caminho: a recepcao automatica cumprimenta, e o agente cumprimenta de novo
 * com o PROPRIO texto, porque o roteiro dele manda se apresentar "SEMPRE".
 *
 * Sao duas travas, e esta suite cobre as duas pontas do que da para afirmar
 * sem chamar o modelo:
 *
 *  - a MIGRACAO poe a excecao no roteiro ja gravado no banco. Agente instalado
 *    guarda o proprio roteiro, entao corrigir o pacote nao alcanca quem ja
 *    esta no ar;
 *  - o CONTEXTO de ia/motor.js manda a mesma coisa a todo agente, inclusive
 *    aos que o escritorio escreveu. Esse e afirmado em testes/ia.js, onde o
 *    prompt de verdade e montado.
 *
 * O que nenhum teste daqui afirma: que o MODELO vai obedecer. Isso depende da
 * Anthropic e so se ve na conversa de verdade. O que da para travar e que a
 * instrucao esta la, inteira, e que ela nao entra duas vezes.
 */

const ROTEIRO_DA_TRIAGEM = `ABERTURA

Toda conversa nova começa com você se apresentando: Olá! Sou a Eduarda, da equipe do escritório [nome do escritório]. Isso acontece SEMPRE, mesmo quando o assunto já veio na própria primeira mensagem do lead — você nunca pula a apresentação.

Depois de se apresentar, seu único trabalho é identificar o assunto e passar para quem atende.`;

const ROTEIRO_DO_SUPORTE = `Assim que a conversa começar, mova para o @departamento "Suporte". Use @dataehora e cumprimente de acordo com o horário (bom dia, boa tarde ou boa noite), diga que é um prazer receber o contato e pergunte o que o cliente deseja. Exemplo: Olá! Seja bem-vindo(a) ao nosso escritório. Faço parte da equipe do Correia Advogados Associados. Como posso ajudá-lo(a) hoje?

Depois disso, siga o atendimento.`;

export function testarRecepcaoNaoRepete() {
  const s = suite('O agente nao cumprimenta duas vezes');

  /* --- A excecao entra onde o roteiro manda cumprimentar sempre ------- */
  const triagem = comExcecaoDaRecepcao(ROTEIRO_DA_TRIAGEM);
  s.ok('o roteiro da Triagem ganha a excecao', triagem !== ROTEIRO_DA_TRIAGEM && /EXCEÇÃO ÚNICA/.test(triagem), triagem.slice(-160));
  s.ok(
    'ela diz para nao se apresentar nem cumprimentar de novo',
    /NÃO se apresente/.test(triagem) && /NÃO cumprimente de novo/.test(triagem),
    triagem.slice(-200),
  );
  /*
   * A excecao tem que vir DEPOIS da frase do "SEMPRE", e nao no fim do
   * arquivo: lida na ordem, ela corrige a regra que acabou de ser dada. Jogada
   * no rodape, ficaria a paginas de distancia da instrucao que contradiz.
   */
  s.ok(
    'e vem logo depois da frase que manda cumprimentar sempre',
    triagem.indexOf('EXCEÇÃO ÚNICA') === triagem.indexOf('você nunca pula a apresentação.') + 'você nunca pula a apresentação.'.length + 2,
    String(triagem.indexOf('EXCEÇÃO ÚNICA')),
  );
  s.ok(
    'o resto do roteiro continua inteiro',
    triagem.includes('seu único trabalho é identificar o assunto e passar para quem atende'),
    'o texto depois da abertura sumiu',
  );

  const suporte = comExcecaoDaRecepcao(ROTEIRO_DO_SUPORTE);
  s.ok('o roteiro do Suporte tambem ganha', suporte !== ROTEIRO_DO_SUPORTE && /EXCEÇÃO ÚNICA/.test(suporte), suporte.slice(-160));

  /* --- Idempotente: rodar de novo nao escreve duas -------------------- */
  const deNovo = comExcecaoDaRecepcao(triagem);
  s.ok('rodar de novo nao acrescenta a excecao outra vez', deNovo === triagem, 'a excecao entrou duas vezes');
  s.ok('e o texto tem uma excecao so', (triagem.match(/EXCEÇÃO ÚNICA/g) || []).length === 1, String((triagem.match(/EXCEÇÃO ÚNICA/g) || []).length));

  /*
   * --- Roteiro da equipe nao e tocado ---------------------------------
   *
   * Esta e a assercao que protege o escritorio de mim. Mexer no roteiro de um
   * agente e mexer no que ele fala com o cliente; so vale a pena fazer isso
   * sozinho nas frases que o PROPRIO sistema escreveu e que eu sei exatamente
   * onde comecam e terminam. Texto que a equipe escreveu fica como esta, e
   * quem segura a repeticao nele e a instrucao de contexto do motor, que vale
   * para todo agente sem precisar reescrever nada.
   */
  const daEquipe = 'Voce e a Alice. Fale bonito, se apresente com simpatia e ajude o cliente no que ele precisar.';
  s.ok('roteiro escrito pela equipe nao e tocado', comExcecaoDaRecepcao(daEquipe) === daEquipe, comExcecaoDaRecepcao(daEquipe));

  const vazio = 'Sem abertura nenhuma aqui.';
  s.ok('roteiro sem abertura tambem nao e tocado', comExcecaoDaRecepcao(vazio) === vazio, comExcecaoDaRecepcao(vazio));
  s.ok('e prompt vazio ou ausente nao quebra', comExcecaoDaRecepcao('') === '' && comExcecaoDaRecepcao(null) === null && comExcecaoDaRecepcao(undefined) === undefined);

  return s;
}

/**
 * A instrucao que chega a TODO agente, pelo contexto do sistema.
 *
 * A migracao acima so alcanca o roteiro que o sistema escreveu. Esta e a trava
 * que vale sempre: o motor monta o contexto a cada resposta, e e ali que o
 * modelo fica sabendo que o cliente ja foi cumprimentado — inclusive nos
 * agentes que o escritorio escreveu do zero.
 *
 * Processo proprio com banco descartavel porque montarSistema le o escritorio
 * do banco (dados da empresa, status, etiquetas).
 */
export async function testarContextoDaRecepcao({ raiz }) {
  const s = suite('O contexto avisa o agente que a recepcao ja saiu');
  const url = (arquivo) => JSON.stringify(pathToFileURL(path.join(raiz, arquivo)).href);
  const pasta = fs.mkdtempSync(path.join(os.tmpdir(), 'recepcao-contexto-'));
  const script = path.join(pasta, 'contexto.mjs');

  fs.writeFileSync(
    script,
    `import { iniciarBanco, inserir, encerrarBanco } from ${url('servidor/nucleo/banco.js')};
import { montarSistema } from ${url('servidor/ia/motor.js')};
iniciarBanco();

const workspace = inserir('workspaces', { id: 'w1', nome: 'Correia' });
inserir('status', { id: 'st1', workspaceId: 'w1', nome: 'NOVO lead', tipo: 'nova' });
const agente = { id: 'ag1', workspaceId: 'w1', nome: 'Eduarda', prompt: 'Voce e a Eduarda. Toda conversa comeca com voce se apresentando.' };

const base = { id: 'c1', workspaceId: 'w1', nome: 'Cliente', telefone: '5581999990000', statusId: 'st1' };
const semRecepcao = montarSistema({ agente, contato: base, workspace });
const comRecepcao = montarSistema({ agente, contato: { ...base, boasVindasEnviadasEm: '2026-11-13T10:00:00.000Z' }, workspace });

console.log(JSON.stringify({ semRecepcao, comRecepcao }));
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

    s.ok(
      'sem a recepcao enviada, o contexto nao fala nada disso',
      !/RECEPÇÃO do escritório JÁ FOI ENVIADA/.test(b.semRecepcao),
      'falou da recepcao numa conversa que nao teve',
    );
    s.ok(
      'com a recepcao enviada, o contexto avisa',
      /RECEPÇÃO do escritório JÁ FOI ENVIADA/.test(b.comRecepcao),
      b.comRecepcao.slice(-300),
    );
    /*
     * A instrucao velha dizia so "nao envie o template de boas-vindas de novo".
     * O modelo obedecia e escrevia o proprio "Ola! Sou a Eduarda" — a segunda
     * saudacao nao era template nenhum. Por isso as tres assercoes abaixo:
     * cumprimento, apresentacao e template, cada um barrado por escrito.
     */
    s.ok('e manda NAO cumprimentar', /não cumprimente/i.test(b.comRecepcao), 'falta barrar o cumprimento');
    s.ok('NAO se apresentar', /não se apresente/i.test(b.comRecepcao), 'falta barrar a apresentacao');
    s.ok('e NAO mandar outro template de recepcao', /template de recepção/i.test(b.comRecepcao), 'falta barrar o template');
    /*
     * A instrucao DISPUTA com o roteiro, que manda se apresentar "SEMPRE".
     * Sem dizer qual das duas vale, o modelo segue a mais enfatica — e a mais
     * enfatica era a errada.
     */
    s.ok(
      'e diz, com todas as letras, que vale acima do roteiro',
      /vale ACIMA do seu roteiro/.test(b.comRecepcao),
      'sem isso o roteiro que manda cumprimentar SEMPRE ganha',
    );
  } finally {
    fs.rmSync(pasta, { recursive: true, force: true });
  }
  return s;
}
