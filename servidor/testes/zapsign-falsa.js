import http from 'node:http';

/**
 * ZapSign de mentira, no formato da API v1.
 *
 * A de verdade custa plano com API e cria documento de verdade na conta do
 * escritorio a cada teste. Esta responde os caminhos que o sistema usa e deixa
 * o teste mandar no estado do documento: ninguem assinou, abriu o link,
 * assinou, recusou.
 *
 * Rotas de teste, com prefixo __ :
 *   POST /__documento  { token, status?, signatario? } muda o estado do documento
 *   GET  /__chamadas   o que o sistema pediu, na ordem
 *   GET  /__arquivo/x  o "PDF" assinado
 */
export function subirZapsignFalsa(porta, chave) {
  const documentos = new Map();
  const chamadas = [];
  let contador = 0;

  const MODELOS = [
    { token: 'mdl-contrato', name: 'Contrato de honorarios' },
    /* Como os contratos do escritorio: a procuracao ja vem anexada. */
    { token: 'mdl-contrato-bpc', name: 'Contrato BPC/LOAS', extra_templates: [{ name: 'Procuracao do titular' }] },
    { token: 'mdl-procuracao', name: 'Procuracao' },
  ];
  const entradas = (token) => {
    if (token.includes('procuracao')) return [{ variable: '{{NOME COMPLETO}}' }, { variable: '{{CPF}}' }];
    const comuns = [{ variable: '{{NOME COMPLETO}}' }, { variable: '{{CPF}}' }, { variable: '{{ENDERECO}}' }, { variable: '{{EMAIL}}' }, { variable: '{{DATA}}' }];
    /* O contrato de BPC pede o que o escritorio pede: RG, nacionalidade, cidade. */
    return token === 'mdl-contrato-bpc'
      ? [...comuns, { variable: '{{RG}}' }, { variable: '{{NACIONALIDADE}}' }, { variable: '{{CIDADE}}' }]
      : comuns;
  };

  const json = (res, status, dados) => {
    res.writeHead(status, { 'content-type': 'application/json' });
    res.end(JSON.stringify(dados));
  };
  const lerCorpo = async (req) => {
    const pedacos = [];
    for await (const p of req) pedacos.push(p);
    try {
      return JSON.parse(Buffer.concat(pedacos).toString('utf8') || '{}');
    } catch {
      return {};
    }
  };
  const comArquivos = (doc) => ({
    ...doc,
    signed_file: doc.status === 'signed' ? `http://127.0.0.1:${porta}/__arquivo/${doc.token}.pdf` : null,
    extra_docs: doc.extra_docs.map((e) => ({
      ...e,
      signed_file: doc.status === 'signed' ? `http://127.0.0.1:${porta}/__arquivo/${e.token}.pdf` : null,
    })),
  });

  const servidor = http.createServer(async (req, res) => {
    const url = new URL(req.url, 'http://local');
    const caminho = url.pathname;

    if (caminho === '/__chamadas') return json(res, 200, chamadas);
    if (caminho.startsWith('/__arquivo/')) {
      res.writeHead(200, { 'content-type': 'application/pdf' });
      return res.end('%PDF-1.4\n% documento de teste da ZapSign de mentira\n');
    }
    if (caminho === '/__documento' && req.method === 'POST') {
      const corpo = await lerCorpo(req);
      const doc = documentos.get(corpo.token);
      if (!doc) return json(res, 404, { erro: 'documento nao existe' });
      if (corpo.status) doc.status = corpo.status;
      if (corpo.signatario) doc.signers[0].status = corpo.signatario;
      return json(res, 200, { ok: true });
    }

    if (req.headers.authorization !== `Bearer ${chave}`) return json(res, 403, { detail: 'chave invalida' });

    /* Como a de verdade: listar e detalhar modelo e /templates/; /models/ so
       tem o create-doc e o upload-extra-doc. */
    if (caminho === '/api/v1/templates/' && req.method === 'GET') return json(res, 200, MODELOS);

    const detalhe = /^\/api\/v1\/templates\/([^/]+)\/$/.exec(caminho);
    if (detalhe && req.method === 'GET') {
      const modelo = MODELOS.find((m) => m.token === detalhe[1]);
      return modelo ? json(res, 200, { ...modelo, inputs: entradas(modelo.token) }) : json(res, 404, {});
    }

    if (caminho === '/api/v1/models/create-doc/' && req.method === 'POST') {
      const corpo = await lerCorpo(req);
      contador += 1;
      const doc = {
        token: `doc-${contador}`,
        status: 'pending',
        external_id: corpo.external_id || null,
        signers: [{ token: `sig-${contador}`, status: 'new', sign_url: `https://app.zapsign.com.br/verificar/sig-${contador}` }],
        extra_docs: [],
      };
      /* Modelo com procuracao anexada: ela nasce junto, como documento extra. */
      if (MODELOS.find((m) => m.token === corpo.template_id)?.extra_templates?.length) {
        doc.extra_docs.push({ token: `extra-${doc.token}-anexada` });
      }
      documentos.set(doc.token, doc);
      chamadas.push({ rota: 'create-doc', corpo });
      return json(res, 200, comArquivos(doc));
    }

    const extra = /^\/api\/v1\/models\/([^/]+)\/upload-extra-doc\/$/.exec(caminho);
    if (extra && req.method === 'POST') {
      const corpo = await lerCorpo(req);
      const doc = documentos.get(extra[1]);
      if (!doc) return json(res, 404, { detail: 'documento nao existe' });
      doc.extra_docs.push({ token: `extra-${doc.token}-${doc.extra_docs.length + 1}` });
      chamadas.push({ rota: 'upload-extra-doc', documento: extra[1], corpo });
      return json(res, 200, { token: doc.extra_docs[doc.extra_docs.length - 1].token });
    }

    const consulta = /^\/api\/v1\/docs\/([^/]+)\/$/.exec(caminho);
    if (consulta && req.method === 'GET') {
      const doc = documentos.get(consulta[1]);
      chamadas.push({ rota: 'docs', documento: consulta[1] });
      return doc ? json(res, 200, comArquivos(doc)) : json(res, 404, { detail: 'nao encontrado' });
    }

    if (caminho === '/api/v1/user/company/webhook/' && req.method === 'POST') {
      chamadas.push({ rota: 'webhook', corpo: await lerCorpo(req) });
      return json(res, 200, { ok: true });
    }

    json(res, 404, { detail: 'rota nao existe na ZapSign de mentira' });
  });

  return new Promise((resolve) => servidor.listen(porta, '127.0.0.1', () => resolve(servidor)));
}
