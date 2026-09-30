import fs from 'node:fs';
import path from 'node:path';
import { PASTA_DADOS } from '../config.js';
import { listar, registrarLog } from './banco.js';
import { agora } from './util.js';

/**
 * O pulso do sistema, e o que fazer com o que aconteceu enquanto ele nao batia.
 *
 * A Evolution entrega a mensagem do cliente chamando o webhook daqui. Se o
 * sistema estiver fora do ar nesse instante, a chamada falha e ela nao tenta de
 * novo: a mensagem fica no celular e NUNCA entra no sistema. Ninguem e avisado.
 * Para quem esta do lado de fora, o cliente escreveu e o escritorio nao
 * respondeu.
 *
 * Isso deixou de ser hipotese em 30/09/2026: uma faxina de dados exigiu parar o
 * servico tres vezes, por poucos minutos cada. Nenhuma daquelas janelas tinha
 * rede de protecao.
 *
 * A recuperacao ja existia no sistema, so nao era automatica: a importacao do
 * historico le as conversas direto da Evolution e reconhece pelo id o que ja
 * esta gravado, entao rodar de novo so acrescenta o que faltava. O que faltava
 * era SABER que houve buraco. E o que este arquivo resolve.
 *
 * O pulso e um arquivo, e nao um registro do banco, de proposito: ele precisa
 * sobreviver a uma parada suja, em que o banco nao chegou a gravar o que tinha
 * em memoria.
 */

const ARQUIVO = path.join(PASTA_DADOS, 'batimento.json');

/** De quanto em quanto tempo o pulso e gravado. */
const INTERVALO = Number(process.env.CORREIA_BATIMENTO_INTERVALO || 60000);

/**
 * A partir de quanto tempo parado vale procurar o que se perdeu.
 *
 * Tres minutos e deliberadamente maior que o intervalo do pulso: uma parada
 * limpa, com atualizacao e restart, leva segundos, e disparar a busca a cada
 * atualizacao de versao faria o sistema varrer o celular inteiro varias vezes
 * por dia sem nada para achar.
 */
const LIMIAR = Number(process.env.CORREIA_BATIMENTO_LIMIAR || 180000);

export function lerUltimoBatimento() {
  try {
    const bruto = JSON.parse(fs.readFileSync(ARQUIVO, 'utf8'));
    const quando = Date.parse(bruto?.em);
    return Number.isFinite(quando) ? quando : null;
  } catch {
    /* Primeira subida, ou arquivo ilegivel: nao ha buraco a reclamar. */
    return null;
  }
}

function bater() {
  try {
    fs.writeFileSync(ARQUIVO, JSON.stringify({ em: agora() }));
  } catch {
    /* Disco cheio ou pasta somente leitura nao podem derrubar o atendimento. */
  }
}

export function iniciarBatimento() {
  bater();
  const relogio = setInterval(bater, INTERVALO);
  if (typeof relogio.unref === 'function') relogio.unref();
  return relogio;
}

/**
 * Procura o que chegou enquanto o sistema estava fora.
 *
 * Roda UMA passada por numero conectado, que e a mesma coisa que o botao
 * "Sincronizar tudo" faz. Nao arma a sequencia de rodadas: aquela existe para
 * o momento em que o celular despeja anos de historico depois do QR Code, e
 * aqui o buraco e de minutos.
 *
 * Deve ser chamada ANTES de iniciarBatimento(), enquanto o arquivo ainda
 * guarda a hora da ultima vez que o sistema esteve vivo.
 */
export async function recuperarDaQueda() {
  const ultimo = lerUltimoBatimento();
  if (!ultimo) return null;

  const paradoPor = Date.now() - ultimo;
  if (paradoPor < LIMIAR) return null;

  const minutos = Math.round(paradoPor / 60000);
  const conexoes = listar('conexoes', { tipo: 'qrcode' }).filter((c) => c.estado === 'conectado');

  console.log(
    `[batimento] o sistema ficou ${minutos} min sem bater. ${conexoes.length} numero(s) conectado(s) para conferir.`,
  );
  if (!conexoes.length) return { minutos, conexoes: 0 };

  /* Import tardio: sincronizar-historico puxa a cadeia inteira do WhatsApp, e
     carrega-la no topo faria este modulo pesar em quem so quer o pulso. */
  const { rodar } = await import('../whatsapp/sincronizar-historico.js');

  const relato = { minutos, conexoes: conexoes.length, recuperadas: 0, mensagens: 0 };
  for (const conexao of conexoes) {
    try {
      const resultado = await rodar(conexao.id);
      const novas = resultado?.mensagensGravadas || 0;
      relato.mensagens += novas;
      relato.recuperadas += 1;
      registrarLog(
        conexao.workspaceId,
        null,
        'conexao_recuperacao',
        novas
          ? `O sistema ficou ${minutos} min fora do ar. Ao voltar, ${novas} mensagens que tinham chegado nesse periodo foram trazidas do celular.`
          : `O sistema ficou ${minutos} min fora do ar. Nada chegou nesse periodo: nenhuma mensagem se perdeu.`,
        { tipo: 'sistema', nome: 'Sistema' },
        { conexaoId: conexao.id, conexaoNome: conexao.nome },
      );
    } catch (erro) {
      registrarLog(
        conexao.workspaceId,
        null,
        'conexao_recuperacao',
        `O sistema ficou ${minutos} min fora do ar e nao consegui conferir o que chegou: ${erro.message}. Use "Sincronizar tudo" nesta conexao.`,
        { tipo: 'sistema', nome: 'Sistema' },
        { conexaoId: conexao.id, conexaoNome: conexao.nome },
      );
    }
  }

  console.log(`[batimento] recuperacao: ${relato.mensagens} mensagens trazidas de ${relato.recuperadas} numero(s).`);
  return relato;
}
