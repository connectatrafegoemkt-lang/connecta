#!/usr/bin/env bash
# Testa deploy/configurar-deploy-automatico.sh com um sshd de verdade:
# a chave gerada só pode executar o comando travado (connecta-deploy),
# nunca o comando que o cliente pedir, nem abrir terminal ou túnel.
# Requer root + openssh-server/openssh-client.
set -euo pipefail
cd "$(dirname "$0")/../.."
fail() { echo "FALHOU: $*" >&2; exit 1; }
T=$(mktemp -d)
cleanup() { [ -f "$T/sshd.pid" ] && kill "$(cat "$T/sshd.pid")" 2>/dev/null || true; rm -rf "$T"; rm -f .env.deploy-teste; }
trap cleanup EXIT

# .env falso (o script exige .env) — usa cópia temporária isolada
WORK="$T/repo"; mkdir -p "$WORK/deploy"
cp deploy/configurar-deploy-automatico.sh "$WORK/deploy/"
printf 'CRM_DOMAIN=localhost\n' > "$WORK/.env"
ssh-keygen -q -t ed25519 -N "" -f "$T/host_key"

out=$(SSH_DIR="$T/ssh" BIN_DIR="$T/bin" HOST_KEY="$T/host_key.pub" bash "$WORK/deploy/configurar-deploy-automatico.sh")
echo "$out" | grep -q "VPS_HOST" || fail "não mostrou os secrets"
echo "$out" | grep -q "BEGIN OPENSSH PRIVATE KEY" || fail "não mostrou a chave privada"
known=$(echo "$out" | grep -E '^localhost ssh-ed25519 ')
[ -n "$known" ] || fail "linha de known_hosts ausente"
grep -q '^restrict,command="'"$T/bin/connecta-deploy"'" ssh-ed25519 ' "$T/ssh/authorized_keys" || fail "chave não está travada"
grep -q 'git merge -q --ff-only origin/main' "$T/bin/connecta-deploy" || fail "runner sem atualização da main"
grep -q "cd \"$WORK\"" "$T/bin/connecta-deploy" || fail "runner aponta para pasta errada"

# rodar de novo troca a chave (só uma linha autorizada)
SSH_DIR="$T/ssh" BIN_DIR="$T/bin" HOST_KEY="$T/host_key.pub" bash "$WORK/deploy/configurar-deploy-automatico.sh" >/dev/null
[ "$(grep -c connecta-github-deploy "$T/ssh/authorized_keys")" = "1" ] || fail "linhas duplicadas no authorized_keys"

# troca o runner por um stub que só mostra o que recebeu, e sobe um sshd de teste
printf '#!/bin/sh\necho "FORCADO pedido=[$SSH_ORIGINAL_COMMAND]"\n' > "$T/bin/connecta-deploy"; chmod 755 "$T/bin/connecta-deploy"
mkdir -p /run/sshd
cat > "$T/sshd_config" <<CFG
Port 2299
ListenAddress 127.0.0.1
HostKey $T/host_key
PidFile $T/sshd.pid
AuthorizedKeysFile $T/ssh/authorized_keys
PasswordAuthentication no
KbdInteractiveAuthentication no
PermitRootLogin prohibit-password
StrictModes no
UsePAM no
CFG
/usr/sbin/sshd -f "$T/sshd_config"
sleep 1
printf '[localhost]:2299 %s\n' "$(echo "$known" | cut -d' ' -f2-)" > "$T/known_hosts"
SSHC=(ssh -p 2299 -i "$T/ssh/deploy_github" -o IdentitiesOnly=yes -o BatchMode=yes -o StrictHostKeyChecking=yes -o UserKnownHostsFile="$T/known_hosts" root@localhost)

r=$("${SSHC[@]}" 2>&1) || fail "conexão do deploy falhou: $r"
echo "$r" | grep -q "FORCADO pedido=\[\]" || fail "não rodou o comando travado: $r"

r=$("${SSHC[@]}" 'id; cat /etc/shadow' 2>&1) || true
echo "$r" | grep -q "FORCADO" || fail "comando do cliente não foi substituído: $r"
echo "$r" | grep -q "uid=" && fail "cliente conseguiu rodar comando próprio: $r"

r=$(timeout 10 "${SSHC[@]}" -W 127.0.0.1:2299 </dev/null 2>&1) || true
echo "$r" | grep -qi "prohibited" || fail "túnel não foi bloqueado: $r"

r=$(ssh -p 2299 -i "$T/host_key" -o IdentitiesOnly=yes -o BatchMode=yes -o StrictHostKeyChecking=yes -o UserKnownHostsFile="$T/known_hosts" root@localhost 2>&1) && fail "chave não autorizada entrou"

# servidor falso (outra host key) é recusado
ssh-keygen -q -t ed25519 -N "" -f "$T/fake_host"
printf '[localhost]:2299 %s\n' "$(cut -d' ' -f1,2 "$T/fake_host.pub")" > "$T/known_fake"
r=$(ssh -p 2299 -i "$T/ssh/deploy_github" -o IdentitiesOnly=yes -o BatchMode=yes -o StrictHostKeyChecking=yes -o UserKnownHostsFile="$T/known_fake" root@localhost 2>&1) && fail "aceitou servidor com identidade diferente"
echo "$r" | grep -qi "host key" || fail "esperava erro de host key: $r"

echo "OK: deploy automático travado e verificado"
