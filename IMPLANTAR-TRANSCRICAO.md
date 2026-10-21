# Implantar a transcrição na hospedagem

Três passos, nesta ordem. Cole um de cada vez no terminal da VPS (SSH).

O modelo vai **antes** do deploy de propósito: se a imagem subir primeiro, o
sistema fica no ar sem transcrever até o modelo chegar, e o áudio que entrar
nesse meio-tempo não vira texto.

---

## 1. O modelo de voz, uma vez só

São 141 MB no volume, não na imagem — assim não entram de novo a cada build.

```bash
V=/etc/easypanel/projects/atilhuschat/sistema/volumes/dados
mkdir -p "$V/modelos" && \
curl -L --fail -o "$V/modelos/ggml-base.bin" \
  "https://huggingface.co/ggerganov/whisper.cpp/resolve/main/ggml-base.bin" && \
chown -R 1000:1000 "$V/modelos" && \
ls -lh "$V/modelos"
```

Tem de aparecer `ggml-base.bin` com cerca de **141M**. O `chown` importa: o
sistema roda como `node` (uid 1000) dentro do contêiner, e o volume do
EasyPanel chega do root.

**`base`, e não `small`.** Na VPS de 1 vCPU o `small` não termina a tempo de
responder no WhatsApp.

---

## 2. Construir a imagem

Esta é a parte que **nunca foi testada** — o Docker deste notebook não sobe,
então o build nunca rodou, nem aqui nem aí. Pode falhar; o passo 3 só vale se
este terminar bem.

```bash
cd /etc/easypanel/projects/atilhuschat/sistema/code && \
git fetch && git reset --hard origin/main && \
docker build -t easypanel/atilhuschat/sistema:latest . && \
docker run --rm easypanel/atilhuschat/sistema:latest whisper-cli --help | head -3
```

A última linha é a prova: se o `whisper-cli` responder, o binário compilou e
abre dentro da imagem. **Se ela falhar, pare aqui** e me mande a saída — não
siga para o passo 3.

O build demora: ele compila o whisper.cpp. Em 1 vCPU, conte alguns minutos.

---

## 3. Publicar

```bash
docker service update --force \
  --image easypanel/atilhuschat/sistema:latest atilhuschat_sistema && \
sleep 20 && \
curl -s https://atilhuschat-sistema.hqztrk.easypanel.host/api/saude
```

---

## Conferir que funcionou

Entre no sistema, abra **Ajustes › Saúde**. O aviso *"Áudio do cliente não é
transcrito"* tem de ter sumido.

Se continuar aparecendo, ele agora diz **qual** das três coisas falta: o
ffmpeg, o filtro/cli, ou o modelo.

---

## Se der errado

O sistema **não quebra** sem transcrição: a mensagem de áudio continua
chegando com o anexo, e quem atende ouve. O que falta é só o texto automático.

Para voltar a imagem anterior:

```bash
docker service rollback atilhuschat_sistema
```

---

## O que esperar de velocidade

Medido **neste notebook**, que tem vários núcleos: 10 s para 30 s de áudio com
o `base`. A VPS tem 1 vCPU e é bem mais lenta — a conta honesta é **30 s a 1
minuto** para um áudio de 30 s, e isso ainda não foi medido aí.

Se ficar lento demais, troque pelo `ggml-tiny.bin` (75 MB, mesma pasta,
mesmo `curl` com o nome trocado), aceitando que ele erra mais nos números.

---

## Lembre-se do que isto NÃO resolve

A chave de IA continua inválida (`invalid x-api-key`, último teste em
22/09/2026). Transcrever o áudio faz o texto chegar — mas, sem chave válida,
nenhum agente vai lê-lo. São dois problemas separados.
