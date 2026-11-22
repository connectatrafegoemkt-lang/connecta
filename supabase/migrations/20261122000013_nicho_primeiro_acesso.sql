-- =====================================================================
-- Assistente de primeiro acesso ("nichar" o CRM)
--
-- * tenants.niche / tenants.onboarded_at: nicho escolhido e quando o
--   assistente foi concluído. Usuários NÃO editam essas colunas direto
--   (grant de update em tenants continua só em "name"); quem marca é
--   app.mark_tenant_onboarded(), que só age no tenant da sessão.
-- * contact_fields: campos extras da ficha do lead, por tenant (ex.:
--   advocacia → "Nº do processo"; arquitetura → "Metragem").
-- * contacts.custom_fields: valores desses campos (objeto JSON).
-- * public.apply_niche_setup(): aplica o modelo do nicho numa única
--   transação. É SECURITY INVOKER: cada insert passa pelo RLS e pelas
--   permissões do próprio usuário (configurações, equipe, IA).
-- =====================================================================

alter table public.tenants
  add column if not exists niche text check (niche in ('advocacia', 'arquitetura', 'saude', 'imobiliaria', 'outro')),
  add column if not exists onboarded_at timestamptz;

-- Clientes que já existiam já estão configurados: não mostrar o assistente
-- de novo (dá para refazer em Configurações).
update public.tenants set onboarded_at = coalesce(onboarded_at, now());

-- ---------------------------------------------------------------------
-- Campos extras da ficha do lead
-- ---------------------------------------------------------------------
create table public.contact_fields (
  id          uuid primary key default gen_random_uuid(),
  tenant_id   uuid not null references public.tenants(id) on delete cascade,
  key         text not null check (key ~ '^[a-z][a-z0-9_]{0,39}$'),
  label       text not null check (length(trim(label)) between 1 and 60),
  type        text not null default 'texto' check (type in ('texto', 'numero', 'data', 'opcoes', 'sim_nao')),
  options     jsonb not null default '[]'::jsonb
                check (jsonb_typeof(options) = 'array' and jsonb_array_length(options) <= 30),
  position    integer not null default 0,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now(),
  unique (tenant_id, id),
  unique (tenant_id, key)
);
create index contact_fields_tenant_pos_idx on public.contact_fields (tenant_id, position);

create trigger a_enforce_tenant before insert or update on public.contact_fields
  for each row execute function app.enforce_tenant_id();
create trigger b_touch before update on public.contact_fields
  for each row execute function app.touch_updated_at();
create trigger z_audit after insert or update or delete on public.contact_fields
  for each row execute function app.audit_trigger();

alter table public.contact_fields enable row level security;
revoke all on public.contact_fields from anon;
create policy contact_fields_select on public.contact_fields for select to authenticated
  using (tenant_id = (select app.current_tenant_id()));
create policy contact_fields_insert on public.contact_fields for insert to authenticated
  with check (tenant_id = (select app.current_tenant_id()) and (select app.has_perm('configuracoes.gerenciar')));
create policy contact_fields_update on public.contact_fields for update to authenticated
  using (tenant_id = (select app.current_tenant_id()) and (select app.has_perm('configuracoes.gerenciar')))
  with check (tenant_id = (select app.current_tenant_id()));
create policy contact_fields_delete on public.contact_fields for delete to authenticated
  using (tenant_id = (select app.current_tenant_id()) and (select app.has_perm('configuracoes.gerenciar')));

alter table public.contacts
  add column if not exists custom_fields jsonb not null default '{}'::jsonb
    check (jsonb_typeof(custom_fields) = 'object' and pg_column_size(custom_fields) <= 16384);

-- ---------------------------------------------------------------------
-- Marca o tenant DA SESSÃO como configurado (único jeito de mexer em
-- niche/onboarded_at sem service_role).
-- ---------------------------------------------------------------------
create or replace function app.mark_tenant_onboarded(p_niche text)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_tenant uuid := app.current_tenant_id();
begin
  if v_tenant is null then
    raise exception 'sem acesso' using errcode = '42501';
  end if;
  if not app.has_perm('configuracoes.gerenciar') then
    raise exception 'sem permissão para configurar a empresa' using errcode = '42501';
  end if;
  update public.tenants
     set niche = coalesce(p_niche, niche),
         onboarded_at = now()
   where id = v_tenant;
end $$;
revoke all on function app.mark_tenant_onboarded(text) from public, anon;
grant execute on function app.mark_tenant_onboarded(text) to authenticated;

-- ---------------------------------------------------------------------
-- Aplica o modelo do nicho. p_setup (montado no servidor a partir das
-- respostas) pode ter: stages, tags, quick_replies, departments,
-- contact_fields (arrays) e ai (objeto). Tudo é aditivo:
--   * etapas com leads NUNCA são apagadas; etapas vazias que não estão
--     no modelo saem; as do modelo são criadas/reordenadas;
--   * etiquetas, mensagens rápidas, setores e campos existentes (mesmo
--     nome/atalho/chave) são mantidos;
--   * IA: preenche perfil/regras do nicho, sem ligar a IA (mode intacto);
--     serviços e perguntas frequentes só entram se ainda estiverem vazios.
-- ---------------------------------------------------------------------
create or replace function public.apply_niche_setup(p_niche text, p_setup jsonb)
returns jsonb
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_tenant uuid := app.current_tenant_id();
  v_count  integer := 0;
  v_n      integer;
  v_total  integer;
  r        record;
  v_ai     jsonb;
  v_result jsonb := '{}'::jsonb;
begin
  if v_tenant is null then
    raise exception 'sem acesso' using errcode = '42501';
  end if;
  if p_niche is not null and p_niche not in ('advocacia', 'arquitetura', 'saude', 'imobiliaria', 'outro') then
    raise exception 'nicho inválido' using errcode = '22023';
  end if;
  if p_setup is null or jsonb_typeof(p_setup) <> 'object' then
    raise exception 'configuração inválida' using errcode = '22023';
  end if;
  if jsonb_array_length(coalesce(p_setup -> 'stages', '[]')) > 20
     or jsonb_array_length(coalesce(p_setup -> 'tags', '[]')) > 60
     or jsonb_array_length(coalesce(p_setup -> 'quick_replies', '[]')) > 40
     or jsonb_array_length(coalesce(p_setup -> 'departments', '[]')) > 30
     or jsonb_array_length(coalesce(p_setup -> 'contact_fields', '[]')) > 30 then
    raise exception 'configuração grande demais' using errcode = '22023';
  end if;

  -- Etapas do funil -----------------------------------------------------
  if jsonb_array_length(coalesce(p_setup -> 'stages', '[]')) > 0 then
    v_total := jsonb_array_length(p_setup -> 'stages');
    delete from public.pipeline_stages s
     where s.tenant_id = v_tenant
       and not exists (select 1 from public.contacts c where c.tenant_id = s.tenant_id and c.stage_id = s.id)
       and lower(trim(s.name)) not in (
         select lower(trim(x ->> 'name')) from jsonb_array_elements(p_setup -> 'stages') x);
    -- as que sobraram fora do modelo (têm leads) vão para o fim, na ordem atual
    v_n := v_total;
    for r in
      select s.id from public.pipeline_stages s
       where s.tenant_id = v_tenant
         and lower(trim(s.name)) not in (
           select lower(trim(x ->> 'name')) from jsonb_array_elements(p_setup -> 'stages') x)
       order by s.position
    loop
      update public.pipeline_stages set position = v_n where id = r.id;
      v_n := v_n + 1;
    end loop;
    v_count := 0;
    for r in
      select x ->> 'name' as name, coalesce(x ->> 'color', '#64748b') as color,
             coalesce((x ->> 'is_won')::boolean, false) as is_won,
             coalesce((x ->> 'is_lost')::boolean, false) as is_lost,
             (o - 1)::int as pos
        from jsonb_array_elements(p_setup -> 'stages') with ordinality as t(x, o)
    loop
      update public.pipeline_stages
         set position = r.pos, color = r.color, is_won = r.is_won, is_lost = r.is_lost
       where tenant_id = v_tenant and lower(trim(name)) = lower(trim(r.name));
      if not found then
        insert into public.pipeline_stages (tenant_id, name, position, color, is_won, is_lost)
          values (v_tenant, trim(r.name), r.pos, r.color, r.is_won, r.is_lost);
        v_count := v_count + 1;
      end if;
    end loop;
    v_result := v_result || jsonb_build_object('stages', v_count);
  end if;

  -- Etiquetas ------------------------------------------------------------
  insert into public.tags (tenant_id, name, color)
    select v_tenant, trim(x ->> 'name'), coalesce(x ->> 'color', '#0ea5e9')
      from jsonb_array_elements(coalesce(p_setup -> 'tags', '[]')) x
     where not exists (select 1 from public.tags t
                        where t.tenant_id = v_tenant and lower(t.name) = lower(trim(x ->> 'name')))
    on conflict (tenant_id, name) do nothing;
  get diagnostics v_n = row_count;
  v_result := v_result || jsonb_build_object('tags', v_n);

  -- Mensagens rápidas ----------------------------------------------------
  insert into public.quick_replies (tenant_id, shortcut, title, body)
    select v_tenant, x ->> 'shortcut', x ->> 'title', x ->> 'body'
      from jsonb_array_elements(coalesce(p_setup -> 'quick_replies', '[]')) x
    on conflict (tenant_id, shortcut) do nothing;
  get diagnostics v_n = row_count;
  v_result := v_result || jsonb_build_object('quick_replies', v_n);

  -- Setores --------------------------------------------------------------
  insert into public.departments (tenant_id, name, color)
    select v_tenant, trim(x ->> 'name'), coalesce(x ->> 'color', '#a100ff')
      from jsonb_array_elements(coalesce(p_setup -> 'departments', '[]')) x
     where not exists (select 1 from public.departments d
                        where d.tenant_id = v_tenant and lower(d.name) = lower(trim(x ->> 'name')))
    on conflict (tenant_id, name) do nothing;
  get diagnostics v_n = row_count;
  v_result := v_result || jsonb_build_object('departments', v_n);

  -- Campos da ficha do lead ----------------------------------------------
  select coalesce(max(position) + 1, 0) into v_n from public.contact_fields where tenant_id = v_tenant;
  insert into public.contact_fields (tenant_id, key, label, type, options, position)
    select v_tenant, x ->> 'key', x ->> 'label', coalesce(x ->> 'type', 'texto'),
           coalesce(x -> 'options', '[]'::jsonb), v_n + (o - 1)::int
      from jsonb_array_elements(coalesce(p_setup -> 'contact_fields', '[]')) with ordinality as t(x, o)
    on conflict (tenant_id, key) do nothing;
  get diagnostics v_n = row_count;
  v_result := v_result || jsonb_build_object('contact_fields', v_n);

  -- Instruções da IA (não liga a IA) -------------------------------------
  v_ai := p_setup -> 'ai';
  if v_ai is not null and jsonb_typeof(v_ai) = 'object' then
    insert into public.ai_settings (tenant_id) values (v_tenant) on conflict (tenant_id) do nothing;
    update public.ai_settings a
       set niche               = coalesce(nullif(v_ai ->> 'niche', ''), a.niche),
           business_area       = coalesce(nullif(v_ai ->> 'business_area', ''), a.business_area),
           company_description = coalesce(nullif(v_ai ->> 'company_description', ''), a.company_description),
           tone                = coalesce(nullif(v_ai ->> 'tone', ''), a.tone),
           rules               = coalesce(nullif(v_ai ->> 'rules', ''), a.rules),
           greeting            = coalesce(nullif(v_ai ->> 'greeting', ''), a.greeting),
           services = case when jsonb_array_length(a.services) = 0 and jsonb_typeof(v_ai -> 'services') = 'array'
                           then v_ai -> 'services' else a.services end,
           faq      = case when jsonb_array_length(a.faq) = 0 and jsonb_typeof(v_ai -> 'faq') = 'array'
                           then v_ai -> 'faq' else a.faq end
     where a.tenant_id = v_tenant;
    v_result := v_result || jsonb_build_object('ai', true);
  end if;

  perform app.mark_tenant_onboarded(p_niche);
  return v_result;
end $$;
revoke all on function public.apply_niche_setup(text, jsonb) from public, anon;
grant execute on function public.apply_niche_setup(text, jsonb) to authenticated;
