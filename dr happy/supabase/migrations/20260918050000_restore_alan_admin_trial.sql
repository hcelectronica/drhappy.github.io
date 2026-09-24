-- Restaurar explícitamente la cuenta canónica de Alan Moodie por email.
-- No modifica nombre de usuario, workspace ni pacientes.
UPDATE public.professionals
SET is_admin = true,
    subscription_status = 'trial',
    subscription_expires_at = NULL,
    trial_started_at = NOW()
WHERE lower(btrim(email)) = 'mudimudialan@gmail.com';
