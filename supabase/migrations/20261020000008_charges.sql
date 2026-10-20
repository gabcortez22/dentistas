-- supabase/migrations/20261020000008_charges.sql
create type payment_method as enum ('cash', 'yape', 'plin', 'card', 'transfer');

create table charges (
  id uuid primary key default gen_random_uuid(),
  clinic_id uuid not null references clinics (id) on delete restrict,
  patient_id uuid not null references patients (id) on delete restrict,
  quote_id uuid references quotes (id),
  appointment_id uuid references appointments (id),
  amount_cents integer not null check (amount_cents > 0),
  method payment_method not null,
  concept text not null check (length(trim(concept)) > 0),
  paid_at timestamptz not null default now(),
  created_by uuid not null references memberships (id),
  created_at timestamptz not null default now()
);
create index charges_patient_idx on charges (patient_id, paid_at);
create index charges_quote_idx on charges (quote_id);

create table charge_voids (
  charge_id uuid primary key references charges (id) on delete restrict,
  clinic_id uuid not null references clinics (id) on delete restrict,
  reason text not null check (length(trim(reason)) > 0),
  voided_by uuid not null references memberships (id),
  voided_at timestamptz not null default now()
);

create trigger charges_append_only before update or delete on charges
  for each row execute function forbid_mutation();
create trigger charge_voids_append_only before update or delete on charge_voids
  for each row execute function forbid_mutation();
revoke update on charges, charge_voids from authenticated;

-- Money owed on accepted quotes, net of non-voided charges.
create view quote_balances with (security_invoker = true) as
select q.id as quote_id, q.clinic_id, q.patient_id, q.number,
  greatest(coalesce(i.total, 0) - q.discount_cents, 0) as total_cents,
  coalesce(c.paid, 0) as paid_cents,
  greatest(coalesce(i.total, 0) - q.discount_cents, 0) - coalesce(c.paid, 0) as balance_cents
from quotes q
left join (select quote_id, sum(quantity * unit_price_cents)::bigint as total
           from quote_items group by quote_id) i on i.quote_id = q.id
left join (select ch.quote_id, sum(ch.amount_cents)::bigint as paid
           from charges ch left join charge_voids v on v.charge_id = ch.id
           where v.charge_id is null group by ch.quote_id) c on c.quote_id = q.id
where q.status = 'accepted';

alter table charges enable row level security;
alter table charge_voids enable row level security;
create policy charges_select on charges for select to authenticated
  using (current_role_in(clinic_id) in ('admin', 'dentist', 'assistant'));
create policy charges_insert on charges for insert to authenticated
  with check (current_role_in(clinic_id) in ('admin', 'dentist', 'assistant'));
create policy charge_voids_select on charge_voids for select to authenticated
  using (current_role_in(clinic_id) in ('admin', 'dentist', 'assistant'));
create policy charge_voids_insert on charge_voids for insert to authenticated
  with check (is_clinic_admin(clinic_id));
