import { atualizar, listar } from '../nucleo/banco.js';
import { SEM_IDENTIFICACAO } from './nomes.js';

/**
 * Contato que ja tem telefone mas ficou com "Conversa sem identificacao"
 * guardado no nome — pedido do escritorio em 15/10/2026: "quando nao tiver
 * o nome, coloca o numero". A fonte do fallback ja foi corrigida
 * (criarContato, em recebimento.js, e escolherNome, em
 * importar-historico.js, so caem em SEM_IDENTIFICACAO quando nem o numero
 * existe — conversa so por @lid), mas isso so vale para contato CRIADO daqui
 * para frente. Quem ja ficou gravado com o texto antigo nao muda sozinho.
 *
 * Idempotente: so mexe em quem ainda esta com o texto exato de
 * SEM_IDENTIFICACAO e tem telefone para por no lugar. O numero continua
 * contando como nome provisorio (nomeEhProvisorio, em nomes.js, ja trata
 * nome === telefone como provisorio) — a proxima mensagem da pessoa, ou a
 * agenda do celular, ainda troca por um nome de verdade normalmente.
 */
export function migrarSemIdentificacaoParaNumero() {
  let trocados = 0;
  for (const contato of listar('contatos')) {
    if (contato.nome !== SEM_IDENTIFICACAO) continue;
    if (!contato.telefone) continue;
    atualizar('contatos', contato.id, { nome: contato.telefone });
    trocados += 1;
  }
  return trocados;
}
