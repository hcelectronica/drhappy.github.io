-- Carpeta de Salud: compartir estudios con médicos de Dr Happy (vinculación) o externos (link + código).

alter table public.patient_accounts add column if not exists first_name text;
alter table public.patient_accounts add column if not exists last_name text;

create table if not exists public.patient_shares (
  id uuid primary key default gen_random_uuid(),
  patient_id uuid not null references public.patient_accounts(id) on delete cascade,
  kind text not null check (kind in ('doctor', 'link')),
  professional_id text,
  token text unique,
  code_hash text,
  failed_attempts integer not null default 0,
  all_documents boolean not null default true,
  document_ids uuid[] not null default '{}',
  expires_at timestamptz,
  revoked_at timestamptz,
  imported_at timestamptz,
  last_accessed_at timestamptz,
  access_count integer not null default 0,
  created_at timestamptz not null default now(),
  constraint patient_shares_kind_fields check (
    (kind = 'doctor' and professional_id is not null)
    or (kind = 'link' and token is not null and code_hash is not null and expires_at is not null)
  )
);

create index if not exists patient_shares_patient_idx on public.patient_shares (patient_id, created_at desc);
create index if not exists patient_shares_professional_idx on public.patient_shares (professional_id) where kind = 'doctor' and revoked_at is null;
create unique index if not exists patient_shares_active_doctor_uidx
  on public.patient_shares (patient_id, professional_id) where kind = 'doctor' and revoked_at is null;

alter table public.patient_shares enable row level security;
revoke all on public.patient_shares from anon, authenticated;
grant all on public.patient_shares to service_role;
