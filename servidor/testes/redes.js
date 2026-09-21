import crypto from 'node:crypto';
import { cliente, esperar, suite } from './apoio.js';
import { CONTA_INSTAGRAM, CONTA_TIKTOK } from './redes-falsas.js';

/**
 * Instagram (Direct) e TikTok (DM) de ponta a ponta, contra as redes de
 * mentira (redes-falsas.js).
 *
 * O que nao pode falhar: a mensagem assinada vira conversa SEM telefone, com a
 * conta da pessoa; a resposta sai para o codigo certo; o eco da nossa propria
 * mensagem nao duplica; evento sem assinatura (ou velho, no TikTok) nao entra;
 * a origem sai do canal, e o anuncio vira trafego pago; o token vencido do
 * TikTok e renovado sozinho; e o contrato do lead do TikTok volta para o
 * TikTok com o telefone em hash — e o de fora do TikTok, nao.
 */
export async function testarRedes({ base, redes }) {
  const s = suite('Instagram e TikTok');
  const api = cliente(base);
  await api.entrar();

  const chamadas = async () => (await (await fetch(`${redes}/__chamadas`)).json()).chamadas;
  const limpar = () => fetch(`${redes}/__limpar`, { method: 'POST' });
  const conversas = async () => (await api.get('/api/contatos?aba=todas&limite=500')).dados?.contatos || [];
  const doCanal = async (idCanal) => (await conversas()).find((c) => c.idCanal === idCanal);
  const mensagensDe = async (id) => {
    const r = await api.get(`/api/contatos/${id}/mensagens`);
    return Array.isArray(r.dados) ? r.dados : r.dados?.mensagens || [];
  };
  const criadas = [];
  const contatosCriados = [];

  try {
    /* ================= Instagram ================= */

    const ig = (await api.post('/api/conexoes', { nome: 'Instagram do escritorio', tipo: 'instagram' })).dados;
    criadas.push(ig?.id);
    if (!s.ok('conexao do Instagram nasce com o webhook do app', ig?.webhookUrl === '/webhook/instagram', ig?.webhookUrl)) return s;
    await api.patch(`/api/conexoes/${ig.id}`, { instagram: { contaId: CONTA_INSTAGRAM, token: 'ig-token', appSecret: 'segredo-ig' } });
    const lida = ((await api.get('/api/conexoes')).dados || []).find((c) => c.id === ig.id);
    s.ok('o token e a chave do app voltam mascarados', lida?.instagram?.token === '***' && lida?.instagram?.appSecret === '***');

    const teste = await api.post(`/api/conexoes/${ig.id}/testar`);
    s.ok('testar confere a conta e mostra o @', teste.dados?.ok === true && teste.dados?.numero === '@correia.adv', JSON.stringify(teste.dados));
    s.ok('e liga a entrega de mensagens da conta', (await chamadas()).some((c) => c.caminho === '/ig/me/subscribed_apps'));

    const verificacao = await fetch(
      `${base}/webhook/instagram?hub.mode=subscribe&hub.verify_token=${lida.instagram.verifyToken}&hub.challenge=DESAFIO-IG`,
    );
    s.ok('a Meta confirma o webhook com o token de verificacao', verificacao.status === 200 && (await verificacao.text()) === 'DESAFIO-IG');

    const eventoIg = (pessoa, message, extra = {}) => ({
      object: 'instagram',
      entry: [{ id: CONTA_INSTAGRAM, time: Date.now(), messaging: [{ sender: { id: pessoa }, recipient: { id: CONTA_INSTAGRAM }, timestamp: Date.now(), message, ...extra }] }],
    });
    const enviarIg = (corpo, segredo = 'segredo-ig') => {
      const bruto = JSON.stringify(corpo);
      return fetch(`${base}/webhook/instagram`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-hub-signature-256': `sha256=${crypto.createHmac('sha256', segredo).update(bruto).digest('hex')}`,
        },
        body: bruto,
      });
    };

    const falsa = await enviarIg(eventoIg('9001', { mid: 'IG-IN-1', text: 'Oi! Quero saber do BPC' }), 'segredo-errado');
    s.ok('evento com assinatura errada e recusado', falsa.status === 401);
    s.ok('e nao vira conversa', !(await doCanal('9001')));

    await enviarIg(eventoIg('9001', { mid: 'IG-IN-1', text: 'Oi! Quero saber do BPC' }));
    await esperar(900);
    const maria = await doCanal('9001');
    contatosCriados.push(maria?.id);
    s.ok('o Direct vira conversa, sem telefone', Boolean(maria) && maria.canal === 'instagram' && !maria.telefone, JSON.stringify(maria && { canal: maria.canal, telefone: maria.telefone }));
    s.ok('com o nome e o @ do perfil', maria?.nome === 'Maria Instagram' && maria?.usuarioCanal === 'maria.ig', JSON.stringify({ nome: maria?.nome, usuario: maria?.usuarioCanal }));
    s.ok('a origem e o Instagram', maria?.origem?.canal === 'instagram', JSON.stringify(maria?.origem));
    s.ok('a janela de 24 horas esta aberta', maria?.janela?.horas === 24 && maria?.janela?.aberta === true, JSON.stringify(maria?.janela));

    await limpar();
    const resposta = await api.post(`/api/contatos/${maria.id}/mensagens`, { conteudo: 'Ola, Maria! Sou do escritorio.' });
    const saiu = (await chamadas()).find((c) => c.caminho === `/ig/${CONTA_INSTAGRAM}/messages` && c.corpo?.message?.text);
    s.ok('a resposta sai para a conta certa', saiu?.corpo?.recipient?.id === '9001' && saiu?.corpo?.message?.text === 'Ola, Maria! Sou do escritorio.', JSON.stringify(saiu?.corpo));
    s.ok('e fica marcada como enviada, com o id da Meta', resposta.dados?.situacao === 'enviada' && /^IGMID_/.test(resposta.dados?.idExterno || ''), JSON.stringify(resposta.dados));

    await limpar();
    await api.post(`/api/contatos/${maria.id}/mensagens`, { conteudo: `${'Texto longo do agente. '.repeat(110)}` });
    const pedacos = (await chamadas()).filter((c) => c.corpo?.message?.text);
    s.ok('texto acima de 1.000 caracteres sai em pedacos', pedacos.length === 3 && pedacos.every((p) => p.corpo.message.text.length <= 1000), `${pedacos.length} pedacos`);

    /* O eco: a Meta devolve a nossa mensagem com is_echo. */
    await enviarIg({
      object: 'instagram',
      entry: [{ id: CONTA_INSTAGRAM, messaging: [{ sender: { id: CONTA_INSTAGRAM }, recipient: { id: '9001' }, message: { mid: resposta.dados?.idExterno, text: 'Ola, Maria! Sou do escritorio.', is_echo: true } }] }],
    });
    await esperar(700);
    const iguais = (await mensagensDe(maria.id)).filter((m) => m.conteudo === 'Ola, Maria! Sou do escritorio.');
    s.ok('o eco da nossa mensagem nao duplica', iguais.length === 1, `${iguais.length} vezes`);

    await enviarIg(eventoIg('9001', { mid: 'IG-IN-2', attachments: [{ type: 'image', payload: { url: `${redes}/ig-anexo.jpg` } }] }));
    await esperar(900);
    const foto = (await mensagensDe(maria.id)).find((m) => m.idExterno === 'IG-IN-2');
    s.ok('a imagem do Direct e baixada e guardada aqui', foto?.tipo === 'imagem' && String(foto?.midia?.url || '').startsWith('/midia/'), JSON.stringify(foto?.midia));

    await enviarIg(
      eventoIg('9002', { mid: 'IG-IN-3', text: 'Vi o anuncio' }, { referral: { source: 'ADS', type: 'OPEN_THREAD', ad_id: '120200000', ads_context_data: { ad_title: 'BPC para idosos' } } }),
    );
    await esperar(900);
    const jose = await doCanal('9002');
    contatosCriados.push(jose?.id);
    s.ok('quem vem do anuncio do Instagram cai em "Trafego pago · Instagram"', jose?.origem?.canal === 'anuncio_instagram', JSON.stringify(jose?.origem));
    s.ok('com o anuncio guardado', jose?.rastroDeOrigem?.title === 'BPC para idosos' && jose?.rastroDeOrigem?.sourceID === '120200000');

    /* A Meta assina com uma de duas chaves do app; vale qualquer uma guardada. */
    await api.patch(`/api/conexoes/${ig.id}`, { instagram: { appSecretMeta: 'segredo-do-app-meta' } });
    const comAOutra = await enviarIg(eventoIg('9003', { mid: 'IG-IN-4', text: 'Boa tarde' }), 'segredo-do-app-meta');
    await esperar(800);
    const pelaOutra = await doCanal('9003');
    contatosCriados.push(pelaOutra?.id);
    s.ok('a assinatura com a chave secreta do app (Basico) tambem vale', comAOutra.status === 200 && Boolean(pelaOutra), String(comAOutra.status));
    const eventosIg = (await api.get(`/api/conexoes/${ig.id}/eventos`)).dados || [];
    s.ok('a assinatura recusada fica na trilha do numero', eventosIg.some((e) => /assinatura nao confere/.test(e.descricao || '')));

    const outraConta = await enviarIg({ object: 'instagram', entry: [{ id: '999', messaging: [{ sender: { id: '7' }, recipient: { id: '999' }, message: { mid: 'X', text: 'oi' } }] }] });
    await esperar(500);
    s.ok('evento de outra conta e aceito e ignorado', outraConta.status === 200 && !(await doCanal('7')));

    /* ================= TikTok ================= */

    const tt = (await api.post('/api/conexoes', { nome: 'TikTok do escritorio', tipo: 'tiktok' })).dados;
    criadas.push(tt?.id);
    await api.patch(`/api/conexoes/${tt.id}`, { tiktok: { appId: 'tt-app', appSecret: 'segredo-tt', token: 'tentativa' } });
    const semToken = ((await api.get('/api/conexoes')).dados || []).find((c) => c.id === tt.id);
    s.ok('o token do TikTok nao entra pela tela, so pelo login', semToken?.tiktok?.token === '' && semToken?.tiktok?.appSecret === '***', JSON.stringify(semToken?.tiktok));

    const entrar = await api.post(`/api/conexoes/${tt.id}/tiktok/entrar`);
    const url = new URL(entrar.dados?.url || 'http://x');
    s.ok(
      'o login leva a pagina do TikTok com o app, o retorno e o estado',
      url.hostname === 'www.tiktok.com' && url.searchParams.get('client_key') === 'tt-app' && url.searchParams.get('redirect_uri') === `${base}/tiktok/retorno` && (url.searchParams.get('state') || '').startsWith(`${tt.id}.`),
      entrar.dados?.url,
    );
    const estado = url.searchParams.get('state');

    const forjado = await fetch(`${base}/tiktok/retorno?code=CODIGO-DO-LOGIN&state=${tt.id}.estado-forjado`, { redirect: 'manual' });
    s.ok('retorno com estado forjado nao conecta', /tiktok=erro/.test(forjado.headers.get('location') || ''));

    const volta = await fetch(`${base}/tiktok/retorno?code=CODIGO-DO-LOGIN&state=${estado}`, { redirect: 'manual' });
    const conectada = ((await api.get('/api/conexoes')).dados || []).find((c) => c.id === tt.id);
    s.ok('o retorno do login conecta a conta comercial', volta.status === 302 && /tiktok=ok/.test(volta.headers.get('location') || '') && conectada?.estado === 'conectado', volta.headers.get('location'));
    s.ok('com a conta e o @', conectada?.tiktok?.businessId === CONTA_TIKTOK && conectada?.numero === '@correia.adv', JSON.stringify({ conta: conectada?.tiktok?.businessId, numero: conectada?.numero }));

    await limpar();
    const webhook = await api.post(`/api/conexoes/${tt.id}/tiktok/webhook`);
    const cadastro = (await chamadas()).find((c) => c.caminho === '/tt/business/webhook/update/');
    s.ok('o webhook e cadastrado no TikTok com o endereco do sistema', webhook.dados?.ok && cadastro?.corpo?.callback_url === `${base}/webhook/tiktok` && cadastro?.corpo?.event_type === 'DIRECT_MESSAGE', JSON.stringify(cadastro?.corpo));

    const eventoTt = (conversa, conteudo, evento = 'im_receive_msg') => ({
      event: evento,
      user_openid: CONTA_TIKTOK,
      content: JSON.stringify({ conversation_id: conversa, timestamp: Date.now(), from_user: { id: 'u-cliente' }, to_user: { id: CONTA_TIKTOK }, to: 'correia.adv', ...conteudo }),
    });
    const enviarTt = (corpo, { segredo = 'segredo-tt', instante = Math.floor(Date.now() / 1000) } = {}) => {
      const bruto = JSON.stringify(corpo);
      const assinatura = crypto.createHmac('sha256', segredo).update(`${instante}.${bruto}`).digest('hex');
      return fetch(`${base}/webhook/tiktok`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'tiktok-signature': `t=${instante},s=${assinatura}` },
        body: bruto,
      });
    };

    const texto = (corpo) => ({ type: 'text', text: { body: corpo } });
    s.ok('evento do TikTok com assinatura errada e recusado', (await enviarTt(eventoTt('conv-x', { message_id: 'x', from: 'x', ...texto('oi') }), { segredo: 'errado' })).status === 401);
    s.ok(
      'e evento velho (reenvio guardado) tambem',
      (await enviarTt(eventoTt('conv-x', { message_id: 'x', from: 'x', ...texto('oi') }), { instante: Math.floor(Date.now() / 1000) - 3600 })).status === 401,
    );

    await enviarTt(eventoTt('conv-1', { message_id: 'TT-IN-1', from: 'joao.tt', ...texto('Vi o anuncio no TikTok, quero saber do BPC') }));
    await esperar(900);
    const joao = await doCanal('conv-1');
    contatosCriados.push(joao?.id);
    s.ok('a DM vira conversa, sem telefone, com o @', joao?.canal === 'tiktok' && !joao?.telefone && joao?.nome === '@joao.tt', JSON.stringify(joao && { canal: joao.canal, nome: joao.nome }));
    s.ok('"anuncio no TikTok" na primeira mensagem vira trafego pago', joao?.origem?.canal === 'anuncio_tiktok', JSON.stringify(joao?.origem));
    s.ok('a janela do TikTok e de 48 horas', joao?.janela?.horas === 48 && joao?.janela?.aberta === true);

    await enviarTt(eventoTt('conv-2', { message_id: 'TT-IN-2', from: 'ana.tt', ...texto('oi, tudo bem?') }));
    await esperar(900);
    const ana = await doCanal('conv-2');
    contatosCriados.push(ana?.id);
    s.ok('sem a frase do anuncio, a origem e o TikTok', ana?.origem?.canal === 'tiktok', JSON.stringify(ana?.origem));

    await limpar();
    const respostaTt = await api.post(`/api/contatos/${joao.id}/mensagens`, { conteudo: 'Ola, Joao! Vamos ver o seu BPC.' });
    const lista = await chamadas();
    const renovou = lista.find((c) => c.caminho === '/tt/tt_user/oauth2/refresh_token/');
    const saiuTt = lista.find((c) => c.caminho === '/tt/business/message/send/');
    s.ok('o token vencido e renovado sozinho antes de enviar', Boolean(renovou) && saiuTt?.cabecalhos?.accessToken === 'tt-renovado', JSON.stringify({ renovou: Boolean(renovou), token: saiuTt?.cabecalhos?.accessToken }));
    s.ok(
      'a resposta sai para a conversa certa',
      saiuTt?.corpo?.recipient === 'conv-1' && saiuTt?.corpo?.recipient_type === 'CONVERSATION' && saiuTt?.corpo?.text?.body === 'Ola, Joao! Vamos ver o seu BPC.',
      JSON.stringify(saiuTt?.corpo),
    );
    s.ok('e fica enviada, com o id do TikTok', respostaTt.dados?.situacao === 'enviada' && /^TTMID_/.test(respostaTt.dados?.idExterno || ''), JSON.stringify(respostaTt.dados));

    await enviarTt(
      eventoTt('conv-1', { message_id: respostaTt.dados?.idExterno, from: 'correia.adv', from_user: { id: CONTA_TIKTOK }, to: 'joao.tt', to_user: { id: 'u-cliente' }, ...texto('Ola, Joao! Vamos ver o seu BPC.') }, 'im_send_msg'),
    );
    await esperar(700);
    const iguaisTt = (await mensagensDe(joao.id)).filter((m) => m.conteudo === 'Ola, Joao! Vamos ver o seu BPC.');
    s.ok('o eco da nossa DM nao duplica', iguaisTt.length === 1, `${iguaisTt.length} vezes`);

    await enviarTt(eventoTt('conv-1', { message_id: 'TT-IN-3', from: 'joao.tt', type: 'image', image: { media_id: 'IMG-1' } }));
    await esperar(900);
    const imagem = (await mensagensDe(joao.id)).find((m) => m.idExterno === 'TT-IN-3');
    s.ok('a imagem da DM e baixada e guardada aqui', imagem?.tipo === 'imagem' && String(imagem?.midia?.url || '').startsWith('/midia/'), JSON.stringify(imagem?.midia));

    /* ================= Eventos do TikTok (rastreio) ================= */

    const status = (await api.get('/api/status')).dados || [];
    const qualificado = status.find((st) => st.tipo === 'qualificado');
    await api.patch('/api/integracoes', {
      tiktokEventos: { ativo: true, conjuntoId: 'CRM-123', token: 'tt-eventos', fonte: 'crm', eventos: { qualificado: 'QualifiedLead' } },
    });
    const integracoes = (await api.get('/api/integracoes')).dados;
    s.ok('o token da API de Eventos volta mascarado', integracoes?.tiktokEventos?.token === '***');

    await api.patch(`/api/contatos/${joao.id}`, { variaveis: { telefone: '81999990000' } });
    await limpar();
    await api.patch(`/api/contatos/${joao.id}`, { statusId: qualificado?.id });
    await esperar(600);
    const evento = (await chamadas()).find((c) => c.caminho === '/tt/event/track/');
    const esperado = crypto.createHash('sha256').update('+5581999990000').digest('hex');
    s.ok(
      'Qualificado do lead do TikTok vai para o TikTok, com o telefone em hash',
      evento?.corpo?.event_source === 'crm' && evento?.corpo?.event_source_id === 'CRM-123' && evento?.corpo?.data?.[0]?.event === 'QualifiedLead' && evento?.corpo?.data?.[0]?.user?.phone === esperado && evento?.cabecalhos?.accessToken === 'tt-eventos',
      JSON.stringify(evento?.corpo),
    );
    s.ok('e nada de nome ou conversa no evento', !JSON.stringify(evento?.corpo || {}).includes('joao') && !JSON.stringify(evento?.corpo || {}).includes('81999990000'));

    await limpar();
    await api.patch(`/api/contatos/${maria.id}`, { variaveis: { telefone: '81988887777' }, statusId: qualificado?.id });
    await esperar(600);
    s.ok('lead do Instagram nao vai para o TikTok', !(await chamadas()).some((c) => c.caminho === '/tt/event/track/'));
  } finally {
    await api.patch('/api/integracoes', { tiktokEventos: { ativo: false } });
    for (const id of contatosCriados.filter(Boolean)) await api.delete(`/api/contatos/${id}`);
    for (const c of await conversas()) if (c.canal === 'instagram' || c.canal === 'tiktok') await api.delete(`/api/contatos/${c.id}`);
    for (const id of criadas.filter(Boolean)) await api.delete(`/api/conexoes/${id}`);
  }
  return s;
}
