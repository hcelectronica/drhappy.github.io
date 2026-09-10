-- Ajuste complementario de 20260915000000.
--
-- El alta de cuentas ocurre íntegramente en la Edge Function auth-professional,
-- que usa Service Role y hashea la contraseña con bcrypt. La clave pública, por lo
-- tanto, no necesita INSERT sobre professionals: dejárselo permitía crear cuentas
-- sin contraseña que después no se pueden usar, y ensuciar la tabla.

REVOKE INSERT ON public.professionals FROM anon, authenticated;

DROP POLICY IF EXISTS "professionals alta desde registro" ON public.professionals;
