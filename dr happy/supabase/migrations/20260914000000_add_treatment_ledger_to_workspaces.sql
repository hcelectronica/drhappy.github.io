-- Balance de pagos (odontología): sincroniza la planilla de intervenciones,
-- cobros y saldos pendientes junto al resto del workspace del profesional.
-- Antes vivía solo en localStorage y se perdía al cambiar de dispositivo.
alter table public.user_workspaces
  add column if not exists treatment_ledger_json jsonb not null default '[]'::jsonb;
