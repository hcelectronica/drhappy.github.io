begin;
create table public.patient_communication_admins (
  professional_id text primary key references public.professionals(id) on delete cascade
);
insert into public.patient_communication_admins(professional_id)
select id from public.professionals where lower(email) = 'mudimudialan@gmail.com' and is_admin = true;

create table public.patient_email_preferences (
  email text primary key check (email = lower(trim(email))),
  token uuid not null unique default gen_random_uuid(),
  opted_in boolean not null default false,
  opted_out boolean not null default false,
  updated_at timestamptz not null default now()
);
create table public.patient_email_campaigns (
  id uuid primary key,
  professional_id text not null references public.professionals(id) on delete cascade,
  audience text not null check (audience in ('own','folder')),
  template text not null check (template in ('folder','virtual')),
  subject text not null check (length(subject) between 1 and 150),
  message text not null check (length(message) <= 3000),
  link text not null,
  status text not null default 'draft' check (status in ('draft','active')),
  created_at timestamptz not null default now()
);
create table public.patient_email_recipients (
  id uuid primary key default gen_random_uuid(),
  campaign_id uuid not null references public.patient_email_campaigns(id) on delete cascade,
  email text not null,
  name text not null,
  status text not null default 'pending' check (status in ('pending','sending','sent','failed','uncertain','skipped')),
  claimed_at timestamptz,
  completed_at timestamptz,
  unique(campaign_id,email)
);
create index patient_email_recipients_queue on public.patient_email_recipients(campaign_id,status);
alter table public.patient_communication_admins enable row level security;
alter table public.patient_email_preferences enable row level security;
alter table public.patient_email_campaigns enable row level security;
alter table public.patient_email_recipients enable row level security;
revoke all on public.patient_communication_admins, public.patient_email_preferences, public.patient_email_campaigns, public.patient_email_recipients from anon, authenticated;
grant all on public.patient_communication_admins, public.patient_email_preferences, public.patient_email_campaigns, public.patient_email_recipients to service_role;

create or replace function public.create_patient_email_campaign(
  p_id uuid, p_professional text, p_audience text, p_template text, p_subject text, p_message text, p_link text, p_recipients jsonb
) returns uuid language plpgsql security definer set search_path = public as $$
begin
  perform pg_advisory_xact_lock(hashtextextended(p_id::text,0));
  if exists(select 1 from patient_email_campaigns where id=p_id and professional_id=p_professional) then return p_id; end if;
  if not exists(select 1 from patient_communication_admins a join professionals p on p.id=a.professional_id
    where a.professional_id=p_professional and p.is_admin=true and p.active is distinct from false) then raise exception 'Not authorized'; end if;
  insert into patient_email_campaigns(id,professional_id,audience,template,subject,message,link)
    values(p_id,p_professional,p_audience,p_template,p_subject,p_message,p_link);
  insert into patient_email_recipients(campaign_id,email,name)
    select p_id,r.email,r.name from jsonb_to_recordset(p_recipients) as r(email text,name text);
  return p_id;
end $$;
create or replace function public.claim_patient_email_batch(p_id uuid, p_professional text)
returns setof public.patient_email_recipients language sql security definer set search_path = public as $$
  update patient_email_recipients r set status='sending',claimed_at=now()
  where r.id in (
    select q.id from patient_email_recipients q join patient_email_campaigns c on c.id=q.campaign_id
    where c.id=p_id and c.professional_id=p_professional and c.status='active' and q.status='pending'
    order by q.id for update of q skip locked limit 5
  ) returning r.*;
$$;
revoke all on function public.create_patient_email_campaign(uuid,text,text,text,text,text,text,jsonb),
  public.claim_patient_email_batch(uuid,text) from public,anon,authenticated;
grant execute on function public.create_patient_email_campaign(uuid,text,text,text,text,text,text,jsonb),
  public.claim_patient_email_batch(uuid,text) to service_role;
commit;
