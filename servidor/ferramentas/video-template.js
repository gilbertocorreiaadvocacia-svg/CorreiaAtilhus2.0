import fs from 'node:fs';
import path from 'node:path';
import { LIMITE_MIDIA } from '../config.js';
import { atualizar, encerrarBanco, iniciarBanco, inserir, listar } from '../nucleo/banco.js';
import { guardarBuffer } from '../nucleo/midia.js';
import { normalizar, novoId } from '../nucleo/util.js';

/**
 * Poe um video (ou imagem) dentro de um template: `npm run video-template`.
 *
 *   node servidor/ferramentas/video-template.js propostatrabalhista=/entrada/a.mp4 [--aplicar]
 *
 * Sem --aplicar so simula. COM O SISTEMA PARADO: ela mexe nos arquivos de
 * dados, e o servidor no ar tem tudo em memoria e sobrescreveria a mudanca no
 * primeiro salvamento.
 *
 * POR QUE EXISTE
 *
 * Dois templates (@propostatrabalhista e @propostaauxacidente) apontavam para
 * videos que moravam no S3 da LiderHub. Funcionava, porque a Evolution baixa o
 * endereco que o sistema repassa — mas era uma dependencia silenciosa de um
 * servico que o escritorio esta deixando. Cancelado o plano, ou apagado o
 * arquivo la, a proposta passaria a sair SEM VIDEO e nada avisaria.
 *
 * O arquivo passa a morar no servidor do escritorio, guardado pelo MESMO
 * caminho que a tela de templates usa (guardarBuffer): o template fica com o
 * mesmo formato de qualquer upload feito pela tela, e nada mais precisa saber
 * que ele veio daqui.
 *
 * TEMPLATE QUE AINDA NAO EXISTE
 *
 * Quando o video e de um template que o escritorio so tinha na LiderHub (o
 * video-escritorio, por exemplo), nao ha o que atualizar: ha o que criar.
 *
 *   node servidor/ferramentas/video-template.js --novos=/entrada/novos.json [--aplicar]
 *
 * O arquivo e uma lista em JSON, e nao argumentos de linha de comando, de
 * proposito: o texto de um template tem acento, chave dupla e aspas, e passar
 * isso por ssh e PowerShell corrompe um caractere de cada vez sem avisar.
 *
 *   [{ "atalho": "video-escritorio", "nome": "Video do escritorio",
 *      "conteudo": "Olha, {{nome}}, ...", "arquivo": "/entrada/escritorio.mp4" }]
 *
 * Criar nunca sobrescreve: se o atalho ja existe, recusa e manda usar a forma
 * atalho=arquivo, que so troca a midia e preserva o texto que alguem ajustou.
 *
 * O QUE ELA RECUSA, E POR QUE
 *
 * - Arquivo acima de 16 MB: e o teto do sistema e do WhatsApp. Mandar assim
 *   mesmo faria o envio falhar na hora do cliente, nao agora.
 * - Atalho que nao existe, ou que existe mais de uma vez: escolher por palpite
 *   poria o video no template errado, e video de proposta no template de
 *   boas-vindas seria visto pelo cliente.
 *
 * O arquivo antigo NAO e apagado: se algum outro template ainda o usa, apagar
 * quebraria esse. Sobrar um arquivo no disco custa MB; faltar um custa envio.
 */

const APLICAR = process.argv.includes('--aplicar');
const pares = process.argv.slice(2).filter((a) => !a.startsWith('--') && a.includes('='));
const arquivoDeNovos = (process.argv.find((a) => a.startsWith('--novos=')) || '').slice('--novos='.length);

const MIME = { '.mp4': 'video/mp4', '.webm': 'video/webm', '.mov': 'video/quicktime', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.png': 'image/png' };

/** Le o arquivo e confere formato e tamanho. Devolve { erro } ou { dados, mime, mb }. */
function lerArquivo(caminho) {
  if (!fs.existsSync(caminho)) return { erro: `arquivo nao encontrado: ${caminho}` };
  const mime = MIME[path.extname(caminho).toLowerCase()];
  if (!mime) {
    return { erro: `formato nao aceito: ${path.extname(caminho) || '(sem extensao)'}. Use .mp4, .webm, .mov, .jpg ou .png.` };
  }
  const dados = fs.readFileSync(caminho);
  if (dados.length > LIMITE_MIDIA) {
    return {
      erro: `${(dados.length / 1048576).toFixed(1)} MB passa do limite de ${(LIMITE_MIDIA / 1048576).toFixed(0)} MB (o do WhatsApp). Comprima antes.`,
    };
  }
  return { dados, mime, mb: (dados.length / 1048576).toFixed(1) };
}

async function principal() {
  if (!pares.length && !arquivoDeNovos) {
    console.error('Uso: video-template.js atalho=/caminho/do/video.mp4 [--novos=/caminho/novos.json] [--aplicar]');
    process.exit(1);
  }

  await iniciarBanco();
  const workspace = listar('workspaces')[0];
  if (!workspace) {
    console.error('Nenhum workspace na base.');
    process.exit(1);
  }
  const w = workspace.id;
  const templates = listar('templates', { workspaceId: w });

  console.log(`Video nos templates - ${workspace.nome}`);
  console.log(APLICAR ? 'MODO APLICAR: sera gravado.' : 'MODO SIMULACAO: nada sera gravado. Use --aplicar depois de conferir.');

  let feitos = 0;
  let recusados = 0;

  for (const par of pares) {
    const corte = par.indexOf('=');
    const atalho = par.slice(0, corte).replace(/^@/, '');
    const caminho = par.slice(corte + 1);
    console.log(`\n--- @${atalho} ---`);

    const doAtalho = templates.filter((t) => normalizar(t.atalho) === normalizar(atalho));
    if (doAtalho.length !== 1) {
      console.log(`  [RECUSADO] ${doAtalho.length ? `o atalho existe ${doAtalho.length} vezes` : 'nao existe template com este atalho'}.`);
      console.log(`             Atalhos que existem: ${templates.map((t) => '@' + t.atalho).filter((x) => !/^@fup_/.test(x)).join(', ')}`);
      recusados += 1;
      continue;
    }
    const template = doAtalho[0];

    const lido = lerArquivo(caminho);
    if (lido.erro) {
      console.log(`  [RECUSADO] ${lido.erro}`);
      recusados += 1;
      continue;
    }
    const { dados, mime, mb } = lido;

    const antes = template.midia?.arquivo || template.midia?.url || template.midia?.nome || 'sem midia';
    console.log(`  antes:  ${antes}`);
    console.log(`  depois: ${path.basename(caminho)} (${mb} MB, ${mime})`);

    if (APLICAR) {
      const midia = guardarBuffer({ nome: path.basename(caminho), dados, mime });
      atualizar('templates', template.id, { midia });
      console.log(`  [feito] guardado como ${midia.arquivo}`);
    }
    feitos += 1;
  }

  /* Templates que ainda nao existem. */
  let criados = 0;
  if (arquivoDeNovos) {
    let novos;
    try {
      novos = JSON.parse(fs.readFileSync(arquivoDeNovos, 'utf8'));
      if (!Array.isArray(novos)) throw new Error('o JSON precisa ser uma lista');
    } catch (erro) {
      console.error(`\nNao consegui ler ${arquivoDeNovos}: ${erro.message}`);
      process.exit(1);
    }

    for (const novo of novos) {
      const atalho = String(novo.atalho || '').replace(/^@/, '').trim();
      console.log(`\n--- NOVO @${atalho} ---`);

      if (!atalho || !String(novo.nome || '').trim() || !String(novo.conteudo || '').trim()) {
        console.log('  [RECUSADO] faltam atalho, nome ou conteudo.');
        recusados += 1;
        continue;
      }
      if (templates.some((t) => normalizar(t.atalho) === normalizar(atalho))) {
        console.log(`  [RECUSADO] @${atalho} ja existe. Criar nao sobrescreve: use atalho=arquivo para trocar so a midia.`);
        recusados += 1;
        continue;
      }
      const lido = lerArquivo(novo.arquivo);
      if (lido.erro) {
        console.log(`  [RECUSADO] ${lido.erro}`);
        recusados += 1;
        continue;
      }

      console.log(`  nome:     ${novo.nome}`);
      console.log(`  conteudo: ${novo.conteudo}`);
      console.log(`  midia:    ${path.basename(novo.arquivo)} (${lido.mb} MB, ${lido.mime})`);

      if (APLICAR) {
        const midia = guardarBuffer({ nome: path.basename(novo.arquivo), dados: lido.dados, mime: lido.mime });
        /* Os mesmos campos que a tela de templates grava (POST /api/templates)
           e que a rota completa depois (aprovacaoMeta). */
        inserir('templates', {
          id: novoId('tpl'),
          workspaceId: w,
          nome: String(novo.nome).trim(),
          atalho,
          conteudo: String(novo.conteudo),
          categoriaMeta: novo.categoriaMeta || 'utilidade',
          midia,
          aprovacaoMeta: { solicitada: false, situacao: 'nao_solicitada' },
        });
        console.log(`  [feito] criado, com a midia guardada como ${midia.arquivo}`);
      }
      criados += 1;
    }
  }

  console.log('\n---------------------------------------------');
  console.log(`templates atualizados: ${feitos}${APLICAR ? '' : ' (simulado)'}`);
  if (arquivoDeNovos) console.log(`templates criados: ${criados}${APLICAR ? '' : ' (simulado)'}`);
  if (recusados) console.log(`recusados (nao mexi): ${recusados}`);

  if (APLICAR) {
    await encerrarBanco();
    console.log('\nPronto. Suba o sistema de novo.');
  } else {
    console.log('\nNada foi gravado. Confira acima e rode de novo com --aplicar.');
  }
  process.exit(recusados && !feitos && !criados ? 1 : 0);
}

principal().catch((erro) => {
  console.error('\nParou:', erro.message);
  console.error(erro.stack);
  process.exit(1);
});
