# Build notes — deviations from the blueprint

Found while building; the blueprint text was not rewritten.

- **COP format (migration `20261020000011_cop_format.sql`)**: after reading the Colegio Odontológico del Perú "Formato de Historia Clínica", patients gained `religion`, `race`, `origin_place`; the clinical entries gained COP fields (informante, tiempo de enfermedad, signos vitales completos, diagnóstico presuntivo/definitivo, plan de trabajo, pronóstico, recomendaciones) and the `alta` entry kind. The odontogram follows NTS 045-MINSA (FDI, primary teeth 51-85).
- **Migration `20261020000012_rules_closure.sql`**: a weekly rule replaced on the same day is closed as an empty range (`valid_until = valid_from - 1`) instead of being deleted.
- **Charges** are written with `withService` under explicit membership checks (assistants record charges but cannot read quotes under RLS).
- **Reminders trigger** is `SECURITY DEFINER` (the booking user has no INSERT policy on `reminders`).
- **Bookings** check availability ignoring existing bookings, so a conflict is always a `SlotTakenError` decided by the exclusion constraint.
- **Simulator ids** use random UUIDs (unique `wa_message_id`).
- GitHub Actions pinned to `actions/checkout@v7` and `actions/setup-node@v7` (checked with `git ls-remote`, 2026-10-20).
- Verified without Docker: DB tests ran on a local PostgreSQL 16.15, not the compose image.

## Prospects pipeline (steps 19-21)

- Migration `20261020000013_prospects.sql`: `prospects`, append-only `prospect_events`, `followup_tasks`; `SECURITY DEFINER` triggers advance the stage when the linked patient books, is quoted or accepts.
- Automatic follow-ups are created by `/api/prospects/cron` (also called from `.github/workflows/cron.yml`). WhatsApp follow-ups go only to prospects with explicit consent and need the Meta template `seguimiento_prospecto` (utility, `es`, params: name, clinic) approved; without consent the task stays for a person.
- The agent gained `capture_prospect` (allow-list is now 9 tools). It still has no tool that reads clinical data.
- Migration `20261020000014_quote_sent_at.sql` adds `quotes.sent_at` (stamped by a trigger when a quote becomes `sent`); the follow-up age counts from it, falling back to `created_at` for older rows.
- `convertToPatient` creates the patient, links it and logs the conversion in one transaction (`createPatientInTx`), so a failure leaves nothing half done.

## Hosted Supabase deployment (first real run)

- Project `dentistas` (region `sa-east-1`) created with "Automatically expose new tables" **off** and automatic RLS off: the migrations own grants and RLS. All 15 migrations were applied and recorded in `public._migrations`, so `pnpm db:migrate` reports `up to date`. `pnpm db:seed` and a login as `admin@demo.test` were verified against it.
- Migration `20261020000015_lock_functions.sql`: Supabase exposes `public` functions over `/rest/v1/rpc`, so `EXECUTE` is revoked on the trigger and internal `SECURITY DEFINER` functions (`advance_prospect`, `prospects_on_*`, `sync_appointment_reminders`) from `public`, `anon` and `authenticated`. The RLS helpers (`current_clinic_ids`, `current_role_in`, `is_clinic_admin`) and `next_quote_number` stay executable by `authenticated` only (revoking from `public` also removes the implicit grant, hence the explicit `grant`). `search_path` is pinned on the four plain trigger functions.
- `DATABASE_URL` must be the **transaction pooler** URI copied from Supabase "Connect" (`aws-0` or `aws-1` differs per project); a wrong host answers `tenant/user not found`. Special characters in the password must be percent-encoded.
- The home page `/` is a static landing without a login link; users go to `/login`.
- Remaining before real patient data: Ley 29733 checklist (§20.1), Meta templates approved, Google OAuth scopes and Graph API version verified, model id verified.

## Ley 29733 groundwork

- Migration `20261020000016_patient_data_consent.sql`: `patients.data_consent_at` / `data_consent_version` (nullable; both set or both null). Not yet applied to the hosted Supabase project: run `pnpm db:migrate` against it.
- Creating a patient in the UI requires confirming the data-processing authorization; the moment and the policy version (`src/lib/privacy.ts`) are stored. Existing patients, and those created by the agent or by prospect conversion, show "Sin registrar" and can be recorded from the patient page. The first date is never overwritten (`src/server/patient-consent.ts`).
- Public `/privacidad` holds a **provisional** policy text with `[...]` placeholders (providers, retention period, contact). It needs review by a Peruvian lawyer and must be completed before real patient data; bump `PRIVACY_POLICY_VERSION` when the text changes.
- Still outside the code: banco de datos registration, cross-border transfer notice, NTS 139 retention period and archive procedure, ARCO procedure (data export and cancellation), lawyer review.
