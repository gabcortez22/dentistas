-- supabase/migrations/20261020000009_expenses.sql
create type expense_category as enum
  ('insumos', 'laboratorio', 'alquiler', 'sueldos', 'servicios', 'marketing', 'otros');

create table expenses (
  id uuid primary key default gen_random_uuid(),
  clinic_id uuid not null references clinics (id) on delete restrict,
  category expense_category not null,
  supplier text,
  description text not null check (length(trim(description)) > 0),
  amount_cents integer not null check (amount_cents > 0),
  method payment_method not null,
  incurred_on date not null,
  receipt_note text,
  created_by uuid not null references memberships (id),
  created_at timestamptz not null default now()
);
create index expenses_clinic_date_idx on expenses (clinic_id, incurred_on);

create table expense_voids (
  expense_id uuid primary key references expenses (id) on delete restrict,
  clinic_id uuid not null references clinics (id) on delete restrict,
  reason text not null check (length(trim(reason)) > 0),
  voided_by uuid not null references memberships (id),
  voided_at timestamptz not null default now()
);

create trigger expenses_append_only before update or delete on expenses
  for each row execute function forbid_mutation();
create trigger expense_voids_append_only before update or delete on expense_voids
  for each row execute function forbid_mutation();
revoke update on expenses, expense_voids from authenticated;

-- Income minus expenses per clinic and month (America/Lima calendar months), voided rows excluded.
create view monthly_summary with (security_invoker = true) as
with inc as (
  select ch.clinic_id,
    date_trunc('month', ch.paid_at at time zone 'America/Lima')::date as month,
    sum(ch.amount_cents)::bigint as income_cents
  from charges ch left join charge_voids v on v.charge_id = ch.id
  where v.charge_id is null group by 1, 2
), exp as (
  select e.clinic_id, date_trunc('month', e.incurred_on)::date as month,
    sum(e.amount_cents)::bigint as expense_cents
  from expenses e left join expense_voids v on v.expense_id = e.id
  where v.expense_id is null group by 1, 2
)
select coalesce(inc.clinic_id, exp.clinic_id) as clinic_id,
  coalesce(inc.month, exp.month) as month,
  coalesce(inc.income_cents, 0) as income_cents,
  coalesce(exp.expense_cents, 0) as expense_cents,
  coalesce(inc.income_cents, 0) - coalesce(exp.expense_cents, 0) as net_cents
from inc full join exp on inc.clinic_id = exp.clinic_id and inc.month = exp.month;

alter table expenses enable row level security;
alter table expense_voids enable row level security;
-- Finance is admin-only: dentists and assistants cannot read expenses.
create policy expenses_select on expenses for select to authenticated
  using (is_clinic_admin(clinic_id));
create policy expenses_insert on expenses for insert to authenticated
  with check (is_clinic_admin(clinic_id));
create policy expense_voids_select on expense_voids for select to authenticated
  using (is_clinic_admin(clinic_id));
create policy expense_voids_insert on expense_voids for insert to authenticated
  with check (is_clinic_admin(clinic_id));
