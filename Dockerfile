# O CorreiaAtilhus2.0 num conteiner, para a hospedagem. Guia: HOSPEDAGEM.md
#
# Sem npm install: o sistema nao tem dependencia nenhuma, so o Node.
# A pasta de dados e o volume /dados; a imagem nao carrega dado nenhum.

# ---------------------------------------------------------------
# Etapa 1: compilar o whisper-cli, que transcreve o audio do cliente
# ---------------------------------------------------------------
# Por que compilar em vez de instalar: transcrever precisa do whisper, e ha dois
# jeitos de ter isso. O ffmpeg sabe fazer sozinho, mas so quando foi compilado
# com --enable-whisper, e o pacote de ffmpeg do Alpine vem sem. Compilar o
# ffmpeg inteiro aqui levaria dezenas de minutos na VPS de 1 vCPU; o whisper.cpp
# sozinho e um projeto pequeno e sai em poucos minutos.
#
# Entao a divisao e esta: ffmpeg comum decodifica o Opus do WhatsApp, e o
# whisper-cli reconhece a fala. O servidor sabe seguir os dois caminhos
# (servidor/ia/transcricao-local.js) e escolhe o que existir na maquina.
#
# O compilador fica SO nesta etapa. A imagem final nao leva nada disso.
FROM alpine:3.22 AS voz

RUN apk add --no-cache build-base cmake git

ARG WHISPER_VERSAO=v1.9.5
RUN git clone --depth 1 --branch ${WHISPER_VERSAO} https://github.com/ggml-org/whisper.cpp /fonte

WORKDIR /fonte
# BUILD_SHARED_LIBS=OFF deixa um binario que nao depende de .so do /fonte, que
# nao existe na imagem final. Sem isso o whisper-cli nao abre la.
#
# nice -n 19: a hospedagem refaz esta compilacao a cada implantacao, na MESMA
# VPS de 1 vCPU em que o sistema atende. Em 26/10/2026 foram uns 3 minutos com
# o processador em 100% e o atendimento travando ("sistema esta muito lento").
# Com a prioridade mais baixa, o sistema no ar passa na frente e a compilacao
# usa so o que sobra.
RUN nice -n 19 cmake -B build -DCMAKE_BUILD_TYPE=Release -DBUILD_SHARED_LIBS=OFF -DWHISPER_BUILD_TESTS=OFF -DWHISPER_BUILD_EXAMPLES=ON \
 && nice -n 19 cmake --build build --config Release --target whisper-cli -j"$(nproc)" \
 && find build -name 'whisper-cli' -type f -exec cp {} /whisper-cli \; \
 && /whisper-cli --help > /dev/null 2>&1 || true \
 && test -x /whisper-cli

# ---------------------------------------------------------------
# Etapa 2: a imagem que vai para o ar
# ---------------------------------------------------------------
FROM node:22-alpine

# su-exec: a entrada acerta o dono de /dados como root e sobe o sistema como node.
# ffmpeg: decodifica o audio que chega do WhatsApp (Opus) para o whisper-cli.
# libstdc++: o whisper-cli e C++, e a imagem do node e musl sem ele.
RUN apk add --no-cache tzdata su-exec ffmpeg libstdc++

COPY --from=voz /whisper-cli /usr/local/bin/whisper-cli

ENV NODE_ENV=production \
    TZ=America/Sao_Paulo \
    PORTA=4477 \
    CORREIA_HOST=0.0.0.0 \
    CORREIA_HOSPEDADO=1 \
    CORREIA_DADOS=/dados \
    # O modelo de voz mora no VOLUME, nunca na imagem: sao 141 MB que entrariam
    # de novo em cada build, e que nao sao nossos para redistribuir. Como por
    # ele la esta em TRANSCRICAO.md.
    CORREIA_MODELOS_DIR=/dados/modelos

WORKDIR /app
COPY package.json ./
COPY servidor ./servidor
COPY web ./web

RUN mkdir -p /dados && chown node:node /dados && chmod +x /app/servidor/entrada-docker.sh

# Sem USER node aqui: quem troca para node e a entrada, depois de garantir que
# /dados e dele (no EasyPanel a pasta montada chega do root). O sistema nunca
# roda como root.
EXPOSE 4477
HEALTHCHECK --interval=30s --timeout=5s --start-period=60s --retries=3 \
  CMD wget -qO- "http://127.0.0.1:${PORTA:-4477}/api/saude" > /dev/null || exit 1

ENTRYPOINT ["/app/servidor/entrada-docker.sh"]
CMD ["node", "servidor/index.js"]
