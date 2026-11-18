#!/usr/bin/env bash
# =====================================================================
# Configura o DEPLOY AUTOMÁTICO (GitHub Actions -> esta VPS). Rode UMA vez,
# como root, dentro de /opt/connecta:
#     bash deploy/configurar-deploy-automatico.sh
#
# O que faz:
#   1. Cria uma chave SSH exclusiva para o GitHub (deploy_github).
#   2. Instala /usr/local/bin/connecta-deploy (atualiza código + banco + sistema).
#   3. Autoriza a chave na VPS TRAVADA: ela só consegue rodar connecta-deploy
#      (sem terminal, sem túneis, sem outros comandos), mesmo se for roubada.
#   4. Mostra os 3 valores para cadastrar como "secrets" no GitHub.
#
# Pode rodar de novo: troca a chave (a anterior deixa de funcionar).
# Variáveis para teste: SSH_DIR, BIN_DIR, HOST_KEY.
# =====================================================================
set -euo pipefail
cd "$(dirname "$0")/.."
REPO_DIR=$(pwd)

if [ "$(id -u)" -ne 0 ]; then echo "Rode como root"; exit 1; fi
if [ ! -f .env ]; then echo "Rode 'bash deploy/instalar.sh' antes (o .env precisa existir)."; exit 1; fi

SSH_DIR="${SSH_DIR:-/root/.ssh}"
BIN_DIR="${BIN_DIR:-/usr/local/bin}"
HOST_KEY="${HOST_KEY:-/etc/ssh/ssh_host_ed25519_key.pub}"
KEY="$SSH_DIR/deploy_github"
MARK="connecta-github-deploy"

mkdir -p "$SSH_DIR" "$BIN_DIR"
chmod 700 "$SSH_DIR"

# 1. chave nova (sem senha: o GitHub precisa usá-la sozinho)
rm -f "$KEY" "$KEY.pub"
ssh-keygen -q -t ed25519 -N "" -C "$MARK" -f "$KEY"

# 2. comando único que a chave pode executar
cat > "$BIN_DIR/connecta-deploy" <<RUNNER
#!/usr/bin/env bash
# Deploy disparado pelo GitHub. Ignora qualquer comando enviado pelo cliente.
set -euo pipefail
exec 9>/var/lock/connecta-deploy.lock
flock -w 1800 9
cd "$REPO_DIR"
echo "==> Baixando a versão nova da main"
git fetch -q origin main
git merge -q --ff-only origin/main
echo "    versão: \$(git log --oneline -1)"
NAO_INTERATIVO=1 bash deploy/instalar.sh
RUNNER
chmod 755 "$BIN_DIR/connecta-deploy"

# 3. autoriza a chave, travada no comando acima
touch "$SSH_DIR/authorized_keys"
chmod 600 "$SSH_DIR/authorized_keys"
grep -v "$MARK" "$SSH_DIR/authorized_keys" > "$SSH_DIR/authorized_keys.tmp" || true
printf 'restrict,command="%s" %s\n' "$BIN_DIR/connecta-deploy" "$(cat "$KEY.pub")" >> "$SSH_DIR/authorized_keys.tmp"
mv "$SSH_DIR/authorized_keys.tmp" "$SSH_DIR/authorized_keys"
chmod 600 "$SSH_DIR/authorized_keys"

# 4. valores para o GitHub
HOST=$(grep -E '^CRM_DOMAIN=' .env | cut -d= -f2-)
HOST=${HOST:-$(hostname -I | awk '{print $1}')}
if [ ! -f "$HOST_KEY" ]; then echo "Chave do servidor SSH não encontrada em $HOST_KEY"; exit 1; fi
KNOWN="$HOST $(cut -d' ' -f1,2 "$HOST_KEY")"

cat <<INFO

==================================================================
 Deploy automático configurado na VPS. Agora cadastre 3 secrets no
 GitHub: repositório > Settings > Secrets and variables > Actions >
 New repository secret.  NÃO mande estes valores por chat/print.
==================================================================

 1) Nome:  VPS_HOST
    Valor: $HOST

 2) Nome:  VPS_KNOWN_HOSTS
    Valor (uma linha):
$KNOWN

 3) Nome:  VPS_SSH_KEY
    Valor: TODO o bloco abaixo, das linhas BEGIN até END (inclusive):
INFO
cat "$KEY"
echo
echo "=================================================================="
echo " Depois de cadastrar, você pode apagar a chave privada desta VPS:"
echo "     rm $KEY"
echo " (a autorização continua valendo; para trocar, rode este script de novo)"
