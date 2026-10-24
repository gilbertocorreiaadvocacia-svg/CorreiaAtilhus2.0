import { spawn } from 'node:child_process';
import fs from 'node:fs';
import net from 'node:net';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { SEGREDO_2FA_TESTE, esperarNoAr, suite } from './apoio.js';
import { subirEvolucaoFalsa } from './evolution-falsa.js';
import { subirAnthropicFalsa } from './anthropic-falsa.js';
import { testarQrCode } from './conexoes-qrcode.js';
import { testarOrigens } from './origens.js';
import { testarSimuladorEOficial } from './conexoes-regressao.js';
import { testarPortaOcupada } from './porta-ocupada.js';
import { testarConversas } from './conversas.js';
import { testarAgentes } from './agentes.js';
import { testarChatDeTeste } from './chat-teste.js';
import { testarRede } from './rede.js';
import { testarIa } from './ia.js';
import { testarHistorico } from './historico.js';
import { testarCasos } from './casos.js';
import { testarEncadeamento } from './encadeamento.js';
import { testarDocumentosRecebidos } from './documentos-recebidos.js';
import { testarCreditosMes } from './creditos-mes.js';
import { testarEduardaRoteamento } from './eduarda-roteamento.js';
import { testarBateriaDeRoteamento } from './bateria-de-roteamento.js';
import { testarCustoPorAgente } from './custo-por-agente.js';
import { testarEvolucaoDeCustoPorAgente } from './evolucao-custo-agente.js';
import { testarTempoResposta } from './tempo-resposta.js';
import { testarPromptAoVivo } from './prompt-ao-vivo.js';
import { testarPacotes } from './pacotes.js';
import { subirZapsignFalsa } from './zapsign-falsa.js';
import { testarContratos } from './contratos.js';
import { testarRelatorios } from './relatorios.js';
import { testarCopiarWorkspace } from './copiar-workspace.js';
import { testarPapeis } from './papeis.js';
import { testarConexoesWorkspace } from './conexoes-workspace.js';
import { subirJuriFalso } from './juri-falso.js';
import { testarJuri } from './juri.js';
import { testarWorkspacesPorArea } from './workspaces.js';
import { testarRoteamentoPorArea } from './roteamento-por-area.js';
import { testarHospedagem } from './hospedagem.js';
import { testarSobreviver } from './sobreviver.js';
import { testarAvaliacao } from './avaliacao.js';
import { subirRedesFalsas } from './redes-falsas.js';
import { testarRedes } from './redes.js';
import { subirLiderhubFalsa } from './liderhub-falsa.js';
import { testarLiderhub } from './liderhub.js';
import { testarDiagnostico } from './diagnostico.js';
import { testarEventosDeConexao } from './eventos-conexao.js';
import { testarNotificacoes } from './notificacoes.js';
import { testarExcluirConexaoComConversas } from './excluir-conexao-com-conversas.js';
import { testarApagarConversasDaConexao } from './apagar-conversas-da-conexao.js';
import { testarExcluirEmMassa } from './excluir-em-massa.js';
import { testarStatusEmMassa } from './status-em-massa.js';
import { testarKanbanConcluido } from './kanban-concluido.js';
import { testarExcluirTodosOsContatos } from './excluir-todos-contatos.js';
import { testarHigiene } from './higiene.js';
import { testarBaseEStatus } from './base-e-status.js';
import { testarAtivarAgentesSemEquipe } from './ativar-agentes-sem-equipe.js';
import { testarPosVenda } from './posvenda.js';
import { testarMigrarDepartamentoPosVenda } from './migrar-posvenda.js';
import { testarReatribuirPendentes } from './reatribuir-pendentes.js';
import { testarRetomarRespostasPendentes } from './retomar-respostas-pendentes.js';
import { testarPalavraChaveRevisita } from './palavra-chave-revisita.js';
import { testarLigarNumerosDasAreasNaVarredura } from './ligar-numeros-das-areas-sweep.js';
import { testarAgentesDasAreas } from './agentes-das-areas.js';
import { testarStatusDasAreas } from './status-das-areas.js';
import { testarSituacaoExterna } from './situacao-externa.js';
import { testarFollowup } from './followup.js';
import { testarRegrasAntiAlucinacao } from './regras-anti-alucinacao.js';
import { testarAplicarRegrasInstitucionais, testarRegrasInstitucionais } from './regras-institucionais.js';
import { testarGatilhoAutomaticoDeHistorico, testarLiderhubHistorico } from './liderhub-historico.js';
import { testarMigrarSemIdentificacao } from './sem-identificacao.js';
import { testarDeduplicarContatos } from './duplicados.js';
import { testarVoz } from './voz.js';
import { testarTranscricaoDeAudio } from './transcricao-audio.js';
import { testarTranscricaoLocal } from './transcricao-local.js';
import { testarDoisFatores } from './doisfatores.js';
import { testarDeduplicarVozes, testarVozDosAgentes } from './voz-dos-agentes.js';
import { testarReorganizarAgentes } from './reorganizar-agentes.js';
import { subirOpenaiFalsa } from './openai-falsa.js';
import { testarAtalhos } from './atalhos.js';
import { testarFalaEAcao } from './fala-e-acao.js';

/**
 * A suite do CorreiaAtilhus2.0. Rode com `npm test`.
 *
 * Sobe o sistema de verdade e conversa com ele por HTTP, como qualquer
 * integracao faria. Nao ha teste de unidade aqui de proposito: o que quebra
 * neste sistema nao e uma funcao isolada, e a costura entre o webhook, o banco
 * em arquivo e o envio, e teste de unidade nao ve costura.
 *
 * DUAS TRAVAS DE SEGURANCA, e as duas importam:
 *
 * 1. A BASE E DESCARTAVEL. O servidor sobe apontado para uma pasta temporaria,
 *    nunca para `dados/`. Sem isso, rodar a suite na maquina do escritorio
 *    apagaria conversa de cliente para semear conversa de mentira.
 * 2. AS PORTAS SAO SORTEADAS. Nada de 4477 fixo: quem esta com o sistema aberto
 *    na propria maquina precisa conseguir rodar o teste sem fechar nada.
 */

const RAIZ = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const CHAVE_EVOLUCAO = 'chave-de-teste';

/** Uma porta livre de verdade: o sistema pergunta ao proprio sistema. */
function portaLivre() {
  return new Promise((resolve, reject) => {
    const tomada = net.createServer();
    tomada.on('error', reject);
    tomada.listen(0, '127.0.0.1', () => {
      const { port } = tomada.address();
      tomada.close(() => resolve(port));
    });
  });
}

/**
 * `node --check` em todo arquivo .js do projeto.
 *
 * Vale mais do que parece num projeto sem build: erro de sintaxe em um modulo
 * do navegador nao aparece em teste nenhum de servidor, e so quebra na tela de
 * quem abriu o sistema, sem mensagem util.
 */
async function conferirSintaxe() {
  const s = suite('Sintaxe');
  const arquivos = [];
  const ignorar = new Set(['node_modules', '.git', 'dados']);

  (function varrer(pasta) {
    for (const item of fs.readdirSync(pasta, { withFileTypes: true })) {
      if (ignorar.has(item.name)) continue;
      const completo = path.join(pasta, item.name);
      if (item.isDirectory()) varrer(completo);
      else if (item.name.endsWith('.js')) arquivos.push(completo);
    }
  })(RAIZ);

  const falhas = [];
  for (const arquivo of arquivos) {
    const codigo = await new Promise((resolve) => {
      const p = spawn(process.execPath, ['--check', arquivo], { stdio: ['ignore', 'ignore', 'pipe'] });
      let erro = '';
      p.stderr.on('data', (d) => (erro += d));
      p.on('close', (c) => resolve(c === 0 ? null : erro.split('\n').slice(0, 3).join(' ')));
    });
    if (codigo) falhas.push(`${path.relative(RAIZ, arquivo)}: ${codigo}`);
  }

  s.ok(`${arquivos.length} arquivos .js sem erro de sintaxe`, falhas.length === 0, falhas.join('\n'));
  return s;
}

async function principal() {
  const suites = [];
  suites.push(await conferirSintaxe());
  suites.push(await testarRede());

  const pastaDados = fs.mkdtempSync(path.join(os.tmpdir(), 'correiatendimentos-teste-'));
  const portaSistema = await portaLivre();
  const portaEvolucao = await portaLivre();
  const portaAnthropic = await portaLivre();
  const portaZapsign = await portaLivre();
  const base = `http://127.0.0.1:${portaSistema}`;
  const zapsign = `http://127.0.0.1:${portaZapsign}`;
  const portaJuri = await portaLivre();
  const juri = `http://127.0.0.1:${portaJuri}`;
  const portaRedes = await portaLivre();
  const redes = `http://127.0.0.1:${portaRedes}`;
  const portaLiderhub = await portaLivre();
  const liderhub = `http://127.0.0.1:${portaLiderhub}`;
  const evolucao = `http://127.0.0.1:${portaEvolucao}`;
  const anthropic = `http://127.0.0.1:${portaAnthropic}`;

  const envDaEvolution = path.join(pastaDados, 'evolution.env');
  fs.writeFileSync(envDaEvolution, 'SERVER_URL=http://localhost:8080\nAUTHENTICATION_API_KEY=chave-local-de-teste\n');

  const servicoFalso = await subirEvolucaoFalsa(portaEvolucao, CHAVE_EVOLUCAO);
  const anthropicFalsa = await subirAnthropicFalsa(portaAnthropic);
  const portaOpenai = await portaLivre();
  const openai = `http://127.0.0.1:${portaOpenai}`;
  const openaiFalsa = await subirOpenaiFalsa(portaOpenai);
  const zapsignFalsa = await subirZapsignFalsa(portaZapsign, 'zs-de-mentira');
  const juriFalso = await subirJuriFalso(portaJuri, 'segredo-do-juri');
  const redesFalsas = await subirRedesFalsas(portaRedes);
  const liderhubFalsa = await subirLiderhubFalsa(portaLiderhub, 'lh-de-mentira');
  const sistema = spawn(process.execPath, [path.join(RAIZ, 'servidor/index.js')], {
    env: {
      ...process.env,
      PORTA: String(portaSistema),
      CORREIA_DADOS: pastaDados,
      /* So em teste: o admin semeado ja nasce com o segundo fator pareado neste
         segredo, para entrar() (apoio.js) calcular o codigo. Em producao esta
         variavel nunca existe, e o admin pareia o proprio app no primeiro login. */
      CORREIA_2FA_SEMENTE: SEGREDO_2FA_TESTE,
      /* O sistema fala com a Anthropic de mentira, e nao com a de verdade:
         a suite nao pode depender de internet nem gastar chave do escritorio. */
      CORREIA_ANTHROPIC_URL: anthropic,
      /* A OpenAI de mentira: so o audio (voz do agente e transcricao). */
      CORREIA_OPENAI_URL: openai,
      /* O motor de transcricao local fica DESLIGADO na suite, de proposito.
         Ele depende de duas coisas que a maquina pode ou nao ter (ffmpeg com
         filtro whisper e um modelo de 500 MB em modelos/), e teste que muda de
         resultado conforme o que esta instalado nao prova nada. O motor local
         tem suite propria, que se declara pulada quando falta o modelo. */
      CORREIA_TRANSCRICAO_LOCAL: '0',
      /* A ZapSign de mentira, e o acompanhamento em milissegundos: consulta a
         cada 150 ms, com espera de 100 ms entre consultas do mesmo documento. */
      CORREIA_ZAPSIGN_URL: zapsign,
      CORREIA_ZAPSIGN_INTERVALO: '150',
      CORREIA_ZAPSIGN_ESPERAS: '100,100,100',
      /* Instagram e TikTok de mentira, e o endereco publico que eles chamam
         (o login do TikTok volta para ele). */
      CORREIA_INSTAGRAM_URL: `${redes}/ig`,
      CORREIA_TIKTOK_URL: `${redes}/tt`,
      /* A LiderHub de mentira, para o teste de migracao. */
      CORREIA_LIDERHUB_URL: liderhub,
      CORREIA_LIDERHUB_INTERVALO: '10',
      CORREIA_ENDERECO_PUBLICO: base,
      /* A fila do Atilhus Juri, tambem em milissegundos. */
      CORREIA_JURI_INTERVALO: '150',
      CORREIA_JURI_ESPERAS: '100,100,100',
      /* 800ms para o teste de tempo limite caber na vida de alguem. */
      CORREIA_IA_TEMPO_LIMITE: '800',
      /* As rodadas de importacao do celular sao de 1, 5 e 15 minutos; aqui,
         duas rodadas em menos de um segundo. */
      /* Cinco rodadas curtas: da para ver a sincronizacao PARAR sozinha na
         terceira, quando o celular deixa de mandar coisa nova. */
      CORREIA_SINCRONIA_ESPERAS: '150,300,450,600,750',
      /* A fila de fotos anda de 1,5 em 1,5 s no escritorio; aqui, de 30 ms. */
      CORREIA_FOTO_INTERVALO: '30',
      /* A fila de arquivos do historico anda de 3 em 3 s no escritorio; aqui,
         de 30 ms, para o download em segundo plano caber no teste. */
      CORREIA_MIDIA_INTERVALO: '30',
      /* A Evolution desta maquina nao entra no teste: a conexao nova leria a
         chave real de windows/evolution/.env. O teste le um .env proprio,
         com chave de mentira, escrito logo abaixo. */
      CORREIA_EVOLUTION_ENV: envDaEvolution,
      /* Uma chave de ambiente vazando da maquina de quem roda o teste faria a
         suite passar por motivo errado — ou gastar credito de verdade. */
      ANTHROPIC_API_KEY: '',
      OPENAI_API_KEY: '',
    },
    stdio: ['ignore', 'pipe', 'pipe'],
  });

  let saidaDoSistema = '';
  sistema.stdout.on('data', (d) => (saidaDoSistema += d));
  sistema.stderr.on('data', (d) => (saidaDoSistema += d));

  function encerrar() {
    try {
      sistema.kill();
    } catch {
      /* ja morreu */
    }
    servicoFalso.close();
    anthropicFalsa.close();
    openaiFalsa.close();
    zapsignFalsa.close();
    juriFalso.close();
    redesFalsas.close();
    liderhubFalsa.close();
    fs.rmSync(pastaDados, { recursive: true, force: true });
  }

  try {
    const noAr = await esperarNoAr(`${base}/api/saude`);
    if (!noAr) {
      console.error('O sistema nao subiu. Saida do servidor:\n');
      console.error(saidaDoSistema);
      encerrar();
      process.exit(1);
    }

    suites.push(await testarSimuladorEOficial({ base }));
    suites.push(await testarQrCode({ base, evolucao, chaveEvolucao: CHAVE_EVOLUCAO }));
    suites.push(await testarOrigens({ base, evolucao, chaveEvolucao: CHAVE_EVOLUCAO }));
    suites.push(await testarRedes({ base, redes }));
    suites.push(await testarConversas({ base }));
    suites.push(await testarAgentes({ base }));
    suites.push(await testarCasos({ base }));
    suites.push(await testarPacotes({ base }));
    suites.push(await testarContratos({ base, zapsign }));
    suites.push(await testarJuri({ base, zapsign, juri }));
    suites.push(await testarChatDeTeste({ base }));
    suites.push(await testarIa(base, anthropic));
    /* Depois da IA: poe a chave de mentira de volta e tira no fim. */
    suites.push(await testarEncadeamento({ base, anthropic }));
    suites.push(await testarDocumentosRecebidos({ base, anthropic }));
    suites.push(await testarCreditosMes({ base, anthropic }));
    /* Mesmo esquema do encadeamento: roteiro na Anthropic de mentira, chave posta e tirada. */
    suites.push(await testarFalaEAcao({ base, anthropic }));
    /* Idem: prompt editado no meio da conversa, sem reiniciar o servidor. */
    suites.push(await testarPromptAoVivo({ base, anthropic }));
    /* Tambem usa a Anthropic de mentira, e poe e tira a chave. */
    suites.push(await testarAvaliacao({ base, anthropic }));
    suites.push(await testarVoz({ base, anthropic, openai }));
    suites.push(await testarTranscricaoDeAudio({ base, openai }));
    suites.push(await testarTranscricaoLocal());
    suites.push(await testarDoisFatores({ base }));
    /* Cria workspaces novos: depois de quem conta agentes e etiquetas da origem. */
    suites.push(await testarWorkspacesPorArea({ base }));
    /* Depois do workspaces: usa os numeros por QR Code de cada area, ja
       separados por escritorio pelo teste acima. */
    suites.push(await testarRoteamentoPorArea({ base, evolucao, chaveEvolucao: CHAVE_EVOLUCAO }));
    /* Depois: precisa do escritorio Previdenciario ja criado (os agentes
       reais Eduarda e Andreia vem de la), igual as suites abaixo. */
    suites.push(await testarEduardaRoteamento({ base, anthropic }));
    suites.push(await testarBateriaDeRoteamento({ base, anthropic }));
    suites.push(await testarCustoPorAgente({ raiz: RAIZ }));
    suites.push(await testarEvolucaoDeCustoPorAgente({ raiz: RAIZ }));
    suites.push(await testarTempoResposta({ raiz: RAIZ }));
    /* Depois de todas as outras: acrescenta conversas em Ativos, e as suites
       de cima contam fila. */
    suites.push(await testarHistorico({ base, evolucao, chaveEvolucao: CHAVE_EVOLUCAO }));
    /* Depois do historico: a migracao adiciona contatos na base, e as suites de
       cima contam fila. */
    suites.push(await testarLiderhub({ base }));
    /* Por ultimo no servidor compartilhado: cadastra um membro de suporte, e o
       sorteio de responsavel das suites de cima conta quem existe. */
    suites.push(await testarEventosDeConexao({ base, evolucao, chaveEvolucao: CHAVE_EVOLUCAO }));
    suites.push(await testarNotificacoes({ base, evolucao, chaveEvolucao: CHAVE_EVOLUCAO }));
    suites.push(await testarExcluirConexaoComConversas({ base }));
    suites.push(await testarApagarConversasDaConexao({ base }));
    suites.push(await testarExcluirEmMassa({ base }));
    suites.push(await testarStatusEmMassa({ base }));
    suites.push(await testarKanbanConcluido({ base }));
    suites.push(await testarExcluirTodosOsContatos({ base }));
    suites.push(await testarHigiene({ base }));
    suites.push(await testarAtalhos({ base }));
    suites.push(await testarDiagnostico({ base, anthropic }));
    /* Por ultimo na base compartilhada: assina um contrato, o que dispara envio
       ao Juri e cria uma conversa. Usa delta (antes/depois), entao nao se
       importa com o que as suites de cima deixaram, e rodando no fim nao polui a
       contagem de ninguem. */
    suites.push(await testarPapeis({ base }));
    suites.push(await testarConexoesWorkspace({ base }));
    suites.push(await testarCopiarWorkspace({ base }));
    suites.push(await testarRelatorios({ base, zapsign }));
    /* Sobe processos proprios, em porta propria: nao encosta no servidor acima. */
    suites.push(await testarPortaOcupada({ raiz: RAIZ, portaLivre }));
    /* Tambem sobe processos proprios: o sistema como fica na VPS. */
    suites.push(await testarHospedagem({ raiz: RAIZ, portaLivre }));
    /* Tambem processos proprios: sobe e derruba varias vezes a mesma base. */
    suites.push(await testarSobreviver({ raiz: RAIZ, portaLivre }));
    /* Ferramenta de manutencao, com base descartavel propria. */
    suites.push(await testarBaseEStatus({ raiz: RAIZ }));
    suites.push(await testarAtivarAgentesSemEquipe({ raiz: RAIZ }));
    suites.push(await testarPosVenda({ raiz: RAIZ }));
    suites.push(await testarMigrarDepartamentoPosVenda({ raiz: RAIZ }));
    suites.push(await testarReatribuirPendentes({ raiz: RAIZ }));
    suites.push(await testarRetomarRespostasPendentes({ raiz: RAIZ }));
    suites.push(await testarPalavraChaveRevisita({ base }));
    suites.push(await testarLigarNumerosDasAreasNaVarredura({ raiz: RAIZ }));
    suites.push(await testarAgentesDasAreas({ raiz: RAIZ }));
    suites.push(await testarStatusDasAreas({ raiz: RAIZ }));
    suites.push(await testarSituacaoExterna({ raiz: RAIZ }));
    suites.push(await testarFollowup({ raiz: RAIZ }));
    suites.push(await testarRegrasAntiAlucinacao());
    suites.push(await testarRegrasInstitucionais());
    suites.push(await testarAplicarRegrasInstitucionais({ raiz: RAIZ }));
    suites.push(await testarVozDosAgentes({ raiz: RAIZ }));
    suites.push(await testarDeduplicarVozes({ raiz: RAIZ }));
    suites.push(await testarReorganizarAgentes({ raiz: RAIZ }));
    suites.push(await testarLiderhubHistorico({ raiz: RAIZ }));
    suites.push(await testarGatilhoAutomaticoDeHistorico({ raiz: RAIZ }));
    suites.push(await testarMigrarSemIdentificacao({ raiz: RAIZ }));
    suites.push(await testarDeduplicarContatos({ raiz: RAIZ }));
  } catch (erro) {
    console.error('\nA suite quebrou antes de terminar:', erro.message);
    console.error(erro.stack);
    encerrar();
    process.exit(1);
  }

  encerrar();

  /* Relatorio ---------------------------------------------------------- */
  let total = 0;
  let falharam = 0;
  for (const s of suites) {
    console.log(`\n${s.nome}`);
    for (const r of s.resultados) {
      total += 1;
      if (!r.passou) falharam += 1;
      console.log(`  ${r.passou ? 'ok   ' : 'FALHOU'} ${r.titulo}`);
      if (!r.passou && r.detalhe) console.log(`         ${r.detalhe}`);
    }
  }

  console.log(
    `\n${total - falharam} de ${total} passaram${falharam ? `, ${falharam} falharam` : ''}.`,
  );
  process.exit(falharam ? 1 : 0);
}

principal();
