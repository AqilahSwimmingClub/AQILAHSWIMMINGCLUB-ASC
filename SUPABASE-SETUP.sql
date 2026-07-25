create table if not exists public.class_app_data (
  class_id text primary key,
  payload jsonb not null default '{}'::jsonb,
  updated_at timestamptz not null default now()
);

alter table public.class_app_data enable row level security;

drop policy if exists "ASC public read" on public.class_app_data;
drop policy if exists "ASC public insert" on public.class_app_data;
drop policy if exists "ASC public update" on public.class_app_data;

create policy "ASC public read" on public.class_app_data
for select to anon, authenticated using (true);
create policy "ASC public insert" on public.class_app_data
for insert to anon, authenticated with check (true);
create policy "ASC public update" on public.class_app_data
for update to anon, authenticated using (true) with check (true);

-- Bucket khusus seluruh foto dan dokumen aplikasi.
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'asc-uploads',
  'asc-uploads',
  true,
  12582912,
  array['image/jpeg','image/png','image/webp','image/gif','application/pdf']
)
on conflict (id) do update set
  public = excluded.public,
  file_size_limit = excluded.file_size_limit,
  allowed_mime_types = excluded.allowed_mime_types;

drop policy if exists "ASC storage public read" on storage.objects;
drop policy if exists "ASC storage public upload" on storage.objects;
drop policy if exists "ASC storage public update" on storage.objects;
drop policy if exists "ASC storage public delete" on storage.objects;

create policy "ASC storage public read" on storage.objects
for select to anon, authenticated
using (bucket_id = 'asc-uploads');

create policy "ASC storage public upload" on storage.objects
for insert to anon, authenticated
with check (bucket_id = 'asc-uploads');

create policy "ASC storage public update" on storage.objects
for update to anon, authenticated
using (bucket_id = 'asc-uploads')
with check (bucket_id = 'asc-uploads');

create policy "ASC storage public delete" on storage.objects
for delete to anon, authenticated
using (bucket_id = 'asc-uploads');

do $$
begin
  if not exists (
    select 1 from pg_publication_tables
    where pubname = 'supabase_realtime'
      and schemaname = 'public'
      and tablename = 'class_app_data'
  ) then
    alter publication supabase_realtime add table public.class_app_data;
  end if;
end $$;
