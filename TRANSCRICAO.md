# Transcrição de áudio sem chave e sem mensalidade

Muita gente que procura o escritório manda áudio em vez de digitar: pessoa
idosa, quem tem pouca escolaridade, quem está no trabalho e não pode parar para
escrever. Sem transcrição, o agente simplesmente não entende esse lead.

Este documento é sobre o jeito que **não depende de chave de ninguém**: o áudio
é transcrito aqui, na máquina onde o sistema roda.

## Por que vale a pena, além do dinheiro

Pelo caminho da OpenAI, o áudio sai do escritório. Esse áudio é um cliente
descrevendo a doença dele, o acidente de trabalho, a situação da família.
Transcrevendo local, **isso nunca sai daqui**.

Vale dizer com todas as letras: **transcrição sem IA não existe.** Reconhecer
fala é um modelo. O que muda é que este modelo roda nesta máquina, de graça, e
nada é enviado para fora.

## Como funciona

O `ffmpeg` traz o `whisper.cpp` embutido como filtro de áudio. Então o Opus que
o WhatsApp entrega é decodificado e transcrito **no mesmo comando**, sem
programa novo e sem biblioteca nova:

```
audio.ogg (Opus do WhatsApp)  →  ffmpeg -af whisper=...  →  texto
```

O código está em `servidor/ia/transcricao-local.js`, e entra pelo mesmo
`transcrever()` de sempre (`servidor/ia/audio.js`). O resto do sistema não
mudou: a mensagem continua chegando com `transcricao` e `conteudo` preenchidos.

## Instalar

**1. ffmpeg com o filtro whisper.** Nem toda build traz. Para conferir:

```bash
ffmpeg -hide_banner -filters | grep whisper
```

Se aparecer uma linha com `whisper`, está pronto. No Windows, as builds "full"
do gyan.dev trazem. (A máquina do escritório já tem, versão 9.0.2.)

**2. Um modelo de voz** na pasta `modelos/`:

```bash
mkdir -p modelos
curl -L -o modelos/ggml-base.bin  "https://huggingface.co/ggerganov/whisper.cpp/resolve/main/ggml-base.bin"
curl -L -o modelos/ggml-small.bin "https://huggingface.co/ggerganov/whisper.cpp/resolve/main/ggml-small.bin"
```

A pasta `modelos/` está no `.gitignore`: são 600 MB que não podem entrar num
repositório público.

## Qual modelo usar

Medido aqui, com 30 segundos de áudio de um cliente dizendo nome, número de
benefício e data da perícia:

| Modelo | Tamanho | Tempo (notebook) | O que acertou |
| --- | --- | --- | --- |
| `ggml-base.bin` | 141 MB | 10 s | número e data certos; errou "INSS" |
| `ggml-small.bin` | 465 MB | 18 s | número, data e nome certos; errou "auxílio doença" |

O sistema escolhe sozinho o melhor que existir na pasta. Para forçar um:

```
CORREIA_MODELO_VOZ=ggml-base.bin
```

Numa VPS de 1 vCPU, o `small` não termina a tempo de responder no WhatsApp.
Lá o certo é o `base`.

## O ajuste que fez a diferença

O padrão do filtro pica o áudio de 3 em 3 segundos, e o modelo nunca vê um
número de benefício inteiro. O número `623456 78` saía assim:

```
"623.4"   "5, 6, 7"   "8"
```

Com a janela em 30 segundos (`JANELA_SEGUNDOS`), o mesmo áudio devolveu
`623-456-78` certo — e ficou **duas vezes mais rápido**, porque o modelo carrega
uma vez em vez de uma vez por pedaço.

## O que ele ainda erra

**Vocabulário do ramo.** "INSS" virou "Iui NSS Negô" no `base`; "auxílio doença"
virou "auxílio do INCA" nos dois modelos. São justamente as palavras mais
frequentes do escritório.

Por isso cada trecho com **número** (benefício, CPF, data) ou **termo jurídico**
volta marcado em `transcricaoDuvidas`, junto com a mensagem. O trecho é
**marcado, nunca corrigido no escuro**: trocar a palavra que o cliente falou por
outra que combina mais com o escritório é pôr palavra na boca dele, e num
processo isso é grave.

A única correção automática é de grafia impossível — `INCSS` → `INSS`, porque
"INCSS" não é nada em português. "INCA" fica como está: é um instituto de
verdade, e pode ser que o cliente tenha dito isso mesmo.

**Importante:** o filtro do ffmpeg não devolve confiança por palavra. Lista de
dúvidas vazia quer dizer "nada chamou atenção", **nunca** "está tudo certo". O
áudio continua anexado na conversa justamente para quem atende poder ouvir.

## Desligar

```
CORREIA_TRANSCRICAO_LOCAL=0
```

Volta a usar a OpenAI, se houver chave. A suíte de testes roda com isso
desligado de propósito: o motor depende de 600 MB que não estão no git, e teste
que muda de resultado conforme o que está instalado não prova nada. O motor tem
suíte própria (`servidor/testes/transcricao-local.js`), que se declara **pulada**
quando falta o modelo.

## Na hospedagem (VPS)

Lá o caminho é **outro**, e o sistema já sabe seguir os dois.

A imagem é Alpine, e o pacote de ffmpeg do Alpine vem **sem** o filtro whisper
(ele exige compilar o ffmpeg com `--enable-whisper`). Compilar o ffmpeg inteiro
numa VPS de 1 vCPU levaria dezenas de minutos. Então lá a divisão é:

| | Notebook | Hospedagem |
| --- | --- | --- |
| Decodifica o Opus | ffmpeg | ffmpeg (pacote do Alpine) |
| Reconhece a fala | filtro `whisper` do próprio ffmpeg | `whisper-cli` compilado |
| Comandos | 1 | 2 |

O `Dockerfile` já faz isso: uma etapa separada compila o `whisper-cli` do
whisper.cpp e copia só o binário para a imagem final — o compilador não vai
junto. `servidor/ia/transcricao-local.js` escolhe o caminho que existir.

### O modelo vai no volume, não na imagem

São 141 MB que entrariam de novo a cada build, e que não são nossos para
redistribuir. A imagem já aponta para lá:

```
CORREIA_MODELOS_DIR=/dados/modelos
```

**Uma vez só**, na VPS, com o volume em
`/etc/easypanel/projects/atilhuschat/sistema/volumes/dados`:

```bash
V=/etc/easypanel/projects/atilhuschat/sistema/volumes/dados
mkdir -p "$V/modelos"
curl -L -o "$V/modelos/ggml-base.bin" \
  "https://huggingface.co/ggerganov/whisper.cpp/resolve/main/ggml-base.bin"
chown -R 1000:1000 "$V/modelos"
```

O `chown` importa: o sistema roda como `node` (uid 1000) dentro do contêiner, e
o volume do EasyPanel chega do root.

**`base`, e não `small`.** Na VPS de 1 vCPU o `small` não termina a tempo de
responder no WhatsApp.

### Quanto tempo vai levar lá

Medido **neste notebook**, que tem vários núcleos: `base` levou 10 s para 30 s de
áudio. Uma VPS de 1 vCPU é bem mais lenta — a conta honesta é esperar algo entre
**30 s e 1 minuto** para um áudio de 30 s, e isso **ainda não foi medido lá**.
Se ficar lento demais, o caminho é o `ggml-tiny.bin` (75 MB), aceitando que ele
erra mais.

### O que ainda não foi testado

A imagem **nunca foi construída**, aqui nem lá: o Docker Desktop deste notebook
não sobe. O que está conferido é o resto — o caminho de duas etapas roda em
teste automatizado (`servidor/testes/transcricao-local.js`), com um whisper-cli
de mentira que confere os argumentos, o formato do WAV e o JSON de volta.

O que o primeiro `docker build` ainda pode derrubar:

1. a compilação do whisper.cpp no Alpine (musl, não glibc);
2. o `whisper-cli` achar as bibliotecas na imagem final — por isso o build é
   estático (`BUILD_SHARED_LIBS=OFF`) e a imagem instala `libstdc++`.

Se o build falhar, o sistema **não quebra**: sem o cli e sem o filtro, o
`transcrever()` devolve o motivo e a mensagem de áudio continua chegando
normalmente, com o áudio anexado. O diagnóstico avisa que não há transcrição.
