import { achar, atualizar, listar, registrarLog } from '../nucleo/banco.js';
import { agora } from '../nucleo/util.js';
import { renovarTokenTikTok } from './drivers/tiktok.js';

/**
 * Os tokens das redes sociais vencem, e conexao com token vencido fica muda
 * sem erro nenhum na tela ate a primeira resposta falhar.
 *
 *  - TikTok: o token de acesso vale cerca de um dia, e cada renovacao devolve
 *    tambem uma renovacao nova. Renovar todo dia mantem a conta ligada mesmo
 *    sem mensagem nenhuma — parado tempo demais, a renovacao vence e alguem
 *    precisa entrar com a conta de novo.
 *  - Instagram: o token de longa duracao vale 60 dias e pode ser renovado a
 *    partir de 24 horas de idade. Uma renovacao por semana basta.
 *
 * A rodada e de seis em seis horas e nunca derruba nada: falha vira um evento
 * na trilha do numero, que e onde a tela de Conexoes le o que aconteceu.
 */

const INTERVALO = 6 * 60 * 60 * 1000;
const SEMANA = 7 * 24 * 60 * 60 * 1000;

const baseInstagram = () =>
  new URL(process.env.CORREIA_INSTAGRAM_URL || 'https://graph.instagram.com/v25.0').origin;

function anotar(conexao, descricao) {
  registrarLog(conexao.workspaceId, null, 'conexao_token', descricao, null, {
    conexaoId: conexao.id,
    conexaoNome: conexao.nome,
  });
}

/** Renova o token de longa duracao do Instagram (graph.instagram.com). */
export async function renovarTokenInstagram(conexao) {
  const cfg = conexao.instagram || {};
  if (!cfg.token) return false;
  const url = new URL(`${baseInstagram()}/refresh_access_token`);
  url.searchParams.set('grant_type', 'ig_refresh_token');
  url.searchParams.set('access_token', cfg.token);
  const resposta = await fetch(url);
  const dados = await resposta.json().catch(() => ({}));
  if (!resposta.ok || !dados.access_token) {
    throw new Error(dados?.error?.message || `Instagram respondeu ${resposta.status}`);
  }
  atualizar('conexoes', conexao.id, {
    instagram: {
      ...(achar('conexoes', conexao.id)?.instagram || cfg),
      token: dados.access_token,
      tokenRenovadoEm: agora(),
      tokenVenceEm: dados.expires_in ? new Date(Date.now() + Number(dados.expires_in) * 1000).toISOString() : null,
    },
  });
  return true;
}

export async function rodadaDeTokens() {
  for (const conexao of listar('conexoes')) {
    try {
      if (conexao.tipo === 'tiktok' && conexao.tiktok?.renovacao) {
        const vence = Date.parse(conexao.tiktok.tokenVenceEm || '');
        if (!Number.isFinite(vence) || vence - Date.now() < INTERVALO * 2) {
          await renovarTokenTikTok(conexao, { forcar: true });
        }
      }
      if (conexao.tipo === 'instagram' && conexao.instagram?.token) {
        const ultima = Date.parse(conexao.instagram.tokenRenovadoEm || conexao.instagram.tokenGuardadoEm || '');
        if (!Number.isFinite(ultima) || Date.now() - ultima > SEMANA) {
          await renovarTokenInstagram(conexao);
        }
      }
    } catch (erro) {
      anotar(conexao, `Nao deu para renovar o token: ${erro.message}. Se continuar, entre com a conta de novo em Conexoes.`);
    }
  }
}

let relogio = null;

export function iniciarRenovacaoDeTokens() {
  if (relogio) return;
  /* A primeira rodada espera um minuto: a subida do servidor ja tem trabalho
     demais, e nenhum token vence nesse minuto. */
  relogio = setTimeout(function rodar() {
    rodadaDeTokens().finally(() => {
      relogio = setTimeout(rodar, INTERVALO);
      relogio.unref?.();
    });
  }, 60 * 1000);
  relogio.unref?.();
}
