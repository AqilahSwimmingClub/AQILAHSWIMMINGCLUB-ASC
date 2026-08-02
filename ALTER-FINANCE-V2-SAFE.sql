create extension if not exists pgcrypto;

create table if not exists public.asc_finance_transactions (
  id uuid primary key default gen_random_uuid(), legacy_id text unique,
  transaction_number text unique, reference_id text, reference_type text,
  direction text not null check(direction in ('income','expense')), category text,
  amount numeric not null default 0, description text, transaction_date timestamptz default now(),
  proof_url text, created_by text, created_role text, created_device text,
  created_at timestamptz not null default now(), updated_at timestamptz not null default now(),
  deleted_at timestamptz, data jsonb not null default '{}'::jsonb
);
alter table public.asc_finance_transactions add column if not exists transaction_number text;
alter table public.asc_finance_transactions add column if not exists created_role text;
alter table public.asc_finance_transactions add column if not exists created_device text;
alter table public.asc_finance_transactions add column if not exists updated_at timestamptz default now();
alter table public.asc_finance_transactions add column if not exists deleted_at timestamptz;
create unique index if not exists asc_finance_transaction_number_uidx on public.asc_finance_transactions(transaction_number) where transaction_number is not null;
create unique index if not exists asc_finance_reference_v2_uidx on public.asc_finance_transactions(reference_type,reference_id,direction) where reference_type is not null and reference_id is not null;
create index if not exists asc_finance_date_v2_idx on public.asc_finance_transactions(transaction_date desc) where deleted_at is null;
create index if not exists asc_finance_category_v2_idx on public.asc_finance_transactions(category) where deleted_at is null;

create or replace function public.asc_assign_finance_transaction_number()
returns trigger language plpgsql as $$
declare prefix text; next_number integer;
begin
  if new.transaction_number is not null and new.transaction_number<>'' then return new; end if;
  prefix:='TRX-'||to_char(coalesce(new.transaction_date,now()) at time zone 'Asia/Jakarta','YYYYMMDD')||'-';
  perform pg_advisory_xact_lock(hashtext(prefix));
  select coalesce(max(substring(transaction_number from 14 for 6)::integer),0)+1 into next_number
    from public.asc_finance_transactions where transaction_number like prefix||'%';
  new.transaction_number:=prefix||lpad(next_number::text,6,'0');
  return new;
end $$;
do $$ begin
  if not exists(select 1 from pg_trigger where tgname='asc_finance_assign_number') then
    create trigger asc_finance_assign_number before insert on public.asc_finance_transactions
    for each row execute function public.asc_assign_finance_transaction_number();
  end if;
end $$;

update public.asc_finance_transactions
set transaction_number='TRX-'||to_char(coalesce(transaction_date,created_at,now()) at time zone 'Asia/Jakarta','YYYYMMDD')||'-'||lpad(row_number_text,6,'0')
from (
  select id,row_number() over(partition by to_char(coalesce(transaction_date,created_at,now()) at time zone 'Asia/Jakarta','YYYYMMDD') order by coalesce(transaction_date,created_at),id)::text row_number_text
  from public.asc_finance_transactions where transaction_number is null
) numbered where asc_finance_transactions.id=numbered.id and asc_finance_transactions.transaction_number is null;

alter table public.asc_finance_transactions enable row level security;
grant select,insert,update,delete on public.asc_finance_transactions to anon,authenticated;
do $$ begin
  if not exists(select 1 from pg_policies where schemaname='public' and tablename='asc_finance_transactions' and policyname='asc_finance_v2_select') then create policy asc_finance_v2_select on public.asc_finance_transactions for select to anon,authenticated using(true); end if;
  if not exists(select 1 from pg_policies where schemaname='public' and tablename='asc_finance_transactions' and policyname='asc_finance_v2_insert') then create policy asc_finance_v2_insert on public.asc_finance_transactions for insert to anon,authenticated with check(true); end if;
  if not exists(select 1 from pg_policies where schemaname='public' and tablename='asc_finance_transactions' and policyname='asc_finance_v2_update') then create policy asc_finance_v2_update on public.asc_finance_transactions for update to anon,authenticated using(true) with check(true); end if;
  if not exists(select 1 from pg_policies where schemaname='public' and tablename='asc_finance_transactions' and policyname='asc_finance_v2_delete') then create policy asc_finance_v2_delete on public.asc_finance_transactions for delete to anon,authenticated using(true); end if;
end $$;
