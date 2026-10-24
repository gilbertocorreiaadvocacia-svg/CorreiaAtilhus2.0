import { spawn } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

import { suite } from './apoio.js';

/**
 * O caso exato de producao, 24/10/2026: escritorio geral (sem area), so com
 * o agente de avaliacao, e o numero dos anuncios com uma PESSOA de
 * responsavel padrao (a Leticia). criarContato copia esse padrao, entao todo
 * lead nascia pendente com ela — 18 na fila, ninguem respondendo. Pedido do
 * escritorio: "toda hora, todo contato que manda mensagem vai para a IA, não
 * vai para pendente".
 *
 * Tudo pelo receberMensagem de verdade e pela varredura de verdade
 * (iniciarReatribuicaoDePendentes), do mesmo jeito que o boot roda.
 *
 * O que nao pode falhar:
 *  - sem agente nenhum para assumir, o lead fica com a pessoa e ELA e avisada
 *    (o aviso de reserva: ninguem fica no silencio);
 *  - a varredura instala a Triagem no escritorio geral, e o estoque de
 *    pendentes (inclusive o que chegou antes dela) vai para a IA;
 *  - lead novo depois disso vai DIRETO para a IA, e a pessoa nao e acordada;
 *  - conversa que a pessoa ja aceitou fica com ela; grupo nao e tocado;
 *  - o padrao do numero (a pessoa) nao e alterado — so deixa de prender o lead;
 *  - a situacao da varredura (o que /api/saude mostra) diz que as etapas
 *    rodaram e qual agente o escritorio geral usa.
 */
export async function testarTodaMensagemVaiParaIa({ raiz }) {
  const s = suite('Toda mensagem de cliente vai para a IA, mesmo com uma pessoa de padrao no numero');
  const url = (arquivo) => pathToFileURL(path.join(raiz, arquivo)).href;
  const pasta = fs.mkdtempSync(path.join(os.tmpdir(), 'toda-mensagem-ia-'));

  const rodar = (arquivo) =>
    new Promise((resolve) => {
      const p = spawn(process.execPath, [arquivo], { env: { ...process.env, CORREIA_DADOS: pasta }, stdio: ['ignore', 'pipe', 'pipe'] });
      let texto = '';
      p.stdout.on('data', (d) => (texto += d));
      p.stderr.on('data', (d) => (texto += d));
      p.on('close', (codigo) => resolve({ codigo, texto }));
    });

  const roteiro = path.join(pasta, 'roteiro.mjs');
  fs.writeFileSync(
    roteiro,
    `import { iniciarBanco, inserir, inserirMensagem, achar, listar, encerrarBanco } from ${JSON.stringify(url('servidor/nucleo/banco.js'))};
import { receberMensagem } from ${JSON.stringify(url('servidor/whatsapp/recebimento.js'))};
import { iniciarReatribuicaoDePendentes, pararReatribuicaoDePendentes, situacaoDaVarredura } from ${JSON.stringify(url('servidor/automacao/reatribuir-pendentes.js'))};
iniciarBanco();

const leticia = { tipo: 'membro', id: 'mbr-leticia', nome: 'Leticia Rocha' };
const agora = new Date().toISOString();
inserir('workspaces', { id: 'w-geral', nome: 'Correia Advogados' });
inserir('usuarios', { id: 'usr-leticia', nome: 'Leticia Rocha', email: 'leticia@teste.local' });
inserir('membros', { id: 'mbr-leticia', workspaceId: 'w-geral', usuarioId: 'usr-leticia', papel: 'atendente', ativo: true });
inserir('agentes', { id: 'ag-avaliacao', workspaceId: 'w-geral', nome: 'Avaliação · Escritório geral', objetivo: 'avaliar', ativo: true });
inserir('conexoes', { id: 'conx-anuncios', workspaceId: 'w-geral', tipo: 'qrcode', nome: 'WhatsApp dos anuncios', responsavelPadrao: leticia });
inserir('contatos', { id: 'c-saulo', workspaceId: 'w-geral', conexaoId: 'conx-anuncios', telefone: '5581987937761', nome: 'Saulo', estado: 'pendente', responsavel: leticia, ultimaEntradaEm: agora, etiquetas: [] });
inserir('contatos', { id: 'c-aceito', workspaceId: 'w-geral', conexaoId: 'conx-anuncios', telefone: '5581955550000', nome: 'Cliente da Leticia', estado: 'ativo', responsavel: leticia, aceitoPor: 'mbr-leticia', aceitoEm: agora, ultimaEntradaEm: agora, etiquetas: [] });
/* Ativos parado ha dias (como o historico importado): vai para a IA quando o cliente escreve. */
const tresDiasAtras = new Date(Date.now() - 3 * 24 * 60 * 60 * 1000).toISOString();
inserir('contatos', { id: 'c-ativo-parado', workspaceId: 'w-geral', conexaoId: 'conx-anuncios', telefone: '5581966660000', nome: 'Ativo parado', estado: 'ativo', responsavel: leticia, aceitoPor: 'mbr-leticia', aceitoEm: tresDiasAtras, etiquetas: [] });
inserirMensagem('c-ativo-parado', { direcao: 'saida', tipo: 'texto', conteudo: 'Qualquer coisa me chama', autor: { tipo: 'membro', id: 'mbr-leticia', nome: 'Leticia Rocha' }, situacao: 'enviada', criadoEm: tresDiasAtras });
/* Pendente que um AGENTE passou de proposito para a Leticia ha 5 minutos: fica com ela. */
inserir('contatos', { id: 'c-passado-pela-ia', workspaceId: 'w-geral', conexaoId: 'conx-anuncios', telefone: '5581988880000', nome: 'Passado pela IA', estado: 'pendente', responsavel: leticia, passagens: [{ deId: 'ag-x', deNome: 'Eduarda (Triagem)', paraId: 'mbr-leticia', paraNome: 'Leticia Rocha', paraTipo: 'membro', resumo: 'Ja e cliente.', em: new Date(Date.now() - 5 * 60 * 1000).toISOString() }], etiquetas: [] });
/* Ativos em que a Leticia escreveu ha 10 minutos (aceite antigo, sem data): fica com ela. */
inserir('contatos', { id: 'c-ativo-conversando', workspaceId: 'w-geral', conexaoId: 'conx-anuncios', telefone: '5581977770000', nome: 'Conversando com a Leticia', estado: 'ativo', responsavel: leticia, aceitoPor: 'mbr-leticia', etiquetas: [] });
inserirMensagem('c-ativo-conversando', { direcao: 'saida', tipo: 'texto', conteudo: 'Me manda o laudo por aqui', autor: { tipo: 'membro', id: 'mbr-leticia', nome: 'Leticia Rocha' }, situacao: 'enviada', criadoEm: new Date(Date.now() - 10 * 60 * 1000).toISOString() });
inserir('contatos', { id: 'c-grupo', workspaceId: 'w-geral', conexaoId: 'conx-anuncios', telefone: '120363000000000000', nome: 'Grupo da familia', estado: 'pendente', responsavel: leticia, grupo: true, etiquetas: [] });

const conexao = () => achar('conexoes', 'conx-anuncios');
const resumo = (id) => { const c = achar('contatos', id); return { estado: c.estado, responsavel: c.responsavel, aceitoPor: c.aceitoPor || null }; };
const avisos = (id) => listar('notificacoes', { contatoId: id }).length;

/* 1. Antes de qualquer varredura: nao ha agente para assumir. */
const ricardo = (await receberMensagem({ workspaceId: 'w-geral', conexao: conexao(), telefone: '5548920056366', nome: 'Ricardo', conteudo: 'Olá! Quero mais informações sobre auxílio-acidente e meus direitos.' })).contato.id;
const antes = { ricardo: resumo(ricardo), avisosRicardo: avisos(ricardo) };

/* 2. A varredura, como no boot. */
iniciarReatribuicaoDePendentes(60 * 60 * 1000);
pararReatribuicaoDePendentes();
const situacao = situacaoDaVarredura();

/* 3. Lead novo depois da varredura. */
const rita = (await receberMensagem({ workspaceId: 'w-geral', conexao: conexao(), telefone: '5581912345678', nome: 'Rita', conteudo: 'Oi, boa tarde' })).contato.id;

/* 4. Clientes de Ativos escrevem de novo. */
await receberMensagem({ workspaceId: 'w-geral', conexao: conexao(), telefone: '5581955550000', nome: 'Cliente da Leticia', conteudo: 'Bom dia, alguma novidade?' });
await receberMensagem({ workspaceId: 'w-geral', conexao: conexao(), telefone: '5581966660000', nome: 'Ativo parado', conteudo: 'Oi, voltei' });
await receberMensagem({ workspaceId: 'w-geral', conexao: conexao(), telefone: '5581977770000', nome: 'Conversando com a Leticia', conteudo: 'Ja te mando' });
await receberMensagem({ workspaceId: 'w-geral', conexao: conexao(), telefone: '5581988880000', nome: 'Passado pela IA', conteudo: 'Ok, aguardo' });

console.log(JSON.stringify({
  antes,
  situacao,
  saulo: resumo('c-saulo'),
  ricardo: resumo(ricardo),
  rita: resumo(rita),
  avisosRita: avisos(rita),
  aceito: resumo('c-aceito'),
  ativoParado: resumo('c-ativo-parado'),
  ativoConversando: resumo('c-ativo-conversando'),
  passadoPelaIa: resumo('c-passado-pela-ia'),
  grupo: resumo('c-grupo'),
  padraoDoNumero: conexao().responsavelPadrao,
  agentesDoGeral: listar('agentes', { workspaceId: 'w-geral' }).filter((a) => a.ativo).map((a) => a.nome),
}));
await encerrarBanco();
process.exit(0);
`,
  );

  try {
    const r = await rodar(roteiro);
    if (!s.ok('o roteiro roda sem erro', r.codigo === 0, r.texto.slice(-800))) return s;
    const b = JSON.parse(r.texto.trim().split('\n').pop());
    const eduarda = (quem) => quem?.responsavel?.tipo === 'agente' && quem?.responsavel?.nome === 'Eduarda (Triagem)' && quem?.estado === 'ia';

    s.ok(
      'sem nenhum agente para assumir, o lead fica com a pessoa do padrao do numero',
      b.antes.ricardo.responsavel?.id === 'mbr-leticia' && b.antes.ricardo.estado === 'pendente',
      JSON.stringify(b.antes.ricardo),
    );
    s.ok('e a pessoa e avisada (ninguem fica no silencio)', b.antes.avisosRicardo >= 1, JSON.stringify(b.antes));

    s.ok('a varredura instala a Triagem no escritorio geral', b.agentesDoGeral.includes('Eduarda (Triagem)'), JSON.stringify(b.agentesDoGeral));
    s.ok('o pendente antigo (Saulo, com a pessoa) vai para a Eduarda, na IA', eduarda(b.saulo), JSON.stringify(b.saulo));
    s.ok('o lead que chegou antes da varredura (Ricardo) tambem vai', eduarda(b.ricardo), JSON.stringify(b.ricardo));

    s.ok('lead novo depois disso vai direto para a IA', eduarda(b.rita), JSON.stringify(b.rita));
    s.ok('e, com a IA atendendo, a pessoa nao e acordada', b.avisosRita === 0, JSON.stringify(b.avisosRita));

    s.ok(
      'conversa que a pessoa aceitou agora continua com ela',
      b.aceito.responsavel?.id === 'mbr-leticia' && b.aceito.aceitoPor === 'mbr-leticia' && b.aceito.estado === 'ativo',
      JSON.stringify(b.aceito),
    );
    s.ok(
      'conversa de Ativos parada ha dias vai para a IA quando o cliente escreve',
      eduarda(b.ativoParado) && b.ativoParado.aceitoPor === null,
      JSON.stringify(b.ativoParado),
    );
    s.ok(
      'conversa de Ativos em que a pessoa escreveu ha pouco continua com ela',
      b.ativoConversando.responsavel?.id === 'mbr-leticia' && b.ativoConversando.estado === 'ativo',
      JSON.stringify(b.ativoConversando),
    );
    s.ok(
      'conversa que um agente passou de proposito para a pessoa ha pouco continua com ela quando o cliente escreve',
      b.passadoPelaIa.responsavel?.id === 'mbr-leticia',
      JSON.stringify(b.passadoPelaIa),
    );
    s.ok('grupo nao e tocado', b.grupo.responsavel?.id === 'mbr-leticia' && b.grupo.estado === 'pendente', JSON.stringify(b.grupo));
    s.ok('o padrao do numero (a pessoa) nao e alterado', b.padraoDoNumero?.id === 'mbr-leticia', JSON.stringify(b.padraoDoNumero));

    const etapas = b.situacao?.etapas || {};
    s.ok(
      'a situacao da varredura diz que as tres etapas rodaram sem erro',
      ['triagemNoEscritorioGeral', 'numerosDasAreas', 'pendentes'].every((nome) => etapas[nome]?.ok === true),
      JSON.stringify(etapas),
    );
    const geral = (b.situacao?.escritorios || []).find((e) => e.area === null);
    s.ok(
      'e diz, do escritorio geral, que a pessoa e o padrao do numero e quem a IA usa para atender',
      geral?.numerosComPessoaPadrao === 1 && /Eduarda/.test(geral?.agenteDeEntrada || ''),
      JSON.stringify(geral),
    );
  } finally {
    fs.rmSync(pasta, { recursive: true, force: true });
  }
  return s;
}
