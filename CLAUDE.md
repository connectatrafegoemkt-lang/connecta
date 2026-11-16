# CLAUDE.md — Regras do projeto CONNECTA CRM

CRM multi-tenant (SaaS) da CONNECTA. Cada cliente é um **tenant** e NUNCA pode
ver, listar ou alterar dados de outro tenant.

Stack: Next.js (App Router) + TypeScript, Supabase (Postgres + RLS + Storage +
Realtime), Tailwind CSS.

## Regras de Git (obrigatórias)

1. Toda alteração é commitada e enviada (push) para o GitHub. Nada fica só local.
2. Cada etapa em branch própria (`feat/...`, `fix/...`, `chore/...`, `test/...`,
   `docs/...`), terminando com push + Pull Request para a `main`.
3. Commits pequenos, Conventional Commits em português
   (`feat:`, `fix:`, `test:`, `docs:`, `chore:`, `refactor:`, `ci:`).
4. Ao fim de cada etapa: `git status` limpo, `git log --oneline -5` e link do PR.
5. Se um push falhar, corrigir e tentar de novo antes de seguir.
6. **Nunca commitar segredos.** `.env*` está no `.gitignore`; só `.env.example`
   com valores fictícios. Segredo commitado por engano → avisar imediatamente.
7. Nunca fazer merge de PR sem aprovação do dono do repositório.

## Regras de isolamento multi-tenant (prioridade máxima)

1. Toda tabela de negócio tem `tenant_id uuid NOT NULL` + índice (de preferência
   composto começando por `tenant_id`).
2. RLS **ativado e forçado** em TODAS as tabelas do schema `public`, com policies
   que filtram por `tenant_id` do usuário autenticado (`app.current_tenant_id()`).
3. O `tenant_id` vem SEMPRE da sessão/JWT no servidor. Nunca aceitar
   `tenant_id` vindo do front (body, query string, header). Validadores Zod das
   APIs usam `.strict()` e não possuem o campo `tenant_id`.
4. Nenhuma query sem filtro de tenant: todo acesso a dados passa pela camada
   única `src/server/data/` (`getTenantContext()` → repositórios), que injeta o
   tenant. É proibido usar `createClient` do Supabase fora de `src/server/`.
5. O cliente `service_role` (bypassa RLS) só pode ser usado em
   `src/server/admin/` e no worker do WhatsApp, sempre com `tenant_id` explícito
   obtido de fonte confiável (sessão WhatsApp do próprio tenant), nunca do front.
6. Storage: bucket privado `tenant-files`, caminho `<tenant_id>/...`, policies
   comparando o primeiro segmento do caminho com o tenant do usuário.
7. Roles por tenant: `admin` e `atendente` (tabela `memberships`).
8. Auditoria: tabela `audit_logs` com `tenant_id` e `user_id`, preenchida por
   triggers (não depende do app lembrar de registrar).
9. Testes de isolamento (`tests/isolation/`) rodam em todo PR. Qualquer nova
   tabela DEVE ser adicionada aos testes de isolamento e ao teste que verifica
   que toda tabela tem RLS + `tenant_id`.

## Checklist ao criar uma tabela nova

- [ ] `tenant_id uuid not null references tenants(id) on delete cascade`
- [ ] índice começando por `tenant_id`
- [ ] `alter table ... enable row level security; ... force row level security;`
- [ ] policies select/insert/update/delete usando `app.current_tenant_id()`
- [ ] trigger `app.set_tenant_id()` (preenche/valida tenant pelo JWT)
- [ ] trigger de auditoria `app.audit_trigger()`
- [ ] adicionada em `tests/isolation/`

## Comandos

- `npm run dev` — Next.js local
- `npm run lint` / `npm run typecheck`
- `npm test` — testes unitários
- `npm run test:isolation` — testes de isolamento (exige banco: veja README)
