---
paths:
  - "supabase/migrations/**"
  - "src/lib/db.ts"
  - "src/server/**"
  - "tests/db/**"
---

# Database and services

- A migration is a new file named `YYYYMMDDHHMMSS_<name>.sql` that sorts after every existing one. Never edit an applied migration.
- Each new table: `clinic_id uuid not null references clinics (id) on delete restrict`, `enable row level security`, one policy per command, and the grants follow the default privileges (no `DELETE`).
- Append-only tables get a `before update or delete` trigger calling `forbid_mutation()` and `revoke update ... from authenticated`.
- Services take an `Actor`, call `runAs(actor, fn)`, and filter every query by `actor.clinicId`. Parameters are always `$1`-style, never string-concatenated.
- Map database errors to named errors: `23505` unique ⇒ a domain `Duplicate…Error`; `23P01` exclusion ⇒ `SlotTakenError`; RLS rejection ⇒ `ForbiddenError`.
- Dates cross the boundary as `Date` (UTC instants) or `YYYY-MM-DD` strings for local dates. Convert to clinic time only with `luxon` and `clinics.timezone`.
- Tests in `tests/db` create their own clinic with `seedClinic()`; never assume an empty database and never share rows between tests.
