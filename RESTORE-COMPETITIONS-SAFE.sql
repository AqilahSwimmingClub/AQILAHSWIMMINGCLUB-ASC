create extension if not exists pgcrypto;

create table if not exists public.asc_competitions (
  id uuid primary key default gen_random_uuid(), legacy_id text not null unique,
  title text, event_date date, location text, registration_deadline date,
  organizer text, fee_per_race numeric not null default 0, flyer_url text,
  description text, created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(), deleted_at timestamptz,
  data jsonb not null default '{}'::jsonb
);
alter table public.asc_competitions add column if not exists legacy_id text;
alter table public.asc_competitions add column if not exists deleted_at timestamptz;
alter table public.asc_competitions add column if not exists updated_at timestamptz default now();
alter table public.asc_competitions add column if not exists data jsonb not null default '{}'::jsonb;
create unique index if not exists asc_competitions_legacy_id_uidx on public.asc_competitions(legacy_id);
create index if not exists asc_competitions_active_idx on public.asc_competitions(legacy_id) where deleted_at is null;

do $$
declare source_payload jsonb;
begin
  if to_regclass('public.class_app_data_backup') is not null then
    execute $query$select payload from public.class_app_data_backup where class_id=$1 and jsonb_typeof(payload->'competitions')='array' and jsonb_array_length(payload->'competitions')>0 limit 1$query$
      into source_payload using 'aqilah-swimming-club';
  end if;
  if source_payload is null and to_regclass('public.class_app_data') is not null then
    execute $query$select payload from public.class_app_data where class_id=$1 and jsonb_typeof(payload->'competitions')='array' and jsonb_array_length(payload->'competitions')>0 limit 1$query$
      into source_payload using 'aqilah-swimming-club';
  end if;
  if source_payload is null then raise notice 'Tidak ada data kompetisi legacy untuk dipulihkan.'; return; end if;

  insert into public.asc_competitions(legacy_id,title,event_date,location,registration_deadline,organizer,fee_per_race,flyer_url,description,created_at,updated_at,deleted_at,data)
  select event->>'id',event->>'title',
    case when event->>'eventDate' ~ '^\d{4}-\d{2}-\d{2}$' then (event->>'eventDate')::date end,
    event->>'location',
    case when event->>'registrationDeadline' ~ '^\d{4}-\d{2}-\d{2}$' then (event->>'registrationDeadline')::date end,
    event->>'organizer',coalesce(nullif(event->>'feePerRace','')::numeric,0),event->>'flyer',event->>'description',
    coalesce(nullif(event->>'createdAt','')::timestamptz,now()),now(),null,event
  from jsonb_array_elements(source_payload->'competitions') event
  where nullif(event->>'id','') is not null
    and nullif(event->>'deletedAt','') is null
    and not coalesce((source_payload->'__tombstones'->'competitions') ? (event->>'id'),false)
  on conflict do nothing;
end $$;

alter table public.asc_competitions enable row level security;
grant select,insert,update,delete on public.asc_competitions to anon,authenticated;
do $$ begin
  if not exists(select 1 from pg_policies where schemaname='public' and tablename='asc_competitions' and policyname='asc_competitions_select') then create policy asc_competitions_select on public.asc_competitions for select to anon,authenticated using(true); end if;
  if not exists(select 1 from pg_policies where schemaname='public' and tablename='asc_competitions' and policyname='asc_competitions_insert') then create policy asc_competitions_insert on public.asc_competitions for insert to anon,authenticated with check(true); end if;
  if not exists(select 1 from pg_policies where schemaname='public' and tablename='asc_competitions' and policyname='asc_competitions_update') then create policy asc_competitions_update on public.asc_competitions for update to anon,authenticated using(true) with check(true); end if;
  if not exists(select 1 from pg_policies where schemaname='public' and tablename='asc_competitions' and policyname='asc_competitions_delete') then create policy asc_competitions_delete on public.asc_competitions for delete to anon,authenticated using(true); end if;
end $$;
