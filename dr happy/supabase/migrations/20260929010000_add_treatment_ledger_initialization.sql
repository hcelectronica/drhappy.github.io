ALTER TABLE public.user_workspaces
  ADD COLUMN IF NOT EXISTS treatment_ledger_initialized BOOLEAN NOT NULL DEFAULT FALSE;

UPDATE public.user_workspaces AS workspace
SET treatment_ledger_initialized = TRUE
WHERE workspace.treatment_ledger_json <> '[]'::JSONB
   OR EXISTS (
     SELECT 1
     FROM public.professionals AS professional
     WHERE professional.id = workspace.user_id
       AND professional.is_admin = TRUE
   );