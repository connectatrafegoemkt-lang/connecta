#!/usr/bin/env bash
# =====================================================================
# connecta-atualizar — atualiza o CONNECTA CRM nesta VPS com UM comando.
#
#   connecta-atualizar                    atualiza para a versão mais nova
#   connecta-atualizar --voltar           volta para a cópia feita antes da última atualização
#   connecta-atualizar --voltar <cópia>   volta para uma cópia específica (veja --copias)
#   connecta-atualizar --copias           lista as cópias guardadas
#
# Instalado em /usr/local/bin/connecta-atualizar por (uma vez, ou quando
# este arquivo mudar):   sudo bash /opt/connecta/deploy/instalar-atualizador.sh
#
# Ordem: cópia de segurança → baixa do GitHub → instala dependências (build)
# → migrações do banco → reinicia → confere se o site respondeu.
# Só mexe no projeto docker compose da pasta do CONNECTA. Não apaga dados
# nem mexe em outros sistemas do servidor. Configuração (opcional) em
# /etc/connecta-atualizar.conf.
# =====================================================================
set -euo pipefail

CONF="${CONNECTA_ATUALIZAR_CONF:-/etc/connecta-atualizar.conf}"
REPO_DIR=/opt/connecta
BRANCH=main
BACKUP_DIR=/opt/connecta-backups
KEEP=5
BACKUP_BANCO=1
TOKEN_FILE=/root/.config/connecta-atualizar/github-token
LOCK_FILE=/var/lock/connecta-deploy.lock   # o mesmo do deploy automático
HEALTH_TIMEOUT=120
# shellcheck disable=SC1090
if [ -f "$CONF" ]; then . "$CONF"; fi

say()  { printf '\n==> %s\n' "$*"; }
info() { printf '    %s\n' "$*"; }
die()  { printf '\nERRO: %s\n' "$*" >&2; exit 1; }
env_get() { grep -E "^$1=" .env | head -1 | cut -d= -f2- || true; }

[ "$(id -u)" -eq 0 ] || die "rode como root (ou: sudo connecta-atualizar)"
cd "$REPO_DIR" 2>/dev/null || die "pasta do sistema não encontrada: $REPO_DIR"
[ -d .git ] || die "$REPO_DIR não é uma cópia do repositório (git)"
[ -f .env ] || die "arquivo .env não encontrado em $REPO_DIR"
PROJ=$(env_get COMPOSE_PROJECT_NAME); PROJ=${PROJ:-$(basename "$REPO_DIR" | tr '[:upper:]' '[:lower:]')}
DOMAIN=$(env_get CRM_DOMAIN)
TMP=$(mktemp -d); trap 'rm -rf "$TMP"' EXIT

exec 9>"$LOCK_FILE"
if ! flock -n 9; then
  echo "Outra atualização está em andamento; esperando ela terminar…"
  flock -w 1800 9 || die "outra atualização está travada há 30 minutos"
fi

# ------------------------------------------------------------ conferência
site_ok() {
  local i=0 code url="https://$DOMAIN/login"
  [ -n "$DOMAIN" ] || { info "CRM_DOMAIN vazio no .env: não dá para testar o site"; return 1; }
  while [ "$i" -lt "$HEALTH_TIMEOUT" ]; do
    code=$(curl -sk -o /dev/null -w '%{http_code}' --max-time 10 --resolve "$DOMAIN:443:127.0.0.1" "$url" 2>/dev/null || true)
    case "$code" in 2??|3??) info "site respondeu ($code): $url"; break ;; esac
    sleep 3; i=$((i + 3))
  done
  [ "$i" -lt "$HEALTH_TIMEOUT" ] || { info "o site não respondeu em ${HEALTH_TIMEOUT}s (último código: ${code:-nenhum})"; return 1; }
  sleep 5 # dá tempo de o worker cair, se for cair
  local running; running=$(docker compose ps --status running --services 2>/dev/null || true)
  for svc in app worker; do
    grep -qx "$svc" <<<"$running" || { info "o serviço '$svc' não está rodando"; return 1; }
  done
}

mostrar_logs() {
  echo "    Últimas linhas dos registros:" >&2
  docker compose logs --tail 25 app worker 2>&1 | sed 's/^/      /' >&2 || true
}

# ------------------------------------------------------------ cópias
listar_copias() { ls -1d "$BACKUP_DIR"/2* 2>/dev/null | sort || true; }

copia() {
  TS=$(date +%Y%m%d-%H%M%S)
  while [ -e "$BACKUP_DIR/$TS" ]; do command sleep 1; TS=$(date +%Y%m%d-%H%M%S); done
  B="$BACKUP_DIR/$TS"
  mkdir -p "$B"; chmod 700 "$BACKUP_DIR" "$B"
  git rev-parse HEAD > "$B/commit"
  git log --oneline -1 > "$B/versao"
  install -m 600 .env "$B/env"
  : > "$B/imagens"
  local svc cid img id
  for svc in app worker; do
    cid=$(docker compose ps -q "$svc" 2>/dev/null | head -1 || true)
    [ -n "$cid" ] || continue
    img=$(docker inspect -f '{{.Config.Image}}' "$cid")
    id=$(docker inspect -f '{{.Image}}' "$cid")
    docker tag "$id" "connecta-backup:$svc-$TS"
    printf '%s %s\n' "$svc" "$img" >> "$B/imagens"
  done
  info "código e configuração: $B"

  if [ "$BACKUP_BANCO" = 1 ]; then
    local url; url=$(env_get SUPABASE_DB_URL)
    if [ -n "$url" ]; then
      case "$url" in *sslmode=*) ;; *\?*) url="$url&sslmode=require" ;; *) url="$url?sslmode=require" ;; esac
      if PGPASSWORD=$(env_get SUPABASE_DB_PASSWORD) timeout 900 docker run --rm --network host -e PGPASSWORD \
           postgres:17-alpine pg_dump "$url" -n public -n app -Fc --no-owner --no-privileges > "$B/banco.dump" 2>"$TMP/dump.err"; then
        chmod 600 "$B/banco.dump"
        info "banco (só leitura, nada é alterado): $B/banco.dump ($(du -h "$B/banco.dump" | cut -f1))"
      else
        rm -f "$B/banco.dump"
        info "AVISO: não consegui copiar o banco ($(tail -1 "$TMP/dump.err")). Seguindo sem essa cópia."
      fi
    fi
  fi

  # guarda só as últimas $KEEP cópias
  local velha
  listar_copias | head -n "-$KEEP" | while read -r velha; do
    for svc in app worker; do docker rmi "connecta-backup:$svc-$(basename "$velha")" >/dev/null 2>&1 || true; done
    rm -rf "$velha"
  done
}

# ------------------------------------------------------------ GitHub
baixar() {
  if GIT_TERMINAL_PROMPT=0 git fetch -q origin "$BRANCH" 2>"$TMP/fetch.err"; then return 0; fi
  case "$(git remote get-url origin)" in
    https://*) ;;
    *) sed 's/^/    /' "$TMP/fetch.err" >&2; return 1 ;;
  esac
  # repositório privado: token guardado fora do Git (só root lê) ou pedido no terminal
  printf '#!/bin/sh\ncase "$1" in Username*) echo x-access-token ;; *) printf "%%s\\n" "$CONNECTA_GH_TOKEN" ;; esac\n' > "$TMP/askpass"
  chmod 700 "$TMP/askpass"
  fetch_tok() { CONNECTA_GH_TOKEN="$1" GIT_ASKPASS="$TMP/askpass" GIT_TERMINAL_PROMPT=0 \
                  git -c credential.helper= fetch -q origin "$BRANCH" 2>"$TMP/fetch.err"; }
  if [ -s "$TOKEN_FILE" ] && fetch_tok "$(cat "$TOKEN_FILE")"; then return 0; fi
  [ -t 0 ] || { sed 's/^/    /' "$TMP/fetch.err" >&2; info "sem token do GitHub válido em $TOKEN_FILE"; return 1; }
  echo "    O GitHub pediu acesso. Cole um token de leitura do repositório"
  echo "    (o texto NÃO aparece na tela e fica guardado só neste servidor)."
  local tok; read -rsp "    Token do GitHub: " tok; echo
  [ -n "$tok" ] || return 1
  fetch_tok "$tok" || { sed 's/^/    /' "$TMP/fetch.err" >&2; info "token recusado pelo GitHub"; return 1; }
  mkdir -p "$(dirname "$TOKEN_FILE")"; chmod 700 "$(dirname "$TOKEN_FILE")"
  (umask 077; printf '%s\n' "$tok" > "$TOKEN_FILE")
  info "token guardado em $TOKEN_FILE (só o root lê)"
}

# ------------------------------------------------------------ voltar
voltar() {
  local B
  if [ -n "${1:-}" ]; then B="$BACKUP_DIR/$(basename "$1")"; else B=$(listar_copias | tail -1); fi
  [ -n "$B" ] && [ -f "$B/commit" ] || die "nenhuma cópia encontrada (veja: connecta-atualizar --copias)"
  local TS; TS=$(basename "$B")
  say "Voltando para a cópia $TS: $(cat "$B/versao")"
  git checkout -q "$BRANCH"
  git reset -q --hard "$(cat "$B/commit")"
  local svc img
  if [ -s "$B/imagens" ]; then
    while read -r svc img; do docker tag "connecta-backup:$svc-$TS" "$img"; done < "$B/imagens"
    docker compose up -d --no-build >"$TMP/up.log" 2>&1 || { cat "$TMP/up.log" >&2; die "não consegui reiniciar a versão antiga"; }
  else
    docker compose up -d --build >"$TMP/up.log" 2>&1 || { tail -40 "$TMP/up.log" >&2; die "não consegui reiniciar a versão antiga"; }
  fi
  say "Conferindo se o sistema respondeu"
  site_ok || { mostrar_logs; die "voltei a versão, mas o site não respondeu"; }
  info "O banco de dados NÃO foi alterado (as migrações só acrescentam)."
  [ -f "$B/banco.dump" ] && info "Cópia do banco, se precisar: $B/banco.dump"
  printf '\nVoltou para a versão anterior.\n'
}

# ------------------------------------------------------------ comandos
case "${1:-}" in
  --voltar) voltar "${2:-}"; exit 0 ;;
  --copias)
    listar_copias | while read -r d; do printf '%s  %s\n' "$(basename "$d")" "$(cat "$d/versao" 2>/dev/null)"; done
    exit 0 ;;
  ""|--atualizar) ;;
  -h|--ajuda|--help) sed -n '3,9p' "$0" | sed 's/^# \{0,1\}//'; exit 0 ;;
  *) die "opção desconhecida: $1 (use --ajuda)" ;;
esac

echo "CONNECTA CRM: atualizando ($REPO_DIR, branch $BRANCH)"

say "1/6 Conferindo a pasta do sistema"
sujos=$(git status --porcelain --untracked-files=no)
if [ -n "$sujos" ]; then
  printf '%s\n' "$sujos" | sed 's/^/    /' >&2
  die "há arquivos alterados à mão em $REPO_DIR (acima). Nada foi feito. Para descartar: git -C $REPO_DIR stash"
fi
git checkout -q "$BRANCH" 2>/dev/null || die "branch $BRANCH não existe em $REPO_DIR"
ANTES=$(git rev-parse HEAD)
info "versão atual: $(git log --oneline -1)"

say "2/6 Guardando uma cópia do estado atual"
copia

say "3/6 Baixando a versão mais nova do GitHub"
baixar || die "não consegui baixar do GitHub. Nada foi alterado."
git merge -q --ff-only FETCH_HEAD 2>"$TMP/merge.err" || { sed 's/^/    /' "$TMP/merge.err" >&2; die "a versão do servidor diverge do GitHub. Nada foi alterado."; }
if [ "$(git rev-parse HEAD)" = "$ANTES" ]; then
  info "já estava na versão mais nova; reaplicando mesmo assim"
else
  git log --oneline "$ANTES..HEAD" | sed 's/^/    + /'
fi

desfazer() { git reset -q --hard "$ANTES"; info "código voltou para $(git log --oneline -1)"; }

say "4/6 Instalando dependências (pode levar alguns minutos)"
if ! docker compose build >"$B/build.log" 2>&1; then
  tail -40 "$B/build.log" | sed 's/^/    /' >&2
  desfazer
  die "a instalação falhou (registro completo: $B/build.log). O sistema NÃO foi atualizado e continua no ar."
fi

say "5/6 Aplicando migrações do banco"
set +e; bash deploy/migrar-banco.sh; rc=$?; set -e
if [ "$rc" = 2 ]; then
  info "AVISO: banco não configurado no .env; migrações puladas"
elif [ "$rc" != 0 ]; then
  desfazer
  die "a migração do banco falhou (ela é tudo-ou-nada: o banco não ficou pela metade). O sistema NÃO foi atualizado e continua no ar."
fi

say "6/6 Reiniciando o sistema"
if ! docker compose up -d >"$B/up.log" 2>&1; then
  tail -40 "$B/up.log" | sed 's/^/    /' >&2
  die "não consegui reiniciar. Para voltar à versão anterior: connecta-atualizar --voltar"
fi
docker image prune -f --filter "label=com.docker.compose.project=$PROJ" >/dev/null 2>&1 || true

say "Conferindo se o sistema respondeu"
if ! site_ok; then
  mostrar_logs
  die "o sistema não respondeu depois da atualização. Para voltar à versão anterior: connecta-atualizar --voltar"
fi

if [ -f deploy/atualizar.sh ] && ! cmp -s deploy/atualizar.sh "$(readlink -f "$0")"; then
  printf '\nAVISO: o próprio comando de atualização mudou. Reinstale uma vez com:\n  sudo bash %s/deploy/instalar-atualizador.sh\n' "$REPO_DIR"
fi
printf '\nVersão: %s\nAtualizado.\n' "$(git log --oneline -1)"
