begin;
create table public.patient_glucose_readings (
  id uuid primary key default gen_random_uuid(),
  patient_id uuid not null references public.patient_accounts(id) on delete cascade,
  measured_at timestamptz not null,
  value integer not null check (value between 1 and 1000),
  context text not null check (context in ('fasting','before_meal','after_meal','bedtime','other')),
  method text not null check (method in ('capillary','sensor','laboratory')),
  note text check (length(note) <= 300),
  created_at timestamptz not null default now(),
  deleted_at timestamptz
);
create index patient_glucose_readings_patient_time on public.patient_glucose_readings(patient_id, measured_at desc) where deleted_at is null;
create table public.patient_diabetes_profiles (
  patient_id uuid primary key references public.patient_accounts(id) on delete cascade,
  treatment jsonb not null,
  updated_at timestamptz not null default now()
);
alter table public.patient_shares add column include_glucose boolean not null default false;
alter table public.patient_glucose_readings enable row level security;
alter table public.patient_diabetes_profiles enable row level security;
revoke all on public.patient_glucose_readings, public.patient_diabetes_profiles from anon, authenticated;
grant all on public.patient_glucose_readings, public.patient_diabetes_profiles to service_role;

create or replace function public.record_patient_activity(p_patient_id uuid, p_event text, p_feature text default null)
returns void language plpgsql security definer set search_path = public as $$
declare
  day date := (now() at time zone 'America/Argentina/Buenos_Aires')::date;
begin
  if p_event not in ('heartbeat','view','game_completed','invite_clicked') or p_event is null then
    raise exception 'Invalid activity event';
  end if;
  if p_event = 'view' and (p_feature is null or p_feature not in ('home','folder','upload','pressure','glucose','memory','share','account')) then
    raise exception 'Invalid activity feature';
  end if;
  insert into patient_daily_activity(patient_id,activity_date) values(p_patient_id,day) on conflict do nothing;
  if p_event = 'heartbeat' then
    update patient_daily_activity set
      active_minutes=active_minutes+case when last_heartbeat_at >= now()-interval '90 seconds' then 1 else 0 end,
      last_heartbeat_at=now(),last_seen_at=now()
    where patient_id=p_patient_id and activity_date=day
      and (last_heartbeat_at is null or last_heartbeat_at <= now()-interval '55 seconds');
  else
    update patient_daily_activity set last_seen_at=now(),
      features=jsonb_set(features,array[case when p_event='view' then p_feature else p_event end],
        to_jsonb(coalesce((features->>case when p_event='view' then p_feature else p_event end)::int,0)+1))
    where patient_id=p_patient_id and activity_date=day;
  end if;
end $$;
revoke all on function public.record_patient_activity(uuid,text,text) from public,anon,authenticated;
grant execute on function public.record_patient_activity(uuid,text,text) to service_role;
commit;
