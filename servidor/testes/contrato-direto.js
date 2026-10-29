import { spawn } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

import { suite } from './apoio.js';

/**
 * O envio direto do contrato (integracoes/zapsign.js), no caminho do agente.
 * Pedido do escritorio em 29/10/2026: "os agentes ... elaborando procuracao e
 * contrato e enviando para o ZapSign", sem conferencia.
 *
 * O que nao pode falhar: o agente fica sabendo de TUDO que o modelo pede e
 * esta em branco, com a chave em que o contrato le o dado (a data de
 * nascimento do modelo le "nascimento"); o que ele manda em "outros" entra no
 * contrato; se a ZapSign recusa (aqui, sem chave), o contrato nao se perde:
 * fica para a equipe conferir, com o motivo anotado e a equipe avisada; e a
 * descricao da ferramenta diz ao agente o que acontece de verdade, direto ou
 * com conferencia. O caminho que chega a ZapSign esta em testes/contratos.js.
 */
export async function testarContratoDireto({ raiz }) {
  const s = suite('Contrato direto: o agente coleta tudo, e a recusa da ZapSign nao perde o contrato');
  const url = (arquivo) => JSON.stringify(pathToFileURL(path.join(raiz, arquivo)).href);
  const pasta = fs.mkdtempSync(path.join(os.tmpdir(), 'contrato-direto-'));
  const script = path.join(pasta, 'direto.mjs');
  fs.writeFileSync(
    script,
    `import { iniciarBanco, achar, atualizar, inserir, listar, mensagensDe, encerrarBanco } from ${url('servidor/nucleo/banco.js')};
import { pedirContrato } from ${url('servidor/integracoes/zapsign.js')};
import { ferramentasDoAgente } from ${url('servidor/ia/mencoes.js')};
iniciarBanco();
inserir('workspaces', { id: 'w1', nome: 'Correia Advogados' });
inserir('usuarios', { id: 'u1', nome: 'Pessoa do Escritorio' });
inserir('membros', { id: 'm1', workspaceId: 'w1', usuarioId: 'u1', papel: 'admin', ativo: true });
inserir('conexoes', { id: 'cx-sim', workspaceId: 'w1', tipo: 'simulador', nome: 'Chat de teste' });
inserir('status', { id: 'st-ass', workspaceId: 'w1', nome: 'Assinatura pendente' });
inserir('integracoes', { id: 'int1', workspaceId: 'w1', zapsign: {
  chave: '',
  modeloPadraoId: 'mdl',
  modelos: [{ id: 'mdl', nome: 'Contrato', variaveis: ['{{NOME COMPLETO}}', '{{CPF}}', '{{RG}}', '{{DATA NASCIMENTO}}'], extras: [] }],
} });
const agenteDoTeste = { id: 'ag-1', workspaceId: 'w1', nome: 'Debora (Contrato)', ativo: true, prompt: 'Feche o contrato com @gerarcontrato.' };
inserir('agentes', agenteDoTeste);
inserir('contatos', { id: 'c1', workspaceId: 'w1', conexaoId: 'cx-sim', telefone: '5581931110901', nome: 'Maria Exemplo', estado: 'ia', responsavel: { tipo: 'agente', id: 'ag-1', nome: 'Debora (Contrato)' }, variaveis: { nome_completo: 'Maria Exemplo da Silva', cpf: '12345678909' }, etiquetas: [] });

const descricao = () => ferramentasDoAgente(agenteDoTeste, 'w1').find((f) => f.nome === 'gerar_contrato')?.descricao || '';
const descricaoDireta = descricao();

const primeiro = await pedirContrato({ contato: achar('contatos', 'c1'), agente: agenteDoTeste, dados: {} });
const segundo = await pedirContrato({ contato: achar('contatos', 'c1'), agente: agenteDoTeste, dados: { outros: { rg: '7654321 SDS/PE', nascimento: '01/02/1980' } } });
const contrato = listar('contratos', { contatoId: 'c1' })[0] || null;
const notas = mensagensDe('c1').filter((m) => m.nota).map((m) => m.conteudo);
const avisos = listar('notificacoes').map((n) => n.titulo);

atualizar('integracoes', 'int1', { zapsign: { ...achar('integracoes', 'int1').zapsign, envioDireto: false } });
const descricaoComConferencia = descricao();

console.log(JSON.stringify({ descricaoDireta, descricaoComConferencia, primeiro, segundo, contrato, variaveis: achar('contatos', 'c1').variaveis, notas, avisos }));
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
    if (!s.ok('o escritorio de teste roda sem erro', r.codigo === 0, r.texto.slice(-600))) return s;
    const b = JSON.parse(r.texto.trim().split('\n').pop());

    s.ok(
      'o agente fica sabendo de tudo que falta, na chave em que o contrato le',
      b.primeiro.ok === false && JSON.stringify(b.primeiro.faltando) === JSON.stringify(['rg', 'nascimento']) && /outros/.test(b.primeiro.erro || ''),
      JSON.stringify(b.primeiro),
    );
    s.ok(
      'o que ele manda em "outros" entra no cadastro e no contrato',
      b.variaveis.rg === '7654321 SDS/PE' && b.contrato?.valores?.['{{RG}}'] === '7654321 SDS/PE' && b.contrato?.valores?.['{{DATA NASCIMENTO}}'] === '01/02/1980',
      JSON.stringify({ variaveis: b.variaveis, valores: b.contrato?.valores }),
    );
    s.ok(
      'a ZapSign recusou (sem chave): o contrato fica para a equipe conferir, e o agente e avisado disso',
      b.segundo.ok === true && b.segundo.situacao === 'em_conferencia' && b.contrato?.situacao === 'em_conferencia' && /confere/.test(b.segundo.instrucao || ''),
      JSON.stringify(b.segundo),
    );
    s.ok(
      'com o motivo anotado na conversa e a equipe avisada',
      b.notas.some((n) => /envio direto do contrato falhou/i.test(n) && /chave/i.test(n)) && b.avisos.includes('Contrato para conferir'),
      JSON.stringify({ notas: b.notas, avisos: b.avisos }),
    );
    s.ok(
      'a ferramenta diz ao agente o que acontece: na hora com o envio direto, e com conferencia sem ele',
      /na hora/.test(b.descricaoDireta) && /confere antes/.test(b.descricaoComConferencia),
      JSON.stringify([b.descricaoDireta, b.descricaoComConferencia]),
    );
  } finally {
    fs.rmSync(pasta, { recursive: true, force: true });
  }
  return s;
}
