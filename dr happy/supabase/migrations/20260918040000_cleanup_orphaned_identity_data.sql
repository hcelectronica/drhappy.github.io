-- Un usuario eliminado no debe conservar una sesión válida ni datos privados
-- accesibles mediante un token manual antiguo.
DELETE FROM public.professional_sessions
WHERE professional_id NOT IN (SELECT id FROM public.professionals);

DELETE FROM public.user_workspaces
WHERE user_id NOT IN (SELECT id FROM public.professionals);

DELETE FROM public.community_messages
WHERE sender_id NOT IN (SELECT id FROM public.professionals)
   OR recipient_id NOT IN (SELECT id FROM public.professionals);