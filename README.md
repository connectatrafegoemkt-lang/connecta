# CONNECTA CRM

CRM multi-tenant (SaaS) da CONNECTA. Cada cliente (tenant) tem seu próprio
login e acesso **somente** aos próprios dados.

## Stack

- Next.js 16 (App Router) + TypeScript + Tailwind 4
- Supabase: Postgres com Row Level Security, Auth, Storage e Realtime
- Worker Node.js separado para o WhatsApp (Baileys, QR code)

## Funcionalidades

- Leads/contatos com busca, filtros e tags
- Funil kanban com arrastar e soltar e etapas editáveis
- Histórico de interações (nota, ligação, e-mail, reunião, WhatsApp) em tempo real
- Tarefas e lembretes
- Dashboard
- Equipe por tenant com **setores** (ex.: Comercial, Trabalhista) e **perfis**
  (Administrador, Gerente, Atendente, Só leitura) + ajuste fino de permissões
  por pessoa. Quem não tem "ver todos os setores" só enxerga os contatos e
  conversas dos seus setores (e os sem setor) — regra aplicada no banco (RLS)
- Log de auditoria
- WhatsApp por QR code: uma sessão por tenant, mensagens recebidas viram
  interações no contato certo, envio e recebimento em tempo real
- Atendimento por IA (ChatGPT/OpenAI) configurável por cliente: nicho, área de atuação,
  serviços/produtos, perguntas frequentes, tom, regras e horários; modos
  desligado, sugerir respostas ou responder sozinha com transferência para humano
- Tema claro ou escuro, à escolha de cada usuário

## Arquitetura

```
Navegador ──(cookie de sessão)──▶ Next.js ──(JWT do usuário, RLS)──▶ Supabase
   │                                 │  getTenantContext() → TenantDb
   └──── Realtime (RLS) ◀────────────┴────────────────────────────── Postgres
                                                                       ▲
Worker WhatsApp (service_role, 1 sessão Baileys por tenant) ───────────┘
   credenciais cifradas (AES-256-GCM, chave por tenant) em whatsapp_auth_keys
```

### Isolamento entre tenants (em camadas)

1. **Banco**: `tenant_id NOT NULL` + índice em toda tabela de negócio, RLS em
   todas as tabelas, trigger que força o `tenant_id` da sessão e FKs compostas
   `(tenant_id, id)` que impedem ligar registros de tenants diferentes.
2. **Servidor**: o tenant vem do JWT (`current_context()`), nunca do front. As
   APIs rejeitam `tenant_id` na query, header ou corpo.
3. **Camada única de acesso** (`src/server/data/tenant-db.ts`): toda query
   recebe o filtro de tenant automaticamente. O ESLint proíbe acessar o
   Supabase fora de `src/server`.
4. **Storage**: bucket privado `tenant-files` com caminho `<tenant_id>/...`.
5. **WhatsApp**: o worker usa um repositório preso ao tenant da sessão; o
   tenant nunca é deduzido do conteúdo da mensagem.
6. **Testes automatizados** (`tests/isolation/`) em todo PR: o tenant A tenta
   ler, criar, editar e excluir dados do tenant B pelo banco, pela API do
   Supabase, pela API do app, pela interface (Playwright) e pelo WhatsApp.

## Rodando localmente

Pré-requisitos: Node 22, Docker e [Supabase CLI](https://supabase.com/docs/guides/cli).

```bash
npm install
supabase start                 # sobe Postgres/Auth/Storage/Realtime e aplica as migrations
supabase status -o env         # copie API_URL, ANON_KEY e SERVICE_ROLE_KEY
cp .env.example .env.local     # preencha com os valores acima (NUNCA commite)
```

Clientes novos podem ser criados pelo **Painel da CONNECTA** (`/plataforma`),
disponível só para administradores da plataforma (tabela `app.platform_admins`,
incluídos via SQL Editor). Pelo terminal também funciona —
crie o primeiro cliente (tenant) e seu admin:

```bash
SUPABASE_URL=http://127.0.0.1:54321 SUPABASE_SERVICE_ROLE_KEY=... \
  npx tsx scripts/create-tenant.ts "Escritório Exemplo" escritorio-exemplo admin@exemplo.com "Senha-Forte-123" "Admin"
```

```bash
npm run dev       # app em http://localhost:3000
npm run worker    # worker do WhatsApp (precisa de WHATSAPP_CREDENTIALS_KEY)
```

### Testes

```bash
npm run lint && npm run typecheck
npm test                       # unitários (camada de dados, validação, worker)

# isolamento no banco (Postgres local, sem Docker):
DATABASE_URL=postgres://postgres:postgres@127.0.0.1:5432/connecta_test scripts/db-reset-local.sh
npm run test:isolation:db

# isolamento via APIs (com supabase start + app rodando):
SUPABASE_URL=... SUPABASE_ANON_KEY=... SUPABASE_SERVICE_ROLE_KEY=... APP_URL=http://127.0.0.1:3000 \
  npm run test:isolation:api
```

## WhatsApp

1. Em **WhatsApp** no painel, o admin clica em **Conectar WhatsApp**.
2. O worker abre uma sessão só para aquele tenant e publica o QR code (só
   admins do tenant o recebem, via Realtime com RLS).
3. No celular: *Dispositivos conectados → Conectar um dispositivo*.
4. Mensagens recebidas viram interações no contato com aquele telefone **dentro
   do tenant** (se não existir, o contato é criado). Mensagens enviadas pelo
   painel entram na fila do tenant e o worker envia.

## Colocar no ar

Guia completo para VPS Hostinger + Supabase: [docs/DEPLOY-HOSTINGER.md](./docs/DEPLOY-HOSTINGER.md).
Resumo: `git clone` na VPS e `bash deploy/instalar.sh` (sobe app + worker + HTTPS com Docker).

### Antivírus do servidor

Instale uma vez: `sudo bash /opt/connecta/deploy/instalar-antivirus.sh`.
Instala o ClamAV (base de vírus atualizada sozinha) e agenda uma varredura do
servidor toda madrugada (~03:30), com prioridade baixa. Ele só avisa: não apaga
nem move arquivos. Resultado: `connecta-antivirus`; varrer na hora:
`sudo connecta-antivirus --varrer`. Se achar algo, aparece um aviso ao entrar
por SSH.

> Aviso: a integração usa o protocolo do WhatsApp Web (biblioteca não
> oficial). Para alto volume, avalie a API oficial do WhatsApp Business.

Veja [CLAUDE.md](./CLAUDE.md) para as regras completas do projeto.
