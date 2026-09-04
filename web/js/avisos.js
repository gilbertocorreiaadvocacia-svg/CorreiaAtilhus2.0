/**
 * Aviso que alcanca quem nao esta olhando a tela: som e notificacao do sistema.
 *
 * O sino ja existia, mas ele so avisa quem esta com o sistema na frente. No
 * escritorio o CorreiaAtilhus fica aberto o dia inteiro numa aba atras de
 * outras coisas, e cliente que escreve espera resposta: um contador que muda
 * numa aba escondida nao e aviso, e registro.
 *
 * Duas escolhas de projeto valem explicacao:
 *
 * 1. O SOM E GERADO, e nao um arquivo. O sistema inteiro roda sem instalar
 *    nada e sem baixar nada; um .mp3 de aviso seria o primeiro arquivo de
 *    midia servido so para isso. Dois tons curtos de oscilador resolvem, com
 *    zero byte a mais no repositorio.
 * 2. AS DUAS PREFERENCIAS FICAM NO NAVEGADOR, e nao na conta. A permissao de
 *    notificacao do sistema ja e por navegador — o mesmo advogado pode querer
 *    som no computador da mesa e silencio no notebook que leva para audiencia,
 *    e guardar isso na conta faria uma escolha atravessar a outra maquina.
 */

/*
 * O prefixo minusculo e o mesmo das outras chaves guardadas (tema, menu,
 * simulador). Ele nao acompanhou o rebatismo de proposito: trocar apagaria a
 * escolha de todo mundo no dia em que o nome mudasse.
 */
const CHAVE_SOM = 'correiatendimentos:aviso-som';
const CHAVE_SISTEMA = 'correiatendimentos:aviso-sistema';

/*
 * Toda leitura e escrita passa por try/catch. Em janela anonima, com dados de
 * site bloqueados, ou dentro de uma captura de miniatura, o proprio acesso ao
 * localStorage lanca — e um sistema que nao abre porque nao conseguiu ler uma
 * preferencia de som seria absurdo.
 */
function ler(chave, padrao) {
  try {
    const valor = localStorage.getItem(chave);
    return valor === null ? padrao : valor === '1';
  } catch {
    return padrao;
  }
}

function gravar(chave, ligado) {
  try {
    localStorage.setItem(chave, ligado ? '1' : '0');
  } catch {
    /* Sem onde guardar, a escolha vale so por esta sessao. */
  }
}

/* Som ligado por padrao, notificacao do sistema desligada: a primeira nao pede
   nada a ninguem, a segunda depende de uma permissao que so a pessoa pode dar. */
export const somLigado = () => ler(CHAVE_SOM, true);
export const sistemaLigado = () => ler(CHAVE_SISTEMA, false);
export const definirSom = (ligado) => gravar(CHAVE_SOM, ligado);
export const definirSistema = (ligado) => gravar(CHAVE_SISTEMA, ligado);

export function permissaoDoSistema() {
  if (!('Notification' in window)) return 'indisponivel';
  return Notification.permission;
}

/**
 * Pede a permissao do navegador.
 *
 * So pode ser chamada a partir de um clique. Navegador nenhum aceita este
 * pedido no carregamento da pagina, e insistir ali gasta a unica chance: uma
 * vez negada, a permissao so volta pelas configuracoes do proprio navegador.
 */
export async function pedirPermissao() {
  if (!('Notification' in window)) return 'indisponivel';
  try {
    return await Notification.requestPermission();
  } catch {
    return Notification.permission;
  }
}

let audio = null;

/**
 * Dois tons curtos, subindo.
 *
 * Subindo, e nao descendo: som que cai soa como erro, e isto aqui avisa que
 * chegou trabalho, nao que algo quebrou. O volume baixo (0.12) e proposital —
 * uma sala de escritorio com o sistema aberto em varias mesas nao aguenta um
 * alerta cheio.
 */
export function tocar() {
  if (!somLigado()) return;
  try {
    const Contexto = window.AudioContext || window.webkitAudioContext;
    if (!Contexto) return;
    audio = audio || new Contexto();
    /* O navegador suspende o audio ate a primeira interacao da pessoa com a
       pagina. Sem isto o primeiro aviso do dia sairia mudo. */
    if (audio.state === 'suspended') audio.resume();

    const inicio = audio.currentTime;
    const oscilador = audio.createOscillator();
    const ganho = audio.createGain();

    oscilador.type = 'sine';
    oscilador.frequency.setValueAtTime(880, inicio);
    oscilador.frequency.setValueAtTime(1175, inicio + 0.09);

    /* Rampa exponencial, e nao degrau: ligar e desligar um oscilador no seco
       estala. O valor nunca chega a zero porque exponencial nao aceita zero. */
    ganho.gain.setValueAtTime(0.0001, inicio);
    ganho.gain.exponentialRampToValueAtTime(0.12, inicio + 0.02);
    ganho.gain.exponentialRampToValueAtTime(0.0001, inicio + 0.32);

    oscilador.connect(ganho).connect(audio.destination);
    oscilador.start(inicio);
    oscilador.stop(inicio + 0.34);
  } catch {
    /* Sem audio disponivel o sino continua contando. */
  }
}

/**
 * A notificacao do sistema operacional.
 *
 * So aparece quando a pessoa NAO esta com o sistema na frente. Se a tela ja
 * esta a vista, o sino e o som bastam, e um balao do sistema por cima do
 * proprio aplicativo que se esta usando e barulho.
 *
 * A checagem e dupla porque as duas situacoes existem: aba escondida atras de
 * outra (document.hidden) e janela aberta num segundo monitor com o foco em
 * outro programa (hasFocus).
 */
export function mostrarNoSistema(notificacao) {
  if (!sistemaLigado()) return;
  if (permissaoDoSistema() !== 'granted') return;
  if (!document.hidden && document.hasFocus()) return;

  try {
    const balao = new Notification(notificacao.titulo || 'CorreiaAtilhus2.0', {
      body: notificacao.texto || '',
      icon: 'assets/logo.png',
      /* Marcado pela conversa: cinco mensagens do mesmo cliente substituem o
         balao anterior em vez de empilhar cinco na bandeja do sistema. */
      tag: notificacao.contatoId || notificacao.id,
    });
    balao.onclick = () => {
      window.focus();
      if (notificacao.contatoId) location.hash = `#/atendimento/${notificacao.contatoId}`;
      balao.close();
    };
  } catch {
    /* Alguns navegadores recusam o construtor fora de service worker. O aviso
       do sistema e um extra; o sino e o som ja aconteceram. */
  }
}

/** O que acontece quando chega uma notificacao nova: som, e depois o sistema. */
export function avisar(notificacao) {
  tocar();
  mostrarNoSistema(notificacao);
}
