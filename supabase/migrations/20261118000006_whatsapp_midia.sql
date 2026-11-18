-- =====================================================================
-- WhatsApp: mídia (áudio, imagem, vídeo, documento), mensagens agendadas
-- e mensagens rápidas.
--
-- Arquivos ficam no bucket privado tenant-files, em
--   <tenant_id>/whatsapp/<contact_id>/<arquivo>
-- e a fila só aceita media_path dentro da pasta do PRÓPRIO tenant.
-- =====================================================================

alter table public.whatsapp_outbox
  add column media_kind text check (media_kind in ('audio', 'image', 'video', 'document')),
  add column media_path text check (length(media_path) <= 500),
  add column media_mime text check (length(media_mime) <= 120),
  add column media_filename text check (length(media_filename) <= 200),
  add column scheduled_at timestamptz;

-- texto pode ser vazio quando há mídia (legenda opcional)
alter table public.whatsapp_outbox drop constraint whatsapp_outbox_body_check;
alter table public.whatsapp_outbox
  add constraint whatsapp_outbox_body_check
  check (length(body) <= 4096 and (length(body) >= 1 or media_path is not null));
alter table public.whatsapp_outbox
  add constraint whatsapp_outbox_media_pair check ((media_path is null) = (media_kind is null));

create index whatsapp_outbox_tenant_scheduled_idx on public.whatsapp_outbox (tenant_id, scheduled_at)
  where status = 'pendente' and scheduled_at is not null;

-- A mídia precisa estar na pasta do tenant da mensagem (impede apontar para
-- arquivo de outro tenant, inclusive pelo worker com service_role).
create or replace function app.check_outbox_media()
returns trigger language plpgsql set search_path = '' as $$
begin
  if new.media_path is not null and (
       split_part(new.media_path, '/', 1) <> new.tenant_id::text
       or new.media_path like '%..%'
     ) then
    raise exception 'arquivo fora da pasta do tenant' using errcode = '42501';
  end if;
  return new;
end $$;
create trigger c_check_media before insert or update on public.whatsapp_outbox
  for each row execute function app.check_outbox_media();

-- Usuário pode enviar mídia, agendar e cancelar agendamentos do próprio tenant.
grant insert (media_kind, media_path, media_mime, media_filename, scheduled_at) on public.whatsapp_outbox to authenticated;
grant delete on public.whatsapp_outbox to authenticated;
create policy whatsapp_outbox_delete_scheduled on public.whatsapp_outbox for delete to authenticated
  using (tenant_id = (select app.current_tenant_id()) and status = 'pendente' and scheduled_at > now());

-- ---------------------------------------------------------------------
-- Mensagens rápidas (como no WhatsApp Business): atalho "/nome"
-- ---------------------------------------------------------------------
create table public.quick_replies (
  id          uuid primary key default gen_random_uuid(),
  tenant_id   uuid not null references public.tenants(id) on delete cascade,
  shortcut    text not null check (shortcut ~ '^[a-z0-9][a-z0-9_-]{0,29}$'),
  title       text not null check (length(trim(title)) between 1 and 80),
  body        text not null check (length(body) between 1 and 4096),
  created_by  uuid references auth.users(id) on delete set null default auth.uid(),
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now(),
  unique (tenant_id, id),
  unique (tenant_id, shortcut)
);
create index quick_replies_tenant_idx on public.quick_replies (tenant_id, shortcut);

create trigger a_enforce_tenant before insert or update on public.quick_replies
  for each row execute function app.enforce_tenant_id();
create trigger b_touch before update on public.quick_replies
  for each row execute function app.touch_updated_at();
create trigger z_audit after insert or update or delete on public.quick_replies
  for each row execute function app.audit_trigger();

alter table public.quick_replies enable row level security;
revoke all on public.quick_replies from anon;
create policy quick_replies_select on public.quick_replies for select to authenticated
  using (tenant_id = (select app.current_tenant_id()));
create policy quick_replies_insert on public.quick_replies for insert to authenticated
  with check (tenant_id = (select app.current_tenant_id()));
create policy quick_replies_update on public.quick_replies for update to authenticated
  using (tenant_id = (select app.current_tenant_id()))
  with check (tenant_id = (select app.current_tenant_id()));
create policy quick_replies_delete on public.quick_replies for delete to authenticated
  using (tenant_id = (select app.current_tenant_id()));
