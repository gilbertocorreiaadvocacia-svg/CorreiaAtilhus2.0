import { api } from '../api.js';
import { dica, seloSaude } from '../componentes.js';
import { estado, podeConfigurar } from '../estado.js';
import { botao, cartao, el, icone, numero, selo } from '../ui.js';

/**
 * Tela de Inicio: o painel de trabalho do dia, nao um cartao de boas-vindas.
 *
 * A ordem e a de quem senta na cadeira de manha: primeiro o que esta parado
 * esperando alguem, depois o que quebrou, depois o que falta configurar e por
 * ultimo como o funil vem se comportando.
 *
 * Nenhuma chamada pode derrubar a tela. Cada uma e resolvida em separado e o
 * bloco alimentado por uma resposta que falhou simplesmente nao aparece: uma
 * rota fora do ar tira um pedaco da tela, nunca a tela inteira.
 */
export async function paginaInicio() {
  const agora = new Date();
  const inicioDoPeriodo = new Date(agora.getTime() - 29 * 86400000);

  const respostas = await Promise.allSettled([
    api.get('/api/onboarding'),
    // Limite 1 porque daqui so interessa o campo total, nao a lista de conversas.
    api.get('/api/contatos', { aba: 'pendentes', limite: 1 }),
    api.get('/api/contatos', { aba: 'ia', limite: 1 }),
    api.get('/api/agendamentos', { estado: 'pendente' }),
    api.get('/api/tarefas/resumo'),
    api.get('/api/agentes'),
    api.get('/api/conexoes'),
    api.get('/api/dashboard', {
      de: diaLocal(inicioDoPeriodo),
      ate: diaLocal(agora),
      modo: 'evento',
      agrupamento: 'diario',
    }),
  ]);

  const [onboarding, pendentes, comIa, fila, tarefas, agentes, conexoes, painel] = respostas.map((resposta) =>
    resposta.status === 'fulfilled' ? resposta.value : null,
  );

  /* Sem saudacao e sem a data por extenso: eram cinquenta pixels no topo, toda
     manha, para dizer o que o relogio do Windows ja diz. */
  return el('div', {}, [
    blocoDoDia({ pendentes, comIa, fila, tarefas, hoje: diaLocal(agora) }),
    blocoAtencao({ fila, agentes, conexoes, painel }),
    onboarding ? el('div', { class: 'secao-painel' }, [primeirosPassos(onboarding)]) : null,
    blocoFunil(painel),
  ]);
}

/* ------------------------------------------------------------------ */
/* 1. O seu dia                                                        */
/* ------------------------------------------------------------------ */

/**
 * Os numeros do dia.
 *
 * A nota embaixo do numero e cara: sao quatro cartoes lado a lado, e cada linha
 * de nota empurra o resto da tela para baixo. Por isso ela so fica quando traz
 * um numero que o cartao ainda nao mostra. "ninguem assumiu essas conversas
 * ainda" embaixo de "Aguardando atendimento" era o rotulo escrito de novo.
 */
function blocoDoDia({ pendentes, comIa, fila, tarefas, hoje }) {
  const cartoes = [];

  if (pendentes) {
    cartoes.push(
      numeroDoDia({
        nomeIcone: 'conversas',
        rotulo: 'Aguardando atendimento',
        valor: pendentes.total,
        destino: '#/atendimento',
      }),
    );
  }

  if (comIa) {
    cartoes.push(
      numeroDoDia({
        nomeIcone: 'agentes',
        rotulo: 'Conversas com a IA',
        valor: comIa.total,
        destino: '#/atendimento',
      }),
    );
  }

  if (fila) {
    // O servidor ja agrupa a fila por dia. Ler o balde de hoje conta a fila
    // inteira, e nao apenas as 500 primeiras mensagens que a rota devolve.
    const doDia = (fila.dias || []).find((dia) => dia.dia === hoje);
    cartoes.push(
      numeroDoDia({
        nomeIcone: 'enviar',
        rotulo: 'Na fila de envio hoje',
        valor: doDia?.total || 0,
        nota: `${numero(fila.total || 0)} pendentes no total`,
        destino: '#/agendamentos',
      }),
    );
  }

  // A rota de tarefas pode nao estar no ar. Sem resposta o numero some, em vez
  // de virar um zero que ninguem sabe se e verdade.
  if (tarefas && typeof tarefas.vencidas === 'number') {
    cartoes.push(
      numeroDoDia({
        nomeIcone: 'relogio',
        rotulo: 'Tarefas vencidas',
        valor: tarefas.vencidas,
        nota: `${numero(tarefas.abertas || 0)} abertas no total`,
        destino: '#/tarefas',
      }),
    );
  }

  if (!cartoes.length) return null;

  return el('section', { class: 'secao-painel' }, [
    el('h2', { texto: 'O seu dia' }),
    el('div', { class: 'metricas' }, cartoes),
  ]);
}

/**
 * Numero clicavel. E uma ancora de verdade, e nao uma caixa com clique, para o
 * teclado alcancar o atalho e o botao do meio abrir em outra aba.
 */
function numeroDoDia({ nomeIcone, rotulo, valor, nota, destino }) {
  // O cartao e ancora, entao precisa da cor de texto no lugar da cor de link.
  // Isso agora esta na regra a.metrica, em web/css/tema.css, junto do realce
  // de mouse e de teclado que ja mora la.
  const caixa = el(
    'a',
    {
      class: 'metrica',
      href: destino,
    },
    [
      el('div', { class: 'metrica-topo' }, [icone(nomeIcone, 15), el('span', { class: 'nome', texto: rotulo })]),
      el('div', { class: 'valor', texto: numero(valor) }),
      nota ? el('div', { class: 'nota', texto: nota }) : null,
    ],
  );

  // O realce vive na folha de estilo, em a.metrica:hover e
  // a.metrica:focus-visible. Escrito aqui no mouseenter, quem navegava por
  // teclado passava pelo cartao sem realce nenhum.
  return caixa;
}

/* ------------------------------------------------------------------ */
/* 3. Precisa de atencao                                               */
/* ------------------------------------------------------------------ */

/**
 * Tons aceitos no circulo do item. A cor de cada um mora em .avatar.erro e
 * .avatar.alerta, no tema, e nao mais num par de valores escrito aqui.
 */
const TONS = ['erro', 'alerta'];

function blocoAtencao({ fila, agentes, conexoes, painel }) {
  const itens = [];

  const criticos = (fila?.dias || []).filter((dia) => dia.saude && dia.saude !== 'saudavel');
  if (criticos.length) {
    const pior = criticos.some((dia) => dia.saude === 'critico') ? 'critico' : 'risco';
    itens.push(
      itemAtencao({
        tom: pior === 'critico' ? 'erro' : 'alerta',
        titulo:
          criticos.length === 1
            ? 'Um dia concentrado na fila de envio'
            : `${criticos.length} dias concentrados na fila de envio`,
        descricao: `${criticos.slice(0, 4).map(diaCurto).join(', ')}.`,
        porque: 'Volume alto no mesmo dia pela mesma conexao e o caminho mais curto para bloqueio do numero.',
        marca: seloSaude(pior),
        rotulo: 'Abrir a fila',
        destino: '#/agendamentos',
      }),
    );
  }

  const mencaoQuebrada = (agentes || []).filter((agente) => (agente.mencoesInvalidas || []).length);
  if (mencaoQuebrada.length) {
    itens.push(
      itemAtencao({
        tom: 'erro',
        titulo:
          mencaoQuebrada.length === 1
            ? 'Um agente chama outro que nao existe'
            : `${mencaoQuebrada.length} agentes chamam outro que nao existe`,
        descricao: `${mencaoQuebrada
          .slice(0, 3)
          .map((agente) => agente.nome)
          .join(', ')}.`,
        porque: 'A transferencia escrita no prompt nao acontece e a conversa fica presa no agente atual.',
        marca: selo('mencao invalida', 'erro'),
        rotulo: 'Abrir os agentes',
        destino: '#/agentes',
      }),
    );
  }

  const foraDoAr = (conexoes || []).filter((conexao) => conexao.estado !== 'conectado');
  if (foraDoAr.length) {
    itens.push(
      itemAtencao({
        tom: 'erro',
        titulo:
          foraDoAr.length === 1
            ? 'Uma conexao de WhatsApp fora do ar'
            : `${foraDoAr.length} conexoes de WhatsApp fora do ar`,
        descricao: `${foraDoAr
          .slice(0, 3)
          .map((conexao) => conexao.nome)
          .join(', ')}.`,
        porque: 'Enquanto estiver assim, nada entra e nada sai por esse numero.',
        marca: selo(foraDoAr.length === 1 ? 'desconectada' : 'desconectadas', 'erro'),
        rotulo: 'Abrir as conexoes',
        destino: '#/conexoes',
      }),
    );
  }

  // O ajuste fica em Configuracoes, entao o aviso so aparece para quem pode
  // abrir aquela tela: mandar alguem para uma porta trancada nao ajuda ninguem.
  if (painel?.tiposSemStatus?.length && podeConfigurar()) {
    itens.push(
      itemAtencao({
        tom: 'alerta',
        titulo: 'O funil esta sem encaixe completo',
        descricao: `Nenhum status foi marcado como: ${painel.tiposSemStatus.join(', ')}.`,
        porque: 'Sem esse encaixe, o dashboard conta o funil errado.',
        marca: selo('configuracao', 'alerta'),
        rotulo: 'Abrir os status',
        destino: '#/configuracoes/status',
      }),
    );
  }

  if (!itens.length) return null;

  return el('section', { class: 'secao-painel' }, [
    el('h2', {}, [document.createTextNode('Precisa de atencao'), selo(String(itens.length), 'alerta')]),
    el('div', { class: 'lista-simples' }, itens),
  ]);
}

/**
 * Um item da lista de atencao.
 *
 * `descricao` e o estado: quais dias, quais agentes, quais conexoes. `porque` e
 * o motivo de aquilo ser um problema, que nao muda nunca e por isso vai para o
 * balao do titulo. O aviso continua inteiro na tela; o que saiu de baixo dele e
 * a aula que a equipe ja teve na primeira semana.
 */
function itemAtencao({ tom, titulo, porque, descricao, marca, rotulo, destino }) {
  const tomDoCirculo = TONS.includes(tom) ? tom : 'alerta';
  return el('div', { class: 'lista-item quebra' }, [
    el('div', { class: `avatar ${tomDoCirculo}` }, [icone('alerta', 16)]),
    el('div', { class: 'corpo' }, [
      el('div', { class: porque ? 'titulo linha' : 'titulo' }, [
        titulo,
        porque ? dica(porque, { assunto: 'o motivo' }) : null,
      ]),
      el('div', { class: 'desc', texto: descricao }),
    ]),
    marca || null,
    botao(rotulo, { pequeno: true, aoClicar: () => irPara(destino) }),
  ]);
}

/** "qua., 20/08 (42)". Meio-dia fixo evita o dia voltar um por causa do fuso. */
function diaCurto(dia) {
  const data = new Date(`${dia.dia}T12:00`);
  const rotulo = data.toLocaleDateString('pt-BR', { weekday: 'short', day: '2-digit', month: '2-digit' });
  return `${rotulo} (${numero(dia.total)})`;
}

/* ------------------------------------------------------------------ */
/* 4. Primeiros passos                                                 */
/* ------------------------------------------------------------------ */

/**
 * Checklist de configuracao. Enquanto falta passo ele fica aberto e ocupa
 * espaco de proposito. Quando termina, vira uma linha so, porque a tela de
 * Inicio precisa continuar util depois que o sistema ja esta configurado.
 */
function primeirosPassos(onboarding) {
  const passos = onboarding.passos || [];
  if (!passos.length) return null;

  const prontos = passos.filter((passo) => passo.pronto).length;
  const total = passos.length;
  const completo = prontos === total;

  const corpo = el('div', { id: 'primeiros-passos', class: 'mt-4' }, [
    completo
      ? null
      : el('div', { class: 'barra mb-3' }, [
          el('div', { estilo: { width: `${Math.round((prontos / total) * 100)}%` } }),
        ]),
    el('div', { class: 'lista-simples' }, passos.map(linhaDoPasso)),
  ]);

  let aberto = !completo;

  const seta = icone('voltar', 14);
  seta.classList.add('c-suave');

  // .cabecalho-recolhivel devolve o botao ao desenho de cabecalho de cartao:
  // sem moldura, sem fundo, largura cheia e texto a esquerda. Ela tambem
  // acerta a margem do titulo e da ajuda dentro dele. A regra deveria morar em
  // web/css/tema.css, junto de .cartao-titulo.
  const cabecalho = el(
    'button',
    {
      type: 'button',
      class: 'cabecalho-recolhivel',
      'aria-expanded': String(aberto),
      'aria-controls': 'primeiros-passos',
    },
    [
      el('div', { class: `avatar ${completo ? 'sucesso' : ''}`.trim() }, [icone(completo ? 'ok' : 'ajustes', 16)]),
      // Sem a linha de ajuda embaixo do titulo: ela explicava o mecanismo do
      // proprio checklist, e o selo "3 de 6" ao lado ja diz onde a configuracao
      // esta. O cabecalho fica com uma linha so, e a lista de passos sobe.
      el('div', { class: 'flexivel encolhe' }, [
        el('div', {
          class: 'cartao-titulo',
          texto: completo ? 'Configuracao concluida' : 'Primeiros passos',
        }),
      ]),
      selo(`${prontos} de ${total}`, completo ? 'sucesso' : 'ouro'),
      seta,
    ],
  );

  const pintar = () => {
    corpo.hidden = !aberto;
    corpo.style.display = aberto ? '' : 'none';
    // A volta da seta acompanha o aria-expanded pelo tema. Escrita aqui em
    // transform, ela era um segundo lugar dizendo a mesma coisa que o atributo
    // ja diz, e o atributo de estilo ainda vencia qualquer regra do tema.
    cabecalho.setAttribute('aria-expanded', String(aberto));
  };

  cabecalho.addEventListener('click', () => {
    aberto = !aberto;
    pintar();
  });
  pintar();

  return el('div', { class: 'cartao' }, [cabecalho, corpo]);
}

/**
 * Linha do checklist: o passo, a situacao e o botao que leva ao ajuste.
 *
 * O que cada passo pede fica no balao do titulo. Sao oito passos, e a linha de
 * descricao embaixo de cada um dobrava a altura do bloco justamente enquanto a
 * configuracao esta pela metade, que e quando o resto da tela mais precisa
 * caber junto.
 */
function linhaDoPasso(passo) {
  return el('div', { class: 'lista-item' }, [
    el('div', { class: `avatar ${passo.pronto ? 'sucesso' : 'neutro'}` }, [icone(passo.pronto ? 'ok' : 'mais', 16)]),
    el('div', { class: 'corpo' }, [
      el('div', { class: passo.descricao ? 'titulo linha' : 'titulo' }, [
        passo.titulo,
        passo.descricao ? dica(passo.descricao, { assunto: String(passo.titulo).toLowerCase() }) : null,
      ]),
    ]),
    passo.pronto
      ? selo('pronto', 'sucesso')
      : botao('Configurar', { pequeno: true, aoClicar: () => irPara(passo.link) }),
  ]);
}

/* ------------------------------------------------------------------ */
/* 5. Os ultimos 30 dias                                               */
/* ------------------------------------------------------------------ */

function blocoFunil(painel) {
  if (!painel?.cards) return null;

  const cards = painel.cards;
  const novas = cards.nova?.total || 0;
  const qualificados = cards.qualificado?.total || 0;
  const propostas = cards.proposta?.total || 0;
  const contratos = cards.sucesso?.total || 0;

  /* O denominador vem do servidor junto com o nome do que ele representa. Os
     cards contam a conversa que teve o evento no periodo, entao dividir pelas
     conversas nascidas no periodo passaria de 100% em qualquer dia de mutirao
     na fila antiga. */
  const base = painel.base ?? { total: novas, rotulo: 'novas do periodo' };

  return el('section', { class: 'secao-painel' }, [
    // De onde vem a conta e conceito, e conceito mora no balao do titulo. Fora
    // dele, era um paragrafo entre o titulo da secao e os quatro numeros que a
    // secao existe para mostrar.
    el('h2', { class: 'linha' }, [
      document.createTextNode('Os ultimos 30 dias'),

    ]),
    cartao(
      null,
      null,
      el('div', { class: 'metricas' }, [
        metrica('Novas conversas', novas, 'no periodo'),
        metrica('Qualificados', qualificados, `${percentual(qualificados, base.total)} das ${base.rotulo}`),
        metrica('Propostas', propostas, `${percentual(propostas, base.total)} das ${base.rotulo}`),
        metrica('Contratos', contratos, `${percentual(contratos, base.total)} das ${base.rotulo}`),
      ]),
      leituraDoFunil(base, contratos),
      el('div', { class: 'linha-botoes mt-4' }, [
        botao('Abrir o dashboard', {
          pequeno: true,
          icone: 'painel',
          aoClicar: () => irPara('#/dashboard'),
        }),
      ]),
    ),
  ]);
}

/**
 * Numero solto nao vira decisao. "4 contratos" nao diz nada sozinho, ja "4 de
 * cada 100 conversas" da a escala na hora. A base e a que o servidor usou nos
 * percentuais dos cards, para os dois numeros da mesma tela fecharem.
 */
function leituraDoFunil(base, contratos) {
  const caixa = el('div', { class: 'dica mt-4' });

  if (!base.total) {
    caixa.append(document.createTextNode('Nenhuma conversa se moveu nos ultimos 30 dias.'));
    return caixa;
  }

  const porCem = Math.round((contratos / base.total) * 100);
  const poucoDemais = contratos > 0 && porCem < 1;
  caixa.append(
    document.createTextNode(`De cada 100 ${base.rotulo}, `),
    el('strong', { texto: poucoDemais ? 'menos de 1' : numero(porCem) }),
    document.createTextNode(poucoDemais || porCem === 1 ? ' virou contrato.' : ' viraram contrato.'),
  );
  return caixa;
}

/* ------------------------------------------------------------------ */
/* Apoio                                                               */
/* ------------------------------------------------------------------ */

function metrica(rotulo, valor, nota) {
  return el('div', { class: 'metrica' }, [
    el('div', { class: 'valor', texto: numero(valor) }),
    el('div', { class: 'rotulo', texto: rotulo }),
    nota ? el('div', { class: 'nota', texto: nota }) : null,
  ]);
}

/** Percentual com a virgula do pt-BR, igual ao resto dos numeros da tela. */
function percentual(parte, total) {
  if (!total) return '0%';
  return `${numero(Number(((parte / total) * 100).toFixed(1)))}%`;
}

/** Data para AAAA-MM-DD pelos campos locais: toISOString viraria o dia a noite. */
function diaLocal(data) {
  const mes = String(data.getMonth() + 1).padStart(2, '0');
  const dia = String(data.getDate()).padStart(2, '0');
  return `${data.getFullYear()}-${mes}-${dia}`;
}

function irPara(destino) {
  location.hash = String(destino || '').replace('#', '');
}
