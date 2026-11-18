#!/usr/bin/env bash
# =====================================================================
# Instalação / atualização do CONNECTA CRM numa VPS Ubuntu 24.04.
# Rode como root, dentro da pasta do repositório:
#     bash deploy/instalar.sh
# Na primeira vez ele pergunta as chaves do Supabase e cria o .env
# (que fica SÓ neste servidor). Nas próximas, só atualiza e reinicia.
# =====================================================================
set -euo pipefail
cd "$(dirname "$0")/.."

if [ "$(id -u)" -ne 0 ]; then echo "Rode como root (sudo bash deploy/instalar.sh)"; exit 1; fi

echo "==> 1/4 Instalando Docker e firewall (se necessário)"
if ! command -v docker >/dev/null 2>&1 || ! docker compose version >/dev/null 2>&1; then
  apt-get update -q
  DEBIAN_FRONTEND=noninteractive apt-get install -y -q docker.io docker-compose-v2 ufw
  systemctl enable --now docker
fi
if command -v ufw >/dev/null 2>&1; then
  ufw allow OpenSSH >/dev/null; ufw allow 80/tcp >/dev/null; ufw allow 443 >/dev/null
  ufw --force enable >/dev/null
fi

echo "==> 2/4 Configuração (.env)"
if [ ! -f .env ]; then
  read -rp "Endereço do CRM [sistema.connectatrafego.com.br]: " DOMAIN
  DOMAIN=${DOMAIN:-sistema.connectatrafego.com.br}
  read -rp "Supabase Project URL (https://xxxx.supabase.co): " SB_URL
  read -rp "Supabase anon / publishable key: " SB_ANON
  read -rsp "Supabase service_role / secret key (não aparece ao digitar): " SB_SERVICE; echo
  WA_KEY=$(openssl rand -base64 32)
  umask 077
  cat > .env <<ENV
CRM_DOMAIN=${DOMAIN}
NEXT_PUBLIC_SUPABASE_URL=${SB_URL}
NEXT_PUBLIC_SUPABASE_ANON_KEY=${SB_ANON}
SUPABASE_SERVICE_ROLE_KEY=${SB_SERVICE}
WHATSAPP_CREDENTIALS_KEY=${WA_KEY}
LOG_LEVEL=info
ENV
  chmod 600 .env
  echo "   .env criado (permissão 600). FAÇA UMA CÓPIA da linha WHATSAPP_CREDENTIALS_KEY"
  echo "   num gerenciador de senhas: sem ela, os clientes precisam ler o QR de novo."
else
  echo "   .env já existe, mantendo."
fi
for v in CRM_DOMAIN NEXT_PUBLIC_SUPABASE_URL NEXT_PUBLIC_SUPABASE_ANON_KEY SUPABASE_SERVICE_ROLE_KEY WHATSAPP_CREDENTIALS_KEY; do
  if ! grep -qE "^${v}=.+" .env; then echo "Faltando ${v} no .env"; exit 1; fi
done

echo "==> 3/4 Construindo e subindo (app + worker + HTTPS). Pode levar alguns minutos..."
docker compose up -d --build
docker image prune -f >/dev/null

echo "==> 4/4 Situação"
docker compose ps
DOMAIN=$(grep -E '^CRM_DOMAIN=' .env | cut -d= -f2)
echo
echo "Pronto. Acesse: https://${DOMAIN}"
echo "(o certificado HTTPS é emitido sozinho assim que o DNS de ${DOMAIN} apontar para esta VPS)"
