import { api } from '../api.js';
import { gaveta } from '../componentes.js';
import { areaTexto, aviso, botao, campo, el, interruptor, limpar, selo } from '../ui.js';

/**
 * O resumo da conversa (servidor/ia/resumo-da-conversa.js): o cartao no alto da
 * aba de dados, logo abaixo do nome, para quem abre a conversa saber em dez
 * segundos quem e o cliente, o que ele busca e em que pe esta.
 *
 * O servidor escreve e atualiza sozinho quando a conversa sossega; aqui o
 * cartao so le, mostra e pede um novo na hora. O texto vem em campos com rotulo
 * (Quem e, O que busca...) e e desenhado como texto, nunca como marcacao.
 *
 * O cartao e refeito toda vez que o painel e redesenhado (salvar status, nome,
 * etc.), entao guarda a ultima resposta por conversa e a mostra na hora, ainda
 * que busque uma nova em seguida se ela ja passou de uns segundos.
 */

const VALE_O_GUARDADO_MS = 15 * 1000;
const guardado = new Map();

const quando = (iso) =>
  new Date(iso).toLocaleString('pt-BR', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit', timeZone: 'America/Sao_Paulo' });

const palavra = (n, um, varios) => (Number(n) === 1 ? um : varios);

export function cartaoDoResumo(contato) {
  const caixa = el('div', { class: 'painel-cartao painel-resumo' });
  let dados = null;
  let gerando = false;

  async function buscar() {
    try {
      const resposta = await api.get(`/api/contatos/${contato.id}/resumo-automatico`);
      guardado.set(contato.id, { em: Date.now(), dados: resposta });
      dados = resposta;
    } catch (erro) {
      dados = { erro: erro.message };
    }
    if (document.body.contains(caixa)) desenhar();
  }

  async function gerar() {
    gerando = true;
    desenhar();
    try {
      dados = await api.post(`/api/contatos/${contato.id}/resumo-automatico`, {});
      guardado.set(contato.id, { em: Date.now(), dados });
    } catch (erro) {
      aviso(erro.message, 'erro');
    } finally {
      gerando = false;
      if (document.body.contains(caixa)) desenhar();
    }
  }

  function ajustar() {
    let automatico = dados.config.automatico;
    const instrucoes = areaTexto(dados.config.instrucoes, {
      rows: 5,
      maxlength: 1000,
      placeholder: 'Ex.: destaque o benefício pedido e se o cliente já mandou laudo.',
    });
    gaveta({
      titulo: 'Resumo das conversas',
      descricao: 'O resumo é escrito sozinho quando uma conversa fica dez minutos parada. Vale para todas as conversas deste escritório. Ele só usa o que está na conversa e nunca escreve senha nem número de documento.',
      corpo: el('div', { class: 'pilha-g' }, [
        interruptor('Resumir sozinho as conversas que pararam', automatico, (ligado) => (automatico = ligado)),
        campo('O que mais o resumo deve destacar', instrucoes, 'Até 1.000 caracteres.'),
      ]),
      confirmar: 'Salvar',
      descartar: () => (instrucoes.value.trim() !== dados.config.instrucoes.trim() || automatico !== dados.config.automatico ? 'Você mudou o resumo e ainda não salvou.' : null),
      aoConfirmar: async () => {
        dados.config = await api.put('/api/resumo-das-conversas/config', { automatico, instrucoes: instrucoes.value });
        aviso('Salvo.', 'sucesso');
        desenhar();
      },
    });
  }

  function desenhar() {
    limpar(caixa);
    const resumo = dados?.resumo;

    const acoes = el('div', { class: 'painel-resumo-acoes' }, [
      dados?.podeGerar && !gerando
        ? botao('', { icone: 'atualizar', pequeno: true, titulo: resumo ? 'Atualizar o resumo agora' : 'Gerar o resumo agora', aoClicar: gerar })
        : null,
      dados?.config ? botao('', { icone: 'ajustes', pequeno: true, titulo: 'Ajustar o resumo das conversas', aoClicar: ajustar }) : null,
    ]);
    for (const b of acoes.querySelectorAll('button')) b.setAttribute('aria-label', b.title);

    caixa.append(
      el('div', { class: 'painel-resumo-topo' }, [
        el('span', { class: 'painel-resumo-titulo', texto: 'Resumo da conversa' }),
        resumo ? selo(resumo.usouIa ? 'IA' : 'Padrão', resumo.usouIa ? 'ia' : 'limpo') : null,
        acoes,
      ]),
    );

    if (gerando) {
      caixa.append(el('p', { class: 'painel-resumo-vazio', texto: 'Resumindo a conversa… pode levar alguns segundos.' }));
      return;
    }
    if (!dados) {
      caixa.append(el('p', { class: 'painel-resumo-vazio', texto: 'Carregando…' }));
      return;
    }
    if (dados.erro) {
      caixa.append(el('p', { class: 'painel-resumo-vazio', texto: `Não deu para carregar o resumo: ${dados.erro}` }));
      return;
    }
    if (!resumo) {
      caixa.append(
        el('p', {
          class: 'painel-resumo-vazio',
          texto: dados.podeGerar ? 'Ainda sem resumo. Ele sai sozinho quando a conversa ficar dez minutos parada, ou agora, pelo botão ao lado do título.' : 'Poucas mensagens ainda para resumir.',
        }),
      );
      return;
    }

    const linhas = resumo.campos?.length
      ? resumo.campos.map((c) => el('div', { class: 'painel-resumo-linha' }, [el('span', { class: 'painel-resumo-rotulo', texto: c.rotulo }), el('span', { texto: c.texto })]))
      : [el('p', { class: 'painel-resumo-livre', texto: resumo.texto })];
    caixa.append(el('div', { class: 'painel-resumo-corpo' }, linhas));

    const rodape = [`Atualizado em ${quando(resumo.geradoEm)}`];
    if (dados.novas > 0) rodape.push(`${dados.novas} ${palavra(dados.novas, 'mensagem nova', 'mensagens novas')} depois dele`);
    caixa.append(el('p', { class: 'painel-resumo-rodape', texto: rodape.join(' · ') }));
    if (!resumo.usouIa && resumo.avisoDaIa) caixa.append(el('p', { class: 'painel-resumo-rodape', texto: resumo.avisoDaIa }));
  }

  const antigo = guardado.get(contato.id);
  if (antigo) dados = antigo.dados;
  desenhar();
  if (!antigo || Date.now() - antigo.em > VALE_O_GUARDADO_MS) buscar();
  return caixa;
}
