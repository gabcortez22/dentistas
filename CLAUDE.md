# Dentistas

Software web para clínicas dentales del Perú: historias clínicas (NTS 139-MINSA), agenda con recordatorios, cotizaciones, cobros, gastos y un agente de WhatsApp que atiende y agenda. Lo usan dentistas, asistentes y administradores de una o varias clínicas.

## Commands

| Task | Command |
|---|---|
| Install | `pnpm install` (CI and gates: `pnpm install --frozen-lockfile`) |
| Dev server | `pnpm dev` — http://localhost:3000 |
| Build | `pnpm build` |
| Typecheck | `pnpm typecheck` |
| Lint / format | `pnpm lint` · `pnpm format` |
| Unit tests (no database) | `pnpm test:unit` · one file: `pnpm test:unit tests/unit/<file>` |
| DB tests (need Postgres) | `pnpm db:up` then `pnpm test:db` · one file: `pnpm test:db tests/db/<file>` |
| Everything | `pnpm test` |
| Test database up / down | `pnpm db:up` · `pnpm db:down` (Docker, port 54329) |
| Migrate | `pnpm db:migrate` (uses `DATABASE_URL`) |
| Seed demo data | `pnpm db:seed` |

**Gate:** `pnpm typecheck && pnpm lint && pnpm test` must pass before any task is marked done. The build is driven by `blueprints/dentistas/tasks.json`: pick the first `pending` task in array order whose dependencies are `done`, run its `verify` commands from this root, then its checkpoint.

Runtime: Node pinned in `.nvmrc` (24; 22.12+ works). pnpm 12.14.0 (`npm install -g pnpm@12.14.0`; Corepack fails on pnpm 12). Dependency versions are exact in `package.json` and the lockfile — read them, never guess.

## Stack

Next.js 16 (App Router) · TypeScript · Tailwind CSS 4 · PostgreSQL via Supabase · `pg` for all data access · Supabase Auth (authentication only) · Anthropic SDK (agent) · WhatsApp Cloud API · Google Calendar REST · Vitest · Biome.

## Architecture

**Request path.** Browser → `src/proxy.ts` (session refresh, redirects to `/login`) → route in `src/app/**` → server action or route handler → `src/server/<domain>.ts` → `src/lib/db.ts` (`withTenant` / `withService`) → Postgres. Row-level security is the access boundary: user requests run as the `authenticated` role with `auth.uid()` set; webhooks, cron and the agent run as the owner via `withService` and **always filter by `clinic_id`**.

**Boundaries.**

| Layer | May import from | Must never |
|---|---|---|
| `src/app/**` (routes, pages) | `src/server`, `src/lib` | import `pg` or `src/lib/db.ts` directly |
| `src/server/**` (services) | `src/lib` | import React or anything from `src/app` |
| `src/lib/availability/**` | `luxon` only | read the clock, a database or env (pure function) |
| `src/lib/agent/**` | `src/lib`, `src/server/agent-tools.ts` | read clinical entries; the agent has no tool for them |

**Where things live.**

| Concern | Single source of truth |
|---|---|
| DB schema | `supabase/migrations/*.sql`, applied in filename order by `scripts/migrate.ts` |
| Env access | `src/lib/env.ts` — `getEnv(group)`; never read `process.env` elsewhere (except `src/proxy.ts`) |
| Design tokens | `src/app/globals.css` (`@theme`) — no raw hex in components |
| Session / roles | `src/server/session.ts` — `getSession`, `requireSession`, `requireRole`, `userActor` |
| Money | `src/lib/money.ts` — integer céntimos of PEN, `formatPEN`, `parsePEN` |
| Time | UTC instants in the database; clinic wall-clock via `luxon` and `clinics.timezone` (`America/Lima`) |

## Code rules

- **No hard deletes.** `authenticated` has no `DELETE`/`TRUNCATE`. Clinical entries, odontogram marks, access log, charges and expenses are append-only (a trigger enforces it); corrections are new rows, voids are rows in `*_voids`.
- Every table has `clinic_id` and RLS. A new table without both is a defect.
- Services take an `Actor` (`runAs`) and filter by `actor.clinicId` even under RLS.
- Money is an integer number of céntimos. Never floats, never strings.
- Never store slots; availability is computed by `generateSlots`. The booking write is authoritative: the `appointments_no_overlap` constraint decides, map SQLSTATE `23P01` to `SlotTakenError`.
- Validate every boundary input with zod (forms, route handlers, agent tool arguments).
- UI copy is Spanish (es-PE); code, identifiers, commits and comments are English.
- Files stay under 300 lines; split by responsibility, not by layer.
- No `any`, no `@ts-ignore`, no skipped or focused tests (`.skip`, `.only`).

## Gotchas

- Next.js 16: the old `middleware.ts` is `src/proxy.ts` and exports `proxy`. `params` and `searchParams` are Promises: `await` them. The framework docs ship in `node_modules/next/dist/docs/` — read them before using an API you have not used here.
- `pnpm` 12 refuses unreviewed install scripts: `pnpm-workspace.yaml` lists `allowBuilds`. New native dependency ⇒ decide there, do not pass flags.
- DB tests need Postgres on `localhost:54329` (`pnpm db:up`). The global setup **drops and recreates schema `public`** and refuses any database whose name does not end in `_test`.
- `tests/db/global-setup.ts` stubs `auth.users` and `auth.uid()`; in Supabase they are real. Never create them in a migration.
- Do not edit or delete a migration that has been applied anywhere: add a new one.
- Unit tests live in `tests/unit`, DB tests in `tests/db`; the Vitest projects are `unit` and `db`.
- Never log patient names, documents, phones or clinical content. Log ids.
- The agent must never see clinical data; do not add a tool that reads `clinical_entries`.

## Process

- Run `git status` before and after each task. One commit and one tag per task: `git tag step-NN-slug` (the exact tag is in `tasks.json`).
- A task is `done` only when every `verify` command exits 0 **and** all earlier tasks' verifies still pass.
- Stuck twice on the same verify ⇒ `git reset --hard <previous step tag>` and retry; never debug forward through a broken checkpoint.
- Ask nothing: the blueprint and the epic file are complete. If something is truly missing, stop and report exactly what.
