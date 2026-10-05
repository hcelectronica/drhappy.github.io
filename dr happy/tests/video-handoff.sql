BEGIN;
DO $test$
DECLARE
  v_id text := gen_random_uuid()::text;
  v_hash text := repeat('a',64);
  v_token text := repeat('b',64);
BEGIN
  INSERT INTO public.professionals(id, username, full_name, specialty, license_number, email, active, is_admin)
  VALUES (v_id, 'test-video-' || v_id, 'Video handoff test', 'Test', 'TEST', v_id || '@example.invalid', true, true);
  INSERT INTO public.professional_sessions(professional_id, token_hash, expires_at)
  VALUES (v_id, v_hash, clock_timestamp() + interval '1 hour');
  ASSERT public.issue_video_handoff(v_token, v_hash), 'Active administrator can issue a pass';
  ASSERT public.consume_video_handoff(v_token) = v_id, 'First exchange resolves issuing administrator';
  ASSERT public.consume_video_handoff(v_token) IS NULL, 'Consumed pass cannot be reused';
  ASSERT public.issue_video_handoff(v_token, v_hash);
  UPDATE public.video_handoffs SET expires_at = clock_timestamp() - interval '1 second' WHERE token_hash = v_token;
  ASSERT public.consume_video_handoff(v_token) IS NULL, 'Expired pass denied';
  ASSERT public.issue_video_handoff(v_token, v_hash);
  UPDATE public.professional_sessions SET revoked_at = clock_timestamp() WHERE token_hash = v_hash;
  ASSERT public.consume_video_handoff(v_token) IS NULL, 'Source session revoked before exchange denied';
  ASSERT NOT public.issue_video_handoff(v_token, v_hash), 'Revoked source cannot issue';
  UPDATE public.professional_sessions SET revoked_at = NULL WHERE token_hash = v_hash;
  ASSERT public.issue_video_handoff(v_token, v_hash);
  UPDATE public.professionals SET is_admin = false WHERE id = v_id;
  ASSERT public.consume_video_handoff(v_token) IS NULL, 'Lost administrative privilege denied';
  ASSERT NOT public.issue_video_handoff(v_token, v_hash), 'Non-admin cannot issue';
  UPDATE public.professionals SET is_admin = true WHERE id = v_id;
  ASSERT public.issue_video_handoff(v_token, v_hash);
  UPDATE public.professionals SET active = false WHERE id = v_id;
  ASSERT public.consume_video_handoff(v_token) IS NULL, 'Inactive administrator denied';
  UPDATE public.professionals SET active = true WHERE id = v_id;
  ASSERT public.issue_video_handoff(v_token, v_hash);
  ASSERT public.issue_video_handoff(repeat('c',64), v_hash);
  ASSERT public.consume_video_handoff(v_token) IS NULL, 'Newest pass replaces previous unused pass';
  ASSERT public.consume_video_handoff(repeat('c',64)) = v_id;
  UPDATE public.professional_sessions SET expires_at = clock_timestamp() - interval '1 second' WHERE token_hash = v_hash;
  ASSERT NOT public.issue_video_handoff(v_token, v_hash), 'Expired source session cannot issue';
  ASSERT NOT has_function_privilege('anon','public.consume_video_handoff(text)','EXECUTE');
  ASSERT NOT has_function_privilege('authenticated','public.issue_video_handoff(text,text)','EXECUTE');
  ASSERT NOT has_table_privilege('anon','public.video_handoffs','SELECT');
  ASSERT NOT has_table_privilege('authenticated','public.video_handoffs','INSERT');
END;
$test$;
ROLLBACK;
