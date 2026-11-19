BEGIN;
DO $$
DECLARE
  v_id text := gen_random_uuid()::text;
  v_date date := (now() AT TIME ZONE 'America/Argentina/Buenos_Aires')::date + 1;
  v_blocks jsonb := '[{"id":"free","label":"Sin pago","modality":"coverage","days":[0,1,2,3,4,5,6],"startTime":"09:00","endTime":"12:00","durationMinutes":30,"slotCount":6,"dailyQuota":6},{"id":"paid","label":"Pago","modality":"private","amountToCharge":5000,"days":[0,1,2,3,4,5,6],"startTime":"09:00","endTime":"12:00","durationMinutes":30,"slotCount":6,"dailyQuota":6}]'::jsonb;
  v_base jsonb;
  v_free jsonb;
  v_result jsonb;
  v_saved jsonb;
BEGIN
  INSERT INTO public.professionals(id, username, full_name, specialty, license_number, email)
    VALUES(v_id, 'fixture-' || v_id, 'Fixture', 'Test', 'TEST', v_id || '@example.invalid');
  INSERT INTO public.public_booking_profiles(professional_id,slug,enabled,professional_name,availability_blocks)
    VALUES(v_id, 'fixture-' || v_id, true, 'Fixture', v_blocks);
  v_base := jsonb_build_object('professional_id',v_id,'slot_date',v_date::text,'patient_name','Fixture',
    'patient_dni','12345678','patient_email','fixture@example.invalid','consultation_mode','presential');
  v_free := jsonb_build_object('id','free','scheduledDate',v_date::text,'scheduledTime','09:00',
    'durationMinutes',30,'publicBookingBlockId','free','status','confirmed');
  v_result := public.reserve_public_booking(v_base || jsonb_build_object('slot_time','09:00','block_id','free',
    'modality','coverage','duration_minutes',30,'appointment_id','free'),v_free);
  IF v_result->>'success' <> 'true' THEN RAISE EXCEPTION 'Free reservation failed: %',v_result; END IF;

  PERFORM public.save_workspace_with_paid_patients(v_id, '{"profile_json":{},"patients_json":[],"appointments_json":[]}'::jsonb, '[]');
  SELECT appointments_json INTO v_saved FROM public.user_workspaces WHERE user_id=v_id;
  IF NOT v_saved @> jsonb_build_array(v_free) THEN RAISE EXCEPTION 'A stale workspace erased a free booking'; END IF;

  PERFORM public.mark_public_booking_email_sent(v_id,'free','2026-11-19T12:00:00Z');
  PERFORM public.save_workspace_with_paid_patients(v_id, jsonb_build_object('appointments_json',jsonb_build_array(v_free),
    'patients_json','[]'::jsonb,'profile_json','{}'::jsonb), '[]');
  SELECT appointments_json INTO v_saved FROM public.user_workspaces WHERE user_id=v_id;
  IF NOT v_saved @> '[{"id":"free","emailConfirmationSentAt":"2026-11-19T12:00:00Z"}]'::jsonb THEN
    RAISE EXCEPTION 'A stale workspace erased the email confirmation marker';
  END IF;
  IF NOT public.cancel_public_booking_appointment(v_id,'free') THEN RAISE EXCEPTION 'Cancellation failed'; END IF;
  PERFORM public.save_workspace_with_paid_patients(v_id, jsonb_build_object('appointments_json',jsonb_build_array(v_free),
    'patients_json','[]'::jsonb,'profile_json','{}'::jsonb), '[]');
  SELECT appointments_json INTO v_saved FROM public.user_workspaces WHERE user_id=v_id;
  IF v_saved @> '[{"id":"free"}]'::jsonb THEN RAISE EXCEPTION 'A stale workspace resurrected a cancelled public booking'; END IF;

  v_result := public.reserve_public_booking(v_base || jsonb_build_object('slot_time','10:00','block_id','paid',
    'modality','private','duration_minutes',30,'appointment_id','paid','amount_to_charge',5000,'amount_concept','consulta'),NULL);
  IF v_result->>'success' <> 'true' THEN RAISE EXCEPTION 'Paid reservation failed: %',v_result; END IF;
  PERFORM public.save_workspace_with_paid_patients(v_id, '{"profile_json":{},"patients_json":[],"appointments_json":[]}'::jsonb, '[]');
  SELECT appointments_json INTO v_saved FROM public.user_workspaces WHERE user_id=v_id;
  IF v_saved @> '[{"id":"paid"}]'::jsonb THEN RAISE EXCEPTION 'Unpaid booking was confirmed'; END IF;
  IF NOT public.confirm_paid_public_booking(v_id,'paid',jsonb_build_object('id','patient','dni','12345678'),
    jsonb_build_object('id','paid','scheduledDate',v_date::text,'scheduledTime','10:00','status','confirmed','paymentStatus','approved','paymentId','payment'),
    jsonb_build_object('id','ledger')) THEN RAISE EXCEPTION 'Approved payment not confirmed'; END IF;
  PERFORM public.save_workspace_with_paid_patients(v_id, '{"profile_json":{},"patients_json":[],"appointments_json":[]}'::jsonb, '[]');
  SELECT appointments_json INTO v_saved FROM public.user_workspaces WHERE user_id=v_id;
  IF NOT v_saved @> '[{"id":"paid","status":"confirmed","paymentStatus":"approved"}]'::jsonb THEN
    RAISE EXCEPTION 'A stale workspace erased an approved paid booking';
  END IF;
  PERFORM public.save_workspace_with_paid_patients(v_id,
    jsonb_build_object('appointments_json','[{"id":"paid","status":"pending","paymentStatus":"pending"}]'::jsonb,
      'patients_json','[]'::jsonb,'profile_json','{}'::jsonb), '[]');
  SELECT appointments_json INTO v_saved FROM public.user_workspaces WHERE user_id=v_id;
  IF NOT v_saved @> '[{"id":"paid","status":"confirmed","paymentStatus":"approved","paymentId":"payment"}]'::jsonb THEN
    RAISE EXCEPTION 'A stale workspace reverted an approved payment';
  END IF;
END $$;
ROLLBACK;
