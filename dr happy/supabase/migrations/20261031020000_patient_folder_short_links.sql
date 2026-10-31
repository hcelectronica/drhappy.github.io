ALTER TABLE public.professionals
  ADD COLUMN patient_folder_code text NOT NULL DEFAULT substr(replace(gen_random_uuid()::text, '-', ''), 1, 10)
  UNIQUE CHECK (patient_folder_code ~ '^[a-f0-9]{10}$');

COMMENT ON COLUMN public.professionals.patient_folder_code IS
  'Permanent public short-link code for health-folder invitations. Does not grant access to patient data.';
