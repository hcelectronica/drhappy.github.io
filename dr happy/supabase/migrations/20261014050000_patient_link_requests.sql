-- Vinculación paciente ↔ médico por coincidencia de DNI (siempre con confirmación del paciente).

-- Claves buscables de los pacientes de cada profesional: 'd:<dni>' y 'e:<dni>:<email>'.
create or replace function public.workspace_patient_keys(p jsonb)
returns text[]
language sql
immutable
parallel safe
set search_path = ''
as $$
  select coalesce(array_agg(distinct k), '{}'::text[])
  from (
    select unnest(array['d:' || d, case when e <> '' then 'e:' || d || ':' || e end]) as k
    from (
      select regexp_replace(coalesce(x ->> 'dni', ''), '\D', '', 'g') as d,
             lower(btrim(coalesce(x ->> 'email', ''))) as e
      from jsonb_array_elements(case when jsonb_typeof(p) = 'array' then p else '[]'::jsonb end) as x
    ) s
    where length(d) >= 6
  ) t
  where k is not null
$$;

create index if not exists user_workspaces_patient_keys_idx
  on public.user_workspaces using gin (public.workspace_patient_keys(patients_json));

-- Profesionales que tienen agendado ese DNI; email_match indica que además coincide el email.
create or replace function public.professionals_with_patient_dni(p_dni text, p_email text default null)
returns table (professional_id text, email_match boolean)
language sql
stable
security definer
set search_path = public
as $$
  select user_id, bool_or(m)
  from (
    select w.user_id, false as m
    from public.user_workspaces w
    where public.workspace_patient_keys(w.patients_json) @> array['d:' || p_dni]
    union all
    select w.user_id, true as m
    from public.user_workspaces w
    where p_email is not null and p_email <> ''
      and public.workspace_patient_keys(w.patients_json) @> array['e:' || p_dni || ':' || lower(btrim(p_email))]
  ) s
  group by user_id
$$;

revoke all on function public.professionals_with_patient_dni(text, text) from public, anon, authenticated;
grant execute on function public.professionals_with_patient_dni(text, text) to service_role;

create table if not exists public.patient_link_requests (
  id uuid primary key default gen_random_uuid(),
  patient_id uuid not null references public.patient_accounts(id) on delete cascade,
  professional_id text not null references public.professionals(id) on delete cascade,
  source text not null check (source in ('email_match', 'doctor_request')),
  status text not null default 'pending' check (status in ('pending', 'accepted', 'declined')),
  created_at timestamptz not null default now(),
  responded_at timestamptz,
  unique (patient_id, professional_id)
);

create index if not exists patient_link_requests_professional_idx on public.patient_link_requests (professional_id);

alter table public.patient_link_requests enable row level security;
revoke all on public.patient_link_requests from anon, authenticated;
