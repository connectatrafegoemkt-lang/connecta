#!/usr/bin/env bash
# =====================================================================
# Instala (ou atualiza) o comando fixo de atualização do sistema:
#     sudo bash /opt/connecta/deploy/instalar-atualizador.sh
#
# Copia deploy/atualizar.sh para /usr/local/bin/connecta-atualizar e cria
# /etc/connecta-atualizar.conf (pasta do sistema, branch, cópias). Depois
# disso, para atualizar basta rodar:  connecta-atualizar
# Variáveis para teste: BIN_DIR, CONF, BRANCH.
# =====================================================================
set -euo pipefail
cd "$(dirname "$0")/.."
REPO_DIR=$(pwd)

if [ "$(id -u)" -ne 0 ]; then echo "Rode como root: sudo bash $REPO_DIR/deploy/instalar-atualizador.sh"; exit 1; fi

BIN_DIR="${BIN_DIR:-/usr/local/bin}"
CONF="${CONF:-/etc/connecta-atualizar.conf}"
BRANCH="${BRANCH:-main}"

for cmd in git docker curl flock; do
  command -v "$cmd" >/dev/null 2>&1 || { echo "Falta o programa '$cmd' neste servidor (rode antes: bash deploy/instalar.sh)"; exit 1; }
done

mkdir -p "$BIN_DIR"
install -m 755 deploy/atualizar.sh "$BIN_DIR/connecta-atualizar.novo"
mv -f "$BIN_DIR/connecta-atualizar.novo" "$BIN_DIR/connecta-atualizar"

if [ ! -f "$CONF" ]; then
  cat > "$CONF" <<CFG
# Configuração do comando connecta-atualizar (sem segredos aqui).
REPO_DIR=$REPO_DIR
BRANCH=$BRANCH
BACKUP_DIR=/opt/connecta-backups
KEEP=5            # quantas cópias de segurança guardar
BACKUP_BANCO=1    # 1 = copia o banco (só leitura) antes de atualizar
CFG
  chmod 644 "$CONF"
fi

echo "Instalado: $BIN_DIR/connecta-atualizar (configuração em $CONF)"
echo "Para atualizar o sistema, rode sempre:  connecta-atualizar"
