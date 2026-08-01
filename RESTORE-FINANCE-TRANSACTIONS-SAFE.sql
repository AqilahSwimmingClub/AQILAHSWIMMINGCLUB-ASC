create extension if not exists pgcrypto;

create table if not exists public.asc_finance_transactions (
  id uuid primary key default gen_random_uuid(), legacy_id text unique,
  transaction_date timestamptz not null default now(), transaction_type text,
  category text, direction text not null check (direction in ('income','expense')),
  amount numeric not null default 0, description text, athlete_id text, athlete_name text,
  coach_id text, coach_name text, payment_id text, competition_id text,
  reference_type text, reference_id text, proof_url text, created_by text,
  created_at timestamptz not null default now(), updated_at timestamptz not null default now(),
  deleted_at timestamptz, data jsonb not null default '{}'::jsonb
);
alter table public.asc_finance_transactions add column if not exists data jsonb not null default '{}'::jsonb;
create unique index if not exists asc_finance_reference_unique
  on public.asc_finance_transactions(reference_type,reference_id,direction)
  where reference_type is not null and reference_id is not null;
create index if not exists asc_finance_active_date_idx on public.asc_finance_transactions(transaction_date) where deleted_at is null;

do $$
declare p jsonb; x jsonb;
begin
  if to_regclass('public.class_app_data_backup') is not null then
    execute 'select payload from public.class_app_data_backup where class_id=$1 and jsonb_array_length(coalesce(payload->''financeTransactions'',''[]''::jsonb))>0 limit 1' into p using 'aqilah-swimming-club';
  end if;
  if p is null and to_regclass('public.class_app_data') is not null then
    execute 'select payload from public.class_app_data where class_id=$1 and jsonb_array_length(coalesce(payload->''financeTransactions'',''[]''::jsonb))>0 limit 1' into p using 'aqilah-swimming-club';
  end if;
  for x in select value from jsonb_array_elements(coalesce(p->'financeTransactions','[]'::jsonb)) loop
    insert into public.asc_finance_transactions(legacy_id,transaction_date,transaction_type,category,direction,amount,description,athlete_id,athlete_name,coach_id,coach_name,payment_id,competition_id,reference_type,reference_id,proof_url,created_by,data)
    values(coalesce(nullif(x->>'id',''),gen_random_uuid()::text),coalesce(nullif(x->>'transactionDate','')::timestamptz,now()),x->>'transactionType',x->>'category',case when x->>'direction'='expense' then 'expense' else 'income' end,coalesce(nullif(x->>'amount','')::numeric,0),x->>'description',x->>'athleteId',x->>'athleteName',x->>'coachId',x->>'coachName',x->>'paymentId',x->>'competitionId',x->>'referenceType',x->>'referenceId',x->>'proofUrl',x->>'createdBy',x)
    on conflict (legacy_id) do update set amount=excluded.amount,description=excluded.description,updated_at=now(),data=excluded.data;
  end loop;
exception when undefined_table then null;
end $$;

alter table public.asc_finance_transactions enable row level security;
grant select,insert,update,delete on public.asc_finance_transactions to anon,authenticated;
do $$ begin
  if not exists(select 1 from pg_policies where schemaname='public' and tablename='asc_finance_transactions' and policyname='asc_finance_select') then create policy asc_finance_select on public.asc_finance_transactions for select to anon,authenticated using (true); end if;
  if not exists(select 1 from pg_policies where schemaname='public' and tablename='asc_finance_transactions' and policyname='asc_finance_insert') then create policy asc_finance_insert on public.asc_finance_transactions for insert to anon,authenticated with check (true); end if;
  if not exists(select 1 from pg_policies where schemaname='public' and tablename='asc_finance_transactions' and policyname='asc_finance_update') then create policy asc_finance_update on public.asc_finance_transactions for update to anon,authenticated using (true) with check (true); end if;
  if not exists(select 1 from pg_policies where schemaname='public' and tablename='asc_finance_transactions' and policyname='asc_finance_delete') then create policy asc_finance_delete on public.asc_finance_transactions for delete to anon,authenticated using (true); end if;
end $$;
