begin;
do $$
declare patient uuid; actor text; job uuid; other_patient uuid; file_id uuid;
begin
  select id into strict actor from professionals where lower(email)='mudimudialan@gmail.com' and is_admin;
  insert into patient_accounts(email,password_hash,full_name,dni,email_verified_at,consent_accepted_at)
    values('delete-fixture-'||gen_random_uuid()||'@example.invalid','not-a-password','Ficticio','00000000',now(),now()) returning id into patient;
  insert into patient_accounts(email,password_hash,full_name,dni,consent_accepted_at)
    values('keep-fixture-'||gen_random_uuid()||'@example.invalid','not-a-password','Conservar','00000000',now()) returning id into other_patient;
  insert into patient_documents(patient_id,title,category,mime_type,size_bytes,file_path,status)
    values(patient,'Fixture','otros','application/pdf',100,patient::text||'/fixture.pdf','ready');
  insert into patient_bp_readings(patient_id,measured_at,systolic,diastolic) values(patient,now(),120,80);
  insert into patient_glucose_readings(patient_id,measured_at,value,context,method) values(patient,now(),100,'fasting','capillary');
  insert into patient_diabetes_profiles(patient_id,treatment) values(patient,'{}');
  job := prepare_patient_account_deletion(patient,(select email from patient_accounts where id=patient),actor);
  if job is distinct from prepare_patient_account_deletion(patient,(select email from patient_accounts where id=patient),actor)
    or (select count(*) from patient_account_export_files where export_id=job) <> 1 then raise exception 'Preparation not idempotent'; end if;
  if (select active from patient_accounts where id=patient) then raise exception 'Patient not frozen'; end if;
  begin
    update patient_documents set title='Changed' where patient_id=patient;
    raise exception 'Frozen documents changed';
  exception when raise_exception then if SQLERRM='Frozen documents changed' then raise; end if; end;
  begin
    perform finish_patient_account_deletion(patient,(select email from patient_accounts where id=patient));
    raise exception 'Deleted without backup';
  exception when raise_exception then if SQLERRM='Deleted without backup' then raise; end if; end;
  select id into strict file_id from claim_patient_export_file(job);
  if exists(select 1 from claim_patient_export_file(job)) then raise exception 'Claim duplicated'; end if;
  update patient_account_export_files set status='sent' where id=file_id;
  perform finish_patient_account_deletion(patient,(select email from patient_accounts where id=patient));
  if exists(select 1 from patient_accounts where id=patient)
    or exists(select 1 from patient_documents where patient_id=patient)
    or exists(select 1 from patient_bp_readings where patient_id=patient)
    or exists(select 1 from patient_glucose_readings where patient_id=patient)
    or exists(select 1 from patient_diabetes_profiles where patient_id=patient)
    or exists(select 1 from patient_account_export_files where export_id=job) then raise exception 'Patient data remained'; end if;
  if not exists(select 1 from patient_accounts where id=other_patient) then raise exception 'Other patient deleted'; end if;
  if has_table_privilege('anon','patient_account_exports','SELECT')
    or has_table_privilege('authenticated','patient_account_export_files','UPDATE')
    or has_function_privilege('authenticated','finish_patient_account_deletion(uuid,text)','EXECUTE') then raise exception 'Deletion exposed'; end if;
end $$;
rollback;
