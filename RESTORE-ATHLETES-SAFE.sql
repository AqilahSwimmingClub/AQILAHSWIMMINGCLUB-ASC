-- Pemulihan Data Atlet yang aman dan idempoten.
-- Sumber dipilih dari class_app_data_backup terlebih dahulu. Bila backup tidak
-- tersedia atau athletes kosong, sumber beralih ke class_app_data.
-- Record asc_athletes yang sudah ada tidak diubah.

do $$
declare
  source_payload jsonb;
begin
  if to_regclass('public.class_app_data_backup') is not null then
    execute $query$
      select payload
      from public.class_app_data_backup
      where class_id = $1
        and jsonb_typeof(payload -> 'athletes') = 'array'
        and jsonb_array_length(payload -> 'athletes') > 0
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
       and jsonb_typeof(payload -> 'athletes') = 'array'
       and jsonb_array_length(payload -> 'athletes') > 0
     limit 1;
  end if;

  if source_payload is null then
    raise notice 'Tidak ada array athletes berisi data pada backup maupun class_app_data.';
    return;
  end if;

  insert into public.asc_athletes (
    legacy_id,
    name,
    birth_date,
    gender,
    category,
    age_group,
    health_notes,
    whatsapp,
    photo_url,
    birth_certificate_url,
    registration_proof_url,
    data,
    deleted_at,
    updated_at
  )
  select
    athlete ->> 'id',
    coalesce(nullif(athlete ->> 'name', ''), 'Tanpa Nama'),
    case when athlete ->> 'birth' ~ '^\d{4}-\d{2}-\d{2}$' then (athlete ->> 'birth')::date else null end,
    nullif(athlete ->> 'gender', ''),
    coalesce(nullif(athlete ->> 'classCategory', ''), nullif(athlete ->> 'category', '')),
    nullif(athlete ->> 'ageGroup', ''),
    coalesce(nullif(athlete ->> 'healthNotes', ''), nullif(athlete ->> 'healthNote', '')),
    coalesce(nullif(athlete ->> 'parentWhatsapp', ''), nullif(athlete ->> 'whatsapp', '')),
    coalesce(nullif(athlete ->> 'photo', ''), nullif(athlete ->> 'photoUrl', '')),
    coalesce(nullif(athlete ->> 'birthCertificate', ''), nullif(athlete ->> 'certificate', '')),
    coalesce(nullif(athlete ->> 'registrationProof', ''), nullif(athlete ->> 'paymentProof', '')),
    athlete,
    null,
    now()
  from jsonb_array_elements(source_payload -> 'athletes') as athlete
  where nullif(athlete ->> 'id', '') is not null
  on conflict (legacy_id) do nothing;

  raise notice 'Pemulihan selesai. Record lama yang sudah ada tetap dipertahankan.';
end
$$;
