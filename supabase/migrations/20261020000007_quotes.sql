-- supabase/migrations/20261020000007_quotes.sql
create type quote_status as enum ('draft', 'sent', 'accepted', 'rejected', 'expired');

create table treatments (
  id uuid primary key default gen_random_uuid(),
  clinic_id uuid not null references clinics (id) on delete restrict,
  name text not null check (length(trim(name)) > 0),
  default_price_cents integer not null check (default_price_cents >= 0),
  duration_minutes smallint not null default 30 check (duration_minutes between 5 and 480),
  active boolean not null default true,
  created_at timestamptz not null default now(),
  unique (clinic_id, name)
);

create table quote_counters (
  clinic_id uuid primary key references clinics (id) on delete restrict,
  last_number integer not null default 0
);

create table quotes (
  id uuid primary key default gen_random_uuid(),
  clinic_id uuid not null references clinics (id) on delete restrict,
  patient_id uuid not null references patients (id) on delete restrict,
  number integer not null,
  status quote_status not null default 'draft',
  valid_until date not null,
  discount_cents integer not null default 0 check (discount_cents >= 0),
  notes text,
  created_by uuid not null references memberships (id),
  created_at timestamptz not null default now(),
  unique (clinic_id, number)
);
create index quotes_patient_idx on quotes (patient_id, created_at);

create table quote_items (
  id uuid primary key default gen_random_uuid(),
  clinic_id uuid not null references clinics (id) on delete restrict,
  quote_id uuid not null references quotes (id) on delete restrict,
  treatment_id uuid references treatments (id),
  description text not null check (length(trim(description)) > 0),
  tooth_fdi smallint,
  quantity smallint not null default 1 check (quantity between 1 and 99),
  unit_price_cents integer not null check (unit_price_cents >= 0)
);
create index quote_items_quote_idx on quote_items (quote_id);

-- Next quote number for a clinic. Row lock on the counter serialises concurrent callers.
create function next_quote_number(p_clinic uuid) returns integer
language plpgsql security definer set search_path = public as $$
declare n integer;
begin
  if p_clinic not in (select current_clinic_ids()) then
    raise exception 'not a member of clinic %', p_clinic using errcode = 'insufficient_privilege';
  end if;
  insert into quote_counters (clinic_id, last_number) values (p_clinic, 1)
  on conflict (clinic_id) do update set last_number = quote_counters.last_number + 1
  returning last_number into n;
  return n;
end $$;

-- Only forward transitions: draft -> sent -> accepted | rejected | expired (and draft -> expired).
create function guard_quote_status() returns trigger language plpgsql as $$
begin
  if new.status = old.status then return new; end if;
  if not (
    (old.status = 'draft' and new.status in ('sent', 'expired')) or
    (old.status = 'sent' and new.status in ('accepted', 'rejected', 'expired'))
  ) then
    raise exception 'invalid quote status change % -> %', old.status, new.status
      using errcode = 'check_violation';
  end if;
  return new;
end $$;
create trigger quotes_status_guard before update of status on quotes
  for each row execute function guard_quote_status();

alter table treatments enable row level security;
alter table quote_counters enable row level security;
alter table quotes enable row level security;
alter table quote_items enable row level security;
revoke all on quote_counters from authenticated;

create policy treatments_select on treatments for select to authenticated
  using (clinic_id in (select current_clinic_ids()));
create policy treatments_insert on treatments for insert to authenticated
  with check (is_clinic_admin(clinic_id));
create policy treatments_update on treatments for update to authenticated
  using (is_clinic_admin(clinic_id)) with check (is_clinic_admin(clinic_id));
create policy quotes_select on quotes for select to authenticated
  using (current_role_in(clinic_id) in ('admin', 'dentist'));
create policy quotes_insert on quotes for insert to authenticated
  with check (current_role_in(clinic_id) in ('admin', 'dentist'));
create policy quotes_update on quotes for update to authenticated
  using (current_role_in(clinic_id) in ('admin', 'dentist'))
  with check (current_role_in(clinic_id) in ('admin', 'dentist'));
create policy quote_items_select on quote_items for select to authenticated
  using (current_role_in(clinic_id) in ('admin', 'dentist'));
create policy quote_items_insert on quote_items for insert to authenticated
  with check (current_role_in(clinic_id) in ('admin', 'dentist'));
create policy quote_items_update on quote_items for update to authenticated
  using (current_role_in(clinic_id) in ('admin', 'dentist'))
  with check (current_role_in(clinic_id) in ('admin', 'dentist'));
