-- El workspace contiene pacientes, turnos, perfil y balance.
-- El acceso de la aplicación pasa por workspace-data con Service Role
-- después de validar la sesión profesional. Se cierra el acceso directo
-- de anon/authenticated para que RLS no dependa del frontend.
ALTER TABLE public.user_workspaces ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "workspace del propio usuario" ON public.user_workspaces;
REVOKE ALL ON public.user_workspaces FROM anon, authenticated;
