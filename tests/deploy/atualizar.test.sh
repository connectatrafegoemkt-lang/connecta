#!/usr/bin/env bash
# Testa deploy/atualizar.sh (comando connecta-atualizar) com um repositório
# git de verdade e docker/curl falsos: cópia de segurança, atualização,
# falhas que desfazem o código e o --voltar. Requer root (como na VPS).
set -euo pipefail
cd "$(dirname "$0")/../.."
SRC=$(pwd)
fail() { echo "FALHOU: $*" >&2; exit 1; }
T=$(mktemp -d); trap 'rm -rf "$T"' EXIT
export GIT_AUTHOR_NAME=t GIT_AUTHOR_EMAIL=t@t GIT_COMMITTER_NAME=t GIT_COMMITTER_EMAIL=t@t

# "GitHub": repositório bare com a main
git init -q --bare -b main "$T/origin.git"
git clone -q "$T/origin.git" "$T/dev" 2>/dev/null
mkdir -p "$T/dev/deploy"
cp "$SRC/deploy/atualizar.sh" "$T/dev/deploy/"
printf '#!/bin/sh\necho "    migrações ok"\nexit "${MIGRAR_RC:-0}"\n' > "$T/dev/deploy/migrar-banco.sh"
echo v1 > "$T/dev/versao.txt"
git -C "$T/dev" add -A && git -C "$T/dev" commit -qm "v1" && git -C "$T/dev" push -q origin main 2>/dev/null

# "servidor": clone + .env
git clone -q "$T/origin.git" "$T/srv"
printf 'CRM_DOMAIN=crm.exemplo.com\nSUPABASE_DB_URL=postgresql://u@h:5432/postgres\nSUPABASE_DB_PASSWORD=x\n' > "$T/srv/.env"

# docker e curl falsos
mkdir -p "$T/bin"
cat > "$T/bin/docker" <<'D'
#!/bin/sh
echo "docker $*" >> "$LOG"
case "$*" in
  "compose ps -q "*) echo "cid-$4" ;;
  "inspect -f {{.Config.Image}} "*) echo "connecta-${4#cid-}" ;;
  "inspect -f {{.Image}} "*) echo "sha256:${4#cid-}" ;;
  "compose ps --status running --services") printf 'app\nworker\ncaddy\n' ;;
  "compose build"*) [ -z "$FAIL_BUILD" ] || { echo "erro no npm ci"; exit 1; } ;;
  run*pg_dump*) echo DUMP ;;
esac
exit 0
D
printf '#!/bin/sh\necho "curl $*" >> "$LOG"\nprintf "%%s" "${HTTP_CODE:-200}"\n' > "$T/bin/curl"
printf '#!/bin/sh\nexit 0\n' > "$T/bin/sleep"
chmod +x "$T/bin/"*
export PATH="$T/bin:$PATH" LOG="$T/log" FAIL_BUILD="" HTTP_CODE=200

# instalação do comando
mkdir -p "$T/srv/deploy"; cp "$SRC/deploy/instalar-atualizador.sh" "$SRC/deploy/atualizar.sh" "$T/srv/deploy/" 2>/dev/null || true
BIN_DIR="$T/usr" CONF="$T/conf" bash "$SRC/deploy/instalar-atualizador.sh" >/dev/null || fail "instalador falhou"
[ -x "$T/usr/connecta-atualizar" ] || fail "comando não instalado"
grep -q "^REPO_DIR=$SRC$" "$T/conf" || fail "conf sem REPO_DIR"
cat > "$T/conf" <<C
REPO_DIR=$T/srv
BRANCH=main
BACKUP_DIR=$T/backups
KEEP=2
TOKEN_FILE=$T/token
LOCK_FILE=$T/lock
HEALTH_TIMEOUT=9
C
export CONNECTA_ATUALIZAR_CONF="$T/conf"
run() { "$T/usr/connecta-atualizar" "$@" </dev/null; }

# 1) atualização normal
echo v2 > "$T/dev/versao.txt"; git -C "$T/dev" commit -qam "v2" && git -C "$T/dev" push -q origin main 2>/dev/null
out=$(run 2>&1) || { echo "$out"; fail "atualização normal falhou"; }
echo "$out" | grep -q "^Atualizado.$" || fail "não mostrou Atualizado."
[ "$(cat "$T/srv/versao.txt")" = v2 ] || fail "não baixou a v2"
B=$(ls -1d "$T"/backups/2* | tail -1)
[ "$(cat "$B/commit")" = "$(git -C "$T/srv" rev-parse HEAD~1)" ] || fail "cópia não guardou a versão anterior"
[ "$(stat -c %a "$B/env")" = 600 ] || fail ".env da cópia não está protegido"
[ "$(cat "$B/banco.dump")" = DUMP ] || fail "não copiou o banco"
grep -q "docker tag sha256:app connecta-backup:app-" "$LOG" || fail "não guardou a imagem do app"
grep -q "^app connecta-app$" "$B/imagens" || fail "lista de imagens errada"
grep -q "compose build" "$LOG" && grep -q "compose up -d" "$LOG" || fail "não reconstruiu/reiniciou"
grep -q -- "--resolve crm.exemplo.com:443:127.0.0.1 https://crm.exemplo.com/login" "$LOG" || fail "não conferiu o site"
grep -q "image prune -f --filter label=com.docker.compose.project=srv" "$LOG" || fail "limpeza não ficou restrita ao projeto"
grep -Eq "docker (system|volume|network) prune|compose down" "$LOG" && fail "mexeu em coisas fora do projeto"
sleep 1

# 2) falha no build: código volta, sistema continua
echo v3 > "$T/dev/versao.txt"; git -C "$T/dev" commit -qam "v3" && git -C "$T/dev" push -q origin main 2>/dev/null
: > "$LOG"
out=$(FAIL_BUILD=1 run 2>&1) && fail "build quebrado deveria falhar"
echo "$out" | grep -q "NÃO foi atualizado" || fail "mensagem de build quebrado"
[ "$(cat "$T/srv/versao.txt")" = v2 ] || fail "código não voltou após build quebrado"
grep -q "compose up" "$LOG" && fail "reiniciou mesmo com build quebrado"

# 3) falha na migração: código volta
out=$(MIGRAR_RC=1 run 2>&1) && fail "migração quebrada deveria falhar"
echo "$out" | grep -q "migração do banco falhou" || fail "mensagem de migração"
[ "$(cat "$T/srv/versao.txt")" = v2 ] || fail "código não voltou após migração quebrada"

# 4) site fora do ar: mostra erro e como voltar
out=$(HTTP_CODE=502 run 2>&1) && fail "site fora deveria falhar"
echo "$out" | grep -q "connecta-atualizar --voltar" || fail "não ensinou a voltar"
echo "$out" | grep -q "^Atualizado.$" && fail "disse Atualizado. com site fora"
[ "$(cat "$T/srv/versao.txt")" = v3 ] || fail "deveria estar na v3"

# 5) --voltar: volta código e imagens da última cópia
: > "$LOG"
out=$(run --voltar 2>&1) || { echo "$out"; fail "--voltar falhou"; }
[ "$(cat "$T/srv/versao.txt")" = v2 ] || fail "--voltar não voltou o código"
grep -q "docker tag connecta-backup:app-.* connecta-app" "$LOG" || fail "--voltar não restaurou a imagem"
grep -q "compose up -d --no-build" "$LOG" || fail "--voltar não reiniciou"

# 6) guarda só KEEP cópias
[ "$(ls -1d "$T"/backups/2* | wc -l)" -le 2 ] || fail "não apagou cópias antigas"

# 7) pasta alterada à mão: não faz nada
echo mexido > "$T/srv/versao.txt"
out=$(run 2>&1) && fail "deveria recusar pasta alterada"
echo "$out" | grep -q "alterados à mão" || fail "mensagem de pasta alterada"
[ "$(cat "$T/srv/versao.txt")" = mexido ] || fail "mexeu nos arquivos alterados"
git -C "$T/srv" checkout -q versao.txt

# 8) comando instalado diferente do repositório: avisa para reinstalar
echo "# mudou" >> "$T/dev/deploy/atualizar.sh"; git -C "$T/dev" commit -qam "muda script" && git -C "$T/dev" push -q origin main 2>/dev/null
out=$(run 2>&1) || { echo "$out"; fail "atualização com script novo falhou"; }
echo "$out" | grep -q "Reinstale uma vez" || fail "não avisou sobre o script novo"

echo "OK: connecta-atualizar"
