import { api } from '../api.js';
import { cartaoComDica } from '../componentes.js';
import { estado, ouvir } from '../estado.js';
import { areaTexto, aviso, botao, campo, cartao, dataHora, el, entradaTexto, limpar, selecao } from '../ui.js';

/**
 * Simulador: um WhatsApp de mentira, do lado do lead. Serve para rodar o funil
 * inteiro, agente, mencao, follow-up, contrato, antes de existir chip, e
 * depois para testar cada mudanca de prompt sem gastar numero real.
 */
export async function paginaSimulador() {
  const container = el('div', { class: 'grade g2' });

  const conexao = selecao(
    estado.conexoes.map((c) => ({ valor: c.id, rotulo: `${c.nome} (${c.tipo})` })),
    estado.conexoes[0]?.id,
  );
  const numero = entradaTexto(localStorage.getItem('correiatendimentos:simulador-numero') || '32988112233');
  const nome = entradaTexto(localStorage.getItem('correiatendimentos:simulador-nome') || 'Maria Aparecida');
  const texto = areaTexto('', { placeholder: 'Escreva como se fosse o lead…' });

  // .conversa-simulada mora em web/css/tema.css: fora do painel de atendimento
  // a caixa nao tem pai em coluna, entao o flex de .mensagens nao vale e a
  // altura precisa ser dita.
  const conversa = el('div', { class: 'mensagens conversa-simulada' });
  let contatoId = null;

  async function carregar() {
    if (!contatoId) {
      limpar(conversa);
      conversa.append(el('div', { class: 'vazio', texto: 'Mande a primeira mensagem para comecar.' }));
      return;
    }
    const { mensagens } = await api.get(`/api/contatos/${contatoId}/mensagens`);
    limpar(conversa);
    for (const mensagem of mensagens) {
      if (mensagem.nota) {
        conversa.append(
          el('div', { class: 'balao nota' }, [
            el('div', { class: 'balao-autor', texto: `Nota interna · ${mensagem.autor?.nome || ''}` }),
            el('div', { texto: mensagem.conteudo }),
          ]),
        );
        continue;
      }
      // No simulador a visao e a do lead: o que ele manda fica a direita.
      const doLead = mensagem.direcao === 'entrada';
      conversa.append(
        el('div', { class: `balao ${doLead ? 'saida' : ''}`.trim() }, [
          !doLead ? el('div', { class: 'balao-autor', texto: mensagem.autor?.nome || 'Escritorio' }) : null,
          el('div', { texto: mensagem.conteudo || `[${mensagem.tipo}]` }),
          el('div', { class: 'balao-rodape', texto: dataHora(mensagem.criadoEm) }),
        ]),
      );
    }
    conversa.scrollTop = conversa.scrollHeight;
  }

  async function enviar(conteudo) {
    const valor = conteudo ?? texto.value.trim();
    if (!valor) return;
    localStorage.setItem('correiatendimentos:simulador-numero', numero.value);
    localStorage.setItem('correiatendimentos:simulador-nome', nome.value);
    try {
      const resposta = await api.post('/api/simulador/mensagem', {
        conexaoId: conexao.value,
        telefone: numero.value.trim(),
        nome: nome.value.trim(),
        conteudo: valor,
      });
      contatoId = resposta.contatoId;
      texto.value = '';
      await carregar();
      const agente = estado.agentes.find((a) => a.id);
      if (!resposta.reiniciado) {
        aviso('Mensagem entregue. O agente responde depois do delay configurado.', 'sucesso');
      }
    } catch (erro) {
      aviso(erro.message, 'erro');
    }
  }

  texto.addEventListener('keydown', (evento) => {
    if (evento.key === 'Enter' && !evento.shiftKey) {
      evento.preventDefault();
      enviar();
    }
  });

  ouvir('mensagem', (dados) => {
    if (dados.contatoId === contatoId) carregar();
  });

  const atalhos = el('div', { class: 'linha-botoes' }, [
    botao('/restart', { pequeno: true, titulo: 'Reinicia a conversa como se fosse um lead novo', aoClicar: () => enviar('/restart') }),
    botao('Oi, vi o anuncio', { pequeno: true, aoClicar: () => enviar('Oi, vi o anuncio no facebook') }),
    botao('Quero saber do BPC', { pequeno: true, aoClicar: () => enviar('Quero saber sobre o BPC LOAS') }),
    botao('Me afastei do trabalho', { pequeno: true, aoClicar: () => enviar('Me afastei do trabalho por doenca, o INSS negou') }),
    botao('Quanto custa?', { pequeno: true, aoClicar: () => enviar('E quanto custa? Tenho que pagar alguma coisa agora?') }),
  ]);

  container.append(
    el('div', {}, [
      // O que era o paragrafo de descricao e os quatro passos de "Como testar
      // direito" cabe atras do icone do titulo: e conceito e roteiro de uso,
      // lido uma vez e depois so empurrando a conversa para baixo da dobra. O
      // passo a passo inteiro esta no LEIA-ME, em "Como operar no dia a dia".
      cartaoComDica(
        {
          titulo: 'Quem esta escrevendo',
          conceito: [
            el('div', {
              texto:
                'O simulador entrega a mensagem pelo mesmo caminho do WhatsApp real: cria o contato, aplica os padroes da conexao, detecta origem e ativa o agente.',
            }),
            el('div', {
              class: 'mt-2',
              texto:
                'Para testar do inicio: /restart, palavra-chave na primeira mensagem, espere o delay do agente e confira status, etiqueta e variaveis no atendimento.',
            }),
          ],
          respiro: false,
        },
        campo('Conexao', conexao),
        el('div', { class: 'grade g2' }, [campo('Nome do lead', nome), campo('WhatsApp', numero)]),
        el('div', { class: 'campo' }, [el('span', { texto: 'Atalhos' }), atalhos]),
        campo('Mensagem', texto),
        el('div', { class: 'linha-botoes' }, [
          botao('Enviar como lead', { tipo: 'principal', icone: 'enviar', aoClicar: () => enviar() }),
          contatoId ? botao('Abrir no atendimento', { aoClicar: () => (location.hash = `#/atendimento/${contatoId}`) }) : null,
        ]),
      ),
    ]),
    el('div', {}, [cartao('Conversa (visao do lead)', null, conversa)]),
  );

  await carregar();
  return container;
}
