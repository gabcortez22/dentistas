---
name: run-db-tests
description: Run or debug the database tests. Use when a tests/db test fails, when the test database is not reachable, or when someone asks how to run DB tests locally.
---

# Run the database tests

## When to use
Any failure or question about `pnpm test:db`.

## Steps
1. Start Postgres: `pnpm db:up` (Docker; port 54329, database `dentistas_test`). If Docker is not available, any Postgres 16 with `btree_gist` works: create a database whose name ends in `_test` and export `TEST_DATABASE_URL`.
2. Run one file first: `pnpm test:db tests/db/<file>.test.ts`.
3. Remember the global setup drops and recreates schema `public` on every run; a failing migration fails every test with the migration name in the error.

## Verify
```bash
pnpm test:db   # expect: exit 0
```

## Do not
- Do not point `TEST_DATABASE_URL` at a real database: the setup refuses names not ending in `_test`, do not work around it.
