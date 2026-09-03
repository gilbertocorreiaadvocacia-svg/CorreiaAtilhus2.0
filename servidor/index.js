import fs from 'node:fs';
import http from 'node:http';
import path from 'node:path';
import { INTERVALO_AGENDADOR, PORTA } from './config.js';
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

rotas.get('/api/saude', async () => ({ ok: true, versao: '0.1.0', agora: new Date().toISOString() }), {
  publica: true,
});

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

servidor.listen(PORTA, () => {
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
