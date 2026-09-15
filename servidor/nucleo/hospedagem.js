import { atualizar, listar } from './banco.js';
import { agora, conferirSenha, hashSenha, normalizar } from './util.js';

/**
 * A senha padrao nao sobe para a internet.
 *
 * A senha da semeadura esta publicada no README, e o repositorio e publico. No
 * notebook isso era contido pela guarda de rede; hospedado, a tela de login
 * fica aberta para o mundo. Entao, com CORREIA_HOSPEDADO=1, antes de abrir a
 * porta:
 *
 *   - o administrador (CORREIA_ADMIN_EMAIL) que ainda usa a senha padrao passa
 *     a usar CORREIA_ADMIN_SENHA. Vale na primeira subida e ao trazer os dados
 *     do notebook. Quem ja trocou a senha pela tela nao e tocado: o .env nao
 *     desfaz a troca a cada reinicio;
 *   - sobrando QUALQUER pessoa com a senha padrao, o sistema nao sobe, e diz
 *     quem sao (so o e-mail).
 */

export const SENHA_PADRAO = 'correia2026';
export const MINIMO_DA_SENHA = 12;

export function prepararHospedagem(ambiente = process.env) {
  const emailDoAdministrador = normalizar(ambiente.CORREIA_ADMIN_EMAIL || 'admin@correia.adv.br');
  const senha = String(ambiente.CORREIA_ADMIN_SENHA || '');

  if (senha && (senha.length < MINIMO_DA_SENHA || senha === SENHA_PADRAO)) {
    throw new Error(`CORREIA_ADMIN_SENHA precisa ter no minimo ${MINIMO_DA_SENHA} caracteres e nao pode ser a senha padrao.`);
  }

  const trocados = [];
  const comSenhaPadrao = [];
  for (const usuario of listar('usuarios')) {
    if (!conferirSenha(SENHA_PADRAO, usuario.senha)) continue;
    if (senha && normalizar(usuario.email) === emailDoAdministrador) {
      atualizar('usuarios', usuario.id, { senha: hashSenha(senha), senhaAlteradaEm: agora() });
      trocados.push(usuario.email);
    } else {
      comSenhaPadrao.push(usuario.email);
    }
  }

  if (comSenhaPadrao.length) {
    throw new Error(
      `Hospedado, o sistema nao sobe com a senha padrao. Ainda usam a senha padrao: ${comSenhaPadrao.join(', ')}. ` +
        `Ponha a senha do administrador em CORREIA_ADMIN_SENHA no .env (minimo ${MINIMO_DA_SENHA} caracteres), ` +
        'e troque a senha das outras pessoas antes de trazer os dados.',
    );
  }
  return { trocados };
}
