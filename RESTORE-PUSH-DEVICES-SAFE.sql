create table if not exists public.asc_push_devices (device_id text, athlete_id uuid, parent_id uuid, coach_id uuid, role text, platform text, fcm_token text, last_seen timestamptz, created_at timestamptz not null default now());
alter table public.asc_push_devices add column if not exists device_id text;
alter table public.asc_push_devices add column if not exists athlete_id uuid;
alter table public.asc_push_devices add column if not exists parent_id uuid;
alter table public.asc_push_devices add column if not exists coach_id uuid;
alter table public.asc_push_devices add column if not exists role text;
alter table public.asc_push_devices add column if not exists platform text;
alter table public.asc_push_devices add column if not exists fcm_token text;
alter table public.asc_push_devices add column if not exists last_seen timestamptz;
alter table public.asc_push_devices add column if not exists created_at timestamptz default now();
create unique index if not exists asc_push_devices_device_id_uidx on public.asc_push_devices(device_id);
alter table public.asc_push_devices enable row level security;
do $$ begin
 if not exists(select 1 from pg_policies where schemaname='public' and tablename='asc_push_devices' and policyname='ASC push devices read') then create policy "ASC push devices read" on public.asc_push_devices for select to anon,authenticated using(true); end if;
 if not exists(select 1 from pg_policies where schemaname='public' and tablename='asc_push_devices' and policyname='ASC push devices insert') then create policy "ASC push devices insert" on public.asc_push_devices for insert to anon,authenticated with check(true); end if;
 if not exists(select 1 from pg_policies where schemaname='public' and tablename='asc_push_devices' and policyname='ASC push devices update') then create policy "ASC push devices update" on public.asc_push_devices for update to anon,authenticated using(true) with check(true); end if;
 if not exists(select 1 from pg_policies where schemaname='public' and tablename='asc_push_devices' and policyname='ASC push devices delete') then create policy "ASC push devices delete" on public.asc_push_devices for delete to anon,authenticated using(true); end if;
end $$;
do $$ declare p jsonb; begin
 if to_regclass('public.class_app_data_backup') is not null then execute 'select payload from public.class_app_data_backup where class_id=$1 and jsonb_array_length(coalesce(payload->''pushDevices'',''[]''::jsonb))>0 limit 1' into p using 'aqilah-swimming-club'; end if;
 if p is null then select payload into p from public.class_app_data where class_id='aqilah-swimming-club' and jsonb_array_length(coalesce(payload->'pushDevices','[]'::jsonb))>0 limit 1; end if;
 insert into public.asc_push_devices(device_id,athlete_id,parent_id,coach_id,role,platform,fcm_token,last_seen,created_at)
 select
   coalesce(nullif(x->>'device_id',''),nullif(x->>'deviceId',''),nullif(x->>'id','')),
   coalesce(
     case when coalesce(x->>'athlete_id',x->>'athleteId') ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$' then coalesce(x->>'athlete_id',x->>'athleteId')::uuid end,
     (select a.id from public.asc_athletes a where a.legacy_id=coalesce(x->>'athlete_id',x->>'athleteId') limit 1)
   ),
   case when coalesce(x->>'parent_id',x->>'parentId') ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$' then coalesce(x->>'parent_id',x->>'parentId')::uuid end,
   coalesce(
     case when coalesce(x->>'coach_id',x->>'coachId') ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$' then coalesce(x->>'coach_id',x->>'coachId')::uuid end,
     (select c.id from public.asc_coaches c where c.legacy_id=coalesce(x->>'coach_id',x->>'coachId') limit 1)
   ),
   nullif(x->>'role',''),coalesce(nullif(x->>'platform',''),'legacy'),coalesce(nullif(x->>'fcm_token',''),nullif(x->>'token','')),coalesce(nullif(x->>'last_seen','')::timestamptz,nullif(x->>'lastSeen','')::timestamptz,now()),coalesce(nullif(x->>'created_at','')::timestamptz,nullif(x->>'createdAt','')::timestamptz,now())
 from jsonb_array_elements(coalesce(p->'pushDevices','[]'::jsonb)) x
 where coalesce(nullif(x->>'device_id',''),nullif(x->>'deviceId',''),nullif(x->>'id','')) is not null
 on conflict(device_id) do update set athlete_id=coalesce(excluded.athlete_id,asc_push_devices.athlete_id),parent_id=coalesce(excluded.parent_id,asc_push_devices.parent_id),coach_id=coalesce(excluded.coach_id,asc_push_devices.coach_id),role=coalesce(excluded.role,asc_push_devices.role),platform=coalesce(excluded.platform,asc_push_devices.platform),fcm_token=coalesce(excluded.fcm_token,asc_push_devices.fcm_token),last_seen=greatest(excluded.last_seen,asc_push_devices.last_seen);
end $$;
