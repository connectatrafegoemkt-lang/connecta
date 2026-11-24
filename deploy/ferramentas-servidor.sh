#!/usr/bin/env bash
# =====================================================================
# Instala/atualiza as ferramentas do servidor. Roda sozinho a cada deploy
# (deploy/instalar.sh), depois que o sistema já está no ar:
#   * comando connecta-atualizar   (deploy/instalar-atualizador.sh)
#   * antivírus connecta-antivirus (deploy/instalar-antivirus.sh)
# Só reinstala o que mudou (rápido quando nada mudou). Nunca faz o deploy
# falhar: se algo der errado, só avisa.
# Variáveis para teste: BIN_DIR, STAMP_DIR.
# =====================================================================
set -uo pipefail
cd "$(dirname "$0")/.."
BIN_DIR="${BIN_DIR:-/usr/local/bin}"
STAMP_DIR="${STAMP_DIR:-/var/lib/connecta-ferramentas}"
mkdir -p "$STAMP_DIR"

# carimbo = hash dos arquivos da ferramenta; muda → reinstala
precisa() { # nome arquivos...
  local nome=$1; shift
  local novo; novo=$(cat "$@" | sha256sum | cut -d' ' -f1)
  [ "$(cat "$STAMP_DIR/$nome" 2>/dev/null)" != "$novo" ] || [ ! -x "$BIN_DIR/connecta-$nome" ]
}
marca() { local nome=$1; shift; cat "$@" | sha256sum | cut -d' ' -f1 > "$STAMP_DIR/$nome"; }

if precisa atualizar deploy/atualizar.sh deploy/instalar-atualizador.sh; then
  echo "   instalando o comando connecta-atualizar"
  if BIN_DIR="$BIN_DIR" bash deploy/instalar-atualizador.sh >/dev/null; then
    marca atualizar deploy/atualizar.sh deploy/instalar-atualizador.sh
  else
    echo "   AVISO: não consegui instalar o connecta-atualizar (o sistema foi atualizado normalmente)"
  fi
fi

if precisa antivirus deploy/antivirus.sh deploy/instalar-antivirus.sh; then
  echo "   instalando/atualizando o antivírus (a primeira vez demora alguns minutos)"
  if BIN_DIR="$BIN_DIR" bash deploy/instalar-antivirus.sh; then
    marca antivirus deploy/antivirus.sh deploy/instalar-antivirus.sh
  else
    echo "   AVISO: não consegui instalar o antivírus agora; tento de novo no próximo deploy"
  fi
fi
exit 0
