import { enderecoPermitido } from '../config.js';
import { suite } from './apoio.js';

/**
 * Quem pode falar com o servidor.
 *
 * Esta guarda so entra em acao quando CORREIA_HOST abre as interfaces, e isso
 * acontece por um motivo so: o caminho por QR Code. A Evolution API roda em
 * contêiner, e de dentro dele `localhost` e o proprio contêiner — para
 * entregar as mensagens recebidas ela precisa chamar a maquina de fora, o que
 * um servidor preso ao 127.0.0.1 recusa. Sem abrir, o QR conecta, a sessao
 * abre e nenhuma mensagem chega, sem erro nenhum na tela.
 *
 * Aberto o endereco, e esta lista que segura o resto da rede do escritorio. Um
 * teste de faixa de IP e um dos poucos lugares onde teste de unidade se
 * justifica neste projeto: nao ha costura para exercitar, ha uma decisao de
 * seguranca que precisa ser afirmada caso a caso — e o jeito de errar aqui e
 * silencioso, porque liberar demais nao quebra nada, so abre.
 */
export async function testarRede() {
  const s = suite('Guarda de rede');

  /* Esta maquina, nas tres formas em que o Node entrega o endereco. */
  for (const endereco of ['127.0.0.1', '::1', '::ffff:127.0.0.1']) {
    s.ok(`aceita a propria maquina (${endereco})`, enderecoPermitido(endereco));
  }

  /* As redes que o Docker cria. Sem elas, o webhook do QR Code nao entra. */
  for (const endereco of ['172.17.0.2', '172.18.0.5', '172.31.255.254', '192.168.65.3', '::ffff:172.17.0.2']) {
    s.ok(`aceita a rede do Docker (${endereco})`, enderecoPermitido(endereco));
  }

  /*
   * O que NAO pode entrar, e por que cada um esta aqui:
   *
   * 192.168.x e 10.x sao as faixas de rede de escritorio. Liberar uma delas
   * para resolver o webhook entregaria a tela de login para qualquer
   * computador da sala — e a senha padrao deste sistema esta publicada no
   * README. 172.15 e 172.32 sao as bordas de fora da faixa do Docker: e ali
   * que uma expressao mal escrita costuma vazar.
   */
  for (const endereco of [
    '192.168.0.10',
    '192.168.1.100',
    '192.168.64.9',
    '192.168.66.9',
    '10.0.0.5',
    '172.15.0.1',
    '172.32.0.1',
    '8.8.8.8',
    '203.0.113.7',
    '::ffff:192.168.1.100',
  ]) {
    s.ok(`recusa endereco de fora (${endereco})`, !enderecoPermitido(endereco));
  }

  /* Endereco ausente e o caso do socket ja fechado: recusar e o certo. */
  for (const vazio of [undefined, null, '']) {
    s.ok(`recusa endereco ausente (${JSON.stringify(vazio)})`, !enderecoPermitido(vazio));
  }

  return s;
}
