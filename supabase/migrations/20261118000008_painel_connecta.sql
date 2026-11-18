-- =====================================================================
-- Painel da CONNECTA (administração da plataforma)
--
-- app.platform_admins : quem é administrador da plataforma (equipe CONNECTA).
--   Fica no schema `app` (não exposto pela API) e ninguém além do dono do
--   banco lê ou escreve. Para incluir alguém, rode no SQL Editor:
--     insert into app.platform_admins (user_id)
--       select id from auth.users where email = 'pessoa@connecta...';
--
-- O painel só enxerga METADADOS de cada cliente (nome, contagens, status do
-- WhatsApp, consumo de IA). Contatos, conversas e demais dados de negócio
-- continuam protegidos pelo RLS por tenant — o painel não os lê.
-- =====================================================================

create table app.platform_admins (
  user_id     uuid primary key references auth.users(id) on delete cascade,
  created_at  timestamptz not null default now()
);
revoke all on app.platform_admins from public, anon, authenticated, service_role;

create or replace function public.is_platform_admin()
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (select 1 from app.platform_admins where user_id = auth.uid())
$$;
revoke all on function public.is_platform_admin() from public, anon;
grant execute on function public.is_platform_admin() to authenticated;

-- Visão geral dos clientes, só para administradores da plataforma.
create or replace function public.platform_tenants_overview()
returns table (
  id               uuid,
  name             text,
  slug             text,
  created_at       timestamptz,
  members          integer,
  contacts         integer,
  whatsapp_status  text,
  ai_mode          text,
  ai_messages_month integer,
  ai_tokens_month  bigint
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
             where u.tenant_id = t.id and u.created_at >= date_trunc('month', now()))
      from public.tenants t
     order by t.created_at desc;
end $$;
revoke all on function public.platform_tenants_overview() from public, anon;
grant execute on function public.platform_tenants_overview() to authenticated;
