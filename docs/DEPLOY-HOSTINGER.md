# Colocar o CONNECTA CRM no ar (VPS Hostinger + Supabase)

Endereço final: **https://sistema.connectatrafego.com.br**
O site atual (`www.connectatrafego.com.br`) continua exatamente onde está.

```
Clientes ──▶ sistema.connectatrafego.com.br (VPS Hostinger)
                 ├─ Caddy  : HTTPS automático
                 ├─ app    : telas + API do CRM
                 └─ worker : WhatsApp de cada cliente conectado 24h
                         │
                         ▼
                 Supabase (banco, login, arquivos, tempo real)
```

> ⚠️ Nunca cole chaves (service_role, senha root, WHATSAPP_CREDENTIALS_KEY)
> em chat, e-mail ou GitHub. Elas vão **só** no arquivo `.env` da VPS.

---

## 1. Supabase (uma vez)

1. Rodar o banco: SQL Editor → New query → colar `connecta-banco-completo.sql`
   (ou as migrations de `supabase/migrations/` em ordem) → **Run**.
2. **Authentication → URL Configuration**
   - Site URL: `https://sistema.connectatrafego.com.br`
3. **Authentication → Sign In / Providers → Email**: desligue **Allow new users to sign up**
   (os usuários são criados pela CONNECTA ou pelo admin de cada cliente).
4. **Project Settings → API Keys**: deixe esta tela aberta; você vai precisar de
   - **Project URL** (`https://xxxx.supabase.co`, em *Project Settings → Data API*)
   - **anon / publishable key** (pública)
   - **service_role / secret key** (SECRETA)

## 2. DNS (uma vez)

hPanel → **Domínios** → `connectatrafego.com.br` → **DNS / Nameservers** → adicionar:

| Tipo | Nome | Aponta para |
|---|---|---|
| A | `sistema` | IP da VPS (hPanel → VPS → Visão geral) |

Não altere os registros existentes (são do site). A propagação leva de minutos a algumas horas.
Para conferir, abra `https://dnschecker.org` e pesquise `sistema.connectatrafego.com.br`.

## 3. Entrar na VPS

Mais fácil: hPanel → **VPS** → **Terminal do navegador** (botão no topo da página da VPS).
Alternativa no Windows (PowerShell) ou Mac (Terminal):

```bash
ssh root@IP_DA_VPS
```

## 4. Baixar o sistema (uma vez)

**Se o repositório for público:**

```bash
git clone https://github.com/connectatrafegoemkt-lang/connecta.git /opt/connecta
```

**Se o repositório for privado** (recomendado), crie uma *deploy key* (acesso só de leitura):

```bash
ssh-keygen -t ed25519 -N "" -f ~/.ssh/connecta_deploy -C "vps-connecta"
```

```bash
cat ~/.ssh/connecta_deploy.pub
```

Copie a linha que aparecer e cole no GitHub: repositório → **Settings → Deploy keys →
Add deploy key** (deixe *Allow write access* DESMARCADO). Depois:

```bash
printf 'Host github.com\n  IdentityFile ~/.ssh/connecta_deploy\n' >> ~/.ssh/config
```

```bash
git clone git@github.com:connectatrafegoemkt-lang/connecta.git /opt/connecta
```

## 5. Instalar e subir

```bash
cd /opt/connecta && bash deploy/instalar.sh
```

Na primeira vez o script pergunta o endereço do CRM, a Project URL, a anon key e a
service_role key (essa não aparece enquanto você digita). Ele:

- instala Docker e o firewall (libera só SSH, 80 e 443);
- cria o `.env` com permissão restrita e **gera sozinho** a `WHATSAPP_CREDENTIALS_KEY`;
- constrói e sobe app + worker + HTTPS.

> 🔐 Guarde uma cópia da linha `WHATSAPP_CREDENTIALS_KEY` do `.env` num gerenciador de
> senhas (`grep WHATSAPP /opt/connecta/.env`). Se ela se perder, todos os clientes
> precisam ler o QR code de novo.

Quando terminar, acesse **https://sistema.connectatrafego.com.br**. Se o navegador
reclamar do certificado, o DNS ainda está propagando: espere e tente de novo.

## 6. Cadastrar o primeiro cliente

```bash
cd /opt/connecta && docker compose run --rm worker npx tsx scripts/create-tenant.ts "Nome do Cliente" nome-do-cliente admin@cliente.com.br "Senha-Forte-Inicial" "Nome do Admin"
```

- `nome-do-cliente`: identificador curto, só letras minúsculas, números e hífen.
- O admin entra em `https://sistema.connectatrafego.com.br/login`, troca a senha e cria os
  atendentes em **Configurações → Usuários**.
- Em **WhatsApp**, o admin clica **Conectar WhatsApp** e lê o QR com o celular da empresa.

## 7. Atualizar o sistema

Sempre que uma novidade for mesclada na `main` do GitHub, na VPS:

```bash
cd /opt/connecta && git pull && bash deploy/instalar.sh
```

Esse comando atualiza **o sistema e o banco** (Supabase) juntos: ele aplica
sozinho as mudanças de banco que faltarem (`deploy/migrar-banco.sh`). Cada
mudança entra inteira ou não entra; se o banco falhar, o sistema não é
atualizado e continua como estava. No final, recarregue o navegador com
**Ctrl + Shift + R**.

### Configurar a atualização automática do banco (uma vez)

Na primeira vez em que rodar o `instalar.sh` depois desta mudança, ele pede:

1. **Connection string**: no Supabase, clique em **Connect** (no topo) →
   **Session pooler** → copie o texto que começa com `postgresql://`. Pode colar
   como está (com `[YOUR-PASSWORD]`): o script tira a senha do endereço.
2. **Senha do banco** (Database password, definida ao criar o projeto). Se não
   lembrar: Project Settings → Database → **Reset database password**.
   Ela não aparece ao digitar e fica só no `.env` da VPS.

Na primeira execução, o script reconhece o que já tinha sido rodado à mão no
SQL Editor e só registra, sem rodar de novo. Não é mais preciso colar SQL no
Supabase.

> Mudanças de estrutura do banco devem vir sempre por arquivo em
> `supabase/migrations/` (PR). Alterações feitas direto no painel do Supabase
> não voltam para o código.

### Deploy automático (opcional, recomendado)

Com ele, toda novidade mesclada na `main` vai para o ar sozinha, depois que
todos os testes passam (workflow **Deploy** no GitHub Actions). Configuração
única:

1. Na VPS:

```bash
cd /opt/connecta && git pull && bash deploy/configurar-deploy-automatico.sh
```

2. O script mostra 3 valores. No GitHub: repositório → **Settings** →
   **Secrets and variables** → **Actions** → **New repository secret**, e crie
   `VPS_HOST`, `VPS_KNOWN_HOSTS` e `VPS_SSH_KEY` com esses valores.
3. Teste em **Actions** → **Deploy** → **Run workflow**.

Segurança: a chave do GitHub fica travada no `authorized_keys`
(`restrict,command=...`): ela só consegue rodar `/usr/local/bin/connecta-deploy`
(baixar a `main` e rodar `instalar.sh`); não abre terminal, não faz túnel e
ignora qualquer outro comando. O GitHub confere a identidade da VPS
(`VPS_KNOWN_HOSTS`) antes de conectar. Para revogar: apague a linha
`connecta-github-deploy` de `/root/.ssh/authorized_keys`. Para trocar a chave:
rode o script de novo e atualize o secret `VPS_SSH_KEY`.

## 8. Atendimento por IA

A IA usa o ChatGPT (OpenAI) com a chave **da CONNECTA** (platform.openai.com → API keys), que paga o uso de
todos os clientes; o consumo de cada um aparece em **Atendimento IA → Uso neste mês**.
O instalador pergunta a chave se ela ainda não estiver no `.env` (dá para pular e adicionar depois
rodando `bash deploy/instalar.sh` de novo). Cada cliente configura a própria IA na tela
**Atendimento IA** (modo, nicho, serviços, perguntas frequentes, regras, horários).

## 9. Dia a dia

| Tarefa | Comando (dentro de `/opt/connecta`) |
|---|---|
| Atualizar para a versão mais nova | veja a seção 7 |
| Ver se está tudo rodando | `docker compose ps` |
| Ver erros do app | `docker compose logs --tail=100 app` |
| Ver erros do WhatsApp | `docker compose logs --tail=100 worker` |
| Reiniciar tudo | `docker compose restart` |

**Backups:** o banco fica no Supabase (plano grátis faz backup diário; no Pro dá para
restaurar a qualquer ponto). A VPS só guarda o `.env`: mantenha a cópia dele em local seguro.

## Problemas comuns

| Sintoma | O que fazer |
|---|---|
| Site não abre / erro de certificado | DNS ainda propagando; confira no dnschecker.org |
| "Não autenticado" em tudo | Conferir `NEXT_PUBLIC_SUPABASE_URL` e anon key no `.env`, depois `bash deploy/instalar.sh` |
| Login funciona mas "Sem acesso" | O usuário não foi vinculado a um cliente: use o passo 6 |
| QR não aparece | `docker compose logs --tail=100 worker` e me envie o resultado (sem o `.env`) |
