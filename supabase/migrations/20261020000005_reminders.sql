-- supabase/migrations/20261020000005_reminders.sql
create type reminder_kind as enum ('h24', 'h2');
create type reminder_status as enum ('pending', 'sent', 'failed', 'skipped');

create table whatsapp_messages (
  id uuid primary key default gen_random_uuid(),
  clinic_id uuid not null references clinics (id) on delete restrict,
  patient_id uuid references patients (id) on delete restrict,
  direction text not null check (direction in ('in', 'out')),
  wa_message_id text unique,
  phone_e164 text not null,
  body text not null,
  template_name text,
  status text not null default 'received'
    check (status in ('received', 'processed', 'queued', 'sent', 'failed')),
  error text,
  created_at timestamptz not null default now()
);
create index whatsapp_messages_phone_idx on whatsapp_messages (clinic_id, phone_e164, created_at);

create table reminders (
  id uuid primary key default gen_random_uuid(),
  clinic_id uuid not null references clinics (id) on delete restrict,
  appointment_id uuid not null references appointments (id) on delete restrict,
  kind reminder_kind not null,
  due_at timestamptz not null,
  status reminder_status not null default 'pending',
  attempts smallint not null default 0,
  last_error text,
  sent_at timestamptz,
  message_id uuid references whatsapp_messages (id),
  created_at timestamptz not null default now(),
  unique (appointment_id, kind)
);
create index reminders_due_idx on reminders (due_at) where status = 'pending';

alter table whatsapp_messages enable row level security;
alter table reminders enable row level security;
create policy whatsapp_messages_select on whatsapp_messages for select to authenticated
  using (current_role_in(clinic_id) in ('admin', 'dentist', 'assistant'));
create policy reminders_select on reminders for select to authenticated
  using (clinic_id in (select current_clinic_ids()));

-- Keep reminders in step with the appointment, inside the same transaction as the booking write.
-- SECURITY DEFINER: the booking user has no INSERT policy on reminders; the trigger writes on their behalf.
create function sync_appointment_reminders() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if new.status = 'confirmed' then
    insert into reminders (clinic_id, appointment_id, kind, due_at)
    select new.clinic_id, new.id, k.kind, new.starts_at - k.lead
    from (values ('h24'::reminder_kind, interval '24 hours'), ('h2'::reminder_kind, interval '2 hours'))
      as k (kind, lead)
    where new.starts_at - k.lead > now()
    on conflict (appointment_id, kind) do update
      set due_at = excluded.due_at, status = 'pending', attempts = 0, last_error = null
      where reminders.status in ('pending', 'skipped')
        and reminders.due_at is distinct from excluded.due_at;
  else
    update reminders set status = 'skipped'
    where appointment_id = new.id and status = 'pending';
  end if;
  return new;
end $$;

create trigger appointments_sync_reminders
  after insert or update of status, starts_at on appointments
  for each row execute function sync_appointment_reminders();
