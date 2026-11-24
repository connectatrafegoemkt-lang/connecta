#!/usr/bin/env bash
# Testa deploy/antivirus.sh (connecta-antivirus) com um clamscan falso:
# limpo, com arquivo suspeito (só avisa, não apaga) e com erro. Requer root.
set -euo pipefail
cd "$(dirname "$0")/../.."
fail() { echo "FALHOU: $*" >&2; exit 1; }
T=$(mktemp -d); trap 'rm -rf "$T"' EXIT
mkdir -p "$T/alvo" && echo x > "$T/alvo/virus.exe"
cat > "$T/clamscan" <<'S'
#!/bin/sh
echo "$*" > "$ARGS"
case "$MODO" in
  limpo) printf -- '----------- SCAN SUMMARY -----------\nScanned files: 1234\nInfected files: 0\n'; exit 0 ;;
  virus) printf '%s/virus.exe: Win.Test.EICAR_HDB-1 FOUND\n----------- SCAN SUMMARY -----------\nScanned files: 99\n' "$ALVO"; exit 1 ;;
  *) echo "ERROR: Can't open database"; exit 2 ;;
esac
S
chmod +x "$T/clamscan"
export STATE_DIR="$T/state" LOG_DIR="$T/log" CLAMSCAN="$T/clamscan" ALVO="$T/alvo" ARGS="$T/args"
av() { bash deploy/antivirus.sh "$@"; }

[[ "$(av)" == *"nenhuma varredura"* ]] || fail "estado inicial"

out=$(MODO=limpo av --varrer) || fail "varredura limpa falhou"
echo "$out" | grep -q "LIMPO.*1234 arquivos" || fail "resultado limpo: $out"
grep -q -- "--exclude-dir=^/var/lib/docker/" "$ARGS" || fail "não exclui o docker"
grep -q -- "-i" "$ARGS" && ! grep -q -- "--remove\|--move" "$ARGS" || fail "não pode apagar/mover arquivos"

out=$(MODO=virus av --varrer) || fail "varredura com vírus deveria terminar ok"
echo "$out" | grep -q "ATENÇÃO.*1 arquivo" || fail "não avisou do vírus: $out"
echo "$out" | grep -q "virus.exe: Win.Test.EICAR_HDB-1" || fail "não listou o arquivo"
[ -f "$T/alvo/virus.exe" ] || fail "apagou o arquivo"
[[ "$(av)" == *"ATENÇÃO"* ]] || fail "status não mostra o aviso"

MODO=erro av --varrer >/dev/null && fail "erro deveria sair com código"
[[ "$(av)" == *"teve erro"* ]] || fail "status de erro"

for _ in $(seq 1 3); do MODO=limpo av --varrer >/dev/null; done
[ "$(ls "$LOG_DIR" | wc -l)" -ge 1 ] || fail "sem registros"
echo "OK: connecta-antivirus"
