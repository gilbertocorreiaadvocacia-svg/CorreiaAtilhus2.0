import { api } from '../api.js';
import { cartaoComDica, gaveta, previaDaMidia } from '../componentes.js';
import { podeConfigurar } from '../estado.js';
import {
  aviso,
  botao,
  campo,
  cartao,
  confirmar,
  el,
  entradaTexto,
  limpar,
  modal,
  selecao,
} from '../ui.js';

/**
 * Vozes.
 *
 * Duas listas na mesma tela: as vozes do escritorio, que sao um nome e uma
 * velocidade por cima de uma voz base, e o catalogo do provedor, que serve
 * para ouvir antes de escolher. O botao de ouvir esta nas duas porque decidir
 * voz lendo descricao nao funciona, so ouvindo lado a lado.
 */
export async function paginaVozes() {
  const container = el('div');

  async function desenhar() {
    const { vozes, base, disponivel } = await api.get('/api/vozes');
    limpar(container);

    const lista = el('div', { class: 'lista-simples' });
    for (const voz of vozes) {
      const original = base.find((b) => b.id === voz.vozBase);
      lista.append(
        el('div', { class: 'lista-item' }, [
          el('div', { class: 'corpo' }, [
            el('div', { class: 'titulo', texto: voz.nome }),
            el('div', { class: 'desc', texto: `${original?.nome || voz.vozBase}, velocidade ${voz.velocidade || 1}x${voz.descricao ? `. ${voz.descricao}` : ''}` }),
          ]),
          botao('Ouvir', { pequeno: true, desabilitado: !disponivel, aoClicar: () => ouvirVoz(voz.id) }),
          podeConfigurar() ? botao('Editar', { pequeno: true, aoClicar: () => editarVoz(voz, base, desenhar) }) : null,
          podeConfigurar()
            ? botao('Excluir', {
                pequeno: true,
                tipo: 'perigo',
                aoClicar: () =>
                  confirmar('Excluir voz?', `"${voz.nome}" some dos agentes que a usam.`, async () => {
                    await api.delete(`/api/vozes/${voz.id}`);
                    aviso('Voz excluida.', 'sucesso');
                    await desenhar();
                  }, 'Excluir'),
              })
            : null,
        ]),
      );
    }
    if (!vozes.length) {
      lista.append(
        el('div', { class: 'vazio' }, [
          el('strong', { texto: 'Nenhuma voz do escritorio' }),
          el('div', { texto: 'Escolha uma voz do catalogo abaixo, de um nome a ela e ajuste a velocidade. Depois e so vincular no agente.' }),
        ]),
      );
    }

    const catalogo = el('div', { class: 'lista-simples' });
    for (const voz of base) {
      catalogo.append(
        el('div', { class: 'lista-item' }, [
          el('div', { class: 'corpo' }, [
            el('div', { class: 'titulo', texto: voz.nome }),
            el('div', { class: 'desc', texto: voz.descricao }),
          ]),
          botao('Ouvir', { pequeno: true, desabilitado: !disponivel, aoClicar: () => ouvirVoz(voz.id) }),
        ]),
      );
    }

    // O alerta de chave faltando e estado, entao continua na tela. Quando a
    // chave existe nao ha nada a avisar: o que sobrava era conceito e custo, e
    // isso foi para a dica do titulo. O filter tira o nulo antes do append,
    // que transformaria null no texto "null" dentro da pagina.
    container.append(
      ...[
        disponivel ? null : semChave(),
        cartaoComDica(
          { titulo: 'Vozes do escritorio', conceito: balaoDoAudio(), respiro: false },
          lista,
          podeConfigurar()
            ? el('div', { class: 'mt-3' }, [
                botao('Nova voz', { pequeno: true, icone: 'mais', aoClicar: () => editarVoz(null, base, desenhar) }),
              ])
            : null,
        ),
        cartao('Vozes disponiveis', null, catalogo),
      ].filter(Boolean),
    );
  }

  await desenhar();
  return container;
}

/* ------------------------------------------------------------------ */
/* Apoio                                                               */
/* ------------------------------------------------------------------ */

/** Quando usar audio e quanto ele custa. Conceito: vale uma leitura, nao mil. */
function balaoDoAudio() {
  return el('div', {}, [
    el('div', { texto: 'Audio funciona como excecao, e nao como padrao de resposta. Use em boas-vindas, quebra de objecao e momentos decisivos.' }),
    el('div', { class: 'mt-2', texto: 'Um minuto de audio gerado custa cerca de 120 creditos, contra 9 de uma resposta em texto.' }),
    el('div', { class: 'mt-2', texto: 'Cada voz daqui e um nome e uma velocidade por cima de uma voz base. Depois e so escolher a voz no agente.' }),
  ]);
}

/**
 * Sem chave da OpenAI nao ha sintese nem transcricao, entao a tela abre
 * dizendo isso e ja leva para o lugar onde a chave e cadastrada. Antes as duas
 * coisas moravam na mesma tela de Configuracoes e bastava trocar de aba.
 */
function semChave() {
  return el('div', { class: 'alerta-caixa mb-4' }, [
    el('div', { texto: 'Sem a chave da OpenAI em Integracoes, o sistema nao gera audio nem transcreve o que o cliente manda.' }),
    el('div', { class: 'linha-botoes mt-2' }, [
      botao('Abrir Integracoes', { pequeno: true, icone: 'abrir', aoClicar: () => (location.hash = '#/integracoes') }),
    ]),
  ]);
}

async function ouvirVoz(vozId) {
  try {
    const midia = await api.post('/api/vozes/testar', { vozId });
    modal({ titulo: 'Previa da voz', corpo: el('div', {}, [previaDaMidia(midia)]) });
  } catch (erro) {
    aviso(erro.message, 'erro');
  }
}

function editarVoz(voz, base, recarregarTela) {
  const nome = entradaTexto(voz?.nome || '', { placeholder: 'Voz da triagem' });
  const descricao = entradaTexto(voz?.descricao || '');
  const vozBase = selecao(base.map((b) => ({ valor: b.id, rotulo: `${b.nome}, ${b.descricao}` })), voz?.vozBase || 'nova');
  const velocidade = selecao(
    [
      { valor: 0.9, rotulo: 'Mais devagar (0,9x), boa para idoso' },
      { valor: 1, rotulo: 'Normal (1x)' },
      { valor: 1.1, rotulo: 'Mais rapida (1,1x)' },
    ],
    voz?.velocidade || 1,
  );

  gaveta({
    titulo: voz ? `Editar ${voz.nome}` : 'Nova voz',
    corpo: [
      campo('Nome', nome),
      campo('Voz base', vozBase),
      // O rotulo da opcao ja diz para quem serve cada velocidade
      // ("Mais devagar (0,9x), boa para idoso"), entao o campo dispensa ajuda.
      campo('Velocidade', velocidade),
      campo('Descricao', descricao),
    ],
    confirmar: 'Salvar',
    aoConfirmar: async () => {
      if (!nome.value.trim()) throw new Error('De um nome a voz.');
      const dados = {
        nome: nome.value.trim(),
        descricao: descricao.value,
        vozBase: vozBase.value,
        velocidade: Number(velocidade.value),
      };
      if (voz) await api.patch(`/api/vozes/${voz.id}`, dados);
      else await api.post('/api/vozes', dados);
      aviso('Voz salva.', 'sucesso');
      await recarregarTela();
    },
  });
}
