ALTER TABLE public.patient_accounts
  ADD COLUMN IF NOT EXISTS referring_professional_id text
  REFERENCES public.professionals(id) ON DELETE SET NULL;

COMMENT ON COLUMN public.patient_accounts.referring_professional_id IS
  'Professional from the latest personalized health-folder link opened by the patient. Does not grant access to documents.';
