-- =====================================================================
-- Storage separado por prefixo do tenant + Realtime
-- Caminho obrigatório dos arquivos: <tenant_id>/<qualquer coisa>
-- =====================================================================

insert into storage.buckets (id, name, public, file_size_limit)
values ('tenant-files', 'tenant-files', false, 52428800)
on conflict (id) do update set public = false;

create policy tenant_files_select on storage.objects for select to authenticated
  using (bucket_id = 'tenant-files'
         and (storage.foldername(name))[1] = (select app.current_tenant_id())::text);

create policy tenant_files_insert on storage.objects for insert to authenticated
  with check (bucket_id = 'tenant-files'
              and (storage.foldername(name))[1] = (select app.current_tenant_id())::text);

create policy tenant_files_update on storage.objects for update to authenticated
  using (bucket_id = 'tenant-files'
         and (storage.foldername(name))[1] = (select app.current_tenant_id())::text)
  with check (bucket_id = 'tenant-files'
              and (storage.foldername(name))[1] = (select app.current_tenant_id())::text);

create policy tenant_files_delete on storage.objects for delete to authenticated
  using (bucket_id = 'tenant-files'
         and (storage.foldername(name))[1] = (select app.current_tenant_id())::text);

-- Realtime (postgres_changes respeita RLS: cada assinante só recebe
-- eventos de linhas que ele poderia ler).
do $$
begin
  if exists (select 1 from pg_publication where pubname = 'supabase_realtime') then
    alter publication supabase_realtime add table public.interactions, public.contacts, public.tasks;
  end if;
end;
$$;
