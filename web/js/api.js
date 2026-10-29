/** Camada de acesso ao servidor. Todo erro vira excecao com mensagem legivel. */

/*
 * O servidor fora por alguns segundos (reinicio, implantacao): a rede falha,
 * ou quem esta na frente dele responde 502/503/504 com uma pagina que nao e
 * nossa. Ate 29/10/2026 isso virava "Failed to fetch" na tela, e para quem
 * atende era o sistema caindo. Leitura (GET) tenta de novo sozinha por uns 15 s;
 * envio nao, porque repetir um POST poderia mandar a mesma mensagem duas vezes
 * — ele avisa com uma frase que diz o que fazer.
 */
const ESPERAS_PARA_TENTAR_DE_NOVO = [1000, 2000, 4000, 8000];
const SEM_SISTEMA = 'O sistema está reiniciando ou sem conexão. Tente de novo em alguns segundos.';

/* 502/503/504 que nao vem do sistema (sem JSON): o servidor ainda nao voltou. */
const servidorFora = (resposta) =>
  !resposta || ([502, 503, 504].includes(resposta.status) && !String(resposta.headers.get('content-type') || '').includes('application/json'));

async function pedir(metodo, caminho, corpo) {
  const tentativas = metodo === 'GET' ? ESPERAS_PARA_TENTAR_DE_NOVO.length + 1 : 1;
  let resposta = null;
  for (let vez = 0; vez < tentativas; vez += 1) {
    if (vez) await new Promise((pronto) => setTimeout(pronto, ESPERAS_PARA_TENTAR_DE_NOVO[vez - 1]));
    try {
      resposta = await fetch(caminho, {
        method: metodo,
        headers: corpo ? { 'Content-Type': 'application/json' } : {},
        body: corpo ? JSON.stringify(corpo) : undefined,
      });
    } catch {
      resposta = null;
    }
    if (!servidorFora(resposta)) break;
  }
  if (servidorFora(resposta)) {
    const erro = new Error(SEM_SISTEMA);
    erro.codigo = resposta?.status || 0;
    throw erro;
  }

  if (resposta.status === 204) return null;

  const texto = await resposta.text();
  let dados = null;
  try {
    dados = texto ? JSON.parse(texto) : null;
  } catch {
    dados = { erro: texto };
  }

  if (!resposta.ok) {
    const erro = new Error(dados?.erro || `Erro ${resposta.status}`);
    erro.codigo = resposta.status;
    throw erro;
  }
  return dados;
}

/** Le o arquivo escolhido na tela e guarda no servidor. Devolve a referencia. */
export function enviarArquivo(arquivo) {
  return new Promise((resolve, reject) => {
    if (arquivo.size > 16 * 1024 * 1024) {
      reject(new Error(`Arquivo de ${(arquivo.size / 1024 / 1024).toFixed(1)} MB. O WhatsApp aceita ate 16 MB.`));
      return;
    }
    const leitor = new FileReader();
    leitor.onerror = () => reject(new Error('Nao consegui ler o arquivo.'));
    leitor.onload = async () => {
      try {
        resolve(
          await pedir('POST', '/api/midia', {
            nome: arquivo.name,
            mime: arquivo.type,
            conteudoBase64: leitor.result,
          }),
        );
      } catch (erro) {
        reject(erro);
      }
    };
    leitor.readAsDataURL(arquivo);
  });
}

export const api = {
  get: (caminho, parametros) => {
    const busca = parametros
      ? `?${new URLSearchParams(
          Object.entries(parametros).filter(([, v]) => v !== undefined && v !== null && v !== ''),
        )}`
      : '';
    return pedir('GET', caminho + busca);
  },
  post: (caminho, corpo) => pedir('POST', caminho, corpo || {}),
  patch: (caminho, corpo) => pedir('PATCH', caminho, corpo || {}),
  put: (caminho, corpo) => pedir('PUT', caminho, corpo || {}),
  delete: (caminho, corpo) => pedir('DELETE', caminho, corpo),
};
