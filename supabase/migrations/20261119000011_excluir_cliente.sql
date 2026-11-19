-- =====================================================================
-- Excluir cliente (definitivo) pelo Painel da CONNECTA.
--
-- Travas (no banco):
--   * só administradores da plataforma;
--   * nunca a empresa da própria conta;
--   * o cliente precisa estar SUSPENSO antes (evita excluir um cliente ativo);
--   * confirmação: o identificador (slug) do cliente digitado exatamente.
--
-- Apaga o tenant; todas as tabelas de negócio caem junto (FKs com
-- on delete cascade). Devolve os user_id da equipe do cliente para o
-- servidor apagar esses logins no Auth e os arquivos do Storage.
-- =====================================================================

create or replace function public.platform_delete_tenant(p_tenant uuid, p_confirm_slug text)
returns uuid[]
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_slug      text;
  v_suspended timestamptz;
  v_users     uuid[];
begin
  if not public.is_platform_admin() then
    raise exception 'apenas administradores da plataforma' using errcode = '42501';
  end if;
  select slug, suspended_at into v_slug, v_suspended from public.tenants where id = p_tenant for update;
  if v_slug is null then
    raise exception 'cliente não encontrado' using errcode = 'P0002';
  end if;
  if exists (select 1 from public.memberships m where m.user_id = auth.uid() and m.tenant_id = p_tenant) then
    raise exception 'você não pode excluir a empresa da sua própria conta' using errcode = '42501';
  end if;
  if v_suspended is null then
    raise exception 'suspenda o cliente antes de excluir' using errcode = '55000';
  end if;
  if p_confirm_slug is distinct from v_slug then
    raise exception 'confirmação não confere: digite o identificador do cliente' using errcode = '22023';
  end if;

  select coalesce(array_agg(m.user_id), '{}') into v_users from public.memberships m where m.tenant_id = p_tenant;

  -- As tabelas do cliente caem em cascata. A auditoria e a trava de
  -- "último admin" já ignoram linhas de um tenant que não existe mais.
  delete from public.tenants where id = p_tenant;
  return v_users;
end $$;
revoke all on function public.platform_delete_tenant(uuid, text) from public, anon;
grant execute on function public.platform_delete_tenant(uuid, text) to authenticated;

-- Travas da equipe (migration 7) liberam a exclusão em cascata do cliente.
create or replace function app.guard_membership_change()
returns trigger language plpgsql security definer set search_path = '' as $$
declare
  v_admin boolean;
  v_mine text[];
begin
  if auth.uid() is null then  -- service_role (onboarding / worker)
    return case when tg_op = 'DELETE' then old else new end;
  end if;
  -- Exclusão do cliente inteiro (cascata a partir de tenants): libera.
  if tg_op = 'DELETE' and not exists (select 1 from public.tenants where id = old.tenant_id) then
    return old;
  end if;
  v_admin := app.is_admin();
  if v_admin then
    return case when tg_op = 'DELETE' then old else new end;
  end if;
  select permissions into v_mine from public.memberships where user_id = auth.uid();
  if tg_op in ('UPDATE', 'DELETE') and (old.user_id = auth.uid() or old.profile = 'admin') then
    raise exception 'sem permissão para alterar este usuário' using errcode = '42501';
  end if;
  if tg_op in ('INSERT', 'UPDATE') then
    if new.profile = 'admin' then
      raise exception 'apenas administradores criam administradores' using errcode = '42501';
    end if;
    if not (new.permissions <@ coalesce(v_mine, '{}'::text[])) then
      raise exception 'não é possível conceder permissões que você não tem' using errcode = '42501';
    end if;
  end if;
  return case when tg_op = 'DELETE' then old else new end;
end $$;
create or replace function app.guard_member_departments()
returns trigger language plpgsql security definer set search_path = '' as $$
declare
  v_row public.member_departments;
begin
  if auth.uid() is null or app.is_admin() then
    return case when tg_op = 'DELETE' then old else new end;
  end if;
  -- Exclusão do cliente inteiro (cascata a partir de tenants): libera.
  if tg_op = 'DELETE' and not exists (select 1 from public.tenants where id = old.tenant_id) then
    return old;
  end if;
  v_row := case when tg_op = 'DELETE' then old else new end;
  if v_row.user_id = auth.uid() or exists (
       select 1 from public.memberships m
       where m.tenant_id = v_row.tenant_id and m.user_id = v_row.user_id and m.profile = 'admin') then
    raise exception 'sem permissão para alterar os setores deste usuário' using errcode = '42501';
  end if;
  return v_row;
end $$;
