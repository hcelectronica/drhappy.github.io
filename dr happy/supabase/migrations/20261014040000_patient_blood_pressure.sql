-- Carpeta de Salud: registro domiciliario de presión arterial del paciente.
-- Los datos son del paciente; el médico los ve mientras exista un acceso compartido activo con include_pressure.

create table if not exists public.patient_bp_readings (
  id uuid primary key default gen_random_uuid(),
  patient_id uuid not null references public.patient_accounts(id) on delete cascade,
  measured_at timestamptz not null default now(),
  systolic smallint not null check (systolic between 50 and 300),
  diastolic smallint not null check (diastolic between 30 and 200),
  pulse smallint check (pulse is null or pulse between 25 and 250),
  note text check (note is null or char_length(note) <= 200),
  created_at timestamptz not null default now(),
  deleted_at timestamptz
);

create index if not exists patient_bp_readings_patient_idx
  on public.patient_bp_readings (patient_id, measured_at desc) where deleted_at is null;

alter table public.patient_bp_readings enable row level security;
revoke all on public.patient_bp_readings from anon, authenticated;
grant all on public.patient_bp_readings to service_role;

alter table public.patient_shares add column if not exists include_pressure boolean not null default true;
