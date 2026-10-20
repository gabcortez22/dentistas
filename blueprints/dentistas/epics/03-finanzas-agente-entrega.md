# Épica 03: Finanzas, agente de WhatsApp y entrega

> Existen cotizaciones con PDF, cobros, gastos, el agente de WhatsApp con simulador, CI y datos de demostración.

| | |
|---|---|
| **Id de la épica** | `03-finanzas-agente-entrega` |
| **Tareas** | `E3-T1` … `E3-T7` (pasos 12 a 18 de 18) |
| **Depende de épicas** | `01-fundacion-pacientes-historia`, `02-agenda-recordatorios` |

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

### E3-T1 — Step 12: Catálogo de tratamientos y cotizaciones

| | |
|---|---|
| **Depende de** | `E1-T5`, `E1-T4` |
| **Prioridad** | p0 |
| **Archivos** | `supabase/migrations/20261020000007_quotes.sql`, `src/lib/money.ts`, `src/server/quotes.ts`, `src/app/(app)/cotizaciones/**`, `tests/db/quotes*.test.ts` |
| **Etiqueta** | `step-12-quotes` |

**Do**
Cotizaciones del dentista o la clínica hacia el paciente, con catálogo de tratamientos. **Dinero siempre en céntimos enteros de PEN** (precios con IGV incluido; las cotizaciones son referenciales y **no** son comprobantes SUNAT). Estados: `draft → sent → accepted | rejected | expired` (y `draft → expired`); el trigger de la base de datos impide cualquier otro salto.

`supabase/migrations/20261020000007_quotes.sql`

```sql
-- supabase/migrations/20261020000007_quotes.sql
create type quote_status as enum ('draft', 'sent', 'accepted', 'rejected', 'expired');

create table treatments (
  id uuid primary key default gen_random_uuid(),
  clinic_id uuid not null references clinics (id) on delete restrict,
  name text not null check (length(trim(name)) > 0),
  default_price_cents integer not null check (default_price_cents >= 0),
  duration_minutes smallint not null default 30 check (duration_minutes between 5 and 480),
  active boolean not null default true,
  created_at timestamptz not null default now(),
  unique (clinic_id, name)
);

create table quote_counters (
  clinic_id uuid primary key references clinics (id) on delete restrict,
  last_number integer not null default 0
);

create table quotes (
  id uuid primary key default gen_random_uuid(),
  clinic_id uuid not null references clinics (id) on delete restrict,
  patient_id uuid not null references patients (id) on delete restrict,
  number integer not null,
  status quote_status not null default 'draft',
  valid_until date not null,
  discount_cents integer not null default 0 check (discount_cents >= 0),
  notes text,
  created_by uuid not null references memberships (id),
  created_at timestamptz not null default now(),
  unique (clinic_id, number)
);
create index quotes_patient_idx on quotes (patient_id, created_at);

create table quote_items (
  id uuid primary key default gen_random_uuid(),
  clinic_id uuid not null references clinics (id) on delete restrict,
  quote_id uuid not null references quotes (id) on delete restrict,
  treatment_id uuid references treatments (id),
  description text not null check (length(trim(description)) > 0),
  tooth_fdi smallint,
  quantity smallint not null default 1 check (quantity between 1 and 99),
  unit_price_cents integer not null check (unit_price_cents >= 0)
);
create index quote_items_quote_idx on quote_items (quote_id);

-- Next quote number for a clinic. Row lock on the counter serialises concurrent callers.
create function next_quote_number(p_clinic uuid) returns integer
language plpgsql security definer set search_path = public as $$
declare n integer;
begin
  if p_clinic not in (select current_clinic_ids()) then
    raise exception 'not a member of clinic %', p_clinic using errcode = 'insufficient_privilege';
  end if;
  insert into quote_counters (clinic_id, last_number) values (p_clinic, 1)
  on conflict (clinic_id) do update set last_number = quote_counters.last_number + 1
  returning last_number into n;
  return n;
end $$;

-- Only forward transitions: draft -> sent -> accepted | rejected | expired (and draft -> expired).
create function guard_quote_status() returns trigger language plpgsql as $$
begin
  if new.status = old.status then return new; end if;
  if not (
    (old.status = 'draft' and new.status in ('sent', 'expired')) or
    (old.status = 'sent' and new.status in ('accepted', 'rejected', 'expired'))
  ) then
    raise exception 'invalid quote status change % -> %', old.status, new.status
      using errcode = 'check_violation';
  end if;
  return new;
end $$;
create trigger quotes_status_guard before update of status on quotes
  for each row execute function guard_quote_status();

alter table treatments enable row level security;
alter table quote_counters enable row level security;
alter table quotes enable row level security;
alter table quote_items enable row level security;
revoke all on quote_counters from authenticated;

create policy treatments_select on treatments for select to authenticated
  using (clinic_id in (select current_clinic_ids()));
create policy treatments_insert on treatments for insert to authenticated
  with check (is_clinic_admin(clinic_id));
create policy treatments_update on treatments for update to authenticated
  using (is_clinic_admin(clinic_id)) with check (is_clinic_admin(clinic_id));
create policy quotes_select on quotes for select to authenticated
  using (current_role_in(clinic_id) in ('admin', 'dentist'));
create policy quotes_insert on quotes for insert to authenticated
  with check (current_role_in(clinic_id) in ('admin', 'dentist'));
create policy quotes_update on quotes for update to authenticated
  using (current_role_in(clinic_id) in ('admin', 'dentist'))
  with check (current_role_in(clinic_id) in ('admin', 'dentist'));
create policy quote_items_select on quote_items for select to authenticated
  using (current_role_in(clinic_id) in ('admin', 'dentist'));
create policy quote_items_insert on quote_items for insert to authenticated
  with check (current_role_in(clinic_id) in ('admin', 'dentist'));
create policy quote_items_update on quote_items for update to authenticated
  using (current_role_in(clinic_id) in ('admin', 'dentist'))
  with check (current_role_in(clinic_id) in ('admin', 'dentist'));
```

`tests/db/quotes.test.ts`

```ts
import { afterAll, describe, expect, it } from "vitest";
import { asUser, closePool, createPatientRow, pool, seedClinic } from "./helpers";

afterAll(closePool);

async function quote(a: Awaited<ReturnType<typeof seedClinic>>) {
  const patientId = await createPatientRow(a.clinicId);
  const { rows } = await pool.query<{ id: string }>(
    "insert into quotes (clinic_id, patient_id, number, valid_until, created_by) values ($1, $2, 1, current_date + 30, $3) returning id",
    [a.clinicId, patientId, a.dentist.membershipId],
  );
  return { patientId, quoteId: rows[0]?.id as string };
}

describe("quotes", () => {
  it("numbers are sequential per clinic and only members can draw one", async () => {
    const a = await seedClinic();
    const b = await seedClinic();
    const next = async (userId: string, clinicId: string) =>
      (await asUser(userId, (c) => c.query("select next_quote_number($1) as n", [clinicId])))
        .rows[0].n as number;
    expect([
      await next(a.dentist.userId, a.clinicId),
      await next(a.dentist.userId, a.clinicId),
    ]).toEqual([1, 2]);
    expect(await next(b.dentist.userId, b.clinicId)).toBe(1);
    await expect(next(b.dentist.userId, a.clinicId)).rejects.toThrow(/not a member/);
  });

  it("status only moves forward: draft -> sent -> accepted, never draft -> accepted or back", async () => {
    const a = await seedClinic();
    const { quoteId } = await quote(a);
    const set = (status: string) =>
      pool.query("update quotes set status = $2 where id = $1", [quoteId, status]);
    await expect(set("accepted")).rejects.toThrow(/invalid quote status change/);
    await set("sent");
    await expect(set("draft")).rejects.toThrow(/invalid quote status change/);
    await set("accepted");
    await expect(set("rejected")).rejects.toThrow(/invalid quote status change/);
  });

  it("assistants cannot read quotes; dentists can; other clinics cannot", async () => {
    const a = await seedClinic();
    const b = await seedClinic();
    await quote(a);
    expect(
      (await asUser(a.assistant.userId, (c) => c.query("select id from quotes"))).rowCount,
    ).toBe(0);
    expect((await asUser(a.dentist.userId, (c) => c.query("select id from quotes"))).rowCount).toBe(
      1,
    );
    expect((await asUser(b.dentist.userId, (c) => c.query("select id from quotes"))).rowCount).toBe(
      0,
    );
  });

  it("only admins manage the treatment catalog", async () => {
    const a = await seedClinic();
    const add = (userId: string) =>
      asUser(userId, (c) =>
        c.query(
          "insert into treatments (clinic_id, name, default_price_cents) values ($1, 'Limpieza', 8000)",
          [a.clinicId],
        ),
      );
    await expect(add(a.dentist.userId)).rejects.toThrow(/row-level security/);
    await add(a.admin.userId);
    await expect(add(a.admin.userId)).rejects.toThrow(/duplicate key/);
  });
});
```

**`src/lib/money.ts`**:
```ts
export class InvalidDiscountError extends Error {}
export function quoteTotals(items: Array<{ quantity: number; unitPriceCents: number }>, discountCents: number): { subtotalCents: number; discountCents: number; totalCents: number }; // descuento > subtotal => InvalidDiscountError
export function formatPEN(cents: number): string;   // "S/ 120.50" (siempre dos decimales, separador de miles con coma)
export function parsePEN(input: string): number | null; // "120.5", "S/ 1,200.50" => céntimos; negativo o no numérico => null
```

**`src/server/quotes.ts`** (actores de usuario; roles `admin` y `dentist` únicamente, otro rol ⇒ `ForbiddenError` de `src/server/session.ts`; el rol se consulta en `memberships`):
```ts
export class QuoteLockedError extends Error {}
export type QuoteItemInput = { treatmentId?: string; description: string; toothFdi?: number; quantity: number; unitPriceCents: number };
export function saveTreatment(actor: Extract<Actor, { kind: "user" }>, input: { id?: string; name: string; defaultPriceCents: number; durationMinutes: number; active?: boolean }): Promise<{ id: string }>; // solo admin (RLS lo exige; mapear a ForbiddenError)
export function listTreatments(actor: Actor, opts?: { activeOnly?: boolean }): Promise<Treatment[]>;
export function createQuote(actor: Extract<Actor, { kind: "user" }>, input: { patientId: string; validUntil?: string; discountCents?: number; notes?: string; items: QuoteItemInput[] }): Promise<{ id: string; number: number }>;
// number = select next_quote_number(clinic) en la misma transacción (withTenant); validUntil por defecto = hoy de Lima + 30 días; 1..50 ítems; valida con quoteTotals.
export function updateDraftQuote(actor: Extract<Actor, { kind: "user" }>, id: string, patch: Partial<{ validUntil: string; discountCents: number; notes: string; items: QuoteItemInput[] }>): Promise<void>; // si status != 'draft' => QuoteLockedError; si patch.items viene, reemplaza TODOS los ítems del borrador (ver nota); revalida con quoteTotals
export function setQuoteStatus(actor: Extract<Actor, { kind: "user" }>, id: string, status: "sent" | "accepted" | "rejected" | "expired"): Promise<void>; // el trigger valida; mapear check_violation a Error("invalid quote status change")
export function getQuote(actor: Extract<Actor, { kind: "user" }>, id: string): Promise<{ quote: Quote; items: QuoteItem[]; totals: ReturnType<typeof quoteTotals> } | null>;
export function listQuotes(actor: Extract<Actor, { kind: "user" }>, opts?: { patientId?: string; status?: string }): Promise<Quote[]>;
export function expireOverdueQuotes(opts?: { now?: Date }): Promise<number>; // withService; devuelve cuántas expiró
```
Nota sobre ítems en borrador: `authenticated` no tiene `DELETE`. Para reemplazar los ítems, primero verifica con `withTenant` que el actor ve la cotización y que está en `draft`, y ejecuta el borrado y la inserción de ítems con `withService` (propietario) filtrando por `quote_id` y `clinic_id`. Es la única excepción a "nadie borra": los ítems de un borrador no son un registro histórico.

**Tests de servicio** (`tests/db/quotes-service.test.ts`): los criterios 2 a 6.

**Interfaz** (`src/app/(app)/cotizaciones/`): lista con filtros por estado; `nueva/page.tsx` (elegir paciente, agregar ítems desde el catálogo o libres, descuento, vigencia; total en vivo con `quoteTotals` y `formatPEN`); `[id]/page.tsx` (detalle; botones "Marcar enviada", "Aceptada", "Rechazada" según el estado; enlace "Descargar PDF" que apunta a `/api/quotes/<id>/pdf`, creado en el paso 13); `catalogo/page.tsx` (solo admin: alta y edición de tratamientos con precio y duración).

**Acceptance**
- [ ] WHEN `pnpm test:db tests/db/quotes.test.ts` runs THE SYSTEM SHALL pass all 4 tests: sequential per-clinic numbers, forward-only status changes, role-limited reads, and an admin-only treatment catalog.
- [ ] WHEN `quoteTotals` receives items `2 x 5000` and `1 x 3000` cents with a discount of 1000 THE SYSTEM SHALL return subtotal 13000, discount 1000 and total 12000, and WHEN the discount exceeds the subtotal THE SYSTEM SHALL throw `InvalidDiscountError`.
- [ ] WHEN `createQuote` runs twice in one clinic THE SYSTEM SHALL assign numbers 1 and 2, and the quote SHALL start as `draft` with `valid_until` defaulting to 30 days from today in `America/Lima`.
- [ ] WHEN `updateDraftQuote` runs on a quote whose status is not `draft` THE SYSTEM SHALL throw `QuoteLockedError` and change nothing.
- [ ] WHEN `expireOverdueQuotes` runs THE SYSTEM SHALL set `expired` on every `draft` or `sent` quote whose `valid_until` is before today in Lima and leave `accepted` and `rejected` quotes untouched.
- [ ] WHEN an `assistant` calls `createQuote` or `listQuotes` THE SYSTEM SHALL throw `ForbiddenError`.

**Verify**
```bash
pnpm db:up
pnpm test:db tests/db/quotes.test.ts
pnpm test:db tests/db/quotes-service.test.ts
pnpm typecheck
pnpm lint
pnpm build
```

**Checkpoint**
```bash
git add -A && git commit -m "step 12: quotes"
git tag step-12-quotes
git rev-parse --verify step-12-quotes   # expect: a commit id, exit 0
```

---

### E3-T2 — Step 13: PDF de la cotización

| | |
|---|---|
| **Depende de** | `E3-T1` |
| **Prioridad** | p1 |
| **Archivos** | `src/lib/pdf/quote-document.tsx`, `src/app/api/quotes/[id]/pdf/route.ts`, `tests/unit/quote-pdf.test.ts`, `tests/db/quote-pdf-route.test.ts` |
| **Etiqueta** | `step-13-quote-pdf` |

**Do**
PDF descargable de una cotización con `@react-pdf/renderer` (renderiza en Node; `serverExternalPackages` ya lo excluye del bundle, §19.6).

**`src/lib/pdf/quote-document.tsx`**:
```ts
export type QuotePdfData = { clinicName: string; patientName: string; patientDocument: string; number: number; createdAt: Date; validUntil: string; notes?: string; items: Array<{ description: string; toothFdi?: number; quantity: number; unitPriceCents: number }>; discountCents: number };
export function renderQuotePdf(data: QuotePdfData): Promise<Buffer>; // renderToBuffer(<QuoteDocument … />)
```
Diseño: A4, fuente integrada Helvetica (sin descargas de red), encabezado con el nombre de la clínica y "COTIZACIÓN N° <número con ceros a la izquierda, 6 dígitos>", datos del paciente, tabla (Descripción · Pieza · Cant. · P. unit. · Subtotal), subtotal, descuento, **total en soles** con `formatPEN`, vigencia, notas y pie fijo: "Cotización referencial. No constituye comprobante de pago." Color de acento `#0f766e`.

**`src/app/api/quotes/[id]/pdf/route.ts`**: `export async function GET(request: Request, { params }: { params: Promise<{ id: string }> })`. Sin sesión ⇒ 401; rol `assistant` ⇒ 403; `getQuote` (paso 12) nulo ⇒ 404 (RLS oculta cotizaciones de otras clínicas); si no, `renderQuotePdf` con los datos de la cotización, el paciente (`getPatient`) y la clínica, y responde con `new Response(buffer, { headers })` con `Content-Type: application/pdf` y `Content-Disposition: inline; filename="cotizacion-<n>.pdf"`.

**Tests**: `tests/unit/quote-pdf.test.ts` (criterios 1 y 2) y `tests/db/quote-pdf-route.test.ts` (criterios 3 a 5, con `vi.mock("@/server/session")` y datos creados con los servicios de los pasos 5 y 12).

**Acceptance**
- [ ] WHEN `renderQuotePdf` receives a quote with 3 items THE SYSTEM SHALL return a Buffer whose first 5 bytes are `%PDF-` and whose length exceeds 1000 bytes.
- [ ] WHEN `renderQuotePdf` receives a quote with 0 items THE SYSTEM SHALL still return a valid PDF Buffer.
- [ ] WHEN `GET /api/quotes/<id>/pdf` is called without a session THE SYSTEM SHALL answer 401.
- [ ] WHEN it is called by an `assistant`, or for a quote of another clinic, THE SYSTEM SHALL answer 403 or 404 respectively and return no PDF bytes.
- [ ] WHEN it is called by a dentist of the quote's clinic THE SYSTEM SHALL answer 200 with `Content-Type: application/pdf` and `Content-Disposition: inline; filename="cotizacion-<number>.pdf"`.

**Verify**
```bash
pnpm db:up
pnpm test:unit tests/unit/quote-pdf.test.ts
pnpm test:db tests/db/quote-pdf-route.test.ts
pnpm typecheck
pnpm lint
pnpm build
```

**Checkpoint**
```bash
git add -A && git commit -m "step 13: quote-pdf"
git tag step-13-quote-pdf
git rev-parse --verify step-13-quote-pdf   # expect: a commit id, exit 0
```

---

### E3-T3 — Step 14: Registro de cobros y saldos

| | |
|---|---|
| **Depende de** | `E3-T1`, `E2-T2` |
| **Prioridad** | p0 |
| **Archivos** | `supabase/migrations/20261020000008_charges.sql`, `src/server/charges.ts`, `src/app/(app)/cobros/**`, `tests/db/charges*.test.ts` |
| **Etiqueta** | `step-14-charges` |

**Do**
Registro de **cobros** de la clínica al paciente (no procesa pagos: registra lo cobrado). Los cobros son **inmutables**; un error se corrige **anulando** (fila en `charge_voids`), nunca editando ni borrando. Admin, dentista y asistente pueden registrar cobros; solo admin puede anularlos. Los pagos parciales (abonos) son el caso normal en tratamientos largos.

`supabase/migrations/20261020000008_charges.sql`

```sql
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
```

`tests/db/charges.test.ts`

```ts
import { afterAll, describe, expect, it } from "vitest";
import { asUser, closePool, createPatientRow, pool, seedClinic } from "./helpers";

afterAll(closePool);

async function acceptedQuote(a: Awaited<ReturnType<typeof seedClinic>>) {
  const patientId = await createPatientRow(a.clinicId);
  const { rows } = await pool.query<{ id: string }>(
    "insert into quotes (clinic_id, patient_id, number, valid_until, discount_cents, created_by) values ($1, $2, 1, current_date + 30, 1000, $3) returning id",
    [a.clinicId, patientId, a.dentist.membershipId],
  );
  const quoteId = rows[0]?.id as string;
  await pool.query(
    "insert into quote_items (clinic_id, quote_id, description, quantity, unit_price_cents) values ($1, $2, 'Limpieza', 2, 5000)",
    [a.clinicId, quoteId],
  );
  await pool.query("update quotes set status = 'sent' where id = $1", [quoteId]);
  await pool.query("update quotes set status = 'accepted' where id = $1", [quoteId]);
  return { patientId, quoteId };
}

const charge = (
  a: Awaited<ReturnType<typeof seedClinic>>,
  patientId: string,
  quoteId: string,
  cents: number,
) =>
  pool.query<{ id: string }>(
    "insert into charges (clinic_id, patient_id, quote_id, amount_cents, method, concept, created_by) values ($1, $2, $3, $4, 'yape', 'abono', $5) returning id",
    [a.clinicId, patientId, quoteId, cents, a.admin.membershipId],
  );
const balance = async (quoteId: string) =>
  (
    await pool.query(
      "select total_cents, paid_cents, balance_cents from quote_balances where quote_id = $1",
      [quoteId],
    )
  ).rows[0];

describe("charges", () => {
  it("balance = items - discount - non-voided charges", async () => {
    const a = await seedClinic();
    const { patientId, quoteId } = await acceptedQuote(a);
    expect(await balance(quoteId)).toEqual({
      total_cents: "9000",
      paid_cents: "0",
      balance_cents: "9000",
    });
    await charge(a, patientId, quoteId, 3000);
    expect(await balance(quoteId)).toEqual({
      total_cents: "9000",
      paid_cents: "3000",
      balance_cents: "6000",
    });
  });

  it("voiding a charge returns its amount to the balance and the charge row stays", async () => {
    const a = await seedClinic();
    const { patientId, quoteId } = await acceptedQuote(a);
    const { rows } = await charge(a, patientId, quoteId, 3000);
    await pool.query(
      "insert into charge_voids (charge_id, clinic_id, reason, voided_by) values ($1, $2, 'monto mal digitado', $3)",
      [rows[0]?.id, a.clinicId, a.admin.membershipId],
    );
    expect((await balance(quoteId)).paid_cents).toBe("0");
    expect(
      (await pool.query("select count(*)::int as n from charges where id = $1", [rows[0]?.id]))
        .rows[0].n,
    ).toBe(1);
  });

  it("charges are immutable and a non-positive amount is rejected", async () => {
    const a = await seedClinic();
    const { patientId, quoteId } = await acceptedQuote(a);
    const { rows } = await charge(a, patientId, quoteId, 1000);
    await expect(
      pool.query("update charges set amount_cents = 1 where id = $1", [rows[0]?.id]),
    ).rejects.toThrow(/append-only/);
    await expect(pool.query("delete from charges where id = $1", [rows[0]?.id])).rejects.toThrow(
      /append-only/,
    );
    await expect(charge(a, patientId, quoteId, 0)).rejects.toThrow(/check constraint/);
  });

  it("only admins void; assistants may record charges; other clinics see nothing", async () => {
    const a = await seedClinic();
    const b = await seedClinic();
    const { patientId, quoteId } = await acceptedQuote(a);
    const { rows } = await charge(a, patientId, quoteId, 1000);
    const voidAs = (userId: string, membershipId: string) =>
      asUser(userId, (c) =>
        c.query(
          "insert into charge_voids (charge_id, clinic_id, reason, voided_by) values ($1, $2, 'x', $3)",
          [rows[0]?.id, a.clinicId, membershipId],
        ),
      );
    await expect(voidAs(a.assistant.userId, a.assistant.membershipId)).rejects.toThrow(
      /row-level security/,
    );
    await voidAs(a.admin.userId, a.admin.membershipId);
    expect((await asUser(b.admin.userId, (c) => c.query("select id from charges"))).rowCount).toBe(
      0,
    );
    expect(
      (await asUser(a.assistant.userId, (c) => c.query("select id from charges"))).rowCount,
    ).toBe(1);
  });
});
```

**`src/server/charges.ts`**:
```ts
export class OverpaymentError extends Error {}
export class QuoteNotAcceptedError extends Error {}
export type PaymentMethod = "cash" | "yape" | "plin" | "card" | "transfer";
export function recordCharge(actor: Extract<Actor, { kind: "user" }>, input: { patientId: string; quoteId?: string; appointmentId?: string; amountCents: number; method: PaymentMethod; concept: string; paidAt?: Date }): Promise<{ id: string }>;
// zod: amountCents entero > 0; concept no vacío. Los asistentes registran cobros pero NO ven `quotes` por RLS, así que la operación completa corre con `withService` en UNA transacción, con autorización explícita:
// (a) la membresía actor.membershipId está activa en actor.clinicId (cualquier rol); (b) con quoteId: SELECT … FROM quotes WHERE id = $1 AND clinic_id = $2 FOR UPDATE (serializa cobros concurrentes de esa cotización), mismo paciente, status 'accepted' (QuoteNotAcceptedError) y amountCents <= saldo de quote_balances (OverpaymentError); (c) INSERT del cobro con created_by = actor.membershipId.
export function voidCharge(actor: Extract<Actor, { kind: "user" }>, chargeId: string, reason: string): Promise<void>; // solo admin => ForbiddenError; ya anulado => Error("charge already voided")
export function listCharges(actor: Extract<Actor, { kind: "user" }>, opts?: { patientId?: string; from?: Date; to?: Date }): Promise<Array<Charge & { voided: boolean }>>;
export function patientBalance(actor: Extract<Actor, { kind: "user" }>, patientId: string): Promise<{ totalCents: number; paidCents: number; balanceCents: number }>; // suma de quote_balances de ese paciente Corre con withService y la autorización explícita (a) de recordCharge: los asistentes no ven quotes por RLS.
```
**Tests de servicio** (`tests/db/charges-service.test.ts`): los criterios 2 a 5; la concurrencia usa `Promise.allSettled` sobre dos llamadas.

**Interfaz** (`src/app/(app)/cobros/`): formulario "Registrar cobro" (paciente, cotización aceptada opcional con su saldo visible, monto en soles con `parsePEN`, método, concepto), lista de cobros con filtros por paciente y fechas, y "Anular" (solo admin, con motivo obligatorio). Los anulados se muestran tachados con su motivo. Al elegir un paciente en el formulario, muestra su saldo pendiente con `patientBalance`.

**Acceptance**
- [ ] WHEN `pnpm test:db tests/db/charges.test.ts` runs THE SYSTEM SHALL pass all 4 tests: balance arithmetic, voiding, immutability, and role limits.
- [ ] WHEN `recordCharge` targets an `accepted` quote with total 9000 and amount 3000 THE SYSTEM SHALL insert the charge and `patientBalance` SHALL report a 6000 balance for that patient.
- [ ] WHEN `recordCharge` targets a quote that is not `accepted`, or an amount above the remaining balance, THE SYSTEM SHALL throw `OverpaymentError` or `QuoteNotAcceptedError` respectively and insert nothing.
- [ ] WHEN two `recordCharge` calls of 6000 each run concurrently against a remaining balance of 9000 THE SYSTEM SHALL insert exactly one and reject the other with `OverpaymentError`.
- [ ] WHEN an admin calls `voidCharge` THE SYSTEM SHALL insert a `charge_voids` row, the balance SHALL increase by the charge amount, and the charge row SHALL remain; WHEN a non-admin calls it THE SYSTEM SHALL throw `ForbiddenError`.

**Verify**
```bash
pnpm db:up
pnpm test:db tests/db/charges.test.ts
pnpm test:db tests/db/charges-service.test.ts
pnpm typecheck
pnpm lint
pnpm build
```

**Checkpoint**
```bash
git add -A && git commit -m "step 14: charges"
git tag step-14-charges
git rev-parse --verify step-14-charges   # expect: a commit id, exit 0
```

---

### E3-T4 — Step 15: Control de gastos y resumen mensual

| | |
|---|---|
| **Depende de** | `E3-T3` |
| **Prioridad** | p0 |
| **Archivos** | `supabase/migrations/20261020000009_expenses.sql`, `src/server/expenses.ts`, `src/app/(app)/gastos/**`, `src/app/(app)/resumen/**`, `tests/db/expenses*.test.ts` |
| **Etiqueta** | `step-15-expenses` |

**Do**
Control de gastos de la clínica (insumos, laboratorio, alquiler, sueldos, servicios, marketing, otros) y el **resumen mensual** ingresos − gastos. **Solo admin** ve y registra finanzas (RLS y servicio). Los gastos también son inmutables y se corrigen anulando. En v1 el comprobante es solo una nota de texto (`receipt_note`); no hay subida de archivos.

`supabase/migrations/20261020000009_expenses.sql`

```sql
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
```

`tests/db/expenses.test.ts`

```ts
import { afterAll, describe, expect, it } from "vitest";
import { asUser, closePool, createPatientRow, pool, seedClinic } from "./helpers";

afterAll(closePool);

const expense = (a: Awaited<ReturnType<typeof seedClinic>>, cents: number, day = "2027-03-10") =>
  pool.query<{ id: string }>(
    "insert into expenses (clinic_id, category, description, amount_cents, method, incurred_on, created_by) values ($1, 'insumos', 'Guantes', $2, 'cash', $3, $4) returning id",
    [a.clinicId, cents, day, a.admin.membershipId],
  );

describe("expenses and the monthly summary", () => {
  it("only admins can read or write expenses", async () => {
    const a = await seedClinic();
    await expense(a, 2000);
    expect((await asUser(a.admin.userId, (c) => c.query("select id from expenses"))).rowCount).toBe(
      1,
    );
    expect(
      (await asUser(a.dentist.userId, (c) => c.query("select id from expenses"))).rowCount,
    ).toBe(0);
    await expect(
      asUser(a.assistant.userId, (c) =>
        c.query(
          "insert into expenses (clinic_id, category, description, amount_cents, method, incurred_on, created_by) values ($1, 'otros', 'x', 100, 'cash', '2027-03-01', $2)",
          [a.clinicId, a.assistant.membershipId],
        ),
      ),
    ).rejects.toThrow(/row-level security/);
  });

  it("the summary nets income against expenses per Lima month and ignores voided rows", async () => {
    const a = await seedClinic();
    const patientId = await createPatientRow(a.clinicId);
    await expense(a, 2000, "2027-03-10");
    const voided = await expense(a, 500, "2027-03-11");
    await pool.query(
      "insert into expense_voids (expense_id, clinic_id, reason, voided_by) values ($1, $2, 'duplicado', $3)",
      [voided.rows[0]?.id, a.clinicId, a.admin.membershipId],
    );
    // 2027-04-01 03:00Z is still 2027-03-31 22:00 in Lima, so it counts toward March
    await pool.query(
      "insert into charges (clinic_id, patient_id, amount_cents, method, concept, paid_at, created_by) values ($1, $2, 10000, 'cash', 'consulta', '2027-04-01T03:00:00Z', $3)",
      [a.clinicId, patientId, a.admin.membershipId],
    );
    const { rows } = await asUser(a.admin.userId, (c) =>
      c.query("select month::text, income_cents, expense_cents, net_cents from monthly_summary"),
    );
    expect(rows).toEqual([
      { month: "2027-03-01", income_cents: "10000", expense_cents: "2000", net_cents: "8000" },
    ]);
  });

  it("expenses are immutable; a non-positive amount is rejected", async () => {
    const a = await seedClinic();
    const { rows } = await expense(a, 100);
    await expect(
      pool.query("update expenses set amount_cents = 5 where id = $1", [rows[0]?.id]),
    ).rejects.toThrow(/append-only/);
    await expect(expense(a, 0)).rejects.toThrow(/check constraint/);
  });
});
```

**`src/server/expenses.ts`** (solo admin; otro rol ⇒ `ForbiddenError` de `src/server/session.ts`; el rol se consulta en `memberships`):
```ts
export type ExpenseCategory = "insumos" | "laboratorio" | "alquiler" | "sueldos" | "servicios" | "marketing" | "otros";
export function recordExpense(actor: Extract<Actor, { kind: "user" }>, input: { category: ExpenseCategory; supplier?: string; description: string; amountCents: number; method: PaymentMethod; incurredOn: string /* YYYY-MM-DD */; receiptNote?: string }): Promise<{ id: string }>;
export function voidExpense(actor: Extract<Actor, { kind: "user" }>, expenseId: string, reason: string): Promise<void>;
export function listExpenses(actor: Extract<Actor, { kind: "user" }>, opts?: { month?: string /* YYYY-MM */ }): Promise<Array<Expense & { voided: boolean }>>;
export function monthlySummary(actor: Extract<Actor, { kind: "user" }>, opts?: { months?: number }): Promise<Array<{ month: string; incomeCents: number; expenseCents: number; netCents: number }>>; // lee la vista monthly_summary, más reciente primero, por defecto 12 meses
```
**Tests de servicio** (`tests/db/expenses-service.test.ts`): los criterios 2 a 5.

**Interfaz**: `src/app/(app)/gastos/` (formulario de gasto, lista por mes, "Anular" con motivo) y `src/app/(app)/resumen/` (tabla de los últimos 12 meses con ingresos, gastos y neto en `formatPEN`; neto negativo en el color `danger` **y** con el signo, nunca solo por color). Ambas páginas llaman `requireRole(ctx, "admin")` y, si no, muestran "Solo la administración puede ver esta sección".

**Acceptance**
- [ ] WHEN `pnpm test:db tests/db/expenses.test.ts` runs THE SYSTEM SHALL pass all 3 tests: admin-only access, the monthly net using Lima calendar months with voided rows excluded, and immutability.
- [ ] WHEN an admin calls `recordExpense` with a valid category, amount and date THE SYSTEM SHALL insert one expense and `listExpenses` SHALL return it.
- [ ] WHEN a dentist or assistant calls `recordExpense`, `voidExpense`, `listExpenses` or `monthlySummary` THE SYSTEM SHALL throw `ForbiddenError`.
- [ ] WHEN `voidExpense` runs THE SYSTEM SHALL insert an `expense_voids` row, the expense SHALL disappear from `monthlySummary` totals, and the expense row SHALL remain.
- [ ] WHEN `monthlySummary` runs over a month with income and expenses THE SYSTEM SHALL return `incomeCents`, `expenseCents` and `netCents = income - expense` for that month.

**Verify**
```bash
pnpm db:up
pnpm test:db tests/db/expenses.test.ts
pnpm test:db tests/db/expenses-service.test.ts
pnpm typecheck
pnpm lint
pnpm build
```

**Checkpoint**
```bash
git add -A && git commit -m "step 15: expenses"
git tag step-15-expenses
git rev-parse --verify step-15-expenses   # expect: a commit id, exit 0
```

---

### E3-T5 — Step 16: Agente de WhatsApp: herramientas, bucle y salvaguardas

| | |
|---|---|
| **Depende de** | `E2-T2`, `E3-T3`, `E2-T4` |
| **Prioridad** | p0 |
| **Archivos** | `supabase/migrations/20261020000010_agent.sql`, `src/lib/agent/**`, `src/server/agent-tools.ts`, `tests/db/agent*.test.ts` |
| **Etiqueta** | `step-16-agent-core` |

**Do**
El agente atiende por WhatsApp: identifica al paciente, ofrece horarios, **propone** una cita, la agenda cuando el paciente confirma, cancela, informa saldo y deriva a una persona. Es un bucle de modelo con herramientas, **con salvaguardas en el servidor, no en el prompt**:
1. **No hay herramienta que lea historia clínica.** El agente nunca ve diagnósticos ni notas.
2. **El paciente lo fija el servidor.** Las herramientas no reciben `patientId` del modelo: usan `agent_conversations.patient_id` (identificado por el teléfono del chat o por `register_patient`).
3. **Agendar exige confirmación real.** `propose_appointment` guarda una propuesta (vence en 10 minutos); `book_appointment` solo acepta el id de una propuesta **creada en un turno anterior** a un mensaje posterior del paciente, no vencida y no consumida.
4. Presupuesto: máximo 8 llamadas al modelo por mensaje, 25 segundos, historial de los últimos 20 turnos; al exceder ⇒ texto fijo y derivación.

`supabase/migrations/20261020000010_agent.sql`

```sql
-- supabase/migrations/20261020000010_agent.sql
create table agent_conversations (
  id uuid primary key default gen_random_uuid(),
  clinic_id uuid not null references clinics (id) on delete restrict,
  phone_e164 text not null,
  patient_id uuid references patients (id) on delete restrict,
  status text not null default 'active' check (status in ('active', 'handoff', 'closed')),
  last_message_at timestamptz not null default now(),
  created_at timestamptz not null default now()
);
-- One open conversation per clinic and phone.
create unique index agent_conversations_open_idx on agent_conversations (clinic_id, phone_e164)
  where status in ('active', 'handoff');

create table agent_turns (
  id bigint generated always as identity primary key,
  conversation_id uuid not null references agent_conversations (id) on delete restrict,
  role text not null check (role in ('user', 'assistant')),
  content jsonb not null,
  input_tokens integer,
  output_tokens integer,
  created_at timestamptz not null default now()
);
create index agent_turns_conversation_idx on agent_turns (conversation_id, id);

-- A proposal is the only way the agent can book: the patient-confirmed summary is stored server-side,
-- and book_appointment accepts nothing but the proposal id.
create table appointment_proposals (
  id uuid primary key default gen_random_uuid(),
  clinic_id uuid not null references clinics (id) on delete restrict,
  conversation_id uuid not null references agent_conversations (id) on delete restrict,
  patient_id uuid not null references patients (id) on delete restrict,
  membership_id uuid not null references memberships (id) on delete restrict,
  starts_at timestamptz not null,
  ends_at timestamptz not null,
  reason text,
  expires_at timestamptz not null,
  consumed_at timestamptz,
  created_at timestamptz not null default now(),
  check (ends_at > starts_at)
);

alter table agent_conversations enable row level security;
alter table agent_turns enable row level security;
alter table appointment_proposals enable row level security;
create policy agent_conversations_select on agent_conversations for select to authenticated
  using (current_role_in(clinic_id) in ('admin', 'dentist', 'assistant'));
create policy agent_conversations_update on agent_conversations for update to authenticated
  using (current_role_in(clinic_id) in ('admin', 'dentist', 'assistant'))
  with check (current_role_in(clinic_id) in ('admin', 'dentist', 'assistant'));
create policy agent_turns_select on agent_turns for select to authenticated
  using (conversation_id in (select id from agent_conversations));
```

**`src/lib/agent/llm.ts`**:
```ts
export type ToolDef = { name: string; description: string; input_schema: Record<string, unknown> /* JSON Schema */ };
export type LlmMessage = { role: "user" | "assistant"; content: LlmBlock[] };
export type LlmBlock = { type: "text"; text: string } | { type: "tool_use"; id: string; name: string; input: unknown } | { type: "tool_result"; tool_use_id: string; content: string; is_error?: boolean };
export type LlmResponse = { blocks: LlmBlock[]; stopReason: "end_turn" | "tool_use" | "other"; inputTokens: number; outputTokens: number };
export interface LlmClient { complete(req: { system: string; messages: LlmMessage[]; tools: ToolDef[]; signal?: AbortSignal }): Promise<LlmResponse>; }
export function anthropicLlm(): LlmClient; // SDK @anthropic-ai/sdk (versión en §11), getEnv("anthropic"): ANTHROPIC_API_KEY, AGENT_MODEL (por defecto "claude-sonnet-5-5"); messages.create({ model, max_tokens: 1024, system, messages, tools }); mapear bloques. Invoca la skill claude-api para confirmar nombres de parámetros y el ID del modelo (§18).
```
**`src/lib/agent/prompt.ts`**: `export function systemPrompt(clinic: { name: string; timezone: string }, now: Date): string` — español peruano, tono cordial y breve; reglas: solo agenda, cancelación, saldo e información de la clínica; **nunca** dar consejo médico, diagnósticos ni precios de tratamientos no listados; antes de agendar, repetir fecha, hora, dentista y motivo y pedir confirmación explícita; si el paciente pide hablar con una persona, está molesto o la consulta es clínica, usar `handoff_to_human`; las horas se dicen en hora de la clínica; no inventar horarios: solo los de `list_open_slots`.

**Herramientas** (`src/server/agent-tools.ts`; `export const TOOL_NAMES = [...]` con **exactamente** estas 8; cada una valida su entrada con zod y devuelve JSON de texto; opera con un actor de servicio `{ kind: "service", clinicId }` y la conversación):
| Herramienta | Entrada | Efecto |
|---|---|---|
| `identify_patient` | {} | busca en la clínica un paciente con `phone_e164` = teléfono del chat; si existe fija `conversation.patient_id` y devuelve `{ found: true, firstName }`; si no, `{ found: false }` |
| `register_patient` | { docType, docNumber, firstName, lastName, acceptsReminders } | `createPatient` (paso 5) con el teléfono del chat; `whatsappOptIn = acceptsReminders`; fija el paciente de la conversación |
| `list_open_slots` | { dentistId?, fromDate, toDate, minutes } | `loadSlots` (paso 8); devuelve hasta 8 horarios como texto en hora de la clínica más sus ISO |
| `propose_appointment` | { dentistId, startsAt, minutes, reason? } | exige paciente identificado; valida que `startsAt` esté en `loadSlots`; inserta `appointment_proposals` (expira en 10 min) y devuelve `{ proposalId, summary }` |
| `book_appointment` | { proposalId } | exige propuesta de esta conversación, no vencida, no consumida, creada **antes** del último mensaje del paciente; `bookAppointment` (fuente `whatsapp`); marca `consumed_at`; `SlotTakenError` ⇒ error "ese horario ya no está disponible" |
| `cancel_appointment` | { appointmentId } | solo citas futuras del paciente de la conversación; `cancelAppointment` |
| `get_balance` | {} | `patientBalance`-equivalente con actor de servicio; devuelve solo el saldo pendiente total |
| `handoff_to_human` | { reason } | `status = 'handoff'` |

**`src/lib/agent/loop.ts`**:
```ts
export const FALLBACK_TEXT = "Un miembro de nuestro equipo le responderá en breve.";
export type AgentDeps = { llm: LlmClient; now?: () => Date };
export function runAgent(deps: AgentDeps, conversationId: string, userText: string): Promise<string | null>;
// 1) carga la conversación (withService); status 'handoff' o 'closed' => null SIN llamar al modelo.
// 2) inserta el turno del usuario en agent_turns; carga los últimos 20 turnos.
// 3) bucle de hasta 8 llamadas: llm.complete({ system, messages, tools, signal: AbortSignal.timeout(25_000) });
//    por cada bloque tool_use ejecuta la herramienta (nombre fuera de TOOL_NAMES o entrada inválida => tool_result is_error, nunca excepción);
//    termina en end_turn y devuelve el texto concatenado; guarda cada turno (role, content JSON, tokens).
// 4) si se agotan las 8 llamadas, error del modelo o timeout => status 'handoff' y devuelve FALLBACK_TEXT.
```
**Tests** (`tests/db/agent-tools.test.ts` y `tests/db/agent-loop.test.ts`, escritos por el builder): un `LlmClient` falso que sigue un guion (lista de respuestas) y registra cuántas veces fue llamado; datos con `seedClinic()`, una regla de disponibilidad del dentista (SQL) y un paciente. Cubren los 6 criterios; el de la lista blanca compara `TOOL_NAMES` con la lista exacta de la tabla.

**Acceptance**
- [ ] WHEN the scripted model calls `book_appointment` without a proposal created in an earlier turn THE SYSTEM SHALL return an error tool result and create no appointment.
- [ ] WHEN the scripted model calls `propose_appointment`, the patient replies in a later turn, and the model then calls `book_appointment` with the proposal id THE SYSTEM SHALL create exactly one `confirmed` appointment with source `whatsapp` and consume the proposal; a second `book_appointment` with the same id SHALL fail.
- [ ] WHEN the model calls a tool outside the allow-list, or arguments that fail their zod schema, THE SYSTEM SHALL return an error tool result and continue the loop without throwing.
- [ ] WHEN the loop would exceed 8 model calls THE SYSTEM SHALL stop, return the fixed fallback text, and set the conversation status to `handoff`.
- [ ] WHEN `handoff_to_human` is called THE SYSTEM SHALL set the conversation to `handoff` and every later `runAgent` call SHALL return null without calling the model.
- [ ] WHEN `get_balance` or `cancel_appointment` runs on a conversation whose patient is not identified THE SYSTEM SHALL return an error tool result, and the allow-list SHALL contain exactly the 8 documented tools and no tool that reads clinical entries.

**Verify**
```bash
pnpm db:up
pnpm test:db tests/db/agent-tools.test.ts
pnpm test:db tests/db/agent-loop.test.ts
pnpm typecheck
pnpm lint
```

**Checkpoint**
```bash
git add -A && git commit -m "step 16: agent-core"
git tag step-16-agent-core
git rev-parse --verify step-16-agent-core   # expect: a commit id, exit 0
```

---

### E3-T6 — Step 17: WhatsApp entrante: webhook, simulador y derivación

| | |
|---|---|
| **Depende de** | `E3-T5` |
| **Prioridad** | p0 |
| **Archivos** | `src/app/api/whatsapp/**`, `src/server/inbound.ts`, `src/app/(app)/simulador/**`, `tests/db/inbound*.test.ts` |
| **Etiqueta** | `step-17-whatsapp-inbound` |

**Do**
Entrada de mensajes de WhatsApp (API oficial en la nube de Meta) hacia el agente, más un **simulador** para probar sin Meta.

**`src/server/inbound.ts`**:
```ts
export function verifySignature(rawBody: string, header: string | null, appSecret: string): boolean; // header "sha256=<hex>"; HMAC-SHA256(rawBody, appSecret); comparación en tiempo constante
export type IngestResult = { messageIds: string[]; ignored: number };
export function ingestPayload(payload: unknown): Promise<IngestResult>;
// Payload de Meta: { entry: [{ changes: [{ value: { metadata: { phone_number_id }, contacts?: [{ profile: { name } }], messages?: [{ id, from, type: "text", text: { body } }] } }] }] }.
// Por cada mensaje de tipo "text": clínica = clinics.whatsapp_phone_number_id = phone_number_id (si no existe => ignored++); teléfono = "+" + from;
// INSERT en whatsapp_messages (direction 'in', status 'received') ON CONFLICT (wa_message_id) DO NOTHING; solo los realmente insertados cuentan en messageIds. Otros tipos (audio, imagen) => ignored++ (v1 responde solo a texto).
export function processInbound(messageId: string, deps: { llm: LlmClient; sender: WhatsAppSender }): Promise<void>;
// Carga el mensaje 'received' (FOR UPDATE SKIP LOCKED para no procesar dos veces); busca o crea agent_conversations abierta (clinic_id, phone) y fija last_message_at;
// reply = runAgent({ llm }, conversation.id, body); si reply !== null: sender.sendText(phoneNumberId, { to, body: reply }) y whatsapp_messages out 'sent'; marca el entrante 'processed'.
// Un error de envío => entrante 'failed' con error (no se reintenta solo).
export function sweepUnprocessed(deps: { llm: LlmClient; sender: WhatsAppSender; now?: Date }): Promise<number>; // procesa los 'received' con más de 60 s; devuelve cuántos
```
**`src/app/api/whatsapp/webhook/route.ts`**:
- `GET`: validar el reto de suscripción de Meta (`hub.mode === "subscribe"` y `hub.verify_token === WHATSAPP_VERIFY_TOKEN` ⇒ 200 con `hub.challenge` como texto; si no ⇒ 403).
- `POST`: leer el cuerpo **crudo** (`await request.text()`); en modo `cloud` exigir `verifySignature` (si no, 401); en modo `simulator` no se exige firma. `ingestPayload(JSON.parse(raw))`; responder **200 de inmediato** y procesar con `after(() => processInbound(...))` de `next/server` (si `after` no estuviera disponible en la versión fijada, procesar en el barrido). Meta reintenta si no recibe 2xx rápido, por eso la idempotencia por `wa_message_id` es obligatoria.
**`src/app/api/whatsapp/cron/route.ts`**: `POST`/`GET` con `assertCron` (de `@/app/api/cron/auth`) que ejecuta `sweepUnprocessed({ llm: anthropicLlm(), sender: getSender() })` y responde `{ whatsapp: { processed } }`.

**Simulador** (`src/app/(app)/simulador/`, solo admin): chat de prueba donde el admin escribe como un paciente (campo "Teléfono del paciente" +  mensaje); la acción del servidor construye un payload de Meta falso con `phone_number_id` de la clínica (asignar `clinics.whatsapp_phone_number_id = "SIMULADOR-<clinicId>"` la primera vez), llama `ingestPayload` y `processInbound` con `SimulatorSender` compartido, y muestra la conversación (`whatsapp_messages` de ese teléfono) con las respuestas del agente. Es la forma de demostrar el agente al cliente sin número verificado.

**Tests** (`tests/db/inbound.test.ts`, escrito por el builder): los 6 criterios con un `LlmClient` falso y `SimulatorSender`; para el criterio 2 firma el cuerpo en el test con `createHmac("sha256", secret)`.

**Acceptance**
- [ ] WHEN `GET /api/whatsapp/webhook?hub.mode=subscribe&hub.verify_token=<token>&hub.challenge=abc` is called with the configured token THE SYSTEM SHALL answer 200 with the body `abc`, and WHEN the token is wrong THE SYSTEM SHALL answer 403.
- [ ] WHEN `POST /api/whatsapp/webhook` carries an invalid `X-Hub-Signature-256` in cloud mode THE SYSTEM SHALL answer 401 and store no message.
- [ ] WHEN the same inbound message id is delivered twice THE SYSTEM SHALL store exactly one `whatsapp_messages` row and run the agent once.
- [ ] WHEN a payload names a `phone_number_id` that belongs to no clinic THE SYSTEM SHALL answer 200 and store nothing.
- [ ] WHEN `processInbound` runs with a scripted model THE SYSTEM SHALL send the assistant reply through the injected sender and mark the message `processed`, and WHEN the conversation is in `handoff` THE SYSTEM SHALL send nothing.
- [ ] WHEN `POST /api/whatsapp/cron` runs with the cron bearer token THE SYSTEM SHALL process every inbound message that has stayed `received` for more than 60 seconds.

**Verify**
```bash
pnpm db:up
pnpm test:db tests/db/inbound.test.ts
pnpm typecheck
pnpm lint
pnpm build
```

**Checkpoint**
```bash
git add -A && git commit -m "step 17: whatsapp-inbound"
git tag step-17-whatsapp-inbound
git rev-parse --verify step-17-whatsapp-inbound   # expect: a commit id, exit 0
```

---

### E3-T7 — Step 18: CI, datos de demostración y entrega

| | |
|---|---|
| **Depende de** | `E3-T6`, `E3-T4`, `E2-T5`, `E3-T2`, `E2-T3` |
| **Prioridad** | p1 |
| **Archivos** | `.github/workflows/ci.yml`, `.github/workflows/cron.yml`, `scripts/seed.ts`, `README.md`, `tests/db/seed.test.ts` |
| **Etiqueta** | `step-18-ci-seed-handoff` |

**Do**
Cierre: integración continua, programador de tareas, datos de demostración y documentación de entrega.

**`scripts/seed.ts`**:
```ts
export async function seedDemo(auth: AuthAdmin, opts?: { clinicName?: string }): Promise<{ clinicId: string }>;
// Idempotente por (nombre de clínica) y por documento/correo. Crea: clínica "Clínica Demo"; 1 admin (admin@demo.test), 2 dentistas, 1 asistente
// (correos @demo.test, contraseña tomada de SEED_PASSWORD o "demo-1234567890"); 8 pacientes FICTICIOS (DNI 00000001..00000008, teléfono +5190000000x, sin opt-in);
// reglas de disponibilidad lunes–viernes 09:00–13:00 y 15:00–18:00 para los dos dentistas; 5 tratamientos (Consulta 8000, Limpieza 12000, Resina 15000, Extracción 20000, Blanqueamiento 35000 céntimos; duraciones 30/45/45/60/60).
// Usa registerClinic/addMember (paso 4) y createPatient (paso 5); si ya existen no los duplica.
```
La CLI (`if (process.argv[1] ...)`, como `scripts/migrate.ts`): con `SUPABASE_SECRET_KEY` usa `supabaseAuthAdmin`; si no, sale con el mensaje "Define SUPABASE_SECRET_KEY o usa los tests". **Solo datos ficticios** (la Ley 29733 aplica a datos reales de pacientes, §14).

**`.github/workflows/ci.yml`**: en `push` y `pull_request`; un job en `ubuntu-latest` con `services.postgres` (`image: postgres:16`, usuario/contraseña `postgres`, base `dentistas_test`, puerto 5432, health check `pg_isready`); pasos: checkout, `actions/setup-node` leyendo `.nvmrc`, instalar pnpm con la versión que declara `packageManager` en `package.json` (`npm install -g "pnpm@$(node -p "require('./package.json').packageManager.split('@')[1]")"`), `pnpm install --frozen-lockfile`, `pnpm typecheck`, `pnpm lint`, `pnpm test` con `TEST_DATABASE_URL=postgres://postgres:postgres@localhost:5432/dentistas_test`, `pnpm build`. Las acciones de GitHub se fijan con la versión mayor vigente **verificada al crear el archivo** (§11, "verificar antes de instalar").

**`.github/workflows/cron.yml`**: `on: schedule: - cron: "*/5 * * * *"` y `workflow_dispatch`; un paso por ruta con `curl --fail-with-body -sS -X POST -H "Authorization: Bearer ${{ secrets.CRON_SECRET }}" "${{ secrets.APP_URL }}/api/cron/tick"`, y lo mismo para `/api/google/cron` y `/api/whatsapp/cron`. (GitHub puede retrasar tareas programadas varios minutos: aceptable para recordatorios; ver §20.2.)

**`README.md`** (español): qué es, requisitos, `cp .env.example .env`, `pnpm db:up`, `pnpm db:migrate`, `pnpm db:seed`, `pnpm dev`, cómo probar el agente con el simulador, cómo correr los tests, y la lista del §10 de cuentas externas.

**Tests** (`tests/db/seed.test.ts`, escrito por el builder): criterios 1 y 2 con un `AuthAdmin` falso.

Al terminar, ejecuta **el gate global de §20.1** completo y deja todo en verde antes de entregar.

**Acceptance**
- [ ] WHEN `seedDemo` runs with a fake `AuthAdmin` on an empty test database THE SYSTEM SHALL create 1 clinic with 1 admin, 2 dentists and 1 assistant, 8 fake patients whose DNI start with `0000`, weekday availability rules for both dentists, and 5 catalog treatments.
- [ ] WHEN `seedDemo` runs a second time on the same clinic THE SYSTEM SHALL create no duplicate rows (patient count stays 8, member count stays 4).
- [ ] WHEN `.github/workflows/ci.yml` is read THE SYSTEM SHALL contain steps running `pnpm install --frozen-lockfile`, `pnpm typecheck`, `pnpm lint`, `pnpm test` and `pnpm build`, and a `postgres:16` service on port 5432.
- [ ] WHEN `.github/workflows/cron.yml` is read THE SYSTEM SHALL contain a schedule of `*/5 * * * *` and calls to `/api/cron/tick`, `/api/google/cron` and `/api/whatsapp/cron` with the `CRON_SECRET` bearer token taken from repository secrets.
- [ ] WHEN the global acceptance gate of §20.1 runs on the finished tree THE SYSTEM SHALL exit 0 for every command in it.

**Verify**
```bash
pnpm db:up
pnpm test:db tests/db/seed.test.ts
grep -q 'frozen-lockfile' .github/workflows/ci.yml
grep -q 'postgres:16' .github/workflows/ci.yml
grep -q '\*/5 \* \* \* \*' .github/workflows/cron.yml
grep -q '/api/whatsapp/cron' .github/workflows/cron.yml
pnpm typecheck
pnpm lint
pnpm test
pnpm build
```

**Checkpoint**
```bash
git add -A && git commit -m "step 18: ci-seed-handoff"
git tag step-18-ci-seed-handoff
git rev-parse --verify step-18-ci-seed-handoff   # expect: a commit id, exit 0
```

---

## Aceptación de la épica
- [ ] `step-12-quotes` existe en git (`git rev-parse --verify step-12-quotes` sale 0).
- [ ] `step-13-quote-pdf` existe en git (`git rev-parse --verify step-13-quote-pdf` sale 0).
- [ ] `step-14-charges` existe en git (`git rev-parse --verify step-14-charges` sale 0).
- [ ] `step-15-expenses` existe en git (`git rev-parse --verify step-15-expenses` sale 0).
- [ ] `step-16-agent-core` existe en git (`git rev-parse --verify step-16-agent-core` sale 0).
- [ ] `step-17-whatsapp-inbound` existe en git (`git rev-parse --verify step-17-whatsapp-inbound` sale 0).
- [ ] `step-18-ci-seed-handoff` existe en git (`git rev-parse --verify step-18-ci-seed-handoff` sale 0).
- [ ] `pnpm typecheck && pnpm lint && pnpm test` salen 0 sobre el árbol resultante.
