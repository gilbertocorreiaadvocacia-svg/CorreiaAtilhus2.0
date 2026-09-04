import { driverSimulador } from './simulador.js';
import { driverOficial } from './oficial.js';
import { driverQrCode } from './qrcode.js';

/**
 * Os drivers de WhatsApp.
 *
 * O escritorio nao opera um jeito so de conectar, e nao deveria mesmo. O
 * numero comercial e o que corre risco: ele dispara follow-up, fala com quem
 * nunca respondeu e e o primeiro a ser denunciado. O numero de pos-venda fala
 * com quem ja assinou contrato e NAO PODE CAIR, nunca. Sao dois riscos
 * diferentes, e cada um pede um caminho diferente:
 *
 *  - `simulador`  nada sai desta maquina. Roda o funil inteiro sem chip.
 *  - `oficial`    Cloud API da Meta. Nao ha risco de banimento, mas exige
 *                 numero verificado, template aprovado e a janela de 24 horas.
 *  - `qrcode`     sessao lida por QR Code, atraves de um servico local
 *                 (Evolution API ou WPPConnect). Entra em grupo, manda audio e
 *                 nao depende de template. Em compensacao e conexao nao
 *                 oficial: a Meta pode banir o numero.
 *
 * Tudo o que o resto do sistema sabe e a interface abaixo. O motor de IA, o
 * follow-up, a mencao e a API publica chamam `enviarMensagem()` sem nunca
 * perguntar de que tipo e a conexao, e um driver novo entra sem tocar em nada
 * disso.
 *
 * INTERFACE (o que todo driver responde):
 *
 *   id                    string, igual ao `tipo` da conexao
 *   nome                  como aparece na tela
 *   precisaCredenciais    boolean, se falta configurar impede o envio
 *   async enviar({ conexao, contato, tipo, conteudo, midia, template })
 *                         devolve { idExterno } ou lanca Error com
 *                         .codigoWhatsapp quando o provedor deu um codigo
 *   async testar({ conexao })
 *                         { ok, numero, qualidade, nomeExibicao, erro }
 *   async marcarLida({ conexao, idExterno })      best effort, nunca lanca
 *
 * OPCIONAIS (so quem tem sessao para abrir):
 *
 *   async conectar({ conexao })     { qrCode, estado, erro }
 *   async desconectar({ conexao })  { ok, erro }
 *   conferirAssinatura({ conexao, cabecalhos, corpoBruto })   boolean
 *   interpretarWebhook({ conexao, corpo })  eventos normalizados, ver abaixo
 *
 * O webhook de cada provedor tem um formato proprio, e traduzi-lo e trabalho do
 * driver. O que sobe para a rota e sempre a mesma forma:
 *
 *   {
 *     mensagens: [{ telefone, nome, idExterno, tipo, conteudo, midia, metadados }],
 *     situacoes: [{ idExterno, situacao, erro }],
 *     conexao:   { estado, qrCode, numero, qualidade, evento } | null,
 *     templates: [{ metaNome, situacao, motivo }],
 *   }
 */

const DRIVERS = {
  simulador: driverSimulador,
  oficial: driverOficial,
  qrcode: driverQrCode,
};

/** O driver de uma conexao. Tipo desconhecido cai no simulador, que nao envia
 *  nada para fora: e o unico padrao seguro quando o cadastro esta estranho. */
export function driverDa(conexao) {
  return DRIVERS[conexao?.tipo] || DRIVERS.simulador;
}

export function listarDrivers() {
  return Object.values(DRIVERS).map((d) => ({
    id: d.id,
    nome: d.nome,
    descricao: d.descricao,
    temSessao: Boolean(d.conectar),
  }));
}

export { DRIVERS };
