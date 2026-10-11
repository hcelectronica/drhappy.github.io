ALTER TABLE public.subscription_payments
  ADD COLUMN admin_notice_sent_at timestamptz,
  ADD COLUMN admin_notice_claimed_at timestamptz,
  ADD COLUMN admin_notice_attempts integer NOT NULL DEFAULT 0 CHECK (admin_notice_attempts >= 0),
  ADD COLUMN admin_notice_last_error text;

CREATE FUNCTION public.claim_subscription_payment_notice(p_payment_id text)
RETURNS boolean
LANGUAGE plpgsql
SET search_path = public
AS $$
DECLARE
  v_claimed integer;
BEGIN
  UPDATE public.subscription_payments
  SET admin_notice_claimed_at = now(),
      admin_notice_attempts = admin_notice_attempts + 1
  WHERE payment_id = p_payment_id
    AND admin_notice_sent_at IS NULL
    AND (admin_notice_claimed_at IS NULL OR admin_notice_claimed_at < now() - interval '10 minutes');
  GET DIAGNOSTICS v_claimed = ROW_COUNT;
  RETURN v_claimed = 1;
END;
$$;

CREATE FUNCTION public.complete_subscription_payment_notice(
  p_payment_id text,
  p_succeeded boolean,
  p_error text DEFAULT NULL
)
RETURNS boolean
LANGUAGE plpgsql
SET search_path = public
AS $$
DECLARE
  v_updated integer;
BEGIN
  UPDATE public.subscription_payments
  SET admin_notice_sent_at = CASE WHEN p_succeeded THEN COALESCE(admin_notice_sent_at, now()) ELSE admin_notice_sent_at END,
      admin_notice_last_error = CASE WHEN p_succeeded THEN NULL ELSE left(COALESCE(p_error, 'No se pudo enviar el aviso.'), 1000) END,
      admin_notice_claimed_at = NULL
  WHERE payment_id = p_payment_id
    AND admin_notice_claimed_at IS NOT NULL
    AND admin_notice_sent_at IS NULL;
  GET DIAGNOSTICS v_updated = ROW_COUNT;
  RETURN v_updated = 1;
END;
$$;

REVOKE ALL ON FUNCTION public.claim_subscription_payment_notice(text),
  public.complete_subscription_payment_notice(text, boolean, text)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.claim_subscription_payment_notice(text),
  public.complete_subscription_payment_notice(text, boolean, text)
  TO service_role;
