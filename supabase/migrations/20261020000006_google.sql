-- supabase/migrations/20261020000006_google.sql
create table google_connections (
  id uuid primary key default gen_random_uuid(),
  clinic_id uuid not null references clinics (id) on delete restrict,
  membership_id uuid not null unique references memberships (id) on delete restrict,
  google_email text not null,
  calendar_id text not null default 'primary',
  refresh_token_enc text not null,
  status text not null default 'active' check (status in ('active', 'revoked', 'error')),
  last_error text,
  created_at timestamptz not null default now()
);

alter table google_connections enable row level security;
-- refresh_token_enc must never reach the browser: no SELECT for authenticated, the server reads it as owner.
revoke select on google_connections from authenticated;
grant select (id, clinic_id, membership_id, google_email, calendar_id, status, created_at)
  on google_connections to authenticated;
create policy google_connections_select on google_connections for select to authenticated
  using (membership_id in (select id from memberships where user_id = auth.uid()) or is_clinic_admin(clinic_id));
