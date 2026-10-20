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
- "Sent" quote age uses `quotes.created_at` (there is no `sent_at` column).
