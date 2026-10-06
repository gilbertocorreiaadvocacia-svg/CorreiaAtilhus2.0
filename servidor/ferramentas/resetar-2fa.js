import { atualizar, encerrarBanco, iniciarBanco, listar } from '../nucleo/banco.js';
import { normalizar } from '../nucleo/util.js';

/**
 * A escotilha do segundo fator: `npm run resetar-2fa -- --email=fulano@...`
 * simula, e `--aplicar` zera. COM O SISTEMA PARADO (ela mexe nos arquivos de
 * dados; o servidor no ar sobrescreveria).
 *
 * POR QUE EXISTE
 *
 * O segundo fator e obrigatorio. Isso protege o escritorio e, no mesmo passo,
 * cria um jeito de ficar trancado para fora: celular perdido, trocado, ou
 * formatado com o app junto. Pela tela, o administrador reinicia o segundo
 * fator de qualquer membro — mas e o proprio administrador que fica sem app?
 * Ninguem acima dele para reiniciar.
 *
 * Esta ferramenta e a saida que nao depende de ninguem estar logado: roda na
 * VPS, zera o segundo fator de UM e-mail, e no proximo login essa conta refaz
 * o pareamento (o segundo fator continua obrigatorio; so o aparelho muda).
 *
 * O QUE ELA NAO FAZ: nao desliga o segundo fator do sistema, nao toca em senha,
 * e nao mexe em mais de uma conta por vez. Reiniciar tudo de uma vez seria a
 * ferramenta errada para o unico caso real, que e uma pessoa sem o aparelho.
 */

const APLICAR = process.argv.includes('--aplicar');
const email = (process.argv.find((a) => a.startsWith('--email=')) || '').slice('--email='.length).trim();

async function principal() {
  if (!email) {
    console.error('Uso: resetar-2fa.js --email=pessoa@escritorio.com [--aplicar]');
    process.exit(1);
  }

  await iniciarBanco();
  console.log(APLICAR ? 'MODO APLICAR: sera gravado.' : 'MODO SIMULACAO: nada sera gravado. Use --aplicar depois de conferir.');

  const alvo = normalizar(email);
  const usuario = listar('usuarios').find((u) => normalizar(u.email) === alvo);
  if (!usuario) {
    console.error(`\nNenhuma conta com o e-mail "${email}".`);
    console.error(`Contas que existem: ${listar('usuarios').map((u) => u.email).join(', ') || '(nenhuma)'}`);
    process.exit(1);
  }

  console.log(`\nConta: ${usuario.nome} <${usuario.email}>`);
  console.log(`Segundo fator hoje: ${usuario.doisFatores?.ativo ? 'ligado (pareado em ' + (usuario.doisFatores.confirmadoEm || '?') + ')' : 'desligado'}`);

  if (!usuario.doisFatores?.ativo) {
    console.log('\nNada a fazer: esta conta ja esta sem segundo fator pareado. No proximo login ela faz o pareamento.');
    process.exit(0);
  }

  console.log(`\n[${APLICAR ? 'feito' : 'simulado'}] zerar o segundo fator desta conta.`);
  if (APLICAR) {
    atualizar('usuarios', usuario.id, { doisFatores: null });
    await encerrarBanco();
    console.log('\nPronto. Suba o sistema; no proximo login essa conta parear um app de novo.');
  } else {
    console.log('\nNada foi gravado. Confira acima e rode de novo com --aplicar.');
  }
  process.exit(0);
}

principal().catch((erro) => {
  console.error('\nParou:', erro.message);
  console.error(erro.stack);
  process.exit(1);
});
