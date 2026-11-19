-- =====================================================================
-- Perfil do WhatsApp no contato: foto, nome e recado ("status").
-- A foto fica no bucket privado tenant-files, em <tenant_id>/avatars/...,
-- e só o worker (service_role) grava estes campos.
-- =====================================================================
alter table public.contacts
  add column if not exists avatar_path text check (avatar_path is null or length(avatar_path) <= 300),
  add column if not exists whatsapp_name text check (whatsapp_name is null or length(whatsapp_name) <= 120),
  add column if not exists whatsapp_about text check (whatsapp_about is null or length(whatsapp_about) <= 500),
  add column if not exists profile_checked_at timestamptz;

-- A foto precisa estar na pasta do próprio tenant (mesma regra da fila de mídia).
create or replace function app.check_contact_avatar()
returns trigger language plpgsql set search_path = '' as $$
begin
  -- Usuários (JWT) não gravam estes campos: só o worker (service_role).
  if auth.uid() is not null then
    if tg_op = 'INSERT' then
      new.avatar_path := null; new.whatsapp_name := null; new.whatsapp_about := null; new.profile_checked_at := null;
    elsif new.avatar_path is distinct from old.avatar_path
       or new.whatsapp_name is distinct from old.whatsapp_name
       or new.whatsapp_about is distinct from old.whatsapp_about
       or new.profile_checked_at is distinct from old.profile_checked_at then
      raise exception 'perfil do WhatsApp é atualizado só pelo sistema' using errcode = '42501';
    end if;
  end if;
  if new.avatar_path is not null and (
       split_part(new.avatar_path, '/', 1) <> new.tenant_id::text
       or new.avatar_path like '%..%'
     ) then
    raise exception 'foto fora da pasta do tenant' using errcode = '42501';
  end if;
  return new;
end $$;
drop trigger if exists c_check_avatar on public.contacts;
create trigger c_check_avatar before insert or update on public.contacts
  for each row execute function app.check_contact_avatar();
