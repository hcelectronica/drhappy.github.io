BEGIN;
ALTER TABLE public.paid_clinical_document_settings
  ADD COLUMN fitness_enabled boolean NOT NULL DEFAULT false,
  ADD COLUMN fitness_price numeric(12,2) NOT NULL DEFAULT 0 CHECK (fitness_price BETWEEN 0 AND 1000000),
  ADD COLUMN prescription_enabled boolean NOT NULL DEFAULT false,
  ADD COLUMN prescription_price numeric(12,2) NOT NULL DEFAULT 0 CHECK (prescription_price BETWEEN 0 AND 1000000);
ALTER TABLE public.paid_clinical_document_requests DROP CONSTRAINT paid_clinical_document_requests_service_type_check;
ALTER TABLE public.paid_clinical_document_requests ADD CONSTRAINT paid_clinical_document_requests_service_type_check
  CHECK (service_type IN ('certificate','study-order','fitness','prescription'));
COMMIT;
