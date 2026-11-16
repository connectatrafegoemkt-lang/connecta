-- =====================================================================
-- CONNECTA CRM — Tabelas de negócio
-- Todas com tenant_id NOT NULL + índice, RLS, trigger de tenant e
-- auditoria. Relacionamentos usam FK COMPOSTA (tenant_id, id) para que
-- seja impossível ligar registros de tenants diferentes, mesmo com
-- service_role.
-- =====================================================================

create type public.interaction_type as enum ('nota', 'ligacao', 'email', 'reuniao', 'whatsapp');
create type public.interaction_direction as enum ('entrada', 'saida', 'interna');
create type public.task_status as enum ('pendente', 'concluida', 'cancelada');

-- ---------------------------------------------------------------------
-- Etapas do funil (editáveis)
-- ---------------------------------------------------------------------
create table public.pipeline_stages (
  id          uuid primary key default gen_random_uuid(),
  tenant_id   uuid not null references public.tenants(id) on delete cascade,
  name        text not null check (length(trim(name)) between 1 and 80),
  position    integer not null default 0,
  color       text not null default '#64748b' check (color ~ '^#[0-9a-fA-F]{6}$'),
  is_won      boolean not null default false,
  is_lost     boolean not null default false,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now(),
  unique (tenant_id, id)
);
create index pipeline_stages_tenant_pos_idx on public.pipeline_stages (tenant_id, position);

-- ---------------------------------------------------------------------
-- Contatos / leads
-- ---------------------------------------------------------------------
create table public.contacts (
  id            uuid primary key default gen_random_uuid(),
  tenant_id     uuid not null references public.tenants(id) on delete cascade,
  name          text not null check (length(trim(name)) between 1 and 200),
  email         text check (email is null or length(email) <= 320),
  phone         text check (phone is null or phone ~ '^[0-9]{8,15}$'), -- só dígitos, com DDI
  company       text,
  source        text,
  notes         text,
  value_cents   bigint not null default 0 check (value_cents >= 0),
  stage_id      uuid,
  stage_position integer not null default 0,
  owner_id      uuid references auth.users(id) on delete set null,
  created_by    uuid references auth.users(id) on delete set null default auth.uid(),
  last_interaction_at timestamptz,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now(),
  unique (tenant_id, id),
  foreign key (tenant_id, stage_id) references public.pipeline_stages (tenant_id, id)
);
create index contacts_tenant_created_idx on public.contacts (tenant_id, created_at desc);
create index contacts_tenant_stage_idx on public.contacts (tenant_id, stage_id, stage_position);
create unique index contacts_tenant_phone_uidx on public.contacts (tenant_id, phone) where phone is not null;
create index contacts_tenant_name_idx on public.contacts (tenant_id, lower(name));

-- owner_id precisa ser membro do mesmo tenant
create or replace function app.check_contact_owner()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if new.owner_id is not null and not exists (
    select 1 from public.memberships
    where tenant_id = new.tenant_id and user_id = new.owner_id
  ) then
    raise exception 'responsável não pertence ao tenant' using errcode = '23503';
  end if;
  return new;
end;
$$;

-- ---------------------------------------------------------------------
-- Tags
-- ---------------------------------------------------------------------
create table public.tags (
  id          uuid primary key default gen_random_uuid(),
  tenant_id   uuid not null references public.tenants(id) on delete cascade,
  name        text not null check (length(trim(name)) between 1 and 50),
  color       text not null default '#0ea5e9' check (color ~ '^#[0-9a-fA-F]{6}$'),
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now(),
  unique (tenant_id, id),
  unique (tenant_id, name)
);
create index tags_tenant_idx on public.tags (tenant_id);

create table public.contact_tags (
  tenant_id   uuid not null references public.tenants(id) on delete cascade,
  contact_id  uuid not null,
  tag_id      uuid not null,
  created_at  timestamptz not null default now(),
  primary key (tenant_id, contact_id, tag_id),
  foreign key (tenant_id, contact_id) references public.contacts (tenant_id, id) on delete cascade,
  foreign key (tenant_id, tag_id) references public.tags (tenant_id, id) on delete cascade
);
create index contact_tags_tenant_tag_idx on public.contact_tags (tenant_id, tag_id);

-- ---------------------------------------------------------------------
-- Interações (histórico)
-- ---------------------------------------------------------------------
create table public.interactions (
  id           uuid primary key default gen_random_uuid(),
  tenant_id    uuid not null references public.tenants(id) on delete cascade,
  contact_id   uuid not null,
  type         public.interaction_type not null,
  direction    public.interaction_direction not null default 'interna',
  body         text not null default '' check (length(body) <= 20000),
  external_id  text,                      -- id da mensagem no WhatsApp
  status       text,                      -- enviado/entregue/lido/erro
  metadata     jsonb not null default '{}'::jsonb,
  occurred_at  timestamptz not null default now(),
  created_by   uuid references auth.users(id) on delete set null default auth.uid(),
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now(),
  unique (tenant_id, id),
  foreign key (tenant_id, contact_id) references public.contacts (tenant_id, id) on delete cascade
);
create index interactions_tenant_contact_idx on public.interactions (tenant_id, contact_id, occurred_at desc);
create index interactions_tenant_occurred_idx on public.interactions (tenant_id, occurred_at desc);
create unique index interactions_tenant_external_uidx on public.interactions (tenant_id, external_id) where external_id is not null;

create or replace function app.bump_last_interaction()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  update public.contacts
     set last_interaction_at = greatest(coalesce(last_interaction_at, new.occurred_at), new.occurred_at)
   where tenant_id = new.tenant_id and id = new.contact_id;
  return new;
end;
$$;

-- ---------------------------------------------------------------------
-- Tarefas e lembretes
-- ---------------------------------------------------------------------
create table public.tasks (
  id            uuid primary key default gen_random_uuid(),
  tenant_id     uuid not null references public.tenants(id) on delete cascade,
  contact_id    uuid,
  title         text not null check (length(trim(title)) between 1 and 200),
  description   text,
  status        public.task_status not null default 'pendente',
  due_at        timestamptz,
  remind_at     timestamptz,
  assigned_to   uuid references auth.users(id) on delete set null,
  completed_at  timestamptz,
  created_by    uuid references auth.users(id) on delete set null default auth.uid(),
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now(),
  unique (tenant_id, id),
  foreign key (tenant_id, contact_id) references public.contacts (tenant_id, id) on delete cascade
);
create index tasks_tenant_status_due_idx on public.tasks (tenant_id, status, due_at);
create index tasks_tenant_remind_idx on public.tasks (tenant_id, remind_at) where status = 'pendente';
create index tasks_tenant_contact_idx on public.tasks (tenant_id, contact_id);

create or replace function app.check_task_assignee()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if new.assigned_to is not null and not exists (
    select 1 from public.memberships
    where tenant_id = new.tenant_id and user_id = new.assigned_to
  ) then
    raise exception 'responsável não pertence ao tenant' using errcode = '23503';
  end if;
  if new.status = 'concluida' and new.completed_at is null then
    new.completed_at := now();
  elsif new.status <> 'concluida' then
    new.completed_at := null;
  end if;
  return new;
end;
$$;

-- ---------------------------------------------------------------------
-- Triggers (ordem alfabética do nome: a_ roda antes de b_)
-- ---------------------------------------------------------------------
do $$
declare
  t text;
begin
  foreach t in array array['pipeline_stages', 'contacts', 'tags', 'contact_tags', 'interactions', 'tasks'] loop
    execute format('create trigger a_enforce_tenant before insert or update on public.%I
                      for each row execute function app.enforce_tenant_id()', t);
    execute format('create trigger z_audit after insert or update or delete on public.%I
                      for each row execute function app.audit_trigger()', t);
    if t <> 'contact_tags' then
      execute format('create trigger b_touch before update on public.%I
                        for each row execute function app.touch_updated_at()', t);
    end if;
  end loop;
end;
$$;

create trigger c_check_owner before insert or update of owner_id on public.contacts
  for each row execute function app.check_contact_owner();
create trigger c_check_assignee before insert or update on public.tasks
  for each row execute function app.check_task_assignee();
create trigger c_bump_last_interaction after insert on public.interactions
  for each row execute function app.bump_last_interaction();

-- ---------------------------------------------------------------------
-- RLS — mesma regra base em todas as tabelas: tenant_id do usuário.
-- Etapas do funil e tags: qualquer membro lê; só admin altera etapas.
-- ---------------------------------------------------------------------
do $$
declare
  t text;
begin
  foreach t in array array['pipeline_stages', 'contacts', 'tags', 'contact_tags', 'interactions', 'tasks'] loop
    execute format('alter table public.%I enable row level security', t);
    execute format('revoke all on public.%I from anon', t);
    execute format($p$create policy %1$s_select on public.%1$I for select to authenticated
                     using (tenant_id = (select app.current_tenant_id()))$p$, t);
  end loop;

  foreach t in array array['contacts', 'tags', 'contact_tags', 'interactions', 'tasks'] loop
    execute format($p$create policy %1$s_insert on public.%1$I for insert to authenticated
                     with check (tenant_id = (select app.current_tenant_id()))$p$, t);
    execute format($p$create policy %1$s_update on public.%1$I for update to authenticated
                     using (tenant_id = (select app.current_tenant_id()))
                     with check (tenant_id = (select app.current_tenant_id()))$p$, t);
    execute format($p$create policy %1$s_delete on public.%1$I for delete to authenticated
                     using (tenant_id = (select app.current_tenant_id()))$p$, t);
  end loop;
end;
$$;

create policy pipeline_stages_insert on public.pipeline_stages for insert to authenticated
  with check (tenant_id = (select app.current_tenant_id()) and (select app.is_admin()));
create policy pipeline_stages_update on public.pipeline_stages for update to authenticated
  using (tenant_id = (select app.current_tenant_id()) and (select app.is_admin()))
  with check (tenant_id = (select app.current_tenant_id()));
create policy pipeline_stages_delete on public.pipeline_stages for delete to authenticated
  using (tenant_id = (select app.current_tenant_id()) and (select app.is_admin()));

-- ---------------------------------------------------------------------
-- Onboarding: cria tenant + admin + etapas padrão (somente service_role)
-- ---------------------------------------------------------------------
create or replace function public.create_tenant_with_admin(
  p_name text, p_slug text, p_admin_user_id uuid, p_admin_name text default null
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_tenant uuid;
begin
  insert into public.tenants (name, slug) values (p_name, p_slug) returning id into v_tenant;
  insert into public.memberships (tenant_id, user_id, role, display_name)
    values (v_tenant, p_admin_user_id, 'admin', p_admin_name);
  insert into public.pipeline_stages (tenant_id, name, position, color, is_won, is_lost) values
    (v_tenant, 'Novo lead',   0, '#0ea5e9', false, false),
    (v_tenant, 'Qualificado', 1, '#6366f1', false, false),
    (v_tenant, 'Proposta',    2, '#f59e0b', false, false),
    (v_tenant, 'Ganho',       3, '#22c55e', true,  false),
    (v_tenant, 'Perdido',     4, '#ef4444', false, true);
  return v_tenant;
end;
$$;
revoke all on function public.create_tenant_with_admin(text, text, uuid, text) from public, anon, authenticated;
grant execute on function public.create_tenant_with_admin(text, text, uuid, text) to service_role;

-- ---------------------------------------------------------------------
-- Dashboard: agregados do tenant da sessão (RLS aplicada: SECURITY INVOKER)
-- ---------------------------------------------------------------------
create or replace function public.dashboard_summary()
returns jsonb
language sql
stable
security invoker
set search_path = ''
as $$
  select jsonb_build_object(
    'contacts_total', (select count(*) from public.contacts),
    'contacts_last_30d', (select count(*) from public.contacts where created_at > now() - interval '30 days'),
    'pipeline_value_cents', (select coalesce(sum(c.value_cents), 0) from public.contacts c
                              join public.pipeline_stages s on s.tenant_id = c.tenant_id and s.id = c.stage_id
                              where not s.is_lost and not s.is_won),
    'won_value_cents', (select coalesce(sum(c.value_cents), 0) from public.contacts c
                          join public.pipeline_stages s on s.tenant_id = c.tenant_id and s.id = c.stage_id
                          where s.is_won),
    'tasks_open', (select count(*) from public.tasks where status = 'pendente'),
    'tasks_overdue', (select count(*) from public.tasks where status = 'pendente' and due_at < now()),
    'interactions_last_7d', (select count(*) from public.interactions where occurred_at > now() - interval '7 days'),
    'by_stage', coalesce((
      select jsonb_agg(jsonb_build_object('id', s.id, 'name', s.name, 'color', s.color,
                                          'count', (select count(*) from public.contacts c where c.stage_id = s.id and c.tenant_id = s.tenant_id))
                       order by s.position)
      from public.pipeline_stages s), '[]'::jsonb)
  )
$$;
revoke all on function public.dashboard_summary() from public, anon;
grant execute on function public.dashboard_summary() to authenticated;
