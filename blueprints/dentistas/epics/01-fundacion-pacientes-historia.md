# Épica 01: Fundación, pacientes e historia clínica

> Existe una app con autenticación, clínicas con roles y datos aislados por RLS, pacientes y una historia clínica de solo agregar.

| | |
|---|---|
| **Id de la épica** | `01-fundacion-pacientes-historia` |
| **Tareas** | `E1-T1` … `E1-T6` (pasos 1 a 6 de 18) |
| **Depende de épicas** | — (el Bootstrap de §10 ya corrió) |

## Contexto (se repite a propósito: esta épica es autosuficiente)

**Stack:** Next.js 16 (App Router) · React 19 · TypeScript 6 estricto · Tailwind CSS 4 · PostgreSQL 16 (Supabase) con `pg` directo y RLS · Supabase Auth (solo autentica) · zod 4 · luxon · Vitest 5 (proyectos `unit` y `db`) · Biome 2 · pnpm 12.14.0 · Node 24 (22.12+). Versiones exactas en `package.json`.
**Reglas que valen en todo paso:** nadie borra (`authenticated` sin `DELETE`; historias, cobros y gastos son de solo agregar); toda tabla lleva `clinic_id` y RLS; los servicios reciben un `Actor` y filtran por `clinicId`; dinero en céntimos enteros de PEN; la disponibilidad se calcula (nunca se guardan slots) y la restricción `appointments_no_overlap` es la autoridad; interfaz en español (es-PE), código en inglés; sin `any`; sin tests omitidos (`.skip`/`.only`).
**Proceso:** los comandos de verificación corren desde la **raíz del proyecto**; un commit y una etiqueta por tarea; el estado de cada tarea se escribe en `tasks.json` antes y después del trabajo.

**Estructura de directorios (subárbol relevante):**
```
src/
├── proxy.ts · app/{layout,page,globals.css} · app/(auth)/{login,registro} · app/(app)/{pacientes,agenda,configuracion,cotizaciones,cobros,gastos,resumen,simulador}
├── app/api/{health,availability,cron,google,quotes/[id]/pdf,whatsapp}
├── lib/{env,db,auth-paths,phone,money}.ts · lib/{supabase,availability,whatsapp,google,pdf,agent}/
└── server/{session,clinics,patients,clinical,availability,appointments,schedules,reminders,quotes,charges,expenses,agent-tools,inbound}.ts
supabase/migrations/*.sql · scripts/{migrate.ts,serve-check.sh,seed.ts} · tests/{unit,db}/ · .github/workflows/
```

**Cómo trabajar esta épica:** abre `tasks.json`; toma la primera tarea `pending` en orden de arreglo cuyas dependencias estén `done`; márcala `in_progress`; haz el **Do**; corre **Verify** desde la raíz del proyecto (todos deben salir 0); ejecuta **Checkpoint**; márcala `done`. Los gates de las tareas anteriores deben seguir pasando. El orden de este archivo es el orden de construcción. Las tareas con `**` en sus archivos cuentan como un archivo cada una.

---

### E1-T1 — Step 1: Esqueleto de la app y endpoint de salud

| | |
|---|---|
| **Depende de** | — |
| **Prioridad** | p0 |
| **Archivos** | `src/app/layout.tsx`, `src/app/page.tsx`, `src/app/globals.css`, `src/app/api/health/route.ts`, `tests/unit/health.test.ts` |
| **Etiqueta** | `step-01-scaffold` |

**Do**
El proyecto ya existe: §10 (Bootstrap) copió `workspace/` a la raíz, instaló dependencias y creó el repositorio. Este paso escribe el esqueleto de la aplicación y el endpoint de salud que más adelante sirve de prueba de humo del servidor de producción. Crea exactamente estos archivos (tokens de diseño de §7 en `globals.css`; el idioma de la interfaz es español peruano):

`src/app/globals.css`

```css
@import "tailwindcss";

@theme {
  --color-brand: #0f766e;
  --color-brand-hover: #115e59;
  --color-brand-soft: #ccfbf1;
  --color-canvas: #f8fafc;
  --color-surface: #ffffff;
  --color-line: #e2e8f0;
  --color-ink: #0f172a;
  --color-ink-muted: #475569;
  --color-ok: #15803d;
  --color-warn: #b45309;
  --color-danger: #b91c1c;
  --color-info: #1d4ed8;
  --font-sans:
    ui-sans-serif, system-ui, -apple-system, "Segoe UI", Roboto, "Helvetica Neue", Arial, sans-serif;
  --radius-card: 0.75rem;
  --radius-control: 0.5rem;
}

html {
  background: var(--color-canvas);
  color: var(--color-ink);
  font-family: var(--font-sans);
}

:focus-visible {
  outline: 2px solid var(--color-brand);
  outline-offset: 2px;
}
```

`src/app/layout.tsx`

```tsx
import type { Metadata } from "next";
import type { ReactNode } from "react";
import "./globals.css";

export const metadata: Metadata = {
  title: "Dentistas",
  description: "Gestión de clínicas dentales: historias clínicas, citas, cotizaciones y cobros.",
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="es-PE">
      <body className="min-h-screen bg-canvas text-ink antialiased">{children}</body>
    </html>
  );
}
```

`src/app/page.tsx`

```tsx
export default function HomePage() {
  return (
    <main className="mx-auto max-w-3xl px-4 py-16">
      <h1 className="text-3xl font-semibold text-brand">Dentistas</h1>
      <p className="mt-3 text-ink-muted">
        Historias clínicas, agenda de citas, cotizaciones y cobros para tu clínica dental.
      </p>
    </main>
  );
}
```

`src/app/api/health/route.ts`

```ts
export const dynamic = "force-dynamic";

export function GET() {
  return Response.json({ status: "ok" });
}
```

`tests/unit/health.test.ts`

```ts
import { describe, expect, it } from "vitest";
import { GET } from "@/app/api/health/route";

describe("GET /api/health", () => {
  it("answers 200 with { status: 'ok' }", async () => {
    const response = GET();
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ status: "ok" });
  });
});
```

El `scripts/serve-check.sh` que usa el último comando de verificación ya viene en `workspace/` (§19.6).

**Acceptance**
- [ ] WHEN `pnpm install --frozen-lockfile` runs THE SYSTEM SHALL exit 0 and leave `pnpm-lock.yaml` unchanged.
- [ ] WHEN `pnpm typecheck` and `pnpm lint` run with the `blueprints/` directory present in the tree THE SYSTEM SHALL exit 0 with zero errors and zero warnings.
- [ ] WHEN `pnpm test:unit tests/unit/health.test.ts` runs THE SYSTEM SHALL pass a test asserting that the health handler answers status 200 with the JSON body `{ "status": "ok" }`.
- [ ] WHEN `pnpm build` has completed and `bash scripts/serve-check.sh` runs THE SYSTEM SHALL start the production server, receive exactly `{"status":"ok"}` from `/api/health`, and stop the server.

**Verify**
```bash
pnpm install --frozen-lockfile
git diff --quiet -- pnpm-lock.yaml
pnpm typecheck
pnpm lint
pnpm test:unit tests/unit/health.test.ts
pnpm build
bash scripts/serve-check.sh
```

**Checkpoint**
```bash
git add -A && git commit -m "step 1: scaffold"
git tag step-01-scaffold
git rev-parse --verify step-01-scaffold   # expect: a commit id, exit 0
```

---

### E1-T2 — Step 2: Base de datos: clínicas, membresías, RLS y capa de acceso

| | |
|---|---|
| **Depende de** | `E1-T1` |
| **Prioridad** | p0 |
| **Archivos** | `supabase/migrations/20261020000001_foundation.sql`, `src/lib/env.ts`, `src/lib/db.ts`, `tests/unit/env.test.ts`, `tests/db/foundation.test.ts` |
| **Etiqueta** | `step-02-tenancy-db` |

**Do**
Capa de datos y tenencia (multi-clínica). Decisiones que este paso fija para todo el proyecto: (1) **cada tabla de negocio lleva `clinic_id` y RLS**; (2) **nadie borra**: `authenticated` no tiene `DELETE`/`TRUNCATE` en ningún lado; (3) el servidor accede a Postgres directamente con `pg` (no PostgREST), dentro de una transacción que fija `auth.uid()` y el rol `authenticated`, de modo que las mismas políticas RLS protegen la web y los tests; (4) un usuario pertenece a una sola clínica en v1 (`memberships.user_id` único).

Crea la migración (SQL exacto), la validación de entorno por grupos y el acceso a base de datos, más los tests. Las variables se validan **al usarlas**, no al importar, para no romper los gates de pasos anteriores (§10, columna "Requerida desde el paso").

`supabase/migrations/20261020000001_foundation.sql`

```sql
-- supabase/migrations/20261020000001_foundation.sql
-- Tenancy foundation: clinics, memberships, helper functions, RLS, grants.
create extension if not exists btree_gist;

-- Authenticated users may read/insert/update but NEVER delete or truncate: no hard deletes anywhere.
alter default privileges in schema public grant select, insert, update on tables to authenticated;
alter default privileges in schema public revoke delete, truncate on tables from authenticated;
alter default privileges in schema public revoke all on tables from anon;
alter default privileges in schema public grant usage, select on sequences to authenticated;
grant usage on schema public to authenticated;

create type member_role as enum ('admin', 'dentist', 'assistant');

create table clinics (
  id uuid primary key default gen_random_uuid(),
  name text not null check (length(trim(name)) > 0),
  timezone text not null default 'America/Lima',
  currency text not null default 'PEN' check (currency = 'PEN'),
  whatsapp_phone_number_id text unique,
  created_at timestamptz not null default now()
);

create table memberships (
  id uuid primary key default gen_random_uuid(),
  clinic_id uuid not null references clinics (id) on delete restrict,
  user_id uuid not null unique references auth.users (id) on delete restrict,
  role member_role not null,
  display_name text not null check (length(trim(display_name)) > 0),
  active boolean not null default true,
  created_at timestamptz not null default now()
);
create index memberships_clinic_idx on memberships (clinic_id);

create function current_clinic_ids() returns setof uuid
language sql stable security definer set search_path = public, auth as $$
  select clinic_id from public.memberships where user_id = auth.uid() and active
$$;

create function current_role_in(p_clinic uuid) returns member_role
language sql stable security definer set search_path = public, auth as $$
  select role from public.memberships
  where user_id = auth.uid() and clinic_id = p_clinic and active
$$;

create function is_clinic_admin(p_clinic uuid) returns boolean
language sql stable security definer set search_path = public, auth as $$
  select coalesce(public.current_role_in(p_clinic) = 'admin', false)
$$;

alter table clinics enable row level security;
alter table memberships enable row level security;

create policy clinics_select on clinics for select to authenticated
  using (id in (select current_clinic_ids()));
create policy clinics_update on clinics for update to authenticated
  using (is_clinic_admin(id)) with check (is_clinic_admin(id));

create policy memberships_select on memberships for select to authenticated
  using (clinic_id in (select current_clinic_ids()));
create policy memberships_admin_insert on memberships for insert to authenticated
  with check (is_clinic_admin(clinic_id));
create policy memberships_admin_update on memberships for update to authenticated
  using (is_clinic_admin(clinic_id)) with check (is_clinic_admin(clinic_id));
```

`src/lib/env.ts`

```ts
import { z } from "zod";

// Variables are validated per group, when the code that needs them first runs, never at import time.
// That keeps every earlier build step's gate green before the secret for a later step exists.
const groups = {
  core: z.object({ DATABASE_URL: z.string().min(1) }),
  supabase: z.object({
    NEXT_PUBLIC_SUPABASE_URL: z.url(),
    NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY: z.string().min(1),
  }),
  supabaseAdmin: z.object({ SUPABASE_SECRET_KEY: z.string().min(1) }),
  app: z.object({ APP_URL: z.url() }),
  cron: z.object({ CRON_SECRET: z.string().min(16) }),
  crypto: z.object({
    TOKEN_ENC_KEY: z.string().refine((v) => Buffer.from(v, "base64").length === 32, {
      message: "must be 32 bytes, base64-encoded",
    }),
  }),
  google: z.object({
    GOOGLE_CLIENT_ID: z.string().min(1),
    GOOGLE_CLIENT_SECRET: z.string().min(1),
  }),
  whatsapp: z
    .object({
      WHATSAPP_MODE: z.enum(["simulator", "cloud"]).default("simulator"),
      WHATSAPP_ACCESS_TOKEN: z.string().optional(),
      WHATSAPP_APP_SECRET: z.string().optional(),
      WHATSAPP_VERIFY_TOKEN: z.string().optional(),
    })
    .superRefine((value, ctx) => {
      if (value.WHATSAPP_MODE !== "cloud") return;
      for (const key of [
        "WHATSAPP_ACCESS_TOKEN",
        "WHATSAPP_APP_SECRET",
        "WHATSAPP_VERIFY_TOKEN",
      ] as const) {
        if (!value[key])
          ctx.addIssue({
            code: "custom",
            path: [key],
            message: "required when WHATSAPP_MODE=cloud",
          });
      }
    }),
  anthropic: z.object({
    ANTHROPIC_API_KEY: z.string().min(1),
    AGENT_MODEL: z.string().min(1).default("claude-sonnet-5-5"),
  }),
} as const;

export type EnvGroup = keyof typeof groups;

export function getEnv<G extends EnvGroup>(group: G): z.infer<(typeof groups)[G]> {
  const result = groups[group].safeParse(process.env);
  if (!result.success) {
    const names = result.error.issues.map((issue) => issue.path.join(".")).join(", ");
    throw new Error(`Missing or invalid environment variables for "${group}": ${names}`);
  }
  return result.data as z.infer<(typeof groups)[G]>;
}
```

`src/lib/db.ts`

```ts
import { Pool, type PoolClient } from "pg";
import { getEnv } from "@/lib/env";

const globalForPool = globalThis as unknown as { __dentistasPool?: Pool };

export function getPool(): Pool {
  if (!globalForPool.__dentistasPool) {
    const { DATABASE_URL } = getEnv("core");
    const local = /@(localhost|127\.0\.0\.1)[:/]/.test(DATABASE_URL);
    globalForPool.__dentistasPool = new Pool({
      connectionString: DATABASE_URL,
      max: 5,
      ssl: local ? undefined : { rejectUnauthorized: false },
    });
  }
  return globalForPool.__dentistasPool;
}

export async function closePool(): Promise<void> {
  await globalForPool.__dentistasPool?.end();
  globalForPool.__dentistasPool = undefined;
}

async function inTransaction<T>(
  setup: (client: PoolClient) => Promise<void>,
  fn: (client: PoolClient) => Promise<T>,
): Promise<T> {
  const client = await getPool().connect();
  try {
    await client.query("begin");
    await setup(client);
    const result = await fn(client);
    await client.query("commit");
    return result;
  } catch (error) {
    await client.query("rollback");
    throw error;
  } finally {
    client.release();
  }
}

/** Runs fn as the signed-in user: same role and auth.uid() a PostgREST request would have, so RLS applies. */
export function withTenant<T>(userId: string, fn: (client: PoolClient) => Promise<T>): Promise<T> {
  return inTransaction(async (client) => {
    await client.query(
      "select set_config('request.jwt.claim.sub', $1, true), set_config('request.jwt.claims', $2, true)",
      [userId, JSON.stringify({ sub: userId, role: "authenticated" })],
    );
    await client.query("set local role authenticated");
  }, fn);
}

/** Runs fn as the database owner, bypassing RLS. Only for webhooks, cron and the agent: always scope by clinic_id. */
export function withService<T>(fn: (client: PoolClient) => Promise<T>): Promise<T> {
  return inTransaction(async () => {}, fn);
}

/**
 * Who is acting. Services take an Actor and always filter by actor.clinicId, even when RLS would
 * already do it: a user actor runs under RLS, a service actor (webhook, cron, agent) bypasses it.
 */
export type Actor =
  | { kind: "user"; userId: string; clinicId: string; membershipId: string }
  | { kind: "service"; clinicId: string };

export function runAs<T>(actor: Actor, fn: (client: PoolClient) => Promise<T>): Promise<T> {
  return actor.kind === "user" ? withTenant(actor.userId, fn) : withService(fn);
}
```

`tests/unit/env.test.ts`

```ts
import { afterEach, describe, expect, it } from "vitest";
import { getEnv } from "@/lib/env";

const saved = { ...process.env };
afterEach(() => {
  process.env = { ...saved };
});

describe("getEnv", () => {
  it("names the missing variable and the group", () => {
    delete process.env.DATABASE_URL;
    expect(() => getEnv("core")).toThrow(/"core".*DATABASE_URL/);
  });

  it("does not require a later step's variables", () => {
    process.env.DATABASE_URL = "postgres://x";
    expect(getEnv("core").DATABASE_URL).toBe("postgres://x");
  });

  it("defaults WHATSAPP_MODE to simulator and demands tokens only in cloud mode", () => {
    delete process.env.WHATSAPP_MODE;
    expect(getEnv("whatsapp").WHATSAPP_MODE).toBe("simulator");
    process.env.WHATSAPP_MODE = "cloud";
    expect(() => getEnv("whatsapp")).toThrow(/WHATSAPP_ACCESS_TOKEN/);
  });

  it("rejects a TOKEN_ENC_KEY that is not 32 bytes", () => {
    process.env.TOKEN_ENC_KEY = Buffer.from("short").toString("base64");
    expect(() => getEnv("crypto")).toThrow(/TOKEN_ENC_KEY/);
    process.env.TOKEN_ENC_KEY = Buffer.alloc(32, 1).toString("base64");
    expect(getEnv("crypto").TOKEN_ENC_KEY).toHaveLength(44);
  });
});
```

`tests/db/foundation.test.ts`

```ts
import { afterAll, describe, expect, it } from "vitest";
import { closePool as closeAppPool, runAs, withService, withTenant } from "@/lib/db";
import {
  addMember,
  asUser,
  closePool,
  createClinic,
  createUser,
  pool,
  seedClinic,
} from "./helpers";

afterAll(async () => {
  await closePool();
  await closeAppPool();
});

describe("tenancy foundation", () => {
  it("a member sees only their own clinic and its memberships", async () => {
    const a = await seedClinic();
    const b = await seedClinic();
    const clinics = await asUser(a.admin.userId, (c) => c.query("select id from clinics"));
    expect(clinics.rows).toEqual([{ id: a.clinicId }]);
    const members = await asUser(a.assistant.userId, (c) =>
      c.query("select clinic_id from memberships"),
    );
    expect(members.rows.every((r) => r.clinic_id === a.clinicId)).toBe(true);
    expect(members.rowCount).toBe(3);
    const other = await asUser(b.admin.userId, (c) =>
      c.query("select id from clinics where id = $1", [a.clinicId]),
    );
    expect(other.rowCount).toBe(0);
  });

  it("only an admin can add memberships to a clinic", async () => {
    const a = await seedClinic();
    const newUser = await createUser();
    const insert = (userId: string) =>
      asUser(userId, (c) =>
        c.query(
          "insert into memberships (clinic_id, user_id, role, display_name) values ($1, $2, 'assistant', 'Nueva')",
          [a.clinicId, newUser],
        ),
      );
    await expect(insert(a.dentist.userId)).rejects.toThrow(/row-level security/);
    await insert(a.admin.userId);
  });

  it("a user belongs to at most one clinic", async () => {
    const a = await seedClinic();
    const b = await createClinic();
    await expect(
      pool.query(
        "insert into memberships (clinic_id, user_id, role, display_name) values ($1, $2, 'dentist', 'Doble')",
        [b, a.dentist.userId],
      ),
    ).rejects.toThrow(/duplicate key/);
  });

  it("authenticated can never delete or truncate, and anon has no access", async () => {
    const privilege = async (role: string, table: string, op: string) =>
      (await pool.query("select has_table_privilege($1, $2, $3) as ok", [role, table, op])).rows[0]
        .ok as boolean;
    expect(await privilege("authenticated", "clinics", "DELETE")).toBe(false);
    expect(await privilege("authenticated", "memberships", "TRUNCATE")).toBe(false);
    expect(await privilege("anon", "clinics", "SELECT")).toBe(false);
    const a = await seedClinic();
    await expect(
      asUser(a.admin.userId, (c) =>
        c.query("delete from memberships where clinic_id = $1", [a.clinicId]),
      ),
    ).rejects.toThrow(/permission denied/);
  });

  it("withTenant applies RLS and withService bypasses it", async () => {
    const a = await seedClinic();
    await seedClinic();
    const tenant = await withTenant(a.dentist.userId, (c) => c.query("select id from clinics"));
    expect(tenant.rowCount).toBe(1);
    const service = await withService((c) => c.query("select count(*)::int as n from clinics"));
    expect(service.rows[0].n).toBeGreaterThan(1);
  });

  it("addMember helper creates one membership per role", async () => {
    const clinicId = await createClinic();
    const { membershipId } = await addMember(clinicId, "dentist");
    expect(membershipId).toMatch(/^[0-9a-f-]{36}$/);
  });

  it("runAs picks RLS for a user actor and bypasses it for a service actor", async () => {
    const a = await seedClinic();
    await seedClinic();
    const user = await runAs(
      {
        kind: "user",
        userId: a.assistant.userId,
        clinicId: a.clinicId,
        membershipId: a.assistant.membershipId,
      },
      (c) => c.query("select id from clinics"),
    );
    expect(user.rowCount).toBe(1);
    const service = await runAs({ kind: "service", clinicId: a.clinicId }, (c) =>
      c.query("select id from clinics"),
    );
    expect(service.rowCount).toBeGreaterThan(1);
  });
});
```

Notas: `withTenant` ejecuta como el usuario (RLS activo); `withService` ejecuta como propietario y solo se usa en webhooks, cron y el agente, **siempre filtrando por `clinic_id`**. `Actor`/`runAs` son el tipo que reciben todos los servicios de pasos posteriores.

**Acceptance**
- [ ] WHEN `pnpm test:db tests/db/foundation.test.ts` runs against an empty `dentistas_test` database THE SYSTEM SHALL apply the foundation migration and pass all 7 tests in that file.
- [ ] WHEN a user of clinic A queries `clinics` or `memberships` under the `authenticated` role THE SYSTEM SHALL return only clinic A rows, and WHEN a non-admin inserts a membership THE SYSTEM SHALL reject it with a row-level-security error.
- [ ] WHEN `authenticated` attempts `DELETE` or `TRUNCATE` on any table THE SYSTEM SHALL refuse with `permission denied`, and `anon` SHALL have no `SELECT` on `clinics`.
- [ ] WHEN `getEnv('core')` runs without `DATABASE_URL` THE SYSTEM SHALL throw an error naming the group `core` and the variable, and WHEN no later-step variable is set THE SYSTEM SHALL still load `core` successfully.
- [ ] WHEN `pnpm db:migrate` runs a second time against an already-migrated database THE SYSTEM SHALL exit 0 and print `up to date`.

**Verify**
```bash
pnpm db:up
pnpm test:unit tests/unit/env.test.ts
pnpm test:db tests/db/foundation.test.ts
DATABASE_URL=postgres://postgres:postgres@localhost:54329/dentistas_test pnpm db:migrate | grep -qx 'up to date'
pnpm typecheck
pnpm lint
```

**Checkpoint**
```bash
git add -A && git commit -m "step 2: tenancy-db"
git tag step-02-tenancy-db
git rev-parse --verify step-02-tenancy-db   # expect: a commit id, exit 0
```

---

### E1-T3 — Step 3: Autenticación: proxy, sesión y pantalla de ingreso

| | |
|---|---|
| **Depende de** | `E1-T2` |
| **Prioridad** | p0 |
| **Archivos** | `src/lib/auth-paths.ts`, `src/lib/supabase/server.ts`, `src/proxy.ts`, `src/app/(auth)/login/**`, `tests/unit/auth-paths.test.ts` |
| **Etiqueta** | `step-03-auth-session` |

**Do**
Autenticación con **Supabase Auth (correo + contraseña)**. Supabase solo autentica; los datos van por `src/lib/db.ts`. En Next.js 16 el antiguo `middleware.ts` se llama **`src/proxy.ts`** y exporta `proxy` (verificado: el build lo lista como `Proxy (Middleware)`). Falla **cerrado**: sin configuración de auth, nada privado se sirve.

`src/lib/auth-paths.ts`

```ts
const PUBLIC_PREFIXES = [
  "/login",
  "/registro",
  "/api/health",
  "/api/whatsapp",
  "/api/cron",
  "/api/google/cron",
  "/api/google/oauth/callback",
];

/** Paths that answer without a session. Webhook and cron routes authenticate themselves (signature / bearer secret). */
export function isPublicPath(pathname: string): boolean {
  if (pathname === "/") return true;
  return PUBLIC_PREFIXES.some((prefix) => pathname === prefix || pathname.startsWith(`${prefix}/`));
}

/** Only same-site absolute paths are valid post-login targets; anything else falls back. */
export function safeNext(next: string | null | undefined, fallback = "/pacientes"): string {
  if (!next?.startsWith("/") || next.startsWith("//") || next.includes("\\")) return fallback;
  return next;
}
```

`src/proxy.ts`

```ts
import { createServerClient } from "@supabase/ssr";
import { type NextRequest, NextResponse } from "next/server";
import { isPublicPath } from "@/lib/auth-paths";

export async function proxy(request: NextRequest) {
  const { pathname } = request.nextUrl;
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY;
  if (!url || !key) {
    // Fail closed: without auth configuration nothing private may be served.
    return isPublicPath(pathname)
      ? NextResponse.next()
      : new NextResponse("Authentication is not configured", { status: 503 });
  }

  let response = NextResponse.next({ request });
  const supabase = createServerClient(url, key, {
    cookies: {
      getAll: () => request.cookies.getAll(),
      setAll: (cookiesToSet) => {
        for (const { name, value } of cookiesToSet) request.cookies.set(name, value);
        response = NextResponse.next({ request });
        for (const { name, value, options } of cookiesToSet)
          response.cookies.set(name, value, options);
      },
    },
  });

  // getUser() validates the session with Supabase and refreshes the cookies when needed.
  const { data } = await supabase.auth.getUser();
  if (!data.user && !isPublicPath(pathname)) {
    const login = request.nextUrl.clone();
    login.pathname = "/login";
    login.search = "";
    login.searchParams.set("next", pathname);
    return NextResponse.redirect(login);
  }
  return response;
}

export const config = { matcher: ["/((?!_next/static|_next/image|favicon.ico).*)"] };
```

`src/lib/supabase/server.ts`

```ts
import { createServerClient } from "@supabase/ssr";
import { cookies } from "next/headers";
import { getEnv } from "@/lib/env";

/** Supabase client bound to the request's cookies. Used for authentication only; data goes through src/lib/db.ts. */
export async function supabaseServer() {
  const { NEXT_PUBLIC_SUPABASE_URL: url, NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY: key } =
    getEnv("supabase");
  const store = await cookies();
  return createServerClient(url, key, {
    cookies: {
      getAll: () => store.getAll(),
      setAll: (cookiesToSet) => {
        try {
          for (const { name, value, options } of cookiesToSet) store.set(name, value, options);
        } catch {
          // Called from a Server Component, which cannot set cookies: proxy.ts refreshes the session.
        }
      },
    },
  });
}
```

`tests/unit/auth-paths.test.ts`

```ts
import { NextRequest } from "next/server";
import { afterEach, describe, expect, it } from "vitest";
import { isPublicPath, safeNext } from "@/lib/auth-paths";
import { proxy } from "@/proxy";

describe("isPublicPath", () => {
  it.each([
    "/",
    "/login",
    "/registro",
    "/api/health",
    "/api/whatsapp/webhook",
    "/api/whatsapp/cron",
    "/api/cron/tick",
    "/api/google/cron",
    "/api/google/oauth/callback",
  ])("%s is public", (path) => expect(isPublicPath(path)).toBe(true));
  it.each([
    "/pacientes",
    "/agenda",
    "/api/availability",
    "/loginx",
    "/api/cronjob",
    "/api/google/oauth/start",
    "/api/whatsappx",
  ])("%s is private", (path) => expect(isPublicPath(path)).toBe(false));
});

describe("safeNext", () => {
  it("keeps same-site paths and rejects everything else", () => {
    expect(safeNext("/agenda?dia=1")).toBe("/agenda?dia=1");
    expect(safeNext("//evil.com")).toBe("/pacientes");
    expect(safeNext("https://evil.com")).toBe("/pacientes");
    expect(safeNext("/\\evil.com")).toBe("/pacientes");
    expect(safeNext(null)).toBe("/pacientes");
  });
});

describe("proxy without auth configuration", () => {
  const saved = { ...process.env };
  afterEach(() => {
    process.env = { ...saved };
  });

  it("fails closed on private paths and serves public ones", async () => {
    delete process.env.NEXT_PUBLIC_SUPABASE_URL;
    delete process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY;
    expect((await proxy(new NextRequest("http://localhost/pacientes"))).status).toBe(503);
    expect((await proxy(new NextRequest("http://localhost/api/health"))).status).toBe(200);
  });
});
```

Pantalla de ingreso, en `src/app/(auth)/login/`:
- `actions.ts` (`"use server"`): `signIn(formData)` lee `email`, `password` y `next`; llama `supabase.auth.signInWithPassword`; si falla, `redirect("/login?error=1&next=<next codificado>")`; si no, `redirect(safeNext(next))`. `signOut()` llama `supabase.auth.signOut()` y redirige a `/login`.
- `page.tsx`: formulario accesible (etiquetas `<label>` asociadas, `autocomplete="email"` / `"current-password"`, botón primario). En Next.js 16 `searchParams` es una **Promise**: `const { error, next } = await searchParams`. Si `error` está presente muestra, en un `role="alert"`: "Correo o contraseña incorrectos." Estilo según §7. Enlace a `/registro` ("Registrar mi clínica").

**Acceptance**
- [ ] WHEN `isPublicPath` is called with `/`, `/login`, `/registro`, `/api/health`, `/api/whatsapp/webhook` or `/api/cron/tick` THE SYSTEM SHALL return true, and WHEN called with `/pacientes`, `/api/availability`, `/loginx` or `/api/cronjob` THE SYSTEM SHALL return false.
- [ ] WHEN `safeNext` receives `//evil.com`, `https://evil.com`, `/\evil.com` or null THE SYSTEM SHALL return the fallback `/pacientes`, and WHEN it receives `/agenda?dia=1` THE SYSTEM SHALL return it unchanged.
- [ ] WHEN the proxy runs without `NEXT_PUBLIC_SUPABASE_URL` and a request targets a private path THE SYSTEM SHALL answer 503 (fail closed), and WHEN the path is public THE SYSTEM SHALL answer 200.
- [ ] WHEN `pnpm build` runs THE SYSTEM SHALL exit 0 and the route list SHALL include `/login`.

**Verify**
```bash
pnpm test:unit tests/unit/auth-paths.test.ts
pnpm typecheck
pnpm lint
pnpm build > "${TMPDIR:-/tmp}/dentistas-build.log" 2>&1 && grep -q '/login' "${TMPDIR:-/tmp}/dentistas-build.log"
```

**Checkpoint**
```bash
git add -A && git commit -m "step 3: auth-session"
git tag step-03-auth-session
git rev-parse --verify step-03-auth-session   # expect: a commit id, exit 0
```

---

### E1-T4 — Step 4: Registro de clínica, equipo y roles

| | |
|---|---|
| **Depende de** | `E1-T3` |
| **Prioridad** | p0 |
| **Archivos** | `src/server/session.ts`, `src/server/clinics.ts`, `src/app/(auth)/registro/**`, `src/app/(app)/**`, `tests/db/clinics.test.ts` |
| **Etiqueta** | `step-04-clinics-members` |

**Do**
Registro de la primera clínica, gestión del equipo y el contexto de sesión que usan todos los servicios.

**`src/server/session.ts`** — superficie exacta:

```ts
// src/server/session.ts — exact exported surface
export type Role = "admin" | "dentist" | "assistant";
export type SessionCtx = { userId: string; clinicId: string; membershipId: string; role: Role; displayName: string };
export class ForbiddenError extends Error {}                       // message: "forbidden"
export function membershipForUser(userId: string): Promise<SessionCtx | null>; // withService; null when no ACTIVE membership
export function getSession(): Promise<SessionCtx | null>;           // supabaseServer().auth.getUser() -> membershipForUser
export function requireSession(): Promise<SessionCtx>;              // redirect("/login") when null
export function requireRole(ctx: SessionCtx, ...roles: Role[]): void; // throws ForbiddenError when ctx.role is not listed
export function userActor(ctx: SessionCtx): Extract<Actor, { kind: "user" }>; // { kind: "user", userId, clinicId, membershipId }
```

**`src/server/clinics.ts`**:
```ts
export type AuthAdmin = {
  createUser(input: { email: string; password: string }): Promise<{ id: string }>;
  deleteUser(id: string): Promise<void>;
};
export const supabaseAuthAdmin: AuthAdmin; // usa @supabase/supabase-js con getEnv("supabase") + getEnv("supabaseAdmin") (SUPABASE_SECRET_KEY); createUser con email_confirm: true
export class LastAdminError extends Error {}
export function registerClinic(
  input: { clinicName: string; adminName: string; email: string; password: string },
  auth?: AuthAdmin,                                  // por defecto supabaseAuthAdmin; los tests inyectan uno falso
): Promise<{ clinicId: string; userId: string; membershipId: string }>;
export function addMember(
  actor: Extract<Actor, { kind: "user" }>, role: Role, // el rol del actor se verifica consultando memberships; solo admin
  input: { displayName: string; email: string; password: string; role: Role },
  auth?: AuthAdmin,
): Promise<{ membershipId: string; userId: string }>;
export function listMembers(actor: Extract<Actor, { kind: "user" }>): Promise<Array<{ id: string; displayName: string; role: Role; active: boolean }>>;
export function setMemberActive(actor: Extract<Actor, { kind: "user" }>, role: Role, membershipId: string, active: boolean): Promise<void>; // LastAdminError si deja la clínica sin admin activo
```
Reglas: validar con zod (contraseña ≥ 10 caracteres, correo válido, nombres no vacíos). `registerClinic`: crea el usuario de auth, luego en **una** transacción `withService` inserta clínica + membresía admin; si la transacción falla, `auth.deleteUser(userId)` y relanza. `addMember`/`setMemberActive`: el parámetro `role` es el rol del que llama (viene de `SessionCtx.role`); si no es `admin` lanzan `ForbiddenError` **antes** de tocar `auth`. Para `setMemberActive(false)` sobre un admin: contar admins activos de la clínica con `select ... for update` y lanzar `LastAdminError` si fuera el último.

**Tests** (`tests/db/clinics.test.ts`): usa un `AuthAdmin` falso que inserta en `auth.users` (el stub de §19.6) y devuelve el id; cubre los 6 criterios de aceptación. Para el criterio 2, haz que `createUser` devuelva el id de un usuario que ya tiene membresía (viola `unique(user_id)`) y comprueba que `deleteUser` fue llamado con ese id.

**Interfaz**:
- `src/app/(auth)/registro/`: `page.tsx` + `actions.ts`; formulario (nombre de la clínica, tu nombre, correo, contraseña); la acción llama `registerClinic`, luego `supabase.auth.signInWithPassword` y `redirect("/pacientes")`. Errores de validación se muestran en `role="alert"`.
- `src/app/(app)/layout.tsx`: `requireSession()`; cabecera con el nombre de la clínica, navegación (Pacientes, Agenda, Cotizaciones, Cobros; **Gastos** y **Resumen** solo si `role === "admin"`; Configuración) y botón "Cerrar sesión" (`signOut`). Contenedor de página `max-w-6xl`.
- `src/app/(app)/configuracion/equipo/page.tsx` + `actions.ts`: lista del equipo; solo admin ve el formulario "Agregar miembro" y el botón activar/desactivar; muestra el error de `LastAdminError` en español.

**Acceptance**
- [ ] WHEN `registerClinic` runs with valid input and a fake `AuthAdmin` THE SYSTEM SHALL create one `clinics` row and one `memberships` row with role `admin` for the new user, and return `{ clinicId, userId, membershipId }`.
- [ ] WHEN the database transaction of `registerClinic` fails after the auth user was created THE SYSTEM SHALL call `AuthAdmin.deleteUser` with that user's id and rethrow the original error.
- [ ] WHEN a non-admin calls `addMember` THE SYSTEM SHALL throw `ForbiddenError` and SHALL NOT call `AuthAdmin.createUser`.
- [ ] WHEN the only active admin of a clinic is deactivated THE SYSTEM SHALL throw `LastAdminError` and leave `memberships.active = true`.
- [ ] WHEN `membershipForUser` runs for a user whose membership is inactive THE SYSTEM SHALL return null.
- [ ] WHEN `registerClinic` receives a password shorter than 10 characters THE SYSTEM SHALL throw a `ZodError` naming `password` and create nothing.

**Verify**
```bash
pnpm db:up
pnpm test:db tests/db/clinics.test.ts
pnpm typecheck
pnpm lint
pnpm build
```

**Checkpoint**
```bash
git add -A && git commit -m "step 4: clinics-members"
git tag step-04-clinics-members
git rev-parse --verify step-04-clinics-members   # expect: a commit id, exit 0
```

---

### E1-T5 — Step 5: Pacientes: alta, búsqueda y archivo

| | |
|---|---|
| **Depende de** | `E1-T4` |
| **Prioridad** | p0 |
| **Archivos** | `supabase/migrations/20261020000002_patients.sql`, `src/lib/phone.ts`, `src/server/patients.ts`, `src/app/(app)/pacientes/**`, `tests/db/patients.test.ts` |
| **Etiqueta** | `step-05-patients` |

**Do**
Registro de pacientes (filiación). **Decisión de dominio (a verificar contra NTS 139-MINSA/2018/DGAIN, ver §20.2):** el N° de historia clínica es el número de documento del paciente (`hc_number = doc_number`).

`supabase/migrations/20261020000002_patients.sql`

```sql
-- supabase/migrations/20261020000002_patients.sql
create type doc_type as enum ('DNI', 'CE', 'PASAPORTE', 'OTRO');
create type sex as enum ('F', 'M');

create table patients (
  id uuid primary key default gen_random_uuid(),
  clinic_id uuid not null references clinics (id) on delete restrict,
  hc_number text not null,
  doc_type doc_type not null default 'DNI',
  doc_number text not null check (length(trim(doc_number)) > 0),
  last_name text not null check (length(trim(last_name)) > 0),
  first_name text not null check (length(trim(first_name)) > 0),
  birth_date date,
  birth_place text,
  sex sex,
  marital_status text,
  education_level text,
  occupation text,
  address text,
  phone_e164 text check (phone_e164 is null or phone_e164 ~ '^\+[1-9][0-9]{7,14}$'),
  email text,
  guardian_name text,
  guardian_phone_e164 text check (guardian_phone_e164 is null or guardian_phone_e164 ~ '^\+[1-9][0-9]{7,14}$'),
  whatsapp_opt_in boolean not null default false,
  whatsapp_opt_in_at timestamptz,
  archived_at timestamptz,
  created_by uuid references memberships (id),
  created_at timestamptz not null default now(),
  unique (clinic_id, doc_type, doc_number),
  unique (clinic_id, hc_number),
  check (not whatsapp_opt_in or (phone_e164 is not null and whatsapp_opt_in_at is not null))
);
create index patients_clinic_name_idx on patients (clinic_id, last_name, first_name);
create index patients_clinic_phone_idx on patients (clinic_id, phone_e164);

alter table patients enable row level security;
create policy patients_select on patients for select to authenticated
  using (clinic_id in (select current_clinic_ids()));
create policy patients_insert on patients for insert to authenticated
  with check (clinic_id in (select current_clinic_ids()));
create policy patients_update on patients for update to authenticated
  using (clinic_id in (select current_clinic_ids()))
  with check (clinic_id in (select current_clinic_ids()));
```

**`src/lib/phone.ts`**: `normalizePhonePE(raw: string): string | null`. Quita espacios, guiones y paréntesis; si empieza con `+` y el resto son 8 a 14 dígitos, devuélvelo; si son 9 dígitos que empiezan con 9, antepón `+51`; si son 11 dígitos que empiezan con `51`, antepón `+`; en otro caso `null`.

**`src/server/patients.ts`** (todas las funciones reciben `actor: Actor` y filtran por `actor.clinicId`; usan `runAs`):
```ts
export const patientInput: z.ZodType<PatientInput>; // zod
// docType: "DNI" | "CE" | "PASAPORTE" | "OTRO"; docNumber: DNI => /^\d{8}$/, CE => 9-12 alfanuméricos, otros => no vacío
// lastName, firstName: no vacíos (trim); birthDate?: "YYYY-MM-DD"; sex?: "F" | "M"; birthPlace?, maritalStatus?, educationLevel?,
// occupation?, address?, email?, guardianName?; phone?, guardianPhone?: string (se normaliza con normalizePhonePE; inválido => error de zod en ese campo);
// whatsappOptIn: boolean (default false) => requiere phone
export class DuplicatePatientError extends Error {}   // SQLSTATE 23505 sobre unique (clinic_id, doc_type, doc_number)
export function createPatient(actor: Actor, input: unknown): Promise<Patient>;     // hc_number = docNumber; created_by = membershipId si el actor es de usuario
export function updatePatient(actor: Actor, id: string, patch: unknown): Promise<Patient>; // misma validación parcial; no cambia doc ni hc
export function archivePatient(actor: Actor, id: string): Promise<void>;
export function getPatient(actor: Actor, id: string): Promise<Patient | null>;
export function searchPatients(actor: Actor, opts?: { q?: string; includeArchived?: boolean; limit?: number }): Promise<Patient[]>; // ILIKE %q% en last_name, first_name, doc_number; orden last_name, first_name; limit 25
```
`Patient` es el tipo camelCase del registro (id, clinicId, hcNumber, docType, docNumber, lastName, firstName, birthDate, sex, phoneE164, email, whatsappOptIn, archivedAt, …).

**Tests** (`tests/db/patients.test.ts`): los 7 criterios de aceptación, con `seedClinic()` y `runAs({ kind: "user", ... })`; el criterio de `normalizePhonePE` como tabla con `it.each`.

**Interfaz** (`src/app/(app)/pacientes/`): `page.tsx` con buscador (`<input type="search">` con etiqueta) y tabla (HC, apellidos y nombres, teléfono, acciones); `nuevo/page.tsx` con el formulario de filiación (agrupado en secciones "Identificación", "Contacto", "Datos personales", casilla "Acepta recordatorios por WhatsApp"); `[id]/page.tsx` con la ficha y botón "Archivar". `params` es una Promise en Next.js 16. Estados: vacío ("Aún no hay pacientes"), carga y error con `role="alert"`.

**Acceptance**
- [ ] WHEN `createPatient` receives document type DNI, number `12345678` and the phone `987 654 321`, `+51 987-654-321` or `51987654321` THE SYSTEM SHALL store `phone_e164 = '+51987654321'` and `hc_number = '12345678'`, and WHEN the phone is `12345` THE SYSTEM SHALL throw a `ZodError` naming `phone`.
- [ ] WHEN a DNI is not exactly 8 digits THE SYSTEM SHALL throw a `ZodError` naming `docNumber` and insert no row.
- [ ] WHEN `createPatient` is called twice with the same document type and number in one clinic THE SYSTEM SHALL throw `DuplicatePatientError`, and WHEN the same document is registered in another clinic THE SYSTEM SHALL succeed.
- [ ] WHEN `whatsappOptIn` is true without a phone THE SYSTEM SHALL reject with a `ZodError`, and WHEN it is true with a phone THE SYSTEM SHALL set `whatsapp_opt_in_at` to the current time.
- [ ] WHEN `searchPatients` receives the text `pere` THE SYSTEM SHALL return patients whose last name, first name or document number contains it (case-insensitive), only from the actor's clinic.
- [ ] WHEN `archivePatient` runs THE SYSTEM SHALL set `archived_at`, exclude that patient from the default search, and keep the row.

**Verify**
```bash
pnpm db:up
pnpm test:db tests/db/patients.test.ts
pnpm typecheck
pnpm lint
pnpm build
```

**Checkpoint**
```bash
git add -A && git commit -m "step 5: patients"
git tag step-05-patients
git rev-parse --verify step-05-patients   # expect: a commit id, exit 0
```

---

### E1-T6 — Step 6: Historia clínica y odontograma (solo se agrega)

| | |
|---|---|
| **Depende de** | `E1-T5` |
| **Prioridad** | p0 |
| **Archivos** | `supabase/migrations/20261020000003_clinical.sql`, `src/server/clinical.ts`, `src/app/(app)/pacientes/[id]/historia/**`, `tests/db/clinical.test.ts`, `tests/db/clinical-service.test.ts` |
| **Etiqueta** | `step-06-clinical-record` |

**Do**
Historia clínica. **Regla central: es de solo agregar.** Un trigger prohíbe `UPDATE`/`DELETE` incluso al rol propietario; las correcciones son filas nuevas (`nota_correccion`) que apuntan a la corregida. Cada apertura de una historia queda registrada en `record_access_log` (quién y cuándo). Los asistentes **no** leen la historia clínica; dentistas y admin sí.

`supabase/migrations/20261020000003_clinical.sql`

```sql
-- supabase/migrations/20261020000003_clinical.sql
-- Clinical record: append-only. Corrections are new rows that point at the row they correct.
create type clinical_entry_kind as enum
  ('anamnesis', 'examen', 'diagnostico', 'tratamiento', 'evolucion', 'consentimiento', 'nota_correccion');

create table clinical_entries (
  id uuid primary key default gen_random_uuid(),
  clinic_id uuid not null references clinics (id) on delete restrict,
  patient_id uuid not null references patients (id) on delete restrict,
  kind clinical_entry_kind not null,
  body jsonb not null check (jsonb_typeof(body) = 'object'),
  author_membership_id uuid not null references memberships (id),
  corrects_entry_id uuid references clinical_entries (id),
  created_at timestamptz not null default now(),
  check ((kind = 'nota_correccion') = (corrects_entry_id is not null))
);
create index clinical_entries_patient_idx on clinical_entries (patient_id, created_at);

create table odontogram_marks (
  id uuid primary key default gen_random_uuid(),
  clinic_id uuid not null references clinics (id) on delete restrict,
  patient_id uuid not null references patients (id) on delete restrict,
  tooth_fdi smallint not null check (
    tooth_fdi between 11 and 18 or tooth_fdi between 21 and 28 or
    tooth_fdi between 31 and 38 or tooth_fdi between 41 and 48 or
    tooth_fdi between 51 and 55 or tooth_fdi between 61 and 65 or
    tooth_fdi between 71 and 75 or tooth_fdi between 81 and 85
  ),
  surface text check (surface is null or surface in ('M', 'D', 'O', 'V', 'L', 'P', 'I')),
  condition text not null check (length(trim(condition)) > 0),
  note text,
  author_membership_id uuid not null references memberships (id),
  created_at timestamptz not null default now()
);
create index odontogram_patient_idx on odontogram_marks (patient_id, tooth_fdi, created_at);

create table record_access_log (
  id bigint generated always as identity primary key,
  clinic_id uuid not null references clinics (id) on delete restrict,
  patient_id uuid not null references patients (id) on delete restrict,
  membership_id uuid not null references memberships (id),
  accessed_at timestamptz not null default now()
);
create index record_access_patient_idx on record_access_log (patient_id, accessed_at);

create function forbid_mutation() returns trigger language plpgsql as $$
begin
  raise exception '% on % is not allowed: this table is append-only', tg_op, tg_table_name
    using errcode = 'restrict_violation';
end $$;

create trigger clinical_entries_append_only before update or delete on clinical_entries
  for each row execute function forbid_mutation();
create trigger odontogram_marks_append_only before update or delete on odontogram_marks
  for each row execute function forbid_mutation();
create trigger record_access_log_append_only before update or delete on record_access_log
  for each row execute function forbid_mutation();

revoke update on clinical_entries, odontogram_marks, record_access_log from authenticated;

alter table clinical_entries enable row level security;
alter table odontogram_marks enable row level security;
alter table record_access_log enable row level security;

-- Assistants may read patients but not the clinical record; dentists and admins may read and write it.
create policy clinical_entries_select on clinical_entries for select to authenticated
  using (current_role_in(clinic_id) in ('admin', 'dentist'));
create policy clinical_entries_insert on clinical_entries for insert to authenticated
  with check (current_role_in(clinic_id) in ('admin', 'dentist'));
create policy odontogram_select on odontogram_marks for select to authenticated
  using (current_role_in(clinic_id) in ('admin', 'dentist'));
create policy odontogram_insert on odontogram_marks for insert to authenticated
  with check (current_role_in(clinic_id) in ('admin', 'dentist'));
create policy access_log_select on record_access_log for select to authenticated
  using (is_clinic_admin(clinic_id));
create policy access_log_insert on record_access_log for insert to authenticated
  with check (current_role_in(clinic_id) in ('admin', 'dentist'));
```

`tests/db/clinical.test.ts`

```ts
import { afterAll, describe, expect, it } from "vitest";
import { asUser, closePool, createPatientRow, pool, seedClinic } from "./helpers";

afterAll(closePool);

const entry = (clinicId: string, patientId: string, authorId: string, kind = "evolucion") =>
  pool.query<{ id: string }>(
    'insert into clinical_entries (clinic_id, patient_id, kind, body, author_membership_id) values ($1, $2, $3, \'{"texto":"x"}\', $4) returning id',
    [clinicId, patientId, kind, authorId],
  );

describe("clinical record", () => {
  it("assistants cannot read it; dentists and admins can", async () => {
    const a = await seedClinic();
    const patientId = await createPatientRow(a.clinicId);
    await entry(a.clinicId, patientId, a.dentist.membershipId);
    expect(
      (await asUser(a.assistant.userId, (c) => c.query("select id from clinical_entries")))
        .rowCount,
    ).toBe(0);
    expect(
      (await asUser(a.dentist.userId, (c) => c.query("select id from clinical_entries"))).rowCount,
    ).toBe(1);
    expect(
      (await asUser(a.admin.userId, (c) => c.query("select id from clinical_entries"))).rowCount,
    ).toBe(1);
  });

  it("another clinic's dentist sees nothing", async () => {
    const a = await seedClinic();
    const b = await seedClinic();
    await entry(a.clinicId, await createPatientRow(a.clinicId), a.dentist.membershipId);
    expect(
      (await asUser(b.dentist.userId, (c) => c.query("select id from clinical_entries"))).rowCount,
    ).toBe(0);
  });

  it("entries are append-only: update and delete are refused, even for the owner role", async () => {
    const a = await seedClinic();
    const { rows } = await entry(
      a.clinicId,
      await createPatientRow(a.clinicId),
      a.dentist.membershipId,
    );
    const id = rows[0]?.id;
    await expect(
      pool.query("update clinical_entries set body = '{}' where id = $1", [id]),
    ).rejects.toThrow(/append-only/);
    await expect(pool.query("delete from clinical_entries where id = $1", [id])).rejects.toThrow(
      /append-only/,
    );
  });

  it("a correction note must point at the entry it corrects, and nothing else may", async () => {
    const a = await seedClinic();
    const patientId = await createPatientRow(a.clinicId);
    const { rows } = await entry(a.clinicId, patientId, a.dentist.membershipId);
    await expect(
      entry(a.clinicId, patientId, a.dentist.membershipId, "nota_correccion"),
    ).rejects.toThrow(/check constraint/);
    await pool.query(
      "insert into clinical_entries (clinic_id, patient_id, kind, body, author_membership_id, corrects_entry_id) values ($1, $2, 'nota_correccion', '{\"texto\":\"fe de erratas\"}', $3, $4)",
      [a.clinicId, patientId, a.dentist.membershipId, rows[0]?.id],
    );
  });

  it("odontogram marks accept only valid FDI teeth and surfaces", async () => {
    const a = await seedClinic();
    const patientId = await createPatientRow(a.clinicId);
    const mark = (tooth: number, surface: string | null) =>
      pool.query(
        "insert into odontogram_marks (clinic_id, patient_id, tooth_fdi, surface, condition, author_membership_id) values ($1, $2, $3, $4, 'caries', $5)",
        [a.clinicId, patientId, tooth, surface, a.dentist.membershipId],
      );
    await mark(18, "O");
    await mark(85, null);
    await expect(mark(19, "O")).rejects.toThrow(/check constraint/);
    await expect(mark(11, "X")).rejects.toThrow(/check constraint/);
  });

  it("the access log is append-only and visible to admins only", async () => {
    const a = await seedClinic();
    const patientId = await createPatientRow(a.clinicId);
    await asUser(a.dentist.userId, (c) =>
      c.query(
        "insert into record_access_log (clinic_id, patient_id, membership_id) values ($1, $2, $3)",
        [a.clinicId, patientId, a.dentist.membershipId],
      ),
    );
    expect(
      (await asUser(a.dentist.userId, (c) => c.query("select id from record_access_log"))).rowCount,
    ).toBe(0);
    expect(
      (await asUser(a.admin.userId, (c) => c.query("select id from record_access_log"))).rowCount,
    ).toBe(1);
    await expect(pool.query("delete from record_access_log")).rejects.toThrow(/append-only/);
  });
});
```

**`src/server/clinical.ts`** (solo actores de usuario: `Extract<Actor, { kind: "user" }>`; el servicio consulta el rol de la membresía y lanza `ForbiddenError` —de `src/server/session.ts`— para `assistant` **antes** de escribir nada):
```ts
export const ENTRY_KINDS = ["anamnesis","examen","diagnostico","tratamiento","evolucion","consentimiento"] as const;
// Esquemas zod por tipo de entrada (todos los campos de texto: trim, máx. 4000 caracteres):
//  anamnesis:      { motivoConsulta: string (requerido), enfermedadActual?, antecedentesPersonales?, antecedentesFamiliares?, alergias?, medicacionActual? }
//  examen:         { extraoral?, intraoral?, funcionesVitales?: { presionArterial?: string, pulso?: string, temperatura?: string } }  (al menos un campo)
//  diagnostico:    { items: [{ descripcion: string, cie10?: string }] (1..20) }
//  tratamiento:    { items: [{ descripcion: string, pieza?: number (FDI) }] (1..20), plan?: string }
//  evolucion:      { texto: string }
//  consentimiento: { procedimiento: string, texto: string, aceptadoPor: string, fecha: "YYYY-MM-DD" }
export function addEntry(actor: UserActor, patientId: string, kind: (typeof ENTRY_KINDS)[number], body: unknown): Promise<{ id: string }>;
export function correctEntry(actor: UserActor, entryId: string, texto: string): Promise<{ id: string }>; // inserta kind='nota_correccion', corrects_entry_id=entryId, body {texto}
export function openRecord(actor: UserActor, patientId: string): Promise<{ patient: Patient; entries: Entry[]; odontogram: OdontogramMark[] }>; // 1 fila en record_access_log por llamada; entries ordenadas por created_at asc
export function addOdontogramMark(actor: UserActor, patientId: string, mark: { tooth: number; surface?: "M"|"D"|"O"|"V"|"L"|"P"|"I"; condition: string; note?: string }): Promise<{ id: string }>;
export function currentOdontogram(actor: UserActor, patientId: string): Promise<OdontogramMark[]>; // distinct on (tooth_fdi, surface) por created_at desc
```
`UserActor = Extract<Actor, { kind: "user" }>`. El rol se obtiene con `select role from memberships where id = $actor.membershipId`.

**Tests de servicio** (`tests/db/clinical-service.test.ts`): los criterios 2 a 6 de aceptación con `seedClinic()` y un paciente creado con `createPatient` (paso 5).

**Interfaz** (`src/app/(app)/pacientes/[id]/historia/`): `page.tsx` (llama `openRecord`; si `ForbiddenError`, muestra "Tu rol no tiene acceso a la historia clínica"); línea de tiempo de entradas con su tipo, autor, fecha y hora de Lima, y las notas de corrección **debajo** de la entrada corregida; formularios por tipo (`actions.ts`); odontograma como cuadrícula FDI (16 dientes superiores, 16 inferiores) con la última condición por pieza, accesible por teclado (cada pieza es un `<button>` con `aria-label="Pieza 18, caries"`).

**Acceptance**
- [ ] WHEN `pnpm test:db tests/db/clinical.test.ts` runs THE SYSTEM SHALL pass all 6 tests, proving that assistants cannot read clinical entries, that updating or deleting an entry is refused with `append-only`, and that invalid FDI teeth are rejected.
- [ ] WHEN `addEntry` receives a valid `anamnesis` body THE SYSTEM SHALL insert one `clinical_entries` row authored by the actor's membership, and WHEN the body fails its zod schema THE SYSTEM SHALL throw a `ZodError` and insert nothing.
- [ ] WHEN `openRecord` runs THE SYSTEM SHALL insert exactly one `record_access_log` row for the actor's membership and that patient, per call.
- [ ] WHEN an actor with role `assistant` calls `openRecord` or `addEntry` THE SYSTEM SHALL throw `ForbiddenError` and write no log row.
- [ ] WHEN `correctEntry` runs THE SYSTEM SHALL insert a `nota_correccion` row whose `corrects_entry_id` is the original entry, and the original row SHALL remain byte-identical.
- [ ] WHEN `currentOdontogram` runs after two marks on the same tooth and surface THE SYSTEM SHALL return only the later mark for that tooth and surface.

**Verify**
```bash
pnpm db:up
pnpm test:db tests/db/clinical.test.ts
pnpm test:db tests/db/clinical-service.test.ts
pnpm typecheck
pnpm lint
pnpm build
```

**Checkpoint**
```bash
git add -A && git commit -m "step 6: clinical-record"
git tag step-06-clinical-record
git rev-parse --verify step-06-clinical-record   # expect: a commit id, exit 0
```

---

## Aceptación de la épica
- [ ] `step-01-scaffold` existe en git (`git rev-parse --verify step-01-scaffold` sale 0).
- [ ] `step-02-tenancy-db` existe en git (`git rev-parse --verify step-02-tenancy-db` sale 0).
- [ ] `step-03-auth-session` existe en git (`git rev-parse --verify step-03-auth-session` sale 0).
- [ ] `step-04-clinics-members` existe en git (`git rev-parse --verify step-04-clinics-members` sale 0).
- [ ] `step-05-patients` existe en git (`git rev-parse --verify step-05-patients` sale 0).
- [ ] `step-06-clinical-record` existe en git (`git rev-parse --verify step-06-clinical-record` sale 0).
- [ ] `pnpm typecheck && pnpm lint && pnpm test` salen 0 sobre el árbol resultante.
