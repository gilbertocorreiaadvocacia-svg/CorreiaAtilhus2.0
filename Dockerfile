# O CorreiaAtilhus2.0 num conteiner, para a hospedagem. Guia: HOSPEDAGEM.md
#
# Sem npm install: o sistema nao tem dependencia nenhuma, so o Node.
# A pasta de dados e o volume /dados; a imagem nao carrega dado nenhum.
FROM node:22-alpine

RUN apk add --no-cache tzdata

ENV NODE_ENV=production \
    TZ=America/Sao_Paulo \
    PORTA=4477 \
    CORREIA_HOST=0.0.0.0 \
    CORREIA_HOSPEDADO=1 \
    CORREIA_DADOS=/dados

WORKDIR /app
COPY package.json ./
COPY servidor ./servidor
COPY web ./web

RUN mkdir -p /dados && chown node:node /dados
USER node

EXPOSE 4477
HEALTHCHECK --interval=30s --timeout=5s --start-period=60s --retries=3 \
  CMD wget -qO- http://127.0.0.1:4477/api/saude > /dev/null || exit 1

CMD ["node", "servidor/index.js"]
