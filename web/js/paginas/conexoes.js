import { api } from '../api.js';
import { estado, opcoesResponsavel, podeConfigurar, recarregar } from '../estado.js';
import { campoComDica, dica, gaveta } from '../componentes.js';
import {
  aviso,
  botao,
  campo,
  confirmar,
  dataHora,
  el,
  entradaTexto,
  limpar,
  selecao,
  selo,
  telefone,
  vazio,
} from '../ui.js';

/**
 * Conexoes de WhatsApp. Duas naturezas:
 *  - simulador: roda hoje, sem chip, para testar o funil inteiro;
 *  - oficial: Cloud API da Meta, com webhook, janela de 24h e template aprovado.
 */
export async function paginaConexoes() {
  const container = el('div');

  async function desenhar() {
    const conexoes = await recarregar('conexoes');
    limpar(container);

    // A doutrina dos dois numeros e conceito, nao aviso de estado: quem opera a
    // tela todo dia ja sabe e nao precisa ler de novo, entao ela mora atras da
    // dica e o cartao do primeiro numero comeca no alto da tela.
    container.append(
      el('div', { class: 'linha-botoes mb-4' }, [
        podeConfigurar() ? botao('Nova conexao', { tipo: 'principal', icone: 'mais', aoClicar: () => editar(null, desenhar) }) : null,
        dica(
          el('div', {}, [
            el('div', { html: 'O escritorio deve trabalhar com <strong>no minimo dois numeros</strong>: um comercial, que faz proposta e follow-up, e um de pos-venda, que fala com quem ja assinou.' }),
            el('div', { class: 'mt-2', texto: 'O comercial e o que corre risco: se for restringido, o relacionamento com os clientes antigos continua intacto no outro chip. Nunca perca o numero de pos-venda.' }),
          ]),
          { assunto: 'os numeros do escritorio' },
        ),
      ]),
    );

    if (!conexoes.length) {
      container.append(vazio('Nenhuma conexao', 'Crie uma conexao em modo simulador para comecar hoje mesmo.'));
      return;
    }

    const grade = el('div', { class: 'grade g2' });
    for (const conexao of conexoes) {
      const conectada = conexao.estado === 'conectado';
      const faltando = credenciaisFaltando(conexao);
      const bloqueia = faltando.some((falta) => falta.bloqueia);
      const evento = ultimoEvento(conexao);

      grade.append(
        el('div', { class: 'cartao' }, [
          el('h2', { class: 'cartao-titulo' }, [
            // Cor decidida em tempo de execucao, do mesmo jeito que selo() faz
            // em ui.js: e o unico estilo inline que fica de pe neste cartao.
            el('span', { class: 'ponto', estilo: { background: conectada ? 'var(--sucesso)' : 'var(--erro)' } }),
            document.createTextNode(conexao.nome),
          ]),
          // Tres selos, no maximo: o que o numero e, se ele esta de pe e a nota
          // de qualidade quando a Meta manda uma. O telefone saiu daqui e desceu
          // para a lista de dados do cartao, junto dos outros padroes do numero:
          // ele e um dado que se le, e nao um estado que se varre com o olho.
          el('div', { class: 'linha-p quebra mb-3' }, [
            selo(conexao.tipo === 'oficial' ? 'API Oficial (Meta)' : 'Simulador', conexao.tipo === 'oficial' ? 'ouro' : 'info'),
            selo(conectada ? 'conectado' : 'desconectado', conectada ? 'sucesso' : 'erro'),
            conexao.qualidade ? selo(`qualidade ${conexao.qualidade}`, 'alerta') : null,
          ]),

          // O aviso de credencial vem antes dos detalhes: numero oficial sem
          // token nao envia nem recebe, e ate agora a unica pista disso no
          // cartao era a bolinha vermelha do estado, que tambem aparece por
          // qualquer outro motivo.
          faltando.length
            ? el(
                'div',
                { class: `alerta-caixa mb-3 ${bloqueia ? 'erro' : ''}`.trim() },
                [
                  el('div', { texto: `Falta configurar: ${faltando.map((falta) => falta.rotulo).join(', ')}.` }),
                  // O que fazer a respeito ja esta no botao Configurar, logo
                  // abaixo. Aqui fica so a consequencia de deixar como esta.
                  el('div', {
                    class: 'mt-1',
                    texto: bloqueia
                      ? 'Sem isso o numero nao envia nem recebe.'
                      : 'Sem a chave secreta, o webhook aceita evento de qualquer origem.',
                  }),
                ],
              )
            : null,

          el('div', { class: 'lista-simples' }, [
            conexao.numero ? linha('Numero', telefone(conexao.numero)) : null,
            linha('Status padrao', estado.status.find((s) => s.id === conexao.statusPadraoId)?.nome || '-'),
            linha('Departamento padrao', estado.departamentos.find((d) => d.id === conexao.departamentoPadraoId)?.nome || '-'),
            linha('Responsavel padrao', conexao.responsavelPadrao?.id
              ? (estado.agentes.find((a) => a.id === conexao.responsavelPadrao.id)?.nome
                || estado.membros.find((m) => m.id === conexao.responsavelPadrao.id)?.usuario?.nome
                || '-')
              : '-'),
            conexao.conectadoEm ? linha('Conectado em', dataHora(conexao.conectadoEm)) : null,
            evento ? linha('Ultimo evento', evento.tipo ? `${dataHora(evento.em)} (${evento.tipo})` : dataHora(evento.em)) : null,
            conexao.ultimoErro ? linha('Ultimo erro', conexao.ultimoErro) : null,
          ]),

          conexao.tipo === 'oficial'
            ? el('div', { class: 'alerta-caixa mt-3' }, [
                el('div', { texto: 'URL do webhook para colar no painel da Meta:' }),
                el('div', { class: 'mono mt-1 quebra-palavra', texto: `${location.origin}/webhook/${conexao.id}` }),
              ])
            : null,

          el('div', { class: 'linha-botoes mt-4' }, [
            podeConfigurar() ? botao('Configurar', { pequeno: true, aoClicar: () => editar(conexao, desenhar) }) : null,
            botao('Testar', {
              pequeno: true,
              aoClicar: async () => {
                const resultado = await api.post(`/api/conexoes/${conexao.id}/testar`);
                aviso(resultado.ok ? `Conexao respondendo. ${resultado.numero || resultado.mensagem || ''}` : resultado.erro, resultado.ok ? 'sucesso' : 'erro');
                await desenhar();
              },
            }),
            podeConfigurar()
              ? botao('Excluir', {
                  pequeno: true,
                  tipo: 'perigo',
                  aoClicar: () =>
                    confirmar('Excluir conexao?', 'So e possivel se nenhuma conversa estiver ligada a ela.', async () => {
                      await api.delete(`/api/conexoes/${conexao.id}`);
                      await desenhar();
                    }, 'Excluir'),
                })
              : null,
          ]),
        ]),
      );
    }
    container.append(grade);
  }

  await desenhar();
  return container;
}

/**
 * Linha de rotulo e valor dentro do cartao. O desenho inteiro sai de
 * .linha-dado no tema: rotulo fraco a esquerda, valor suave a direita. O
 * respiro entre uma linha e outra ja vem do gap de .lista-simples, entao aqui
 * nao entra padding nenhum.
 */
function linha(rotulo, valor) {
  return el('div', { class: 'linha-dado' }, [
    el('span', { texto: rotulo }),
    el('span', { texto: String(valor) }),
  ]);
}

/**
 * Credencial que ainda falta na Cloud API. O token chega mascarado da rota
 * ('***' quando existe, vazio quando nao), entao da para avisar que falta sem
 * nunca trazer o valor de verdade para a tela.
 *
 * A chave secreta do app nao impede o envio, so deixa o webhook aceitar evento
 * de qualquer origem, por isso ela entra na lista sem marcar bloqueio: o aviso
 * aparece em tom de alerta, e nao de erro.
 */
function credenciaisFaltando(conexao) {
  if (conexao.tipo !== 'oficial') return [];
  const oficial = conexao.oficial || {};
  const faltas = [];
  if (!oficial.phoneNumberId) faltas.push({ rotulo: 'ID do numero', bloqueia: true });
  if (!oficial.token) faltas.push({ rotulo: 'token de acesso', bloqueia: true });
  if (!oficial.verifyToken) faltas.push({ rotulo: 'token de verificacao', bloqueia: true });
  if (!oficial.appSecret) faltas.push({ rotulo: 'chave secreta do app', bloqueia: false });
  return faltas;
}

/**
 * Quando chegou o ultimo evento da Meta neste numero. Nem toda conexao traz o
 * carimbo na resposta, entao a linha simplesmente nao aparece quando ele nao
 * existe: mostrar um traco ali daria a entender que o numero esta mudo, que e
 * outra coisa. A leitura aceita as duas formas possiveis, so a data ou um
 * objeto com data e tipo do evento.
 */
function ultimoEvento(conexao) {
  const bruto = conexao.ultimoEventoEm || conexao.ultimoEvento || null;
  if (!bruto) return null;
  if (typeof bruto === 'string') return { em: bruto, tipo: null };
  const em = bruto.em || bruto.data || null;
  return em ? { em, tipo: bruto.tipo || null } : null;
}

/**
 * Formulario em gaveta. Sao seis campos no modo simulador e onze no oficial,
 * com bloco que aparece e some conforme o tipo: na janela centralizada o
 * conteudo passava da altura util e a pessoa rolava o formulario inteiro para
 * achar o botao de salvar.
 */
function editar(conexao, recarregarTela) {
  const novo = !conexao;
  const nome = entradaTexto(conexao?.nome || '');
  const tipo = selecao(
    [
      { valor: 'simulador', rotulo: 'Simulador (funciona hoje, sem chip)' },
      { valor: 'oficial', rotulo: 'API Oficial da Meta (Cloud API)' },
    ],
    conexao?.tipo || 'simulador',
  );
  const numero = entradaTexto(conexao?.numero || '');

  const statusPadrao = selecao(
    [{ valor: '', rotulo: 'Sem status' }, ...estado.status.map((s) => ({ valor: s.id, rotulo: s.nome }))],
    conexao?.statusPadraoId || '',
  );
  const departamentoPadrao = selecao(
    [{ valor: '', rotulo: 'Sem departamento' }, ...estado.departamentos.map((d) => ({ valor: d.id, rotulo: d.nome }))],
    conexao?.departamentoPadraoId || '',
  );
  const responsavelPadrao = selecao(
    opcoesResponsavel(),
    conexao?.responsavelPadrao ? `${conexao.responsavelPadrao.tipo}:${conexao.responsavelPadrao.id}` : '',
  );

  const phoneNumberId = entradaTexto(conexao?.oficial?.phoneNumberId || '');
  const wabaId = entradaTexto(conexao?.oficial?.wabaId || '');
  const token = entradaTexto(conexao?.oficial?.token || '', { type: 'password', placeholder: conexao?.oficial?.token ? 'deixe em branco para manter' : '' });
  const appSecret = entradaTexto(conexao?.oficial?.appSecret || '', { type: 'password' });
  const verifyToken = entradaTexto(conexao?.oficial?.verifyToken || '');

  // Um campo por linha: a gaveta tem a largura de uma coluna, e ID de numero e
  // token sao textos longos que ficariam cortados lado a lado.
  //
  // O display fica inline de proposito: ele acompanha o valor do campo Tipo em
  // tempo de execucao, e trocar por classe mudaria o comportamento do bloco.
  // O passo a passo do painel da Meta e o motivo da chave secreta sao conceito:
  // valem na primeira configuracao e nunca mais. Ficam atras da dica do titulo.
  // A URL do webhook nao: ela e dado, e o valor que a pessoa vem copiar aqui.
  const blocoOficial = el('div', { estilo: { display: tipo.value === 'oficial' ? 'block' : 'none' } }, [
    subtitulo(
      'Credenciais da Cloud API',
      el('div', {}, [
        el('div', { html: 'No painel da Meta: <strong>WhatsApp > Configuracao</strong>. Copie o ID do numero, o ID da conta (WABA) e gere um token de usuario do sistema, o token do painel expira em 24 horas.' }),
        el('div', { class: 'mt-2', texto: 'A chave secreta do app confere a assinatura de cada evento. Sem ela, qualquer um que descubra a URL manda evento falso.' }),
      ]),
    ),
    conexao ? el('div', { class: 'mono mt-2 mb-3 quebra-palavra', texto: `Webhook: ${location.origin}/webhook/${conexao.id}` }) : null,
    campo('ID do numero de telefone', phoneNumberId),
    campo('ID da conta WhatsApp Business (WABA)', wabaId),
    campo('Token de acesso', token),
    campo('Chave secreta do app', appSecret),
    campo('Token de verificacao', verifyToken, 'Mesmo valor no campo "Verificar token" do painel da Meta.'),
  ]);

  tipo.addEventListener('change', () => {
    blocoOficial.style.display = tipo.value === 'oficial' ? 'block' : 'none';
  });

  gaveta({
    titulo: novo ? 'Nova conexao' : `Configurar ${conexao.nome}`,
    corpo: [
      campo('Nome', nome),
      // O bloco de credenciais so aparece depois de escolher oficial, entao sem
      // esta dica quem escolhe errado nao tem como saber antes de escolher.
      campoComDica('Tipo', tipo, 'Simulador funciona sem chip. Oficial precisa das credenciais da Meta.'),
      campo('Numero', numero),
      subtitulo(
        'Padroes de toda conversa nova',
        'Aplicados no momento em que alguem escreve pela primeira vez para este numero.',
      ),
      campo('Status padrao', statusPadrao),
      campo('Departamento padrao', departamentoPadrao),
      campo('Responsavel padrao', responsavelPadrao, 'Normalmente o agente de triagem.'),
      blocoOficial,
    ],
    confirmar: 'Salvar',
    aoConfirmar: async () => {
      if (!nome.value.trim()) throw new Error('De um nome a conexao.');
      const [tipoResp, idResp] = responsavelPadrao.value ? responsavelPadrao.value.split(':') : [null, null];
      const dados = {
        nome: nome.value.trim(),
        tipo: tipo.value,
        numero: numero.value.trim(),
        statusPadraoId: statusPadrao.value || null,
        departamentoPadraoId: departamentoPadrao.value || null,
        responsavelPadrao: tipoResp ? { tipo: tipoResp, id: idResp } : null,
      };
      if (tipo.value === 'oficial') {
        dados.oficial = {
          phoneNumberId: phoneNumberId.value.trim(),
          wabaId: wabaId.value.trim(),
          token: token.value.trim(),
          appSecret: appSecret.value.trim(),
          verifyToken: verifyToken.value.trim(),
        };
      }
      if (novo) await api.post('/api/conexoes', dados);
      else await api.patch(`/api/conexoes/${conexao.id}`, dados);
      aviso('Conexao salva.', 'sucesso');
      await recarregarTela();
    },
  });
}

/**
 * Divisor de bloco dentro da gaveta, em caixa normal como o resto da tela.
 * Mesmo desenho de .cartao-titulo, que ja e o titulo de secao do sistema, com
 * o respiro de cima vindo da escala de espaco.
 *
 * `balao` e o que o bloco significa. Vai para a dica ao lado do titulo em vez
 * de virar paragrafo: quem configura a conexao pela segunda vez nao releia.
 */
function subtitulo(texto, balao) {
  return el('h3', { class: 'cartao-titulo mt-4' }, [texto, balao ? dica(balao, { assunto: texto }) : null]);
}
