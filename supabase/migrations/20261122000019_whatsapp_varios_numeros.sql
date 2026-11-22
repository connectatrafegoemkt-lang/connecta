-- =====================================================================
-- Vários números de WhatsApp por cliente
--
-- * whatsapp_sessions passa a ter um id por número (antes: 1 por tenant).
--   A sessão que já existia vira a "principal" (is_primary). Cada número
--   tem nome (label), status, QR e login próprios.
-- * tenants.whatsapp_limit: quantos números o cliente pode conectar
--   (a CONNECTA ajusta no Painel).
-- * whatsapp_qr, whatsapp_outbox e interactions ganham session_id (qual
--   número). Fila sem número = número principal (compatível com o que já
--   existe). As FKs são compostas com tenant_id: é impossível apontar para
--   o número de outro cliente.
-- * Credenciais (whatsapp_auth_keys): o worker prefixa as chaves dos
--   números extras com "s:<session_id>:"; ao remover um número, as chaves
--   dele são apagadas.
-- =====================================================================

alter table public.tenants
  add column if not exists whatsapp_limit integer not null default 3 check (whatsapp_limit between 1 and 20);

-- ---------------------------------------------------------------- sessões
alter table public.whatsapp_sessions
  add column if not exists id uuid not null default gen_random_uuid(),
  add column if not exists label text not null default 'Principal' check (length(trim(label)) between 1 and 40),
  add column if not exists is_primary boolean not null default false;

update public.whatsapp_sessions set is_primary = true;

-- Troca de chave primária num único ALTER: a tabela está na publicação do
-- Realtime e não pode ficar nem um instante sem identidade de réplica.
alter table public.whatsapp_sessions
  drop constraint whatsapp_sessions_pkey,
  add primary key (id),
  add constraint whatsapp_sessions_tenant_id_id_key unique (tenant_id, id);
create unique index whatsapp_sessions_one_primary on public.whatsapp_sessions (tenant_id) where is_primary;
create index if not exists whatsapp_sessions_tenant_idx on public.whatsapp_sessions (tenant_id, created_at);

-- ---------------------------------------------------------------- QR
alter table public.whatsapp_qr add column if not exists session_id uuid;
update public.whatsapp_qr q set session_id = s.id
  from public.whatsapp_sessions s where s.tenant_id = q.tenant_id and s.is_primary;
delete from public.whatsapp_qr where session_id is null;
alter table public.whatsapp_qr
  alter column session_id set not null,
  drop constraint whatsapp_qr_pkey,
  add primary key (session_id);
alter table public.whatsapp_qr
  add constraint whatsapp_qr_session_fk foreign key (tenant_id, session_id)
  references public.whatsapp_sessions (tenant_id, id) on delete cascade;
create index if not exists whatsapp_qr_tenant_idx on public.whatsapp_qr (tenant_id);

-- ---------------------------------------------------------------- fila e mensagens
alter table public.whatsapp_outbox add column if not exists session_id uuid;
alter table public.whatsapp_outbox
  add constraint whatsapp_outbox_session_fk foreign key (tenant_id, session_id)
  references public.whatsapp_sessions (tenant_id, id) on delete set null (session_id);
grant insert (session_id) on public.whatsapp_outbox to authenticated;

alter table public.interactions add column if not exists session_id uuid;
alter table public.interactions
  add constraint interactions_session_fk foreign key (tenant_id, session_id)
  references public.whatsapp_sessions (tenant_id, id) on delete set null (session_id);
create index if not exists interactions_tenant_session_idx on public.interactions (tenant_id, session_id, occurred_at desc)
  where session_id is not null;

-- Remover um número apaga as credenciais dele (as do principal não têm prefixo
-- e o principal não pode ser removido).
create or replace function app.drop_session_auth()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  delete from public.whatsapp_auth_keys
   where tenant_id = old.tenant_id and key like 's:' || old.id::text || ':%';
  return old;
end $$;
create trigger y_drop_auth after delete on public.whatsapp_sessions
  for each row execute function app.drop_session_auth();

-- ---------------------------------------------------------------- RPCs
-- Sessão alvo: a informada (precisa ser do tenant da sessão) ou a principal.
create or replace function app.whatsapp_target_session(p_tenant uuid, p_session uuid)
returns uuid
language sql
stable
security definer
set search_path = ''
as $$
  select s.id from public.whatsapp_sessions s
   where s.tenant_id = p_tenant
     and ((p_session is not null and s.id = p_session) or (p_session is null and s.is_primary))
$$;
revoke all on function app.whatsapp_target_session(uuid, uuid) from public, anon, authenticated;

drop function if exists public.whatsapp_request(text);
create function public.whatsapp_request(p_action text, p_session uuid default null)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_tenant uuid := app.current_tenant_id();
  v_id     uuid;
begin
  if v_tenant is null or not app.has_perm('whatsapp.conectar') then
    raise exception 'sem permissão para conectar o WhatsApp' using errcode = '42501';
  end if;
  if p_action not in ('conectar', 'desconectar', 'reiniciar') then
    raise exception 'ação inválida' using errcode = '22023';
  end if;
  v_id := app.whatsapp_target_session(v_tenant, p_session);
  if v_id is null then
    if p_session is not null then
      raise exception 'número não encontrado' using errcode = 'P0002';
    end if;
    -- primeiro número do cliente: cria a sessão principal
    insert into public.whatsapp_sessions (tenant_id, is_primary, label) values (v_tenant, true, 'Principal')
    returning id into v_id;
  end if;
  update public.whatsapp_sessions s
     set desired_state = case when p_action = 'desconectar' then 'desconectado' else 'conectado' end,
         status = case
                    when p_action = 'desconectar' then 'desconectado'::public.whatsapp_status
                    when p_action = 'reiniciar' then 'conectando'::public.whatsapp_status
                    when s.status = 'conectado' then s.status
                    else 'conectando'::public.whatsapp_status end,
         reset_requested_at = case when p_action = 'reiniciar' then now() else s.reset_requested_at end,
         last_error = null
   where s.id = v_id;
  return v_id;
end $$;
revoke all on function public.whatsapp_request(text, uuid) from public, anon;
grant execute on function public.whatsapp_request(text, uuid) to authenticated;

-- Adicionar número (respeita o limite do cliente). Já pede a conexão (QR).
create or replace function public.whatsapp_add_number(p_label text)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_tenant uuid := app.current_tenant_id();
  v_limit  integer;
  v_count  integer;
  v_id     uuid;
begin
  if v_tenant is null or not app.has_perm('whatsapp.conectar') then
    raise exception 'sem permissão para conectar o WhatsApp' using errcode = '42501';
  end if;
  select whatsapp_limit into v_limit from public.tenants where id = v_tenant;
  select count(*) into v_count from public.whatsapp_sessions where tenant_id = v_tenant;
  if v_count >= v_limit then
    raise exception 'limite de % número(s) de WhatsApp atingido', v_limit using errcode = '23514';
  end if;
  insert into public.whatsapp_sessions (tenant_id, label, is_primary, desired_state, status)
  values (v_tenant, left(coalesce(nullif(trim(p_label), ''), 'Número ' || (v_count + 1)), 40), v_count = 0, 'conectado', 'conectando')
  returning id into v_id;
  return v_id;
end $$;
revoke all on function public.whatsapp_add_number(text) from public, anon;
grant execute on function public.whatsapp_add_number(text) to authenticated;

create or replace function public.whatsapp_rename_number(p_session uuid, p_label text)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_tenant uuid := app.current_tenant_id();
begin
  if v_tenant is null or not app.has_perm('whatsapp.conectar') then
    raise exception 'sem permissão para conectar o WhatsApp' using errcode = '42501';
  end if;
  update public.whatsapp_sessions set label = left(trim(p_label), 40)
   where tenant_id = v_tenant and id = p_session;
  if not found then
    raise exception 'número não encontrado' using errcode = 'P0002';
  end if;
end $$;
revoke all on function public.whatsapp_rename_number(uuid, text) from public, anon;
grant execute on function public.whatsapp_rename_number(uuid, text) to authenticated;

-- Remover número extra (o principal só pode ser desconectado).
create or replace function public.whatsapp_remove_number(p_session uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_tenant uuid := app.current_tenant_id();
begin
  if v_tenant is null or not app.has_perm('whatsapp.conectar') then
    raise exception 'sem permissão para conectar o WhatsApp' using errcode = '42501';
  end if;
  if exists (select 1 from public.whatsapp_sessions where tenant_id = v_tenant and id = p_session and is_primary) then
    raise exception 'o número principal não pode ser removido (só desconectado)' using errcode = '23514';
  end if;
  delete from public.whatsapp_sessions where tenant_id = v_tenant and id = p_session;
  if not found then
    raise exception 'número não encontrado' using errcode = 'P0002';
  end if;
end $$;
revoke all on function public.whatsapp_remove_number(uuid) from public, anon;
grant execute on function public.whatsapp_remove_number(uuid) to authenticated;

-- ---------------------------------------------------------------- Painel
create or replace function public.platform_set_whatsapp_limit(p_tenant uuid, p_limit integer)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  if not public.is_platform_admin() then
    raise exception 'apenas administradores da plataforma' using errcode = '42501';
  end if;
  if p_limit is null or p_limit < 1 or p_limit > 20 then
    raise exception 'limite inválido (1 a 20)' using errcode = '22023';
  end if;
  update public.tenants set whatsapp_limit = p_limit where id = p_tenant;
  if not found then
    raise exception 'cliente não encontrado' using errcode = 'P0002';
  end if;
end $$;
revoke all on function public.platform_set_whatsapp_limit(uuid, integer) from public, anon;
grant execute on function public.platform_set_whatsapp_limit(uuid, integer) to authenticated;

-- Visão geral: status "melhor" entre os números + quantidade e limite.
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
  suspended_reason  text,
  whatsapp_numbers  integer,
  whatsapp_connected integer,
  whatsapp_limit    integer
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
           (select s.status::text from public.whatsapp_sessions s where s.tenant_id = t.id
             order by (s.status = 'conectado') desc, s.is_primary desc limit 1),
           (select a.mode::text from public.ai_settings a where a.tenant_id = t.id),
           (select count(*)::int from public.ai_usage u
             where u.tenant_id = t.id and u.kind in ('resposta', 'sugestao')
               and u.created_at >= date_trunc('month', now())),
           (select coalesce(sum(u.input_tokens + u.output_tokens), 0)::bigint from public.ai_usage u
             where u.tenant_id = t.id and u.created_at >= date_trunc('month', now())),
           t.suspended_at,
           t.suspended_reason,
           (select count(*)::int from public.whatsapp_sessions s where s.tenant_id = t.id),
           (select count(*)::int from public.whatsapp_sessions s where s.tenant_id = t.id and s.status = 'conectado'),
           t.whatsapp_limit
      from public.tenants t
     order by t.created_at desc;
end $$;
revoke all on function public.platform_tenants_overview() from public, anon;
grant execute on function public.platform_tenants_overview() to authenticated;
