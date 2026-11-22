-- =====================================================================
-- Relatório mensal por cliente (Painel da CONNECTA)
--
-- Só NÚMEROS agregados por cliente e mês: leads novos, fechados, perdidos,
-- valores, mensagens do WhatsApp, uso da IA, tarefas e origem dos leads
-- (contagem por "origem"). Nenhum contato, conversa ou texto sai daqui.
-- Mesma regra do restante do painel: SECURITY DEFINER que exige
-- public.is_platform_admin().
--
-- Mês no fuso de Brasília. "Fechados/perdidos no mês" vem da auditoria:
-- contatos que ENTRARAM numa etapa de ganho/perda naquele mês.
-- =====================================================================

create or replace function public.platform_monthly_report(p_month date)
returns table (
  id                 uuid,
  name               text,
  slug               text,
  suspended          boolean,
  members            integer,
  contacts_total     integer,
  leads_new          integer,
  leads_won          integer,
  won_value_cents    bigint,
  leads_lost         integer,
  open_value_cents   bigint,
  wa_in              integer,
  wa_out             integer,
  wa_conversations   integer,
  ai_responses       integer,
  ai_suggestions     integer,
  ai_tokens          bigint,
  tasks_created      integer,
  tasks_done         integer,
  interactions_other integer,
  top_sources        jsonb
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
    -- contato entrou numa etapa (insert já numa etapa, ou mudou de etapa) no mês
    select a.tenant_id, a.record_id, (a.new_data ->> 'stage_id') as stage_id,
           coalesce((a.new_data ->> 'value_cents')::bigint, 0) as value_cents, a.created_at
      from public.audit_logs a
     where a.table_name = 'contacts'
       and a.created_at >= v_start and a.created_at < v_end
       and (a.action = 'INSERT'
            or (a.action = 'UPDATE' and (a.new_data ->> 'stage_id') is distinct from (a.old_data ->> 'stage_id')))
  ),
  outcome as (
    select m.tenant_id,
           count(distinct m.record_id) filter (where f.is_won)  as won,
           count(distinct m.record_id) filter (where f.is_lost) as lost
      from moves m join stage_flags f on f.tenant_id = m.tenant_id and f.stage_id = m.stage_id
     group by m.tenant_id
  ),
  won_value as (
    -- valor de cada contato fechado no mês (valor no momento em que entrou na etapa de ganho)
    select x.tenant_id, sum(x.value_cents)::bigint as cents
      from (select distinct on (m.tenant_id, m.record_id) m.tenant_id, m.value_cents
              from moves m join stage_flags f on f.tenant_id = m.tenant_id and f.stage_id = m.stage_id and f.is_won
             order by m.tenant_id, m.record_id, m.created_at desc) x
     group by x.tenant_id
  ),
  sources as (
    select y.tenant_id, jsonb_agg(jsonb_build_object('source', y.source, 'count', y.n) order by y.n desc, y.source) as top
      from (select c.tenant_id, coalesce(nullif(trim(c.source), ''), 'Sem origem') as source, count(*)::int as n,
                   row_number() over (partition by c.tenant_id order by count(*) desc, coalesce(nullif(trim(c.source), ''), 'Sem origem')) as rn
              from public.contacts c
             where c.created_at >= v_start and c.created_at < v_end
             group by c.tenant_id, coalesce(nullif(trim(c.source), ''), 'Sem origem')) y
     where y.rn <= 6
     group by y.tenant_id
  )
  select t.id, t.name::text, t.slug::text, t.suspended_at is not null,
         (select count(*)::int from public.memberships m where m.tenant_id = t.id),
         (select count(*)::int from public.contacts c where c.tenant_id = t.id),
         (select count(*)::int from public.contacts c where c.tenant_id = t.id and c.created_at >= v_start and c.created_at < v_end),
         coalesce(o.won, 0)::int,
         coalesce(w.cents, 0)::bigint,
         coalesce(o.lost, 0)::int,
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
         coalesce(s.top, '[]'::jsonb)
    from public.tenants t
    left join outcome o on o.tenant_id = t.id
    left join won_value w on w.tenant_id = t.id
    left join sources s on s.tenant_id = t.id
   where t.created_at < v_end
   order by t.name;
end $$;
revoke all on function public.platform_monthly_report(date) from public, anon;
grant execute on function public.platform_monthly_report(date) to authenticated;

-- Acelera os agregados por mês da auditoria de contatos.
create index if not exists audit_logs_tenant_table_created_idx
  on public.audit_logs (tenant_id, table_name, created_at);
