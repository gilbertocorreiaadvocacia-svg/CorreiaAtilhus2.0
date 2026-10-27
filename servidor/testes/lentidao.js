import { suite } from './apoio.js';

/**
 * O medidor de lentidao (nucleo/lentidao.js), do diagnostico completo de
 * 26/10/2026: a trava do servidor aparece com horario e duracao, a requisicao
 * lenta aparece pelo desenho da rota, e o que e rapido nao enche a lista.
 */
export async function testarLentidao() {
  const s = suite('O sistema conta quando travou e que tela demorou');
  const { anotarRequisicao, situacaoDaLentidao, vigiarPausas } = await import(`../nucleo/lentidao.js?teste=${Date.now()}`);

  vigiarPausas({ intervalo: 50, limite: 300 });
  await new Promise((ok) => setTimeout(ok, 120));
  const ate = Date.now() + 600;
  while (Date.now() < ate) {
    /* trava de proposito, como um execFileSync faria */
  }
  await new Promise((ok) => setTimeout(ok, 120));

  anotarRequisicao('GET', '/api/contatos/:id', 1500);
  anotarRequisicao('GET', '/api/contatos', 80);
  const { pausasLongas, requisicoesLentas } = situacaoDaLentidao();

  s.ok('a trava aparece, com quando e quanto durou', pausasLongas.some((p) => p.ms >= 400 && Boolean(Date.parse(p.em))), JSON.stringify(pausasLongas));
  s.ok('a requisicao lenta aparece pelo desenho da rota, sem id de ninguem', requisicoesLentas.some((r) => r.rota === 'GET /api/contatos/:id' && r.ms === 1500), JSON.stringify(requisicoesLentas));
  s.ok('a rapida nao entra', !requisicoesLentas.some((r) => r.rota === 'GET /api/contatos'), JSON.stringify(requisicoesLentas));
  for (let i = 0; i < 30; i += 1) anotarRequisicao('POST', '/api/x', 2000);
  s.ok('a lista nao cresce sem fim', situacaoDaLentidao().requisicoesLentas.length <= 15);
  return s;
}
