import { cliente, esperar, suite } from './apoio.js';

/**
 * Conectar o numero e ver as conversas do celular chegarem: em Ativos, e com o
 * nome salvo na agenda.
 *
 * O celular e a Evolution de mentira (/__celular), com as situacoes que o
 * numero de verdade trouxe da primeira vez:
 *
 *   A  numero@s.whatsapp.net, salvo na agenda, perfil com emoji
 *   B  codigo@lid SEM telefone, salvo na agenda pelo proprio @lid
 *   C  codigo@lid com o telefone numa mensagem recente, salvo pelo telefone
 *   D  nao salvo; a Evolution conhece so o nome de perfil
 *   E  nao salvo e sem nome nenhum
 *   F  grupo, e G a conversa do numero consigo mesmo: ficam de fora
 *   H  ja cadastrada no sistema, com nome escrito a mao
 *
 * O que so a primeira conexao de verdade confirma: que a Evolution manda o
 * nome salvo no CONTACTS_UPSERT. Isso foi lido no codigo dela (v2.3.7), nao
 * visto chegando.
 */
export async function testarHistorico({ base, evolucao, chaveEvolucao }) {
  const s = suite('Conversas do celular ao conectar');
  const api = cliente(base);
  await api.entrar();

  const evo = (caminho, corpo) =>
    fetch(`${evolucao}${caminho}`, {
      method: corpo ? 'POST' : 'GET',
      headers: { apikey: chaveEvolucao, 'Content-Type': 'application/json' },
      body: corpo ? JSON.stringify(corpo) : undefined,
    }).then((r) => r.json());
  await evo('/__reiniciar', {});

  const criada = await api.post('/api/conexoes', { nome: 'Escritorio (QR)', tipo: 'qrcode' });
  const id = criada.dados?.id;
  if (!id) {
    s.ok('conexao criada', false, JSON.stringify(criada.dados));
    return s;
  }
  await api.patch(`/api/conexoes/${id}`, {
    qrcode: { servidor: evolucao, chave: chaveEvolucao, instancia: 'correia-historico', urlWebhook: base },
  });

  const webhook = (evento, data) =>
    fetch(`${base}/webhook/${id}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', apikey: chaveEvolucao },
      body: JSON.stringify({ event: evento, instance: 'correia-historico', data }),
    });

  /* H: cadastrada a mao ANTES de conectar. */
  const h = await api.post('/api/contatos', { conexaoId: id, telefone: '81 91111-0006', nome: 'Nome Escrito a Mao' });

  /* Conversa nova, depois da importacao, tem de ir para a Recepcao como sempre. */
  const recepcao = ((await api.get('/api/agentes')).dados || []).find((a) => /recep/i.test(a.nome));
  if (recepcao) {
    await api.patch(`/api/conexoes/${id}`, {
      responsavelPadrao: { tipo: 'agente', id: recepcao.id, nome: recepcao.nome },
    });
  }

  /* ---------------- O pedido da instancia ---------------- */

  await api.post(`/api/conexoes/${id}/conectar`);
  const pedidos = await evo('/__configuracoes');
  const criacao = pedidos.find((p) => p.rota === '/instance/create');
  s.ok('a instancia e criada pedindo o historico completo', criacao?.syncFullHistory === true, JSON.stringify(criacao));
  s.ok(
    'e assinando o evento que traz a agenda do celular',
    (criacao?.webhook?.events || []).includes('CONTACTS_UPSERT'),
    JSON.stringify(criacao?.webhook?.events),
  );

  /* Segundo clique em Conectar: a instancia ja existe, e pode ter sido criada
     antes de o sistema assinar a agenda. O webhook e reapontado. */
  await api.post(`/api/conexoes/${id}/conectar`);
  const reapontado = (await evo('/__configuracoes')).find((p) => String(p.rota).startsWith('/webhook/set/'));
  s.ok(
    'instancia que ja existia passa a assinar a agenda tambem',
    (reapontado?.webhook?.events || []).includes('CONTACTS_UPSERT') && reapontado?.webhook?.enabled === true,
    JSON.stringify(reapontado),
  );

  /* ---------------- O celular ---------------- */

  const A = '5581911110001@s.whatsapp.net';
  const B = '111111111111111@lid';
  const C = '222222222222222@lid';
  const D = '5581911110004@s.whatsapp.net';
  const E = '5581911110005@s.whatsapp.net';
  const F = '120363000000@g.us';
  const G = '5581900000000@s.whatsapp.net';
  const H = '5581911110006@s.whatsapp.net';

  let seq = 0;
  const msg = (jid, texto, { deMim = false, perfil = '', alt = '', quando = 1750000000 } = {}) => {
    seq += 1;
    return {
      key: { remoteJid: jid, fromMe: deMim, id: `HIST_${seq}`, ...(alt ? { remoteJidAlt: alt } : {}) },
      pushName: deMim ? 'Voce' : perfil,
      message: { conversation: texto },
      messageType: 'conversation',
      messageTimestamp: quando + seq,
    };
  };

  await evo('/__celular', {
    chats: [A, B, C, D, E, F, G, H].map((remoteJid) => ({ remoteJid })),
    mensagens: [
      msg(A, 'Bom dia, e sobre o BPC da minha mae', { perfil: 'Mari 🌸' }),
      msg(A, 'Bom dia! Pode mandar os documentos', { deMim: true }),
      msg(B, 'Oi doutor, e o Joao do auxilio', { perfil: 'Joao' }),
      msg(C, 'Assinei o contrato', { perfil: 'Ana', alt: '5581911110003@s.whatsapp.net' }),
      msg(D, 'Quero saber da aposentadoria', { perfil: 'Carlos' }),
      msg(E, 'Ola'),
      /* Dois anexos no historico de E: a foto do RG, que o celular ainda tem,
         e um laudo que o WhatsApp ja nao guarda mais. */
      {
        key: { remoteJid: E, fromMe: false, id: 'HIST_IMG' },
        pushName: '',
        message: { imageMessage: { mimetype: 'image/png', caption: 'RG frente' } },
        messageTimestamp: 1750000500,
      },
      {
        key: { remoteJid: E, fromMe: false, id: 'HIST_DOC' },
        pushName: '',
        message: { documentMessage: { mimetype: 'application/pdf', fileName: 'laudo.pdf' } },
        messageTimestamp: 1750000600,
      },
      msg(F, 'mensagem no grupo', { perfil: 'Alguem' }),
      msg(G, 'nota para mim mesmo', { deMim: true }),
      msg(H, 'sou eu de novo', { perfil: 'Fulano' }),
    ],
    contatos: [
      { remoteJid: D, pushName: 'Carlos Perfil' },
      /* A Evolution poe o numero no lugar do nome quando nao tem nome. */
      { remoteJid: E, pushName: '5581911110005' },
    ],
    /* Quem tem foto de perfil: A pelo telefone, B so pelo codigo @lid. */
    fotos: { '5581911110001': true, [B]: true },
    anexos: { HIST_IMG: { mime: 'image/png', nome: 'rg.png' } },
  });

  /* ---------------- A agenda chega, a sessao abre ---------------- */

  await webhook('contacts.upsert', [
    { remoteJid: A, pushName: 'Dona Maria BPC' },
    { remoteJid: B, pushName: 'Seu Joao Auxilio' },
    { remoteJid: '5581911110003@s.whatsapp.net', pushName: 'Ana Contrato' },
    { remoteJid: H, pushName: 'Agenda Diferente' },
    { remoteJid: '5581911110007@s.whatsapp.net', pushName: 'Pedro Agenda' },
    { remoteJid: '5581999999999@s.whatsapp.net', pushName: '5581999999999' },
  ]);
  await webhook('connection.update', { state: 'open', wuid: G });

  /* As rodadas estao em 150 e 600 ms no processo de teste. */
  let historico = null;
  for (let i = 0; i < 40; i += 1) {
    await esperar(150);
    const conexao = ((await api.get('/api/conexoes')).dados || []).find((c) => c.id === id);
    historico = conexao?.historico;
    if (historico?.situacao === 'concluido' || historico?.situacao === 'erro') break;
  }
  s.ok('as conversas vieram sozinhas depois de conectar', historico?.situacao === 'concluido', JSON.stringify(historico));
  s.ok('a tela sabe quantas conversas vieram', historico?.conversas === 5, JSON.stringify(historico));

  const todas = (await api.get(`/api/contatos?conexao=${id}&limite=500`)).dados?.contatos || [];
  const pelo = (fn) => todas.find(fn);
  const a = pelo((c) => c.telefone === '5581911110001');
  const b = pelo((c) => c.lid === B);
  const c = pelo((c) => c.telefone === '5581911110003');
  const d = pelo((c) => c.telefone === '5581911110004');
  const e = pelo((c) => c.telefone === '5581911110005');
  const hh = pelo((c) => c.telefone === '5581911110006');

  /* ---------------- Em Ativos ---------------- */

  const importadas = [a, b, c, d, e];
  s.ok('as cinco conversas do celular entraram', importadas.every(Boolean), importadas.map((x) => x?.nome || '-').join(' | '));
  s.ok(
    'todas em Ativos',
    importadas.every((x) => x?.aba === 'ativos'),
    importadas.map((x) => `${x?.nome}:${x?.aba}`).join(' | '),
  );
  s.ok(
    'com uma pessoa da equipe como responsavel, e nao um agente',
    importadas.every((x) => x?.responsavel?.tipo === 'membro'),
    JSON.stringify(a?.responsavel),
  );
  s.ok('grupo nao vira conversa', !todas.some((x) => String(x.telefone).includes('120363')));
  s.ok('a conversa do numero consigo mesmo nao vira cliente', !todas.some((x) => x.telefone === '5581900000000'));

  /* ---------------- Com o nome salvo ---------------- */

  s.ok('salvo na agenda: vale o nome da agenda, nao o do perfil', a?.nome === 'Dona Maria BPC', a?.nome);
  s.ok('conversa @lid sem telefone tambem ganha o nome da agenda', b?.nome === 'Seu Joao Auxilio', b?.nome);
  s.ok('conversa @lid com telefone recente: nome pela agenda do telefone', c?.nome === 'Ana Contrato', c?.nome);
  s.ok('sem agenda: o nome que a Evolution conhece', d?.nome === 'Carlos Perfil', d?.nome);
  s.ok('sem nome nenhum: o numero, e nunca o numero fingindo de nome', e?.nome === '5581911110005', e?.nome);
  s.ok('nome escrito a mao nao e trocado pela agenda', hh?.nome === 'Nome Escrito a Mao', hh?.nome);
  s.ok('e a conversa cadastrada a mao nao foi duplicada', todas.filter((x) => x.telefone === '5581911110006').length === 1);

  const mensagensA = (await api.get(`/api/contatos/${a?.id}/mensagens`)).dados?.mensagens || [];
  s.ok('as mensagens vieram, as duas pontas da conversa', mensagensA.length === 2, `${mensagensA.length} mensagens`);
  s.ok(
    'na ordem em que foram trocadas',
    mensagensA[0]?.direcao === 'entrada' && mensagensA[1]?.direcao === 'saida',
    mensagensA.map((m) => m.direcao).join(','),
  );

  /* ---------------- De novo, sem duplicar ---------------- */

  const denovo = await api.post(`/api/conexoes/${id}/importar-historico`, {});
  s.ok(
    'importar de novo nao cria conversa nem repete mensagem',
    denovo.dados?.conversasImportadas === 0 && denovo.dados?.mensagensGravadas === 0,
    JSON.stringify(denovo.dados),
  );

  /* ---------------- A agenda muda depois ---------------- */

  await webhook('contacts.upsert', [{ remoteJid: D, pushName: 'Carlos da Agenda' }]);
  await esperar(300);
  const dDepois = (await api.get(`/api/contatos/${d?.id}`)).dados;
  s.ok('contato salvo depois renomeia a conversa que tinha nome de perfil', dDepois?.nome === 'Carlos da Agenda', dDepois?.nome);

  await api.patch(`/api/contatos/${a?.id}`, { nome: 'Maria (cliente desde 2024)' });
  await webhook('contacts.upsert', [{ remoteJid: A, pushName: 'Dona Maria Nova' }]);
  await esperar(300);
  const aDepois = (await api.get(`/api/contatos/${a?.id}`)).dados;
  s.ok('mas nunca por cima do nome que alguem escreveu', aDepois?.nome === 'Maria (cliente desde 2024)', aDepois?.nome);

  /* ---------------- O cliente antigo volta a escrever ---------------- */

  await webhook('messages.upsert', {
    key: { remoteJid: A, fromMe: false, id: 'NOVA_A1' },
    pushName: 'Mari 🌸',
    message: { conversation: 'Doutor, e o meu processo?' },
  });
  /* E a pessoa da conversa B, pelo @lid, ainda sem o telefone junto. */
  await webhook('messages.upsert', {
    key: { remoteJid: B, fromMe: false, id: 'NOVA_B1' },
    pushName: 'Joao',
    message: { conversation: 'Bom dia' },
  });
  await esperar(800);

  const aVolta = (await api.get(`/api/contatos/${a?.id}`)).dados;
  s.ok('cliente antigo que volta continua em Ativos', aVolta?.aba === 'ativos', aVolta?.aba);
  s.ok('com a mesma pessoa responsavel, e nao com a Recepcao', aVolta?.responsavel?.tipo === 'membro', JSON.stringify(aVolta?.responsavel));

  const depoisDeB = (await api.get(`/api/contatos?conexao=${id}&limite=500`)).dados?.contatos || [];
  s.ok('mensagem @lid sem telefone cai na conversa que ja existia', depoisDeB.filter((x) => x.lid === B).length === 1);
  s.ok(
    'e o codigo @lid nao vira telefone de ninguem',
    !depoisDeB.some((x) => x.telefone === '111111111111111'),
    depoisDeB.map((x) => x.telefone).join(','),
  );

  /* ---------------- Numero novo, que o escritorio nunca viu ---------------- */

  await webhook('messages.upsert', {
    key: { remoteJid: '5581911110007@s.whatsapp.net', fromMe: false, id: 'NOVO_P1' },
    pushName: 'pedrinho',
    message: { conversation: 'Oi, vi o anuncio' },
  });
  await esperar(800);
  const pedro = ((await api.get(`/api/contatos?conexao=${id}&limite=500`)).dados?.contatos || []).find(
    (x) => x.telefone === '5581911110007',
  );
  s.ok('numero novo ja nasce com o nome da agenda', pedro?.nome === 'Pedro Agenda', pedro?.nome);
  if (recepcao) {
    s.ok('e vai para a Recepcao, como toda conversa nova', pedro?.aba === 'ia', pedro?.aba);
  }

  /* ---------------- A foto de cada contato ---------------- */

  const contatoAtual = async (id) => (await api.get(`/api/contatos/${id}`)).dados;
  let aFoto = null;
  for (let i = 0; i < 30 && !aFoto?.foto; i += 1) {
    await esperar(100);
    aFoto = await contatoAtual(a?.id);
  }
  s.ok('a foto de perfil do WhatsApp chega na conversa', String(aFoto?.foto || '').startsWith('/midia/'), aFoto?.foto);
  const imagemDaFoto = aFoto?.foto ? await fetch(`${base}${aFoto.foto}`) : null;
  s.ok(
    'e fica guardada aqui, e nao no endereco do WhatsApp',
    imagemDaFoto?.status === 200 && String(imagemDaFoto.headers.get('content-type')).startsWith('image/'),
    `${imagemDaFoto?.status} ${imagemDaFoto?.headers.get('content-type')}`,
  );
  const bFoto = await contatoAtual(b?.id);
  s.ok('conversa so com o codigo @lid tambem ganha foto', String(bFoto?.foto || '').startsWith('/midia/'), bFoto?.foto);
  const dFoto = await contatoAtual(d?.id);
  s.ok('quem esconde a foto fica com as iniciais', !dFoto?.foto, dFoto?.foto);
  s.ok('e a conferencia fica anotada, para nao perguntar de novo a toda hora', Boolean(dFoto?.fotoVerificadaEm));

  /* A fila anda devagar de proposito (ver whatsapp/fotos.js): nenhuma
     consulta encosta na anterior. No teste o intervalo e de 30 ms. */
  const consultas = await evo('/__fotos');
  const coladas = consultas.slice(1).filter((c, i) => c.quando - consultas[i].quando < 25).length;
  s.ok('as fotos sao pedidas uma de cada vez, com intervalo', consultas.length >= 3 && coladas === 0, `${consultas.length} consultas, ${coladas} em rajada`);

  /* ---------------- Anexos do historico ---------------- */

  const midiasDeE = (await api.get(`/api/contatos/${e?.id}/midias`)).dados || [];
  const rg = midiasDeE.find((m) => m.midia?.tipo === 'imagem');
  const laudo = midiasDeE.find((m) => m.midia?.tipo === 'documento');
  s.ok('a galeria lista os anexos do historico', Boolean(rg && laudo), JSON.stringify(midiasDeE.map((m) => m.midia?.tipo)));
  s.ok('ainda sem o arquivo: so a chave foi guardada', !rg?.midia?.url && !laudo?.midia?.url);

  const carregado = await api.post(`/api/contatos/${e?.id}/mensagens/${rg?.id}/midia`, {});
  s.ok('carregar busca o anexo no WhatsApp', String(carregado.dados?.midia?.url || '').startsWith('/midia/'), JSON.stringify(carregado.dados));
  const arquivoDoRg = carregado.dados?.midia?.url ? await fetch(`${base}${carregado.dados.midia.url}`) : null;
  s.ok('e o arquivo abre', arquivoDoRg?.status === 200, String(arquivoDoRg?.status));
  s.ok('a legenda da foto continua na mensagem', carregado.dados?.conteudo === 'RG frente', carregado.dados?.conteudo);

  const semArquivo = await api.post(`/api/contatos/${e?.id}/mensagens/${laudo?.id}/midia`, {});
  s.ok('anexo que o WhatsApp ja apagou da erro claro', semArquivo.status === 404, String(semArquivo.status));
  s.ok('e o erro diz o que fazer', /mandar de novo/i.test(semArquivo.dados?.erro || ''), semArquivo.dados?.erro);

  /* ---------------- Arquivos guardados na conversa ---------------- */

  const guardado = await api.post(`/api/contatos/${e?.id}/arquivos`, {
    nome: 'anotacao do caso.txt',
    conteudoBase64: `data:text/plain;base64,${Buffer.from('ola arquivo').toString('base64')}`,
  });
  const lido = await api.get(`/api/contatos/${e?.id}/arquivos/${guardado.dados?.id}`);
  s.ok('o arquivo guardado abre de volta', lido.status === 200 && lido.texto === 'ola arquivo', `${lido.status} ${lido.texto}`);
  const semSessao = await fetch(`${base}/api/contatos/${e?.id}/arquivos/${guardado.dados?.id}`);
  s.ok('e so para quem tem sessao', semSessao.status === 401, String(semSessao.status));

  /* Limpeza: a conversa do Pedro esta com agente, e o relogio dele nao deve
     disparar no meio da proxima suite. */
  if (pedro) await api.delete(`/api/contatos/${pedro.id}`);
  if (h.dados?.id) await api.delete(`/api/contatos/${h.dados.id}`);

  return s;
}
