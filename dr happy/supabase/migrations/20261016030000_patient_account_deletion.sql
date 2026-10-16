begin;
create table public.patient_account_exports (
  id uuid primary key default gen_random_uuid(),
  patient_id uuid not null unique references public.patient_accounts(id) on delete cascade,
  professional_id text not null references public.professionals(id),
  email text not null,
  created_at timestamptz not null default now()
);
create table public.patient_account_export_files (
  id uuid primary key default gen_random_uuid(),
  export_id uuid not null references public.patient_account_exports(id) on delete cascade,
  file_path text not null,
  mime_type text not null,
  title text not null,
  status text not null default 'pending' check (status in ('pending','sending','sent','failed','uncertain')),
  claimed_at timestamptz,
  unique(export_id,file_path)
);
alter table public.patient_account_exports enable row level security;
alter table public.patient_account_export_files enable row level security;
revoke all on public.patient_account_exports, public.patient_account_export_files from anon,authenticated;
grant all on public.patient_account_exports, public.patient_account_export_files to service_role;

create function public.freeze_patient_documents_during_deletion()
returns trigger language plpgsql security definer set search_path=public as $$
begin
  perform 1 from patient_accounts where id=new.patient_id for key share;
  if exists(select 1 from patient_account_exports where patient_id=new.patient_id) then
    raise exception 'Patient account deletion is in progress';
  end if;
  return new;
end $$;
create trigger patient_documents_deletion_freeze before insert or update on public.patient_documents
for each row execute function public.freeze_patient_documents_during_deletion();
revoke all on function public.freeze_patient_documents_during_deletion() from public,anon,authenticated;

create function public.prepare_patient_account_deletion(p_patient uuid,p_email text,p_actor text)
returns uuid language plpgsql security definer set search_path=public as $$
declare account patient_accounts%rowtype; job uuid;
begin
  if not exists(select 1 from professionals where id=p_actor and is_admin=true and active is distinct from false) then raise exception 'Not authorized'; end if;
  select * into strict account from patient_accounts where id=p_patient for update;
  if lower(trim(account.email)) <> lower(trim(p_email)) then raise exception 'Email confirmation mismatch'; end if;
  select id into job from patient_account_exports where patient_id=p_patient;
  if job is not null then return job; end if;
  if account.email_verified_at is null and exists(select 1 from patient_documents where patient_id=p_patient and status='ready' and deleted_at is null) then
    raise exception 'The patient must verify the destination email first';
  end if;
  update patient_accounts set active=false where id=p_patient;
  update patient_sessions set revoked_at=now() where patient_id=p_patient and revoked_at is null;
  update patient_shares set revoked_at=now() where patient_id=p_patient and revoked_at is null;
  insert into patient_email_preferences(email,opted_in,opted_out) values(lower(trim(account.email)),false,true)
    on conflict(email) do update set opted_in=false,opted_out=true,updated_at=now();
  update patient_email_recipients set status='skipped',completed_at=now() where lower(trim(email))=lower(trim(account.email)) and status='pending';
  insert into patient_account_exports(patient_id,professional_id,email) values(p_patient,p_actor,account.email) returning id into job;
  insert into patient_account_export_files(export_id,file_path,mime_type,title)
    select job,file_path,mime_type,title from patient_documents where patient_id=p_patient and status='ready' and deleted_at is null;
  return job;
end $$;

create function public.claim_patient_export_file(p_export uuid)
returns setof public.patient_account_export_files language sql security definer set search_path=public as $$
  update patient_account_export_files set status='sending',claimed_at=now()
  where id in (select id from patient_account_export_files where export_id=p_export and status='pending'
    order by id for update skip locked limit 1) returning *;
$$;

create function public.finish_patient_account_deletion(p_patient uuid,p_email text)
returns void language plpgsql security definer set search_path=public as $$
declare account patient_accounts%rowtype; job uuid;
begin
  select * into strict account from patient_accounts where id=p_patient for update;
  select id into strict job from patient_account_exports where patient_id=p_patient;
  if lower(trim(account.email)) <> lower(trim(p_email)) or account.active then raise exception 'Deletion confirmation mismatch'; end if;
  if exists(select 1 from patient_account_export_files where export_id=job and status<>'sent') then raise exception 'Backup emails are not confirmed'; end if;
  if exists(select 1 from storage.objects where bucket_id='patient-folders' and name like p_patient::text || '/%') then raise exception 'Patient files remain in storage'; end if;
  delete from patient_email_recipients where lower(trim(email))=lower(trim(account.email));
  delete from patient_email_preferences where email=lower(trim(account.email));
  delete from patient_accounts where id=p_patient;
end $$;
revoke all on function public.prepare_patient_account_deletion(uuid,text,text),public.claim_patient_export_file(uuid),
  public.finish_patient_account_deletion(uuid,text) from public,anon,authenticated;
grant execute on function public.prepare_patient_account_deletion(uuid,text,text),public.claim_patient_export_file(uuid),
  public.finish_patient_account_deletion(uuid,text) to service_role;
commit;
