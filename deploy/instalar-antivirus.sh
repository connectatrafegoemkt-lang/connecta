#!/usr/bin/env bash
# =====================================================================
# Instala o antivírus do servidor (ClamAV) — rode UMA vez (e de novo só se
# deploy/antivirus.sh mudar):
#     sudo bash /opt/connecta/deploy/instalar-antivirus.sh
#
#   * instala o ClamAV e liga a atualização automática da base de vírus;
#   * instala o comando connecta-antivirus;
#   * agenda uma varredura do servidor toda madrugada (03:30), com prioridade
#     baixa (não deixa o CRM lento);
#   * mostra um aviso ao entrar por SSH se algo suspeito for encontrado.
# Não apaga nem move arquivos de ninguém: só avisa.
# =====================================================================
set -euo pipefail
cd "$(dirname "$0")/.."
if [ "$(id -u)" -ne 0 ]; then echo "Rode como root: sudo bash $(pwd)/deploy/instalar-antivirus.sh"; exit 1; fi

echo "==> Instalando o ClamAV"
export DEBIAN_FRONTEND=noninteractive
apt-get update -q >/dev/null
apt-get install -y -q clamav clamav-freshclam >/dev/null

echo "==> Atualizando a base de vírus (primeira vez demora um pouco)"
systemctl stop clamav-freshclam >/dev/null 2>&1 || true
freshclam --quiet || echo "    aviso: a base não atualizou agora; o serviço tenta de novo sozinho"
systemctl enable --now clamav-freshclam >/dev/null

echo "==> Instalando o comando connecta-antivirus e a varredura diária"
install -m 755 deploy/antivirus.sh /usr/local/bin/connecta-antivirus

cat > /etc/systemd/system/connecta-antivirus.service <<'UNIT'
[Unit]
Description=CONNECTA: varredura antivírus do servidor (ClamAV)
After=clamav-freshclam.service

[Service]
Type=oneshot
ExecStart=/usr/local/bin/connecta-antivirus --varrer
Nice=19
IOSchedulingClass=idle
CPUQuota=60%
UNIT

cat > /etc/systemd/system/connecta-antivirus.timer <<'UNIT'
[Unit]
Description=CONNECTA: varredura antivírus toda madrugada

[Timer]
OnCalendar=*-*-* 03:30
RandomizedDelaySec=20m
Persistent=true

[Install]
WantedBy=timers.target
UNIT

cat > /etc/update-motd.d/99-connecta-antivirus <<'MOTD'
#!/bin/sh
[ -f /var/lib/connecta-antivirus/ultimo ] && grep -q '^STATUS=infectado' /var/lib/connecta-antivirus/ultimo && {
  echo; echo "  ATENÇÃO: o antivírus encontrou arquivos suspeitos. Rode: connecta-antivirus"; echo; }
exit 0
MOTD
chmod 755 /etc/update-motd.d/99-connecta-antivirus

systemctl daemon-reload
systemctl enable --now connecta-antivirus.timer >/dev/null

echo
echo "Antivírus instalado. Varredura automática toda madrugada (por volta das 03:30)."
echo "Ver o resultado:      connecta-antivirus"
echo "Varrer agora:         sudo connecta-antivirus --varrer"
