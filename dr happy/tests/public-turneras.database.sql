BEGIN;
DO $$
DECLARE
  v_id TEXT := gen_random_uuid()::text;
  v_date DATE := (NOW() AT TIME ZONE 'America/Argentina/Buenos_Aires')::date + 1;
  v_blocks JSONB := '[
    {"id":"ioma","label":"IOMA","modality":"coverage","days":[0,1,2,3,4,5,6],"startTime":"09:00","endTime":"12:00","durationMinutes":45,"slotCount":4,"dailyQuota":1},
    {"id":"pami","label":"PAMI","modality":"coverage","days":[0,1,2,3,4,5,6],"startTime":"09:00","endTime":"12:00","durationMinutes":30,"slotCount":6,"dailyQuota":6},
    {"id":"paid","label":"Particular","modality":"private","amountToCharge":5000,"days":[0,1,2,3,4,5,6],"startTime":"09:00","endTime":"12:00","durationMinutes":60,"slotCount":3,"dailyQuota":3},
    {"id":"paused","label":"Pausada","enabled":false,"modality":"coverage","days":[0,1,2,3,4,5,6],"startTime":"09:00","endTime":"12:00","durationMinutes":30,"slotCount":6}
  ]'::jsonb;
  v_base JSONB;
  v_request JSONB;
  v_result JSONB;
  v_appointment JSONB;
BEGIN
  IF has_function_privilege('anon', 'public.reserve_public_booking(jsonb,jsonb)', 'EXECUTE')
    OR has_function_privilege('authenticated', 'public.reserve_public_booking(jsonb,jsonb)', 'EXECUTE') THEN
    RAISE EXCEPTION 'Reservation RPC must be service-role only';
  END IF;
  INSERT INTO public.professionals(id, username, full_name, specialty, license_number, email)
    VALUES(v_id, 'fixture-' || v_id, 'Fixture', 'Test', 'TEST', v_id || '@example.invalid');
  INSERT INTO public.public_booking_profiles(professional_id,slug,enabled,professional_name,availability_blocks)
    VALUES(v_id, 'fixture-' || v_id, true, 'Fixture', v_blocks);
  v_base := jsonb_build_object('professional_id', v_id, 'slug', 'fixture-' || v_id,
    'slot_date', v_date::text, 'patient_name', 'Fixture', 'patient_dni', '12345678', 'patient_email', 'fixture@example.invalid', 'consultation_mode', 'presential');
  v_request := v_base || jsonb_build_object('slot_time', '09:00', 'block_id', 'ioma', 'modality', 'coverage', 'duration_minutes',45,'appointment_id','first','block_label','IOMA');
  v_appointment := jsonb_build_object('id','first','scheduledDate',v_date::text,'scheduledTime','09:00','durationMinutes',45,'publicBookingBlockId','ioma','status','confirmed');
  v_result := public.reserve_public_booking(v_request, v_appointment);
  IF v_result->>'success' <> 'true' THEN RAISE EXCEPTION 'First free booking failed: %', v_result; END IF;
  IF NOT EXISTS(SELECT 1 FROM public.user_workspaces WHERE user_id=v_id AND appointments_json @> jsonb_build_array(v_appointment)) THEN
    RAISE EXCEPTION 'Free appointment was not saved atomically';
  END IF;
  v_request := v_base || jsonb_build_object('slot_time','09:30','block_id','pami','modality','coverage','duration_minutes',30,'appointment_id','overlap');
  v_result := public.reserve_public_booking(v_request, jsonb_build_object('id','overlap'));
  IF v_result->>'success' <> 'false' THEN RAISE EXCEPTION 'Overlapping interval accepted'; END IF;
  v_request := v_request || jsonb_build_object('slot_time','10:00','appointment_id','second');
  v_result := public.reserve_public_booking(v_request, jsonb_build_object('id','second','scheduledDate',v_date::text,'scheduledTime','10:00','durationMinutes',30,'publicBookingBlockId','pami','status','confirmed'));
  IF v_result->>'success' <> 'true' THEN RAISE EXCEPTION 'Quota from another turnera leaked: %',v_result; END IF;
  v_request := v_base || jsonb_build_object('slot_time','10:30','block_id','ioma','modality','coverage','duration_minutes',45,'appointment_id','quota');
  v_result := public.reserve_public_booking(v_request, jsonb_build_object('id','quota'));
  IF v_result->>'success' <> 'false' THEN RAISE EXCEPTION 'Daily quota exceeded'; END IF;
  v_request := v_base || jsonb_build_object('slot_time','11:00','block_id','paused','modality','coverage','duration_minutes',30,'appointment_id','paused');
  v_result := public.reserve_public_booking(v_request, jsonb_build_object('id','paused'));
  IF v_result->>'success' <> 'false' THEN RAISE EXCEPTION 'Paused turnera accepted a booking'; END IF;
  v_request := v_base || jsonb_build_object('slot_time','11:00','block_id','paid','modality','private','duration_minutes',60,'appointment_id','paid','amount_to_charge',100,'amount_concept','consulta');
  v_result := public.reserve_public_booking(v_request,NULL);
  IF v_result->>'success' <> 'false' THEN RAISE EXCEPTION 'Changed price accepted'; END IF;
  v_request := v_request || jsonb_build_object('amount_to_charge',5000,'block_label','Particular','location','Sede Centro','reason','Control');
  v_result := public.reserve_public_booking(v_request,NULL);
  IF v_result->>'success' <> 'true' THEN RAISE EXCEPTION 'Paid reservation failed: %',v_result; END IF;
  IF EXISTS(SELECT 1 FROM public.user_workspaces WHERE user_id=v_id AND appointments_json @> '[{"id":"paid"}]'::jsonb) THEN
    RAISE EXCEPTION 'Unpaid appointment prematurely confirmed';
  END IF;
  IF NOT EXISTS(SELECT 1 FROM public.public_booking_reservations WHERE professional_id=v_id AND block_id='paid' AND duration_minutes=60 AND amount_to_charge=5000 AND status='pending_payment') THEN
    RAISE EXCEPTION 'Payment snapshot missing';
  END IF;
  v_request := v_base || jsonb_build_object('slot_time','11:30','block_id','pami','modality','coverage','duration_minutes',30,'appointment_id','pending-overlap');
  v_result := public.reserve_public_booking(v_request,jsonb_build_object('id','pending-overlap'));
  IF v_result->>'success' <> 'false' THEN RAISE EXCEPTION 'Pending payment interval did not block other turneras'; END IF;
  UPDATE public.public_booking_profiles SET availability_blocks=(
    SELECT jsonb_agg(block) FROM jsonb_array_elements(v_blocks) AS block WHERE block->>'id' NOT IN ('ioma','paid')
  ) WHERE professional_id=v_id;
  IF NOT EXISTS(SELECT 1 FROM public.user_workspaces WHERE user_id=v_id AND appointments_json @> jsonb_build_array(v_appointment))
    OR NOT EXISTS(SELECT 1 FROM public.public_booking_reservations WHERE professional_id=v_id AND block_id='paid' AND status='pending_payment' AND duration_minutes=60 AND amount_to_charge=5000) THEN
    RAISE EXCEPTION 'Deleting turneras removed appointments or payment snapshots';
  END IF;
  v_result := public.reserve_public_booking(v_request,jsonb_build_object('id','pending-overlap'));
  IF v_result->>'success' <> 'false' THEN RAISE EXCEPTION 'Deleting a turnera released its pending payment interval'; END IF;
  v_result := public.reserve_public_booking(v_base || jsonb_build_object('slot_time','11:00','block_id','ioma','modality','coverage','duration_minutes',45,'appointment_id','deleted'),jsonb_build_object('id','deleted'));
  IF v_result->>'success' <> 'false' THEN RAISE EXCEPTION 'Deleted turnera accepted a booking'; END IF;
  v_result := public.reserve_public_booking(v_base || jsonb_build_object('slot_time','09:30','block_id','pami','modality','coverage','duration_minutes',30,'appointment_id','deleted-overlap'),jsonb_build_object('id','deleted-overlap'));
  IF v_result->>'success' <> 'false' THEN RAISE EXCEPTION 'Deleting a turnera released its confirmed interval'; END IF;
  UPDATE public.public_booking_reservations SET created_at=NOW()-INTERVAL '16 minutes' WHERE professional_id=v_id AND block_id='paid';
  v_result := public.reserve_public_booking(v_request,jsonb_build_object('id','pending-overlap'));
  IF v_result->>'success' <> 'true' THEN RAISE EXCEPTION 'Expired payment did not release its interval: %',v_result; END IF;
  IF (SELECT count(*) FROM public.public_booking_reservations WHERE professional_id=v_id AND status<>'cancelled') <> 3 THEN
    RAISE EXCEPTION 'Rejected reservations modified stored data';
  END IF;
END $$;
ROLLBACK;
