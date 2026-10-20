-- supabase/migrations/20261020000003_clinical.sql
-- Clinical record: append-only. Corrections are new rows that point at the row they correct.
create type clinical_entry_kind as enum
  ('anamnesis', 'examen', 'diagnostico', 'tratamiento', 'evolucion', 'consentimiento', 'nota_correccion');

create table clinical_entries (
  id uuid primary key default gen_random_uuid(),
  clinic_id uuid not null references clinics (id) on delete restrict,
  patient_id uuid not null references patients (id) on delete restrict,
  kind clinical_entry_kind not null,
  body jsonb not null check (jsonb_typeof(body) = 'object'),
  author_membership_id uuid not null references memberships (id),
  corrects_entry_id uuid references clinical_entries (id),
  created_at timestamptz not null default now(),
  check ((kind = 'nota_correccion') = (corrects_entry_id is not null))
);
create index clinical_entries_patient_idx on clinical_entries (patient_id, created_at);

create table odontogram_marks (
  id uuid primary key default gen_random_uuid(),
  clinic_id uuid not null references clinics (id) on delete restrict,
  patient_id uuid not null references patients (id) on delete restrict,
  tooth_fdi smallint not null check (
    tooth_fdi between 11 and 18 or tooth_fdi between 21 and 28 or
    tooth_fdi between 31 and 38 or tooth_fdi between 41 and 48 or
    tooth_fdi between 51 and 55 or tooth_fdi between 61 and 65 or
    tooth_fdi between 71 and 75 or tooth_fdi between 81 and 85
  ),
  surface text check (surface is null or surface in ('M', 'D', 'O', 'V', 'L', 'P', 'I')),
  condition text not null check (length(trim(condition)) > 0),
  note text,
  author_membership_id uuid not null references memberships (id),
  created_at timestamptz not null default now()
);
create index odontogram_patient_idx on odontogram_marks (patient_id, tooth_fdi, created_at);

create table record_access_log (
  id bigint generated always as identity primary key,
  clinic_id uuid not null references clinics (id) on delete restrict,
  patient_id uuid not null references patients (id) on delete restrict,
  membership_id uuid not null references memberships (id),
  accessed_at timestamptz not null default now()
);
create index record_access_patient_idx on record_access_log (patient_id, accessed_at);

create function forbid_mutation() returns trigger language plpgsql as $$
begin
  raise exception '% on % is not allowed: this table is append-only', tg_op, tg_table_name
    using errcode = 'restrict_violation';
end $$;

create trigger clinical_entries_append_only before update or delete on clinical_entries
  for each row execute function forbid_mutation();
create trigger odontogram_marks_append_only before update or delete on odontogram_marks
  for each row execute function forbid_mutation();
create trigger record_access_log_append_only before update or delete on record_access_log
  for each row execute function forbid_mutation();

revoke update on clinical_entries, odontogram_marks, record_access_log from authenticated;

alter table clinical_entries enable row level security;
alter table odontogram_marks enable row level security;
alter table record_access_log enable row level security;

-- Assistants may read patients but not the clinical record; dentists and admins may read and write it.
create policy clinical_entries_select on clinical_entries for select to authenticated
  using (current_role_in(clinic_id) in ('admin', 'dentist'));
create policy clinical_entries_insert on clinical_entries for insert to authenticated
  with check (current_role_in(clinic_id) in ('admin', 'dentist'));
create policy odontogram_select on odontogram_marks for select to authenticated
  using (current_role_in(clinic_id) in ('admin', 'dentist'));
create policy odontogram_insert on odontogram_marks for insert to authenticated
  with check (current_role_in(clinic_id) in ('admin', 'dentist'));
create policy access_log_select on record_access_log for select to authenticated
  using (is_clinic_admin(clinic_id));
create policy access_log_insert on record_access_log for insert to authenticated
  with check (current_role_in(clinic_id) in ('admin', 'dentist'));
