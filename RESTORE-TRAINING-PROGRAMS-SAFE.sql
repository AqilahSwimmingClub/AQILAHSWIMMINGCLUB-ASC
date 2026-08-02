create table if not exists public.asc_training_programs (legacy_id text primary key, title text, level text, age_groups text[], program_date date, image_url text, content text, data jsonb not null default '{}'::jsonb, deleted_at timestamptz, updated_at timestamptz not null default now());
alter table public.asc_training_programs enable row level security;
grant select,insert,update,delete on public.asc_training_programs to anon,authenticated;
do $$ begin
 if not exists(select 1 from pg_policies where schemaname='public' and tablename='asc_training_programs' and policyname='ASC training programs read') then create policy "ASC training programs read" on public.asc_training_programs for select to anon,authenticated using(true); end if;
 if not exists(select 1 from pg_policies where schemaname='public' and tablename='asc_training_programs' and policyname='ASC training programs insert') then create policy "ASC training programs insert" on public.asc_training_programs for insert to anon,authenticated with check(true); end if;
 if not exists(select 1 from pg_policies where schemaname='public' and tablename='asc_training_programs' and policyname='ASC training programs update') then create policy "ASC training programs update" on public.asc_training_programs for update to anon,authenticated using(true) with check(true); end if;
 if not exists(select 1 from pg_policies where schemaname='public' and tablename='asc_training_programs' and policyname='ASC training programs delete') then create policy "ASC training programs delete" on public.asc_training_programs for delete to anon,authenticated using(true); end if;
end $$;
do $$ declare p jsonb; begin
 if to_regclass('public.class_app_data_backup') is not null then execute 'select payload from public.class_app_data_backup where class_id=$1 and jsonb_array_length(coalesce(payload->''trainingPrograms'',''[]''::jsonb))>0 limit 1' into p using 'aqilah-swimming-club'; end if;
 if p is null then select payload into p from public.class_app_data where class_id='aqilah-swimming-club' and jsonb_array_length(coalesce(payload->'trainingPrograms','[]'::jsonb))>0 limit 1; end if;
 insert into public.asc_training_programs(legacy_id,title,level,age_groups,program_date,image_url,content,data,deleted_at,updated_at)
 select
   x->>'id',
   coalesce(nullif(x->>'title',''),'Program Latihan'),
   nullif(x->>'level',''),
   case
     when jsonb_typeof(coalesce(x->'trainingGroups',x->'ageGroups'))='array'
     then array(select jsonb_array_elements_text(coalesce(x->'trainingGroups',x->'ageGroups')))
     else null
   end,
   case when x->>'date' ~ '^\d{4}-\d{2}-\d{2}$' then (x->>'date')::date end,
   coalesce(nullif(x->>'image',''),nullif(x->>'imageUrl','')),
   coalesce(nullif(x->>'details',''),nullif(x->>'content',''),nullif(x->>'description','')),
   x,
   null,
   now()
 from jsonb_array_elements(coalesce(p->'trainingPrograms','[]'::jsonb)) x
 where nullif(x->>'id','') is not null
 on conflict(legacy_id) do nothing;
end $$;
