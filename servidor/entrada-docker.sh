#!/bin/sh
# Porta de entrada do conteiner (Dockerfile).
#
# A pasta /dados tem de ser do usuario node, que e quem roda o sistema. No
# docker compose o volume nasce com o dono certo, copiado da imagem; no
# EasyPanel ele e uma pasta do servidor montada por cima, e nasce do root —
# ai o sistema nao conseguiria gravar nada. Por isso a entrada acerta o dono
# (so quando precisa: com muita midia, refazer a cada subida demoraria) e so
# entao sobe o sistema, ja como node.
set -e

if [ "$(id -u)" = "0" ]; then
  mkdir -p /dados
  if [ "$(stat -c %u /dados)" != "1000" ]; then
    chown -R node:node /dados
  fi
  exec su-exec node "$@"
fi

exec "$@"
