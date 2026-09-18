-- Eliminar identidades Google/Auth sin una cuenta profesional asociada.
DELETE FROM auth.users AS auth_user
WHERE auth_user.email IS NOT NULL
  AND NOT EXISTS (
    SELECT 1
    FROM public.professionals AS professional
    WHERE lower(btrim(professional.email)) = lower(btrim(auth_user.email))
  );