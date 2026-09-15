#!/bin/sh
# Traz para a VPS os dados do notebook: conversas, agentes, configuracoes.
#
# No notebook, com o sistema PARADO, gere o pacote com
#   windows\empacotar-para-hospedagem.cmd
# mande o arquivo para a VPS (o guia mostra como) e rode aqui:
#   sh hospedagem/importar-dados.sh /root/dados-para-hospedagem.tar.gz
#
# Para o sistema, guarda uma copia do que ja estava no volume, SUBSTITUI pelos
# dados do pacote e sobe de novo.
set -eu

ARQUIVO="${1:-}"
if [ -z "$ARQUIVO" ] || [ ! -f "$ARQUIVO" ]; then
  echo "Diga o pacote: sh hospedagem/importar-dados.sh /caminho/dados-para-hospedagem.tar.gz"
  exit 1
fi
ARQUIVO="$(realpath "$ARQUIVO")"
cd "$(dirname "$0")"

docker compose stop sistema
sh ./backup.sh /root/copias-correia/antes-da-importacao

# O usuario do Node na imagem e o 1000: e ele que precisa escrever em /dados.
docker run --rm -v correia_dados:/dados -v "$ARQUIVO":/importar.tar.gz:ro alpine sh -c \
  'find /dados -mindepth 1 -delete && tar xzf /importar.tar.gz -C /dados && chown -R 1000:1000 /dados'

docker compose up -d sistema
echo "Dados importados. Acompanhe a subida com: docker compose logs -f sistema"
