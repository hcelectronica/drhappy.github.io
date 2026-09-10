-- Módulos habilitados por usuario (control comercial/visual desde el panel de admin).
-- NULL = todos los módulos habilitados, para no alterar a los usuarios existentes.
alter table public.professionals
  add column if not exists enabled_modules_json jsonb;

comment on column public.professionals.enabled_modules_json is
  'Lista de módulos visibles para el profesional (attention, appointments, tools, ambulance, community). NULL = todos habilitados.';
