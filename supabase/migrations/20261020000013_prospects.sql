-- supabase/migrations/20261020000013_prospects.sql
-- Prospect pipeline: stages, append-only history and follow-up tasks.
create type prospect_stage as enum
  ('new', 'contacted', 'appointment_booked', 'quoted', 'won', 'lost');
create type prospect_source as enum
  ('whatsapp', 'web', 'referral', 'walk_in', 'social', 'other');

create table prospects (
  id uuid primary key default gen_random_uuid(),
  clinic_id uuid not null references clinics (id) on delete restrict,
  name text not null check (length(trim(name)) > 0),
  phone_e164 text check (phone_e164 is null or phone_e164 ~ '^\+[1-9][0-9]{7,14}$'),
  email text,
  source prospect_source not null default 'other',
  interest text,
  notes text,
  stage prospect_stage not null default 'new',
  assigned_to uuid references memberships (id),
  patient_id uuid references patients (id),
  lost_reason text,
  whatsapp_opt_in boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (not whatsapp_opt_in or phone_e164 is not null),
  check (stage <> 'lost' or length(trim(coalesce(lost_reason, ''))) > 0)
);
create unique index prospects_open_phone_idx on prospects (clinic_id, phone_e164)
  where phone_e164 is not null and stage in ('new', 'contacted', 'appointment_booked', 'quoted');
create index prospects_clinic_stage_idx on prospects (clinic_id, stage);
create index prospects_patient_idx on prospects (patient_id) where patient_id is not null;

create function touch_updated_at() returns trigger language plpgsql as $$
begin
  new.updated_at = now();
  return new;
end $$;
create trigger prospects_touch before update on prospects
  for each row execute function touch_updated_at();

create table prospect_events (
  id uuid primary key default gen_random_uuid(),
  clinic_id uuid not null references clinics (id) on delete restrict,
  prospect_id uuid not null references prospects (id) on delete restrict,
  kind text not null check (kind in ('created', 'stage_change', 'note', 'contact_attempt', 'converted', 'auto')),
  body jsonb not null default '{}' check (jsonb_typeof(body) = 'object'),
  author_membership_id uuid references memberships (id),
  created_at timestamptz not null default now()
);
create index prospect_events_prospect_idx on prospect_events (prospect_id, created_at);
create trigger prospect_events_append_only before update or delete on prospect_events
  for each row execute function forbid_mutation();
revoke update on prospect_events from authenticated;

create table followup_tasks (
  id uuid primary key default gen_random_uuid(),
  clinic_id uuid not null references clinics (id) on delete restrict,
  prospect_id uuid not null references prospects (id) on delete restrict,
  due_at timestamptz not null,
  kind text not null default 'call' check (kind in ('call', 'whatsapp', 'other')),
  note text,
  status text not null default 'pending' check (status in ('pending', 'done', 'cancelled')),
  done_at timestamptz,
  assigned_to uuid references memberships (id),
  auto_key text,
  created_by uuid references memberships (id),
  created_at timestamptz not null default now(),
  unique (prospect_id, auto_key)
);
create index followup_tasks_due_idx on followup_tasks (clinic_id, due_at) where status = 'pending';

alter table prospects enable row level security;
alter table prospect_events enable row level security;
alter table followup_tasks enable row level security;

create policy prospects_select on prospects for select to authenticated
  using (clinic_id in (select current_clinic_ids()));
create policy prospects_insert on prospects for insert to authenticated
  with check (clinic_id in (select current_clinic_ids()));
create policy prospects_update on prospects for update to authenticated
  using (clinic_id in (select current_clinic_ids()))
  with check (clinic_id in (select current_clinic_ids()));
create policy prospect_events_select on prospect_events for select to authenticated
  using (clinic_id in (select current_clinic_ids()));
create policy prospect_events_insert on prospect_events for insert to authenticated
  with check (clinic_id in (select current_clinic_ids()));
create policy followup_tasks_select on followup_tasks for select to authenticated
  using (clinic_id in (select current_clinic_ids()));
create policy followup_tasks_insert on followup_tasks for insert to authenticated
  with check (clinic_id in (select current_clinic_ids()));
create policy followup_tasks_update on followup_tasks for update to authenticated
  using (clinic_id in (select current_clinic_ids()))
  with check (clinic_id in (select current_clinic_ids()));

-- Advance the stage of the linked prospect when the patient books, is quoted or accepts, and record why.
create function advance_prospect(p_clinic uuid, p_patient uuid, p_to prospect_stage, p_from prospect_stage[], p_reason text)
returns void language sql security definer set search_path = public as $$
  with upd as (
    update prospects set stage = p_to
     where clinic_id = p_clinic and patient_id = p_patient and stage = any (p_from)
    returning id, clinic_id, stage
  )
  insert into prospect_events (clinic_id, prospect_id, kind, body)
  select clinic_id, id, 'auto', jsonb_build_object('to', stage, 'reason', p_reason) from upd
$$;

create function prospects_on_appointment() returns trigger language plpgsql security definer set search_path = public as $$
begin
  perform advance_prospect(new.clinic_id, new.patient_id, 'appointment_booked', array['new', 'contacted']::prospect_stage[], 'appointment');
  return new;
end $$;
create trigger prospects_appointment after insert on appointments
  for each row execute function prospects_on_appointment();

create function prospects_on_quote() returns trigger language plpgsql security definer set search_path = public as $$
begin
  if tg_op = 'INSERT' then
    perform advance_prospect(new.clinic_id, new.patient_id, 'quoted',
      array['new', 'contacted', 'appointment_booked']::prospect_stage[], 'quote');
  elsif new.status = 'accepted' and old.status is distinct from 'accepted' then
    perform advance_prospect(new.clinic_id, new.patient_id, 'won',
      array['new', 'contacted', 'appointment_booked', 'quoted']::prospect_stage[], 'quote_accepted');
  end if;
  return new;
end $$;
create trigger prospects_quote after insert or update of status on quotes
  for each row execute function prospects_on_quote();
