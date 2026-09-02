import { api } from '../api.js';
import { campoComDica, dica, gaveta } from '../componentes.js';
import { podeConfigurar, recarregar } from '../estado.js';
import {
  areaTexto,
  aviso,
  botao,
  campo,
  confirmar,
  el,
  entradaTexto,
  limpar,
  numero,
  selo,
  vazio,
} from '../ui.js';

/**
 * Base de conhecimento.
 *
 * Antes era um modal aberto de dentro da tela de Agentes, e por isso ninguem
 * enxergava o conjunto: nao dava para saber quantas bases existiam, o tamanho
 * de cada uma nem quem lia qual. Em tela propria a lista ja mostra o cruzamento
 * com os agentes, que e a pergunta de quem vai mexer no texto: se eu mudar isto
 * aqui, qual atendimento muda junto?
 */

/**
 * O que a base e e por que ela pode ser maior que o prompt. E conceito, entao
 * mora atras da dica ao lado do botao de criar, e nao num paragrafo fixo no
 * alto da tela.
 */
function balaoDaBase() {
  return el('div', {}, [
    el('div', { texto: 'O agente consulta a base so quando o assunto aparece na conversa, entao ela nao ocupa espaco no prompt e pode ser bem maior que ele.' }),
    el('div', { class: 'mt-2', texto: 'Quem le qual base se define na tela do agente, no bloco Base de conhecimento.' }),
  ]);
}

/* A regra de formatacao nao pode sumir, porque errar nela estraga a busca, mas
   tambem nao precisa de linha fixa numa gaveta de tres campos: vai no balao do
   rotulo. O motivo dela esta no balao do titulo da tela. */
const AJUDA_CONTEUDO = 'Separe cada assunto por uma linha em branco.';

export async function paginaConhecimento() {
  const container = el('div');

  async function desenhar() {
    // A lista fica no estado porque a coluna de configuracao do agente le do
    // mesmo lugar. Recarregar aqui deixa as duas telas com o mesmo dado.
    const [bases, agentes] = await Promise.all([recarregar('conhecimento'), api.get('/api/agentes')]);
    limpar(container);
    container.append(bases.length ? comBases(bases, agentes) : semBases());
  }

  /* ---------------- Estado vazio ---------------- */

  // Sem base nao ha dado disputando a atencao, entao e aqui que a explicacao
  // vale: as duas caixas viraram uma so, sem repetir a mesma frase duas vezes.
  function semBases() {
    return vazio(
      'Nenhuma base cadastrada',
      'A base guarda o que o escritorio ja responde de cor: quebra de objecao, requisito de beneficio, regra de honorarios. Comece por um assunto so, com as perguntas que a equipe mais responde no WhatsApp.',
      podeConfigurar()
        ? botao('Criar a primeira base', { tipo: 'principal', icone: 'mais', aoClicar: () => editarBase(null, desenhar) })
        : null,
    );
  }

  /* ---------------- Lista ---------------- */

  function comBases(bases, agentes) {
    const porBase = agentesPorBase(agentes);
    const corpo = el('tbody');
    for (const base of bases) corpo.append(linhaDaBase(base, porBase.get(base.id) || [], desenhar));

    return el('div', {}, [
      el('div', { class: 'linha-botoes mb-4' }, [
        podeConfigurar()
          ? botao('Nova base', { tipo: 'principal', icone: 'mais', aoClicar: () => editarBase(null, desenhar) })
          : null,
        dica(balaoDaBase(), { assunto: 'a base de conhecimento' }),
        el('div', { class: 'flexivel' }),
        el('span', { class: 'selo', texto: `${bases.length} bases` }),
      ]),
      // .cartao-tabela mora em web/css/tema.css: cartao que carrega tabela nao
      // leva respiro proprio, quem da o respiro e a celula.
      el('div', { class: 'cartao cartao-tabela' }, [
        el('div', { class: 'tabela-rolagem' }, [
          el('table', { class: 'tabela-densa' }, [
            el('thead', {}, [
              el('tr', {}, [
                el('th', { texto: 'Base' }),
                el('th', { texto: 'Tamanho' }),
                el('th', { texto: 'Agentes que usam' }),
                // A coluna de acoes nao tem titulo na tela, mas quem navega a
                // tabela por leitor de tela precisa de um nome para ela.
                el('th', {}, [el('span', { class: 'apenas-leitor', texto: 'Acoes' })]),
              ]),
            ]),
            corpo,
          ]),
        ]),
      ]),
    ]);
  }

  await desenhar();
  return container;
}

/* ------------------------------------------------------------------ */
/* Apoio                                                               */
/* ------------------------------------------------------------------ */

/** Inverte o vinculo: o agente aponta para as bases, a tela precisa do contrario. */
function agentesPorBase(agentes) {
  const mapa = new Map();
  for (const agente of agentes) {
    for (const id of agente.conhecimentoIds || []) {
      if (!mapa.has(id)) mapa.set(id, []);
      mapa.get(id).push(agente);
    }
  }
  return mapa;
}

function linhaDaBase(base, leitores, recarregarTela) {
  const tamanho = (base.conteudo || '').length;

  const usos = el('div', { class: 'linha-p quebra' });
  for (const agente of leitores) usos.append(selo(agente.nome, agente.ativo ? 'ouro' : ''));
  if (!leitores.length) {
    usos.append(el('span', { class: 't-sm c-fraco', texto: 'Nenhum agente le esta base' }));
  }

  return el('tr', {}, [
    el('td', {}, [
      el('div', { class: 'peso-600', texto: base.nome }),
      base.descricao ? el('div', { class: 't-sm c-suave mt-1', texto: base.descricao }) : null,
    ]),
    // .nao-quebra mora em web/css/tema.css, junto das utilitarias de texto.
    el('td', { class: 'nao-quebra', texto: `${numero(tamanho)} caracteres` }),
    el('td', {}, [usos]),
    el('td', {}, [
      // .fim mora em web/css/tema.css, junto das utilitarias de arranjo.
      el('div', { class: 'linha-botoes fim' }, [
        podeConfigurar() ? botao('Editar', { pequeno: true, aoClicar: () => editarBase(base, recarregarTela) }) : null,
        podeConfigurar()
          ? botao('Excluir', {
              pequeno: true,
              tipo: 'perigo',
              aoClicar: () =>
                confirmar('Excluir base?', `"${base.nome}" sera removida dos agentes que a usam.`, async () => {
                  await api.delete(`/api/conhecimento/${base.id}`);
                  aviso('Base excluida.', 'sucesso');
                  await recarregarTela();
                }, 'Excluir'),
            })
          : null,
      ]),
    ]),
  ]);
}

/**
 * Formulario em gaveta. O conteudo e o campo que importa e ele precisa de
 * altura: em janela centralizada, uma base de dez mil caracteres vira uma
 * fresta de texto com o rodape de acao colado embaixo.
 */
function editarBase(base, recarregarTela) {
  const nome = entradaTexto(base?.nome || '', { placeholder: 'Quebra de objecoes' });
  const descricao = entradaTexto(base?.descricao || '', { placeholder: 'Respostas para as objecoes da fase de proposta' });
  // .area-g mora em web/css/tema.css: altura de area de texto em passo fixo.
  const conteudo = areaTexto(base?.conteudo || '', { class: 'prompt area-g' });

  const contador = el('small', {});
  const contar = () => {
    contador.textContent = `${numero(conteudo.value.length)} caracteres`;
  };
  conteudo.addEventListener('input', contar);
  contar();

  const campoConteudo = campoComDica('Conteudo', conteudo, AJUDA_CONTEUDO);
  campoConteudo.append(contador);

  gaveta({
    titulo: base ? `Editar ${base.nome}` : 'Nova base de conhecimento',
    corpo: [
      // Nome e Descricao dispensam ajuda: o rotulo ja diz, e o exemplo esta no
      // placeholder de cada campo.
      campo('Nome', nome),
      campo('Descricao', descricao),
      campoConteudo,
    ],
    confirmar: 'Salvar',
    aoConfirmar: async () => {
      if (!nome.value.trim()) throw new Error('Escreva o nome da base.');
      const dados = { nome: nome.value.trim(), descricao: descricao.value.trim(), conteudo: conteudo.value };
      if (base) await api.patch(`/api/conhecimento/${base.id}`, dados);
      else await api.post('/api/conhecimento', dados);
      aviso('Base salva.', 'sucesso');
      await recarregarTela();
    },
  });
}
