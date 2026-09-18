-- Revocar permisos de administrador de la cuenta de Alan Moodie.
-- No modifica username, workspace, pacientes ni estado de suscripción.
UPDATE public.professionals
SET is_admin = false
WHERE lower(btrim(email)) = 'mudimudialan@gmail.com';
