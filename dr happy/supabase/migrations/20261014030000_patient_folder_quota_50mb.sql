-- Cupo inicial de la Carpeta de Salud del paciente: 50 MB.
alter table public.patient_accounts alter column storage_quota_bytes set default 52428800;
update public.patient_accounts set storage_quota_bytes = 52428800 where storage_quota_bytes > 52428800;