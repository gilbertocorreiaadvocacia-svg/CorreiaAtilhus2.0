import { api } from '../api.js';
import { estado, ouvir, podeConfigurar } from '../estado.js';
import { areaTexto, avatar, aviso, botao, campo, dataHora, el, entradaTexto, limpar, selecao, vazio } from '../ui.js';

/**
 * Chat de teste: voce faz o papel do cliente e conversa com os agentes.
 *
 * A mensagem entra pelo MESMO caminho do WhatsApp de verdade — cria o contato,
 * aplica os padroes da conexao, detecta origem e chama o agente — mas por uma
 * conexao de simulador, cujo driver nao envia nada: as respostas ficam so no
 * sistema. E por isso que a tela so oferece conexao de simulador, e o servidor
 * recusa as outras: por um numero real, a resposta do agente iria para o
 * WhatsApp do numero inventado aqui.
 *
 * O que ela tem que a tela antiga nao tinha, e por que:
 *
 *   escolher o agente — testar a Triagem BPC nao pode exigir mexer no
 *     responsavel padrao da conexao, que vale para todo mundo.
 *   "digitando" com contagem — o agente espera o prazo dele antes de
 *     responder (15 s por padrao). Sem sinal, esse silencio parecia defeito.
 *   "Responder agora" — pula a espera quando o que se quer e ler a resposta.
 *   escrever embaixo da conversa — e um chat, e nao um formulario.
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
   uma parte diferente do funil: origem, palavra-chave, objecao, transferencia. */
const FRASES = [
  ['Vi o anúncio', 'Oi, vi o anúncio no Facebook'],
  ['BPC/LOAS', 'Quero saber sobre o BPC LOAS'],
  ['INSS negou', 'Me afastei do trabalho por doença e o INSS negou'],
  ['Mãe idosa', 'Minha mãe tem 66 anos e nunca contribuiu, ela tem direito?'],
  ['Quanto custa?', 'E quanto custa? Tenho que pagar alguma coisa agora?'],
  ['Falar com advogado', 'Quero falar com um advogado, por favor'],
];

async function criarConexaoDeTeste() {
  const ativos = estado.agentes.filter((a) => a.ativo);
  const recepcao = ativos.find((a) => /recep/i.test(a.nome)) || ativos[0];
  const status = (estado.status || []).find((s) => /nova/i.test(s.nome));
  const departamento = (estado.departamentos || []).find((d) => /comercial/i.test(d.nome));
  try {
    await api.post('/api/conexoes', {
      nome: 'Chat de teste',
      tipo: 'simulador',
      numero: '5500000000000',
      statusPadraoId: status?.id || null,
      departamentoPadraoId: departamento?.id || null,
      responsavelPadrao: recepcao ? { tipo: 'agente', id: recepcao.id } : null,
    });
    location.reload();
  } catch (erro) {
    aviso(erro.message, 'erro');
  }
}

export async function paginaSimulador() {
  const container = el('div', { class: 'chat-teste' });
  const conexoesDeTeste = estado.conexoes.filter((c) => c.tipo === 'simulador');

  if (!conexoesDeTeste.length) {
    container.append(
      el('div', { class: 'chat-teste-sem-conexao' }, [
        vazio(
          'Falta a conexão de teste',
          'O chat de teste fala por uma conexão de simulador, que não envia nada para o WhatsApp. Crie uma para começar.',
        ),
        podeConfigurar()
          ? botao('Criar conexão de teste', { tipo: 'principal', aoClicar: criarConexaoDeTeste })
          : el('p', { class: 'chat-teste-apoio', texto: 'Peça ao administrador para criar a conexão de teste.' }),
      ]),
    );
    return container;
  }

  let conexaoId = lembrado('conexao', conexoesDeTeste[0].id);
  if (!conexoesDeTeste.some((c) => c.id === conexaoId)) conexaoId = conexoesDeTeste[0].id;

  const agentesAtivos = estado.agentes.filter((a) => a.ativo);
  let agenteId = lembrado('agente', '');
  if (agenteId && !agentesAtivos.some((a) => a.id === agenteId)) agenteId = '';

  let contatoId = lembrado('contato', '') || null;
  let responsavelAtual = null;

  const agenteEscolhido = () => agentesAtivos.find((a) => a.id === agenteId) || null;

  /* ---------------- Ajustes ---------------- */

  const escolhaAgente = selecao(
    [
      { valor: '', rotulo: 'Automático — como no WhatsApp de verdade' },
      ...agentesAtivos.map((a) => ({ valor: a.id, rotulo: a.nome })),
    ],
    agenteId,
    {
      aoChange: (evento) => {
        agenteId = evento.target.value;
        lembrar('agente', agenteId);
        desenharCabecalho();
        desenharAviso();
      },
    },
  );

  const escolhaConexao =
    conexoesDeTeste.length > 1
      ? selecao(
          conexoesDeTeste.map((c) => ({ valor: c.id, rotulo: c.nome })),
          conexaoId,
          {
            aoChange: (evento) => {
              conexaoId = evento.target.value;
              lembrar('conexao', conexaoId);
              trocarCliente();
            },
          },
        )
      : null;

  const nome = entradaTexto(lembrado('nome', 'Maria Aparecida'), { placeholder: 'Maria Aparecida' });
  const numero = entradaTexto(lembrado('numero', '32988112233'), { placeholder: '32 98811-2233', inputmode: 'tel' });
  nome.addEventListener('change', () => lembrar('nome', nome.value.trim()));
  numero.addEventListener('change', trocarCliente);

  const atalhos = el(
    'div',
    { class: 'chat-teste-frases' },
    FRASES.map(([rotulo, frase]) => botao(rotulo, { pequeno: true, titulo: frase, aoClicar: () => enviar(frase) })),
  );

  const avisoModelo = el('p', { class: 'chat-teste-aviso' });

  function desenharAviso() {
    const agente = agenteEscolhido();
    const semIa = agente ? agente.modeloDisponivel === false : agentesAtivos.some((a) => a.modeloDisponivel === false);
    avisoModelo.hidden = !semIa;
    avisoModelo.textContent =
      'Sem a chave da Anthropic, o agente responde pelo roteiro numerado do prompt: uma etapa por mensagem, sem entender o que você escreveu. Cadastre a chave em Integrações para conversar com o Claude.';
  }

  /* ---------------- Janela da conversa ---------------- */

  const cabecalho = el('div', { class: 'chat-teste-cabecalho' });
  const mensagens = el('div', { class: 'mensagens chat-teste-mensagens', role: 'log', 'aria-live': 'polite' });
  const espera = el('span', { class: 'chat-teste-espera' });
  const indicador = el('div', { class: 'chat-teste-digitando' }, [
    el('div', { class: 'digitando', 'aria-hidden': 'true' }, [el('span'), el('span'), el('span')]),
    espera,
    botao('Responder agora', { pequeno: true, titulo: 'Pula a espera do agente', aoClicar: responderAgora }),
  ]);
  indicador.hidden = true;

  const texto = areaTexto('', { placeholder: 'Escreva como se fosse o cliente…', rows: 2, 'aria-label': 'Mensagem do cliente' });
  const botaoEnviar = botao('Enviar', { tipo: 'principal', icone: 'enviar', aoClicar: () => enviar() });
  texto.addEventListener('keydown', (evento) => {
    if (evento.key === 'Enter' && !evento.shiftKey) {
      evento.preventDefault();
      enviar();
    }
  });

  function desenharCabecalho() {
    limpar(cabecalho);
    const escolhido = agenteEscolhido();
    const emConversa =
      responsavelAtual?.tipo === 'agente' ? estado.agentes.find((a) => a.id === responsavelAtual.id) || null : null;
    const quem = escolhido || emConversa;
    cabecalho.append(
      avatar(quem || { nome: 'Automático' }, 32),
      el('div', { class: 'flexivel encolhe' }, [
        el('div', { class: 'chat-teste-quem', texto: quem ? quem.nome : 'Automático' }),
        el('div', {
          class: 'chat-teste-sub',
          texto: escolhido
            ? 'Você está conversando com este agente'
            : emConversa
              ? 'Automático: é quem está respondendo agora'
              : 'Automático: responde o agente padrão da conexão, ou o da palavra-chave',
        }),
      ]),
      botao('Recomeçar', {
        pequeno: true,
        titulo: 'Apaga esta conversa e começa como cliente novo (/restart)',
        desabilitado: !contatoId,
        aoClicar: () => enviar('/restart'),
      }),
      botao('Abrir no atendimento', {
        pequeno: true,
        desabilitado: !contatoId,
        aoClicar: () => {
          if (contatoId) location.hash = `#/atendimento/${contatoId}`;
        },
      }),
    );
  }

  /* ---------------- "Digitando" ---------------- */

  let esperaAte = 0;
  let relogio = null;
  let desistir = null;

  function quemResponde() {
    const escolhido = agenteEscolhido();
    if (escolhido) return escolhido.nome;
    if (responsavelAtual?.tipo === 'agente') return responsavelAtual.nome || 'O agente';
    return 'O agente';
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
    return el('div', { class: doCliente ? 'balao saida' : 'balao' }, [
      doCliente ? null : el('div', { class: 'balao-autor', texto: mensagem.autor?.nome || 'Escritório' }),
      el('div', { texto: mensagem.conteudo || `[${mensagem.tipo}]` }),
      el('div', { class: 'balao-rodape' }, [el('span', { texto: dataHora(mensagem.criadoEm) })]),
    ]);
  }

  async function carregar() {
    limpar(mensagens);
    if (!contatoId) {
      mensagens.append(
        el('div', { class: 'chat-teste-vazio' }, [
          el('p', { texto: 'Escreva a primeira mensagem como se fosse o cliente.' }),
          el('p', {
            class: 'chat-teste-apoio',
            texto:
              'Ela entra no sistema pelo mesmo caminho do WhatsApp: cria o contato, aplica os padrões da conexão e chama o agente.',
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
      contatoId = null;
      lembrar('contato', '');
      desenharCabecalho();
      return carregar();
    }
    for (const mensagem of lista) mensagens.append(balaoDa(mensagem));
    mensagens.append(indicador);
    mensagens.scrollTop = mensagens.scrollHeight;
  }

  async function enviar(conteudo) {
    const valor = String(conteudo ?? texto.value).trim();
    if (!valor) return;
    const telefone = numero.value.replace(/\D+/g, '');
    if (telefone.length < 10) {
      aviso('Informe o WhatsApp do cliente com DDD, por exemplo 32 98811-2233.', 'alerta');
      numero.focus();
      return;
    }
    lembrar('nome', nome.value.trim());
    lembrar('numero', numero.value.trim());
    botaoEnviar.disabled = true;
    try {
      const resposta = await api.post('/api/simulador/mensagem', {
        conexaoId,
        agenteId: agenteId || null,
        telefone,
        nome: nome.value.trim(),
        conteudo: valor,
      });
      contatoId = resposta.contatoId;
      lembrar('contato', contatoId);
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
        const agente = estado.agentes.find((a) => a.id === responsavelAtual.id);
        mostrarDigitando(Date.now() + Math.max(1, Number(agente?.delaySegundos ?? 15)) * 1000);
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
    const id = responsavelAtual?.id || agenteId || 'automatico';
    try {
      await api.post(`/api/agentes/${id}/responder-agora`, { contatoId });
      esconderDigitando();
      await carregar();
    } catch (erro) {
      aviso(erro.message, 'erro');
    }
  }

  function trocarCliente() {
    contatoId = null;
    responsavelAtual = null;
    lembrar('contato', '');
    lembrar('numero', numero.value.trim());
    esconderDigitando();
    desenharCabecalho();
    carregar();
  }

  function novoCliente() {
    const sufixo = String(Math.floor(Math.random() * 1e7)).padStart(7, '0');
    numero.value = `3298${sufixo}`;
    trocarCliente();
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
    el('div', { class: 'chat-teste-ajustes' }, [
      el('p', {
        class: 'chat-teste-apoio',
        texto: 'Você faz o papel do cliente e conversa com os agentes. Tudo fica só no sistema: nada sai desta máquina.',
      }),
      campo('Conversar com', escolhaAgente),
      escolhaConexao ? campo('Conexão de teste', escolhaConexao) : null,
      campo('Nome do cliente', nome),
      campo('WhatsApp do cliente', numero),
      el('div', { class: 'linha-botoes' }, [
        botao('Novo cliente', {
          pequeno: true,
          titulo: 'Troca o número e começa uma conversa do zero',
          aoClicar: novoCliente,
        }),
      ]),
      el('div', { class: 'campo' }, [el('span', { texto: 'Frases prontas' }), atalhos]),
      avisoModelo,
    ]),
    el('section', { class: 'chat-teste-janela', 'aria-label': 'Conversa de teste' }, [
      cabecalho,
      mensagens,
      el('div', { class: 'chat-teste-compositor' }, [texto, botaoEnviar]),
    ]),
  );

  if (contatoId) {
    try {
      responsavelAtual = (await api.get(`/api/contatos/${contatoId}`))?.responsavel || null;
    } catch {
      contatoId = null;
      lembrar('contato', '');
    }
  }

  desenharCabecalho();
  desenharAviso();
  await carregar();
  return container;
}
