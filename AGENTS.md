# Dentistas — agent instructions

Software para clínicas dentales del Perú (historias clínicas, agenda, cotizaciones, cobros, gastos, agente de WhatsApp). Next.js 16 + TypeScript + PostgreSQL (Supabase).

**Source of truth: `CLAUDE.md`.** Read it first. The build plan is `blueprints/dentistas/tasks.json`; each epic in `blueprints/dentistas/epics/` is self-contained.

## Commands

- Install: `pnpm install` · Dev: `pnpm dev` · Build: `pnpm build`
- Gate: `pnpm typecheck && pnpm lint && pnpm test`
- DB tests need Postgres: `pnpm db:up` first (Docker, port 54329)
- Migrate: `pnpm db:migrate`

## Three rules that matter most

1. No hard deletes. Clinical records, charges and expenses are append-only; fix with new rows.
2. Every table has `clinic_id` and RLS; services always filter by the actor's clinic.
3. Availability is computed, never stored; the database constraint decides double-booking.
