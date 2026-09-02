/** Camada de acesso ao servidor. Todo erro vira excecao com mensagem legivel. */

async function pedir(metodo, caminho, corpo) {
  const resposta = await fetch(caminho, {
    method: metodo,
    headers: corpo ? { 'Content-Type': 'application/json' } : {},
    body: corpo ? JSON.stringify(corpo) : undefined,
  });

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
  delete: (caminho) => pedir('DELETE', caminho),
};
