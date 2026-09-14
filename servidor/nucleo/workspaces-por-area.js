import crypto from 'node:crypto';
import { achar, atualizar, inserir, listar, registrarLog } from './banco.js';
import { TIPOS_DE_CASO, migrarTiposDeCaso } from './casos.js';
import { normalizar, novoId } from './util.js';
import { completarComEvolutionLocal } from '../whatsapp/evolution-local.js';
import { PACOTES } from '../ia/pacotes.js';

/**
 * Um workspace por area de atendimento: Previdenciario e Trabalhista.
 *
 * Pedido do socio (14/09): cada area com o seu numero de WhatsApp, os seus
 * agentes e as suas conversas, sem uma misturar na fila da outra. O workspace
 * de origem ("Correia Advogados") fica como esta.
 *
 * O que vai de la para ca, e o que NAO vai:
 *   - vai: departamentos, status (com os momentos), etiquetas, origens,
 *     variaveis e templates — com os ids refeitos e as referencias entre eles
 *     acertadas (o follow-up do status aponta para o template DAQUI);
 *   - vai so o que e da area: os tipos de caso e os contratos por tipo de caso
 *     da ZapSign;
 *   - vai: os membros, a chave da IA, a conta da ZapSign e as bases de
 *     conhecimento da area;
 *   - NAO vai: conversa, contato, numero conectado. Cada workspace nasce com
 *     um numero proprio por QR Code, esperando ser lido, e um Chat de teste.
 *
 * Os agentes da area entram DESLIGADOS e sem numero para responder: as
 * configuracoes deles vem do escritorio, e numero real com agente pela metade
 * responderia cliente de verdade com roteiro errado.
 *
 * Idempotente: workspace que ja existe (pela area ou pelo nome) nao e criado
 * de novo.
 */

export const WORKSPACES_POR_AREA = [
  { area: 'previdenciario', nome: 'Previdenciário' },
  { area: 'trabalhista', nome: 'Trabalhista' },
];

const casosDaArea = (area) => new Set(TIPOS_DE_CASO.filter((t) => t.area === area).map((t) => t.caso));

/** Copia uma colecao para o workspace novo e devolve o mapa id antigo -> id novo. */
function clonarColecao(colecao, de, para, prefixo, filtro = () => true) {
  const mapa = new Map();
  for (const original of listar(colecao, { workspaceId: de })) {
    if (!filtro(original)) continue;
    const { id, criadoEm, atualizadoEm, ...resto } = original;
    const novo = inserir(colecao, { ...structuredClone(resto), id: novoId(prefixo), workspaceId: para });
    mapa.set(id, novo.id);
  }
  return mapa;
}

function montarWorkspace(origem, { area, nome }) {
  const workspace = inserir('workspaces', {
    id: novoId('wks'),
    nome,
    area,
    empresa: structuredClone(origem.empresa || {}),
    horarioComercial: structuredClone(origem.horarioComercial || null),
    onboarding: {},
  });
  const id = workspace.id;
  const casos = casosDaArea(area);

  /* ---------------- Classes da conversa ---------------- */

  const departamentos = clonarColecao('departamentos', origem.id, id, 'dep');
  const templates = clonarColecao('templates', origem.id, id, 'tpl');
  const status = clonarColecao('status', origem.id, id, 'sts');
  clonarColecao('etiquetas', origem.id, id, 'etq', (e) => e.tipo !== 'caso' || casos.has(e.caso));
  clonarColecao('origens', origem.id, id, 'org');
  clonarColecao('variaveis', origem.id, id, 'var');

  /* O status copiado ainda aponta para o departamento e os templates de la. */
  for (const registro of listar('status', { workspaceId: id })) {
    atualizar('status', registro.id, {
      departamentoId: departamentos.get(registro.departamentoId) || null,
      followups: (registro.followups || [])
        .filter((passo) => templates.has(passo.templateId))
        .map((passo) => ({
          ...passo,
          id: novoId('fup'),
          templateId: templates.get(passo.templateId),
          desistir: passo.desistir ? { ...passo.desistir, statusId: status.get(passo.desistir.statusId) || null } : null,
        })),
    });
  }

  /* ---------------- Equipe ---------------- */

  const membros = new Map();
  for (const membro of listar('membros', { workspaceId: origem.id })) {
    const { id: antigo, criadoEm, atualizadoEm, ...resto } = membro;
    const novo = inserir('membros', {
      ...structuredClone(resto),
      id: novoId('mbr'),
      workspaceId: id,
      departamentos: (membro.departamentos || []).map((d) => (d === '*' ? '*' : departamentos.get(d))).filter(Boolean),
      /* Os numeros de la nao existem aqui: quem via todos continua vendo todos;
         quem via so alguns comeca sem nenhum, e o administrador libera. */
      conexoes: (membro.conexoes || []).includes('*') ? ['*'] : [],
    });
    membros.set(antigo, novo.id);
  }

  /* ---------------- Integracoes: IA e ZapSign da mesma conta ---------------- */

  const { id: _id, criadoEm: _c, atualizadoEm: _a, workspaceId: _w, ...configuracao } = structuredClone(
    achar('integracoes', { workspaceId: origem.id }) || {},
  );
  const zapsign = configuracao.zapsign || { chave: '', modelos: [], ativo: false };
  const depois = zapsign.posAssinatura || {};
  inserir('integracoes', {
    ...configuracao,
    id: novoId('int'),
    workspaceId: id,
    zapsign: {
      ...zapsign,
      modelosPorCaso: Object.fromEntries(Object.entries(zapsign.modelosPorCaso || {}).filter(([caso]) => casos.has(caso))),
      posAssinatura: {
        ...depois,
        statusId: status.get(depois.statusId) || null,
        templateId: templates.get(depois.templateId) || null,
        departamentoId: departamentos.get(depois.departamentoId) || null,
        responsavel:
          depois.responsavel?.tipo === 'membro' && membros.has(depois.responsavel.id)
            ? { ...depois.responsavel, id: membros.get(depois.responsavel.id) }
            : null,
      },
    },
    customTools: configuracao.customTools || [],
    ia: configuracao.ia || { provedor: 'anthropic', chaveAnthropic: '', chaveOpenai: '' },
  });

  /* ---------------- Bases de conhecimento da area ---------------- */

  const pacote = PACOTES[area];
  const bases = clonarColecao('conhecimento', origem.id, id, 'kb', (base) =>
    (pacote?.bases || []).some((pedaco) => normalizar(base.nome).includes(pedaco)),
  );

  /* ---------------- O numero da area e o Chat de teste ---------------- */

  const novaConversa = listar('status', { workspaceId: id }).find((s) => normalizar(s.nome) === 'nova conversa');
  const comercial = listar('departamentos', { workspaceId: id }).find((d) => normalizar(d.nome) === 'comercial');
  const comum = {
    workspaceId: id,
    area,
    statusPadraoId: novaConversa?.id || null,
    departamentoPadraoId: comercial?.id || null,
    responsavelPadrao: null,
  };
  const idDoNumero = novoId('cnx');
  inserir('conexoes', {
    ...comum,
    id: idDoNumero,
    ordem: 0,
    nome: `WhatsApp ${nome}`,
    tipo: 'qrcode',
    numero: '',
    estado: 'desconectado',
    oficial: { phoneNumberId: '', wabaId: '', token: '', verifyToken: crypto.randomBytes(16).toString('hex'), appSecret: '' },
    qrcode: completarComEvolutionLocal({ servidor: '', chave: '', instancia: idDoNumero, urlWebhook: '' }),
  });
  inserir('conexoes', {
    ...comum,
    id: novoId('cnx'),
    ordem: 1,
    nome: 'Chat de teste',
    tipo: 'simulador',
    numero: '5500000000000',
    estado: 'conectado',
    conectadoEm: new Date().toISOString(),
    oficial: { phoneNumberId: '', wabaId: '', token: '', verifyToken: '', appSecret: '' },
  });

  /* ---------------- Os agentes da area, desligados ---------------- */

  const chaves = new Set(listar('variaveis', { workspaceId: id }).map((v) => v.chave));
  for (const [chave, nomeDaVariavel, descricao] of pacote?.variaveis || []) {
    if (chaves.has(chave)) continue;
    inserir('variaveis', { id: novoId('var'), workspaceId: id, nome: nomeDaVariavel, chave, descricao, tipo: 'texto' });
    chaves.add(chave);
  }
  for (const agente of pacote?.agentes || []) {
    inserir('agentes', {
      id: novoId('agn'),
      workspaceId: id,
      nome: agente.nome,
      objetivo: agente.objetivo,
      prompt: agente.prompt,
      palavrasChave: [],
      modelo: 'claude-sonnet-5',
      delaySegundos: 15,
      conhecimentoIds: [...bases.values()],
      vozId: null,
      modoAudio: false,
      pasta: agente.pasta || pacote.pasta,
      area,
      requisitos: agente.requisitos || [],
      foto: null,
      ativo: false,
    });
  }

  registrarLog(id, null, 'workspace', `Workspace ${nome} criado a partir de ${origem.nome}`, { tipo: 'sistema', nome: 'Sistema' });
  return {
    workspaceId: id,
    agentes: (pacote?.agentes || []).length,
    bases: bases.size,
    membros: membros.size,
    numero: idDoNumero,
  };
}

/** Cria o que falta. Devolve, por area, se foi criado agora ou ja existia. */
export function criarWorkspacesPorArea({ baseWorkspaceId }) {
  const origem = achar('workspaces', baseWorkspaceId);
  if (!origem) throw new Error('Workspace de origem nao encontrado.');

  const relato = [];
  for (const alvo of WORKSPACES_POR_AREA) {
    const existente = listar('workspaces').find(
      (w) => w.area === alvo.area || normalizar(w.nome) === normalizar(alvo.nome),
    );
    if (existente) {
      relato.push({ ...alvo, situacao: 'ja existia', workspaceId: existente.id });
      continue;
    }
    relato.push({ ...alvo, situacao: 'criado', ...montarWorkspace(origem, alvo) });
  }

  /* Momentos e tipos de caso que ainda faltem, respeitando a area de cada um. */
  migrarTiposDeCaso();
  return relato;
}
