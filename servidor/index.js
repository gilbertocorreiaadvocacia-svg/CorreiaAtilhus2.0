import fs from 'node:fs';
import http from 'node:http';
import path from 'node:path';
import { INTERVALO_AGENDADOR, PORTA, RAIZ } from './config.js';
import { caminhoDaMidia } from './nucleo/midia.js';
import { atualizar, encerrarBanco, iniciarBanco, listar } from './nucleo/banco.js';
import { migrarCoresParaTokens } from './nucleo/paleta.js';
import { contextoDaSessao, limparSessoesOrfas } from './nucleo/auth.js';
import { criarRoteador, lerCookies, lerCorpo, responderErro, responderJson, servirEstatico } from './nucleo/http.js';
import { inscrever } from './nucleo/eventos.js';
import { semearSePrecisar } from './nucleo/seed.js';
import { iniciarAgendador } from './automacao/followup.js';
import { COOKIE_SESSAO, registrarSessao } from './rotas/sessao.js';
import { registrarAtendimento } from './rotas/atendimento.js';
import { registrarAutomacoes } from './rotas/automacoes.js';
import { registrarConexoes } from './rotas/conexoes.js';
import { registrarPainel } from './rotas/painel.js';
import { registrarTarefas } from './rotas/tarefas.js';
import { registrarIntegracoes } from './rotas/integracoes.js';
import { autenticarChave, dentroDoLimite, registrarPublica } from './rotas/publica.js';

iniciarBanco();
/* Quando ESTA copia subiu. Vai na saude, para dar para distinguir duas. */
const INICIADO_EM = new Date().toISOString();

const semeado = semearSePrecisar();
/* Depois de semear, para pegar tambem a base que acabou de nascer. */
const coresTrocadas = migrarCoresParaTokens({ listar, atualizar });
if (coresTrocadas) console.log(`Paleta: ${coresTrocadas} cores da semeadura antiga viraram token de tema.`);
limparSessoesOrfas();

const MIMES = {
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.png': 'image/png',
  '.webp': 'image/webp',
  '.gif': 'image/gif',
  '.mp4': 'video/mp4',
  '.webm': 'video/webm',
  '.mp3': 'audio/mpeg',
  '.ogg': 'audio/ogg',
  '.wav': 'audio/wav',
  '.pdf': 'application/pdf',
};

/* ------------------------------------------------------------------ */
/* Roteador                                                            */
/* ------------------------------------------------------------------ */

const base = criarRoteador();
const opcoesPorRota = new Map();

function envolver(metodo) {
  return (caminho, manipulador, opcoes = {}) => {
    opcoesPorRota.set(`${metodo}:${caminho}`, opcoes);
    base[metodo.toLowerCase()](caminho, { manipulador, opcoes, chave: `${metodo}:${caminho}` });
  };
}

const rotas = {
  get: envolver('GET'),
  post: envolver('POST'),
  put: envolver('PUT'),
  patch: envolver('PATCH'),
  delete: envolver('DELETE'),
};

registrarSessao(rotas);
registrarAtendimento(rotas);
registrarAutomacoes(rotas);
registrarConexoes(rotas);
registrarPainel(rotas);
registrarTarefas(rotas);
registrarIntegracoes(rotas);
registrarPublica(rotas);

/* Canal de tempo real ------------------------------------------------- */
rotas.get('/api/eventos', async ({ req, res, ctx }) => {
  inscrever(res, { workspaceId: ctx.workspaceId, usuarioId: ctx.usuarioId });
  req.on('close', () => {});
  return null;
}, { cru: true });

/*
 * Saude. Alem de dizer que esta de pe, diz DE ONDE esta de pe.
 *
 * A pasta parece informacao inutil ate o dia em que existem duas copias do
 * sistema na maquina: a que subiu sozinha no login e a que alguem acabou de
 * abrir no editor. As duas atendem em localhost:4477, a tela e identica, e nao
 * ha como saber qual esta na frente. Quem nao descobre isso passa a tarde
 * mexendo no codigo certo e olhando para a copia errada.
 *
 * O caminho fica exposto sem sessao porque o servidor escuta so em 127.0.0.1:
 * quem alcanca esta rota ja esta nesta maquina, e a resposta e para ele mesmo
 * se achar.
 */
rotas.get(
  '/api/saude',
  async () => ({
    ok: true,
    versao: '0.1.0',
    agora: new Date().toISOString(),
    raiz: RAIZ,
    pid: process.pid,
    desde: INICIADO_EM,
  }),
  { publica: true },
);

/* ------------------------------------------------------------------ */
/* Servidor                                                            */
/* ------------------------------------------------------------------ */

const servidor = http.createServer(async (req, res) => {
  const url = new URL(req.url, `http://${req.headers.host || 'localhost'}`);
  const caminho = url.pathname;

  try {
    const encontrada = base.resolver(req.method, caminho);

    if (!encontrada) {
      // Midia guardada pelo sistema: video de proposta, audio, PDF, laudo.
      if (req.method === 'GET' && caminho.startsWith('/midia/')) {
        const arquivo = caminhoDaMidia(caminho);
        if (arquivo) {
          const info = fs.statSync(arquivo);
          res.writeHead(200, {
            'Content-Type': MIMES[path.extname(arquivo).toLowerCase()] || 'application/octet-stream',
            'Content-Length': info.size,
            'Cache-Control': 'private, max-age=86400',
          });
          fs.createReadStream(arquivo).pipe(res);
          return;
        }
        responderErro(res, 404, 'Arquivo nao encontrado.');
        return;
      }

      if (req.method === 'GET' && !caminho.startsWith('/api/') && !caminho.startsWith('/v1/')) {
        if (servirEstatico(req, res, caminho)) return;
        // Fallback do aplicativo so para navegacao de pagina. Sem essa condicao,
        // qualquer caminho errado devolveria o index com 200, inclusive um
        // pedido de arquivo que nao existe, que deve falhar de verdade.
        const querHtml = String(req.headers.accept || '').includes('text/html');
        if (querHtml && servirEstatico(req, res, '/index.html')) return;
      }
      responderErro(res, 404, 'Rota nao encontrada.');
      return;
    }

    const { manipulador, opcoes } = encontrada.manipulador;
    const query = Object.fromEntries(url.searchParams.entries());

    let ctx = null;
    let api = null;

    if (opcoes.chaveApi) {
      api = autenticarChave(req);
      if (!api) {
        responderErro(res, 401, 'Cabecalho x-company-key ausente ou invalido.');
        return;
      }
      if (!dentroDoLimite(api.workspaceId)) {
        responderErro(res, 429, 'Limite de 3 requisicoes por segundo atingido. Tente de novo em instantes.');
        return;
      }
    } else if (!opcoes.publica) {
      const cookies = lerCookies(req);
      ctx = contextoDaSessao(cookies[COOKIE_SESSAO]);
      if (!ctx) {
        responderErro(res, 401, 'Sessao expirada. Entre de novo.');
        return;
      }
    } else {
      const cookies = lerCookies(req);
      ctx = contextoDaSessao(cookies[COOKIE_SESSAO]);
    }

    let corpo = {};
    let corpoBruto = Buffer.alloc(0);
    if (['POST', 'PUT', 'PATCH', 'DELETE'].includes(req.method)) {
      corpoBruto = await lerCorpo(req);
      if (corpoBruto.length && !opcoes.cru) {
        try {
          corpo = JSON.parse(corpoBruto.toString('utf8'));
        } catch {
          responderErro(res, 400, 'JSON invalido no corpo da requisicao.');
          return;
        }
      }
    }

    const resultado = await manipulador({
      req,
      res,
      ctx,
      api,
      params: encontrada.parametros,
      corpo,
      corpoBruto,
      query,
    });

    if (opcoes.cru || res.headersSent || res.writableEnded) return;
    responderJson(res, resultado ?? { ok: true });
  } catch (erro) {
    if (res.headersSent) {
      res.end();
      return;
    }
    const codigo = erro.codigo && erro.codigo >= 400 && erro.codigo < 600 ? erro.codigo : 500;
    if (codigo === 500) console.error('[erro]', caminho, erro);
    responderErro(res, codigo, erro.message || 'Erro interno do servidor.');
  }
});

/*
 * Guarda de instancia unica.
 *
 * Com o inicio automatico no login do Windows, o servidor ja sobe sozinho. Se
 * alguem tambem der dois cliques no INICIAR.bat, o segundo processo tenta subir
 * na mesma porta 4477 e o Node estoura EADDRINUSE. Sem tratar, isso vira um
 * erro feio (ou um loop de reinicio) e, pior, dois processos disputando os
 * mesmos arquivos de dados. Aqui o segundo simplesmente avisa que ja esta no ar
 * e sai limpo, deixando o primeiro dono unico do disco.
 */
servidor.on('error', async (erro) => {
  if (erro.code !== 'EADDRINUSE') {
    console.error('[erro no servidor]', erro);
    process.exit(1);
  }

  const linha = '─'.repeat(58);

  /*
   * Antes de dizer qualquer coisa, pergunta a quem esta na porta DE ONDE ele
   * roda. Duas copias na mesma maquina atendem em localhost:4477 com telas
   * identicas, e o antigo aviso ("ja esta rodando, abra o navegador") mandava a
   * pessoa olhar justamente para a copia errada: ela editava o codigo aqui,
   * recarregava a pagina e nao via mudanca nenhuma, sem nada na tela que
   * explicasse o porque.
   */
  let outra = null;
  try {
    const resposta = await fetch(`http://127.0.0.1:${PORTA}/api/saude`, {
      signal: AbortSignal.timeout(2000),
    });
    if (resposta.ok) outra = await resposta.json();
  } catch {
    /* Nao respondeu, ou nao e o nosso sistema. Tratado abaixo. */
  }

  if (!outra?.ok) {
    console.log(`\n${linha}`);
    console.log(`  A porta ${PORTA} esta ocupada por outro programa.`);
    console.log('  Nao e o CorreiaAtilhus2.0: ele nao respondeu na porta.');
    console.log('');
    console.log(`  Feche o outro programa, ou rode com outra porta:  PORTA=4488`);
    console.log(`${linha}\n`);
    process.exit(1);
  }

  const mesmaPasta = path.resolve(outra.raiz || '') === path.resolve(RAIZ);

  if (mesmaPasta) {
    /* Caso benigno: o inicio automatico ja subiu ESTA pasta, e alguem mandou
       subir de novo. Nada de errado, nada a fazer. */
    console.log(`\n  O CorreiaAtilhus2.0 desta pasta ja esta rodando na porta ${PORTA}.`);
    console.log(`  Abra http://localhost:${PORTA} no navegador.\n`);
    process.exit(0);
  }

  /* O caso que engana: outra COPIA, de outra pasta, esta na frente. */
  console.log(`\n${linha}`);
  console.log('  ATENCAO: outra copia do sistema esta ocupando a porta.');
  console.log(linha);
  console.log(`  No ar agora:  ${outra.raiz}`);
  console.log(`  Esta pasta:   ${RAIZ}`);
  console.log('');
  console.log(`  O que abre em localhost:${PORTA} e a copia de cima, NAO esta.`);
  console.log('  Alterar o codigo aqui nao muda nada na tela enquanto ela estiver no ar.');
  console.log('');
  console.log('  Como resolver, na copia que esta no ar:');
  console.log('    1. rode  windows\\desinstalar-inicio.cmd  para ela nao subir mais sozinha;');
  console.log(`    2. encerre o processo Node (Gerenciador de Tarefas), ou reinicie o Windows;`);
  console.log('    3. volte aqui e suba de novo (F5).');
  console.log(`${linha}\n`);
  process.exit(1);
});

/*
 * So esta maquina. O `'127.0.0.1'` prende o servidor ao localhost: sem ele, o
 * Node escutava em todas as interfaces e qualquer computador da rede do
 * escritorio alcancava o sistema pelo IP desta maquina, sem senha de rede
 * nenhuma. O atendimento roda aqui, nesta maquina, e e so daqui que se abre.
 */
servidor.listen(PORTA, '127.0.0.1', () => {
  const linha = '─'.repeat(58);
  console.log(`\n${linha}`);
  console.log('  CORREIATENDIMENTOS');
  console.log('  Correia Advogados Associados');
  console.log(linha);
  console.log(`  Aberto em:  http://localhost:${PORTA}`);
  if (semeado) {
    console.log('');
    console.log('  Primeiro acesso (entre com:)');
    console.log('    E-mail: admin@correia.adv.br');
    console.log('    Senha:  correia2026');
    console.log('  Troque a senha em Configuracoes > Membros.');
  }
  console.log(`${linha}\n`);
  iniciarAgendador(INTERVALO_AGENDADOR);
});

function encerrar() {
  console.log('\n  Salvando os dados antes de sair...');
  /* encerrarBanco agora devolve promessa: o disco e gravado na hora, e a
     promessa e a fila do espelho tentando esvaziar antes de fechar. O teto
     continua valendo para o processo nao ficar preso se o Supabase nao
     responder; o que ficar para tras sobe na proxima conferencia. */
  Promise.resolve(encerrarBanco()).finally(() => servidor.close(() => process.exit(0)));
  setTimeout(() => process.exit(0), 3000).unref();
}

process.on('SIGINT', encerrar);
process.on('SIGTERM', encerrar);
process.on('uncaughtException', (erro) => {
  console.error('[falha nao tratada]', erro);
  encerrarBanco();
});
