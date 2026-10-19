import { api } from '../api.js';
import { cartaoComDica, gaveta } from '../componentes.js';
import { podeConfigurar } from '../estado.js';
import { aviso, botao, campo, confirmar, el, entradaTexto, limpar, selecao } from '../ui.js';

/**
 * Testar roteamento.
 *
 * Pedido do escritório em 19/10/2026: testar se, ao falar de um benefício,
 * a conversa vai para o agente certo. Cada caso é uma frase e o agente que
 * deveria ficar com ela; "Rodar todos" manda cada frase para o agente de
 * entrada da área (a Triagem) por uma conversa de teste de verdade — o
 * mesmo caminho do Chat de teste — e confere quem ficou com ela no final.
 *
 * O resultado da última rodada fica só nesta tela (não é salvo): mostra
 * acerto/erro por caso, com um link para abrir a conversa de teste em
 * Atendimento e ler o que o agente respondeu, se algo deu errado.
 */
export async function paginaTestesDeRoteamento() {
  const container = el('div');
  /** casoId -> resultado da ultima rodada, so nesta tela (nao persiste). */
  const resultados = new Map();
  let agentes = [];

  async function desenhar() {
    const [casos, listaDeAgentes] = await Promise.all([api.get('/api/testes-de-roteamento'), api.get('/api/agentes')]);
    agentes = listaDeAgentes;
    limpar(container);

    const lista = el('div', { class: 'lista-simples' });
    for (const caso of casos) {
      const resultado = resultados.get(caso.id);
      lista.append(
        el('div', { class: 'lista-item' }, [
          el('div', { class: 'corpo' }, [
            el('div', { class: 'titulo', texto: caso.frase }),
            el('div', { class: 'desc', texto: `Esperado: ${caso.agenteEsperado || '(agente não existe mais)'}` }),
            resultado ? linhaDoResultado(resultado) : null,
          ]),
          resultado?.contatoId ? botao('Ver conversa', { pequeno: true, icone: 'abrir', aoClicar: () => (location.hash = `#/atendimento/${resultado.contatoId}`) }) : null,
          podeConfigurar() ? botao('Editar', { pequeno: true, aoClicar: () => editarCaso(caso, agentes, desenhar) }) : null,
          podeConfigurar()
            ? botao('Excluir', {
                pequeno: true,
                tipo: 'perigo',
                aoClicar: () =>
                  confirmar('Excluir caso de teste?', `"${caso.frase}" sai da bateria.`, async () => {
                    await api.delete(`/api/testes-de-roteamento/${caso.id}`);
                    resultados.delete(caso.id);
                    aviso('Caso excluído.', 'sucesso');
                    await desenhar();
                  }, 'Excluir'),
              })
            : null,
        ]),
      );
    }
    if (!casos.length) {
      lista.append(
        el('div', { class: 'vazio' }, [
          el('strong', { texto: 'Nenhum caso de teste' }),
          el('div', { texto: 'Acrescente uma frase e o agente que ela deveria alcançar, para testar se o roteamento por benefício está funcionando.' }),
        ]),
      );
    }

    const podeRodar = podeConfigurar() && casos.length > 0;
    container.append(
      cartaoComDica(
        { titulo: 'Testar roteamento', conceito: balaoDeAjuda() },
        lista,
        podeConfigurar()
          ? el('div', { class: 'linha-botoes mt-3' }, [
              botao('Novo caso', { pequeno: true, icone: 'mais', aoClicar: () => editarCaso(null, agentes, desenhar) }),
              botao('Rodar todos', {
                pequeno: true,
                icone: 'atualizar',
                desabilitado: !podeRodar,
                aoClicar: async (evento) => rodarTodos(evento.currentTarget, resultados, desenhar),
              }),
            ])
          : null,
      ),
    );
  }

  await desenhar();
  return container;
}

/* ------------------------------------------------------------------ */
/* Apoio                                                               */
/* ------------------------------------------------------------------ */

function balaoDeAjuda() {
  return el('div', {}, [
    el('div', {
      texto:
        'Cada caso manda a frase para o agente de entrada da área (a Triagem), como um lead de verdade escrevendo pela primeira vez — e confere se a conversa termina com o agente esperado.',
    }),
    el('div', { class: 'mt-2', texto: 'Cada rodada cria uma conversa de teste nova (visível em Atendimento, como as do Chat de teste) — nada é enviado para cliente nenhum.' }),
  ]);
}

function linhaDoResultado(resultado) {
  if (resultado.erro) {
    return el('div', { class: 'desc', estilo: { color: 'var(--erro)' }, texto: `Erro: ${resultado.erro}` });
  }
  return el('div', {
    class: 'desc',
    estilo: { color: resultado.passou ? 'var(--sucesso)' : 'var(--erro)' },
    texto: resultado.passou ? `✓ Foi para ${resultado.agenteObtido}` : `✗ Foi para ${resultado.agenteObtido || '(ninguém)'}`,
  });
}

async function rodarTodos(botaoClicado, resultados, recarregarTela) {
  if (botaoClicado) botaoClicado.disabled = true;
  aviso('Rodando a bateria. Cada caso espera a resposta de verdade do agente, isso pode levar um tempo.', '');
  try {
    const { resultados: lista } = await api.post('/api/testes-de-roteamento/rodar', {});
    resultados.clear();
    for (const resultado of lista) resultados.set(resultado.casoId, resultado);
    const acertos = lista.filter((r) => r.passou).length;
    aviso(`${acertos} de ${lista.length} foram para o agente certo.`, acertos === lista.length ? 'sucesso' : '');
    await recarregarTela();
  } catch (erro) {
    aviso(erro.message, 'erro');
  } finally {
    if (botaoClicado) botaoClicado.disabled = false;
  }
}

function editarCaso(caso, agentes, recarregarTela) {
  const frase = entradaTexto(caso?.frase || '', { placeholder: 'Minha filha nasceu semana passada, tenho direito a algum benefício?' });
  const agenteEsperado = selecao(
    agentes.map((a) => ({ valor: a.id, rotulo: a.nome })),
    caso?.agenteEsperadoId || agentes[0]?.id || '',
  );

  gaveta({
    titulo: caso ? 'Editar caso de teste' : 'Novo caso de teste',
    corpo: [campo('Frase de teste', frase), campo('Agente esperado', agenteEsperado)],
    confirmar: 'Salvar',
    aoConfirmar: async () => {
      if (!frase.value.trim()) throw new Error('Escreva a frase de teste.');
      const dados = { frase: frase.value.trim(), agenteEsperadoId: agenteEsperado.value };
      if (caso) await api.patch(`/api/testes-de-roteamento/${caso.id}`, dados);
      else await api.post('/api/testes-de-roteamento', dados);
      aviso('Caso salvo.', 'sucesso');
      await recarregarTela();
    },
  });
}
