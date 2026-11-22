-- =====================================================================
-- Prospecção: importação automática de planilhas do Google Sheets
--
-- A CONNECTA cadastra o link de uma planilha; o app lê a planilha (CSV) e
-- manda as linhas para cá. Cada linha vira uma lead UMA vez: a chave da
-- linha (telefone, e-mail ou nome+empresa) fica registrada em
-- app.prospect_sheet_seen, então reimportar não duplica e uma lead excluída
-- no CRM não volta. Tudo só para administradores da plataforma.
-- =====================================================================

create table app.prospect_sheet_sources (
  id            uuid primary key default gen_random_uuid(),
  name          text not null check (length(trim(name)) between 1 and 120),
  sheet_id      text not null check (sheet_id ~ '^[A-Za-z0-9_-]{20,100}$'),
  gid           text not null default '0' check (gid ~ '^[0-9]{1,15}$'),
  source_label  text check (length(source_label) <= 120),
  last_sync_at  timestamptz,
  last_result   text check (length(last_result) <= 500),
  last_ok       boolean,
  created_by    uuid references auth.users(id) on delete set null,
  created_at    timestamptz not null default now(),
  unique (sheet_id, gid)
);

create table app.prospect_sheet_seen (
  source_id   uuid not null references app.prospect_sheet_sources(id) on delete cascade,
  row_key     text not null check (length(row_key) between 1 and 300),
  created_at  timestamptz not null default now(),
  primary key (source_id, row_key)
);

alter table app.prospect_sheet_sources enable row level security;
alter table app.prospect_sheet_seen enable row level security;
revoke all on app.prospect_sheet_sources, app.prospect_sheet_seen from public, anon, authenticated;

create or replace function public.platform_sheet_sources_list()
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  perform app.require_platform_admin();
  return coalesce((
    select jsonb_agg(to_jsonb(s) || jsonb_build_object(
             'imported', (select count(*) from app.prospect_sheet_seen x where x.source_id = s.id))
           order by s.created_at)
      from app.prospect_sheet_sources s), '[]'::jsonb);
end $$;

create or replace function public.platform_sheet_source_add(p_name text, p_sheet_id text, p_gid text, p_source_label text)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_id uuid;
begin
  perform app.require_platform_admin();
  insert into app.prospect_sheet_sources (name, sheet_id, gid, source_label, created_by)
  values (trim(p_name), p_sheet_id, coalesce(nullif(p_gid, ''), '0'), nullif(trim(p_source_label), ''), auth.uid())
  returning id into v_id;
  return v_id;
end $$;

create or replace function public.platform_sheet_source_delete(p_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  perform app.require_platform_admin();
  delete from app.prospect_sheet_sources where id = p_id;
  if not found then
    raise exception 'planilha não encontrada' using errcode = 'P0002';
  end if;
end $$;

-- Recebe as linhas já lidas e validadas pelo app ({key, name, phone, ...}).
-- Cria só as que ainda não foram vistas. Devolve quantas entraram.
create or replace function public.platform_sheet_sync(p_id uuid, p_rows jsonb, p_error text default null)
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_src  app.prospect_sheet_sources;
  v_n    integer := 0;
  r      jsonb;
  v_key  text;
begin
  perform app.require_platform_admin();
  select * into v_src from app.prospect_sheet_sources where id = p_id for update;
  if not found then
    raise exception 'planilha não encontrada' using errcode = 'P0002';
  end if;
  if p_error is not null then
    update app.prospect_sheet_sources
       set last_sync_at = now(), last_ok = false, last_result = left(p_error, 500)
     where id = p_id;
    return 0;
  end if;
  if jsonb_typeof(p_rows) <> 'array' or jsonb_array_length(p_rows) > 5000 then
    raise exception 'planilha grande demais (máximo 5000 linhas)' using errcode = '22023';
  end if;
  for r in select * from jsonb_array_elements(p_rows) loop
    v_key := left(nullif(trim(r ->> 'key'), ''), 300);
    continue when v_key is null or app.prospect_text(r, 'name') is null;
    insert into app.prospect_sheet_seen (source_id, row_key) values (p_id, v_key)
      on conflict do nothing;
    continue when not found;
    insert into app.prospects (name, phone, email, company, city, niche, source, notes, created_by)
    values (left(app.prospect_text(r, 'name'), 200), app.prospect_text(r, 'phone'), app.prospect_text(r, 'email'),
            left(app.prospect_text(r, 'company'), 200), left(app.prospect_text(r, 'city'), 120),
            left(app.prospect_text(r, 'niche'), 120),
            left(coalesce(app.prospect_text(r, 'source'), v_src.source_label, 'Google Sheets: ' || v_src.name), 120),
            left(app.prospect_text(r, 'notes'), 10000), auth.uid());
    v_n := v_n + 1;
  end loop;
  update app.prospect_sheet_sources
     set last_sync_at = now(), last_ok = true,
         last_result = case when v_n = 0 then 'Nenhuma lead nova' else v_n || ' lead(s) nova(s)' end
   where id = p_id;
  return v_n;
end $$;

do $$
declare f text;
begin
  foreach f in array array[
    'public.platform_sheet_sources_list()', 'public.platform_sheet_source_add(text, text, text, text)',
    'public.platform_sheet_source_delete(uuid)', 'public.platform_sheet_sync(uuid, jsonb, text)'] loop
    execute format('revoke all on function %s from public, anon', f);
    execute format('grant execute on function %s to authenticated', f);
  end loop;
end $$;
