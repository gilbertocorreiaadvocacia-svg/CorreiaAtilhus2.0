import { spawn } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

import { cliente, suite } from './apoio.js';

/**
 * O contrato quando nenhum modelo da ZapSign foi escolhido (05/11/2026).
 *
 * "Os agentes nao estao enviando os contratos que estao no ZapSign." Em producao a
 * chave estava salva e os 12 modelos sincronizados, mas nenhum escolhido (nem o
 * padrao, nem um por tipo de caso) e nenhum contrato foi pedido nunca: o agente
 * pedia ao cliente os dados do modelo-padrao e, se tudo desse certo, so no fim
 * descobria que nao havia modelo.
 *
 * O que nao pode falhar:
 *  - sem modelo, a PRIMEIRA chamada diz isso: nada de pedir dados ao cliente, o
 *    agente e orientado a dizer que uma pessoa envia, a equipe e avisada na
 *    conversa (uma vez) e os administradores no sino (uma vez por dia);
 *  - escolhido o modelo (padrao ou do tipo de caso), o caminho normal volta;
 *  - a sugestao pelo nome so escolhe o que e claro: dois modelos que servem, ou um
 *    que cita dois casos, ficam para a pessoa decidir, e "auxilio acidente" nunca
 *    e confundido com "auxilio doenca".
 */
export async function testarContratoSemModelo({ base, raiz }) {
  const s = suite('Contrato sem modelo escolhido: avisa na hora e sugere os modelos');
  const url = (arquivo) => JSON.stringify(pathToFileURL(path.join(raiz, arquivo)).href);
  const pasta = fs.mkdtempSync(path.join(os.tmpdir(), 'contrato-sem-modelo-'));
  const script = path.join(pasta, 'sem-modelo.mjs');
  fs.writeFileSync(
    script,
    `import { iniciarBanco, achar, atualizar, inserir, listar, mensagensDe, encerrarBanco } from ${url('servidor/nucleo/banco.js')};
import { pedirContrato, sugerirModelos } from ${url('servidor/integracoes/zapsign.js')};
iniciarBanco();
inserir('workspaces', { id: 'w1', nome: 'Correia Advogados' });
inserir('usuarios', { id: 'u1', nome: 'Administrador' });
inserir('membros', { id: 'm1', workspaceId: 'w1', usuarioId: 'u1', papel: 'admin', ativo: true });
inserir('conexoes', { id: 'cx-sim', workspaceId: 'w1', tipo: 'simulador', nome: 'Chat de teste' });
inserir('etiquetas', { id: 'etq-bpc', workspaceId: 'w1', nome: 'BPC/LOAS', tipo: 'caso', caso: 'bpc' });
const modelos = [
  { id: 'mdl', nome: 'Contrato de Honorarios', variaveis: ['{{NOME COMPLETO}}', '{{CPF}}', '{{RG}}'], extras: [] },
  { id: 'mdl-bpc', nome: 'Contrato BPC', variaveis: ['{{NOME COMPLETO}}', '{{CPF}}', '{{BENEFICIO}}'], extras: [] },
];
inserir('integracoes', { id: 'int1', workspaceId: 'w1', zapsign: { chave: 'zs-de-mentira', modelos, ativo: true } });
const agente = { id: 'ag-1', workspaceId: 'w1', nome: 'Debora (Contrato)', ativo: true, prompt: 'Feche com @gerarcontrato.' };
inserir('agentes', agente);
let numero = 0;
const contato = (id, extra = {}) => inserir('contatos', { id, workspaceId: 'w1', conexaoId: 'cx-sim', telefone: '5581931110' + String(++numero).padStart(3, '0'), nome: 'Cliente ' + id, estado: 'ia', responsavel: { tipo: 'agente', id: 'ag-1', nome: agente.nome }, variaveis: { nome_completo: 'Cliente Exemplo da Silva', cpf: '12345678909' }, etiquetas: [], ...extra });
const titulos = () => listar('notificacoes').map((n) => n.titulo);
const quantas = (t) => titulos().filter((x) => x === t).length;

contato('c1'); contato('c2');
const r1 = await pedirContrato({ contato: achar('contatos', 'c1'), agente, dados: {} });
const avisosDepoisDaPrimeira = { equipe: quantas('Contrato sem modelo'), admin: quantas('Os agentes nao conseguem mandar contrato') };
const r1denovo = await pedirContrato({ contato: achar('contatos', 'c1'), agente, dados: {} });
const avisosDepoisDaSegunda = { equipe: quantas('Contrato sem modelo'), admin: quantas('Os agentes nao conseguem mandar contrato') };
const r2 = await pedirContrato({ contato: achar('contatos', 'c2'), agente, dados: {} });
const avisosDoOutro = { equipe: quantas('Contrato sem modelo'), admin: quantas('Os agentes nao conseguem mandar contrato') };
const semModelo = { contratos: listar('contratos').length, notas: mensagensDe('c1').filter((m) => m.nota).map((m) => m.conteudo) };

const configurar = (zapsign) => atualizar('integracoes', 'int1', { zapsign: { ...achar('integracoes', 'int1').zapsign, ...zapsign } });
configurar({ modeloPadraoId: 'mdl' });
const comPadrao = await pedirContrato({ contato: achar('contatos', 'c1'), agente, dados: {} });

configurar({ modeloPadraoId: null, modelosPorCaso: { bpc: { contratoId: 'mdl-bpc' } } });
contato('c3', { etiquetas: ['etq-bpc'] });
const porCaso = await pedirContrato({ contato: achar('contatos', 'c3'), agente, dados: {} });
contato('c4');
const casoSemModelo = await pedirContrato({ contato: achar('contatos', 'c4'), agente, dados: {} });

configurar({ chave: '', modelosPorCaso: {}, modeloPadraoId: null });
contato('c5');
const semChave = await pedirContrato({ contato: achar('contatos', 'c5'), agente, dados: {} });

const nomes = (...itens) => itens.map((nome, i) => ({ id: 'm' + i, nome, variaveis: [], extras: [] }));
const nomeDe = (lista, id) => lista.find((m) => m.id === id)?.nome || null;
const completo = nomes('Contrato BPC LOAS', 'Procuracao BPC', 'Contrato Auxilio Acidente (incapacidade permanente)', 'Procuracao Auxilio Acidente', 'Contrato Auxilio Doenca', 'Contrato Salario Maternidade', 'Contrato Trabalhista', 'Procuracao Geral', 'Contrato de Honorarios');
const sugCompleto = sugerirModelos(completo);
const duploBpc = nomes('Contrato BPC', 'Contrato BPC Idoso', 'Contrato de Honorarios');
const sugDuplo = sugerirModelos(duploBpc);
const doisCasos = nomes('Contrato BPC e Trabalhista', 'Contrato Geral');
const sugDoisCasos = sugerirModelos(doisCasos);
const soCasos = nomes('Contrato BPC', 'Contrato Trabalhista');
const sugSoCasos = sugerirModelos(soCasos);
const soAcidente = sugerirModelos(nomes('Contrato Auxilio-Acidente', 'Contrato Geral'));
const acentos = sugerirModelos(nomes('CONTRATO - AUXÍLIO DOENÇA', 'Contrato Geral'));

console.log(JSON.stringify({
  r1, r1denovo, r2, avisosDepoisDaPrimeira, avisosDepoisDaSegunda, avisosDoOutro, semModelo, comPadrao, porCaso, casoSemModelo, semChave,
  sugCompleto: {
    padrao: nomeDe(completo, sugCompleto.modeloPadraoId),
    procuracaoPadrao: nomeDe(completo, sugCompleto.procuracaoPadraoId),
    bpc: [nomeDe(completo, sugCompleto.modelosPorCaso.bpc?.contratoId), nomeDe(completo, sugCompleto.modelosPorCaso.bpc?.procuracaoId)],
    acidente: [nomeDe(completo, sugCompleto.modelosPorCaso.auxilio_acidente?.contratoId), nomeDe(completo, sugCompleto.modelosPorCaso.auxilio_acidente?.procuracaoId)],
    doenca: nomeDe(completo, sugCompleto.modelosPorCaso.auxilio?.contratoId),
    maternidade: nomeDe(completo, sugCompleto.modelosPorCaso.maternidade?.contratoId),
    trabalhista: nomeDe(completo, sugCompleto.modelosPorCaso.trabalhista?.contratoId),
    civel: sugCompleto.modelosPorCaso.civel || null,
  },
  sugDuplo: { bpc: sugDuplo.modelosPorCaso.bpc || null, padrao: nomeDe(duploBpc, sugDuplo.modeloPadraoId), semEscolha: sugDuplo.semEscolha },
  sugDoisCasos: { casos: Object.keys(sugDoisCasos.modelosPorCaso), padrao: nomeDe(doisCasos, sugDoisCasos.modeloPadraoId), semEscolha: sugDoisCasos.semEscolha.map((x) => x.para) },
  sugSoCasos: { padrao: sugSoCasos.modeloPadraoId, semEscolha: sugSoCasos.semEscolha.map((x) => x.para), casos: Object.keys(sugSoCasos.modelosPorCaso) },
  soAcidente: { casos: Object.keys(soAcidente.modelosPorCaso), acidente: nomeDe(nomes('Contrato Auxilio-Acidente', 'Contrato Geral'), soAcidente.modelosPorCaso.auxilio_acidente?.contratoId) },
  acentos: { casos: Object.keys(acentos.modelosPorCaso) },
}));
await encerrarBanco();
process.exit(0);
`,
  );

  try {
    const r = await new Promise((resolve) => {
      const p = spawn(process.execPath, [script], { env: { ...process.env, CORREIA_DADOS: pasta }, stdio: ['ignore', 'pipe', 'pipe'] });
      let texto = '';
      p.stdout.on('data', (d) => (texto += d));
      p.stderr.on('data', (d) => (texto += d));
      p.on('close', (codigo) => resolve({ codigo, texto }));
    });
    if (!s.ok('o escritorio de teste roda sem erro', r.codigo === 0, r.texto.slice(-800))) return s;
    const b = JSON.parse(r.texto.trim().split('\n').pop());

    /* --- O agente sem modelo escolhido --- */
    s.ok(
      'sem modelo, a primeira chamada diz isso: nao pede dado nenhum ao cliente e orienta o agente',
      b.r1.ok === false && b.r1.situacao === 'sem_modelo' && !b.r1.faltando && /NAO peca mais dados/.test(b.r1.instrucao || '') && /Integracoes/.test(b.r1.erro || ''),
      JSON.stringify(b.r1),
    );
    s.ok('nenhum contrato e criado (nao ha o que mandar)', b.semModelo.contratos === 0, String(b.semModelo.contratos));
    s.ok('a conversa ganha uma nota dizendo o que fazer', b.semModelo.notas.some((n) => /nao pode ser gerado/.test(n) && /Escolher modelos automaticamente/.test(n)), JSON.stringify(b.semModelo.notas));
    s.ok('a equipe e avisada, e os administradores tambem', b.avisosDepoisDaPrimeira.equipe >= 1 && b.avisosDepoisDaPrimeira.admin === 1, JSON.stringify(b.avisosDepoisDaPrimeira));
    s.ok('chamar de novo na mesma conversa nao enche o sino', JSON.stringify(b.avisosDepoisDaSegunda) === JSON.stringify(b.avisosDepoisDaPrimeira), JSON.stringify([b.avisosDepoisDaPrimeira, b.avisosDepoisDaSegunda]));
    s.ok('outra conversa avisa a equipe dela, mas os administradores so recebem uma vez por dia', b.r2.situacao === 'sem_modelo' && b.avisosDoOutro.equipe > b.avisosDepoisDaSegunda.equipe && b.avisosDoOutro.admin === 1, JSON.stringify(b.avisosDoOutro));
    s.ok('sem a chave da ZapSign, o motivo diz que e a chave', b.semChave.situacao === 'sem_modelo' && /chave/i.test(b.semChave.erro || ''), JSON.stringify(b.semChave));

    /* --- Escolhido o modelo, o caminho normal volta --- */
    s.ok('com o modelo padrao escolhido, volta o pedido dos dados do modelo (RG), e nao mais o aviso', b.comPadrao.situacao !== 'sem_modelo' && b.comPadrao.ok === false && JSON.stringify(b.comPadrao.faltando) === JSON.stringify(['rg']), JSON.stringify(b.comPadrao));
    s.ok('com modelo so do tipo de caso, a conversa do caso usa o dele (pede o BENEFICIO)', b.porCaso.situacao !== 'sem_modelo' && JSON.stringify(b.porCaso.faltando) === JSON.stringify(['beneficio']), JSON.stringify(b.porCaso));
    s.ok('e a conversa sem tipo de caso, sem padrao, continua avisando', b.casoSemModelo.situacao === 'sem_modelo', JSON.stringify(b.casoSemModelo));

    /* --- A sugestao pelo nome --- */
    const c = b.sugCompleto;
    s.ok(
      'pelo nome: cada caso leva o seu contrato e a sua procuracao, e o geral vira padrao',
      c.bpc[0] === 'Contrato BPC LOAS' && c.bpc[1] === 'Procuracao BPC' && c.acidente[0] === 'Contrato Auxilio Acidente (incapacidade permanente)' && c.acidente[1] === 'Procuracao Auxilio Acidente' && c.maternidade === 'Contrato Salario Maternidade' && c.trabalhista === 'Contrato Trabalhista' && c.padrao === 'Contrato de Honorarios' && c.procuracaoPadrao === 'Procuracao Geral',
      JSON.stringify(c),
    );
    s.ok('"auxilio acidente" nao e confundido com "auxilio doenca" (cada um leva o seu)', c.doenca === 'Contrato Auxilio Doenca' && c.acidente[0] === 'Contrato Auxilio Acidente (incapacidade permanente)', JSON.stringify([c.doenca, c.acidente]));
    s.ok('tipo de caso sem modelo proprio (civel) fica em branco, nao inventa', c.civel === null);
    s.ok('dois modelos que servem ao mesmo caso: nao escolhe nenhum, e diz quais', b.sugDuplo.bpc === null && b.sugDuplo.semEscolha.some((x) => /BPC/.test(x.para) && x.candidatos.length === 2) && b.sugDuplo.padrao === 'Contrato de Honorarios', JSON.stringify(b.sugDuplo));
    s.ok('modelo que cita dois casos no nome nao vai para nenhum, e fica de fora do padrao tambem', !b.sugDoisCasos.casos.includes('bpc') && !b.sugDoisCasos.casos.includes('trabalhista') && b.sugDoisCasos.padrao === 'Contrato Geral' && b.sugDoisCasos.semEscolha.includes('Contrato BPC e Trabalhista'), JSON.stringify(b.sugDoisCasos));
    s.ok('so modelos de caso, sem nenhum geral: nao ha padrao e a sugestao avisa', b.sugSoCasos.padrao === null && b.sugSoCasos.semEscolha.includes('Modelo de contrato (padrao)') && b.sugSoCasos.casos.length === 2, JSON.stringify(b.sugSoCasos));
    s.ok('"Auxilio-Acidente" com hifen e maiusculas/acentos tambem sao entendidos', b.soAcidente.acidente === 'Contrato Auxilio-Acidente' && b.acentos.casos.includes('auxilio'), JSON.stringify([b.soAcidente, b.acentos]));
  } finally {
    fs.rmSync(pasta, { recursive: true, force: true });
  }

  /* --- A rota que a tela usa --- */
  const api = cliente(base);
  await api.entrar();
  const atual = (await api.get('/api/integracoes')).dados?.zapsign || {};
  const antes = await api.post('/api/integracoes/zapsign/sugerir-modelos', {});
  s.ok('sem modelos sincronizados, a rota pede para sincronizar (400)', antes.status === 400 || (atual.modelos || []).length > 0, String(antes.status));
  await api.patch('/api/integracoes', {
    zapsign: { chave: 'zs-de-mentira-rota', modelos: [{ id: 'r1', nome: 'Contrato Trabalhista', variaveis: [], extras: [] }, { id: 'r2', nome: 'Contrato de Honorarios', variaveis: [], extras: [] }] },
  });
  const depois = await api.post('/api/integracoes/zapsign/sugerir-modelos', {});
  /* Outras suites deixam modelo escolhido na base compartilhada: "nao grava" e comparar com o
     que estava antes, e nao esperar a configuracao vazia. */
  const apos = (await api.get('/api/integracoes')).dados?.zapsign || {};
  s.ok(
    'com modelos sincronizados, a rota devolve a sugestao e nao grava nada',
    depois.status === 200 &&
      depois.dados?.modelosPorCaso?.trabalhista?.contratoId === 'r1' &&
      depois.dados?.modeloPadraoId === 'r2' &&
      (apos.modeloPadraoId || null) === (atual.modeloPadraoId || null) &&
      JSON.stringify(apos.modelosPorCaso || {}) === JSON.stringify(atual.modelosPorCaso || {}),
    JSON.stringify({ sugestao: depois.dados, antes: atual.modeloPadraoId, depois: apos.modeloPadraoId }),
  );
  await api.patch('/api/integracoes', {
    zapsign: {
      ...(atual.chave ? {} : { chave: null }),
      modelos: atual.modelos || [],
      modeloPadraoId: atual.modeloPadraoId || null,
      modelosPorCaso: atual.modelosPorCaso || {},
    },
  });
  return s;
}
