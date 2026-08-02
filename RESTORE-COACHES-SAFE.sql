create table if not exists public.asc_coaches (id uuid not null default gen_random_uuid(), legacy_id text primary key, data jsonb not null default '{}'::jsonb, deleted_at timestamptz, updated_at timestamptz not null default now());
alter table public.asc_coaches add column if not exists id uuid default gen_random_uuid();
create unique index if not exists asc_coaches_id_uidx on public.asc_coaches(id);
alter table public.asc_coaches enable row level security;
grant select,insert,update,delete on public.asc_coaches to anon,authenticated;
do $$ begin
 if not exists(select 1 from pg_policies where schemaname='public' and tablename='asc_coaches' and policyname='ASC coaches read') then create policy "ASC coaches read" on public.asc_coaches for select to anon,authenticated using(true); end if;
 if not exists(select 1 from pg_policies where schemaname='public' and tablename='asc_coaches' and policyname='ASC coaches insert') then create policy "ASC coaches insert" on public.asc_coaches for insert to anon,authenticated with check(true); end if;
 if not exists(select 1 from pg_policies where schemaname='public' and tablename='asc_coaches' and policyname='ASC coaches update') then create policy "ASC coaches update" on public.asc_coaches for update to anon,authenticated using(true) with check(true); end if;
 if not exists(select 1 from pg_policies where schemaname='public' and tablename='asc_coaches' and policyname='ASC coaches delete') then create policy "ASC coaches delete" on public.asc_coaches for delete to anon,authenticated using(true); end if;
end $$;
do $$ declare p jsonb; begin if to_regclass('public.class_app_data_backup') is not null then execute 'select payload from public.class_app_data_backup where class_id=$1 and jsonb_array_length(coalesce(payload->''coaches'',''[]''::jsonb))>0 limit 1' into p using 'aqilah-swimming-club'; end if; if p is null then select payload into p from public.class_app_data where class_id='aqilah-swimming-club' and jsonb_array_length(coalesce(payload->'coaches','[]'::jsonb))>0 limit 1; end if; insert into public.asc_coaches(legacy_id,data,deleted_at,updated_at) select x->>'id',x,null,now() from jsonb_array_elements(coalesce(p->'coaches','[]'::jsonb)) x where nullif(x->>'id','') is not null on conflict(legacy_id) do nothing; end $$;
