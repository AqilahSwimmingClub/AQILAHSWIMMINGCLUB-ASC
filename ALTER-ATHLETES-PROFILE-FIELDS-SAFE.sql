alter table public.asc_athletes add column if not exists parent_phone text;
alter table public.asc_athletes add column if not exists school_name text;
alter table public.asc_athletes add column if not exists family_card_url text;
alter table public.asc_athletes add column if not exists birth_certificate_url text;
alter table public.asc_athletes add column if not exists profile_updated_at timestamptz;
alter table public.asc_athletes add column if not exists profile_updated_by text;
grant select,insert,update,delete on public.asc_athletes to anon,authenticated;
alter table public.asc_athletes enable row level security;
do $$ begin
  if not exists(select 1 from pg_policies where schemaname='public' and tablename='asc_athletes' and policyname='asc_athletes_profile_select') then create policy asc_athletes_profile_select on public.asc_athletes for select to anon,authenticated using (true); end if;
  if not exists(select 1 from pg_policies where schemaname='public' and tablename='asc_athletes' and policyname='asc_athletes_profile_insert') then create policy asc_athletes_profile_insert on public.asc_athletes for insert to anon,authenticated with check (true); end if;
  if not exists(select 1 from pg_policies where schemaname='public' and tablename='asc_athletes' and policyname='asc_athletes_profile_update') then create policy asc_athletes_profile_update on public.asc_athletes for update to anon,authenticated using (true) with check (true); end if;
  if not exists(select 1 from pg_policies where schemaname='public' and tablename='asc_athletes' and policyname='asc_athletes_profile_delete') then create policy asc_athletes_profile_delete on public.asc_athletes for delete to anon,authenticated using (true); end if;
end $$;
