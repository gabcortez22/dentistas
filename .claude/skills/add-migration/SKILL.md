---
name: add-migration
description: Add a new database table or change the schema safely. Use when a task needs a new table, column, index, policy or trigger in supabase/migrations, or when someone says "add a migration".
---

# Add a migration

## When to use
Any schema change. Never edit a migration that already ran.

## Steps
1. List `supabase/migrations/` and choose a timestamp name that sorts last: `YYYYMMDDHHMMSS_<name>.sql`.
2. Write the SQL following `.claude/rules/database.md`: `clinic_id`, RLS and policies, append-only trigger where the data is a record.
3. Write or extend a test in `tests/db/` that proves the policies: another clinic sees nothing, the wrong role is refused, a forbidden update or delete raises.
4. Run `pnpm db:up` and the new test.

## Verify
```bash
pnpm db:up && pnpm test:db   # expect: all DB tests pass on a fresh schema
```

## Do not
- Do not edit or rename an applied migration.
- Do not create `auth.users` or `auth.uid()` in a migration; Supabase provides them.
