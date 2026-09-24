import http from 'node:http';

/**
 * LiderHub de mentira, no formato da API principal.
 *
 * Responde as quatro rotas que a importacao usa, exige a x-company-key e devolve
 * um conjunto fixo de dados: quatro status (um sem par aqui), duas etiquetas
 * (uma nova), dois departamentos (um sem par) e contatos que exercitam cada
 * caminho — inclusive um sem telefone e um que ja existe neste sistema.
 *
 * Os contatos vem paginados de verdade (page/limit), para o teste provar que a
 * importacao percorre todas as paginas.
 */
export function subirLiderhubFalsa(porta, chave) {
  const STATUS = [
    { id: 'st-novolead', name: 'Novo lead' },
    { id: 'st-proposta', name: 'Proposta enviada' }, // apelido -> "Preparar kit"
    { id: 'st-qual', name: 'Qualificado' },
    { id: 'st-neg', name: 'Em negociação' }, // sem par aqui
  ];
  const TAGS = [
    { id: 'tg-urgente', name: 'Urgente' }, // ja existe na semeadura
    { id: 'tg-vip', name: 'Cliente VIP' }, // nova, sera criada
  ];
  const DEPARTAMENTOS = [
    { id: 'dp-comercial', name: 'Comercial' }, // casa
    { id: 'dp-marketing', name: 'Marketing' }, // sem par aqui
  ];
  const CONTATOS = [
    { id: 'c1', contactNumber: '558199990001', contactName: 'Ana Exemplo', status: 'st-novolead', department: 'dp-comercial', tags: ['tg-urgente'] },
    { id: 'c2', contactNumber: '558199990002', contactName: 'Bruno Exemplo', status: 'st-proposta', department: 'dp-marketing', tags: ['tg-vip'] },
    { id: 'c3', contactNumber: '558199990003', contactName: 'Carla Exemplo', status: 'st-neg', department: null, tags: [] },
    { id: 'c4', contactNumber: '', contactName: 'Sem Telefone', status: 'st-novolead', department: null, tags: [] },
    { id: 'c5', contactNumber: '558199990005', contactName: 'Diego Exemplo', status: 'st-qual', department: 'dp-comercial', tags: ['tg-vip', 'tg-urgente'] },
  ];

  const json = (res, status, dados) => {
    res.writeHead(status, { 'content-type': 'application/json' });
    res.end(JSON.stringify(dados));
  };

  const servidor = http.createServer((req, res) => {
    if (req.headers['x-company-key'] !== chave) return json(res, 401, { error: 'chave invalida' });
    const url = new URL(req.url, 'http://local');
    const caminho = url.pathname;

    if (caminho === '/settings/status') return json(res, 200, STATUS);
    if (caminho === '/settings/tags') return json(res, 200, TAGS);
    if (caminho === '/settings/departamentos') return json(res, 200, DEPARTAMENTOS);

    if (caminho === '/contacts') {
      const page = Number(url.searchParams.get('page') || 1);
      const limit = Number(url.searchParams.get('limit') || 100);
      const inicio = (page - 1) * limit;
      const lote = CONTATOS.slice(inicio, inicio + limit);
      const total = CONTATOS.length;
      return json(res, 200, {
        contacts: lote,
        pagination: {
          page,
          limit,
          total,
          totalPages: Math.ceil(total / limit),
          hasNextPage: inicio + limit < total,
          hasPreviousPage: page > 1,
        },
      });
    }

    return json(res, 404, { error: 'rota desconhecida' });
  });

  return new Promise((resolve) => {
    servidor.listen(porta, '127.0.0.1', () => resolve(servidor));
  });
}
