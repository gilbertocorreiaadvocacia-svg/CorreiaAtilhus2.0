import { atualizar, listar, registrarLog } from './banco.js';
import { agora, normalizar } from './util.js';

/**
 * A saida quando NINGUEM consegue entrar.
 *
 * POR QUE EXISTE
 *
 * O segundo fator e obrigatorio, e isso esta certo. Pela tela, o administrador
 * reinicia o de qualquer colega (Configuracoes > Membros). So que existe um
 * buraco que so aparece no pior dia: quando QUEM ADMINISTRA tambem esta
 * trancado do lado de fora, nao sobra ninguem logado para reiniciar o de
 * ninguem. Foi o que aconteceu em 13/11/2026 — duas contas, o mesmo "codigo
 * incorreto", e nenhum caminho de volta pela tela.
 *
 * A ferramenta de linha de comando (ferramentas/resetar-2fa.js) ja resolvia
 * isso, mas pede o sistema PARADO e um terminal na maquina. Na hospedagem, a
 * coisa que o escritorio sabe fazer sozinho e outra: abrir o painel, escrever
 * uma variavel de ambiente e implantar. Entao e por ai que a porta abre.
 *
 *     CORREIA_RESETAR_2FA=dani@correia.adv.br,leticia@correia.adv.br
 *
 * Na proxima subida, essas contas perdem o aparelho pareado e refazem o
 * pareamento no login seguinte. O segundo fator CONTINUA obrigatorio: o que
 * muda e qual celular vale, nao se a trava existe.
 *
 * NAO E UM INTERRUPTOR PERMANENTE, e o codigo garante isso de duas formas:
 *
 *  1. cada destravamento e marcado na conta (`destrava2fa.chave`). Deixar a
 *     variavel escrita no painel para sempre NAO zera o segundo fator da
 *     pessoa toda vez que o sistema sobe — depois que ela pareia o celular
 *     novo, a mesma variavel nao mexe mais nela. Sem essa marca, a variavel
 *     esquecida no painel viraria uma conta sem segundo fator nenhum, e
 *     ninguem perceberia;
 *  2. enquanto a variavel estiver escrita, TODA subida grita no log. Variavel
 *     de emergencia esquecida e divida, e divida tem que doer um pouco.
 *
 * Para destravar a MESMA pessoa de novo (perdeu o celular outra vez), mude o
 * valor — qualquer sufixo depois de `#` serve: `dani@correia.adv.br#2`.
 */

/** Separa `fulano@x.com#2` em e-mail e a chave inteira que marca esta rodada. */
function pedidosDe(valor) {
  return String(valor || '')
    .split(',')
    .map((parte) => parte.trim())
    .filter(Boolean)
    .map((parte) => ({ email: normalizar(parte.split('#')[0].trim()), chave: parte }))
    .filter((p) => p.email);
}

export function destrancar2faPeloAmbiente(valor = process.env.CORREIA_RESETAR_2FA) {
  const pedidos = pedidosDe(valor);
  if (!pedidos.length) return { ligado: false, zerados: [], jaFeitos: [], naoEncontrados: [] };

  const usuarios = listar('usuarios');
  const zerados = [];
  const jaFeitos = [];
  const naoEncontrados = [];

  for (const pedido of pedidos) {
    const usuario = usuarios.find((u) => normalizar(u.email) === pedido.email);
    if (!usuario) {
      naoEncontrados.push(pedido.email);
      continue;
    }
    /* Ja destravado por ESTE mesmo valor: nao mexe. E o que impede a variavel
       esquecida no painel de zerar o pareamento a cada subida. */
    if (usuario.destrava2fa?.chave === pedido.chave) {
      jaFeitos.push(usuario.email);
      continue;
    }
    atualizar('usuarios', usuario.id, {
      doisFatores: null,
      destrava2fa: { chave: pedido.chave, em: agora() },
    });
    zerados.push(usuario.email);
    /* A trilha de seguranca de cada escritorio em que a pessoa trabalha: sem
       isto, a unica marca de que a protecao caiu estaria no log do conteiner,
       que ninguem le depois. */
    for (const membro of listar('membros', { usuarioId: usuario.id })) {
      registrarLog(
        membro.workspaceId,
        null,
        'seguranca',
        `Verificação em duas etapas reiniciada pela hospedagem (CORREIA_RESETAR_2FA) para ${usuario.nome || usuario.email}. A conta pareia um app novo no próximo login.`,
        { tipo: 'sistema', id: null, nome: 'Hospedagem' },
      );
    }
  }

  return { ligado: true, zerados, jaFeitos, naoEncontrados };
}

/** O aviso da subida: o que foi feito, e o lembrete de apagar a variavel. */
export function contar2faDestrancado(resultado) {
  if (!resultado?.ligado) return;
  if (resultado.zerados.length) {
    console.error(`[2fa] DESTRAVEI pela variavel CORREIA_RESETAR_2FA: ${resultado.zerados.join(', ')}. Essas contas pareiam um app novo no proximo login.`);
  }
  if (resultado.jaFeitos.length) {
    console.error(`[2fa] ja destravadas antes por esta mesma variavel, nao mexi: ${resultado.jaFeitos.join(', ')}.`);
  }
  if (resultado.naoEncontrados.length) {
    console.error(`[2fa] a variavel CORREIA_RESETAR_2FA cita e-mail que nao existe: ${resultado.naoEncontrados.join(', ')}. Confira a escrita.`);
  }
  console.error('[2fa] APAGUE a variavel CORREIA_RESETAR_2FA do painel depois que todo mundo entrar. Ela e uma porta de emergencia, nao um ajuste.');
}
