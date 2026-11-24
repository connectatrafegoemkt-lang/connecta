#!/usr/bin/env bash
# =====================================================================
# connecta-antivirus — antivírus (ClamAV) do servidor inteiro.
#
#   connecta-antivirus            mostra o resultado da última varredura
#   connecta-antivirus --varrer   varre o servidor agora (demora; roda com
#                                 prioridade baixa para não pesar no sistema)
#
# A varredura automática roda toda madrugada (timer connecta-antivirus).
# Só AVISA: não apaga nem move arquivos (para não quebrar nada no servidor).
# Se achar algo, aparece um aviso ao entrar no servidor por SSH.
# Instalado por: sudo bash /opt/connecta/deploy/instalar-antivirus.sh
# =====================================================================
set -euo pipefail

STATE_DIR="${STATE_DIR:-/var/lib/connecta-antivirus}"
LOG_DIR="${LOG_DIR:-/var/log/connecta-antivirus}"
CLAMSCAN="${CLAMSCAN:-clamscan}"
ALVO="${ALVO:-/}"
KEEP_LOGS=30

mostrar() {
  if [ ! -f "$STATE_DIR/ultimo" ]; then
    echo "Antivírus: nenhuma varredura feita ainda (a primeira roda esta madrugada, ou rode: connecta-antivirus --varrer)"
    return 0
  fi
  # shellcheck disable=SC1091
  . "$STATE_DIR/ultimo"
  case "$STATUS" in
    limpo)    echo "Antivírus: servidor LIMPO na última varredura ($DATA, $ARQUIVOS arquivos verificados)." ;;
    infectado)
      echo "ATENÇÃO — antivírus encontrou $INFECTADOS arquivo(s) suspeito(s) na varredura de $DATA:"
      sed 's/^/  /' "$STATE_DIR/suspeitos"
      echo "Nada foi apagado. Registro completo: $LOG"
      echo "Mande esta lista para o suporte antes de apagar qualquer coisa." ;;
    *)        echo "Antivírus: a última varredura ($DATA) teve erro. Registro: $LOG" ;;
  esac
}

varrer() {
  [ "$(id -u)" -eq 0 ] || { echo "Rode como root: sudo connecta-antivirus --varrer"; exit 1; }
  mkdir -p "$STATE_DIR" "$LOG_DIR"
  exec 9>"$STATE_DIR/.lock"
  flock -n 9 || { echo "Já há uma varredura em andamento."; exit 0; }
  local data log rc
  data=$(date '+%d/%m/%Y %H:%M')
  log="$LOG_DIR/varredura-$(date +%Y%m%d-%H%M%S).log"
  echo "Varrendo o servidor (pode levar bastante tempo)… registro: $log"
  set +e
  nice -n 19 ionice -c 3 "$CLAMSCAN" -r -i --cross-fs=no \
    --max-filesize=100M --max-scansize=300M \
    --exclude-dir='^/proc/' --exclude-dir='^/sys/' --exclude-dir='^/dev/' --exclude-dir='^/run/' \
    --exclude-dir='^/var/lib/docker/' --exclude-dir='^/var/lib/containerd/' --exclude-dir='^/snap/' \
    --exclude-dir='^/var/lib/clamav/' --exclude-dir="^$LOG_DIR/" \
    "$ALVO" > "$log" 2>&1
  rc=$?
  set -e
  grep -E ': .+ FOUND$' "$log" | sed 's/ FOUND$//' > "$STATE_DIR/suspeitos" || true
  local n arq status
  n=$(wc -l < "$STATE_DIR/suspeitos" | tr -d ' ')
  arq=$(grep -E '^Scanned files:' "$log" | awk '{print $3}' || true)
  if [ "$n" -gt 0 ]; then status=infectado; elif [ "$rc" -eq 0 ]; then status=limpo; else status=erro; fi
  printf 'STATUS=%s\nDATA=%q\nINFECTADOS=%s\nARQUIVOS=%s\nLOG=%q\n' "$status" "$data" "$n" "${arq:-0}" "$log" > "$STATE_DIR/ultimo.novo"
  mv -f "$STATE_DIR/ultimo.novo" "$STATE_DIR/ultimo"
  find "$LOG_DIR" -name 'varredura-*.log' -type f | sort | head -n "-$KEEP_LOGS" | xargs -r rm -f
  mostrar
  [ "$status" != erro ] || exit 2
}

case "${1:-}" in
  "") mostrar ;;
  --varrer) varrer ;;
  -h|--ajuda|--help) sed -n '3,12p' "$0" | sed 's/^# \{0,1\}//' ;;
  *) echo "Opção desconhecida: $1 (use --ajuda)"; exit 1 ;;
esac
