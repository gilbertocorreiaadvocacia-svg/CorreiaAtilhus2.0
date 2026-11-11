import { api } from '../api.js';
import { aviso, botao, cartao, dataHora, el, limpar, selo, vazio } from '../ui.js';

/**
 * A ficha do cliente de um contrato fechado.
 *
 * Pedido do escritorio em 11/11/2026: "todas as vezes que o contrato for
 * fechado ele tem que mandar um relatorio do cliente, dizer quem ou qual
 * agente fechou o contrato e mandar junto com a documentacao do cliente com
 * todos os dados".
 *
 * E para onde o aviso de "Contrato fechado" leva (web/js/notificacoes.js). O
 * servidor monta o conteudo (servidor/nucleo/ficha-do-contrato.js); aqui a
 * tela so desenha, baixa os documentos e imprime.
 *
 * QUEM FECHOU SAO DUAS MAOS, e a ficha mostra as duas separadas: o agente de
 * IA que conduziu e pediu o contrato, e a pessoa que conferiu e mandou o link
 * de assinatura. Juntar num "fechou por" unico seria escolher uma e esconder a
 * outra — e a divisao e a mesma do relatorio de contratos.
 */

/* O texto da descricao vem em paragrafos separados por linha em branco. */
const paragrafosDe = (texto) =>
  String(texto || '')
    .split(/\n\s*\n/)
    .map((t) => t.replace(/\s+/g, ' ').trim())
    .filter(Boolean);

const tamanhoEmTexto = (bytes) => {
  if (!bytes) return '';
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`;
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
};

export async function paginaFichaDoContrato({ parametros = [], definirAcoes = () => {} } = {}) {
  const alvo = parametros[0];
  const raiz = el('div');

  if (!alvo) {
    raiz.append(vazio('Ficha sem caso', 'Abra a ficha pelo aviso de contrato fechado ou pela conversa do cliente.'));
    return raiz;
  }

  /*
   * A ficha abre pelo contrato OU pela conversa, e o prefixo do id diz qual.
   *
   * A maioria dos casos fechados deste escritorio nao tem contrato da ZapSign
   * (sao fechados na mao, ou vieram do historico antigo), e enquanto a ficha
   * so existiu por contrato ela simplesmente nao abria para eles. Conversa
   * nasce com `ctt_` (novoId), contrato com `ctr_`.
   */
  const porConversa = String(alvo).startsWith('ctt_');
  const caminho = porConversa ? `/api/contatos/${alvo}/ficha` : `/api/contratos/${alvo}/ficha`;

  let ficha = null;
  try {
    ficha = await api.get(caminho);
  } catch (erro) {
    raiz.append(
      vazio(
        'Não consegui abrir esta ficha',
        erro.codigo === 404 ? 'O caso não existe ou é de uma conversa que você não pode ver.' : erro.message,
      ),
    );
    return raiz;
  }

  const { contrato, cliente, dados, documentos, descricao } = ficha;

  /*
   * Baixar tudo: dispara o download de cada documento, um a um.
   *
   * Sem .zip de proposito. O sistema nao tem dependencia nenhuma (ver o
   * Dockerfile), e compactar no servidor significaria uma biblioteca nova so
   * para juntar tres ou quatro PDFs. O intervalo entre um e outro e porque o
   * navegador descarta downloads disparados no mesmo instante.
   */
  async function baixarTudo() {
    if (!documentos.length) return;
    for (const doc of documentos) {
      const link = el('a', {
        href: `/api/contatos/${cliente.id}/arquivos/${doc.id}?baixar=1`,
        download: doc.nome,
      });
      link.click();
      await new Promise((pronto) => setTimeout(pronto, 400));
    }
    aviso(`${documentos.length === 1 ? 'Documento baixado' : `${documentos.length} documentos baixados`}.`, 'sucesso');
  }

  /*
   * O relatorio do caso: UM PDF com o relatorio e, atras dele, os documentos
   * do cliente. Pedido do escritorio em 11/11/2026 — "um botao em que ao
   * clicar ele vai fazer o relatorio do caso, com todos os dados do cliente e
   * com suas documentacoes". E o botao principal da tela: imprimir a ficha
   * sozinha e util, mas o que se protocola e o pacote.
   *
   * O servidor monta e devolve o PDF pronto (nucleo/relatorio-do-caso.js);
   * aqui so se pede e se guarda. Costurar PDF no navegador nao da: ele imprime
   * o que a pagina desenha, e nao sabe juntar um PDF que ja existe.
   */
  async function gerarRelatorio() {
    aviso('Montando o relatório do caso…', '');
    try {
      const resposta = await fetch(porConversa ? `/api/contatos/${alvo}/relatorio.pdf` : `/api/contratos/${alvo}/relatorio.pdf`);
      if (!resposta.ok) {
        const erro = await resposta.json().catch(() => null);
        throw new Error(erro?.erro || `Erro ${resposta.status}`);
      }
      const blob = await resposta.blob();
      /* O nome vem do proprio servidor (Content-Disposition), e nao montado de
         novo aqui: duas receitas para o mesmo nome acabam divergindo, e o
         servidor ja sabe limpar acento e caractere que o sistema de arquivos
         nao aceita. */
      const dispo = resposta.headers.get('Content-Disposition') || '';
      const achado = /filename\*=UTF-8''([^;]+)/i.exec(dispo);
      const nome = achado ? decodeURIComponent(achado[1]) : 'relatorio-do-caso.pdf';
      const link = el('a', { href: URL.createObjectURL(blob), download: nome });
      link.click();
      URL.revokeObjectURL(link.href);

      /* Anexo que nao entrou e avisado aqui, e nao so escrito no fim do PDF:
         quem clicou e foi protocolar pode nao abrir o arquivo antes. */
      const falharam = Number(resposta.headers.get('X-Documentos-Falharam') || 0);
      if (falharam) {
        aviso(`Relatório gerado, mas ${falharam} ${falharam === 1 ? 'documento não entrou' : 'documentos não entraram'}. A última página do PDF diz quais.`, 'erro');
      } else {
        aviso(`Relatório gerado com ${documentos.length} ${documentos.length === 1 ? 'documento' : 'documentos'}.`, 'sucesso');
      }
    } catch (erro) {
      aviso(`Não consegui gerar o relatório: ${erro.message}`, 'erro');
    }
  }

  definirAcoes(
    botao('Abrir a conversa', { icone: 'conversas', pequeno: true, aoClicar: () => (location.hash = `#/atendimento/${cliente.id}`) }),
    documentos.length ? botao('Baixar documentos', { icone: 'baixo', pequeno: true, aoClicar: baixarTudo }) : null,
    botao('Imprimir a ficha', { icone: 'contrato', pequeno: true, aoClicar: imprimir }),
    botao('Gerar relatório do caso', { tipo: 'principal', icone: 'contrato', pequeno: true, aoClicar: gerarRelatorio }),
  );

  /* ---------------- Quem fechou ---------------- */

  const maos = [];
  if (contrato.agente) {
    maos.push(
      el('div', { class: 'ficha-mao' }, [
        el('div', { class: 'ficha-mao-papel', texto: 'Conduziu o atendimento' }),
        el('div', { class: 'ficha-mao-nome', texto: contrato.agente.nome }),
        el('div', { class: 'ficha-mao-nota', texto: 'Agente de IA — pediu o contrato' }),
      ]),
    );
  }
  if (contrato.aprovadoPor) {
    maos.push(
      el('div', { class: 'ficha-mao' }, [
        el('div', { class: 'ficha-mao-papel', texto: contrato.aprovadoPor.moveuAColuna ? 'Fechou o caso' : 'Aprovou e enviou' }),
        el('div', { class: 'ficha-mao-nome', texto: contrato.aprovadoPor.nome }),
        el('div', {
          class: 'ficha-mao-nota',
          texto: contrato.aprovadoPor.moveuAColuna
            ? 'Moveu a conversa para a coluna de contrato fechado'
            : 'Conferiu a ficha e mandou o link de assinatura',
        }),
      ]),
    );
  }
  if (!maos.length) {
    maos.push(
      el('div', { class: 'ficha-mao' }, [
        el('div', { class: 'ficha-mao-papel', texto: 'Sem atribuição' }),
        el('div', { class: 'ficha-mao-nome', texto: '—' }),
        el('div', { class: 'ficha-mao-nota', texto: 'Sem agente e sem registro de quem fechou' }),
      ]),
    );
  }

  /* ---------------- Cabeça ---------------- */

  raiz.append(
    el('div', { class: 'ficha-cabeca' }, [
      el('div', {}, [
        el('h2', { class: 'cartao-titulo', texto: cliente.nome }),
        el('p', { class: 'bloco-legenda' }, [
          document.createTextNode(
            contrato.assinadoEm
              ? `${contrato.temZapsign ? 'Contrato assinado' : 'Caso fechado'} em ${dataHora(contrato.assinadoEm)}.`
              : 'Caso ainda em andamento.',
          ),
          contrato.temZapsign
            ? null
            : el('span', { class: 'c-fraco', texto: ' Fechado fora do sistema: não há contrato assinado pela ZapSign nesta conversa.' }),
        ]),
      ]),
      el('div', { class: 'linha-p quebra' }, [
        cliente.status ? selo(cliente.status.nome, '', cliente.status.cor) : null,
        ...cliente.etiquetas.map((e) => selo(e.nome, '', e.cor)),
      ]),
    ]),
    el('div', { class: 'ficha-maos mb-4' }, maos),
  );

  /* ---------------- Dados e documentos ---------------- */

  const linhaDeDado = (rotulo, valor) =>
    valor
      ? el('div', { class: 'ficha-dado' }, [
          el('span', { class: 'ficha-dado-rotulo', texto: rotulo }),
          el('span', { class: 'ficha-dado-valor', texto: valor }),
        ])
      : null;

  const blocoDeDados = el('div', { class: 'ficha-dados' }, [
    linhaDeDado('Telefone', cliente.telefone),
    ...dados.map((d) => linhaDeDado(d.rotulo, d.valor)),
    linhaDeDado('Origem', cliente.origem?.nome),
    linhaDeDado('Departamento', cliente.departamento?.nome),
    linhaDeDado('Responsável agora', cliente.responsavel?.nome),
    linhaDeDado('Cliente desde', cliente.criadoEm ? dataHora(cliente.criadoEm) : null),
  ]);

  const listaDeDocumentos = documentos.length
    ? el(
        'div',
        { class: 'ficha-documentos' },
        documentos.map((doc) =>
          el('a', {
            class: 'ficha-documento',
            href: `/api/contatos/${cliente.id}/arquivos/${doc.id}`,
            target: '_blank',
            rel: 'noopener',
          }, [
            el('span', { class: 'ficha-documento-nome', texto: doc.nome }),
            el('span', { class: 'ficha-documento-nota', texto: [tamanhoEmTexto(doc.tamanho), doc.enviadoPor].filter(Boolean).join(' · ') }),
          ]),
        ),
      )
    : vazio('Nenhum documento guardado', 'Os PDFs assinados entram aqui sozinhos; o resto é o que a equipe anexou na conversa.');

  /*
   * A descricao do caso, antes dos dados: quem abre precisa saber DO QUE se
   * trata antes de conferir CPF. O texto e o resumo que o sistema ja escreve
   * da conversa — o mesmo que aparece no alto da lateral — e nao um campo novo.
   */
  /* A redacao detalhada, quando ja existe. Ela e escrita na hora de gerar o
     relatorio (custa credito), entao aqui a ficha so mostra o que ja ha — e
     diz onde consegui-la quando ainda nao ha. */
  const corpoDaDescricao = descricao?.texto
    ? el('div', {}, [
        el(
          'div',
          { class: 'ficha-redacao' },
          paragrafosDe(descricao.texto).map((paragrafo) => el('p', { texto: paragrafo })),
        ),
        el('p', {
          class: 'painel-resumo-rodape',
          texto: `Escrita pelo agente de IA a partir da conversa e dos documentos${descricao.redigidaEm ? ` · ${dataHora(descricao.redigidaEm)}` : ''}`,
        }),
      ])
    : el('div', {}, [
    descricao?.campos?.length
      ? el(
          'div',
          { class: 'ficha-descricao' },
          descricao.campos.map((campo) =>
            el('div', { class: 'ficha-descricao-linha' }, [
              el('span', { class: 'ficha-descricao-rotulo', texto: campo.rotulo }),
              el('span', { texto: campo.texto }),
            ]),
          ),
        )
      : el('p', { class: 'painel-resumo-vazio', texto: 'Conversa curta demais para descrever: não há mensagens suficientes.' }),
    descricao?.campos?.length
      ? el('p', {
          class: 'painel-resumo-rodape',
          texto: descricao.daIa
            ? `Resumo escrito pelo agente de IA${descricao.geradoEm ? ` em ${dataHora(descricao.geradoEm)}` : ''}${descricao.novasDepois ? ` · ${descricao.novasDepois} ${descricao.novasDepois === 1 ? 'mensagem depois dele' : 'mensagens depois dele'}` : ''}`
            : 'Resumo montado automaticamente da conversa, sem leitura do agente.',
        })
      : null,
        el('p', {
          class: 'painel-resumo-rodape',
          texto: 'A descrição detalhada do caso é escrita quando você gera o relatório.',
        }),
      ]);

  raiz.append(
    el('div', { class: 'mb-4' }, [
      cartao(
        descricao?.tipoDeCaso?.nome ? `Descrição do caso · ${descricao.tipoDeCaso.nome}` : 'Descrição do caso',
        'O que o sistema entendeu da conversa.',
        corpoDaDescricao,
      ),
    ]),
  );

  /* O caminho do caso: por onde passou e quando. */
  if (descricao?.caminho?.length) {
    raiz.append(
      el('div', { class: 'mb-4' }, [
        cartao(
          'Caminho do caso',
          'As mudanças de coluna, da mais antiga para a mais recente.',
          el(
            'ol',
            { class: 'funil-historico' },
            descricao.caminho.map((passo) =>
              el('li', { class: 'funil-historico-item' }, [
                el('span', { class: 'funil-historico-quando', texto: dataHora(passo.em) }),
                el('span', { class: 'funil-historico-corpo' }, [
                  el('span', { class: 'funil-historico-nome', texto: passo.nome }),
                  passo.autor ? el('span', { class: 'funil-historico-autor', texto: `por ${passo.autor}` }) : null,
                ]),
              ]),
            ),
          ),
        ),
      ]),
    );
  }

  raiz.append(
    el('div', { class: 'grade g2' }, [
      cartao('Dados do cliente', 'O que está preenchido na conversa.', dados.length || cliente.telefone ? blocoDeDados : vazio('Sem dados preenchidos', 'Nenhuma variável foi preenchida nesta conversa.')),
      cartao(`Documentos (${documentos.length})`, 'Clique para abrir; o botão da barra baixa todos.', listaDeDocumentos),
    ]),
  );

  /*
   * Impressao: a mesma ideia do relatorio de contratos — uma janela so com a
   * ficha e o timbre, e a impressao do navegador. Sem dependencia nova.
   * Os documentos entram como LISTA, nao como conteudo: o que se imprime aqui
   * e a ficha, e os PDFs se baixam pelo botao ao lado.
   */
  function imprimir() {
    const escapar = (t) => String(t || '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
    const linha = (r, v) => (v ? `<tr><th>${escapar(r)}</th><td>${escapar(v)}</td></tr>` : '');
    const html = `<!doctype html><html lang="pt-BR"><head><meta charset="utf-8">
      <title>${escapar(cliente.nome)} — ficha do contrato</title>
      <style>
        * { box-sizing: border-box; }
        body { font: 14px/1.5 -apple-system, Segoe UI, Roboto, sans-serif; color: #141414; margin: 32px; }
        header { display: flex; align-items: center; gap: 16px; border-bottom: 2px solid #141414; padding-bottom: 12px; margin-bottom: 20px; }
        header img { height: 48px; width: auto; flex: none; }
        h1 { font-size: 20px; margin: 0; }
        .sub { color: #555; margin-top: 4px; }
        h2 { font-size: 15px; margin: 24px 0 8px; }
        table { width: 100%; border-collapse: collapse; }
        th, td { text-align: left; padding: 7px 10px; border-bottom: 1px solid #ddd; vertical-align: top; }
        th { width: 210px; color: #555; font-weight: 600; }
        ol { margin: 0; padding-left: 20px; }
        footer { margin-top: 32px; color: #999; font-size: 12px; }
        @media print { body { margin: 0; } table { break-inside: avoid; } }
      </style></head><body>
      <header>
        <img src="${location.origin}/assets/logo.png" alt="" onerror="this.remove()">
        <div>
          <h1>Correia Advogados — Ficha do contrato</h1>
          <div class="sub">${escapar(cliente.nome)} · ${contrato.assinadoEm ? `assinado em ${escapar(dataHora(contrato.assinadoEm))}` : escapar(contrato.situacao || '')}</div>
        </div>
      </header>
      <h2>Descrição do caso${descricao?.tipoDeCaso?.nome ? ` — ${escapar(descricao.tipoDeCaso.nome)}` : ''}</h2>
      <table>
        ${(descricao?.campos || []).map((campo) => linha(campo.rotulo, campo.texto)).join('')}
        ${!descricao?.campos?.length ? '<tr><td colspan="2">Conversa curta demais para descrever.</td></tr>' : ''}
      </table>
      ${descricao?.caminho?.length ? `<h2>Caminho do caso</h2><table>${descricao.caminho.map((p) => linha(dataHora(p.em), `${p.nome}${p.autor ? ` — ${p.autor}` : ''}`)).join('')}</table>` : ''}
      <h2>Quem fechou</h2>
      <table>
        ${linha('Conduziu o atendimento', contrato.agente?.nome)}
        ${linha('Aprovou e enviou', contrato.aprovadoPor?.nome)}
        ${!contrato.agente && !contrato.aprovadoPor ? '<tr><th>Atribuição</th><td>Contrato criado à mão, sem agente e sem aprovação registrada.</td></tr>' : ''}
      </table>
      <h2>Dados do cliente</h2>
      <table>
        ${linha('Telefone', cliente.telefone)}
        ${dados.map((d) => linha(d.rotulo, d.valor)).join('')}
        ${linha('Origem', cliente.origem?.nome)}
        ${linha('Departamento', cliente.departamento?.nome)}
        ${linha('Etiquetas', cliente.etiquetas.map((e) => e.nome).join(', '))}
        ${linha('Cliente desde', cliente.criadoEm ? dataHora(cliente.criadoEm) : '')}
      </table>
      <h2>Documentos (${documentos.length})</h2>
      ${documentos.length ? `<ol>${documentos.map((d) => `<li>${escapar(d.nome)}${d.enviadoPor ? ` — ${escapar(d.enviadoPor)}` : ''}</li>`).join('')}</ol>` : '<p>Nenhum documento guardado na conversa.</p>'}
      <footer>Gerado em ${escapar(dataHora(new Date().toISOString()))} pelo Atilhus Chat.</footer>
      </body></html>`;

    const janela = window.open('', '_blank');
    if (!janela) {
      aviso('O navegador bloqueou a janela de impressão. Permita pop-ups para imprimir.', 'erro');
      return;
    }
    janela.document.write(html);
    janela.document.close();
    janela.focus();
    setTimeout(() => janela.print(), 300);
  }

  return raiz;
}
