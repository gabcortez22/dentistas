-- supabase/migrations/20261020000001_foundation.sql
-- Tenancy foundation: clinics, memberships, helper functions, RLS, grants.
create extension if not exists btree_gist;

-- Authenticated users may read/insert/update but NEVER delete or truncate: no hard deletes anywhere.
alter default privileges in schema public grant select, insert, update on tables to authenticated;
alter default privileges in schema public revoke delete, truncate on tables from authenticated;
alter default privileges in schema public revoke all on tables from anon;
alter default privileges in schema public grant usage, select on sequences to authenticated;
grant usage on schema public to authenticated;

create type member_role as enum ('admin', 'dentist', 'assistant');

create table clinics (
  id uuid primary key default gen_random_uuid(),
  name text not null check (length(trim(name)) > 0),
  timezone text not null default 'America/Lima',
  currency text not null default 'PEN' check (currency = 'PEN'),
  whatsapp_phone_number_id text unique,
  created_at timestamptz not null default now()
);

create table memberships (
  id uuid primary key default gen_random_uuid(),
  clinic_id uuid not null references clinics (id) on delete restrict,
  user_id uuid not null unique references auth.users (id) on delete restrict,
  role member_role not null,
  display_name text not null check (length(trim(display_name)) > 0),
  active boolean not null default true,
  created_at timestamptz not null default now()
);
create index memberships_clinic_idx on memberships (clinic_id);

create function current_clinic_ids() returns setof uuid
language sql stable security definer set search_path = public, auth as $$
  select clinic_id from public.memberships where user_id = auth.uid() and active
$$;

create function current_role_in(p_clinic uuid) returns member_role
language sql stable security definer set search_path = public, auth as $$
  select role from public.memberships
  where user_id = auth.uid() and clinic_id = p_clinic and active
$$;

create function is_clinic_admin(p_clinic uuid) returns boolean
language sql stable security definer set search_path = public, auth as $$
  select coalesce(public.current_role_in(p_clinic) = 'admin', false)
$$;

alter table clinics enable row level security;
alter table memberships enable row level security;

create policy clinics_select on clinics for select to authenticated
  using (id in (select current_clinic_ids()));
create policy clinics_update on clinics for update to authenticated
  using (is_clinic_admin(id)) with check (is_clinic_admin(id));

create policy memberships_select on memberships for select to authenticated
  using (clinic_id in (select current_clinic_ids()));
create policy memberships_admin_insert on memberships for insert to authenticated
  with check (is_clinic_admin(clinic_id));
create policy memberships_admin_update on memberships for update to authenticated
  using (is_clinic_admin(clinic_id)) with check (is_clinic_admin(clinic_id));
