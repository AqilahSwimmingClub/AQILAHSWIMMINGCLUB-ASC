create table if not exists public.asc_notifications (legacy_id text primary key, data jsonb not null default '{}'::jsonb, deleted_at timestamptz, updated_at timestamptz not null default now());
alter table public.asc_notifications enable row level security;
grant select,insert,update,delete on public.asc_notifications to anon,authenticated;
do $$ begin
 if not exists(select 1 from pg_policies where schemaname='public' and tablename='asc_notifications' and policyname='ASC notifications read') then create policy "ASC notifications read" on public.asc_notifications for select to anon,authenticated using(true); end if;
 if not exists(select 1 from pg_policies where schemaname='public' and tablename='asc_notifications' and policyname='ASC notifications insert') then create policy "ASC notifications insert" on public.asc_notifications for insert to anon,authenticated with check(true); end if;
 if not exists(select 1 from pg_policies where schemaname='public' and tablename='asc_notifications' and policyname='ASC notifications update') then create policy "ASC notifications update" on public.asc_notifications for update to anon,authenticated using(true) with check(true); end if;
 if not exists(select 1 from pg_policies where schemaname='public' and tablename='asc_notifications' and policyname='ASC notifications delete') then create policy "ASC notifications delete" on public.asc_notifications for delete to anon,authenticated using(true); end if;
end $$;
do $$ declare p jsonb; begin
 if to_regclass('public.class_app_data_backup') is not null then execute 'select payload from public.class_app_data_backup where class_id=$1 and (jsonb_array_length(coalesce(payload->''notifications'',''[]''::jsonb))+jsonb_array_length(coalesce(payload->''coachNotifications'',''[]''::jsonb)))>0 limit 1' into p using 'aqilah-swimming-club'; end if;
 if p is null then select payload into p from public.class_app_data where class_id='aqilah-swimming-club' and (jsonb_array_length(coalesce(payload->'notifications','[]'::jsonb))+jsonb_array_length(coalesce(payload->'coachNotifications','[]'::jsonb)))>0 limit 1; end if;
 insert into public.asc_notifications(legacy_id,data,deleted_at,updated_at) select x->>'id',x||jsonb_build_object('notificationAudience','admin'),null,now() from jsonb_array_elements(coalesce(p->'notifications','[]'::jsonb)) x where nullif(x->>'id','') is not null on conflict(legacy_id) do nothing;
 insert into public.asc_notifications(legacy_id,data,deleted_at,updated_at) select x->>'id',x||jsonb_build_object('notificationAudience','coach'),null,now() from jsonb_array_elements(coalesce(p->'coachNotifications','[]'::jsonb)) x where nullif(x->>'id','') is not null on conflict(legacy_id) do nothing;
end $$;
