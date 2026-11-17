import { spawn } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

import { cliente, suite } from './apoio.js';
import { arrumarCaixa, nomeDoCliente } from '../ia/nome-do-cliente.js';

/**
 * O cliente diz o nome, e o contato passa a ter esse nome.
 *
 * Pedido do escritorio em 17/11/2026: "ao cliente dizer o seu nome, quando o
 * agente for perguntar, ele automaticamente muda o nome do contato para o
 * nome fornecido".
 *
 * O que estava quebrado nao era a gravacao -- a ferramenta `salvar_nome`
 * existe desde o comeco. Eram as duas pontas dela:
 *
 *  1. ela so era OFERECIDA ao agente cujo roteiro escrevia "@salvarnome".
 *     Cinco pacotes pedem o nome ao cliente e so quatro escreviam: o agente
 *     do BPC perguntava o nome e nao tinha onde guardar;
 *  2. nenhuma instrucao mandava salva-lo quando ele simplesmente APARECE. As
 *     que citavam a ferramenta falavam de outra coisa: corrigir nome que
 *     estivesse "estranho (apelido, emoji, numero)".
 *
 * Esta suite afirma as duas pontas e a trava do meio. A trava do meio e a que
 * mais importa aqui: com a ferramenta na mao de todo agente, o que chega para
 * gravar nao e mais o que o cliente digitou -- e o que o MODELO entendeu como
 * nome. Gravar "Bom Dia" como nome de cliente nao da erro em lugar nenhum: o
 * agente passa a chamar a pessoa assim na mensagem seguinte, e o cartao do
 * Kanban perde a unica coisa pela qual a equipe acha a conversa.
 */

export function testarFiltroDeNome() {
  const s = suite('O nome que o cliente diz: o que entra e o que nao entra');

  /* --- O que PRECISA entrar ------------------------------------------- */
  /*
   * A frase inteira e o caso mais comum, e nao a excecao: perguntado o nome,
   * a pessoa responde "meu nome e Maria", e o modelo repassa a resposta como
   * recebeu. Recusar isso seria recusar o pedido do escritorio.
   */
  const aceitos = [
    ['joao', 'Joao'],
    ['maria da silva', 'Maria da Silva'],
    ['MARIA DAS GRAÇAS DE SOUZA', 'Maria das Graças de Souza'],
    ['Ana Lúcia', 'Ana Lúcia'],
    ['meu nome é Maria da Silva', 'Maria da Silva'],
    ['Meu nome completo é Jose Carlos de Lima', 'Jose Carlos de Lima'],
    ['me chamo Pedro Henrique', 'Pedro Henrique'],
    ['eu sou o Carlos', 'Carlos'],
    ['Olá, meu nome é João', 'João'],
    ['Oi, bom dia, me chamo Ana', 'Ana'],
    ['tudo bem? sou o Rafael Nunes', 'Rafael Nunes'],
    ['nome: Fernanda', 'Fernanda'],
    ['pode me chamar de Bia', 'Bia'],
    ['José M Silva', 'José M Silva'],
    ['Maria,', 'Maria'],
  ];
  for (const [dito, esperado] of aceitos) {
    const r = nomeDoCliente(dito);
    s.ok(`"${dito}" vira ${esperado}`, r.ok && r.nome === esperado, JSON.stringify(r));
  }
  /*
   * Nome completo brasileiro e comprido, e e justamente na etapa da ficha que
   * o escritorio pede o nome COMPLETO para gerar o contrato. Um limite de
   * palavras apertado recusaria o nome mais importante de todos.
   */
  const completo = nomeDoCliente('Maria Aparecida dos Santos Souza Oliveira Lima Pereira');
  s.ok('nome completo de verdade, com oito palavras, nao e tratado como frase', completo.ok, JSON.stringify(completo));

  /* --- E o que NAO pode entrar ---------------------------------------- */
  const recusados = [
    'oi', 'Olá', 'bom dia', 'Boa tarde!', 'tudo bem',
    'sim', 'não', 'ok', 'obrigado', 'teste',
    /* "AD1" e o caso real: a primeira mensagem de um anuncio, gravada como nome. */
    'AD1', '5581999990000', '12345',
    'joao@gmail.com', 'https://site.com',
    'queria saber se voces atendem causa trabalhista',
    'pode me ajudar com meu processo',
    'Oi tudo bem? Meu nome é João e queria saber se vocês atendem causa trabalhista',
    'J', '', '   ', '👍',
  ];
  for (const lixo of recusados) {
    const r = nomeDoCliente(lixo);
    s.ok(`"${lixo}" nao vira nome de cliente`, r.ok === false && Boolean(r.motivo), JSON.stringify(r));
  }
  s.ok('e nem argumento ausente ou de outro tipo', [null, undefined, 42, {}].every((v) => nomeDoCliente(v).ok === false));

  /*
   * O motivo volta escrito para o agente ler. Sem ele, o modelo recebe uma
   * recusa muda e tenta de novo com o mesmo texto, gastando chamada do
   * escritorio em looping.
   */
  s.ok(
    'a recusa diz por que, para o agente nao tentar de novo igual',
    /saudação|frase|número|nome/i.test(nomeDoCliente('bom dia').motivo || ''),
    nomeDoCliente('bom dia').motivo || '',
  );

  /* --- A caixa do nome ------------------------------------------------ */
  s.ok('tudo maiusculo vira nome escrito como nome', arrumarCaixa('JOSE DA SILVA') === 'Jose da Silva', arrumarCaixa('JOSE DA SILVA'));
  s.ok('e tudo minusculo tambem', arrumarCaixa('ana paula dos santos') === 'Ana Paula dos Santos', arrumarCaixa('ana paula dos santos'));
  /*
   * Nome que ja chegou com maiuscula no meio foi escrito por alguem que sabia
   * o que queria. Mexer ali estragaria mais do que arrumaria.
   */
  s.ok('nome ja escrito direito nao e mexido', arrumarCaixa('Ana Lúcia McDonald') === 'Ana Lúcia McDonald', arrumarCaixa('Ana Lúcia McDonald'));
  s.ok('particula na frente continua sendo o nome', arrumarCaixa('da silva') === 'Da Silva', arrumarCaixa('da silva'));

  return s;
}

/**
 * O caminho inteiro, com a Anthropic de mentira: o cliente responde o nome, o
 * agente chama a ferramenta, e o cartao da conversa muda de nome.
 *
 * Roda em processo a parte para ter banco proprio: a afirmacao e sobre o nome
 * de UM contato, e as outras suites deixam conversa viva no banco do servidor
 * compartilhado.
 */
export async function testarNomeGravadoDePontaAPonta({ anthropic, raiz }) {
  const s = suite('O cliente diz o nome e o contato passa a ter esse nome');
  const MARCA = 'MARCA-DA-SUITE-DE-NOME-DO-CLIENTE';
  const falsa = cliente(anthropic);
  const url = (arquivo) => JSON.stringify(pathToFileURL(path.join(raiz, arquivo)).href);
  const pasta = fs.mkdtempSync(path.join(os.tmpdir(), 'nome-do-cliente-'));
  const script = path.join(pasta, 'nome.mjs');

  fs.writeFileSync(
    script,
    `import { iniciarBanco, achar, inserir, inserirMensagem, logsDe, encerrarBanco } from ${url('servidor/nucleo/banco.js')};
import { executarAgente, montarSistema } from ${url('servidor/ia/motor.js')};
import { ferramentasDoAgente } from ${url('servidor/ia/mencoes.js')};
iniciarBanco();
inserir('workspaces', { id: 'w1', nome: 'Teste' });
inserir('integracoes', { id: 'int1', workspaceId: 'w1', ia: { chaveAnthropic: 'sk-ant-de-mentira' } });
inserir('conexoes', { id: 'conx-sim', workspaceId: 'w1', tipo: 'simulador' });
/* O roteiro PEDE o nome e NAO cita @salvarnome: e o agente do BPC. */
inserir('agentes', { id: 'ag', workspaceId: 'w1', nome: 'Andreia', ativo: true, delaySegundos: 0, modelo: 'claude-sonnet-5',
  prompt: '${MARCA}. Você é a Andreia, do escritório. Pergunte o nome do cliente e siga o atendimento.' });
const agente = achar('agentes', 'ag');
/* O nome do WhatsApp e apelido: e esse o cartao que a equipe ve hoje. */
inserir('contatos', { id: 'c1', workspaceId: 'w1', conexaoId: 'conx-sim', telefone: '5581930000001', nome: 'Zap Do Trampo', estado: 'ia',
  responsavel: { tipo: 'agente', id: 'ag', nome: 'Andreia' }, etiquetas: [] });
inserirMensagem('c1', { direcao: 'saida', tipo: 'texto', conteudo: 'Olá! Como você se chama?', autor: { tipo: 'agente', id: 'ag' }, situacao: 'enviada' });
inserirMensagem('c1', { direcao: 'entrada', tipo: 'texto', conteudo: 'meu nome é josé carlos de lima', autor: { tipo: 'cliente' }, situacao: 'recebida' });
const ofertadas = ferramentasDoAgente(agente, 'w1').map((f) => f.nome);
await executarAgente('c1');
const sistema = montarSistema({ agente, contato: achar('contatos', 'c1'), workspace: achar('workspaces', 'w1') });
console.log(JSON.stringify({
  nome: achar('contatos', 'c1').nome,
  logs: logsDe('c1').map((l) => l.descricao),
  ofertadas,
  roteiroPedia: /salvarnome/i.test(agente.prompt),
  regraNoSistema: /salvar_nome/.test(sistema),
  regraFalaDeQuemEscreve: /pessoa com quem você está falando/i.test(sistema),
}));
await encerrarBanco();
process.exit(0);
`,
  );

  try {
    /*
     * O modelo manda a frase inteira, como manda de verdade. O teste nao
     * entrega o nome limpo de bandeja: se entregasse, provaria so que
     * atribuicao de campo funciona.
     */
    await falsa.post('/__roteiro', {
      roteiro: [
        {
          status: 200,
          texto: 'Prazer, José Carlos! Me conta o que aconteceu?',
          chamadas: [{ nome: 'salvar_nome', argumentos: { nome: 'meu nome é josé carlos de lima' } }],
        },
      ],
      marca: MARCA,
    });
    const r = await new Promise((resolve) => {
      const p = spawn(process.execPath, [script], {
        env: { ...process.env, CORREIA_DADOS: pasta, CORREIA_ANTHROPIC_URL: anthropic, CORREIA_IA_TEMPO_LIMITE: '10000' },
        stdio: ['ignore', 'pipe', 'pipe'],
      });
      let texto = '';
      p.stdout.on('data', (d) => (texto += d));
      p.stderr.on('data', (d) => (texto += d));
      p.on('close', (codigo) => resolve({ codigo, texto }));
    });
    /*
     * O que vale e a LINHA DE RESULTADO, e nao o codigo de saida.
     *
     * No Windows este processo filho as vezes aborta no fechamento
     * ("Assertion failed: !(handle->flags & UV_HANDLE_CLOSING)", libuv), DEPOIS
     * de fazer o trabalho e imprimir o resultado. Reprovar por isso seria
     * reprovar o atendimento por causa do jeito que o processo de teste
     * morreu, num sistema que roda em Linux. Entao: nao saindo a linha, o
     * teste reprova e mostra a saida inteira; saindo, e ela que decide.
     */
    const linha = r.texto.trim().split('\n').reverse().find((l) => l.trim().startsWith('{'));
    if (!s.ok('o escritorio de teste roda e devolve resultado', Boolean(linha), `codigo ${r.codigo}\n${r.texto.slice(-700)}`)) return s;
    const b = JSON.parse(linha);

    /*
     * A ponta 1: o roteiro deste agente nao tem a palavra "salvarnome" em
     * lugar nenhum -- e o caso do agente de BPC do escritorio, e de todo
     * roteiro que a equipe escrever a mao. A ferramenta chega assim mesmo.
     */
    s.ok('o roteiro do agente nao pedia a ferramenta', b.roteiroPedia === false, JSON.stringify(b.roteiroPedia));
    s.ok('e ela chega a ele de todo jeito', (b.ofertadas || []).includes('salvar_nome'), JSON.stringify(b.ofertadas));
    /*
     * As outras continuam dependendo do roteiro, e isso e proposital: sem
     * @status escrito, o agente nao mexe em status de conversa de cliente.
     * Soltar tudo de uma vez seria outra mudanca, que ninguem pediu.
     */
    s.ok(
      'o resto das ferramentas continua preso ao roteiro',
      !(b.ofertadas || []).includes('mudar_status') && !(b.ofertadas || []).includes('gerar_contrato'),
      JSON.stringify(b.ofertadas),
    );

    s.ok('o contato passa a se chamar pelo nome que o cliente disse', b.nome === 'José Carlos de Lima', JSON.stringify(b.nome));
    /*
     * O nome ANTERIOR fica registrado. Trocar o nome muda a unica coisa pela
     * qual a equipe acha a conversa: sem o de antes, quem procurar pelo nome
     * velho nao tem onde ler o que aconteceu.
     */
    s.ok(
      'e o historico diz de que nome para que nome',
      (b.logs || []).some((d) => /de Zap Do Trampo para José Carlos de Lima/.test(d || '')),
      JSON.stringify(b.logs),
    );
    /*
     * A regra mora no texto de sistema, montado a cada chamada, e nao no
     * roteiro gravado no banco. E o que faz a correcao valer para os agentes
     * que JA estao no ar, sem depender de migracao casar com o texto deles.
     */
    s.ok('a regra chega ao agente pelo texto de sistema, nao pelo roteiro', b.regraNoSistema === true, JSON.stringify(b.regraNoSistema));
    /*
     * No BPC e no salario-maternidade o roteiro manda perguntar o nome do
     * BENEFICIARIO quando quem escreve e parente. O WhatsApp e de quem
     * digita: gravar o nome do beneficiario trocaria o dono da conversa.
     */
    s.ok('e a regra diz que o cadastro e de quem esta escrevendo', b.regraFalaDeQuemEscreve === true, JSON.stringify(b.regraFalaDeQuemEscreve));
  } finally {
    fs.rmSync(pasta, { recursive: true, force: true });
  }
  return s;
}
