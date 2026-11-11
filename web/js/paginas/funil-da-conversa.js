import { api } from '../api.js';
import { TIPOS_DE_PERDA, estado } from '../estado.js';
import { el, icone, limpar, plural, secaoRecolhivel } from '../ui.js';

/**
 * O funil da conversa, na lateral, logo abaixo do resumo.
 *
 * Pedido do escritorio em 10/11/2026: "onde tem as informacoes dos clientes,
 * abaixo do resumo, quero que tenha esse funil, a etapa do funil [...] e
 * conforme o agente vai atendendo, ele vai automaticamente preenchendo".
 *
 * A ESCADA E O KANBAN DE HOJE, e nao uma lista escrita aqui — decisao do
 * escritorio na mesma conversa, "as colunas do meu Kanban de hoje". Ela sai de
 * `estado.status`, na ordem em que as colunas estao no quadro: renomear,
 * criar, apagar ou reordenar coluna muda este cartao junto, sem segunda lista
 * para alguem esquecer de atualizar.
 *
 * E ninguem precisa preencher nada: as datas vem dos logs de troca de status
 * que o sistema ja gravava (servidor/nucleo/funil-da-conversa.js). O agente
 * atendendo e movendo a conversa de coluna E o preenchimento.
 *
 * So le. Mudar de coluna continua sendo no seletor de Status, tres linhas
 * abaixo neste mesmo painel, e no arrastar do Kanban: dois controles gravando
 * o mesmo campo na mesma tela e um convite a clique errado — aqui o degrau nao
 * e botao.
 */

/* Mesma politica do resumo: o cartao e refeito a cada redesenho do painel
   (salvar status, nome, etiqueta), entao a ultima resposta fica guardada por
   conversa e aparece na hora, com uma busca nova por tras se ja envelheceu. */
const VALE_O_GUARDADO_MS = 15 * 1000;
const guardado = new Map();

const dia = (iso) => (iso ? new Date(iso).toLocaleDateString('pt-BR', { day: '2-digit', month: '2-digit', year: '2-digit' }) : '');

const diaHora = (iso) =>
  iso ? new Date(iso).toLocaleString('pt-BR', { day: '2-digit', month: '2-digit', year: '2-digit', hour: '2-digit', minute: '2-digit' }) : '';

/**
 * Quanto tempo faz, em palavra curta: "hoje", "há 3 dias", "há 2 meses".
 *
 * daquiA() do atendimento.js responde o futuro ("em 3 dias") e quando() do
 * ui.js devolve a data seca. O que esta lateral precisa dizer e ha quanto
 * tempo a conversa esta parada neste degrau — e e isso que faz alguem
 * desencalhar um lead.
 */
function desdeQue(iso) {
  if (!iso) return '';
  const passado = Date.now() - new Date(iso).getTime();
  if (Number.isNaN(passado) || passado < 0) return '';
  const dias = Math.floor(passado / 86400000);
  if (dias < 1) return 'hoje';
  if (dias === 1) return 'ontem';
  if (dias < 30) return `há ${dias} dias`;
  const meses = Math.round(dias / 30);
  return `há ${meses} ${meses === 1 ? 'mês' : 'meses'}`;
}

export function cartaoDoFunil(contato) {
  const caixa = el('div', { class: 'painel-cartao painel-funil' });
  let dados = null;

  async function buscar() {
    try {
      const resposta = await api.get(`/api/contatos/${contato.id}/funil`);
      guardado.set(contato.id, { em: Date.now(), dados: resposta });
      dados = resposta;
    } catch (erro) {
      dados = { erro: erro.message };
    }
    if (document.body.contains(caixa)) desenhar();
  }

  /*
   * Um degrau da escada.
   *
   * Tres estados, e a diferenca entre eles tem que aparecer sem depender de
   * cor (quem le em tela ruim, ou com daltonismo, nao enxerga a cor da
   * coluna): a marca muda de forma (circulo cheio, anel, circulo vazio) e o
   * aria-label diz em palavras em que pe cada etapa esta.
   */
  function degrau(status, { estadoDoDegrau, em, vezes }) {
    const rotulos = {
      atual: 'etapa de agora',
      feita: 'etapa já passada',
      futura: 'etapa que ainda não aconteceu',
    };
    const detalhe = [];
    if (estadoDoDegrau === 'atual') {
      const faz = desdeQue(em);
      detalhe.push(faz ? `desde ${dia(em)} · ${faz}` : 'coluna de agora');
    } else if (em) {
      detalhe.push(dia(em));
    }
    /* Voltou para a mesma coluna mais de uma vez (objecao respondida, assinatura
       que travou): dizer "2x" explica a data que nao e a da estreia. */
    if (vezes > 1) detalhe.push(`${vezes}x`);

    return el(
      'li',
      {
        class: `funil-degrau funil-${estadoDoDegrau}`,
        'aria-label': `${status.nome}: ${rotulos[estadoDoDegrau]}${detalhe.length ? `, ${detalhe.join(', ')}` : ''}`,
      },
      [
        /* `estilo`, e nao `style`: e a chave que el() entende, e a unica que
           grava variavel de tema (aplicarEstilo, ui.js). A cor da coluna entra
           como variavel para o CSS decidir onde usa-la — preenchimento no
           degrau feito, anel no de agora. */
        el('span', { class: 'funil-marca', estilo: status.cor ? { '--cor-degrau': status.cor } : {}, 'aria-hidden': 'true' }),
        el('span', { class: 'funil-nome', texto: status.nome }),
        detalhe.length ? el('span', { class: 'funil-quando', texto: detalhe.join(' · ') }) : null,
      ],
    );
  }

  function desenhar() {
    limpar(caixa);
    caixa.append(
      el('div', { class: 'painel-funil-topo' }, [el('span', { class: 'painel-resumo-titulo', texto: 'Etapa do funil' })]),
    );

    if (!dados) {
      caixa.append(el('p', { class: 'painel-resumo-vazio', texto: 'Carregando…' }));
      return;
    }
    if (dados.erro) {
      caixa.append(el('p', { class: 'painel-resumo-vazio', texto: `Não deu para carregar o funil: ${dados.erro}` }));
      return;
    }

    const etapas = dados.etapas || {};
    const atualId = dados.statusId || null;
    const statusAtual = atualId ? estado.status.find((s) => s.id === atualId) : null;

    /*
     * A escada e so a parte ABERTA do funil, na ordem do quadro. As colunas de
     * perda (Desqualificado, Proposta recusada, Desistencia) nao sao degraus:
     * no Kanban elas vivem na aba Encerrado, e enfileira-las entre "Preparar
     * kit" e "Contrato fechado" diria que o caminho normal passa por elas.
     * Elas entram embaixo, e so quando esta conversa tem a ver com elas.
     */
    const escada = estado.status.filter((s) => !TIPOS_DE_PERDA.includes(s.tipo));
    const indiceAtual = escada.findIndex((s) => s.id === atualId);

    const lista = el('ol', { class: 'funil-escada' });
    escada.forEach((status, i) => {
      const etapa = etapas[status.id];
      /* Degrau antes da coluna de agora conta como feito mesmo sem log: a
         conversa passou por ali para chegar onde esta, e conversa antiga nao
         tem a troca gravada. Depois dela, so acende o que tem data — voltar
         atras no funil acontece, e o degrau da frente ja visitado continua
         marcado. */
      const estadoDoDegrau =
        status.id === atualId ? 'atual' : etapa || (indiceAtual >= 0 && i < indiceAtual) ? 'feita' : 'futura';
      lista.append(
        degrau(status, {
          estadoDoDegrau,
          em: status.id === atualId ? dados.atualDesde : etapa?.ultimaEm || null,
          vezes: etapa?.vezes || 0,
        }),
      );
    });
    caixa.append(lista);

    /*
     * O fim de linha: a coluna de perda em que a conversa esta agora, ou as
     * que ela ja passou e saiu. Separado da escada e com a data do mesmo jeito
     * — e exatamente o "Desqualificado, ha 76 dias" que o escritorio mostrou.
     */
    const perdas = estado.status
      .filter((s) => TIPOS_DE_PERDA.includes(s.tipo))
      .filter((s) => s.id === atualId || etapas[s.id]);
    if (perdas.length) {
      const fim = el('ul', { class: 'funil-escada funil-encerradas' });
      for (const status of perdas) {
        fim.append(
          degrau(status, {
            estadoDoDegrau: status.id === atualId ? 'atual' : 'feita',
            em: status.id === atualId ? dados.atualDesde : etapas[status.id]?.ultimaEm || null,
            vezes: etapas[status.id]?.vezes || 0,
          }),
        );
      }
      caixa.append(fim);
    }

    if (!atualId) {
      caixa.append(el('p', { class: 'painel-resumo-vazio', texto: 'Esta conversa ainda não está em nenhuma coluna do funil.' }));
    } else if (!statusAtual) {
      /* Status apagado depois de a conversa entrar nele (unificacao de colunas
         que nao reapontou esta conversa): dizer isso e melhor que uma escada
         sem nenhum degrau aceso. */
      caixa.append(el('p', { class: 'painel-resumo-vazio', texto: 'A coluna desta conversa não existe mais no funil.' }));
    }

    /*
     * O historico, fechado por padrao: a escada acima ja responde "em que pe
     * esta", que e a pergunta de quem abre a conversa. Quem precisa do caminho
     * inteiro abre, e a preferencia fica neste navegador — mesmo mecanismo das
     * secoes de Etiquetas, Departamento e Origem logo abaixo.
     */
    const passos = dados.historico || [];
    if (passos.length) {
      caixa.append(
        secaoRecolhivel(
          {
            chave: 'painelFunilHistorico',
            aberto: false,
            titulo: 'Histórico do funil',
            resumo: el('span', { class: 'c-suave t-sm', texto: plural(passos.length, 'mudança de coluna', 'mudanças de coluna') }),
          },
          el(
            'ol',
            { class: 'funil-historico' },
            /* Do mais recente para o mais antigo: a ultima mudanca e a que
               explica a conversa de agora. O servidor manda em ordem
               cronologica, que e a ordem natural do dado. */
            [...passos].reverse().map((passo) =>
              el('li', { class: 'funil-historico-item' }, [
                el('span', { class: 'funil-historico-quando', texto: diaHora(passo.em) }),
                el('span', { class: 'funil-historico-corpo' }, [
                  el('span', { class: 'funil-historico-nome', texto: passo.nome }),
                  passo.autor?.nome ? el('span', { class: 'funil-historico-autor', texto: `por ${passo.autor.nome}` }) : null,
                ]),
              ]),
            ),
          ),
        ),
      );
    } else if (atualId) {
      caixa.append(
        el('p', { class: 'painel-funil-nota' }, [
          icone('info', 12),
          el('span', { texto: 'Sem histórico gravado: a conversa já estava nesta coluna antes de o sistema registrar as mudanças.' }),
        ]),
      );
    }
  }

  const antigo = guardado.get(contato.id);
  if (antigo) dados = antigo.dados;
  desenhar();
  if (!antigo || Date.now() - antigo.em > VALE_O_GUARDADO_MS) buscar();
  return caixa;
}
