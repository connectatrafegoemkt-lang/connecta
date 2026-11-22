-- =====================================================================
-- Prospecção (leads ativas) da CONNECTA
--
-- Leads que a PRÓPRIA CONNECTA prospecta (ex.: escritórios para virar
-- cliente). Não pertencem a nenhum cliente do CRM, por isso ficam no
-- schema `app` (fora da API do PostgREST) e só são acessadas por funções
-- SECURITY DEFINER que exigem public.is_platform_admin(). Nenhum cliente
-- (nem admin de cliente) vê ou altera essas linhas.
-- =====================================================================

create table app.prospects (
  id               uuid primary key default gen_random_uuid(),
  name             text not null check (length(trim(name)) between 1 and 200),
  company          text check (length(company) <= 200),
  phone            text check (phone is null or phone ~ '^[0-9]{8,15}$'),
  email            text check (email is null or length(email) <= 320),
  city             text check (length(city) <= 120),
  niche            text check (length(niche) <= 120),
  source           text check (length(source) <= 120),
  status           text not null default 'novo'
                     check (status in ('novo', 'contatado', 'em_conversa', 'reuniao', 'proposta', 'ganho', 'perdido')),
  value_cents      bigint not null default 0 check (value_cents between 0 and 1e13),
  notes            text check (length(notes) <= 10000),
  next_followup_at timestamptz,
  last_contact_at  timestamptz,
  created_by       uuid references auth.users(id) on delete set null,
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now()
);
create index prospects_followup_idx on app.prospects (next_followup_at) where status not in ('ganho', 'perdido');
create index prospects_status_idx on app.prospects (status, created_at desc);

create table app.prospect_activities (
  id           uuid primary key default gen_random_uuid(),
  prospect_id  uuid not null references app.prospects(id) on delete cascade,
  type         text not null check (type in ('ligacao', 'whatsapp', 'email', 'reuniao', 'nota', 'status')),
  body         text not null default '' check (length(body) <= 5000),
  created_by   uuid references auth.users(id) on delete set null,
  created_at   timestamptz not null default now()
);
create index prospect_activities_prospect_idx on app.prospect_activities (prospect_id, created_at desc);

-- Ninguém acessa as tabelas direto (nem usuários dos clientes).
alter table app.prospects enable row level security;
alter table app.prospect_activities enable row level security;
revoke all on app.prospects, app.prospect_activities from public, anon, authenticated;

create trigger prospects_touch before update on app.prospects
  for each row execute function app.touch_updated_at();

create or replace function app.require_platform_admin()
returns void
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  if not public.is_platform_admin() then
    raise exception 'apenas administradores da plataforma' using errcode = '42501';
  end if;
end $$;
revoke all on function app.require_platform_admin() from public, anon;
grant execute on function app.require_platform_admin() to authenticated;

-- Normaliza os campos vindos do app (o app já valida; aqui é a última trava).
create or replace function app.prospect_text(p jsonb, k text)
returns text language sql immutable set search_path = '' as $$
  select nullif(trim(p ->> k), '')
$$;

-- Lista (com contagem de interações), mais recentes primeiro.
create or replace function public.platform_prospects_list()
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  perform app.require_platform_admin();
  return coalesce((
    select jsonb_agg(to_jsonb(p) || jsonb_build_object(
             'activities', (select count(*) from app.prospect_activities a where a.prospect_id = p.id and a.type <> 'status'))
           order by p.created_at desc)
      from app.prospects p
  ), '[]'::jsonb);
end $$;

create or replace function public.platform_prospect_get(p_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v jsonb;
begin
  perform app.require_platform_admin();
  select to_jsonb(p) || jsonb_build_object('activities', coalesce((
           select jsonb_agg(to_jsonb(a) order by a.created_at desc)
             from app.prospect_activities a where a.prospect_id = p.id), '[]'::jsonb))
    into v
    from app.prospects p where p.id = p_id;
  if v is null then
    raise exception 'lead não encontrada' using errcode = 'P0002';
  end if;
  return v;
end $$;

-- Cria (p_id nulo) ou edita uma lead.
create or replace function public.platform_prospect_save(p_id uuid, p_data jsonb)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_id uuid;
  v_old text;
begin
  perform app.require_platform_admin();
  if p_data is null or jsonb_typeof(p_data) <> 'object' then
    raise exception 'dados inválidos' using errcode = '22023';
  end if;
  if p_id is null then
    insert into app.prospects (name, company, phone, email, city, niche, source, status, value_cents, notes, next_followup_at, created_by)
    values (app.prospect_text(p_data, 'name'), app.prospect_text(p_data, 'company'), app.prospect_text(p_data, 'phone'),
            app.prospect_text(p_data, 'email'), app.prospect_text(p_data, 'city'), app.prospect_text(p_data, 'niche'),
            app.prospect_text(p_data, 'source'), coalesce(app.prospect_text(p_data, 'status'), 'novo'),
            coalesce((p_data ->> 'value_cents')::bigint, 0), app.prospect_text(p_data, 'notes'),
            (p_data ->> 'next_followup_at')::timestamptz, auth.uid())
    returning id into v_id;
  else
    select status into v_old from app.prospects where id = p_id for update;
    if not found then
      raise exception 'lead não encontrada' using errcode = 'P0002';
    end if;
    update app.prospects
       set name = app.prospect_text(p_data, 'name'), company = app.prospect_text(p_data, 'company'),
           phone = app.prospect_text(p_data, 'phone'), email = app.prospect_text(p_data, 'email'),
           city = app.prospect_text(p_data, 'city'), niche = app.prospect_text(p_data, 'niche'),
           source = app.prospect_text(p_data, 'source'), status = coalesce(app.prospect_text(p_data, 'status'), status),
           value_cents = coalesce((p_data ->> 'value_cents')::bigint, value_cents), notes = app.prospect_text(p_data, 'notes'),
           next_followup_at = (p_data ->> 'next_followup_at')::timestamptz
     where id = p_id
    returning id into v_id;
    if v_old is distinct from (select status from app.prospects where id = p_id) then
      insert into app.prospect_activities (prospect_id, type, body, created_by)
        values (p_id, 'status', v_old || '→' || (select status from app.prospects where id = p_id), auth.uid());
    end if;
  end if;
  return v_id;
end $$;

-- Registra um contato/follow-up: histórico + próxima data + etapa.
create or replace function public.platform_prospect_log(
  p_id uuid, p_type text, p_body text, p_next_followup timestamptz, p_status text default null
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_old text;
begin
  perform app.require_platform_admin();
  select status into v_old from app.prospects where id = p_id for update;
  if not found then
    raise exception 'lead não encontrada' using errcode = 'P0002';
  end if;
  if p_type not in ('ligacao', 'whatsapp', 'email', 'reuniao', 'nota') then
    raise exception 'tipo inválido' using errcode = '22023';
  end if;
  insert into app.prospect_activities (prospect_id, type, body, created_by)
    values (p_id, p_type, coalesce(trim(p_body), ''), auth.uid());
  update app.prospects
     set last_contact_at = case when p_type = 'nota' then last_contact_at else now() end,
         next_followup_at = p_next_followup,
         status = coalesce(nullif(p_status, ''), case when status = 'novo' and p_type <> 'nota' then 'contatado' else status end)
   where id = p_id;
  if v_old is distinct from (select status from app.prospects where id = p_id) then
    insert into app.prospect_activities (prospect_id, type, body, created_by)
      values (p_id, 'status', v_old || '→' || (select status from app.prospects where id = p_id), auth.uid());
  end if;
end $$;

create or replace function public.platform_prospect_delete(p_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  perform app.require_platform_admin();
  delete from app.prospects where id = p_id;
  if not found then
    raise exception 'lead não encontrada' using errcode = 'P0002';
  end if;
end $$;

-- Importação em lote (lista colada do Excel/planilha), até 500 linhas.
create or replace function public.platform_prospects_import(p_rows jsonb)
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_n integer;
begin
  perform app.require_platform_admin();
  if jsonb_typeof(p_rows) <> 'array' or jsonb_array_length(p_rows) > 500 then
    raise exception 'lista inválida (máximo 500 linhas)' using errcode = '22023';
  end if;
  insert into app.prospects (name, phone, company, city, niche, source, created_by)
    select app.prospect_text(r, 'name'), app.prospect_text(r, 'phone'), app.prospect_text(r, 'company'),
           app.prospect_text(r, 'city'), app.prospect_text(r, 'niche'), app.prospect_text(r, 'source'), auth.uid()
      from jsonb_array_elements(p_rows) r;
  get diagnostics v_n = row_count;
  return v_n;
end $$;

do $$
declare f text;
begin
  foreach f in array array[
    'public.platform_prospects_list()', 'public.platform_prospect_get(uuid)', 'public.platform_prospect_save(uuid, jsonb)',
    'public.platform_prospect_log(uuid, text, text, timestamptz, text)', 'public.platform_prospect_delete(uuid)',
    'public.platform_prospects_import(jsonb)'] loop
    execute format('revoke all on function %s from public, anon', f);
    execute format('grant execute on function %s to authenticated', f);
  end loop;
end $$;
