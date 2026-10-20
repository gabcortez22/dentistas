-- supabase/migrations/20261020000010_agent.sql
create table agent_conversations (
  id uuid primary key default gen_random_uuid(),
  clinic_id uuid not null references clinics (id) on delete restrict,
  phone_e164 text not null,
  patient_id uuid references patients (id) on delete restrict,
  status text not null default 'active' check (status in ('active', 'handoff', 'closed')),
  last_message_at timestamptz not null default now(),
  created_at timestamptz not null default now()
);
-- One open conversation per clinic and phone.
create unique index agent_conversations_open_idx on agent_conversations (clinic_id, phone_e164)
  where status in ('active', 'handoff');

create table agent_turns (
  id bigint generated always as identity primary key,
  conversation_id uuid not null references agent_conversations (id) on delete restrict,
  role text not null check (role in ('user', 'assistant')),
  content jsonb not null,
  input_tokens integer,
  output_tokens integer,
  created_at timestamptz not null default now()
);
create index agent_turns_conversation_idx on agent_turns (conversation_id, id);

-- A proposal is the only way the agent can book: the patient-confirmed summary is stored server-side,
-- and book_appointment accepts nothing but the proposal id.
create table appointment_proposals (
  id uuid primary key default gen_random_uuid(),
  clinic_id uuid not null references clinics (id) on delete restrict,
  conversation_id uuid not null references agent_conversations (id) on delete restrict,
  patient_id uuid not null references patients (id) on delete restrict,
  membership_id uuid not null references memberships (id) on delete restrict,
  starts_at timestamptz not null,
  ends_at timestamptz not null,
  reason text,
  expires_at timestamptz not null,
  consumed_at timestamptz,
  created_at timestamptz not null default now(),
  check (ends_at > starts_at)
);

alter table agent_conversations enable row level security;
alter table agent_turns enable row level security;
alter table appointment_proposals enable row level security;
create policy agent_conversations_select on agent_conversations for select to authenticated
  using (current_role_in(clinic_id) in ('admin', 'dentist', 'assistant'));
create policy agent_conversations_update on agent_conversations for update to authenticated
  using (current_role_in(clinic_id) in ('admin', 'dentist', 'assistant'))
  with check (current_role_in(clinic_id) in ('admin', 'dentist', 'assistant'));
create policy agent_turns_select on agent_turns for select to authenticated
  using (conversation_id in (select id from agent_conversations));
