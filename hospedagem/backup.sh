#!/bin/sh
# Copia de seguranca dos dados do sistema (conversas, contatos, agentes, midia).
#
# Rode na VPS:
#   sh hospedagem/backup.sh                      guarda em /root/copias-correia
#   sh hospedagem/backup.sh /outra/pasta
#
# Fica com as 14 copias mais recentes. O guia (HOSPEDAGEM.md) mostra como deixar
# diario no cron. A copia fica NA propria VPS: baixe uma de vez em quando para
# fora dela, senao um problema no servidor leva o original e a copia juntos.
set -eu

DESTINO="${1:-/root/copias-correia}"
mkdir -p "$DESTINO"
ARQUIVO="dados-$(date +%Y-%m-%d_%H%M%S).tar.gz"

docker run --rm -v correia_dados:/dados:ro -v "$DESTINO":/copia alpine \
  tar czf "/copia/$ARQUIVO" -C /dados .

ls -1t "$DESTINO"/dados-*.tar.gz 2>/dev/null | tail -n +15 | xargs -r rm --
echo "Copia pronta: $DESTINO/$ARQUIVO"
