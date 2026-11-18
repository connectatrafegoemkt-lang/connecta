-- =====================================================================
-- Atendimento por IA (WhatsApp) — configuração por tenant
--
-- ai_settings    : como a IA do tenant atende (nicho, serviços, regras...)
-- ai_suggestions : respostas sugeridas para o atendente aprovar
-- ai_usage       : consumo por tenant (a CONNECTA paga a API e controla)
-- contacts.ai_paused_until : pausa a IA naquela conversa (humano assumiu)
-- whatsapp_outbox.origin   : 'humano' ou 'ia' (só o worker grava 'ia')
-- =====================================================================

create table public.ai_settings (
  tenant_id           uuid primary key references public.tenants(id) on delete cascade,
  mode                text not null default 'desligado' check (mode in ('desligado', 'sugerir', 'automatico')),
  assistant_name      text not null default 'Assistente virtual' check (length(assistant_name) between 1 and 60),
  niche               text check (length(niche) <= 120),
  business_area       text check (length(business_area) <= 300),
  company_description text check (length(company_description) <= 4000),
  services            jsonb not null default '[]'::jsonb check (jsonb_typeof(services) = 'array' and jsonb_array_length(services) <= 60),
  faq                 jsonb not null default '[]'::jsonb check (jsonb_typeof(faq) = 'array' and jsonb_array_length(faq) <= 60),
  tone                text not null default 'amigavel' check (tone in ('formal', 'amigavel', 'descontraido')),
  rules               text check (length(rules) <= 4000),
  greeting            text check (length(greeting) <= 500),
  handoff_message     text not null default 'Vou chamar uma pessoa da nossa equipe para continuar o seu atendimento. Só um instante!'
                        check (length(handoff_message) <= 500),
  business_hours      jsonb not null default '{"enabled": false, "start": "08:00", "end": "18:00", "days": [1,2,3,4,5]}'::jsonb,
  only_outside_hours  boolean not null default false,
  human_pause_hours   integer not null default 12 check (human_pause_hours between 1 and 720),
  created_at          timestamptz not null default now(),
  updated_at          timestamptz not null default now()
);

create table public.ai_suggestions (
  id          uuid primary key default gen_random_uuid(),
  tenant_id   uuid not null references public.tenants(id) on delete cascade,
  contact_id  uuid not null,
  body        text not null check (length(body) between 1 and 4096),
  status      text not null default 'pendente' check (status in ('pendente', 'usada', 'descartada')),
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now(),
  unique (tenant_id, id),
  foreign key (tenant_id, contact_id) references public.contacts (tenant_id, id) on delete cascade
);
create index ai_suggestions_tenant_contact_idx on public.ai_suggestions (tenant_id, contact_id, created_at desc);

create table public.ai_usage (
  id                 bigint generated always as identity primary key,
  tenant_id          uuid not null references public.tenants(id) on delete cascade,
  contact_id         uuid,
  kind               text not null check (kind in ('resposta', 'sugestao', 'teste')),
  model              text not null,
  input_tokens       integer not null default 0,
  output_tokens      integer not null default 0,
  cache_read_tokens  integer not null default 0,
  created_at         timestamptz not null default now()
);
create index ai_usage_tenant_created_idx on public.ai_usage (tenant_id, created_at desc);

alter table public.contacts add column ai_paused_until timestamptz;

alter table public.whatsapp_outbox
  add column origin text not null default 'humano' check (origin in ('humano', 'ia'));

-- ---------------------------------------------------------------------
-- Triggers, RLS e grants
-- ---------------------------------------------------------------------
do $$
declare t text;
begin
  foreach t in array array['ai_settings', 'ai_suggestions', 'ai_usage'] loop
    execute format('create trigger a_enforce_tenant before insert or update on public.%I
                      for each row execute function app.enforce_tenant_id()', t);
    execute format('alter table public.%I enable row level security', t);
    execute format('revoke all on public.%I from anon', t);
  end loop;
  foreach t in array array['ai_settings', 'ai_suggestions'] loop
    execute format('create trigger b_touch before update on public.%I
                      for each row execute function app.touch_updated_at()', t);
  end loop;
end $$;

create trigger z_audit after insert or update or delete on public.ai_settings
  for each row execute function app.audit_trigger();

-- ai_settings: membros leem; só admin cria/altera.
create policy ai_settings_select on public.ai_settings for select to authenticated
  using (tenant_id = (select app.current_tenant_id()));
create policy ai_settings_insert on public.ai_settings for insert to authenticated
  with check (tenant_id = (select app.current_tenant_id()) and (select app.is_admin()));
create policy ai_settings_update on public.ai_settings for update to authenticated
  using (tenant_id = (select app.current_tenant_id()) and (select app.is_admin()))
  with check (tenant_id = (select app.current_tenant_id()));
revoke delete, truncate on public.ai_settings from authenticated;

-- ai_suggestions: membros leem e marcam como usada/descartada; só o worker cria.
create policy ai_suggestions_select on public.ai_suggestions for select to authenticated
  using (tenant_id = (select app.current_tenant_id()));
create policy ai_suggestions_update on public.ai_suggestions for update to authenticated
  using (tenant_id = (select app.current_tenant_id()))
  with check (tenant_id = (select app.current_tenant_id()));
revoke insert, update, delete, truncate on public.ai_suggestions from authenticated;
grant update (status) on public.ai_suggestions to authenticated;

-- ai_usage: só admin do tenant lê; ninguém grava pela API.
create policy ai_usage_select on public.ai_usage for select to authenticated
  using (tenant_id = (select app.current_tenant_id()) and (select app.is_admin()));
revoke insert, update, delete, truncate on public.ai_usage from authenticated;

-- whatsapp_outbox: usuário continua inserindo só (tenant_id, contact_id, body);
-- origin fica 'humano' por padrão e só o worker grava 'ia'.

-- Consumo do mês corrente (para o painel do admin)
create or replace function public.ai_usage_summary()
returns jsonb
language sql
stable
security invoker
set search_path = ''
as $$
  select jsonb_build_object(
    'mensagens', count(*) filter (where kind in ('resposta', 'sugestao')),
    'testes', count(*) filter (where kind = 'teste'),
    'input_tokens', coalesce(sum(input_tokens), 0),
    'output_tokens', coalesce(sum(output_tokens), 0)
  )
  from public.ai_usage
  where created_at >= date_trunc('month', now())
$$;
revoke all on function public.ai_usage_summary() from public, anon;
grant execute on function public.ai_usage_summary() to authenticated;

do $$
begin
  if exists (select 1 from pg_publication where pubname = 'supabase_realtime') then
    alter publication supabase_realtime add table public.ai_suggestions;
  end if;
end $$;
