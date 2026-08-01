-- Pemulihan Absensi yang aman dan dapat dijalankan berulang kali.
-- Backup diprioritaskan; class_app_data dipakai bila backup tidak berisi attendance.
-- Record asc_attendance yang sudah ada tidak diubah.

alter table public.asc_attendance enable row level security;

do $$
begin
  if not exists (
    select 1 from pg_policies
    where schemaname = 'public' and tablename = 'asc_attendance'
      and policyname = 'ASC attendance public read'
  ) then
    create policy "ASC attendance public read" on public.asc_attendance
      for select to anon, authenticated using (true);
  end if;

  if not exists (
    select 1 from pg_policies
    where schemaname = 'public' and tablename = 'asc_attendance'
      and policyname = 'ASC attendance public insert'
  ) then
    create policy "ASC attendance public insert" on public.asc_attendance
      for insert to anon, authenticated with check (true);
  end if;

  if not exists (
    select 1 from pg_policies
    where schemaname = 'public' and tablename = 'asc_attendance'
      and policyname = 'ASC attendance public update'
  ) then
    create policy "ASC attendance public update" on public.asc_attendance
      for update to anon, authenticated using (true) with check (true);
  end if;

  if not exists (
    select 1 from pg_policies
    where schemaname = 'public' and tablename = 'asc_attendance'
      and policyname = 'ASC attendance public delete'
  ) then
    create policy "ASC attendance public delete" on public.asc_attendance
      for delete to anon, authenticated using (true);
  end if;
end
$$;

do $$
declare
  source_payload jsonb;
begin
  if to_regclass('public.class_app_data_backup') is not null then
    execute $query$
      select payload
      from public.class_app_data_backup
      where class_id = $1
        and jsonb_typeof(payload -> 'attendance') = 'array'
        and jsonb_array_length(payload -> 'attendance') > 0
      limit 1
    $query$
    into source_payload
    using 'aqilah-swimming-club';
  end if;

  if source_payload is null then
    select payload
      into source_payload
      from public.class_app_data
     where class_id = 'aqilah-swimming-club'
       and jsonb_typeof(payload -> 'attendance') = 'array'
       and jsonb_array_length(payload -> 'attendance') > 0
     limit 1;
  end if;

  if source_payload is null then
    raise notice 'Tidak ada array attendance berisi data pada backup maupun class_app_data.';
    return;
  end if;

  insert into public.asc_attendance (
    legacy_id,
    attendance_date,
    status,
    notes,
    data,
    deleted_at,
    updated_at
  )
  select
    attendance ->> 'id',
    case when attendance ->> 'date' ~ '^\d{4}-\d{2}-\d{2}$' then (attendance ->> 'date')::date else null end,
    nullif(attendance ->> 'status', ''),
    coalesce(nullif(attendance ->> 'note', ''), nullif(attendance ->> 'notes', '')),
    attendance,
    null,
    now()
  from jsonb_array_elements(source_payload -> 'attendance') as attendance
  where nullif(attendance ->> 'id', '') is not null
  on conflict (legacy_id) do nothing;

  raise notice 'Pemulihan Absensi selesai. Record lama yang sudah ada tetap dipertahankan.';
end
$$;
