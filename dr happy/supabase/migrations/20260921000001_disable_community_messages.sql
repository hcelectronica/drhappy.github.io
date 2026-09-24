-- Comunidad retirada temporalmente: impide nuevos mensajes mientras la función está fuera de la app.
REVOKE ALL ON TABLE public.community_messages FROM anon, authenticated;
ALTER TABLE public.community_messages ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "mensajes de la comunidad" ON public.community_messages;
