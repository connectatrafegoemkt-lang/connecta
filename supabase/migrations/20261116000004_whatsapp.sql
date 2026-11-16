-- =====================================================================
-- WhatsApp por QR code — uma sessão por tenant
--
-- whatsapp_sessions : status da conexão (membros do tenant leem)
-- whatsapp_qr       : QR atual (só ADMIN do tenant lê)
-- whatsapp_auth_keys: credenciais do WhatsApp CRIPTOGRAFADAS (AES-256-GCM,
--                     chave derivada por tenant). NENHUM usuário acessa,
--                     nem do próprio tenant: só o worker (service_role).
-- whatsapp_outbox   : fila de mensagens a enviar (membro insere; worker envia)
-- =====================================================================

create type public.whatsapp_status as enum ('desconectado', 'aguardando_qr', 'conectando', 'conectado', 'erro');

create table public.whatsapp_sessions (
  tenant_id      uuid primary key references public.tenants(id) on delete cascade,
  status         public.whatsapp_status not null default 'desconectado',
  desired_state  text not null default 'desconectado' check (desired_state in ('conectado', 'desconectado')),
  phone          text,
  last_error     text,
  connected_at   timestamptz,
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now()
);

create table public.whatsapp_qr (
  tenant_id   uuid primary key references public.tenants(id) on delete cascade,
  qr          text,
  updated_at  timestamptz not null default now()
);

create table public.whatsapp_auth_keys (
  tenant_id   uuid not null references public.tenants(id) on delete cascade,
  key         text not null check (length(key) <= 300),
  value_enc   text not null,            -- base64(iv | tag | ciphertext)
  updated_at  timestamptz not null default now(),
  primary key (tenant_id, key)
);

create type public.outbox_status as enum ('pendente', 'enviando', 'enviado', 'erro');

create table public.whatsapp_outbox (
  id              uuid primary key default gen_random_uuid(),
  tenant_id       uuid not null references public.tenants(id) on delete cascade,
  contact_id      uuid not null,
  body            text not null check (length(body) between 1 and 4096),
  status          public.outbox_status not null default 'pendente',
  error           text,
  attempts        integer not null default 0,
  interaction_id  uuid,
  created_by      uuid references auth.users(id) on delete set null default auth.uid(),
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now(),
  unique (tenant_id, id),
  foreign key (tenant_id, contact_id) references public.contacts (tenant_id, id) on delete cascade
);
create index whatsapp_outbox_tenant_status_idx on public.whatsapp_outbox (tenant_id, status, created_at);

-- Triggers padrão (tenant forçado pela sessão, updated_at, auditoria)
do $$
declare t text;
begin
  foreach t in array array['whatsapp_sessions', 'whatsapp_qr', 'whatsapp_auth_keys', 'whatsapp_outbox'] loop
    execute format('create trigger a_enforce_tenant before insert or update on public.%I
                      for each row execute function app.enforce_tenant_id()', t);
    execute format('create trigger b_touch before update on public.%I
                      for each row execute function app.touch_updated_at()', t);
    execute format('alter table public.%I enable row level security', t);
    execute format('revoke all on public.%I from anon', t);
  end loop;
end $$;

-- Auditoria só no que é ação de usuário (sessão e fila); QR/credenciais
-- mudam o tempo todo e não devem ir para o log (contêm material sensível).
create trigger z_audit after insert or update or delete on public.whatsapp_sessions
  for each row execute function app.audit_trigger();
create trigger z_audit after insert or delete on public.whatsapp_outbox
  for each row execute function app.audit_trigger();

-- Contato precisa ter telefone para entrar na fila
create or replace function app.check_outbox_contact()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  if not exists (
    select 1 from public.contacts
    where tenant_id = new.tenant_id and id = new.contact_id and phone is not null
  ) then
    raise exception 'contato sem telefone' using errcode = '23514';
  end if;
  return new;
end $$;
create trigger c_check_contact before insert on public.whatsapp_outbox
  for each row execute function app.check_outbox_contact();

-- ---------------------------------------------------------------------
-- Policies
-- ---------------------------------------------------------------------
create policy whatsapp_sessions_select on public.whatsapp_sessions for select to authenticated
  using (tenant_id = (select app.current_tenant_id()));

create policy whatsapp_qr_select on public.whatsapp_qr for select to authenticated
  using (tenant_id = (select app.current_tenant_id()) and (select app.is_admin()));

-- whatsapp_auth_keys: SEM policies para authenticated => nega tudo.

create policy whatsapp_outbox_select on public.whatsapp_outbox for select to authenticated
  using (tenant_id = (select app.current_tenant_id()));
create policy whatsapp_outbox_insert on public.whatsapp_outbox for insert to authenticated
  with check (tenant_id = (select app.current_tenant_id()));

-- Grants: usuário só lê sessão/QR/fila e só INSERE (contact_id, body) na fila.
revoke all on public.whatsapp_auth_keys from authenticated;
revoke insert, update, delete, truncate on public.whatsapp_sessions from authenticated;
revoke insert, update, delete, truncate on public.whatsapp_qr from authenticated;
revoke insert, update, delete, truncate on public.whatsapp_outbox from authenticated;
grant insert (contact_id, body) on public.whatsapp_outbox to authenticated;

-- ---------------------------------------------------------------------
-- RPC: admin pede conexão/desconexão do WhatsApp DO PRÓPRIO tenant.
-- ---------------------------------------------------------------------
create or replace function public.whatsapp_request(p_action text)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_tenant uuid := app.current_tenant_id();
begin
  if v_tenant is null or not app.is_admin() then
    raise exception 'apenas administradores' using errcode = '42501';
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
revoke all on function public.whatsapp_request(text) from public, anon;
grant execute on function public.whatsapp_request(text) to authenticated;

-- Realtime: status, QR (RLS: só admin recebe), fila e interações
do $$
begin
  if exists (select 1 from pg_publication where pubname = 'supabase_realtime') then
    alter publication supabase_realtime add table public.whatsapp_sessions, public.whatsapp_qr, public.whatsapp_outbox;
  end if;
end $$;

-- Upsert idempotente de mensagens (ON CONFLICT precisa de constraint não parcial;
-- NULLs continuam permitidos para interações que não vêm do WhatsApp).
drop index if exists public.interactions_tenant_external_uidx;
alter table public.interactions
  add constraint interactions_tenant_external_key unique (tenant_id, external_id);
