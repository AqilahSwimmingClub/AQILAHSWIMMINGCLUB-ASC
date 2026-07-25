create table if not exists public.class_app_data (
  class_id text primary key,
  payload jsonb not null default '{}'::jsonb,
  updated_at timestamptz not null default now()
);

alter table public.class_app_data enable row level security;

drop policy if exists "ASC public read" on public.class_app_data;
drop policy if exists "ASC public insert" on public.class_app_data;
drop policy if exists "ASC public update" on public.class_app_data;

create policy "ASC public read"
on public.class_app_data for select
to anon, authenticated
using (true);

create policy "ASC public insert"
on public.class_app_data for insert
to anon, authenticated
with check (true);

create policy "ASC public update"
on public.class_app_data for update
to anon, authenticated
using (true)
with check (true);

do $$
begin
  if not exists (
    select 1
    from pg_publication_tables
    where pubname = 'supabase_realtime'
      and schemaname = 'public'
      and tablename = 'class_app_data'
  ) then
    alter publication supabase_realtime add table public.class_app_data;
  end if;
end $$;
