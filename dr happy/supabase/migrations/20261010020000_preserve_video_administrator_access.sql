BEGIN;
CREATE OR REPLACE FUNCTION public.has_medical_tool_access(p_professional_id text, p_modules text[] DEFAULT ARRAY['attention']::text[])
RETURNS boolean
LANGUAGE sql
SECURITY DEFINER
SET search_path = ''
AS $$
  SELECT COALESCE((
    SELECT p.active IS DISTINCT FROM false
      AND (
        p.is_admin IS TRUE OR (
          lower(COALESCE(p.specialty, '')) NOT LIKE '%odont%'
          AND translate(lower(p.specialty), 'áéíóú', 'aeiou') LIKE '%medic%'
          AND CASE WHEN p.enabled_modules_json IS NULL THEN true
            WHEN jsonb_typeof(p.enabled_modules_json) = 'array'
              THEN p.enabled_modules_json ?& p_modules
            ELSE false END
          AND (
            (p.subscription_status = 'active'
              AND (p.subscription_expires_at IS NULL OR p.subscription_expires_at > clock_timestamp()))
            OR ((p.subscription_status IS NULL OR p.subscription_status = 'trial')
              AND p.trial_started_at <= clock_timestamp()
              AND p.trial_started_at + interval '7 days' > clock_timestamp())
          )
        )
      )
    FROM public.professionals p WHERE p.id = p_professional_id
  ), false)
$$;
COMMIT;
