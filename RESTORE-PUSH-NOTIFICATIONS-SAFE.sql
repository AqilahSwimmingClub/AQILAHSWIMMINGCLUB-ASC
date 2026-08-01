create extension if not exists pgcrypto;
create table if not exists public.asc_push_devices (
  device_id text unique, athlete_id uuid, parent_id uuid, coach_id uuid, role text,
  platform text, fcm_token text, last_seen timestamptz, created_at timestamptz default now(),
  updated_at timestamptz, deleted_at timestamptz
);
create table if not exists public.asc_notifications (
  id uuid primary key default gen_random_uuid(), legacy_id text unique, recipient_role text,
  recipient_id text, title text, message text, type text, reference_type text, reference_id text,
  read_at timestamptz, created_at timestamptz default now(), updated_at timestamptz default now(),
  deleted_at timestamptz, data jsonb not null default '{}'::jsonb
);
alter table public.asc_push_devices add column if not exists updated_at timestamptz;
alter table public.asc_push_devices add column if not exists deleted_at timestamptz;
create unique index if not exists asc_push_devices_device_unique on public.asc_push_devices(device_id);
alter table public.asc_notifications add column if not exists recipient_role text;
alter table public.asc_notifications add column if not exists recipient_id text;
alter table public.asc_notifications add column if not exists title text;
alter table public.asc_notifications add column if not exists message text;
alter table public.asc_notifications add column if not exists type text;
alter table public.asc_notifications add column if not exists reference_type text;
alter table public.asc_notifications add column if not exists reference_id text;
alter table public.asc_notifications add column if not exists read_at timestamptz;
create unique index if not exists asc_notification_delivery_unique on public.asc_notifications(reference_type,reference_id,recipient_id,type) where reference_id is not null and recipient_id is not null;
grant select,insert,update,delete on public.asc_push_devices,public.asc_notifications to anon,authenticated;
alter table public.asc_push_devices enable row level security;
alter table public.asc_notifications enable row level security;
do $$ declare t text; op text; begin
  foreach t in array array['asc_push_devices','asc_notifications'] loop
    foreach op in array array['select','insert','update','delete'] loop
      if not exists(select 1 from pg_policies where schemaname='public' and tablename=t and policyname=t||'_'||op||'_safe') then
        execute format('create policy %I on public.%I for %s to anon,authenticated %s',t||'_'||op||'_safe',t,op,case when op='insert' then 'with check (true)' when op='update' then 'using (true) with check (true)' else 'using (true)' end);
      end if;
    end loop;
  end loop;
end $$;
