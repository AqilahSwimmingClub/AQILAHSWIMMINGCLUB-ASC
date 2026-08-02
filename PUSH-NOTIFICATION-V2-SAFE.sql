create extension if not exists pgcrypto;

create table if not exists public.asc_push_devices (
  id uuid primary key default gen_random_uuid(), device_id text not null,
  athlete_id uuid, parent_id uuid, coach_id uuid, role text, platform text,
  fcm_token text, inactive boolean not null default false,
  last_seen timestamptz, created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(), deleted_at timestamptz
);
alter table public.asc_push_devices add column if not exists inactive boolean not null default false;
alter table public.asc_push_devices add column if not exists updated_at timestamptz not null default now();
alter table public.asc_push_devices add column if not exists deleted_at timestamptz;
create unique index if not exists asc_push_devices_device_id_v2_uidx on public.asc_push_devices(device_id);
create index if not exists asc_push_devices_role_v2_idx on public.asc_push_devices(role);
create index if not exists asc_push_devices_athlete_v2_idx on public.asc_push_devices(athlete_id);
create index if not exists asc_push_devices_coach_v2_idx on public.asc_push_devices(coach_id);
create index if not exists asc_push_devices_active_token_v2_idx on public.asc_push_devices(fcm_token) where inactive=false and deleted_at is null and fcm_token is not null;

create table if not exists public.asc_notifications (
  id uuid primary key default gen_random_uuid(), legacy_id text not null,
  recipient_role text not null, recipient_id text, athlete_id text, coach_id text,
  title text not null, message text not null, type text not null,
  reference_type text, reference_id text, deep_link text,
  created_at timestamptz not null default now(), read_at timestamptz,
  updated_at timestamptz not null default now(), deleted_at timestamptz,
  data jsonb not null default '{}'::jsonb
);
alter table public.asc_notifications add column if not exists recipient_role text;
alter table public.asc_notifications add column if not exists recipient_id text;
alter table public.asc_notifications add column if not exists athlete_id text;
alter table public.asc_notifications add column if not exists coach_id text;
alter table public.asc_notifications add column if not exists title text;
alter table public.asc_notifications add column if not exists message text;
alter table public.asc_notifications add column if not exists type text;
alter table public.asc_notifications add column if not exists reference_type text;
alter table public.asc_notifications add column if not exists reference_id text;
alter table public.asc_notifications add column if not exists deep_link text;
alter table public.asc_notifications add column if not exists created_at timestamptz not null default now();
alter table public.asc_notifications add column if not exists read_at timestamptz;
alter table public.asc_notifications add column if not exists updated_at timestamptz not null default now();
alter table public.asc_notifications add column if not exists deleted_at timestamptz;
alter table public.asc_notifications add column if not exists data jsonb not null default '{}'::jsonb;
create unique index if not exists asc_notifications_legacy_v2_uidx on public.asc_notifications(legacy_id);
create unique index if not exists asc_notifications_event_recipient_v2_uidx on public.asc_notifications(recipient_role,coalesce(recipient_id,''),type,coalesce(reference_type,''),coalesce(reference_id,''));
create index if not exists asc_notifications_recipient_role_v2_idx on public.asc_notifications(recipient_role);
create index if not exists asc_notifications_recipient_id_v2_idx on public.asc_notifications(recipient_id);
create index if not exists asc_notifications_athlete_id_v2_idx on public.asc_notifications(athlete_id);
create index if not exists asc_notifications_coach_id_v2_idx on public.asc_notifications(coach_id);
create index if not exists asc_notifications_reference_id_v2_idx on public.asc_notifications(reference_id);
create index if not exists asc_notifications_created_at_v2_idx on public.asc_notifications(created_at desc);

alter table public.asc_push_devices enable row level security;
alter table public.asc_notifications enable row level security;
grant select,insert,update,delete on public.asc_push_devices to anon,authenticated;
grant select,insert,update,delete on public.asc_notifications to anon,authenticated;
do $$ begin
 if not exists(select 1 from pg_policies where schemaname='public' and tablename='asc_push_devices' and policyname='asc_push_v2_select') then create policy asc_push_v2_select on public.asc_push_devices for select to anon,authenticated using(true); end if;
 if not exists(select 1 from pg_policies where schemaname='public' and tablename='asc_push_devices' and policyname='asc_push_v2_insert') then create policy asc_push_v2_insert on public.asc_push_devices for insert to anon,authenticated with check(true); end if;
 if not exists(select 1 from pg_policies where schemaname='public' and tablename='asc_push_devices' and policyname='asc_push_v2_update') then create policy asc_push_v2_update on public.asc_push_devices for update to anon,authenticated using(true) with check(true); end if;
 if not exists(select 1 from pg_policies where schemaname='public' and tablename='asc_push_devices' and policyname='asc_push_v2_delete') then create policy asc_push_v2_delete on public.asc_push_devices for delete to anon,authenticated using(true); end if;
 if not exists(select 1 from pg_policies where schemaname='public' and tablename='asc_notifications' and policyname='asc_notifications_v2_select') then create policy asc_notifications_v2_select on public.asc_notifications for select to anon,authenticated using(true); end if;
 if not exists(select 1 from pg_policies where schemaname='public' and tablename='asc_notifications' and policyname='asc_notifications_v2_insert') then create policy asc_notifications_v2_insert on public.asc_notifications for insert to anon,authenticated with check(true); end if;
 if not exists(select 1 from pg_policies where schemaname='public' and tablename='asc_notifications' and policyname='asc_notifications_v2_update') then create policy asc_notifications_v2_update on public.asc_notifications for update to anon,authenticated using(true) with check(true); end if;
 if not exists(select 1 from pg_policies where schemaname='public' and tablename='asc_notifications' and policyname='asc_notifications_v2_delete') then create policy asc_notifications_v2_delete on public.asc_notifications for delete to anon,authenticated using(true); end if;
end $$;
