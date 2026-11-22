-- =====================================================================
-- WhatsApp: "Gerar novo QR code" (recomeçar o pareamento do zero)
--
-- Mesma regra de permissão de antes (whatsapp.conectar).
-- whatsapp_request('reiniciar') marca reset_requested_at; o worker apaga as
-- credenciais guardadas daquele tenant, fecha o socket e conecta de novo,
-- gerando um QR novo. Útil quando o pareamento trava em "Conectando".
-- =====================================================================

alter table public.whatsapp_sessions
  add column if not exists reset_requested_at timestamptz;

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
  if p_action not in ('conectar', 'desconectar', 'reiniciar') then
    raise exception 'ação inválida' using errcode = '22023';
  end if;
  if p_action = 'reiniciar' then
    insert into public.whatsapp_sessions (tenant_id, desired_state, status, reset_requested_at, last_error)
    values (v_tenant, 'conectado', 'conectando', now(), null)
    on conflict (tenant_id) do update
      set desired_state = 'conectado', status = 'conectando', reset_requested_at = now(), last_error = null;
    return;
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
