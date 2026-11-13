BEGIN;

CREATE TABLE public.professional_public_aliases (
  alias TEXT PRIMARY KEY CHECK (alias ~ '^[a-z0-9]([a-z0-9-]{0,22}[a-z0-9])?$'),
  professional_id TEXT NOT NULL REFERENCES public.professionals(id) ON DELETE CASCADE,
  is_primary BOOLEAN NOT NULL DEFAULT true,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE UNIQUE INDEX professional_public_aliases_primary_owner
  ON public.professional_public_aliases(professional_id) WHERE is_primary;
CREATE INDEX professional_public_aliases_owner ON public.professional_public_aliases(professional_id);
ALTER TABLE public.professional_public_aliases ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.professional_public_aliases FROM PUBLIC, anon, authenticated;
GRANT ALL ON public.professional_public_aliases TO service_role;

-- A short address must never take over another owner's existing public URL.
CREATE FUNCTION public.guard_professional_public_alias()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  PERFORM pg_advisory_xact_lock(hashtextextended('public-alias:' || NEW.alias, 0));
  IF EXISTS (SELECT 1 FROM public.patient_receptions WHERE slug = NEW.alias AND professional_id <> NEW.professional_id)
    OR EXISTS (SELECT 1 FROM public.public_booking_profiles WHERE slug = NEW.alias AND professional_id <> NEW.professional_id)
    OR EXISTS (SELECT 1 FROM public.paid_clinical_document_settings WHERE slug = NEW.alias AND professional_id <> NEW.professional_id)
    OR EXISTS (SELECT 1 FROM public.virtual_consult_settings WHERE slug = NEW.alias AND professional_id <> NEW.professional_id)
    OR EXISTS (SELECT 1 FROM public.patient_invite_links WHERE token = NEW.alias AND professional_id <> NEW.professional_id)
  THEN
    RAISE EXCEPTION 'Public alias already in use' USING ERRCODE = '23505';
  END IF;
  RETURN NEW;
END;
$$;
CREATE TRIGGER guard_professional_public_alias
  BEFORE INSERT OR UPDATE ON public.professional_public_aliases
  FOR EACH ROW EXECUTE FUNCTION public.guard_professional_public_alias();

CREATE FUNCTION public.claim_professional_public_alias(p_professional_id TEXT, p_alias TEXT)
RETURNS TEXT LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_owner TEXT;
BEGIN
  IF p_alias IS NULL OR p_alias !~ '^[a-z0-9]([a-z0-9-]{0,22}[a-z0-9])?$' THEN
    RAISE EXCEPTION 'Invalid public alias' USING ERRCODE = '23514';
  END IF;
  PERFORM pg_advisory_xact_lock(hashtextextended('public-owner:' || p_professional_id, 0));
  PERFORM pg_advisory_xact_lock(hashtextextended('public-alias:' || p_alias, 0));
  SELECT professional_id INTO v_owner FROM public.professional_public_aliases WHERE alias = p_alias;
  IF v_owner IS NOT NULL AND v_owner <> p_professional_id THEN
    RAISE EXCEPTION 'Public alias already in use' USING ERRCODE = '23505';
  END IF;
  UPDATE public.professional_public_aliases SET is_primary = false
    WHERE professional_id = p_professional_id AND is_primary AND alias <> p_alias;
  INSERT INTO public.professional_public_aliases(alias, professional_id, is_primary)
    VALUES (p_alias, p_professional_id, true)
    ON CONFLICT (alias) DO UPDATE SET is_primary = true;
  RETURN p_alias;
END;
$$;

CREATE FUNCTION public.ensure_professional_public_alias(p_professional_id TEXT)
RETURNS TEXT LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_alias TEXT; v_name TEXT; v_candidate TEXT; v_suffix TEXT; v_attempt INTEGER;
BEGIN
  PERFORM pg_advisory_xact_lock(hashtextextended('public-owner:' || p_professional_id, 0));
  SELECT alias INTO v_alias FROM public.professional_public_aliases
    WHERE professional_id = p_professional_id AND is_primary;
  IF v_alias IS NOT NULL THEN RETURN v_alias; END IF;
  SELECT slug INTO v_alias FROM public.patient_receptions WHERE professional_id = p_professional_id;
  IF v_alias IS NOT NULL THEN
    BEGIN
      RETURN public.claim_professional_public_alias(p_professional_id, v_alias);
    EXCEPTION WHEN unique_violation THEN
      -- A pre-existing cross-tool collision is preserved, not reassigned.
      NULL;
    END;
  END IF;
  SELECT full_name INTO v_name FROM public.professionals WHERE id = p_professional_id AND active IS DISTINCT FROM false;
  IF NOT FOUND THEN RAISE EXCEPTION 'Professional unavailable'; END IF;
  v_name := lower(translate(COALESCE(v_name, ''), 'áéíóúüñÁÉÍÓÚÜÑ', 'aeiouunAEIOUUN'));
  v_name := trim(both '-' from regexp_replace(v_name, '[^a-z0-9]+', '-', 'g'));
  v_name := COALESCE(NULLIF(trim(both '-' from left(v_name, 24)), ''), 'profesional');
  FOR v_attempt IN 0..100 LOOP
    v_suffix := CASE WHEN v_attempt = 0 THEN '' ELSE '-' || v_attempt::text END;
    v_candidate := trim(trailing '-' from left(v_name, 24 - length(v_suffix))) || v_suffix;
    BEGIN
      RETURN public.claim_professional_public_alias(p_professional_id, v_candidate);
    EXCEPTION WHEN unique_violation THEN NULL;
    END;
  END LOOP;
  RAISE EXCEPTION 'No public alias available';
END;
$$;

-- Preserve old short aliases permanently; changing the primary alias never
-- changes booking profile slugs, document slugs, consult slugs or invite tokens.
CREATE FUNCTION public.sync_reception_public_alias()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF TG_OP = 'INSERT' OR NEW.slug IS DISTINCT FROM OLD.slug THEN
    PERFORM public.claim_professional_public_alias(NEW.professional_id, NEW.slug);
  END IF;
  RETURN NEW;
END;
$$;
CREATE TRIGGER sync_reception_public_alias BEFORE INSERT OR UPDATE ON public.patient_receptions
  FOR EACH ROW EXECUTE FUNCTION public.sync_reception_public_alias();

CREATE FUNCTION public.guard_legacy_public_identifier()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_identifier TEXT;
BEGIN
  v_identifier := CASE WHEN TG_TABLE_NAME = 'patient_invite_links' THEN to_jsonb(NEW)->>'token' ELSE to_jsonb(NEW)->>'slug' END;
  PERFORM pg_advisory_xact_lock(hashtextextended('public-alias:' || v_identifier, 0));
  IF EXISTS (SELECT 1 FROM public.professional_public_aliases WHERE alias = v_identifier AND professional_id <> NEW.professional_id) THEN
    RAISE EXCEPTION 'Public identifier already reserved' USING ERRCODE = '23505';
  END IF;
  RETURN NEW;
END;
$$;
CREATE TRIGGER guard_legacy_public_identifier BEFORE INSERT OR UPDATE OF slug ON public.public_booking_profiles
  FOR EACH ROW EXECUTE FUNCTION public.guard_legacy_public_identifier();
CREATE TRIGGER guard_legacy_public_identifier BEFORE INSERT OR UPDATE OF slug ON public.paid_clinical_document_settings
  FOR EACH ROW EXECUTE FUNCTION public.guard_legacy_public_identifier();
CREATE TRIGGER guard_legacy_public_identifier BEFORE INSERT OR UPDATE OF slug ON public.virtual_consult_settings
  FOR EACH ROW EXECUTE FUNCTION public.guard_legacy_public_identifier();
CREATE TRIGGER guard_legacy_public_identifier BEFORE INSERT OR UPDATE OF token ON public.patient_invite_links
  FOR EACH ROW EXECUTE FUNCTION public.guard_legacy_public_identifier();

-- Backfill only owners with an existing reception. No tool settings or schedules
-- are created or overwritten; other owners are assigned an alias on first use.
DO $$
DECLARE v_owner TEXT;
BEGIN
  FOR v_owner IN SELECT r.professional_id FROM public.patient_receptions r
    JOIN public.professionals p ON p.id = r.professional_id
    WHERE p.active IS DISTINCT FROM false ORDER BY r.professional_id
  LOOP
    PERFORM public.ensure_professional_public_alias(v_owner);
  END LOOP;
END;
$$;

REVOKE ALL ON FUNCTION public.claim_professional_public_alias(TEXT, TEXT),
  public.ensure_professional_public_alias(TEXT),
  public.guard_professional_public_alias(), public.sync_reception_public_alias(),
  public.guard_legacy_public_identifier() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.ensure_professional_public_alias(TEXT) TO service_role;

COMMIT;
