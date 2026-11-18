-- =====================================================================
-- Suspender / reativar cliente (ex.: atraso no pagamento)
--
-- Suspenso = tenants.suspended_at preenchido. O bloqueio é NO BANCO:
--   * app.current_tenant_id() passa a devolver NULL para usuários de um
--     cliente suspenso, então TODAS as policies (que exigem
--     tenant_id = app.current_tenant_id()) negam leitura e escrita,
--     inclusive Storage e RPCs.
--   * current_context() continua respondendo (com suspended = true) só para
--     o app mostrar a tela "acesso suspenso" em vez de "sem acesso".
--   * O worker do WhatsApp pausa a sessão do cliente (sem apagar o login do
--     WhatsApp: ao reativar, reconecta sem novo QR code) e a IA para.
-- Só administradores da plataforma (equipe CONNECTA) suspendem/reativam.
-- Nenhum dado do cliente é apagado.
-- =====================================================================

alter table public.tenants
  add column if not exists suspended_at timestamptz,
  add column if not exists suspended_reason text check (length(suspended_reason) <= 300);

create or replace function app.current_tenant_id()
returns uuid
language sql
stable
security definer
set search_path = ''
as $$
  select m.tenant_id
  from public.memberships m
  join public.tenants t on t.id = m.tenant_id
  where m.user_id = auth.uid()
    and t.suspended_at is null
$$;

drop function public.current_context();
create function public.current_context()
returns table (user_id uuid, tenant_id uuid, tenant_name text, role public.tenant_role, display_name text,
               profile text, permissions text[], department_ids uuid[], suspended boolean)
language sql
stable
security definer
set search_path = ''
as $$
  select m.user_id, m.tenant_id, t.name, m.role, m.display_name, m.profile,
         case when m.role = 'admin' then app.permission_catalog() else m.permissions end,
         coalesce((select array_agg(md.department_id) from public.member_departments md
                   where md.tenant_id = m.tenant_id and md.user_id = m.user_id), '{}'::uuid[]),
         t.suspended_at is not null
  from public.memberships m
  join public.tenants t on t.id = m.tenant_id
  where m.user_id = auth.uid()
$$;
revoke all on function public.current_context() from public, anon;
grant execute on function public.current_context() to authenticated;

-- Suspender / reativar: só equipe CONNECTA; não dá para suspender o próprio cliente.
create or replace function public.platform_set_tenant_suspended(
  p_tenant uuid, p_suspend boolean, p_reason text default null
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  if not public.is_platform_admin() then
    raise exception 'apenas administradores da plataforma' using errcode = '42501';
  end if;
  if p_suspend and exists (
       select 1 from public.memberships m where m.user_id = auth.uid() and m.tenant_id = p_tenant) then
    raise exception 'você não pode suspender a empresa da sua própria conta' using errcode = '42501';
  end if;
  update public.tenants
     set suspended_at = case when p_suspend then coalesce(suspended_at, now()) else null end,
         suspended_reason = case when p_suspend then nullif(trim(p_reason), '') else null end
   where id = p_tenant;
  if not found then
    raise exception 'cliente não encontrado' using errcode = 'P0002';
  end if;
end $$;
revoke all on function public.platform_set_tenant_suspended(uuid, boolean, text) from public, anon;
grant execute on function public.platform_set_tenant_suspended(uuid, boolean, text) to authenticated;

-- Visão geral do painel agora mostra a situação do cliente.
drop function public.platform_tenants_overview();
create function public.platform_tenants_overview()
returns table (
  id                uuid,
  name              text,
  slug              text,
  created_at        timestamptz,
  members           integer,
  contacts          integer,
  whatsapp_status   text,
  ai_mode           text,
  ai_messages_month integer,
  ai_tokens_month   bigint,
  suspended_at      timestamptz,
  suspended_reason  text
)
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  if not public.is_platform_admin() then
    raise exception 'apenas administradores da plataforma' using errcode = '42501';
  end if;
  return query
    select t.id, t.name::text, t.slug::text, t.created_at,
           (select count(*)::int from public.memberships m where m.tenant_id = t.id),
           (select count(*)::int from public.contacts c where c.tenant_id = t.id),
           (select s.status::text from public.whatsapp_sessions s where s.tenant_id = t.id),
           (select a.mode::text from public.ai_settings a where a.tenant_id = t.id),
           (select count(*)::int from public.ai_usage u
             where u.tenant_id = t.id and u.kind in ('resposta', 'sugestao')
               and u.created_at >= date_trunc('month', now())),
           (select coalesce(sum(u.input_tokens + u.output_tokens), 0)::bigint from public.ai_usage u
             where u.tenant_id = t.id and u.created_at >= date_trunc('month', now())),
           t.suspended_at,
           t.suspended_reason
      from public.tenants t
     order by t.created_at desc;
end $$;
revoke all on function public.platform_tenants_overview() from public, anon;
grant execute on function public.platform_tenants_overview() to authenticated;
