create extension if not exists pgcrypto;

create table if not exists public.asc_invoices (
  id uuid primary key default gen_random_uuid(),
  legacy_id text not null unique,
  athlete_id text,
  athlete_name text,
  invoice_type text,
  title text,
  amount numeric not null default 0,
  due_date date,
  status text,
  description text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz,
  data jsonb not null default '{}'::jsonb
);

alter table public.asc_invoices add column if not exists legacy_id text;
alter table public.asc_invoices add column if not exists deleted_at timestamptz;
alter table public.asc_invoices add column if not exists updated_at timestamptz default now();
alter table public.asc_invoices add column if not exists data jsonb not null default '{}'::jsonb;
create unique index if not exists asc_invoices_legacy_id_uidx on public.asc_invoices(legacy_id);
create index if not exists asc_invoices_active_idx on public.asc_invoices(legacy_id) where deleted_at is null;

do $$
declare
  source_payload jsonb;
begin
  if to_regclass('public.class_app_data_backup') is not null then
    execute $query$
      select payload from public.class_app_data_backup
       where class_id=$1
         and jsonb_typeof(payload->'invoices')='array'
         and jsonb_array_length(payload->'invoices')>0
       limit 1
    $query$ into source_payload using 'aqilah-swimming-club';
  end if;

  if source_payload is null and to_regclass('public.class_app_data') is not null then
    execute $query$
      select payload from public.class_app_data
       where class_id=$1
         and jsonb_typeof(payload->'invoices')='array'
         and jsonb_array_length(payload->'invoices')>0
       limit 1
    $query$ into source_payload using 'aqilah-swimming-club';
  end if;

  if source_payload is null then
    raise notice 'Tidak ada data tagihan legacy untuk dipulihkan.';
    return;
  end if;

  insert into public.asc_invoices(legacy_id,athlete_id,athlete_name,invoice_type,title,amount,due_date,status,description,created_at,updated_at,deleted_at,data)
  select
    invoice->>'id', invoice->>'athleteId', invoice->>'athleteName', invoice->>'type',
    invoice->>'title', coalesce(nullif(invoice->>'amount','')::numeric,0),
    case when invoice->>'dueDate' ~ '^\d{4}-\d{2}-\d{2}$' then (invoice->>'dueDate')::date end,
    coalesce(nullif(invoice->>'status',''),'unpaid'), invoice->>'description',
    coalesce(nullif(invoice->>'createdAt','')::timestamptz,now()), now(), null, invoice
  from jsonb_array_elements(source_payload->'invoices') invoice
  where nullif(invoice->>'id','') is not null
    and nullif(invoice->>'deletedAt','') is null
    and not coalesce((source_payload->'__tombstones'->'invoices') ? (invoice->>'id'),false)
  on conflict do nothing;
end $$;

alter table public.asc_invoices enable row level security;
grant select,insert,update,delete on public.asc_invoices to anon,authenticated;
do $$ begin
  if not exists(select 1 from pg_policies where schemaname='public' and tablename='asc_invoices' and policyname='asc_invoices_select') then create policy asc_invoices_select on public.asc_invoices for select to anon,authenticated using(true); end if;
  if not exists(select 1 from pg_policies where schemaname='public' and tablename='asc_invoices' and policyname='asc_invoices_insert') then create policy asc_invoices_insert on public.asc_invoices for insert to anon,authenticated with check(true); end if;
  if not exists(select 1 from pg_policies where schemaname='public' and tablename='asc_invoices' and policyname='asc_invoices_update') then create policy asc_invoices_update on public.asc_invoices for update to anon,authenticated using(true) with check(true); end if;
  if not exists(select 1 from pg_policies where schemaname='public' and tablename='asc_invoices' and policyname='asc_invoices_delete') then create policy asc_invoices_delete on public.asc_invoices for delete to anon,authenticated using(true); end if;
end $$;
