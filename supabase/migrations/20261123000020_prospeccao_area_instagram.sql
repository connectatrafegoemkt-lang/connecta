-- =====================================================================
-- Prospecção: área de atuação e Instagram da lead
--
-- area      : área em que a lead trabalha (ex.: Trabalhista, Previdenciário)
--             — o "nicho" continua sendo o segmento (ex.: Advocacia).
-- instagram : @ do perfil (só o usuário, sem "@" nem link; o app normaliza).
-- As funções de salvar/importar/sincronizar passam a gravar os dois campos.
-- =====================================================================

alter table app.prospects
  add column if not exists area text check (length(area) <= 120),
  add column if not exists instagram text check (instagram is null or instagram ~ '^[A-Za-z0-9._]{1,30}$');

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
    insert into app.prospects (name, company, phone, email, city, niche, area, instagram, source, status, value_cents, notes, next_followup_at, created_by)
    values (app.prospect_text(p_data, 'name'), app.prospect_text(p_data, 'company'), app.prospect_text(p_data, 'phone'),
            app.prospect_text(p_data, 'email'), app.prospect_text(p_data, 'city'), app.prospect_text(p_data, 'niche'),
            app.prospect_text(p_data, 'area'), app.prospect_text(p_data, 'instagram'),
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
           area = app.prospect_text(p_data, 'area'), instagram = app.prospect_text(p_data, 'instagram'),
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
  insert into app.prospects (name, phone, company, city, niche, area, instagram, source, created_by)
    select app.prospect_text(r, 'name'), app.prospect_text(r, 'phone'), app.prospect_text(r, 'company'),
           app.prospect_text(r, 'city'), app.prospect_text(r, 'niche'), app.prospect_text(r, 'area'),
           app.prospect_text(r, 'instagram'), app.prospect_text(r, 'source'), auth.uid()
      from jsonb_array_elements(p_rows) r;
  get diagnostics v_n = row_count;
  return v_n;
end $$;

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
    insert into app.prospects (name, phone, email, company, city, niche, area, instagram, source, notes, created_by)
    values (left(app.prospect_text(r, 'name'), 200), app.prospect_text(r, 'phone'), app.prospect_text(r, 'email'),
            left(app.prospect_text(r, 'company'), 200), left(app.prospect_text(r, 'city'), 120),
            left(app.prospect_text(r, 'niche'), 120), left(app.prospect_text(r, 'area'), 120),
            app.prospect_text(r, 'instagram'),
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
