-- =====================================================================
-- Setores e permissões por usuário (dentro de cada tenant)
--
-- Perfis: admin | gerente | atendente | leitura (+ ajuste fino por permissão)
-- Setores: contatos podem pertencer a um setor; quem não tem
--   'setores.todos' só vê contatos SEM setor ou dos setores aos quais
--   pertence — e, por consequência, só as conversas, tarefas, interações,
--   sugestões e mensagens desses contatos.
-- Tudo é aplicado no banco (RLS); a interface só esconde o que não pode.
-- =====================================================================

-- ---------------------------------------------------------------------
-- Catálogo de permissões e perfis
-- ---------------------------------------------------------------------
create or replace function app.permission_catalog()
returns text[] language sql immutable set search_path = '' as $$
  select array[
    'contatos.ver', 'contatos.editar', 'contatos.excluir',
    'tarefas.editar',
    'whatsapp.ver', 'whatsapp.enviar', 'whatsapp.conectar',
    'ia.configurar',
    'configuracoes.gerenciar',
    'equipe.gerenciar',
    'auditoria.ver',
    'setores.todos'
  ]::text[]
$$;

create or replace function app.profile_permissions(p_profile text)
returns text[] language sql immutable set search_path = '' as $$
  select case p_profile
    when 'admin' then app.permission_catalog()
    when 'gerente' then array['contatos.ver','contatos.editar','contatos.excluir','tarefas.editar',
                              'whatsapp.ver','whatsapp.enviar','configuracoes.gerenciar','auditoria.ver','setores.todos']::text[]
    when 'leitura' then array['contatos.ver','whatsapp.ver']::text[]
    else array['contatos.ver','contatos.editar','tarefas.editar','whatsapp.ver','whatsapp.enviar']::text[]
  end
$$;

alter table public.memberships
  add column profile text check (profile in ('admin', 'gerente', 'atendente', 'leitura')),
  add column permissions text[] not null default '{}'::text[];

update public.memberships
   set profile = case when role = 'admin' then 'admin' else 'atendente' end;
update public.memberships
   set permissions = app.profile_permissions(profile);
alter table public.memberships alter column profile set not null;
alter table public.memberships
  add constraint memberships_permissions_known check (permissions <@ app.permission_catalog());

-- Mantém role (admin/atendente) coerente com o perfil e preenche permissões padrão.
create or replace function app.normalize_membership()
returns trigger language plpgsql set search_path = '' as $$
begin
  if new.profile is null then
    new.profile := case when new.role = 'admin' then 'admin' else 'atendente' end;
  elsif tg_op = 'UPDATE' and new.role is distinct from old.role and new.profile = old.profile then
    new.profile := case when new.role = 'admin' then 'admin' else 'atendente' end;
  end if;
  new.role := case when new.profile = 'admin' then 'admin'::public.tenant_role else 'atendente'::public.tenant_role end;
  if new.profile = 'admin' then
    new.permissions := app.permission_catalog();
  elsif new.permissions is null or cardinality(new.permissions) = 0
        or (tg_op = 'UPDATE' and new.profile is distinct from old.profile and new.permissions = old.permissions) then
    new.permissions := app.profile_permissions(new.profile);
  end if;
  return new;
end $$;
create trigger b_normalize before insert or update on public.memberships
  for each row execute function app.normalize_membership();

-- ---------------------------------------------------------------------
-- Funções de autorização (SECURITY DEFINER, derivadas de auth.uid())
-- ---------------------------------------------------------------------
create or replace function app.has_perm(p text)
returns boolean language sql stable security definer set search_path = '' as $$
  select coalesce((
    select m.role = 'admin' or p = any (m.permissions)
    from public.memberships m
    where m.user_id = auth.uid()
  ), false)
$$;
revoke all on function app.has_perm(text) from public;
grant execute on function app.has_perm(text) to authenticated, service_role;

-- ---------------------------------------------------------------------
-- Setores
-- ---------------------------------------------------------------------
create table public.departments (
  id          uuid primary key default gen_random_uuid(),
  tenant_id   uuid not null references public.tenants(id) on delete cascade,
  name        text not null check (length(trim(name)) between 1 and 60),
  color       text not null default '#a100ff' check (color ~ '^#[0-9a-fA-F]{6}$'),
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now(),
  unique (tenant_id, id),
  unique (tenant_id, name)
);
create index departments_tenant_idx on public.departments (tenant_id);

create table public.member_departments (
  tenant_id      uuid not null references public.tenants(id) on delete cascade,
  user_id        uuid not null,
  department_id  uuid not null,
  created_at     timestamptz not null default now(),
  primary key (tenant_id, user_id, department_id),
  foreign key (tenant_id, user_id) references public.memberships (tenant_id, user_id) on delete cascade,
  foreign key (tenant_id, department_id) references public.departments (tenant_id, id) on delete cascade
);
create index member_departments_tenant_dept_idx on public.member_departments (tenant_id, department_id);

alter table public.contacts add column department_id uuid;
alter table public.contacts
  add constraint contacts_department_fk foreign key (tenant_id, department_id)
  references public.departments (tenant_id, id);
create index contacts_tenant_department_idx on public.contacts (tenant_id, department_id);

-- Ao excluir um setor, os contatos dele voltam para "sem setor".
create or replace function app.release_department_contacts()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  update public.contacts set department_id = null
   where tenant_id = old.tenant_id and department_id = old.id;
  return old;
end $$;
create trigger a_release_contacts before delete on public.departments
  for each row execute function app.release_department_contacts();

create or replace function app.can_see_department(p_department uuid)
returns boolean language sql stable security definer set search_path = '' as $$
  select p_department is null
      or app.has_perm('setores.todos')
      or exists (
        select 1 from public.member_departments md
        where md.user_id = auth.uid()
          and md.department_id = p_department
          and md.tenant_id = app.current_tenant_id()
      )
$$;
revoke all on function app.can_see_department(uuid) from public;
grant execute on function app.can_see_department(uuid) to authenticated, service_role;

-- O usuário pode ver este contato (mesmo tenant + setor permitido)?
create or replace function app.can_see_contact(p_tenant uuid, p_contact uuid)
returns boolean language sql stable security definer set search_path = '' as $$
  select exists (
    select 1 from public.contacts c
    where c.tenant_id = p_tenant
      and c.id = p_contact
      and c.tenant_id = app.current_tenant_id()
      and app.can_see_department(c.department_id)
  )
$$;
revoke all on function app.can_see_contact(uuid, uuid) from public;
grant execute on function app.can_see_contact(uuid, uuid) to authenticated, service_role;

do $$
declare t text;
begin
  foreach t in array array['departments', 'member_departments'] loop
    execute format('create trigger a_enforce_tenant before insert or update on public.%I
                      for each row execute function app.enforce_tenant_id()', t);
    execute format('create trigger z_audit after insert or update or delete on public.%I
                      for each row execute function app.audit_trigger()', t);
    execute format('alter table public.%I enable row level security', t);
    execute format('revoke all on public.%I from anon', t);
    execute format($p$create policy %1$s_select on public.%1$I for select to authenticated
                     using (tenant_id = (select app.current_tenant_id()))$p$, t);
    execute format($p$create policy %1$s_insert on public.%1$I for insert to authenticated
                     with check (tenant_id = (select app.current_tenant_id()) and (select app.has_perm('equipe.gerenciar')))$p$, t);
    execute format($p$create policy %1$s_update on public.%1$I for update to authenticated
                     using (tenant_id = (select app.current_tenant_id()) and (select app.has_perm('equipe.gerenciar')))
                     with check (tenant_id = (select app.current_tenant_id()))$p$, t);
    execute format($p$create policy %1$s_delete on public.%1$I for delete to authenticated
                     using (tenant_id = (select app.current_tenant_id()) and (select app.has_perm('equipe.gerenciar')))$p$, t);
  end loop;
end $$;
create trigger b_touch before update on public.departments
  for each row execute function app.touch_updated_at();

-- ---------------------------------------------------------------------
-- Equipe: só quem tem 'equipe.gerenciar' altera; e sem escalada de privilégio.
-- ---------------------------------------------------------------------
create or replace function app.guard_membership_change()
returns trigger language plpgsql security definer set search_path = '' as $$
declare
  v_admin boolean;
  v_mine text[];
begin
  if auth.uid() is null then  -- service_role (onboarding / worker)
    return case when tg_op = 'DELETE' then old else new end;
  end if;
  v_admin := app.is_admin();
  if v_admin then
    return case when tg_op = 'DELETE' then old else new end;
  end if;
  select permissions into v_mine from public.memberships where user_id = auth.uid();
  if tg_op in ('UPDATE', 'DELETE') and (old.user_id = auth.uid() or old.profile = 'admin') then
    raise exception 'sem permissão para alterar este usuário' using errcode = '42501';
  end if;
  if tg_op in ('INSERT', 'UPDATE') then
    if new.profile = 'admin' then
      raise exception 'apenas administradores criam administradores' using errcode = '42501';
    end if;
    if not (new.permissions <@ coalesce(v_mine, '{}'::text[])) then
      raise exception 'não é possível conceder permissões que você não tem' using errcode = '42501';
    end if;
  end if;
  return case when tg_op = 'DELETE' then old else new end;
end $$;
create trigger c_guard before insert or update or delete on public.memberships
  for each row execute function app.guard_membership_change();

-- Setor de um membro: gerente não altera os próprios setores nem os de um admin.
create or replace function app.guard_member_departments()
returns trigger language plpgsql security definer set search_path = '' as $$
declare
  v_row public.member_departments;
begin
  if auth.uid() is null or app.is_admin() then
    return case when tg_op = 'DELETE' then old else new end;
  end if;
  v_row := case when tg_op = 'DELETE' then old else new end;
  if v_row.user_id = auth.uid() or exists (
       select 1 from public.memberships m
       where m.tenant_id = v_row.tenant_id and m.user_id = v_row.user_id and m.profile = 'admin') then
    raise exception 'sem permissão para alterar os setores deste usuário' using errcode = '42501';
  end if;
  return v_row;
end $$;
create trigger c_guard before insert or update or delete on public.member_departments
  for each row execute function app.guard_member_departments();

drop policy memberships_insert on public.memberships;
drop policy memberships_update on public.memberships;
drop policy memberships_delete on public.memberships;
create policy memberships_insert on public.memberships for insert to authenticated
  with check (tenant_id = (select app.current_tenant_id()) and (select app.has_perm('equipe.gerenciar')));
create policy memberships_update on public.memberships for update to authenticated
  using (tenant_id = (select app.current_tenant_id()) and (select app.has_perm('equipe.gerenciar')))
  with check (tenant_id = (select app.current_tenant_id()));
create policy memberships_delete on public.memberships for delete to authenticated
  using (tenant_id = (select app.current_tenant_id()) and (select app.has_perm('equipe.gerenciar')));
grant update (profile, permissions) on public.memberships to authenticated;
grant insert (tenant_id, user_id, role, profile, permissions, display_name) on public.memberships to authenticated;

-- ---------------------------------------------------------------------
-- Políticas reescritas com permissão + setor
-- ---------------------------------------------------------------------
-- contatos
drop policy contacts_select on public.contacts;
drop policy contacts_insert on public.contacts;
drop policy contacts_update on public.contacts;
drop policy contacts_delete on public.contacts;
create policy contacts_select on public.contacts for select to authenticated
  using (tenant_id = (select app.current_tenant_id())
         and ((select app.has_perm('contatos.ver')) or (select app.has_perm('whatsapp.ver')))
         and app.can_see_department(department_id));
create policy contacts_insert on public.contacts for insert to authenticated
  with check (tenant_id = (select app.current_tenant_id())
              and (select app.has_perm('contatos.editar'))
              and app.can_see_department(department_id));
create policy contacts_update on public.contacts for update to authenticated
  using (tenant_id = (select app.current_tenant_id())
         and (select app.has_perm('contatos.editar'))
         and app.can_see_department(department_id))
  with check (tenant_id = (select app.current_tenant_id()) and app.can_see_department(department_id));
create policy contacts_delete on public.contacts for delete to authenticated
  using (tenant_id = (select app.current_tenant_id())
         and (select app.has_perm('contatos.excluir'))
         and app.can_see_department(department_id));

-- interações (histórico)
drop policy interactions_select on public.interactions;
drop policy interactions_insert on public.interactions;
drop policy interactions_update on public.interactions;
drop policy interactions_delete on public.interactions;
create policy interactions_select on public.interactions for select to authenticated
  using (tenant_id = (select app.current_tenant_id()) and app.can_see_contact(tenant_id, contact_id));
create policy interactions_insert on public.interactions for insert to authenticated
  with check (tenant_id = (select app.current_tenant_id()) and (select app.has_perm('contatos.editar'))
              and app.can_see_contact(tenant_id, contact_id));
create policy interactions_update on public.interactions for update to authenticated
  using (tenant_id = (select app.current_tenant_id()) and (select app.has_perm('contatos.editar'))
         and app.can_see_contact(tenant_id, contact_id))
  with check (tenant_id = (select app.current_tenant_id()));
create policy interactions_delete on public.interactions for delete to authenticated
  using (tenant_id = (select app.current_tenant_id()) and (select app.has_perm('contatos.editar'))
         and app.can_see_contact(tenant_id, contact_id));

-- tags dos contatos
drop policy contact_tags_select on public.contact_tags;
drop policy contact_tags_insert on public.contact_tags;
drop policy contact_tags_update on public.contact_tags;
drop policy contact_tags_delete on public.contact_tags;
create policy contact_tags_select on public.contact_tags for select to authenticated
  using (tenant_id = (select app.current_tenant_id()) and app.can_see_contact(tenant_id, contact_id));
create policy contact_tags_insert on public.contact_tags for insert to authenticated
  with check (tenant_id = (select app.current_tenant_id()) and (select app.has_perm('contatos.editar'))
              and app.can_see_contact(tenant_id, contact_id));
create policy contact_tags_update on public.contact_tags for update to authenticated
  using (tenant_id = (select app.current_tenant_id()) and (select app.has_perm('contatos.editar'))
         and app.can_see_contact(tenant_id, contact_id))
  with check (tenant_id = (select app.current_tenant_id()));
create policy contact_tags_delete on public.contact_tags for delete to authenticated
  using (tenant_id = (select app.current_tenant_id()) and (select app.has_perm('contatos.editar'))
         and app.can_see_contact(tenant_id, contact_id));

-- tarefas (sem contato = visíveis a todos do tenant)
drop policy tasks_select on public.tasks;
drop policy tasks_insert on public.tasks;
drop policy tasks_update on public.tasks;
drop policy tasks_delete on public.tasks;
create policy tasks_select on public.tasks for select to authenticated
  using (tenant_id = (select app.current_tenant_id())
         and (contact_id is null or app.can_see_contact(tenant_id, contact_id)));
create policy tasks_insert on public.tasks for insert to authenticated
  with check (tenant_id = (select app.current_tenant_id()) and (select app.has_perm('tarefas.editar'))
              and (contact_id is null or app.can_see_contact(tenant_id, contact_id)));
create policy tasks_update on public.tasks for update to authenticated
  using (tenant_id = (select app.current_tenant_id()) and (select app.has_perm('tarefas.editar'))
         and (contact_id is null or app.can_see_contact(tenant_id, contact_id)))
  with check (tenant_id = (select app.current_tenant_id())
              and (contact_id is null or app.can_see_contact(tenant_id, contact_id)));
create policy tasks_delete on public.tasks for delete to authenticated
  using (tenant_id = (select app.current_tenant_id()) and (select app.has_perm('tarefas.editar'))
         and (contact_id is null or app.can_see_contact(tenant_id, contact_id)));

-- tags e etapas do funil: configuração
drop policy tags_insert on public.tags;
drop policy tags_update on public.tags;
drop policy tags_delete on public.tags;
create policy tags_insert on public.tags for insert to authenticated
  with check (tenant_id = (select app.current_tenant_id()) and (select app.has_perm('configuracoes.gerenciar')));
create policy tags_update on public.tags for update to authenticated
  using (tenant_id = (select app.current_tenant_id()) and (select app.has_perm('configuracoes.gerenciar')))
  with check (tenant_id = (select app.current_tenant_id()));
create policy tags_delete on public.tags for delete to authenticated
  using (tenant_id = (select app.current_tenant_id()) and (select app.has_perm('configuracoes.gerenciar')));

drop policy pipeline_stages_insert on public.pipeline_stages;
drop policy pipeline_stages_update on public.pipeline_stages;
drop policy pipeline_stages_delete on public.pipeline_stages;
create policy pipeline_stages_insert on public.pipeline_stages for insert to authenticated
  with check (tenant_id = (select app.current_tenant_id()) and (select app.has_perm('configuracoes.gerenciar')));
create policy pipeline_stages_update on public.pipeline_stages for update to authenticated
  using (tenant_id = (select app.current_tenant_id()) and (select app.has_perm('configuracoes.gerenciar')))
  with check (tenant_id = (select app.current_tenant_id()));
create policy pipeline_stages_delete on public.pipeline_stages for delete to authenticated
  using (tenant_id = (select app.current_tenant_id()) and (select app.has_perm('configuracoes.gerenciar')));

-- mensagens rápidas
drop policy quick_replies_select on public.quick_replies;
drop policy quick_replies_insert on public.quick_replies;
drop policy quick_replies_update on public.quick_replies;
drop policy quick_replies_delete on public.quick_replies;
create policy quick_replies_select on public.quick_replies for select to authenticated
  using (tenant_id = (select app.current_tenant_id()) and (select app.has_perm('whatsapp.ver')));
create policy quick_replies_insert on public.quick_replies for insert to authenticated
  with check (tenant_id = (select app.current_tenant_id()) and (select app.has_perm('configuracoes.gerenciar')));
create policy quick_replies_update on public.quick_replies for update to authenticated
  using (tenant_id = (select app.current_tenant_id()) and (select app.has_perm('configuracoes.gerenciar')))
  with check (tenant_id = (select app.current_tenant_id()));
create policy quick_replies_delete on public.quick_replies for delete to authenticated
  using (tenant_id = (select app.current_tenant_id()) and (select app.has_perm('configuracoes.gerenciar')));

-- WhatsApp
drop policy whatsapp_outbox_select on public.whatsapp_outbox;
drop policy whatsapp_outbox_insert on public.whatsapp_outbox;
drop policy whatsapp_outbox_delete_scheduled on public.whatsapp_outbox;
create policy whatsapp_outbox_select on public.whatsapp_outbox for select to authenticated
  using (tenant_id = (select app.current_tenant_id()) and (select app.has_perm('whatsapp.ver'))
         and app.can_see_contact(tenant_id, contact_id));
create policy whatsapp_outbox_insert on public.whatsapp_outbox for insert to authenticated
  with check (tenant_id = (select app.current_tenant_id()) and (select app.has_perm('whatsapp.enviar'))
              and app.can_see_contact(tenant_id, contact_id));
create policy whatsapp_outbox_delete_scheduled on public.whatsapp_outbox for delete to authenticated
  using (tenant_id = (select app.current_tenant_id()) and (select app.has_perm('whatsapp.enviar'))
         and app.can_see_contact(tenant_id, contact_id)
         and status = 'pendente' and scheduled_at > now());

drop policy whatsapp_qr_select on public.whatsapp_qr;
create policy whatsapp_qr_select on public.whatsapp_qr for select to authenticated
  using (tenant_id = (select app.current_tenant_id()) and (select app.has_perm('whatsapp.conectar')));

create or replace function public.whatsapp_request(p_action text)
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
  if p_action not in ('conectar', 'desconectar') then
    raise exception 'ação inválida' using errcode = '22023';
  end if;
  insert into public.whatsapp_sessions (tenant_id, desired_state, status)
  values (v_tenant, case when p_action = 'conectar' then 'conectado' else 'desconectado' end,
          case when p_action = 'conectar' then 'conectando'::public.whatsapp_status else 'desconectado'::public.whatsapp_status end)
  on conflict (tenant_id) do update
    set desired_state = excluded.desired_state,
        status = case when excluded.desired_state = 'conectado' and public.whatsapp_sessions.status = 'conectado'
                      then public.whatsapp_sessions.status else excluded.status end,
        last_error = null;
end;
$$;

-- IA
drop policy ai_settings_insert on public.ai_settings;
drop policy ai_settings_update on public.ai_settings;
create policy ai_settings_insert on public.ai_settings for insert to authenticated
  with check (tenant_id = (select app.current_tenant_id()) and (select app.has_perm('ia.configurar')));
create policy ai_settings_update on public.ai_settings for update to authenticated
  using (tenant_id = (select app.current_tenant_id()) and (select app.has_perm('ia.configurar')))
  with check (tenant_id = (select app.current_tenant_id()));

drop policy ai_usage_select on public.ai_usage;
create policy ai_usage_select on public.ai_usage for select to authenticated
  using (tenant_id = (select app.current_tenant_id()) and (select app.has_perm('ia.configurar')));

drop policy ai_suggestions_select on public.ai_suggestions;
drop policy ai_suggestions_update on public.ai_suggestions;
create policy ai_suggestions_select on public.ai_suggestions for select to authenticated
  using (tenant_id = (select app.current_tenant_id()) and (select app.has_perm('whatsapp.ver'))
         and app.can_see_contact(tenant_id, contact_id));
create policy ai_suggestions_update on public.ai_suggestions for update to authenticated
  using (tenant_id = (select app.current_tenant_id()) and (select app.has_perm('whatsapp.enviar'))
         and app.can_see_contact(tenant_id, contact_id))
  with check (tenant_id = (select app.current_tenant_id()));

-- auditoria
drop policy audit_logs_select on public.audit_logs;
create policy audit_logs_select on public.audit_logs for select to authenticated
  using (tenant_id = (select app.current_tenant_id()) and (select app.has_perm('auditoria.ver')));

-- ---------------------------------------------------------------------
-- Contexto da sessão agora inclui perfil, permissões e setores
-- ---------------------------------------------------------------------
drop function public.current_context();
create function public.current_context()
returns table (user_id uuid, tenant_id uuid, tenant_name text, role public.tenant_role, display_name text,
               profile text, permissions text[], department_ids uuid[])
language sql
stable
security definer
set search_path = ''
as $$
  select m.user_id, m.tenant_id, t.name, m.role, m.display_name, m.profile,
         case when m.role = 'admin' then app.permission_catalog() else m.permissions end,
         coalesce((select array_agg(md.department_id) from public.member_departments md
                   where md.tenant_id = m.tenant_id and md.user_id = m.user_id), '{}'::uuid[])
  from public.memberships m
  join public.tenants t on t.id = m.tenant_id
  where m.user_id = auth.uid()
$$;
revoke all on function public.current_context() from public, anon;
grant execute on function public.current_context() to authenticated;
