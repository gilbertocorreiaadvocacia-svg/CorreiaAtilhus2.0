import { cliente, esperar, suite } from './apoio.js';

/**
 * Prova de ponta a ponta, de verdade: uma mensagem chegando pelo webhook (nao
 * pelo Chat de teste) no numero de CADA area cai com o agente de entrada da
 * PROPRIA area, sem vazar para a fila da outra.
 *
 * Pedido do escritorio em 19/10/2026: "verifique que toda vez que o lead for
 * mandar mensagem ele vai ser atendido pelo seu respectivo agente". Os testes
 * que ja existem (workspaces.js) so conferem o campo responsavelPadrao da
 * conexao — nunca uma mensagem de verdade entrando pelo webhook de QR Code.
 * Este arquivo fecha essa lacuna.
 *
 * Depende de testarWorkspacesPorArea ja ter rodado antes (cria os workspaces
 * e, na propria suite, roda "Separar por escritorio" — o que liga os agentes
 * de entrada e aponta o numero de cada area para o agente certo).
 */
export async function testarRoteamentoPorArea({ base, evolucao, chaveEvolucao }) {
  const s = suite('Roteamento por area, pelo webhook de verdade');
  const api = cliente(base);
  await api.entrar();

  const sessao = (await api.get('/api/sessao/eu')).dados;
  const origem = sessao?.workspace;
  const previdenciario = (sessao?.workspaces || []).find((w) => w.area === 'previdenciario');
  const trabalhista = (sessao?.workspaces || []).find((w) => w.area === 'trabalhista');
  if (!s.ok('Previdenciario e Trabalhista ja existem (depende de testarWorkspacesPorArea)', Boolean(previdenciario && trabalhista))) {
    return s;
  }

  async function mensagemDeVerdadeNaArea({ workspace, nomeDoAgenteEsperado, telefone, nomeDoLead, instancia }) {
    await api.post('/api/sessao/workspace', { workspaceId: workspace.id });

    const conexoes = (await api.get('/api/conexoes')).dados || [];
    const numero = conexoes.find((c) => c.tipo === 'qrcode');
    if (!s.ok(`${workspace.nome}: tem numero por QR Code`, Boolean(numero))) return null;

    s.ok(
      `${workspace.nome}: o numero ja esta apontado para o agente de entrada da area ("Separar por escritorio" ja rodou)`,
      numero.responsavelPadrao?.tipo === 'agente' && numero.responsavelPadrao?.nome === nomeDoAgenteEsperado,
      JSON.stringify(numero.responsavelPadrao),
    );

    /* So a chave do servico precisa bater (e o que conferirAssinatura confere,
       whatsapp/drivers/qrcode.js:387-391): nao chama /conectar aqui de
       proposito. Esse numero e o numero DE VERDADE da area, e conectar
       dispara a puxada do historico completo do celular (ver historico.js) —
       o que deixaria um aviso de "sincronizacao concluida" a mais na trilha,
       atrapalhando a suite de Historico que roda depois. O webhook em si nao
       exige sessao aberta, so a chave certa. */
    await api.patch(`/api/conexoes/${numero.id}`, {
      qrcode: { servidor: evolucao, chave: chaveEvolucao, instancia, urlWebhook: base },
    });

    /* A mensagem do lead, exatamente como a Evolution de verdade manda — nao e
       o Chat de teste, nem uma chamada direta a rota de agente. */
    const webhook = await fetch(`${base}/webhook/${numero.id}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', apikey: chaveEvolucao },
      body: JSON.stringify({
        event: 'messages.upsert',
        instance: instancia,
        data: {
          key: { remoteJid: `${telefone}@s.whatsapp.net`, fromMe: false, id: `WA_${instancia}` },
          pushName: nomeDoLead,
          message: { conversation: 'Oi, vi o anuncio de voces e queria entender se tenho direito' },
          messageType: 'conversation',
        },
      }),
    });
    s.ok(`${workspace.nome}: o webhook aceita a mensagem`, webhook.status === 200);
    await esperar(1200);

    const contatos = (await api.get('/api/contatos')).dados?.contatos || [];
    const contato = contatos.find((c) => c.telefone === telefone);
    if (!s.ok(`${workspace.nome}: a mensagem virou conversa`, Boolean(contato))) return null;

    s.ok(
      `${workspace.nome}: a conversa nasce ja com o agente de entrada da area, sem passar por humano`,
      contato.responsavel?.tipo === 'agente' && contato.responsavel?.nome === nomeDoAgenteEsperado && contato.estado === 'ia',
      JSON.stringify({ responsavel: contato.responsavel, estado: contato.estado }),
    );

    return { telefone, agenteId: contato.responsavel?.id };
  }

  const doTrabalhista = await mensagemDeVerdadeNaArea({
    workspace: trabalhista,
    nomeDoAgenteEsperado: 'Triagem Trabalhista',
    telefone: '5581991110001',
    nomeDoLead: 'Lead do Trabalhista',
    instancia: 'area-trabalhista-teste',
  });

  const doPrevidenciario = await mensagemDeVerdadeNaArea({
    workspace: previdenciario,
    nomeDoAgenteEsperado: 'Eduarda (Triagem)',
    telefone: '5581991110002',
    nomeDoLead: 'Lead do Previdenciario',
    instancia: 'area-previdenciario-teste',
  });

  /* A prova de que nao vaza: o agente de uma area nunca e o da outra, e a
     conversa de uma area nunca aparece na fila da outra. */
  if (doTrabalhista && doPrevidenciario) {
    s.ok(
      'o agente que atendeu o Trabalhista nao e o mesmo que atendeu o Previdenciario',
      doTrabalhista.agenteId && doPrevidenciario.agenteId && doTrabalhista.agenteId !== doPrevidenciario.agenteId,
    );

    await api.post('/api/sessao/workspace', { workspaceId: trabalhista.id });
    const naFilaDoTrabalhista = (await api.get('/api/contatos')).dados?.contatos || [];
    s.ok(
      'a conversa do Previdenciario nao aparece na fila do Trabalhista',
      !naFilaDoTrabalhista.some((c) => c.telefone === doPrevidenciario.telefone),
    );

    await api.post('/api/sessao/workspace', { workspaceId: previdenciario.id });
    const naFilaDoPrevidenciario = (await api.get('/api/contatos')).dados?.contatos || [];
    s.ok(
      'a conversa do Trabalhista nao aparece na fila do Previdenciario',
      !naFilaDoPrevidenciario.some((c) => c.telefone === doTrabalhista.telefone),
    );
  }

  await api.post('/api/sessao/workspace', { workspaceId: origem.id });
  return s;
}
