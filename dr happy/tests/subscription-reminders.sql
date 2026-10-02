BEGIN;
DO $test$
DECLARE
  v_id text := gen_random_uuid()::text;
  v_other_id text := gen_random_uuid()::text;
  v_expiry timestamptz;
  v_result jsonb;
  v_target date := (now() AT TIME ZONE 'America/Argentina/Buenos_Aires')::date + 1;
  v_appointments jsonb;
  v_before jsonb;
BEGIN
  INSERT INTO public.professionals(id, username, full_name, specialty, license_number, email,
    active, is_admin, subscription_status, trial_started_at)
    VALUES (v_id, 'test-' || v_id, 'Test transaccional', 'Test', 'TEST', v_id || '@example.invalid',
      true, false, 'trial', now()),
    (v_other_id, 'test-' || v_other_id, 'Test aislado', 'Test', 'TEST', v_other_id || '@example.invalid',
      true, false, 'trial', now());
  v_result := public.apply_subscription_payment(v_id, 'test-payment-' || v_id, 'monthly', 15000, now());
  ASSERT (v_result->>'applied')::boolean, 'El primer pago debe aplicarse';
  v_expiry := (v_result->>'expiresAt')::timestamptz;
  ASSERT v_expiry = now() + interval '30 days', 'Mensual debe agregar 30 días';
  v_result := public.apply_subscription_payment(v_id, 'test-payment-' || v_id, 'monthly', 15000, now());
  ASSERT NOT (v_result->>'applied')::boolean, 'Un pago repetido no debe aplicarse';
  ASSERT (v_result->>'expiresAt')::timestamptz = v_expiry, 'Un pago repetido no debe extender';
  v_result := public.apply_subscription_payment(v_id, 'test-semi-' || v_id, 'semiannual', 78000, now());
  ASSERT (v_result->>'expiresAt')::timestamptz = v_expiry + interval '180 days', 'Semestral conserva días y agrega 180';
  v_result := public.apply_subscription_payment(v_id, 'test-annual-' || v_id, 'annual', 120000, now());
  ASSERT (v_result->>'expiresAt')::timestamptz = v_expiry + interval '545 days', 'Anual agrega 365 días';
  v_result := public.subscription_account(v_id);
  ASSERT v_result->>'plan' = 'annual', 'Debe mostrar el último plan comprado';
  ASSERT jsonb_array_length(v_result->'payments') = 3, 'Historial debe tener 3 pagos únicos';
  ASSERT (public.subscription_account(v_other_id)->'usage'->>'used')::integer = 0, 'Consumo separado por profesional';

  INSERT INTO public.ai_usage_events(professional_id, model, input_tokens, output_tokens, total_tokens)
    SELECT v_id, 'test', 10, 1, 11 FROM generate_series(1,99);
  v_result := public.claim_sofia_consultation(v_id, 'test');
  ASSERT (v_result->>'allowed')::boolean, 'La consulta 100 debe permitirse';
  v_result := public.claim_sofia_consultation(v_id, 'test');
  ASSERT NOT (v_result->>'allowed')::boolean, 'La consulta 101 debe rechazarse';
  ASSERT v_result->>'reason' = 'quota', 'El rechazo debe ser por cupo';
  v_result := public.subscription_account(v_id);
  ASSERT (v_result->'usage'->>'used')::integer = 100, 'Consumo exacto de 100';
  ASSERT (v_result->'usage'->>'totalTokens')::integer = 1089, 'Tokens agregados reales';
  UPDATE public.professionals SET subscription_status = 'trial', subscription_expires_at = NULL,
    trial_started_at = now() - interval '7 days' WHERE id = v_other_id;
  ASSERT public.claim_sofia_consultation(v_other_id, 'test')->>'reason' = 'expired', 'Prueba vence al día 7';

  v_appointments := jsonb_build_array(
    jsonb_build_object('id','a','scheduledDate',v_target,'scheduledTime','08:00',
      'patientEmail','test@example.invalid','status','confirmed','createdAt',now() - interval '2 days'),
    jsonb_build_object('id','b','scheduledDate',v_target,'scheduledTime','20:00',
      'patientEmail','test@example.invalid','status','confirmed','createdAt',now() - interval '2 days'),
    jsonb_build_object('id','cancelled','scheduledDate',v_target,'scheduledTime','09:00',
      'patientEmail','test@example.invalid','status','cancelled'),
    jsonb_build_object('id','attended','scheduledDate',v_target,'scheduledTime','10:00',
      'patientEmail','test@example.invalid','status','attended'),
    jsonb_build_object('id','no-email','scheduledDate',v_target,'scheduledTime','11:00','status','confirmed'),
    jsonb_build_object('id','late','scheduledDate',v_target,'scheduledTime','12:00',
      'patientEmail','test@example.invalid','status','confirmed',
      'createdAt',((v_target - 1) + time '22:01') AT TIME ZONE 'America/Argentina/Buenos_Aires'),
    jsonb_build_object('id','wrong-day','scheduledDate',v_target + 1,'scheduledTime','13:00',
      'patientEmail','test@example.invalid','status','confirmed')
  );
  INSERT INTO public.user_workspaces(user_id, profile_json, appointments_json)
    VALUES (v_id, '{"fullName":"Test"}', v_appointments);
  ASSERT public.claim_nightly_reminder(v_id, 'a', v_target) IS NOT NULL, 'Incluye turno de mañana temprano';
  ASSERT public.claim_nightly_reminder(v_id, 'a', v_target) IS NULL, 'No duplica envíos';
  ASSERT public.claim_nightly_reminder(v_id, 'b', v_target) IS NOT NULL, 'Incluye turno de mañana tarde';
  ASSERT public.claim_nightly_reminder(v_id, 'cancelled', v_target) IS NULL, 'Excluye cancelados';
  ASSERT public.claim_nightly_reminder(v_id, 'attended', v_target) IS NULL, 'Excluye atendidos';
  ASSERT public.claim_nightly_reminder(v_id, 'no-email', v_target) IS NULL, 'Excluye sin email';
  ASSERT public.claim_nightly_reminder(v_id, 'late', v_target) IS NULL, 'Excluye reservas después del corte';
  ASSERT public.claim_nightly_reminder(v_id, 'wrong-day', v_target) IS NULL, 'Solo fecha objetivo';
  SELECT appointments_json INTO v_before FROM public.user_workspaces WHERE user_id = v_id;
  ASSERT v_before = v_appointments, 'No reescribe la agenda';
  ASSERT NOT has_function_privilege('anon', 'public.claim_sofia_consultation(text,text)', 'EXECUTE'), 'Anon no administra cupos';
  ASSERT NOT has_function_privilege('authenticated', 'public.apply_subscription_payment(text,text,text,numeric,timestamptz)', 'EXECUTE'), 'Cliente no aplica pagos';
END;
$test$;
SELECT 'Pagos, cupo 100, privacidad, prueba 7 días y recordatorios: OK' AS test_result;
ROLLBACK;
