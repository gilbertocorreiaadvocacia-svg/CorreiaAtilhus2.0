import { cliente, suite } from './apoio.js';
import { CARGOS_EMBUTIDOS, CHAVES_DE_PERMISSAO, PERMISSOES, permissoesValidas } from '../nucleo/cargos.js';

/**
 * Cargos do escritorio, cada um com a sua lista de permissoes.
 *
 * Pedido do escritorio em 16/11/2026: "quero que tenha a opcao de adicionar
 * cargos e permissoes para cada cargo".
 *
 * Isto mexe na FRONTEIRA DE SEGURANCA de um sistema que ja esta no ar, com
 * processo de cliente dentro. Dois erros sao possiveis e os dois sao caros: dar
 * a alguem o que ele nao deveria alcancar, e tirar de alguem o que ele usava
 * todo dia. O segundo nao aparece em relatorio nenhum — aparece numa pessoa
 * parada no meio do atendimento.
 *
 * Por isso a suite afirma os DOIS lados, e comeca pelo que nao pode mudar.
 */

/** O que cada papel embutido podia ANTES desta mudanca, conferido rota a rota. */
const COMO_ERA = {
  owner: { tudo: true },
  admin: { tudo: true },
  /* Atendente nao era vazio: relatorio, ranking, planilha e aprovar contrato
     nao tinham guarda nenhuma nas rotas. */
  atendente: { tem: ['relatorios', 'contratos', 'exportar'], naoTem: ['configurar', 'membros', 'agentes', 'conexoes', 'integracoes', 'excluir'] },
  somente_leitura: { tem: ['relatorios'], naoTem: ['configurar', 'membros', 'agentes', 'conexoes', 'integracoes', 'excluir', 'exportar'] },
};

export function testarCargosEmbutidos() {
  const s = suite('Cargos: os quatro embutidos nao mudam o que ja podiam');

  s.ok('o catalogo tem permissao com nome e explicacao', PERMISSOES.every((p) => p.chave && p.nome && p.descricao), JSON.stringify(PERMISSOES.map((p) => p.chave)));
  s.ok('e as chaves nao se repetem', new Set(CHAVES_DE_PERMISSAO).size === CHAVES_DE_PERMISSAO.length, JSON.stringify(CHAVES_DE_PERMISSAO));

  for (const [papel, esperado] of Object.entries(COMO_ERA)) {
    const tem = CARGOS_EMBUTIDOS[papel]?.permissoes || [];
    if (esperado.tudo) {
      s.ok(`${papel} continua com tudo`, CHAVES_DE_PERMISSAO.every((c) => tem.includes(c)), JSON.stringify(tem));
      continue;
    }
    s.ok(
      `${papel} mantem o que ja fazia (${esperado.tem.join(', ')})`,
      esperado.tem.every((c) => tem.includes(c)),
      JSON.stringify(tem),
    );
    s.ok(
      `${papel} continua sem o que nao alcancava`,
      esperado.naoTem.every((c) => !tem.includes(c)),
      JSON.stringify(tem),
    );
  }

  /*
   * Ser DONO nao virou caixinha, e isso e deliberado: um cargo mal montado que
   * pudesse tirar a condicao de dono trancaria o escritorio para fora do
   * proprio sistema, sem de onde desfazer.
   */
  s.ok('"ser dono" nao entrou na lista de permissoes', !CHAVES_DE_PERMISSAO.includes('owner') && !CHAVES_DE_PERMISSAO.includes('dono'), JSON.stringify(CHAVES_DE_PERMISSAO));

  /* Lixo que venha da tela nao entra no cargo. */
  s.ok('permissao inventada e descartada', !permissoesValidas(['configurar', 'virar_dono', '']).includes('virar_dono'), JSON.stringify(permissoesValidas(['configurar', 'virar_dono', ''])));
  s.ok('e repetida entra uma vez so', permissoesValidas(['excluir', 'excluir']).length === 1);
  s.ok('lista vazia ou errada nao quebra', permissoesValidas(null).length === 0 && permissoesValidas('configurar').length === 0);

  return s;
}

/**
 * O cargo criado pelo escritorio, de ponta a ponta: criar, dar a alguem, e
 * conferir que o servidor obedece.
 *
 * A trava que vale e a do SERVIDOR. A tela esconder botao e conveniencia;
 * quem impede de verdade e exigirPermissao, e e isso que este teste exerce —
 * entrando como a pessoa do cargo e batendo nas rotas.
 */
export async function testarCargoNaPratica({ base }) {
  const s = suite('Cargo criado pelo escritorio: o servidor obedece');
  const api = cliente(base);
  await api.entrar();

  /* Um cargo que ve relatorio mas NAO exporta, e nao alcanca as chaves: e o
     caso que o escritorio descreveu ao pedir isto. */
  const criado = await api.post('/api/cargos', {
    nome: `Financeiro ${Date.now()}`,
    descricao: 'Vê relatório, não exporta dado de cliente, não alcança as chaves.',
    permissoes: ['relatorios'],
  });
  if (!s.ok('o cargo e criado', criado.status === 200 && Boolean(criado.dados?.id), JSON.stringify(criado.dados))) return s;
  s.ok('e guarda so as permissoes marcadas', JSON.stringify(criado.dados.permissoes) === JSON.stringify(['relatorios']), JSON.stringify(criado.dados.permissoes));

  const cargoId = criado.dados.id;
  const email = `financeiro.${Date.now()}@correia.adv.br`;
  const membro = await api.post('/api/membros', { nome: 'Pessoa do Financeiro', email, senha: 'cargo2026x', papel: cargoId });
  if (!s.ok('da para dar o cargo novo a alguem', membro.status === 200 && membro.dados?.papel === cargoId, JSON.stringify(membro.dados?.papel))) return s;

  const dela = cliente(base);
  const entrou = await dela.entrar(email, 'cargo2026x');
  if (!s.ok('a pessoa do cargo consegue entrar', entrou.status === 200, String(entrou.status))) return s;

  /* --- O que o cargo PERMITE ------------------------------------------ */
  s.ok('ela ve o relatorio, que esta no cargo', (await dela.get('/api/relatorios/contratos')).status === 200);

  /* --- E o que ele NAO permite ---------------------------------------- */
  const planilha = await dela.get('/api/relatorios/contratos.csv');
  s.ok('mas NAO baixa a planilha: exportar ficou desmarcado', planilha.status === 403, String(planilha.status));
  s.ok(
    'e a recusa diz qual permissao falta, para quem administra saber o que marcar',
    /Exportar dados/i.test(planilha.dados?.erro || ''),
    String(planilha.dados?.erro || ''),
  );

  const chaves = await dela.patch('/api/integracoes', { ia: { chaveAnthropic: 'tentativa' } });
  s.ok('nao alcanca as chaves do escritorio', chaves.status === 403, String(chaves.status));

  const sessao = (await dela.get('/api/sessao/eu')).dados;
  s.ok('a sessao dela diz o que ela pode, para a tela esconder o resto', JSON.stringify(sessao?.permissoes) === JSON.stringify(['relatorios']), JSON.stringify(sessao?.permissoes));
  /*
   * Cargo proprio NAO herda visibilidade de administrador. Permissao e o que a
   * pessoa FAZ; o que ela VE sai dos departamentos dela. Misturar os dois faria
   * um cargo de permissao virar, sem ninguem pedir, licenca para ler a fila
   * inteira do escritorio.
   */
  s.ok('e nao vira administrador de passagem', sessao?.papel === cargoId, String(sessao?.papel));

  /* --- O que protege o escritorio de um cargo mal montado -------------- */
  const mexerNoEmbutido = await api.patch('/api/cargos/admin', { permissoes: [] });
  s.ok('cargo que vem com o sistema nao se edita', mexerNoEmbutido.status === 400, String(mexerNoEmbutido.status));
  const apagarEmbutido = await api.delete('/api/cargos/owner');
  s.ok('nem se exclui', apagarEmbutido.status === 400, String(apagarEmbutido.status));

  const apagarEmUso = await api.delete(`/api/cargos/${cargoId}`);
  s.ok(
    'cargo em uso nao e excluido: a pessoa ficaria sem permissao nenhuma, do nada',
    apagarEmUso.status === 409,
    `${apagarEmUso.status} ${String(apagarEmUso.dados?.erro || '')}`,
  );

  /* Tirado de todo mundo, aí sim sai. */
  await api.patch(`/api/membros/${membro.dados.id}`, { papel: 'atendente' });
  const apagou = await api.delete(`/api/cargos/${cargoId}`);
  s.ok('sem ninguem usando, o cargo e excluido', apagou.status === 200, String(apagou.status));

  /* --- A pessoa do cargo nao mexe em cargo --------------------------- */
  const tentouCriar = await dela.post('/api/cargos', { nome: 'Eu Mesmo Dono', permissoes: ['configurar', 'membros'] });
  s.ok('quem nao gerencia a equipe nao cria cargo para si', tentouCriar.status === 403, String(tentouCriar.status));

  return s;
}
