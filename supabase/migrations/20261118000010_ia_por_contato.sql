-- =====================================================================
-- IA por contato (opt-in): a IA só atende os números em que alguém da
-- equipe ativou "IA neste número". Padrão: desligada para todos,
-- inclusive contatos já existentes.
-- =====================================================================
alter table public.contacts
  add column if not exists ai_enabled boolean not null default false;
