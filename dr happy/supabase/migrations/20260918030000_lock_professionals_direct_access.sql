-- El perfil y el listado de profesionales se administran mediante
-- auth-professional, professionals-data y Edge Functions administrativas.
-- El cliente ya no necesita acceso directo a la tabla.
ALTER TABLE public.professionals ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.professionals FROM anon, authenticated;
