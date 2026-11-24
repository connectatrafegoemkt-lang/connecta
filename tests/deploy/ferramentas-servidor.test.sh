#!/usr/bin/env bash
# Testa deploy/ferramentas-servidor.sh: instala o que falta, não reinstala o
# que não mudou, reinstala o que mudou e nunca faz o deploy falhar.
set -euo pipefail
cd "$(dirname "$0")/../.."
fail() { echo "FALHOU: $*" >&2; exit 1; }
T=$(mktemp -d); trap 'rm -rf "$T"' EXIT
mkdir -p "$T/repo/deploy" "$T/bin"
cp deploy/ferramentas-servidor.sh deploy/atualizar.sh deploy/antivirus.sh "$T/repo/deploy/"
# instaladores falsos: registram a chamada e criam o comando
for n in atualizar antivirus; do
  inst=$([ $n = atualizar ] && echo instalar-atualizador.sh || echo instalar-antivirus.sh)
  printf '#!/bin/sh\necho %s >> "%s/chamadas"\n[ -z "$FALHA" ] || exit 1\ntouch "$BIN_DIR/connecta-%s"; chmod +x "$BIN_DIR/connecta-%s"\n' "$n" "$T" "$n" "$n" > "$T/repo/deploy/$inst"
done
export BIN_DIR="$T/bin" STAMP_DIR="$T/stamp" FALHA=""
r() { bash "$T/repo/deploy/ferramentas-servidor.sh" >/dev/null; }
c() { grep -c "^$1$" "$T/chamadas" 2>/dev/null || true; }

r; [ "$(c atualizar)" = 1 ] && [ "$(c antivirus)" = 1 ] || fail "não instalou na primeira vez"
r; [ "$(c atualizar)" = 1 ] && [ "$(c antivirus)" = 1 ] || fail "reinstalou sem mudança"
echo "# novo" >> "$T/repo/deploy/antivirus.sh"
r; [ "$(c antivirus)" = 2 ] && [ "$(c atualizar)" = 1 ] || fail "não reinstalou só o que mudou"
echo "# novo" >> "$T/repo/deploy/atualizar.sh"
FALHA=1 r || fail "falha no instalador derrubou o deploy"
[ "$(c atualizar)" = 2 ] || fail "não tentou instalar"
r; [ "$(c atualizar)" = 3 ] || fail "não tentou de novo após falha"
rm "$T/bin/connecta-antivirus"
r; [ "$(c antivirus)" = 3 ] || fail "não reinstalou comando apagado"
echo "OK: ferramentas do servidor"
