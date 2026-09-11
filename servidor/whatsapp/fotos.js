import crypto from 'node:crypto';
import { achar, atualizar } from '../nucleo/banco.js';
import { emitir } from '../nucleo/eventos.js';
import { apagarMidia, guardarBuffer } from '../nucleo/midia.js';
import { agora } from '../nucleo/util.js';
import { driverDa } from './drivers/index.js';

/**
 * A foto de perfil de cada contato, trazida do WhatsApp.
 *
 * O avatar da tela sempre soube desenhar foto; faltava alguem buscar. Todo
 * contato aparecia de iniciais, e numa fila de quarenta pessoas as iniciais
 * sao a pior forma de reconhecer alguem — tres "MS" seguidos.
 *
 * DUAS DECISOES QUE VALEM SER DITAS
 *
 * 1. A foto e BAIXADA e guardada aqui, e nao apontada no endereco do
 *    WhatsApp. O endereco vence em poucos dias (a tela voltaria as iniciais
 *    sozinha), e desenhar direto dele faria o navegador de cada pessoa da
 *    equipe chamar o servidor da Meta a cada lista aberta.
 *
 * 2. UMA POR VEZ, com intervalo. Esta conexao nao e oficial, e o que derruba
 *    numero nela e comportamento de robo: duzentas consultas de foto em
 *    sequencia, logo depois de importar o historico, e exatamente isso. A
 *    fila anda devagar de proposito; a foto chega em minutos, e o numero fica.
 *
 * Cada contato e conferido de novo depois de VALIDADE: a pessoa troca de foto,
 * ou esconde. Foto posta a mao por alguem do escritorio nunca e trocada.
 */

const INTERVALO = Number(process.env.CORREIA_FOTO_INTERVALO) || 1500;
const VALIDADE = 3 * 24 * 60 * 60 * 1000;
const TAMANHO_MAXIMO = 5 * 1024 * 1024;

const fila = [];
const naFila = new Set();
let andando = false;

const dormir = (ms) => new Promise((r) => setTimeout(r, ms));

/** Poe o contato na fila, se ele precisar. Pode chamar a vontade. */
export function agendarFoto(contato, { forcar = false } = {}) {
  if (!contato?.id || naFila.has(contato.id)) return false;
  if (contato.fotoOrigem === 'manual') return false;
  const conexao = achar('conexoes', contato.conexaoId);
  if (!conexao || conexao.estado !== 'conectado' || !driverDa(conexao).buscarFoto) return false;
  const vista = Date.parse(contato.fotoVerificadaEm || '');
  if (!forcar && Number.isFinite(vista) && Date.now() - vista < VALIDADE) return false;

  naFila.add(contato.id);
  fila.push(contato.id);
  andar();
  return true;
}

async function andar() {
  if (andando) return;
  andando = true;
  try {
    while (fila.length) {
      const id = fila.shift();
      try {
        await buscarAgora(id);
      } catch {
        /* Falha de uma foto nao para a fila: fica para a proxima conferencia. */
      } finally {
        naFila.delete(id);
      }
      if (fila.length) await dormir(INTERVALO);
    }
  } finally {
    andando = false;
  }
}

async function baixarImagem(url) {
  const resposta = await fetch(url, { signal: AbortSignal.timeout(20000) });
  if (!resposta.ok) return null;
  const mime = String(resposta.headers.get('content-type') || '').split(';')[0].trim();
  if (!mime.startsWith('image/')) return null;
  const dados = Buffer.from(await resposta.arrayBuffer());
  if (!dados.length || dados.length > TAMANHO_MAXIMO) return null;
  return { dados, mime };
}

async function buscarAgora(contatoId) {
  const contato = achar('contatos', contatoId);
  if (!contato || contato.fotoOrigem === 'manual') return;
  const conexao = achar('conexoes', contato.conexaoId);
  const driver = conexao ? driverDa(conexao) : null;
  if (!driver?.buscarFoto) return;

  /* Conversa so com o codigo @lid ainda nao tem telefone; o codigo serve. */
  const soCodigo = Boolean(contato.lid) && contato.telefone === String(contato.lid).split('@')[0];
  const numero = contato.telefone && !soCodigo ? contato.telefone : contato.lid || contato.telefone;
  const endereco = await driver.buscarFoto({ conexao, numero });

  const mudancas = { fotoVerificadaEm: agora() };
  if (endereco) {
    const baixada = await baixarImagem(endereco);
    if (baixada) {
      /* A mesma foto de antes nao vira arquivo novo a cada conferencia. */
      const hash = crypto.createHash('sha1').update(baixada.dados).digest('hex');
      if (hash !== contato.fotoHash || !contato.foto) {
        const guardada = guardarBuffer({ nome: `foto-${contato.id}`, dados: baixada.dados, mime: baixada.mime });
        if (contato.foto && contato.fotoOrigem === 'whatsapp') apagarMidia(contato.foto);
        Object.assign(mudancas, { foto: guardada.url, fotoOrigem: 'whatsapp', fotoHash: hash });
      }
    }
  } else if (contato.foto && contato.fotoOrigem === 'whatsapp') {
    /* A pessoa tirou ou escondeu a foto: a tela respeita. */
    apagarMidia(contato.foto);
    Object.assign(mudancas, { foto: null, fotoOrigem: null, fotoHash: null });
  }

  atualizar('contatos', contato.id, mudancas);
  if (mudancas.foto !== undefined) emitir(contato.workspaceId, 'contato', { contatoId: contato.id });
}
