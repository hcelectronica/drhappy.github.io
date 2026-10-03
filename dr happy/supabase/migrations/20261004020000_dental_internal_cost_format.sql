-- Format the display note without changing financial amounts stored in pesos.
CREATE OR REPLACE FUNCTION public.dental_project_ledger(p_professional_id text, p_ledger jsonb) RETURNS jsonb
LANGUAGE sql VOLATILE SET search_path = public AS $$
  SELECT COALESCE((
    SELECT jsonb_agg(item ORDER BY ordinal)
    FROM jsonb_array_elements(COALESCE(p_ledger,'[]'::jsonb)) WITH ORDINALITY a(item,ordinal)
    WHERE COALESCE(item->>'id','') NOT LIKE 'dental:%'
      AND NOT item ? 'dentalRecordPatientId' AND NOT item ? 'dentalTreatmentId'
  ),'[]'::jsonb) || COALESCE((
    SELECT jsonb_agg(jsonb_build_object(
      'id','dental:' || r.patient_id || ':' || (t->>'id'),
      'patientId',r.patient_id,'patientName',r.record->'patient'->>'name',
      'date',COALESCE(t->>'performedDate',t->>'acceptedDate',t->>'date'),
      'intervention',t->>'work','totalAmount',(t->>'budgetCents')::numeric / 100,
      'paidAmount',COALESCE((SELECT sum((p->>'amountCents')::numeric) FROM jsonb_array_elements(r.record->'payments') p
        WHERE p->>'treatmentId' = t->>'id'),0) / 100,
      'notes','Pieza ' || (t->>'tooth') || ' · ' || (t->>'surface') || ' · Costo interno: $ ' ||
        translate(to_char((t->>'internalCostCents')::numeric / 100,'FM999,999,999,999,990.00'),'.,',',.'),
      'dentalRecordPatientId',r.patient_id,'dentalTreatmentId',t->>'id',
      'internalCost',(t->>'internalCostCents')::numeric / 100,
      'createdAt',r.created_at,'updatedAt',r.updated_at
    ) ORDER BY r.patient_id,t->>'id')
    FROM public.dental_records r CROSS JOIN LATERAL jsonb_array_elements(r.record->'treatments') t
    WHERE r.professional_id = p_professional_id AND t->>'status' IN ('accepted','completed')
  ),'[]'::jsonb);
$$;

UPDATE public.user_workspaces w
SET treatment_ledger_json = public.dental_project_ledger(w.user_id,w.treatment_ledger_json)
WHERE EXISTS (SELECT 1 FROM public.dental_records r WHERE r.professional_id = w.user_id)
  AND w.treatment_ledger_json IS DISTINCT FROM public.dental_project_ledger(w.user_id,w.treatment_ledger_json);
