-- supabase/migrations/20261020000004_scheduling.sql
create type appointment_status as enum ('held', 'confirmed', 'completed', 'cancelled', 'no_show');
create type appointment_source as enum ('web', 'whatsapp', 'google');

create table availability_rules (
  id uuid primary key default gen_random_uuid(),
  clinic_id uuid not null references clinics (id) on delete restrict,
  membership_id uuid not null references memberships (id) on delete restrict,
  weekday smallint not null check (weekday between 1 and 7), -- ISO: 1 = Monday ... 7 = Sunday
  start_time time not null,
  end_time time not null,
  valid_from date not null default current_date,
  valid_until date,
  created_at timestamptz not null default now(),
  check (end_time > start_time),
  check (valid_until is null or valid_until >= valid_from)
);
create index availability_rules_member_idx on availability_rules (membership_id, weekday);

create table availability_exceptions (
  id uuid primary key default gen_random_uuid(),
  clinic_id uuid not null references clinics (id) on delete restrict,
  membership_id uuid not null references memberships (id) on delete restrict,
  starts_at timestamptz not null,
  ends_at timestamptz not null,
  type text not null check (type in ('block', 'open')),
  reason text,
  created_at timestamptz not null default now(),
  check (ends_at > starts_at)
);
create index availability_exceptions_member_idx on availability_exceptions (membership_id, starts_at);

create table appointments (
  id uuid primary key default gen_random_uuid(),
  clinic_id uuid not null references clinics (id) on delete restrict,
  patient_id uuid not null references patients (id) on delete restrict,
  membership_id uuid not null references memberships (id) on delete restrict, -- the dentist
  starts_at timestamptz not null,
  ends_at timestamptz not null,
  blocking_range tstzrange generated always as (tstzrange(starts_at, ends_at, '[)')) stored,
  status appointment_status not null default 'confirmed',
  source appointment_source not null default 'web',
  reason text,
  google_event_id text,
  rescheduled_from_id uuid references appointments (id),
  created_by uuid references memberships (id),
  created_at timestamptz not null default now(),
  check (ends_at > starts_at),
  constraint appointments_no_overlap exclude using gist (
    membership_id with =, blocking_range with &&
  ) where (status in ('held', 'confirmed'))
);
-- Cache of busy blocks from a connected Google Calendar. Advisory only.
create table external_busy (
  id uuid primary key default gen_random_uuid(),
  clinic_id uuid not null references clinics (id) on delete restrict,
  membership_id uuid not null references memberships (id) on delete restrict,
  starts_at timestamptz not null,
  ends_at timestamptz not null,
  fetched_at timestamptz not null default now(),
  check (ends_at > starts_at)
);
create index external_busy_member_idx on external_busy (membership_id, starts_at);

create index appointments_clinic_start_idx on appointments (clinic_id, starts_at);
create index appointments_patient_idx on appointments (patient_id, starts_at);

alter table availability_rules enable row level security;
alter table availability_exceptions enable row level security;
alter table appointments enable row level security;
alter table external_busy enable row level security;

create policy rules_select on availability_rules for select to authenticated
  using (clinic_id in (select current_clinic_ids()));
create policy rules_write on availability_rules for insert to authenticated
  with check (is_clinic_admin(clinic_id) or membership_id in
    (select id from memberships where user_id = auth.uid()));
create policy rules_update on availability_rules for update to authenticated
  using (is_clinic_admin(clinic_id) or membership_id in
    (select id from memberships where user_id = auth.uid()))
  with check (clinic_id in (select current_clinic_ids()));

create policy exceptions_select on availability_exceptions for select to authenticated
  using (clinic_id in (select current_clinic_ids()));
create policy exceptions_write on availability_exceptions for insert to authenticated
  with check (is_clinic_admin(clinic_id) or membership_id in
    (select id from memberships where user_id = auth.uid()));
create policy exceptions_update on availability_exceptions for update to authenticated
  using (is_clinic_admin(clinic_id) or membership_id in
    (select id from memberships where user_id = auth.uid()))
  with check (clinic_id in (select current_clinic_ids()));

create policy external_busy_select on external_busy for select to authenticated
  using (clinic_id in (select current_clinic_ids()));

create policy appointments_select on appointments for select to authenticated
  using (clinic_id in (select current_clinic_ids()));
create policy appointments_insert on appointments for insert to authenticated
  with check (clinic_id in (select current_clinic_ids()));
create policy appointments_update on appointments for update to authenticated
  using (clinic_id in (select current_clinic_ids()))
  with check (clinic_id in (select current_clinic_ids()));
