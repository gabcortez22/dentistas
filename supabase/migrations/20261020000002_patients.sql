-- supabase/migrations/20261020000002_patients.sql
create type doc_type as enum ('DNI', 'CE', 'PASAPORTE', 'OTRO');
create type sex as enum ('F', 'M');

create table patients (
  id uuid primary key default gen_random_uuid(),
  clinic_id uuid not null references clinics (id) on delete restrict,
  hc_number text not null,
  doc_type doc_type not null default 'DNI',
  doc_number text not null check (length(trim(doc_number)) > 0),
  last_name text not null check (length(trim(last_name)) > 0),
  first_name text not null check (length(trim(first_name)) > 0),
  birth_date date,
  birth_place text,
  sex sex,
  marital_status text,
  education_level text,
  occupation text,
  address text,
  phone_e164 text check (phone_e164 is null or phone_e164 ~ '^\+[1-9][0-9]{7,14}$'),
  email text,
  guardian_name text,
  guardian_phone_e164 text check (guardian_phone_e164 is null or guardian_phone_e164 ~ '^\+[1-9][0-9]{7,14}$'),
  whatsapp_opt_in boolean not null default false,
  whatsapp_opt_in_at timestamptz,
  archived_at timestamptz,
  created_by uuid references memberships (id),
  created_at timestamptz not null default now(),
  unique (clinic_id, doc_type, doc_number),
  unique (clinic_id, hc_number),
  check (not whatsapp_opt_in or (phone_e164 is not null and whatsapp_opt_in_at is not null))
);
create index patients_clinic_name_idx on patients (clinic_id, last_name, first_name);
create index patients_clinic_phone_idx on patients (clinic_id, phone_e164);

alter table patients enable row level security;
create policy patients_select on patients for select to authenticated
  using (clinic_id in (select current_clinic_ids()));
create policy patients_insert on patients for insert to authenticated
  with check (clinic_id in (select current_clinic_ids()));
create policy patients_update on patients for update to authenticated
  using (clinic_id in (select current_clinic_ids()))
  with check (clinic_id in (select current_clinic_ids()));
