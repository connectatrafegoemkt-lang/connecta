#!/usr/bin/env bash
# =====================================================================
# Aplica no banco (Supabase) as migrations de supabase/migrations que
# ainda não foram aplicadas. Seguro para rodar quantas vezes quiser.
#
#   - Cada migration roda numa ÚNICA transação: ou entra inteira, ou nada
#     muda (nunca fica "pela metade").
#   - O que já foi aplicado fica registrado em
#     supabase_migrations.schema_migrations (mesmo formato do Supabase CLI).
#   - Primeira execução num banco que já tinha as migrations rodadas à mão
#     pelo SQL Editor: detecta o que já existe e só registra (não roda de novo).
#
# Conexão (lida do ambiente ou do .env):
#   SUPABASE_DB_URL       postgresql://usuario@host:5432/postgres  (sem senha)
#   SUPABASE_DB_PASSWORD  senha do banco
# ou DATABASE_URL completa (usado nos testes).
#
# Usa o psql da máquina; se não houver, usa um container postgres:17-alpine.
# =====================================================================
set -euo pipefail
cd "$(dirname "$0")/.."

MIG_DIR="supabase/migrations"

env_get() { [ -f .env ] && grep -E "^$1=" .env | head -1 | cut -d= -f2- || true; }

URL="${DATABASE_URL:-${SUPABASE_DB_URL:-$(env_get SUPABASE_DB_URL)}}"
export PGPASSWORD="${PGPASSWORD:-${SUPABASE_DB_PASSWORD:-$(env_get SUPABASE_DB_PASSWORD)}}"
export PGOPTIONS="-c client_min_messages=warning"
if [ -z "$URL" ]; then
  echo "   SUPABASE_DB_URL não configurada: pulando a atualização do banco." >&2
  exit 2
fi
# Exige TLS fora do localhost (Supabase aceita e recomenda)
case "$URL" in
  *127.0.0.1*|*localhost*) ;;
  *) case "$URL" in *sslmode=*) ;; *\?*) URL="${URL}&sslmode=require" ;; *) URL="${URL}?sslmode=require" ;; esac ;;
esac

if command -v psql >/dev/null 2>&1; then
  PSQL=(psql)
else
  PSQL=(docker run --rm -i --network host -e PGPASSWORD -e PGOPTIONS postgres:17-alpine psql)
fi
q() { "${PSQL[@]}" "$URL" -X -q -v ON_ERROR_STOP=1 -At "$@"; }

# Teste de conexão com mensagem clara
if ! q -c "select 1" >/dev/null 2>/tmp/migrar-erro.$$; then
  echo "   Não consegui conectar no banco:" >&2
  sed 's/^/     /' /tmp/migrar-erro.$$ >&2; rm -f /tmp/migrar-erro.$$
  echo "   Confira SUPABASE_DB_URL e SUPABASE_DB_PASSWORD no .env." >&2
  exit 1
fi
rm -f /tmp/migrar-erro.$$

# Como reconhecer, na primeira vez, uma migration já aplicada à mão.
signature() {
  case "$1" in
    20261116000001) echo "to_regclass('public.tenants') is not null" ;;
    20261116000002) echo "to_regclass('public.contacts') is not null" ;;
    20261116000003) echo "exists (select 1 from pg_policies where schemaname = 'storage' and policyname = 'tenant_files_select')" ;;
    20261116000004) echo "to_regclass('public.whatsapp_sessions') is not null" ;;
    20261118000005) echo "to_regclass('public.ai_settings') is not null" ;;
    20261118000006) echo "to_regclass('public.quick_replies') is not null" ;;
    20261118000007) echo "to_regclass('public.departments') is not null" ;;
    20261118000008) echo "to_regclass('app.platform_admins') is not null" ;;
    *) echo "false" ;;
  esac
}

FIRST_RUN=$(q -c "select to_regclass('supabase_migrations.schema_migrations') is null")
q <<'SQL'
create schema if not exists supabase_migrations;
create table if not exists supabase_migrations.schema_migrations (
  version    text primary key,
  statements text[],
  name       text
);
revoke all on schema supabase_migrations from public;
revoke all on supabase_migrations.schema_migrations from public;
SQL

applied=0; registered=0
for f in "$MIG_DIR"/*.sql; do
  base=$(basename "$f" .sql)
  version=${base%%_*}
  name=${base#*_}
  done_already=$(q -c "select exists (select 1 from supabase_migrations.schema_migrations where version = '$version')")
  [ "$done_already" = "t" ] && continue

  if [ "$FIRST_RUN" = "t" ] && [ "$(q -c "select $(signature "$version")")" = "t" ]; then
    q -c "insert into supabase_migrations.schema_migrations (version, name) values ('$version', '$name')"
    echo "   = $base (já estava no banco; só registrado)"
    registered=$((registered + 1))
    continue
  fi

  echo "   + aplicando $base"
  if ! { cat "$f"; printf "\ninsert into supabase_migrations.schema_migrations (version, name) values ('%s', '%s');\n" "$version" "$name"; } \
      | q --single-transaction -f - >/dev/null; then
    echo "   ERRO ao aplicar $base. Nada desta migration foi gravado (a transação foi desfeita)." >&2
    exit 1
  fi
  applied=$((applied + 1))
done

if [ $applied -eq 0 ] && [ $registered -eq 0 ]; then
  echo "   banco já estava atualizado"
else
  echo "   banco atualizado: $applied aplicada(s), $registered registrada(s)"
fi
