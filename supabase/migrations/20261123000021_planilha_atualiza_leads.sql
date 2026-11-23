-- =====================================================================
-- Google Sheets → Prospecção: linhas já importadas também são atualizadas
--
-- Antes, uma linha da planilha virava lead UMA vez e depois era ignorada;
-- preencher uma coluna depois (ex.: Instagram) não chegava ao CRM.
-- Agora cada linha guarda a lead que criou (prospect_sheet_seen.prospect_id)
-- e, a cada leitura, os campos VAZIOS da lead são preenchidos com o que está
-- na planilha (o que já foi digitado no CRM não é sobrescrito).
-- Lead excluída no CRM continua sem voltar (prospect_id fica nulo).
-- =====================================================================

alter table app.prospect_sheet_seen
  add column if not exists prospect_id uuid references app.prospects(id) on delete set null,
  add column if not exists linked boolean not null default false;

-- Liga as linhas já importadas às leads existentes (pelo telefone ou e-mail
-- da chave da linha). Linhas por nome são ligadas na próxima leitura.
update app.prospect_sheet_seen s
   set prospect_id = p.id, linked = true
  from app.prospects p
 where s.prospect_id is null
   and ((s.row_key like 'tel:%' and p.phone = substr(s.row_key, 5))
     or (s.row_key like 'email:%' and lower(p.email) = substr(s.row_key, 7)));

create or replace function public.platform_sheet_sync(p_id uuid, p_rows jsonb, p_error text default null)
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_src     app.prospect_sheet_sources;
  v_new     integer := 0;
  v_upd     integer := 0;
  v_n       integer;
  r         jsonb;
  v_key     text;
  v_seen    app.prospect_sheet_seen;
  v_pid     uuid;
  v_ins     text;
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
    v_ins := app.prospect_text(r, 'instagram');
    if v_ins is not null and v_ins !~ '^[A-Za-z0-9._]{1,30}$' then
      v_ins := null;
    end if;

    select * into v_seen from app.prospect_sheet_seen where source_id = p_id and row_key = v_key;
    if not found then
      -- linha nova: cria a lead
      insert into app.prospects (name, phone, email, company, city, niche, area, instagram, source, notes, created_by)
      values (left(app.prospect_text(r, 'name'), 200), app.prospect_text(r, 'phone'), app.prospect_text(r, 'email'),
              left(app.prospect_text(r, 'company'), 200), left(app.prospect_text(r, 'city'), 120),
              left(app.prospect_text(r, 'niche'), 120), left(app.prospect_text(r, 'area'), 120), v_ins,
              left(coalesce(app.prospect_text(r, 'source'), v_src.source_label, 'Google Sheets: ' || v_src.name), 120),
              left(app.prospect_text(r, 'notes'), 10000), auth.uid())
      returning id into v_pid;
      insert into app.prospect_sheet_seen (source_id, row_key, prospect_id, linked) values (p_id, v_key, v_pid, true);
      v_new := v_new + 1;
      continue;
    end if;

    v_pid := v_seen.prospect_id;
    -- linha antiga ainda não ligada (importada antes desta versão, por nome)
    if v_pid is null and not v_seen.linked then
      select p.id into v_pid from app.prospects p
       where lower(trim(p.name)) = lower(trim(r ->> 'name'))
         and coalesce(lower(trim(p.company)), '') = coalesce(lower(trim(r ->> 'company')), '')
       order by p.created_at limit 1;
      update app.prospect_sheet_seen set prospect_id = v_pid, linked = true
       where source_id = p_id and row_key = v_key;
    end if;
    continue when v_pid is null; -- lead excluída no CRM: não volta

    -- preenche só os campos vazios da lead
    update app.prospects p
       set instagram = coalesce(p.instagram, v_ins),
           area      = coalesce(p.area, left(app.prospect_text(r, 'area'), 120)),
           niche     = coalesce(p.niche, left(app.prospect_text(r, 'niche'), 120)),
           company   = coalesce(p.company, left(app.prospect_text(r, 'company'), 200)),
           city      = coalesce(p.city, left(app.prospect_text(r, 'city'), 120)),
           email     = coalesce(p.email, app.prospect_text(r, 'email')),
           phone     = coalesce(p.phone, app.prospect_text(r, 'phone')),
           notes     = coalesce(p.notes, left(app.prospect_text(r, 'notes'), 10000))
     where p.id = v_pid
       and ((p.instagram is null and v_ins is not null)
         or (p.area is null and app.prospect_text(r, 'area') is not null)
         or (p.niche is null and app.prospect_text(r, 'niche') is not null)
         or (p.company is null and app.prospect_text(r, 'company') is not null)
         or (p.city is null and app.prospect_text(r, 'city') is not null)
         or (p.email is null and app.prospect_text(r, 'email') is not null)
         or (p.phone is null and app.prospect_text(r, 'phone') is not null)
         or (p.notes is null and app.prospect_text(r, 'notes') is not null));
    get diagnostics v_n = row_count;
    v_upd := v_upd + v_n;
  end loop;
  update app.prospect_sheet_sources
     set last_sync_at = now(), last_ok = true,
         last_result = case
           when v_new = 0 and v_upd = 0 then 'Nenhuma novidade'
           else concat_ws(' · ',
                  case when v_new > 0 then v_new || ' lead(s) nova(s)' end,
                  case when v_upd > 0 then v_upd || ' lead(s) atualizada(s)' end)
         end
   where id = p_id;
  return v_new;
end $$;
