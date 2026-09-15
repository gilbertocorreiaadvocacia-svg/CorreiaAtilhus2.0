import { api } from '../api.js';
import { estado, ouvir, podeConfigurar, recarregar } from '../estado.js';
import { areaTexto, avatar, aviso, botao, dataHora, el, limpar, selecao, vazio } from '../ui.js';

/**
 * Chat de teste: voce faz o papel do cliente e conversa com um agente.
 *
 * A mensagem entra pelo MESMO caminho do WhatsApp de verdade — cria o contato,
 * aplica os padroes da conexao e chama o agente — mas por uma conexao de
 * simulador, cujo driver nao envia nada: as respostas ficam so no sistema. O
 * servidor recusa as outras conexoes: por um numero real, a resposta do agente
 * iria para o WhatsApp do numero inventado aqui.
 *
 * A tela e so o chat. Escolher o agente em Agentes e clicar em Testar no chat
 * abre a conversa com ele, sem formulario no caminho: nome e WhatsApp do
 * "cliente" eram campos que ninguem precisava preencher para testar, e a
 * conexao de simulador nasce sozinha na primeira vez. Cada agente guarda a sua
 * conversa de teste, entao trocar de agente nao mistura as duas.
 *
 * O que continua, e por que:
 *
 *   "digitando" com contagem — o agente espera o prazo dele antes de
 *     responder (15 s por padrao). Sem sinal, esse silencio parecia defeito.
 *   "Responder agora" — pula a espera quando o que se quer e ler a resposta.
 *   frases prontas — testar a triagem sem digitar o caso inteiro.
 */

const PREFIXO = 'correiatendimentos:chat-teste-';

function lembrar(nome, valor) {
  try {
    localStorage.setItem(PREFIXO + nome, valor ?? '');
  } catch {
    /* Navegador sem armazenamento: a tela funciona, so nao lembra. */
  }
}

function lembrado(nome, padrao = '') {
  try {
    return localStorage.getItem(PREFIXO + nome) ?? padrao;
  } catch {
    return padrao;
  }
}

/* Frases de cliente de verdade, para testar sem digitar. Cada uma exercita
   uma parte diferente do atendimento: origem, palavra-chave, objecao,
   transferencia. */
const FRASES = [
  ['Vi o anúncio', 'Oi, vi o anúncio no Facebook'],
  ['BPC/LOAS', 'Quero saber sobre o BPC LOAS'],
  ['INSS negou', 'Me afastei do trabalho por doença e o INSS negou'],
  ['Mãe idosa', 'Minha mãe tem 66 anos e nunca contribuiu, ela tem direito?'],
  ['Quanto custa?', 'E quanto custa? Tenho que pagar alguma coisa agora?'],
  ['Falar com advogado', 'Quero falar com um advogado, por favor'],
];

/*
 * O cliente de teste de cada agente.
 *
 * Um numero inventado por agente, guardado para a conversa continuar de onde
 * parou. Fica no DDD 00, que nao existe: um numero sorteado num DDD de verdade
 * podia cair em cima de um cliente cadastrado, e o teste escreveria na
 * conversa dele.
 */
function telefoneDeTeste(agenteId) {
  const chave = `telefone:${agenteId}`;
  let numero = lembrado(chave, '');
  if (!/^5500\d{9}$/.test(numero)) {
    numero = `5500${String(Math.floor(Math.random() * 1e9)).padStart(9, '0')}`;
    lembrar(chave, numero);
  }
  return numero;
}

/* A conexao de simulador nasce sozinha, para quem pode criar conexao. */
async function garantirConexaoDeTeste() {
  if (estado.conexoes.some((c) => c.tipo === 'simulador')) return true;
  if (!podeConfigurar()) return false;
  const status = (estado.status || []).find((s) => /nova/i.test(s.nome));
  const departamento = (estado.departamentos || []).find((d) => /comercial/i.test(d.nome));
  await api.post('/api/conexoes', {
    nome: 'Chat de teste',
    tipo: 'simulador',
    numero: '5500000000000',
    statusPadraoId: status?.id || null,
    departamentoPadraoId: departamento?.id || null,
  });
  await recarregar('conexoes');
  return true;
}

export async function paginaSimulador() {
  const container = el('div', { class: 'chat-teste' });
  const agentesAtivos = estado.agentes.filter((a) => a.ativo);

  if (!agentesAtivos.length) {
    container.append(
      el('div', { class: 'chat-teste-sem-conexao' }, [
        vazio(
          'Nenhum agente ligado',
          'O chat de teste conversa com um agente ligado. Ligue um em Agentes e volte aqui.',
          botao('Abrir Agentes', { tipo: 'principal', icone: 'agentes', aoClicar: () => (location.hash = '#/agentes') }),
        ),
      ]),
    );
    return container;
  }

  let temConexao = false;
  try {
    temConexao = await garantirConexaoDeTeste();
  } catch (erro) {
    aviso(erro.message, 'erro');
  }
  if (!temConexao) {
    container.append(
      el('div', { class: 'chat-teste-sem-conexao' }, [
        vazio(
          'Falta a conexão de teste',
          'O chat de teste fala por uma conexão de simulador, que não envia nada para o WhatsApp. Ela é criada sozinha quando um administrador abre esta tela.',
        ),
      ]),
    );
    return container;
  }

  let agenteId = lembrado('agente', '');
  if (!agentesAtivos.some((a) => a.id === agenteId)) agenteId = agentesAtivos[0].id;
  lembrar('agente', agenteId);

  let contatoId = lembrado(`contato:${agenteId}`, '') || null;
  let responsavelAtual = null;
  const agente = () => agentesAtivos.find((a) => a.id === agenteId);

  /* ---------------- Cabecalho ---------------- */

  const cabecalho = el('header', { class: 'chat-teste-cabecalho' });
  const avisoModelo = el('p', { class: 'chat-teste-aviso' });
  const escolhaAgente = selecao(
    agentesAtivos.map((a) => ({ valor: a.id, rotulo: a.nome })),
    agenteId,
    { 'aria-label': 'Agente com quem conversar', aoChange: (evento) => trocarAgente(evento.target.value) },
  );
  escolhaAgente.classList.add('chat-teste-escolha');

  function desenharCabecalho() {
    limpar(cabecalho);
    const escolhido = agente();
    /* O agente pode passar a conversa adiante (Triagem para Proposta). O
       cabecalho continua com quem foi testado e diz quem responde agora. */
    const outro =
      responsavelAtual?.tipo === 'agente' && responsavelAtual.id !== agenteId
        ? estado.agentes.find((a) => a.id === responsavelAtual.id) || responsavelAtual
        : null;

    cabecalho.append(
      avatar(escolhido, 40),
      el('div', { class: 'chat-teste-identidade' }, [
        el('div', { class: 'chat-teste-quem', texto: escolhido.nome }),
        el('div', {
          class: 'chat-teste-sub',
          texto: outro ? `Passou a conversa para ${outro.nome}, que responde agora` : 'Chat de teste · nada sai para o WhatsApp',
        }),
      ]),
      escolhaAgente,
      botao('Recomeçar', {
        pequeno: true,
        icone: 'atualizar',
        titulo: 'Apaga esta conversa e começa do zero',
        desabilitado: !contatoId,
        aoClicar: () => enviar('/restart'),
      }),
      botao('Abrir no atendimento', {
        pequeno: true,
        icone: 'abrir',
        desabilitado: !contatoId,
        aoClicar: () => {
          if (contatoId) location.hash = `#/atendimento/${contatoId}`;
        },
      }),
    );

    avisoModelo.hidden = escolhido.modeloDisponivel !== false;
    avisoModelo.textContent = `Sem a chave da Anthropic, ${escolhido.nome} responde pelo roteiro numerado do prompt: uma etapa por mensagem, sem entender o que você escreveu. Cadastre a chave em Integrações para conversar com o Claude.`;
  }

  /* ---------------- Janela da conversa ---------------- */

  const mensagens = el('div', { class: 'mensagens chat-teste-mensagens', role: 'log', 'aria-live': 'polite' });
  const espera = el('span', { class: 'chat-teste-espera' });
  const indicador = el('div', { class: 'chat-teste-digitando' }, [
    el('div', { class: 'digitando', 'aria-hidden': 'true' }, [el('span'), el('span'), el('span')]),
    espera,
    botao('Responder agora', { pequeno: true, titulo: 'Pula a espera do agente', aoClicar: responderAgora }),
  ]);
  indicador.hidden = true;

  const texto = areaTexto('', { placeholder: 'Escreva como se fosse o cliente…', rows: 2, 'aria-label': 'Mensagem do cliente' });
  const botaoEnviar = botao('', { tipo: 'principal', icone: 'enviar', titulo: 'Enviar (Enter)', aoClicar: () => enviar() });
  botaoEnviar.classList.add('botao-enviar');
  texto.addEventListener('keydown', (evento) => {
    if (evento.key === 'Enter' && !evento.shiftKey) {
      evento.preventDefault();
      enviar();
    }
  });

  const atalhos = el(
    'div',
    { class: 'chat-teste-frases', role: 'group', 'aria-label': 'Frases prontas' },
    FRASES.map(([rotulo, frase]) => botao(rotulo, { pequeno: true, titulo: frase, aoClicar: () => enviar(frase) })),
  );

  /* ---------------- "Digitando" ---------------- */

  let esperaAte = 0;
  let relogio = null;
  let desistir = null;

  function quemResponde() {
    if (responsavelAtual?.tipo === 'agente') return responsavelAtual.nome || agente().nome;
    return agente().nome;
  }

  function atualizarEspera() {
    const faltam = Math.ceil((esperaAte - Date.now()) / 1000);
    espera.textContent = faltam > 0 ? `${quemResponde()} responde em ${faltam} s` : `${quemResponde()} está escrevendo…`;
  }

  function mostrarDigitando(ate) {
    esperaAte = ate;
    indicador.hidden = false;
    atualizarEspera();
    clearInterval(relogio);
    relogio = setInterval(atualizarEspera, 1000);
    clearTimeout(desistir);
    /* Some sozinho se a resposta nao vier: indicador preso engana quem testa. */
    desistir = setTimeout(esconderDigitando, Math.max(3000, ate - Date.now() + 20000));
    mensagens.scrollTop = mensagens.scrollHeight;
  }

  function esconderDigitando() {
    indicador.hidden = true;
    clearInterval(relogio);
    clearTimeout(desistir);
  }

  /* ---------------- Conversa ---------------- */

  function balaoDa(mensagem) {
    /* A nota interna nao aparece para o cliente de verdade. Aqui ela fica
       visivel, mas dizendo isso: quem testa quer ver o que o agente anotou,
       sem confundir com o que o cliente leria. */
    if (mensagem.nota) {
      return el('div', {
        class: 'chat-teste-nota',
        texto: `Nota interna da equipe, que o cliente não vê: ${mensagem.conteudo || ''}`,
      });
    }
    /* A visao e a do cliente: o que ele manda fica a direita. */
    const doCliente = mensagem.direcao === 'entrada';
    return el('div', { class: doCliente ? 'balao saida' : 'balao ia' }, [
      doCliente ? null : el('div', { class: 'balao-autor', texto: mensagem.autor?.nome || 'Escritório' }),
      el('div', { texto: mensagem.conteudo || `[${mensagem.tipo}]` }),
      el('div', { class: 'balao-rodape' }, [el('span', { texto: dataHora(mensagem.criadoEm) })]),
    ]);
  }

  /*
   * Vale so o carregamento mais recente.
   *
   * A conversa recarrega por dois caminhos quase ao mesmo tempo: o envio
   * recarrega ao terminar, e o aviso ao vivo do servidor ("chegou mensagem")
   * recarrega tambem. Cada carregamento limpava a lista ANTES de esperar a
   * resposta; as duas limpezas aconteciam primeiro, as duas respostas chegavam
   * depois, e cada balao aparecia duas vezes.
   *
   * Agora a lista so e limpa quando a resposta chega, e so pela chamada mais
   * recente — as anteriores chegam e sao descartadas.
   */
  let pedidoAtual = 0;

  async function carregar() {
    const meuPedido = (pedidoAtual += 1);
    if (!contatoId) {
      limpar(mensagens);
      mensagens.append(
        el('div', { class: 'chat-teste-vazio' }, [
          avatar(agente(), 56),
          el('p', { class: 'chat-teste-vazio-titulo', texto: `Converse com ${agente().nome}` }),
          el('p', {
            class: 'chat-teste-apoio',
            texto: 'Escreva como se fosse o cliente, ou comece por uma das frases prontas. Nada sai desta máquina.',
          }),
        ]),
      );
      return;
    }
    let lista;
    try {
      lista = (await api.get(`/api/contatos/${contatoId}/mensagens?limite=200`)).mensagens || [];
    } catch {
      /* A conversa foi apagada no atendimento: recomeca limpo. */
      if (meuPedido !== pedidoAtual) return;
      contatoId = null;
      lembrar(`contato:${agenteId}`, '');
      desenharCabecalho();
      return carregar();
    }
    if (meuPedido !== pedidoAtual) return;
    limpar(mensagens);
    for (const mensagem of lista) mensagens.append(balaoDa(mensagem));
    mensagens.append(indicador);
    mensagens.scrollTop = mensagens.scrollHeight;
  }

  async function lerResponsavel() {
    if (!contatoId) return;
    try {
      responsavelAtual = (await api.get(`/api/contatos/${contatoId}`))?.responsavel || null;
    } catch {
      contatoId = null;
      lembrar(`contato:${agenteId}`, '');
    }
  }

  async function enviar(conteudo) {
    const valor = String(conteudo ?? texto.value).trim();
    if (!valor) return;
    botaoEnviar.disabled = true;
    try {
      const resposta = await api.post('/api/simulador/mensagem', {
        agenteId,
        telefone: telefoneDeTeste(agenteId),
        nome: 'Cliente de teste',
        conteudo: valor,
      });
      contatoId = resposta.contatoId;
      lembrar(`contato:${agenteId}`, contatoId);
      responsavelAtual = resposta.responsavel || null;
      if (conteudo === undefined) texto.value = '';
      desenharCabecalho();
      await carregar();

      if (resposta.reiniciado) {
        esconderDigitando();
        aviso('Conversa recomeçada do zero.', 'sucesso');
      } else if (responsavelAtual?.tipo === 'agente') {
        /* O aviso de "digitando" do servidor sai antes desta resposta chegar,
           quando a conversa ainda nao tinha id aqui — na primeira mensagem ele
           se perderia. O prazo e o do agente, que reinicia a cada mensagem. */
        const quem = estado.agentes.find((a) => a.id === responsavelAtual.id);
        mostrarDigitando(Date.now() + Math.max(1, Number(quem?.delaySegundos ?? 15)) * 1000);
      }
    } catch (erro) {
      aviso(erro.message, 'erro');
    } finally {
      botaoEnviar.disabled = false;
      texto.focus();
    }
  }

  async function responderAgora() {
    if (!contatoId) return;
    const id = responsavelAtual?.id || agenteId;
    try {
      await api.post(`/api/agentes/${id}/responder-agora`, { contatoId });
      esconderDigitando();
      await carregar();
    } catch (erro) {
      // A resposta nao vem mais: deixar "digitando" na tela prometeria uma.
      esconderDigitando();
      aviso(erro.message, 'erro');
    }
  }

  async function trocarAgente(id) {
    agenteId = id;
    lembrar('agente', id);
    contatoId = lembrado(`contato:${id}`, '') || null;
    responsavelAtual = null;
    esconderDigitando();
    await lerResponsavel();
    desenharCabecalho();
    await carregar();
    texto.focus();
  }

  /* ---------------- Ao vivo ---------------- */

  ouvir('digitando', (dados) => {
    if (!document.body.contains(container) || !contatoId || dados.contatoId !== contatoId) return;
    mostrarDigitando(dados.ate || Date.now() + 15000);
  });

  ouvir('mensagem', (dados) => {
    if (!document.body.contains(container) || !contatoId || dados.contatoId !== contatoId) return;
    if (dados.mensagem?.direcao === 'saida') esconderDigitando();
    carregar();
  });

  /* ---------------- Montagem ---------------- */

  container.append(
    el('section', { class: 'chat-teste-janela', 'aria-label': 'Conversa de teste' }, [
      cabecalho,
      avisoModelo,
      mensagens,
      el('div', { class: 'chat-teste-rodape' }, [atalhos, el('div', { class: 'chat-teste-compositor' }, [texto, botaoEnviar])]),
    ]),
  );

  await lerResponsavel();
  desenharCabecalho();
  await carregar();
  return container;
}
