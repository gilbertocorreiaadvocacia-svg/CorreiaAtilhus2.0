import { api } from '../api.js';
import { estado, ouvir, podeConfigurar } from '../estado.js';
import { areaTexto, aviso, botao, campo, dataHora, el, entradaTexto, icone, limpar, modal, numero, quando, telefone, vazio } from '../ui.js';

/**
 * Contratos: todos os contratos da ZapSign num lugar so.
 *
 * Ate aqui o contrato so aparecia dentro de cada conversa, no painel da
 * direita, e quem confere contratos abria conversa por conversa para achar os
 * que esperavam. A lista diz o que espera conferencia, o que esta com o
 * cliente, o que foi assinado (e se o caso ja abriu no Atilhus Juri) e o que
 * encerrou. A conferencia acontece no painel ao lado, sem sair da lista, pelas
 * mesmas rotas do cartao da conversa (servidor/rotas/integracoes.js).
 */

const SITUACOES = {
  em_conferencia: { rotulo: 'Aguardando sua conferência', tipo: 'ouro', grupo: 'conferir' },
  link_enviado: { rotulo: 'Link enviado ao cliente', tipo: '', grupo: 'cliente' },
  link_aberto: { rotulo: 'Cliente abriu o link', tipo: '', grupo: 'cliente' },
  assinado: { rotulo: 'Assinado', tipo: 'sucesso', grupo: 'assinados' },
  devolvido: { rotulo: 'Devolvido ao agente', tipo: '', grupo: 'encerrados' },
  recusado: { rotulo: 'Recusado pelo cliente', tipo: 'erro', grupo: 'encerrados' },
  expirado: { rotulo: 'Prazo para assinar vencido', tipo: 'erro', grupo: 'encerrados' },
  cancelado: { rotulo: 'Cancelado na ZapSign', tipo: 'erro', grupo: 'encerrados' },
};

const GRUPOS = [
  { id: 'conferir', rotulo: 'Para conferir', titulo: 'Precisa da sua conferência' },
  { id: 'cliente', rotulo: 'Com o cliente', titulo: 'Com o cliente' },
  { id: 'assinados', rotulo: 'Assinados', titulo: 'Assinados' },
  { id: 'encerrados', rotulo: 'Encerrados', titulo: 'Encerrados' },
];

/* O caminho ate o Atilhus Juri, contado do lado do Chat. */
const JURI = {
  pendente: { rotulo: 'Indo para o Atilhus Juri…', tipo: '' },
  enviado: { rotulo: 'Caso aberto em A validar', tipo: 'sucesso' },
  falhou: { rotulo: 'Juri fora do ar: tenta de novo sozinho', tipo: 'alerta' },
  recusado: { rotulo: 'O Juri recusou abrir o caso', tipo: 'erro' },
  aguardando_configuracao: { rotulo: 'Falta configurar o Atilhus Juri', tipo: 'alerta' },
};

const grupoDe = (contrato) => SITUACOES[contrato.situacao]?.grupo || 'encerrados';

/* "{{NOME_COMPLETO}}" vira "Nome completo": e assim que a pessoa le o campo.
   Sigla continua sigla e a palavra ganha o acento que a variavel do modelo nao tem. */
const PALAVRAS_DO_CAMPO = {
  cpf: 'CPF',
  rg: 'RG',
  cep: 'CEP',
  cnpj: 'CNPJ',
  ctps: 'CTPS',
  nit: 'NIT',
  nis: 'NIS',
  uf: 'UF',
  email: 'e-mail',
  endereco: 'endereço',
  profissao: 'profissão',
  numero: 'número',
  orgao: 'órgão',
  emissao: 'emissão',
  beneficio: 'benefício',
  municipio: 'município',
  mae: 'mãe',
};

function rotuloDoCampo(chave) {
  const texto = chave
    .replace(/[{}]/g, '')
    .trim()
    .toLowerCase()
    .split(/[_\s]+/)
    .filter(Boolean)
    .map((palavra) => PALAVRAS_DO_CAMPO[palavra] || palavra)
    .join(' ');
  return texto.charAt(0).toUpperCase() + texto.slice(1);
}

export async function paginaContratos({ parametros = [], definirAcoes = () => {} } = {}) {
  let contratos = [];
  const nomesDosModelos = {};
  let recorte = 'todos';
  let selecionadoId = parametros[0] || null;
  /* O que foi corrigido na conferencia, por contrato. Sobrevive ao redesenho
     que um evento do servidor dispara no meio da digitacao. */
  const edicoes = new Map();

  const container = el('div', { class: 'contratos' });

  async function carregar() {
    contratos = await api.get('/api/contratos');
  }

  /* O nome do modelo mora na configuracao da ZapSign, que so quem configura le.
     Sem ele, a tela diz o tipo de caso e segue. */
  async function carregarModelos() {
    if (!podeConfigurar()) return;
    try {
      const integracoes = await api.get('/api/integracoes');
      for (const modelo of integracoes?.zapsign?.modelos || []) nomesDosModelos[modelo.id] = modelo.nome;
    } catch {
      /* sem nome de modelo */
    }
  }

  const casoDo = (contrato) => estado.etiquetas.find((e) => e.tipo === 'caso' && e.caso === contrato.caso) || null;

  const camposEmBranco = (contrato) =>
    Object.entries({ ...(contrato.valores || {}), ...(edicoes.get(contrato.id) || {}) })
      .filter(([, valor]) => !String(valor ?? '').trim())
      .map(([chave]) => rotuloDoCampo(chave));

  const pilula = (texto, tipo) => el('span', { class: `pilula ${tipo || ''}`.trim(), texto });

  async function agir(acao, sucesso, contratoId) {
    try {
      const resposta = await acao();
      if (resposta && resposta.ok === false) throw new Error(resposta.erro || 'Não foi possível.');
      if (contratoId) edicoes.delete(contratoId);
      if (sucesso) aviso(sucesso, 'sucesso');
      await carregar();
      desenhar();
    } catch (erro) {
      aviso(erro.message, 'erro');
    }
  }

  function acoes() {
    const contar = (id) => (id === 'todos' ? contratos.length : contratos.filter((c) => grupoDe(c) === id).length);
    return el(
      'div',
      { class: 'grupo-alternado', role: 'group', 'aria-label': 'Recorte dos contratos' },
      [{ id: 'todos', rotulo: 'Todos' }, ...GRUPOS].map((opcao) =>
        botao(`${opcao.rotulo} ${numero(contar(opcao.id))}`, {
          pequeno: true,
          tipo: opcao.id === recorte ? 'principal' : '',
          aoClicar: () => {
            if (opcao.id === recorte) return;
            recorte = opcao.id;
            desenhar();
          },
        }),
      ),
    );
  }

  function linha(contrato) {
    const situacao = SITUACOES[contrato.situacao] || { rotulo: contrato.situacao, tipo: '' };
    const caso = casoDo(contrato);
    const juri = contrato.juri ? JURI[contrato.juri.situacao] : null;
    const emBranco = contrato.situacao === 'em_conferencia' ? camposEmBranco(contrato) : [];
    const ativo = contrato.id === selecionadoId;
    return el(
      'button',
      {
        type: 'button',
        class: `contratos-linha${ativo ? ' ativo' : ''}`,
        'aria-current': ativo ? 'true' : null,
        aoClick: () => {
          selecionadoId = contrato.id;
          history.replaceState(null, '', `#/contratos/${contrato.id}`);
          desenhar();
        },
      },
      [
        el('span', { class: 'contratos-cliente' }, [
          el('strong', { texto: contrato.contato }),
          el('span', { texto: telefone(contrato.telefone) }),
        ]),
        el(
          'span',
          { class: 'contratos-caso' },
          caso ? [el('span', { class: 'ponto', estilo: { background: caso.cor } }), caso.nome] : ['—'],
        ),
        el('span', { class: 'contratos-situacao' }, [
          pilula(situacao.rotulo, situacao.tipo),
          emBranco.length
            ? el('small', { class: 'alerta', texto: `em branco: ${emBranco.join(', ')}` })
            : contrato.motivoDevolucao
              ? el('small', { texto: `motivo: ${contrato.motivoDevolucao}` })
              : null,
        ]),
        el('span', { class: `contratos-juri ${juri?.tipo || 'nada'}`, texto: juri ? juri.rotulo : '—' }),
        el('span', { class: 'contratos-quando', texto: quando(contrato.atualizadoEm || contrato.criadoEm) }),
      ],
    );
  }

  function lista(visiveis) {
    const area = el('section', { class: 'contratos-lista' });
    if (!contratos.length) {
      area.append(
        vazio(
          'Nenhum contrato ainda',
          'Quando um agente ou alguém da equipe pedir um contrato numa conversa, ele aparece aqui para conferir.',
          null,
          'contrato',
        ),
      );
      return area;
    }

    const tabela = el('div', { class: 'contratos-tabela' }, [
      el('div', { class: 'contratos-linha cabecalho', 'aria-hidden': 'true' }, [
        el('span', { texto: 'Cliente' }),
        el('span', { texto: 'Tipo de caso' }),
        el('span', { texto: 'Na ZapSign' }),
        el('span', { texto: 'No Atilhus Juri' }),
        el('span', { texto: 'Atualizado' }),
      ]),
    ]);
    for (const grupo of recorte === 'todos' ? GRUPOS : GRUPOS.filter((g) => g.id === recorte)) {
      const doGrupo = visiveis.filter((c) => grupoDe(c) === grupo.id);
      if (!doGrupo.length) continue;
      tabela.append(
        el('div', { class: `contratos-grupo${grupo.id === 'conferir' ? ' ouro' : ''}` }, [
          el('span', { texto: grupo.titulo }),
          el('span', { class: 'contratos-grupo-conta', texto: String(doGrupo.length) }),
        ]),
        ...doGrupo.map(linha),
      );
    }
    if (!visiveis.length) tabela.append(el('div', { class: 'contratos-nada', texto: 'Nenhum contrato neste recorte.' }));

    area.append(
      tabela,
      el('p', { class: 'contratos-rodape' }, [
        icone('info', 14),
        'Assinado, o contrato vai sozinho para o Atilhus Juri. A ZapSign é consultada sozinha até a assinatura.',
      ]),
    );
    return area;
  }

  function devolver(contrato) {
    const motivo = areaTexto('', { placeholder: 'O que precisa ser corrigido' });
    modal({
      titulo: 'Devolver o contrato ao agente',
      corpo: el('div', {}, [campo('Motivo', motivo)]),
      confirmar: 'Devolver',
      aoConfirmar: async () => {
        if (!motivo.value.trim()) throw new Error('Diga o que precisa ser corrigido.');
        await agir(
          () => api.post(`/api/contratos/${contrato.id}/devolver`, { motivo: motivo.value.trim() }),
          'Contrato devolvido ao agente.',
          contrato.id,
        );
      },
    });
  }

  function conferencia(contrato) {
    const correcoes = edicoes.get(contrato.id) || {};
    edicoes.set(contrato.id, correcoes);

    const grade = el('div', { class: 'contratos-campos' });
    for (const [chave, original] of Object.entries(contrato.valores || {})) {
      const valor = correcoes[chave] ?? original ?? '';
      const entrada = entradaTexto(valor);
      entrada.classList.toggle('em-branco', !String(valor).trim());
      entrada.addEventListener('input', () => {
        correcoes[chave] = entrada.value;
        entrada.classList.toggle('em-branco', !entrada.value.trim());
      });
      grade.append(campo(rotuloDoCampo(chave), entrada));
    }

    const emBranco = camposEmBranco(contrato);
    return [
      el('div', { class: 'propriedade contratos-dados' }, [el('span', { texto: 'Dados que vão no contrato' }), grade]),
      el('div', { class: 'contratos-acoes' }, [
        emBranco.length ? el('div', { class: 'aviso-janela', texto: `Em branco: ${emBranco.join(', ')}. Preencha antes de aprovar.` }) : null,
        el('div', { class: 'linha-botoes' }, [
          botao('Aprovar e enviar', {
            tipo: 'principal',
            aoClicar: () =>
              agir(
                () => api.post(`/api/contratos/${contrato.id}/aprovar`, { valores: { ...contrato.valores, ...correcoes } }),
                'Link enviado ao cliente.',
                contrato.id,
              ),
          }),
          botao('Devolver ao agente', { aoClicar: () => devolver(contrato) }),
        ]),
        el('p', { class: 't-xs c-fraco sem-margem', texto: 'Aprovado, o link e o vídeo de como assinar saem no WhatsApp do cliente.' }),
      ]),
    ];
  }

  function andamento(contrato) {
    const bloco = el('div', { class: 'propriedade' }, [el('span', { texto: 'Andamento' })]);

    if (contrato.link && ['link_enviado', 'link_aberto'].includes(contrato.situacao)) {
      bloco.append(
        el('a', { href: contrato.link, target: '_blank', rel: 'noopener', class: 't-sm quebra-palavra', texto: contrato.link }),
        el('div', { class: 'linha-botoes mt-2' }, [
          botao('Consultar agora', {
            pequeno: true,
            icone: 'atualizar',
            aoClicar: () => agir(() => api.post(`/api/contratos/${contrato.id}/consultar`, {}), 'Consulta feita na ZapSign.'),
          }),
        ]),
      );
    }

    if (contrato.situacao === 'assinado') {
      bloco.append(el('p', { class: 't-sm sem-margem', texto: `Assinado em ${dataHora(contrato.assinadoEm)}. Os PDFs estão nos arquivos da conversa.` }));
      const juri = contrato.juri ? JURI[contrato.juri.situacao] : null;
      if (juri) {
        bloco.append(el('div', { class: 'linha-p mt-2' }, [pilula(juri.rotulo, juri.tipo)]));
        if (contrato.juri.erro) bloco.append(el('p', { class: 't-xs c-fraco sem-margem mt-1', texto: contrato.juri.erro }));
        if (['recusado', 'falhou'].includes(contrato.juri.situacao)) {
          bloco.append(
            el('div', { class: 'linha-botoes mt-2' }, [
              botao(contrato.juri.situacao === 'recusado' ? 'Reenviar ao Juri' : 'Tentar agora', {
                pequeno: true,
                aoClicar: () => agir(() => api.post(`/api/contratos/${contrato.id}/juri`, {}), 'Enviado ao Atilhus Juri.'),
              }),
            ]),
          );
        }
      }
    }

    if (grupoDe(contrato) === 'encerrados') {
      bloco.append(
        el('p', {
          class: 't-sm sem-margem',
          texto: contrato.motivoDevolucao
            ? `Motivo: ${contrato.motivoDevolucao}`
            : 'Este contrato não segue mais. Para um novo, peça de novo pela conversa.',
        }),
      );
    }
    if (contrato.erro) bloco.append(el('div', { class: 'alerta-caixa mt-2', texto: contrato.erro }));
    if (contrato.aviso) bloco.append(el('div', { class: 'alerta-caixa mt-2', texto: contrato.aviso }));
    return bloco;
  }

  function painel(contrato) {
    const lado = el('aside', { class: 'contratos-painel' });
    if (!contrato) {
      lado.append(vazio('Escolha um contrato', 'A conferência e o andamento aparecem aqui.', null, 'contrato'));
      return lado;
    }
    const situacao = SITUACOES[contrato.situacao] || { rotulo: contrato.situacao, tipo: '' };
    const caso = casoDo(contrato);
    const modelo = nomesDosModelos[contrato.modelo?.contratoId] || null;

    lado.append(
      el('div', { class: 'contratos-painel-cabeca' }, [
        el('div', { class: 'contratos-painel-nome', texto: contrato.contato }),
        el('div', { class: 't-xs c-fraco', texto: [telefone(contrato.telefone), caso?.nome].filter(Boolean).join(' · ') }),
        el('a', { class: 'contratos-abrir', href: `#/atendimento/${contrato.contatoId}` }, [icone('abrir', 13), 'Abrir a conversa']),
      ]),
      el('div', { class: 'propriedade' }, [
        el('span', { texto: 'Contrato' }),
        el('div', { class: 'linha-p quebra' }, [pilula(situacao.rotulo, situacao.tipo)]),
        el('div', {
          class: 't-sm mt-2',
          texto: modelo
            ? `${modelo}${contrato.modelo?.procuracaoId ? ' · com procuração' : ''}`
            : `Modelo da ZapSign${caso ? ` para ${caso.nome}` : ''}`,
        }),
        el('div', {
          class: 't-xs c-fraco mt-1',
          texto: `Pedido${contrato.pedidoPor?.nome ? ` por ${contrato.pedidoPor.nome}` : ''} em ${dataHora(contrato.pedidoEm || contrato.criadoEm)}`,
        }),
      ]),
    );

    if (contrato.situacao === 'em_conferencia') lado.append(...conferencia(contrato));
    else lado.append(andamento(contrato));
    return lado;
  }

  function desenhar() {
    limpar(container);
    definirAcoes(acoes());
    const visiveis = recorte === 'todos' ? contratos : contratos.filter((c) => grupoDe(c) === recorte);
    /* Sem escolha, abre no primeiro que espera conferencia: e o que se veio
       fazer aqui. */
    if (!contratos.some((c) => c.id === selecionadoId)) {
      selecionadoId = (contratos.find((c) => c.situacao === 'em_conferencia') || visiveis[0] || contratos[0])?.id || null;
    }
    container.append(lista(visiveis), painel(contratos.find((c) => c.id === selecionadoId)));
  }

  /* Contrato muda sozinho (ZapSign, Atilhus Juri, outra pessoa conferindo). */
  ouvir('contrato', async () => {
    if (!document.body.contains(container)) return;
    await carregar();
    desenhar();
  });

  await Promise.all([carregar(), carregarModelos()]);
  desenhar();
  return container;
}
