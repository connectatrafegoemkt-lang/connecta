#!/usr/bin/env bash
# Recria um banco de testes em um Postgres local SEM Docker:
# aplica o shim do Supabase + todas as migrations.
# Uso: DATABASE_URL=postgres://postgres:postgres@127.0.0.1:5432/connecta_test scripts/db-reset-local.sh
set -euo pipefail
URL="${DATABASE_URL:-postgres://postgres:postgres@127.0.0.1:5432/connecta_test}"
DB="${URL##*/}"
ADMIN_URL="${URL%/*}/postgres"
cd "$(dirname "$0")/.."

psql "$ADMIN_URL" -v ON_ERROR_STOP=1 -q -c "drop database if exists \"$DB\" with (force);" -c "create database \"$DB\";"
psql "$URL" -v ON_ERROR_STOP=1 -q -f tests/db/supabase-shim.sql
for f in supabase/migrations/*.sql; do
  echo "aplicando $f"
  psql "$URL" -v ON_ERROR_STOP=1 -q -f "$f"
done
echo "banco $DB pronto"
