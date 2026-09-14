import { el } from '../ui.js';
import { paginaAgentes } from './agentes.js';
import { paginaConhecimento } from './conhecimento.js';
import { paginaSimulador } from './simulador.js';

/**
 * O modulo de Agentes: tudo o que diz respeito aos agentes num lugar so.
 *
 * A base de conhecimento e o Chat de teste eram itens soltos do menu, e quem
 * afinava um agente pulava entre tres telas sem perceber que eram a mesma
 * tarefa: escrever o prompt, dar o que ele consulta, conversar com ele para
 * ver se ficou bom. Agora sao tres abas do mesmo modulo.
 *
 * As rotas antigas (#/conhecimento, #/simulador) continuam valendo: link salvo,
 * botao de outra tela e notificacao abrem a aba certa.
 */
export const VISOES_DE_AGENTES = [
  { rota: 'agentes', rotulo: 'Agentes', montar: paginaAgentes },
  { rota: 'conhecimento', rotulo: 'Base de conhecimento', montar: paginaConhecimento },
  { rota: 'simulador', rotulo: 'Chat de teste', montar: paginaSimulador },
];

export function moduloAgentes(rota) {
  return async (opcoes) => {
    const visao = VISOES_DE_AGENTES.find((v) => v.rota === rota) || VISOES_DE_AGENTES[0];
    const conteudo = await visao.montar(opcoes);

    const abas = el(
      'nav',
      { class: 'modulo-abas', 'aria-label': 'Módulo de agentes' },
      VISOES_DE_AGENTES.map((v) =>
        el('a', {
          href: `#/${v.rota}`,
          class: v.rota === visao.rota ? 'modulo-aba ativa' : 'modulo-aba',
          'aria-current': v.rota === visao.rota ? 'page' : null,
          texto: v.rotulo,
        }),
      ),
    );

    /* A lista de agentes ocupa a altura inteira; as outras duas rolam como pagina. */
    return el('div', { class: visao.rota === 'agentes' ? 'modulo-agentes cheio' : 'modulo-agentes' }, [abas, conteudo]);
  };
}
