#!/usr/bin/env bash
# Testa deploy/migrar-banco.sh num Postgres local (o mesmo do isolamento-db).
#   ADMIN_URL=postgres://postgres:postgres@127.0.0.1:5432/postgres tests/deploy/migrar-banco.test.sh
set -euo pipefail
cd "$(dirname "$0")/../.."
ADMIN_URL="${ADMIN_URL:-postgres://postgres:postgres@127.0.0.1:5432/postgres}"
BASE="${ADMIN_URL%/*}"
DB=migrar_teste
URL="$BASE/$DB"
fail() { echo "FALHOU: $*" >&2; exit 1; }
fresh() {
  psql "$ADMIN_URL" -q -v ON_ERROR_STOP=1 -c "drop database if exists $DB with (force)" -c "create database $DB"
  psql "$URL" -q -v ON_ERROR_STOP=1 -f tests/db/supabase-shim.sql >/dev/null 2>&1
}
migrar() { DATABASE_URL="$URL" bash deploy/migrar-banco.sh; }
count() { psql "$URL" -At -c "select count(*) from supabase_migrations.schema_migrations"; }
total=$(ls supabase/migrations/*.sql | wc -l)
# Migrations da época em que o banco era atualizado à mão pelo SQL Editor
# (as que deploy/migrar-banco.sh reconhece na primeira execução). As
# posteriores são sempre aplicadas pelo próprio script.
BASELINE=8
# pg_dump 16 contra servidor 17 escreve "pg_attver=<número>" variável: não é esquema, é ruído.
schema() { pg_dump -s --no-owner "$URL" | grep -v '^\\\|^--' | grep -v 'supabase_migrations' | grep -v 'pg_attver=' | sort; }

echo "== 1. banco novo: aplica tudo"
fresh
out=$(migrar); echo "$out"
echo "$out" | grep -q "$total aplicada" || fail "esperava $total aplicadas"
[ "$(count)" = "$total" ] || fail "registro incompleto"
schema > /tmp/ref-migrar.sql

echo "== 2. rodar de novo: nada muda"
out=$(migrar); echo "$out"
echo "$out" | grep -q "já estava atualizado" || fail "segunda execução deveria ser no-op"

echo "== 3. banco antigo, migrations rodadas à mão (como em produção): registra as antigas e aplica as novas"
fresh
for f in $(ls supabase/migrations/*.sql | head -n $BASELINE); do psql "$URL" -q -v ON_ERROR_STOP=1 -f "$f" >/dev/null || fail "aplicar $f"; done
out=$(migrar); echo "$out"
echo "$out" | grep -q "$((total - BASELINE)) aplicada(s), $BASELINE registrada(s)" || fail "deveria registrar $BASELINE e aplicar $((total - BASELINE))"
check_schema() { if ! diff <(schema) /tmp/ref-migrar.sql > /tmp/diff-migrar.txt; then head -40 /tmp/diff-migrar.txt >&2; fail "esquema diferente"; fi; }
check_schema

echo "== 4. banco antigo sem a última migration manual: registra as anteriores e aplica o resto"
fresh
for f in $(ls supabase/migrations/*.sql | head -n $((BASELINE - 1))); do psql "$URL" -q -v ON_ERROR_STOP=1 -f "$f" >/dev/null || fail "aplicar $f"; done
out=$(migrar); echo "$out"
echo "$out" | grep -q "$((total - BASELINE + 1)) aplicada(s), $((BASELINE - 1)) registrada(s)" || fail "deveria aplicar as que faltam"
check_schema

echo "== 5. migration com erro: nada fica pela metade"
tmp=supabase/migrations/29991231000000_teste_erro.sql
trap 'rm -f "$tmp"' EXIT
printf "create table public.metade_teste (id int);\nselect 1/0;\n" > "$tmp"
if migrar >/dev/null 2>&1; then fail "deveria falhar"; fi
[ "$(psql "$URL" -At -c "select to_regclass('public.metade_teste') is null")" = "t" ] || fail "ficou pela metade"
[ "$(psql "$URL" -At -c "select count(*) from supabase_migrations.schema_migrations where version = '29991231000000'")" = "0" ] || fail "registrou migration com erro"
rm -f "$tmp"

psql "$ADMIN_URL" -q -c "drop database if exists $DB with (force)"
echo "OK: todos os cenários passaram"
