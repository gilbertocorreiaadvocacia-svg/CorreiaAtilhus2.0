import { cliente, esperar, suite } from './apoio.js';

/**
 * A descricao do caso: texto corrido e detalhado no relatorio
 * (ia/descricao-do-caso.js).
 *
 * Pedido do escritorio em 11/11/2026: "quero bem mais detalhado e sem topicos".
 * O relatorio usava o resumo da conversa, que e curto e em campos por desenho.
 *
 * O QUE NAO PODE FALHAR:
 *
 *  - a redacao entra no PDF em TEXTO CORRIDO. Se os campos do resumo voltarem
 *    a aparecer junto, os topicos voltam pela porta dos fundos;
 *  - ela e GUARDADA: baixar o mesmo relatorio de novo nao chama a IA outra vez
 *    nem cobra de novo. Um relatorio e baixado duas ou tres vezes seguidas
 *    (conferir, imprimir, anexar), e pagar tres vezes pela mesma redacao seria
 *    desperdicio puro;
 *  - mensagem nova INVALIDA a guardada, senao o relatorio de amanha contaria a
 *    historia de ontem;
 *  - sem IA configurada o relatorio SAI ASSIM MESMO. Melhor um relatorio sem a
 *    redacao do que nenhum relatorio — e e o caminho mais provavel de quebrar,
 *    porque depende de coisa de fora.
 */
/*
 * A marca que a Anthropic de mentira usa para saber que a chamada e desta
 * suite, e nao de um agente que disparou sozinho no meio dela.
 *
 * E um trecho do PROPRIO prompt de producao (REGRAS, em ia/descricao-do-caso.js),
 * como o arquivo da falsa recomenda: nao se inventa cabecalho novo no codigo
 * de producao so para o teste se reconhecer aqui dentro.
 */
const MARCA = 'DESCRIÇÃO DO CASO';

const REDACAO = `Rick Nunes procurou o escritorio pelo Instagram depois de um acidente de trabalho. Ele contou que caiu de uma escada enquanto trabalhava e que ficou com uma limitacao no joelho direito, que o incomoda ate hoje ao subir degraus e ao ficar muito tempo em pe.

Ao longo do atendimento confirmou que estava registrado na epoca do acidente e que recebeu auxilio-doenca por alguns meses. Disse que voltou a trabalhar na mesma funcao e que nao chegou a pedir nenhum outro beneficio depois da alta.

O caso foi encaminhado para a proposta e o cliente aceitou os honorarios. Hoje aguarda a coleta dos documentos que faltam para o protocolo.`;

export async function testarDescricaoDoCaso({ base, anthropic }) {
  const s = suite('Descricao do caso no relatorio');
  const api = cliente(base);
  await api.entrar();
  const falsa = cliente(anthropic);
  const roteiro = (itens) => falsa.post('/__roteiro', { roteiro: itens, marca: MARCA });
  /* `/__chamadas` responde { total, chamadas, agentes }. A falsa ZERA a
     contagem a cada roteiro novo, entao cada trecho abaixo conta a partir de
     zero — e por isso o roteiro vem sempre logo antes do que ele serve. */
  const chamadas = async () => (await falsa.get('/__chamadas')).dados?.total ?? 0;

  const simulador = ((await api.get('/api/conexoes')).dados || []).find((c) => c.tipo === 'simulador');
  if (!s.ok('ha conexao de simulador', Boolean(simulador))) return s;

  const criadas = [];
  try {
    const telefone = `3293${String(Date.now()).slice(-6)}1`;
    const criada = await api.post('/api/simulador/mensagem', {
      conexaoId: simulador.id,
      telefone,
      nome: 'Rick da Descricao',
      conteudo: 'Cai de uma escada no servico e fiquei com sequela no joelho',
    });
    const contatoId = criada.dados?.contatoId;
    criadas.push(contatoId);
    if (!s.ok('a conversa de teste nasceu', Boolean(contatoId))) return s;

    const baixar = () => api.get(`/api/contatos/${contatoId}/relatorio.pdf`);
    const quantasMensagens = async () => ((await api.get(`/api/contatos/${contatoId}/mensagens`)).dados?.mensagens || []).length;

    /*
     * A descricao exige pelo menos duas mensagens: com uma so nao ha caso para
     * descrever, e ela nem chama a IA.
     *
     * As duas sao do CLIENTE, mandadas aqui: esperar um agente responder faria
     * este teste depender de haver agente ligado, de ele pegar esta conversa e
     * de o roteiro da IA de mentira estar livre naquele instante — tres coisas
     * que nao sao o que ele afirma. Ja aconteceu: a conversa ficou com uma
     * mensagem so e cinco assercoes reprovaram por isso.
     */
    const esperarConversa = async () => {
      for (let i = 0; i < 40; i += 1) {
        if ((await quantasMensagens()) >= 2) return true;
        await esperar(100);
      }
      return false;
    };

    await api.post('/api/simulador/mensagem', {
      conexaoId: simulador.id,
      telefone,
      conteudo: 'Foi em marco deste ano, eu trabalhava registrado numa construtora',
    });
    s.ok('a conversa tem mensagem suficiente para descrever', await esperarConversa(), String(await quantasMensagens()));

    /* --- 1. Sem IA configurada: o relatorio tem que sair assim mesmo ----- */
    await api.patch('/api/integracoes', { ia: { chaveAnthropic: null } });
    const semIa = await baixar();
    s.ok(
      'sem IA configurada o relatorio sai do mesmo jeito',
      semIa.status === 200 && String(semIa.texto || '').startsWith('%PDF-'),
      `${semIa.status} ${String(semIa.texto || '').slice(0, 10)}`,
    );

    /* --- 2. Com IA: a redacao entra no PDF ------------------------------ */
    await api.patch('/api/integracoes', { ia: { chaveAnthropic: 'chave-de-mentira' } });
    /* `texto` e o campo que a falsa le; `corpo` ela ignora, e a resposta
       viraria o texto padrao dela, curto demais para passar por redacao. */
    await roteiro([{ status: 200, texto: REDACAO }]);

    const comIa = await baixar();
    s.ok('com IA o relatorio continua saindo', comIa.status === 200 && String(comIa.texto || '').startsWith('%PDF-'), String(comIa.status));
    s.ok('e a IA foi chamada uma vez para escrever', (await chamadas()) === 1, String(await chamadas()));

    /* A ficha passa a devolver o texto redigido, que e o que a tela mostra. */
    const ficha = (await api.get(`/api/contatos/${contatoId}/ficha`)).dados;
    s.ok('a ficha devolve a redacao', /escada/.test(ficha?.descricao?.texto || ''), String(ficha?.descricao?.texto || '').slice(0, 80));
    s.ok(
      'em texto corrido, sem os rotulos do resumo',
      !/^(Quem é|O que busca|Em que pé está):/m.test(ficha?.descricao?.texto || ''),
      String(ficha?.descricao?.texto || '').slice(0, 120),
    );
    s.ok(
      'e em mais de um paragrafo, que e o que "mais detalhado" quer dizer',
      String(ficha?.descricao?.texto || '').split(/\n\s*\n/).filter((t) => t.trim()).length >= 3,
      String(String(ficha?.descricao?.texto || '').split(/\n\s*\n/).length),
    );

    /* --- 3. Guardada: baixar de novo nao paga de novo ------------------- */
    const antesDeRepetir = await chamadas();
    const denovo = await baixar();
    s.ok('baixar o mesmo relatorio de novo funciona', denovo.status === 200);
    s.ok(
      'e NAO chama a IA outra vez: a redacao estava guardada',
      (await chamadas()) === antesDeRepetir,
      `${antesDeRepetir} -> ${await chamadas()}`,
    );
    s.ok('a contagem conferida e mesmo a de uma chamada so', antesDeRepetir === 1, String(antesDeRepetir));

    /* --- 4. Mensagem nova invalida a guardada --------------------------- */
    await api.post('/api/simulador/mensagem', { conexaoId: simulador.id, telefone, conteudo: 'Esqueci de dizer: tambem machuquei o ombro' });
    await esperar(300);
    await roteiro([{ status: 200, texto: `${REDACAO}

Depois acrescentou que tambem machucou o ombro.` }]);
    const antesDaNova = await chamadas();
    await baixar();
    s.ok(
      'mensagem nova faz a redacao ser escrita de novo',
      (await chamadas()) === antesDaNova + 1,
      `${antesDaNova} -> ${await chamadas()}`,
    );
    const atualizada = (await api.get(`/api/contatos/${contatoId}/ficha`)).dados;
    s.ok('e a nova traz o que o cliente acrescentou', /ombro/.test(atualizada?.descricao?.texto || ''), String(atualizada?.descricao?.texto || '').slice(-80));

    /* --- 5. IA fora do ar: o relatorio ainda sai ------------------------ */
    await api.post('/api/contatos', { conexaoId: simulador.id, telefone: `${telefone}9`, nome: 'Sem Redacao' });
    await roteiro([{ status: 500, mensagem: 'explodiu' }]);
    await api.post('/api/simulador/mensagem', { conexaoId: simulador.id, telefone, conteudo: 'mais uma coisa' });
    await esperar(300);
    const comErro = await baixar();
    s.ok(
      'IA fora do ar nao impede o relatorio',
      comErro.status === 200 && String(comErro.texto || '').startsWith('%PDF-'),
      `${comErro.status} ${String(comErro.texto || '').slice(0, 10)}`,
    );
  } finally {
    await falsa.post('/__roteiro', { roteiro: [] });
    await api.patch('/api/integracoes', { ia: { chaveAnthropic: null } });
    for (const id of criadas.filter(Boolean)) await api.delete(`/api/contatos/${id}`);
  }
  return s;
}
