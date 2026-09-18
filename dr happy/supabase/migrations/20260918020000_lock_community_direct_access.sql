-- La comunidad se lee y escribe por community-data con identidad validada.
-- El polling reemplaza el canal Realtime directo del frontend.
ALTER TABLE public.community_messages ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "mensajes de la comunidad" ON public.community_messages;
REVOKE ALL ON public.community_messages FROM anon, authenticated;

-- Las suscripciones push se administran por send-push-notification.
ALTER TABLE public.user_push_subscriptions ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Allow public read/write on user_push_subscriptions" ON public.user_push_subscriptions;
REVOKE ALL ON public.user_push_subscriptions FROM anon, authenticated;
