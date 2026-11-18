-- =====================================================================
-- CONNECTA CRM — Núcleo multi-tenant
-- tenants, memberships (roles admin/atendente), funções de contexto,
-- triggers que forçam o tenant_id a partir do JWT e auditoria.
-- =====================================================================

create extension if not exists pgcrypto with schema extensions;

-- Schema interno para funções auxiliares (NÃO exposto pelo PostgREST).
create schema if not exists app;
revoke all on schema app from public;
grant usage on schema app to authenticated, service_role;

-- ---------------------------------------------------------------------
-- Tipos
-- ---------------------------------------------------------------------
create type public.tenant_role as enum ('admin', 'atendente');

-- ---------------------------------------------------------------------
-- tenants
-- ---------------------------------------------------------------------
create table public.tenants (
  id          uuid primary key default gen_random_uuid(),
  name        text not null check (length(trim(name)) between 1 and 200),
  slug        text not null unique check (slug ~ '^[a-z0-9][a-z0-9-]{1,62}$'),
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);

-- ---------------------------------------------------------------------
-- memberships: vínculo usuário -> tenant. Um usuário pertence a UM tenant
-- (cada cliente tem seu próprio login), o que elimina ambiguidade sobre
-- qual tenant está ativo na sessão.
-- ---------------------------------------------------------------------
create table public.memberships (
  id            uuid primary key default gen_random_uuid(),
  tenant_id     uuid not null references public.tenants(id) on delete cascade,
  user_id       uuid not null unique references auth.users(id) on delete cascade,
  role          public.tenant_role not null default 'atendente',
  display_name  text,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now(),
  unique (tenant_id, id),
  unique (tenant_id, user_id)
);
create index memberships_tenant_id_idx on public.memberships (tenant_id);

-- ---------------------------------------------------------------------
-- Funções de contexto. SECURITY DEFINER + search_path vazio.
-- O tenant é derivado EXCLUSIVAMENTE de auth.uid() (claim "sub" do JWT
-- validado pelo PostgREST). Nunca de parâmetro.
-- ---------------------------------------------------------------------
create or replace function app.current_tenant_id()
returns uuid
language sql
stable
security definer
set search_path = ''
as $$
  select m.tenant_id
  from public.memberships m
  where m.user_id = auth.uid()
$$;

create or replace function app.current_role()
returns public.tenant_role
language sql
stable
security definer
set search_path = ''
as $$
  select m.role
  from public.memberships m
  where m.user_id = auth.uid()
$$;

create or replace function app.is_admin()
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce(app.current_role() = 'admin', false)
$$;

revoke all on function app.current_tenant_id() from public;
revoke all on function app.current_role() from public;
revoke all on function app.is_admin() from public;
grant execute on function app.current_tenant_id() to authenticated, service_role;
grant execute on function app.current_role() to authenticated, service_role;
grant execute on function app.is_admin() to authenticated, service_role;

-- RPC pública usada pelo servidor Next.js para descobrir o contexto da
-- sessão (o JWT é validado pelo PostgREST antes de chegar aqui).
create or replace function public.current_context()
returns table (user_id uuid, tenant_id uuid, tenant_name text, role public.tenant_role, display_name text)
language sql
stable
security definer
set search_path = ''
as $$
  select m.user_id, m.tenant_id, t.name, m.role, m.display_name
  from public.memberships m
  join public.tenants t on t.id = m.tenant_id
  where m.user_id = auth.uid()
$$;
revoke all on function public.current_context() from public, anon;
grant execute on function public.current_context() to authenticated;

-- ---------------------------------------------------------------------
-- Trigger: força tenant_id a partir da sessão.
-- * Requisições de usuário (auth.uid() presente): tenant_id é SEMPRE o do
--   usuário; se vier outro valor, a operação é rejeitada.
-- * service_role (worker/servidor admin): tenant_id deve vir explícito.
-- * UPDATE: tenant_id é imutável.
-- ---------------------------------------------------------------------
create or replace function app.enforce_tenant_id()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_tenant uuid;
begin
  if tg_op = 'INSERT' then
    if auth.uid() is not null then
      v_tenant := app.current_tenant_id();
      if v_tenant is null then
        raise exception 'usuário sem tenant' using errcode = '42501';
      end if;
      if new.tenant_id is not null and new.tenant_id <> v_tenant then
        raise exception 'tenant_id não pode ser definido pelo cliente' using errcode = '42501';
      end if;
      new.tenant_id := v_tenant;
    end if;
    if new.tenant_id is null then
      raise exception 'tenant_id obrigatório' using errcode = '23502';
    end if;
  elsif tg_op = 'UPDATE' then
    if new.tenant_id is distinct from old.tenant_id then
      raise exception 'tenant_id é imutável' using errcode = '42501';
    end if;
  end if;
  return new;
end;
$$;

create or replace function app.touch_updated_at()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  new.updated_at := now();
  return new;
end;
$$;

-- ---------------------------------------------------------------------
-- Auditoria
-- ---------------------------------------------------------------------
create table public.audit_logs (
  id          bigint generated always as identity primary key,
  tenant_id   uuid not null references public.tenants(id) on delete cascade,
  user_id     uuid,              -- null = sistema/worker (service_role)
  action      text not null check (action in ('INSERT', 'UPDATE', 'DELETE')),
  table_name  text not null,
  record_id   text,
  old_data    jsonb,
  new_data    jsonb,
  created_at  timestamptz not null default now()
);
create index audit_logs_tenant_created_idx on public.audit_logs (tenant_id, created_at desc);

create or replace function app.audit_trigger()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_row jsonb;
  v_tenant uuid;
begin
  v_row := case when tg_op = 'DELETE' then to_jsonb(old) else to_jsonb(new) end;
  v_tenant := case
    when tg_table_name = 'tenants' then (v_row ->> 'id')::uuid
    else (v_row ->> 'tenant_id')::uuid
  end;

  -- Tenant sendo excluído: os logs dele também vão embora (cascade).
  if tg_op = 'DELETE' and not exists (select 1 from public.tenants where id = v_tenant) then
    return old;
  end if;

  insert into public.audit_logs (tenant_id, user_id, action, table_name, record_id, old_data, new_data)
  values (
    v_tenant,
    auth.uid(),
    tg_op,
    tg_table_name,
    v_row ->> 'id',
    case when tg_op in ('UPDATE', 'DELETE') then to_jsonb(old) end,
    case when tg_op in ('INSERT', 'UPDATE') then to_jsonb(new) end
  );
  return case when tg_op = 'DELETE' then old else new end;
end;
$$;

-- ---------------------------------------------------------------------
-- Triggers das tabelas do núcleo
-- ---------------------------------------------------------------------
create trigger memberships_enforce_tenant before insert or update on public.memberships
  for each row execute function app.enforce_tenant_id();
create trigger memberships_touch before update on public.memberships
  for each row execute function app.touch_updated_at();
create trigger memberships_audit after insert or update or delete on public.memberships
  for each row execute function app.audit_trigger();

create trigger tenants_touch before update on public.tenants
  for each row execute function app.touch_updated_at();
create trigger tenants_audit after insert or update on public.tenants
  for each row execute function app.audit_trigger();

-- Impede que um admin rebaixe a si mesmo e deixe o tenant sem admin.
create or replace function app.keep_one_admin()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if (tg_op = 'DELETE' and old.role = 'admin')
     or (tg_op = 'UPDATE' and old.role = 'admin' and new.role <> 'admin') then
    if not exists (
      select 1 from public.memberships
      where tenant_id = old.tenant_id and role = 'admin' and id <> old.id
    ) and exists (select 1 from public.tenants where id = old.tenant_id) then
      raise exception 'o tenant precisa de pelo menos um admin' using errcode = '23514';
    end if;
  end if;
  return case when tg_op = 'DELETE' then old else new end;
end;
$$;
create trigger memberships_keep_admin before update or delete on public.memberships
  for each row execute function app.keep_one_admin();

-- ---------------------------------------------------------------------
-- RLS
-- ---------------------------------------------------------------------
alter table public.tenants     enable row level security;
alter table public.memberships enable row level security;
alter table public.audit_logs  enable row level security;

-- tenants: membro vê o próprio; admin edita o próprio; criar/excluir
-- tenant só via service_role (onboarding feito pela CONNECTA).
create policy tenants_select on public.tenants for select to authenticated
  using (id = (select app.current_tenant_id()));
create policy tenants_update on public.tenants for update to authenticated
  using (id = (select app.current_tenant_id()) and (select app.is_admin()))
  with check (id = (select app.current_tenant_id()));

-- memberships: membros veem colegas do mesmo tenant; só admin gerencia.
create policy memberships_select on public.memberships for select to authenticated
  using (tenant_id = (select app.current_tenant_id()));
create policy memberships_insert on public.memberships for insert to authenticated
  with check (tenant_id = (select app.current_tenant_id()) and (select app.is_admin()));
create policy memberships_update on public.memberships for update to authenticated
  using (tenant_id = (select app.current_tenant_id()) and (select app.is_admin()))
  with check (tenant_id = (select app.current_tenant_id()));
create policy memberships_delete on public.memberships for delete to authenticated
  using (tenant_id = (select app.current_tenant_id()) and (select app.is_admin()));

-- audit_logs: somente leitura, somente admin do próprio tenant.
create policy audit_logs_select on public.audit_logs for select to authenticated
  using (tenant_id = (select app.current_tenant_id()) and (select app.is_admin()));

-- ---------------------------------------------------------------------
-- Grants: anon não acessa nada; audit_logs não pode ser escrito pela API.
-- ---------------------------------------------------------------------
revoke all on public.tenants, public.memberships, public.audit_logs from anon;
revoke insert, delete on public.tenants from authenticated;
revoke insert, update, delete, truncate on public.audit_logs from authenticated;
-- Colunas de tenants editáveis pelo admin: apenas o nome.
revoke update on public.tenants from authenticated;
grant update (name) on public.tenants to authenticated;

-- memberships: admin só altera papel e nome de exibição (nunca user_id/tenant_id).
revoke update on public.memberships from authenticated;
grant update (role, display_name) on public.memberships to authenticated;
revoke all on public.memberships from anon;
