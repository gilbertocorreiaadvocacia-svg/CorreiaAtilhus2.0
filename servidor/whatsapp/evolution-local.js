import fs from 'node:fs';
import path from 'node:path';
import { PORTA, RAIZ } from '../config.js';
import { atualizar } from '../nucleo/banco.js';

/**
 * A Evolution que roda NESTA maquina, em windows/evolution.
 *
 * Toda conexao por QR Code precisa de tres coisas que sao sempre as mesmas
 * aqui: o endereco da Evolution, a chave dela e o endereco de volta. Pedir que
 * alguem digite isso a cada numero novo deu no que deu: a conexao nasce vazia,
 * o botao Conectar responde "endereco do servico nao configurado", e a chave e
 * um segredo de 40 caracteres que ninguem deveria estar copiando a mao.
 *
 * O arquivo windows/evolution/.env e o mesmo que o Docker le para subir a
 * Evolution — entao a chave lida aqui e, por construcao, a que ela aceita. O
 * valor nunca sai pela tela: paraTela() mascara a chave como qualquer outra.
 *
 * O endereco de volta e host.docker.internal porque a Evolution roda dentro do
 * Docker, e `localhost` la dentro e o proprio conteiner.
 *
 * CORREIA_EVOLUTION_ENV troca o arquivo — existe para o teste nao pegar a chave
 * real da maquina de quem roda a suite.
 */
const ARQUIVO = process.env.CORREIA_EVOLUTION_ENV || path.join(RAIZ, 'windows', 'evolution', '.env');

function lerEnv() {
  let texto;
  try {
    texto = fs.readFileSync(ARQUIVO, 'utf8');
  } catch {
    return null;
  }
  const valor = (nome) => {
    const linha = texto.split(/\r?\n/).find((l) => l.startsWith(`${nome}=`));
    return linha ? linha.slice(nome.length + 1).trim().replace(/^['"]|['"]$/g, '') : '';
  };
  return { chave: valor('AUTHENTICATION_API_KEY') };
}

/*
 * Hospedado (hospedagem/docker-compose.yml) a Evolution nao mora nesta
 * maquina: e o conteiner "evolution" da mesma rede, e a volta e o conteiner do
 * sistema. As tres variaveis dizem isso e valem por cima do arquivo.
 */
function doAmbiente() {
  const servidor = process.env.CORREIA_EVOLUTION_URL || '';
  const chave = process.env.CORREIA_EVOLUTION_CHAVE || '';
  if (!servidor || !chave) return null;
  return { servidor, chave, urlWebhook: process.env.CORREIA_EVOLUTION_WEBHOOK || `http://localhost:${PORTA}` };
}

/* Os enderecos que so existem no notebook, gravados nos dados trazidos de la. */
const DO_NOTEBOOK = /^https?:\/\/(localhost|127\.0\.0\.1):8080\/?$|host\.docker\.internal/;

/** O que falta na configuracao de QR Code, preenchido com a Evolution local. */
export function completarComEvolutionLocal(qrcode = {}) {
  const ambiente = doAmbiente();
  if (ambiente) {
    return {
      ...qrcode,
      servidor: qrcode.servidor || ambiente.servidor,
      chave: qrcode.chave || ambiente.chave,
      urlWebhook: qrcode.urlWebhook || ambiente.urlWebhook,
    };
  }
  const env = lerEnv();
  if (!env?.chave) return qrcode;
  return {
    ...qrcode,
    servidor: qrcode.servidor || 'http://localhost:8080',
    chave: qrcode.chave || env.chave,
    urlWebhook: qrcode.urlWebhook || `http://host.docker.internal:${PORTA}`,
  };
}

/**
 * Conexao por QR Code criada antes disto, ou salva com os campos em branco:
 * completa e grava, e devolve a versao atualizada. Campo preenchido por alguem
 * nunca e trocado.
 */
export function garantirEvolutionLocal(conexao) {
  if (conexao?.tipo !== 'qrcode') return conexao;
  const atual = conexao.qrcode || {};
  /* Dados trazidos do notebook para a hospedagem: o endereco de la nao existe
     aqui, e a chave era a da Evolution de la. */
  const ambiente = doAmbiente();
  if (ambiente && (DO_NOTEBOOK.test(atual.servidor || '') || DO_NOTEBOOK.test(atual.urlWebhook || ''))) {
    return atualizar('conexoes', conexao.id, { qrcode: { ...atual, ...ambiente } });
  }
  if (atual.servidor && atual.chave && atual.urlWebhook) return conexao;
  const completo = completarComEvolutionLocal(atual);
  if (completo === atual) return conexao;
  return atualizar('conexoes', conexao.id, { qrcode: completo });
}
