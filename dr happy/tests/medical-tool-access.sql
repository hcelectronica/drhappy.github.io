BEGIN;
DO $test$
DECLARE
  v_id text := gen_random_uuid()::text;
  v_hash text := repeat('d', 64);
  v_token text := repeat('e', 64);
BEGIN
  INSERT INTO public.professionals(id, username, full_name, specialty, license_number, email,
    active, is_admin, subscription_status, trial_started_at, enabled_modules_json)
  VALUES (v_id, 'test-access-' || v_id, 'Access fixture', 'Médico', 'TEST', v_id || '@example.invalid',
    true, false, 'trial', clock_timestamp() - interval '1 day', '["attention","appointments","ledger"]');
  INSERT INTO public.professional_sessions(professional_id, token_hash, expires_at)
    VALUES (v_id, v_hash, clock_timestamp() + interval '1 hour');
  ASSERT public.has_medical_tool_access(v_id, ARRAY['attention','ledger']);
  ASSERT public.issue_video_handoff(v_token, v_hash), 'Trial physician can issue';
  ASSERT public.consume_video_handoff(v_token) = v_id, 'Trial physician can exchange';
  ASSERT public.consume_video_handoff(v_token) IS NULL, 'No reuse';
  ASSERT public.issue_video_handoff(v_token, v_hash);
  UPDATE public.professionals SET specialty = 'Odontólogo' WHERE id = v_id;
  ASSERT NOT public.has_medical_tool_access(v_id), 'Dentists remain excluded';
  ASSERT public.consume_video_handoff(v_token) IS NULL, 'Profession change revokes pass';
  UPDATE public.professionals SET specialty = 'Médico', trial_started_at = clock_timestamp() - interval '7 days' WHERE id = v_id;
  ASSERT NOT public.has_medical_tool_access(v_id), 'Seven-day boundary denies';
  ASSERT NOT public.issue_video_handoff(v_token, v_hash), 'Expired trial cannot issue';
  UPDATE public.professionals SET subscription_status = 'active', subscription_expires_at = clock_timestamp() + interval '1 day' WHERE id = v_id;
  ASSERT public.has_medical_tool_access(v_id), 'Paid physician allowed';
  ASSERT public.issue_video_handoff(v_token, v_hash);
  UPDATE public.professionals SET enabled_modules_json = '[]' WHERE id = v_id;
  ASSERT public.consume_video_handoff(v_token) IS NULL, 'Module revocation denies exchange';
  ASSERT NOT public.has_medical_tool_access(v_id), 'Disabled module denies';
  UPDATE public.professionals SET enabled_modules_json = NULL, subscription_expires_at = clock_timestamp() WHERE id = v_id;
  ASSERT NOT public.has_medical_tool_access(v_id), 'Subscription expiry denies';
  UPDATE public.professionals SET is_admin = true WHERE id = v_id;
  ASSERT public.has_medical_tool_access(v_id), 'Admin preserved';
  UPDATE public.professionals SET specialty = 'Odontólogo' WHERE id = v_id;
  ASSERT public.has_medical_tool_access(v_id), 'Existing administrator privilege preserved regardless of specialty';
  UPDATE public.professionals SET active = false WHERE id = v_id;
  ASSERT NOT public.has_medical_tool_access(v_id), 'Inactive account denies';
  ASSERT NOT has_function_privilege('anon', 'public.has_medical_tool_access(text,text[])', 'EXECUTE');
  ASSERT NOT has_function_privilege('authenticated', 'public.has_medical_tool_access(text,text[])', 'EXECUTE');
END;
$test$;
ROLLBACK;
