-- =====================================================================
-- Tráfego pago + etiquetas do WhatsApp Business
--
-- 1) Lead de anúncio: o worker grava em contacts.ad_source/ad_at quando a
--    conversa nasce de um anúncio Click-to-WhatsApp (Instagram/Facebook).
--    Usuários não alteram esses campos (como a foto do WhatsApp).
-- 2) tags.paid_traffic: etiquetas que contam como "tráfego pago" nos
--    relatórios (ex.: "Tráfego pago", "Google Ads"), editável pelo cliente.
-- 3) tags.wa_label_id: vínculo com a etiqueta do WhatsApp Business. Só o
--    worker grava. Mudanças feitas por PESSOAS nas etiquetas do CRM vão para
--    whatsapp_label_queue (o worker aplica no WhatsApp); mudanças feitas pelo
--    worker (vindas do celular) não entram na fila, então não há eco.
-- 4) app.tenant_ad_spend: investimento em anúncios por cliente e mês,
--    informado pela CONNECTA no Painel (não é visível para o cliente).
-- 5) Relatório mensal passa a trazer os números do tráfego pago.
-- =====================================================================

alter table public.contacts
  add column if not exists ad_source jsonb check (ad_source is null or jsonb_typeof(ad_source) = 'object'),
  add column if not exists ad_at timestamptz;
create index if not exists contacts_tenant_ad_idx on public.contacts (tenant_id, ad_at) where ad_at is not null;

alter table public.tags
  add column if not exists paid_traffic boolean not null default false,
  add column if not exists wa_label_id text check (wa_label_id is null or wa_label_id ~ '^[0-9A-Za-z_-]{1,40}$');
create unique index if not exists tags_tenant_wa_label_uidx on public.tags (tenant_id, wa_label_id) where wa_label_id is not null;

update public.tags set paid_traffic = true
 where name ~* '(tr[aá]fego|an[uú]ncio|\mads\M|google ads|meta ads|facebook ads|instagram ads|campanha)';

-- Usuários (auth.uid() presente) não mexem em campos que só o worker grava.
create or replace function app.guard_worker_columns()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if auth.uid() is null then
    return new; -- worker (service_role)
  end if;
  if tg_table_name = 'contacts' then
    if tg_op = 'INSERT' then
      new.ad_source := null;
      new.ad_at := null;
    elsif new.ad_source is distinct from old.ad_source or new.ad_at is distinct from old.ad_at then
      raise exception 'origem do anúncio é registrada só pelo WhatsApp' using errcode = '42501';
    end if;
  elsif tg_table_name = 'tags' then
    if tg_op = 'INSERT' then
      new.wa_label_id := null;
    elsif new.wa_label_id is distinct from old.wa_label_id then
      raise exception 'vínculo com o WhatsApp é gerenciado pelo sistema' using errcode = '42501';
    end if;
  end if;
  return new;
end $$;

drop trigger if exists c_guard_worker_cols on public.contacts;
create trigger c_guard_worker_cols before insert or update on public.contacts
  for each row execute function app.guard_worker_columns();
drop trigger if exists c_guard_worker_cols on public.tags;
create trigger c_guard_worker_cols before insert or update on public.tags
  for each row execute function app.guard_worker_columns();

-- ---------------------------------------------------------------------
-- Fila CRM → WhatsApp (só o worker lê; usuários não têm acesso)
-- ---------------------------------------------------------------------
create table public.whatsapp_label_queue (
  id           uuid primary key default gen_random_uuid(),
  tenant_id    uuid not null references public.tenants(id) on delete cascade,
  kind         text not null check (kind in ('chat_add', 'chat_remove', 'label_upsert', 'label_delete')),
  contact_id   uuid,
  tag_id       uuid,
  wa_label_id  text,
  status       text not null default 'pendente' check (status in ('pendente', 'processando', 'feito', 'erro')),
  attempts     integer not null default 0,
  error        text,
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now()
);
create index whatsapp_label_queue_tenant_idx on public.whatsapp_label_queue (tenant_id, status, created_at);

create trigger a_enforce_tenant before insert or update on public.whatsapp_label_queue
  for each row execute function app.enforce_tenant_id();
create trigger b_touch before update on public.whatsapp_label_queue
  for each row execute function app.touch_updated_at();

alter table public.whatsapp_label_queue enable row level security;
revoke all on public.whatsapp_label_queue from anon, authenticated;
-- Sem policies para usuários: só o worker (service_role) lê e grava.

-- Enfileira (SECURITY DEFINER: o usuário não tem acesso à fila, mas o
-- trigger grava nela com o tenant DA LINHA alterada, que o RLS já validou).
create or replace function app.enqueue_label_change()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_label text;
begin
  if auth.uid() is null then
    return null; -- mudança veio do worker/WhatsApp: não devolve para lá
  end if;
  -- cliente sendo excluído (cascata): nada a enviar
  if not exists (select 1 from public.tenants t where t.id = coalesce(new.tenant_id, old.tenant_id)) then
    return null;
  end if;
  -- só faz sentido para quem tem WhatsApp conectado (ou conectando)
  if not exists (select 1 from public.whatsapp_sessions s
                  where s.tenant_id = coalesce(new.tenant_id, old.tenant_id) and s.desired_state = 'conectado') then
    return null;
  end if;
  if tg_table_name = 'contact_tags' then
    if tg_op = 'INSERT' then
      insert into public.whatsapp_label_queue (tenant_id, kind, contact_id, tag_id)
        values (new.tenant_id, 'chat_add', new.contact_id, new.tag_id);
    else
      select t.wa_label_id into v_label from public.tags t where t.tenant_id = old.tenant_id and t.id = old.tag_id;
      if v_label is not null then
        insert into public.whatsapp_label_queue (tenant_id, kind, contact_id, wa_label_id)
          values (old.tenant_id, 'chat_remove', old.contact_id, v_label);
      end if;
    end if;
  elsif tg_table_name = 'tags' then
    if tg_op = 'INSERT' then
      insert into public.whatsapp_label_queue (tenant_id, kind, tag_id) values (new.tenant_id, 'label_upsert', new.id);
    elsif tg_op = 'UPDATE' then
      if new.name is distinct from old.name or new.color is distinct from old.color then
        insert into public.whatsapp_label_queue (tenant_id, kind, tag_id) values (new.tenant_id, 'label_upsert', new.id);
      end if;
    elsif old.wa_label_id is not null then
      insert into public.whatsapp_label_queue (tenant_id, kind, wa_label_id) values (old.tenant_id, 'label_delete', old.wa_label_id);
    end if;
  end if;
  return null;
end $$;

create trigger y_label_sync after insert or delete on public.contact_tags
  for each row execute function app.enqueue_label_change();
create trigger y_label_sync after insert or update or delete on public.tags
  for each row execute function app.enqueue_label_change();

-- ---------------------------------------------------------------------
-- Investimento em anúncios por cliente/mês (só equipe CONNECTA)
-- ---------------------------------------------------------------------
create table app.tenant_ad_spend (
  tenant_id     uuid not null references public.tenants(id) on delete cascade,
  month         date not null check (month = date_trunc('month', month)::date),
  meta_cents    bigint not null default 0 check (meta_cents between 0 and 1e12),
  google_cents  bigint not null default 0 check (google_cents between 0 and 1e12),
  other_cents   bigint not null default 0 check (other_cents between 0 and 1e12),
  updated_by    uuid references auth.users(id) on delete set null,
  updated_at    timestamptz not null default now(),
  primary key (tenant_id, month)
);
alter table app.tenant_ad_spend enable row level security;
revoke all on app.tenant_ad_spend from public, anon, authenticated;

create or replace function public.platform_set_ad_spend(
  p_tenant uuid, p_month date, p_meta bigint, p_google bigint, p_other bigint
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  if not public.is_platform_admin() then
    raise exception 'apenas administradores da plataforma' using errcode = '42501';
  end if;
  if not exists (select 1 from public.tenants where id = p_tenant) then
    raise exception 'cliente não encontrado' using errcode = 'P0002';
  end if;
  insert into app.tenant_ad_spend (tenant_id, month, meta_cents, google_cents, other_cents, updated_by)
  values (p_tenant, date_trunc('month', p_month)::date, greatest(coalesce(p_meta, 0), 0),
          greatest(coalesce(p_google, 0), 0), greatest(coalesce(p_other, 0), 0), auth.uid())
  on conflict (tenant_id, month) do update
     set meta_cents = excluded.meta_cents, google_cents = excluded.google_cents,
         other_cents = excluded.other_cents, updated_by = excluded.updated_by, updated_at = now();
end $$;
revoke all on function public.platform_set_ad_spend(uuid, date, bigint, bigint, bigint) from public, anon;
grant execute on function public.platform_set_ad_spend(uuid, date, bigint, bigint, bigint) to authenticated;

-- ---------------------------------------------------------------------
-- Relatório mensal com tráfego pago
-- Lead de tráfego pago = veio de anúncio (ad_at) OU tem etiqueta marcada
-- como tráfego pago.
-- ---------------------------------------------------------------------
create or replace function app.is_paid_contact(p_tenant uuid, p_contact uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (select 1 from public.contacts c where c.tenant_id = p_tenant and c.id = p_contact and c.ad_at is not null)
      or exists (select 1 from public.contact_tags ct join public.tags t on t.tenant_id = ct.tenant_id and t.id = ct.tag_id
                  where ct.tenant_id = p_tenant and ct.contact_id = p_contact and t.paid_traffic)
$$;
revoke all on function app.is_paid_contact(uuid, uuid) from public, anon, authenticated;

drop function public.platform_monthly_report(date);
create function public.platform_monthly_report(p_month date)
returns table (
  id                   uuid,
  name                 text,
  slug                 text,
  suspended            boolean,
  members              integer,
  contacts_total       integer,
  leads_new            integer,
  leads_won            integer,
  won_value_cents      bigint,
  leads_lost           integer,
  open_value_cents     bigint,
  wa_in                integer,
  wa_out               integer,
  wa_conversations     integer,
  ai_responses         integer,
  ai_suggestions       integer,
  ai_tokens            bigint,
  tasks_created        integer,
  tasks_done           integer,
  interactions_other   integer,
  top_sources          jsonb,
  paid_leads_new       integer,
  ad_leads_new         integer,
  paid_leads_won       integer,
  paid_won_value_cents bigint,
  spend_meta_cents     bigint,
  spend_google_cents   bigint,
  spend_other_cents    bigint,
  top_campaigns        jsonb
)
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_start timestamptz;
  v_end   timestamptz;
begin
  if not public.is_platform_admin() then
    raise exception 'apenas administradores da plataforma' using errcode = '42501';
  end if;
  if p_month is null or p_month < date '2020-01-01' or p_month > (now() + interval '1 month')::date then
    raise exception 'mês inválido' using errcode = '22023';
  end if;
  v_start := date_trunc('month', p_month)::timestamp at time zone 'America/Sao_Paulo';
  v_end   := (date_trunc('month', p_month) + interval '1 month')::timestamp at time zone 'America/Sao_Paulo';

  return query
  with stage_flags as (
    select s.tenant_id, s.id::text as stage_id, s.is_won, s.is_lost from public.pipeline_stages s
  ),
  moves as (
    select a.tenant_id, a.record_id, (a.new_data ->> 'stage_id') as stage_id,
           coalesce((a.new_data ->> 'value_cents')::bigint, 0) as value_cents, a.created_at
      from public.audit_logs a
     where a.table_name = 'contacts'
       and a.created_at >= v_start and a.created_at < v_end
       and (a.action = 'INSERT'
            or (a.action = 'UPDATE' and (a.new_data ->> 'stage_id') is distinct from (a.old_data ->> 'stage_id')))
  ),
  won as (
    select distinct on (m.tenant_id, m.record_id) m.tenant_id, m.record_id, m.value_cents,
           app.is_paid_contact(m.tenant_id, m.record_id::uuid) as paid
      from moves m join stage_flags f on f.tenant_id = m.tenant_id and f.stage_id = m.stage_id and f.is_won
     where m.record_id ~ '^[0-9a-f-]{36}$'
     order by m.tenant_id, m.record_id, m.created_at desc
  ),
  won_agg as (
    select w.tenant_id, count(*) as n, sum(w.value_cents)::bigint as cents,
           count(*) filter (where w.paid) as paid_n,
           coalesce(sum(w.value_cents) filter (where w.paid), 0)::bigint as paid_cents
      from won w group by w.tenant_id
  ),
  lost as (
    select m.tenant_id, count(distinct m.record_id) as n
      from moves m join stage_flags f on f.tenant_id = m.tenant_id and f.stage_id = m.stage_id and f.is_lost
     group by m.tenant_id
  ),
  new_leads as (
    select c.tenant_id, c.id, c.source, c.ad_at, c.ad_source,
           app.is_paid_contact(c.tenant_id, c.id) as paid
      from public.contacts c
     where c.created_at >= v_start and c.created_at < v_end
  ),
  new_agg as (
    select n.tenant_id, count(*) filter (where n.paid) as paid_n, count(*) filter (where n.ad_at is not null) as ad_n
      from new_leads n group by n.tenant_id
  ),
  sources as (
    select y.tenant_id, jsonb_agg(jsonb_build_object('source', y.source, 'count', y.n) order by y.n desc, y.source) as top
      from (select n.tenant_id, coalesce(nullif(trim(n.source), ''), 'Sem origem') as source, count(*)::int as n,
                   row_number() over (partition by n.tenant_id order by count(*) desc, coalesce(nullif(trim(n.source), ''), 'Sem origem')) as rn
              from new_leads n
             group by n.tenant_id, coalesce(nullif(trim(n.source), ''), 'Sem origem')) y
     where y.rn <= 6
     group by y.tenant_id
  ),
  campaigns as (
    -- anúncios (Click-to-WhatsApp) que trouxeram leads no mês
    select z.tenant_id, jsonb_agg(jsonb_build_object('campaign', z.campaign, 'count', z.n) order by z.n desc, z.campaign) as top
      from (select c.tenant_id,
                   coalesce(nullif(trim(c.ad_source ->> 'title'), ''), 'Anúncio ' || coalesce(c.ad_source ->> 'source_id', 'sem nome')) as campaign,
                   count(*)::int as n,
                   row_number() over (partition by c.tenant_id order by count(*) desc) as rn
              from public.contacts c
             where c.ad_at >= v_start and c.ad_at < v_end
             group by 1, 2) z
     where z.rn <= 8
     group by z.tenant_id
  )
  select t.id, t.name::text, t.slug::text, t.suspended_at is not null,
         (select count(*)::int from public.memberships m where m.tenant_id = t.id),
         (select count(*)::int from public.contacts c where c.tenant_id = t.id),
         (select count(*)::int from new_leads n where n.tenant_id = t.id),
         coalesce(wa.n, 0)::int,
         coalesce(wa.cents, 0)::bigint,
         coalesce(l.n, 0)::int,
         (select coalesce(sum(c.value_cents), 0)::bigint from public.contacts c
            join public.pipeline_stages s on s.tenant_id = c.tenant_id and s.id = c.stage_id
           where c.tenant_id = t.id and not s.is_won and not s.is_lost),
         (select count(*)::int from public.interactions i where i.tenant_id = t.id and i.type = 'whatsapp'
             and i.direction = 'entrada' and i.occurred_at >= v_start and i.occurred_at < v_end),
         (select count(*)::int from public.interactions i where i.tenant_id = t.id and i.type = 'whatsapp'
             and i.direction = 'saida' and i.occurred_at >= v_start and i.occurred_at < v_end),
         (select count(distinct i.contact_id)::int from public.interactions i where i.tenant_id = t.id and i.type = 'whatsapp'
             and i.occurred_at >= v_start and i.occurred_at < v_end),
         (select count(*)::int from public.ai_usage u where u.tenant_id = t.id and u.kind = 'resposta'
             and u.created_at >= v_start and u.created_at < v_end),
         (select count(*)::int from public.ai_usage u where u.tenant_id = t.id and u.kind = 'sugestao'
             and u.created_at >= v_start and u.created_at < v_end),
         (select coalesce(sum(u.input_tokens + u.output_tokens), 0)::bigint from public.ai_usage u where u.tenant_id = t.id
             and u.created_at >= v_start and u.created_at < v_end),
         (select count(*)::int from public.tasks k where k.tenant_id = t.id and k.created_at >= v_start and k.created_at < v_end),
         (select count(*)::int from public.tasks k where k.tenant_id = t.id and k.status = 'concluida'
             and k.completed_at >= v_start and k.completed_at < v_end),
         (select count(*)::int from public.interactions i where i.tenant_id = t.id and i.type <> 'whatsapp'
             and i.occurred_at >= v_start and i.occurred_at < v_end),
         coalesce(s.top, '[]'::jsonb),
         coalesce(na.paid_n, 0)::int,
         coalesce(na.ad_n, 0)::int,
         coalesce(wa.paid_n, 0)::int,
         coalesce(wa.paid_cents, 0)::bigint,
         coalesce(sp.meta_cents, 0)::bigint,
         coalesce(sp.google_cents, 0)::bigint,
         coalesce(sp.other_cents, 0)::bigint,
         coalesce(cp.top, '[]'::jsonb)
    from public.tenants t
    left join won_agg wa on wa.tenant_id = t.id
    left join lost l on l.tenant_id = t.id
    left join new_agg na on na.tenant_id = t.id
    left join sources s on s.tenant_id = t.id
    left join campaigns cp on cp.tenant_id = t.id
    left join app.tenant_ad_spend sp on sp.tenant_id = t.id and sp.month = date_trunc('month', p_month)::date
   where t.created_at < v_end
   order by t.name;
end $$;
revoke all on function public.platform_monthly_report(date) from public, anon;
grant execute on function public.platform_monthly_report(date) to authenticated;
