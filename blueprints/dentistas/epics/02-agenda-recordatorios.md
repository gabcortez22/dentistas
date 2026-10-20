# Épica 02: Agenda, recordatorios y Google Calendar

> Existe una agenda sin doble reserva, con horarios, recordatorios por WhatsApp (simulador) y sincronización con Google Calendar.

| | |
|---|---|
| **Id de la épica** | `02-agenda-recordatorios` |
| **Tareas** | `E2-T1` … `E2-T5` (pasos 7 a 11 de 18) |
| **Depende de épicas** | `01-fundacion-pacientes-historia` |

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

### E2-T1 — Step 7: Motor de disponibilidad (función pura)

| | |
|---|---|
| **Depende de** | `E1-T1` |
| **Prioridad** | p0 |
| **Archivos** | `src/lib/availability/generate-slots.ts`, `tests/unit/generate-slots.test.ts` |
| **Etiqueta** | `step-07-availability-engine` |

**Do**
Núcleo de la agenda. **Es una función pura**: `(reglas, excepciones, reservas, bloqueos externos, now) → slots`. Nunca se guardan slots; se calculan al leer. Las reglas son **hora de pared local** en la zona de la clínica (`America/Lima`, sin horario de verano), los instantes son UTC. La grilla de inicios de slot se ancla al comienzo de cada ventana de trabajo, de modo que un hueco de primavera (hora inexistente) no produce slots y una hora repetida de otoño produce cada hora real una sola vez. Es el código que más hay que probar: los tests cubren cuatro zonas y los dos cambios de horario.

`src/lib/availability/generate-slots.ts`

```ts
import { DateTime } from "luxon";

export type Rule = {
  /** ISO weekday: 1 = Monday ... 7 = Sunday. */
  weekday: number;
  /** Wall-clock local times, "HH:mm" or "HH:mm:ss". */
  startTime: string;
  endTime: string;
  /** Local dates, "YYYY-MM-DD". */
  validFrom: string;
  validUntil: string | null;
};
export type Span = { startsAt: Date; endsAt: Date };
export type Exception = Span & { type: "block" | "open" };

export type SlotInput = {
  /** IANA zone of the dentist's clinic, e.g. "America/Lima". Rules are wall-clock in this zone. */
  zone: string;
  rules: Rule[];
  exceptions: Exception[];
  booked: Span[];
  externalBusy: Span[];
  now: Date;
  from: Date;
  to: Date;
  durationMinutes: number;
  slotIntervalMinutes: number;
  minNoticeMinutes: number;
  maxAdvanceDays: number;
};

type Interval = [number, number];

const MIN = 60_000;

function merge(intervals: Interval[]): Interval[] {
  const sorted = intervals.filter(([a, b]) => b > a).sort((x, y) => x[0] - y[0]);
  const out: Interval[] = [];
  for (const [a, b] of sorted) {
    const last = out[out.length - 1];
    if (last && a <= last[1]) last[1] = Math.max(last[1], b);
    else out.push([a, b]);
  }
  return out;
}

function localInstant(date: string, time: string, zone: string): number | null {
  const [h = "0", m = "0"] = time.split(":");
  const local = DateTime.fromISO(date, { zone }).set({
    hour: Number(h),
    minute: Number(m),
    second: 0,
    millisecond: 0,
  });
  // Luxon moves a non-existent wall-clock time (spring-forward gap) forward; the window then starts there.
  return local.isValid ? local.toMillis() : null;
}

/**
 * Pure function: free appointment slots for one dentist.
 * (rules, exceptions, booked, externalBusy, now) in, sorted UTC slots out. Reads no clock, no database.
 * Slot starts sit on a grid of `slotIntervalMinutes` anchored at the start instant of each working window
 * (rules and "open" exceptions, merged), so the grid is made of real instants: a spring-forward gap yields
 * no slot inside the gap, and a fall-back repeated hour yields each real hour exactly once. A slot is
 * offered only if it overlaps no booking, no external busy block and no "block" exception.
 */
export function generateSlots(input: SlotInput): Span[] {
  const windowStart = Math.max(
    input.from.getTime(),
    input.now.getTime() + input.minNoticeMinutes * MIN,
  );
  const windowEnd = Math.min(
    input.to.getTime(),
    input.now.getTime() + input.maxAdvanceDays * 24 * 60 * MIN,
  );
  if (windowEnd <= windowStart) return [];

  const open: Interval[] = [];
  const firstDay = DateTime.fromMillis(windowStart, { zone: input.zone })
    .startOf("day")
    .minus({ days: 1 });
  const lastDay = DateTime.fromMillis(windowEnd, { zone: input.zone })
    .startOf("day")
    .plus({ days: 1 });
  for (let day = firstDay; day <= lastDay; day = day.plus({ days: 1 })) {
    const date = day.toISODate();
    if (!date) continue;
    for (const rule of input.rules) {
      if (rule.weekday !== day.weekday) continue;
      if (rule.validFrom > date || (rule.validUntil !== null && rule.validUntil < date)) continue;
      const start = localInstant(date, rule.startTime, input.zone);
      const end = localInstant(date, rule.endTime, input.zone);
      if (start !== null && end !== null && end > start) open.push([start, end]);
    }
  }
  for (const e of input.exceptions) {
    if (e.type === "open") open.push([e.startsAt.getTime(), e.endsAt.getTime()]);
  }

  const cuts = merge(
    [
      ...input.exceptions.filter((e) => e.type === "block"),
      ...input.booked,
      ...input.externalBusy,
    ].map((span): Interval => [span.startsAt.getTime(), span.endsAt.getTime()]),
  );
  const duration = input.durationMinutes * MIN;
  const step = input.slotIntervalMinutes * MIN;
  const slots: Span[] = [];
  for (const [start, end] of merge(open)) {
    for (let t = start; t + duration <= end; t += step) {
      if (t < windowStart || t > windowEnd) continue;
      if (cuts.some(([cutStart, cutEnd]) => cutStart < t + duration && cutEnd > t)) continue;
      slots.push({ startsAt: new Date(t), endsAt: new Date(t + duration) });
    }
  }
  return slots.sort((a, b) => a.startsAt.getTime() - b.startsAt.getTime());
}
```

`tests/unit/generate-slots.test.ts`

```ts
import { DateTime } from "luxon";
import { describe, expect, it } from "vitest";
import { generateSlots, type Rule, type SlotInput } from "@/lib/availability/generate-slots";

const weekdays = (startTime: string, endTime: string, days = [1, 2, 3, 4, 5]): Rule[] =>
  days.map((weekday) => ({
    weekday,
    startTime,
    endTime,
    validFrom: "2020-01-01",
    validUntil: null,
  }));

function base(overrides: Partial<SlotInput> = {}): SlotInput {
  return {
    zone: "America/Lima",
    rules: weekdays("09:00", "12:00"),
    exceptions: [],
    booked: [],
    externalBusy: [],
    now: new Date("2027-03-01T00:00:00Z"),
    from: new Date("2027-03-01T00:00:00Z"),
    to: new Date("2027-03-08T00:00:00Z"),
    durationMinutes: 30,
    slotIntervalMinutes: 30,
    minNoticeMinutes: 0,
    maxAdvanceDays: 60,
    ...overrides,
  };
}

const local = (slot: { startsAt: Date }, zone: string) =>
  DateTime.fromJSDate(slot.startsAt, { zone }).toFormat("yyyy-MM-dd HH:mm");

describe("generateSlots", () => {
  it("expands wall-clock rules in the clinic zone (Lima, UTC-5, no DST)", () => {
    const slots = generateSlots(
      base({ from: new Date("2027-03-01T00:00:00Z"), to: new Date("2027-03-02T00:00:00Z") }),
    );
    // Monday 2027-03-01 local 09:00-12:00 => 14:00Z-17:00Z, six 30-minute slots
    expect(slots).toHaveLength(6);
    expect(slots[0]?.startsAt.toISOString()).toBe("2027-03-01T14:00:00.000Z");
    expect(slots[5]?.endsAt.toISOString()).toBe("2027-03-01T17:00:00.000Z");
  });

  it("removes slots overlapping a booking, an external busy block and a block exception", () => {
    const slots = generateSlots(
      base({
        from: new Date("2027-03-01T00:00:00Z"),
        to: new Date("2027-03-02T00:00:00Z"),
        booked: [
          { startsAt: new Date("2027-03-01T14:00:00Z"), endsAt: new Date("2027-03-01T14:30:00Z") },
        ],
        externalBusy: [
          { startsAt: new Date("2027-03-01T14:45:00Z"), endsAt: new Date("2027-03-01T15:15:00Z") },
        ],
        exceptions: [
          {
            type: "block",
            startsAt: new Date("2027-03-01T16:00:00Z"),
            endsAt: new Date("2027-03-01T17:00:00Z"),
          },
        ],
      }),
    );
    expect(slots.map((s) => s.startsAt.toISOString().slice(11, 16))).toEqual(["15:30"]);
  });

  it("an open exception adds hours outside the rules", () => {
    const slots = generateSlots(
      base({
        from: new Date("2027-03-06T00:00:00Z"), // Saturday local, no rule
        to: new Date("2027-03-07T12:00:00Z"),
        exceptions: [
          {
            type: "open",
            startsAt: new Date("2027-03-06T15:00:00Z"),
            endsAt: new Date("2027-03-06T16:00:00Z"),
          },
        ],
      }),
    );
    expect(slots).toHaveLength(2);
  });

  it("honours minimum notice and maximum advance", () => {
    const now = new Date("2027-03-01T14:10:00Z");
    const noticed = generateSlots(
      base({ now, from: now, minNoticeMinutes: 60, to: new Date("2027-03-02T00:00:00Z") }),
    );
    expect(noticed[0]?.startsAt.toISOString()).toBe("2027-03-01T15:30:00.000Z");
    const far = generateSlots(base({ maxAdvanceDays: 2, to: new Date("2027-03-20T00:00:00Z") }));
    expect(
      far.every((s) => s.startsAt.getTime() <= new Date("2027-03-03T00:00:00Z").getTime()),
    ).toBe(true);
  });

  it("respects validFrom / validUntil", () => {
    const rules: Rule[] = [
      {
        weekday: 1,
        startTime: "09:00",
        endTime: "10:00",
        validFrom: "2027-03-08",
        validUntil: null,
      },
    ];
    const slots = generateSlots(
      base({ rules, from: new Date("2027-03-01T00:00:00Z"), to: new Date("2027-03-15T00:00:00Z") }),
    );
    expect(slots.map((s) => local(s, "America/Lima"))).toEqual([
      "2027-03-08 09:00",
      "2027-03-08 09:30",
    ]);
  });

  it.each([
    ["America/Lima", "2027-03-01T14:00:00.000Z"],
    ["Asia/Kolkata", "2027-03-01T03:30:00.000Z"], // UTC+5:30
    ["America/Santiago", "2027-03-01T12:00:00.000Z"], // southern-hemisphere DST (UTC-3 in March)
    ["UTC", "2027-03-01T09:00:00.000Z"],
  ])("first Monday slot for %s starts at local 09:00", (zone, expectedUtc) => {
    const slots = generateSlots(
      base({ zone, from: new Date("2027-02-28T00:00:00Z"), to: new Date("2027-03-02T00:00:00Z") }),
    );
    const first = slots.find(
      (s) => DateTime.fromJSDate(s.startsAt, { zone }).toISODate() === "2027-03-01",
    );
    expect(first?.startsAt.toISOString()).toBe(expectedUtc);
    expect(local(first as { startsAt: Date }, zone)).toBe("2027-03-01 09:00");
  });

  it("keeps wall-clock 09:00 across a DST change (Santiago, DST ends 2027-04-03/04)", () => {
    const rules = weekdays("09:00", "09:30", [1, 2, 3, 4, 5, 6, 7]);
    const slots = generateSlots(
      base({
        zone: "America/Santiago",
        rules,
        from: new Date("2027-04-01T00:00:00Z"),
        to: new Date("2027-04-07T00:00:00Z"),
      }),
    );
    expect(
      new Set(
        slots.map((s) =>
          DateTime.fromJSDate(s.startsAt, { zone: "America/Santiago" }).toFormat("HH:mm"),
        ),
      ),
    ).toEqual(new Set(["09:00"]));
    expect(new Set(slots.map((s) => s.startsAt.getUTCHours())).size).toBe(2); // the UTC hour moved
  });

  it("emits no slot inside a spring-forward gap (Madrid 2027-03-28, 02:00-03:00 does not exist)", () => {
    const rules = weekdays("01:00", "05:00", [7]);
    const slots = generateSlots(
      base({
        zone: "Europe/Madrid",
        rules,
        durationMinutes: 60,
        slotIntervalMinutes: 60,
        from: new Date("2027-03-27T00:00:00Z"),
        to: new Date("2027-03-29T00:00:00Z"),
      }),
    );
    expect(slots.map((s) => local(s, "Europe/Madrid"))).toEqual([
      "2027-03-28 01:00",
      "2027-03-28 03:00",
      "2027-03-28 04:00",
    ]);
  });

  it("emits each real hour once on a fall-back day (Madrid 2027-10-31, 02:00-03:00 occurs twice)", () => {
    const rules = weekdays("01:00", "04:00", [7]);
    const slots = generateSlots(
      base({
        zone: "Europe/Madrid",
        rules,
        durationMinutes: 60,
        slotIntervalMinutes: 60,
        now: new Date("2027-10-01T00:00:00Z"),
        from: new Date("2027-10-30T00:00:00Z"),
        to: new Date("2027-11-01T00:00:00Z"),
      }),
    );
    expect(slots).toHaveLength(4);
    expect(new Set(slots.map((s) => s.startsAt.getTime())).size).toBe(4);
  });

  it("is pure: does not mutate its input", () => {
    const input = base();
    const snapshot = JSON.stringify(input);
    generateSlots(input);
    expect(JSON.stringify(input)).toBe(snapshot);
  });
});
```

**Acceptance**
- [ ] WHEN `generateSlots` expands a Monday 09:00-12:00 rule for `America/Lima` with 30-minute slots THE SYSTEM SHALL return 6 slots, the first starting at `2027-03-01T14:00:00.000Z`.
- [ ] WHEN a booking, an external busy block or a `block` exception overlaps a slot THE SYSTEM SHALL omit that slot, and WHEN an `open` exception adds hours outside the rules THE SYSTEM SHALL offer slots inside them.
- [ ] WHEN `minNoticeMinutes`, `maxAdvanceDays` or a rule's `validFrom`/`validUntil` exclude a time THE SYSTEM SHALL not offer it.
- [ ] WHEN the zone is `America/Lima`, `Asia/Kolkata`, `America/Santiago` or `UTC` THE SYSTEM SHALL start the first Monday slot at local 09:00 in that zone, and across the Santiago DST change THE SYSTEM SHALL keep wall-clock 09:00 while the UTC hour changes.
- [ ] WHEN a working window spans the Madrid spring-forward gap (2027-03-28) THE SYSTEM SHALL offer no slot inside the non-existent hour, and WHEN it spans the fall-back repeated hour (2027-10-31) THE SYSTEM SHALL offer each real hour exactly once.
- [ ] WHEN `generateSlots` is called THE SYSTEM SHALL not mutate its input and SHALL not read the clock (the caller passes `now`).

**Verify**
```bash
pnpm test:unit tests/unit/generate-slots.test.ts
pnpm typecheck
pnpm lint
```

**Checkpoint**
```bash
git add -A && git commit -m "step 7: availability-engine"
git tag step-07-availability-engine
git rev-parse --verify step-07-availability-engine   # expect: a commit id, exit 0
```

---

### E2-T2 — Step 8: Citas: reservas sin doble reserva y servicio de agenda

| | |
|---|---|
| **Depende de** | `E1-T2`, `E1-T5`, `E2-T1` |
| **Prioridad** | p0 |
| **Archivos** | `supabase/migrations/20261020000004_scheduling.sql`, `src/server/availability.ts`, `src/server/appointments.ts`, `tests/db/booking.test.ts`, `tests/db/appointments-service.test.ts` |
| **Etiqueta** | `step-08-appointments` |

**Do**
Reservas. **La consulta de disponibilidad es orientativa; la escritura es la autoridad.** La restricción de exclusión de Postgres (`appointments_no_overlap`, `EXCLUDE USING gist` sobre `membership_id` y el rango de la cita, solo para estados `held`/`confirmed`) impide el doble agendado bajo concurrencia; el servicio traduce el error `23P01` a `SlotTakenError`. Nunca "revisar y luego insertar" sin esa restricción.

`supabase/migrations/20261020000004_scheduling.sql`

```sql
-- supabase/migrations/20261020000004_scheduling.sql
create type appointment_status as enum ('held', 'confirmed', 'completed', 'cancelled', 'no_show');
create type appointment_source as enum ('web', 'whatsapp', 'google');

create table availability_rules (
  id uuid primary key default gen_random_uuid(),
  clinic_id uuid not null references clinics (id) on delete restrict,
  membership_id uuid not null references memberships (id) on delete restrict,
  weekday smallint not null check (weekday between 1 and 7), -- ISO: 1 = Monday ... 7 = Sunday
  start_time time not null,
  end_time time not null,
  valid_from date not null default current_date,
  valid_until date,
  created_at timestamptz not null default now(),
  check (end_time > start_time),
  check (valid_until is null or valid_until >= valid_from)
);
create index availability_rules_member_idx on availability_rules (membership_id, weekday);

create table availability_exceptions (
  id uuid primary key default gen_random_uuid(),
  clinic_id uuid not null references clinics (id) on delete restrict,
  membership_id uuid not null references memberships (id) on delete restrict,
  starts_at timestamptz not null,
  ends_at timestamptz not null,
  type text not null check (type in ('block', 'open')),
  reason text,
  created_at timestamptz not null default now(),
  check (ends_at > starts_at)
);
create index availability_exceptions_member_idx on availability_exceptions (membership_id, starts_at);

create table appointments (
  id uuid primary key default gen_random_uuid(),
  clinic_id uuid not null references clinics (id) on delete restrict,
  patient_id uuid not null references patients (id) on delete restrict,
  membership_id uuid not null references memberships (id) on delete restrict, -- the dentist
  starts_at timestamptz not null,
  ends_at timestamptz not null,
  blocking_range tstzrange generated always as (tstzrange(starts_at, ends_at, '[)')) stored,
  status appointment_status not null default 'confirmed',
  source appointment_source not null default 'web',
  reason text,
  google_event_id text,
  rescheduled_from_id uuid references appointments (id),
  created_by uuid references memberships (id),
  created_at timestamptz not null default now(),
  check (ends_at > starts_at),
  constraint appointments_no_overlap exclude using gist (
    membership_id with =, blocking_range with &&
  ) where (status in ('held', 'confirmed'))
);
-- Cache of busy blocks from a connected Google Calendar. Advisory only.
create table external_busy (
  id uuid primary key default gen_random_uuid(),
  clinic_id uuid not null references clinics (id) on delete restrict,
  membership_id uuid not null references memberships (id) on delete restrict,
  starts_at timestamptz not null,
  ends_at timestamptz not null,
  fetched_at timestamptz not null default now(),
  check (ends_at > starts_at)
);
create index external_busy_member_idx on external_busy (membership_id, starts_at);

create index appointments_clinic_start_idx on appointments (clinic_id, starts_at);
create index appointments_patient_idx on appointments (patient_id, starts_at);

alter table availability_rules enable row level security;
alter table availability_exceptions enable row level security;
alter table appointments enable row level security;
alter table external_busy enable row level security;

create policy rules_select on availability_rules for select to authenticated
  using (clinic_id in (select current_clinic_ids()));
create policy rules_write on availability_rules for insert to authenticated
  with check (is_clinic_admin(clinic_id) or membership_id in
    (select id from memberships where user_id = auth.uid()));
create policy rules_update on availability_rules for update to authenticated
  using (is_clinic_admin(clinic_id) or membership_id in
    (select id from memberships where user_id = auth.uid()))
  with check (clinic_id in (select current_clinic_ids()));

create policy exceptions_select on availability_exceptions for select to authenticated
  using (clinic_id in (select current_clinic_ids()));
create policy exceptions_write on availability_exceptions for insert to authenticated
  with check (is_clinic_admin(clinic_id) or membership_id in
    (select id from memberships where user_id = auth.uid()));
create policy exceptions_update on availability_exceptions for update to authenticated
  using (is_clinic_admin(clinic_id) or membership_id in
    (select id from memberships where user_id = auth.uid()))
  with check (clinic_id in (select current_clinic_ids()));

create policy external_busy_select on external_busy for select to authenticated
  using (clinic_id in (select current_clinic_ids()));

create policy appointments_select on appointments for select to authenticated
  using (clinic_id in (select current_clinic_ids()));
create policy appointments_insert on appointments for insert to authenticated
  with check (clinic_id in (select current_clinic_ids()));
create policy appointments_update on appointments for update to authenticated
  using (clinic_id in (select current_clinic_ids()))
  with check (clinic_id in (select current_clinic_ids()));
```

`tests/db/booking.test.ts`

```ts
import { afterAll, describe, expect, it } from "vitest";
import { asUser, closePool, createPatientRow, pool, seedClinic } from "./helpers";

afterAll(closePool);

const insertAppointment = (
  a: Awaited<ReturnType<typeof seedClinic>>,
  patientId: string,
  start: string,
  end: string,
  status = "confirmed",
) =>
  pool.query(
    "insert into appointments (clinic_id, patient_id, membership_id, starts_at, ends_at, status) values ($1, $2, $3, $4, $5, $6) returning id",
    [a.clinicId, patientId, a.dentist.membershipId, start, end, status],
  );

describe("appointments", () => {
  it("50 concurrent bookings of one slot: exactly one succeeds, 49 fail with exclusion_violation", async () => {
    const a = await seedClinic();
    const patientId = await createPatientRow(a.clinicId);
    const results = await Promise.allSettled(
      Array.from({ length: 50 }, () =>
        insertAppointment(a, patientId, "2027-03-01T15:00:00Z", "2027-03-01T15:30:00Z"),
      ),
    );
    expect(results.filter((r) => r.status === "fulfilled")).toHaveLength(1);
    const failures = results.filter((r): r is PromiseRejectedResult => r.status === "rejected");
    expect(failures).toHaveLength(49);
    expect(failures.every((f) => f.reason.code === "23P01")).toBe(true);
    const { rows } = await pool.query(
      "select count(*)::int as n from appointments where clinic_id = $1",
      [a.clinicId],
    );
    expect(rows[0].n).toBe(1);
  });

  it("overlapping ranges conflict, back-to-back ranges do not, cancelled ones free the slot", async () => {
    const a = await seedClinic();
    const patientId = await createPatientRow(a.clinicId);
    const first = await insertAppointment(
      a,
      patientId,
      "2027-03-02T15:00:00Z",
      "2027-03-02T15:30:00Z",
    );
    await expect(
      insertAppointment(a, patientId, "2027-03-02T15:15:00Z", "2027-03-02T15:45:00Z"),
    ).rejects.toThrow(/appointments_no_overlap/);
    await insertAppointment(a, patientId, "2027-03-02T15:30:00Z", "2027-03-02T16:00:00Z");
    await pool.query("update appointments set status = 'cancelled' where id = $1", [
      first.rows[0].id,
    ]);
    await insertAppointment(a, patientId, "2027-03-02T15:00:00Z", "2027-03-02T15:30:00Z");
  });

  it("the same time with a different dentist is allowed", async () => {
    const a = await seedClinic();
    const patientId = await createPatientRow(a.clinicId);
    await insertAppointment(a, patientId, "2027-03-03T15:00:00Z", "2027-03-03T15:30:00Z");
    await pool.query(
      "insert into appointments (clinic_id, patient_id, membership_id, starts_at, ends_at) values ($1, $2, $3, '2027-03-03T15:00:00Z', '2027-03-03T15:30:00Z')",
      [a.clinicId, patientId, a.admin.membershipId],
    );
  });

  it("RLS keeps appointments inside the clinic", async () => {
    const a = await seedClinic();
    const b = await seedClinic();
    await insertAppointment(
      a,
      await createPatientRow(a.clinicId),
      "2027-03-04T15:00:00Z",
      "2027-03-04T15:30:00Z",
    );
    expect(
      (await asUser(b.admin.userId, (c) => c.query("select id from appointments"))).rowCount,
    ).toBe(0);
    expect(
      (await asUser(a.assistant.userId, (c) => c.query("select id from appointments"))).rowCount,
    ).toBe(1);
  });
});
```

**`src/server/availability.ts`**:
```ts
export type SlotQuery = { membershipId: string; from: Date; to: Date; durationMinutes: number };
export type SlotOffer = { startsAt: Date; endsAt: Date };
export const SLOT_DEFAULTS = { slotIntervalMinutes: 30, minNoticeMinutes: 60, maxAdvanceDays: 60 } as const;
export function loadSlots(actor: Actor, q: SlotQuery, opts?: { now?: Date }): Promise<SlotOffer[]>;
// Lee, filtrando por actor.clinicId: clinics.timezone, availability_rules y availability_exceptions del dentista,
// appointments en estado held/confirmed del dentista que intersecten [from, to), y external_busy del dentista.
// Convierte filas a los tipos de generateSlots (weekday, startTime "HH:mm:ss", validFrom/validUntil "YYYY-MM-DD") y la llama con now = opts.now ?? new Date().
```

**`src/server/appointments.ts`**:
```ts
export class SlotTakenError extends Error {}            // 23P01 del constraint appointments_no_overlap
export class OutsideAvailabilityError extends Error {}  // el inicio+duración no coincide con un slot de loadSlots
export type Appointment = { id: string; clinicId: string; patientId: string; membershipId: string; startsAt: Date; endsAt: Date; status: "held"|"confirmed"|"completed"|"cancelled"|"no_show"; source: "web"|"whatsapp"|"google"; reason: string | null };
export function bookAppointment(actor: Actor, input: { patientId: string; membershipId: string; startsAt: Date; durationMinutes: number; reason?: string; source?: "web"|"whatsapp" }, opts?: { now?: Date }): Promise<Appointment>;
// 1) Recalcula loadSlots para [startsAt, startsAt + duration) y exige un slot con ese inicio exacto, si no: OutsideAvailabilityError.
// 2) INSERT con status 'confirmed'. Sin transacciones largas: nada de red ni correo dentro.
// 3) Captura code 23P01 => SlotTakenError. Verifica que patient y dentista pertenezcan a actor.clinicId.
export function cancelAppointment(actor: Actor, appointmentId: string): Promise<void>;   // status = 'cancelled'
export function rescheduleAppointment(actor: Actor, appointmentId: string, input: { startsAt: Date; durationMinutes: number }, opts?: { now?: Date }): Promise<Appointment>;
// En UNA transacción: cancela la antigua e inserta la nueva (rescheduled_from_id). Si la nueva choca: SlotTakenError y la antigua sigue 'confirmed' (rollback).
export function listAppointments(actor: Actor, q: { from: Date; to: Date; membershipId?: string }): Promise<Array<Appointment & { patientName: string; dentistName: string }>>;
```
**Tests de servicio** (`tests/db/appointments-service.test.ts`): los criterios 2 a 6, insertando la regla del dentista con SQL directo (`availability_rules`: weekday 1, 09:00-12:00, `valid_from` en el pasado) y fijando `now` con `opts.now` a un domingo conocido para que "el próximo lunes" sea determinista. La concurrencia (criterio 5) usa `Promise.allSettled` sobre 20 llamadas.

**Acceptance**
- [ ] WHEN `pnpm test:db tests/db/booking.test.ts` runs THE SYSTEM SHALL pass, including the test in which 50 concurrent inserts of one slot for one dentist yield exactly 1 success and 49 `exclusion_violation` (SQLSTATE 23P01) failures.
- [ ] WHEN `loadSlots` runs for a dentist with a Monday 09:00-12:00 rule, no bookings, and a 30-minute duration THE SYSTEM SHALL return 6 slots for the next Monday in `America/Lima`.
- [ ] WHEN `bookAppointment` receives a slot returned by `loadSlots` THE SYSTEM SHALL insert one `confirmed` appointment and that slot SHALL no longer appear in `loadSlots`.
- [ ] WHEN `bookAppointment` receives a time outside the dentist's working hours THE SYSTEM SHALL throw `OutsideAvailabilityError` and insert nothing.
- [ ] WHEN 20 `bookAppointment` calls for the same slot run concurrently THE SYSTEM SHALL resolve exactly one and reject the other 19 with `SlotTakenError`.
- [ ] WHEN `rescheduleAppointment` targets a free slot THE SYSTEM SHALL cancel the old row and insert a new `confirmed` row with `rescheduled_from_id` set, and WHEN the new slot is taken THE SYSTEM SHALL throw `SlotTakenError` and leave the old appointment `confirmed`.

**Verify**
```bash
pnpm db:up
pnpm test:db tests/db/booking.test.ts
pnpm test:db tests/db/appointments-service.test.ts
pnpm typecheck
pnpm lint
```

**Checkpoint**
```bash
git add -A && git commit -m "step 8: appointments"
git tag step-08-appointments
git rev-parse --verify step-08-appointments   # expect: a commit id, exit 0
```

---

### E2-T3 — Step 9: Agenda: horarios del dentista y pantalla de citas

| | |
|---|---|
| **Depende de** | `E2-T2`, `E1-T4` |
| **Prioridad** | p0 |
| **Archivos** | `src/server/schedules.ts`, `src/app/api/availability/route.ts`, `src/app/(app)/agenda/**`, `src/app/(app)/configuracion/horarios/**`, `tests/db/schedules.test.ts` |
| **Etiqueta** | `step-09-agenda-ui` |

**Do**
Interfaz de la agenda y horarios.

**`src/server/schedules.ts`**:
```ts
export type WeeklyRule = { weekday: number /* 1=lunes..7=domingo */; startTime: string /* "HH:mm" */; endTime: string };
export function getWeeklyRules(actor: Actor, membershipId: string): Promise<WeeklyRule[]>;     // reglas vigentes hoy
export function setWeeklyRules(actor: Extract<Actor, { kind: "user" }>, role: Role, membershipId: string, rules: WeeklyRule[]): Promise<void>;
// Permiso: admin sobre cualquier dentista/miembro de su clínica; dentist solo sobre sí mismo (membershipId === actor.membershipId); assistant nunca => ForbiddenError.
// Validación zod: weekday 1..7, HH:mm, endTime > startTime, sin solapamientos dentro del mismo día.
// Reemplazo en UNA transacción: UPDATE availability_rules SET valid_until = (hoy de Lima - 1 día) WHERE membership_id = $1 AND (valid_until IS NULL OR valid_until >= hoy); luego INSERT de las nuevas con valid_from = hoy de Lima.
export function addBlockException(actor: Extract<Actor, { kind: "user" }>, role: Role, membershipId: string, input: { startsAt: Date; endsAt: Date; reason?: string }): Promise<{ id: string }>; // mismos permisos
```
`role` es `SessionCtx.role`. `ForbiddenError` viene de `src/server/session.ts`.

**`src/app/api/availability/route.ts`**: `export async function GET(request: Request)`. `getSession()` nulo ⇒ `Response.json({ error: "unauthorized" }, { status: 401 })`. Parámetros `dentist` (uuid), `from`, `to` (ISO), `minutes` (entero 5–480), validados con zod ⇒ 400 si fallan. Llama `loadSlots(userActor(ctx), …)` y responde `{ slots: [{ startsAt, endsAt }] }`.

**Tests** (`tests/db/schedules.test.ts`): los 5 criterios; el 4 y el 5 invocan `GET` con `vi.mock("@/server/session")` para fijar `getSession`.

**Interfaz**:
- `src/app/(app)/configuracion/horarios/`: tabla semanal por dentista (7 filas, una o dos franjas por día), guardar con `setWeeklyRules`; formulario "Bloquear horario" (vacaciones, permisos).
- `src/app/(app)/agenda/`: vista de **semana** (columnas = días, filtro por dentista) con las citas de `listAppointments`; formulario "Nueva cita": buscar paciente (reusa `searchPatients`), elegir dentista y duración, listar horarios libres de `loadSlots` como botones, confirmar con `bookAppointment` (muestra "Ese horario acaba de ocuparse, elige otro" ante `SlotTakenError`); cada cita permite **Cancelar** y **Reprogramar**. Todas las horas se muestran en la zona de la clínica con etiqueta ("09:00 hora de Lima").

**Acceptance**
- [ ] WHEN `setWeeklyRules` replaces a dentist's rules THE SYSTEM SHALL, in one transaction, set `valid_until` on the open rules to the day before today and insert the new rules with `valid_from` today, leaving no gap and no deletion.
- [ ] WHEN a dentist calls `setWeeklyRules` for another dentist THE SYSTEM SHALL throw `ForbiddenError`, and WHEN an admin does THE SYSTEM SHALL succeed, and WHEN an assistant does THE SYSTEM SHALL throw `ForbiddenError`.
- [ ] WHEN `addBlockException` covers part of a working day THE SYSTEM SHALL make `loadSlots` return fewer slots for that day.
- [ ] WHEN `GET /api/availability` is called with a valid session and `dentist`, `from`, `to` and `minutes` THE SYSTEM SHALL answer 200 with `{ slots: [{ startsAt, endsAt }] }` in ISO UTC strings.
- [ ] WHEN `GET /api/availability` is called without a session THE SYSTEM SHALL answer 401, and WHEN `minutes` is missing or not between 5 and 480 THE SYSTEM SHALL answer 400.

**Verify**
```bash
pnpm db:up
pnpm test:db tests/db/schedules.test.ts
pnpm typecheck
pnpm lint
pnpm build
```

**Checkpoint**
```bash
git add -A && git commit -m "step 9: agenda-ui"
git tag step-09-agenda-ui
git rev-parse --verify step-09-agenda-ui   # expect: a commit id, exit 0
```

---

### E2-T4 — Step 10: Recordatorios por WhatsApp (con simulador) y cron

| | |
|---|---|
| **Depende de** | `E2-T2`, `E1-T5` |
| **Prioridad** | p0 |
| **Archivos** | `supabase/migrations/20261020000005_reminders.sql`, `src/lib/whatsapp/client.ts`, `src/server/reminders.ts`, `src/app/api/cron/**`, `tests/db/reminders*.test.ts` |
| **Etiqueta** | `step-10-reminders` |

**Do**
Recordatorios 24 h y 2 h antes de cada cita. Los recordatorios los crea y mantiene **un trigger en la base de datos**, en la misma transacción que la cita (reprogramar los mueve, cancelar los omite); un proceso los envía.

`supabase/migrations/20261020000005_reminders.sql`

```sql
-- supabase/migrations/20261020000005_reminders.sql
create type reminder_kind as enum ('h24', 'h2');
create type reminder_status as enum ('pending', 'sent', 'failed', 'skipped');

create table whatsapp_messages (
  id uuid primary key default gen_random_uuid(),
  clinic_id uuid not null references clinics (id) on delete restrict,
  patient_id uuid references patients (id) on delete restrict,
  direction text not null check (direction in ('in', 'out')),
  wa_message_id text unique,
  phone_e164 text not null,
  body text not null,
  template_name text,
  status text not null default 'received'
    check (status in ('received', 'processed', 'queued', 'sent', 'failed')),
  error text,
  created_at timestamptz not null default now()
);
create index whatsapp_messages_phone_idx on whatsapp_messages (clinic_id, phone_e164, created_at);

create table reminders (
  id uuid primary key default gen_random_uuid(),
  clinic_id uuid not null references clinics (id) on delete restrict,
  appointment_id uuid not null references appointments (id) on delete restrict,
  kind reminder_kind not null,
  due_at timestamptz not null,
  status reminder_status not null default 'pending',
  attempts smallint not null default 0,
  last_error text,
  sent_at timestamptz,
  message_id uuid references whatsapp_messages (id),
  created_at timestamptz not null default now(),
  unique (appointment_id, kind)
);
create index reminders_due_idx on reminders (due_at) where status = 'pending';

alter table whatsapp_messages enable row level security;
alter table reminders enable row level security;
create policy whatsapp_messages_select on whatsapp_messages for select to authenticated
  using (current_role_in(clinic_id) in ('admin', 'dentist', 'assistant'));
create policy reminders_select on reminders for select to authenticated
  using (clinic_id in (select current_clinic_ids()));

-- Keep reminders in step with the appointment, inside the same transaction as the booking write.
-- SECURITY DEFINER: the booking user has no INSERT policy on reminders; the trigger writes on their behalf.
create function sync_appointment_reminders() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if new.status = 'confirmed' then
    insert into reminders (clinic_id, appointment_id, kind, due_at)
    select new.clinic_id, new.id, k.kind, new.starts_at - k.lead
    from (values ('h24'::reminder_kind, interval '24 hours'), ('h2'::reminder_kind, interval '2 hours'))
      as k (kind, lead)
    where new.starts_at - k.lead > now()
    on conflict (appointment_id, kind) do update
      set due_at = excluded.due_at, status = 'pending', attempts = 0, last_error = null
      where reminders.status in ('pending', 'skipped')
        and reminders.due_at is distinct from excluded.due_at;
  else
    update reminders set status = 'skipped'
    where appointment_id = new.id and status = 'pending';
  end if;
  return new;
end $$;

create trigger appointments_sync_reminders
  after insert or update of status, starts_at on appointments
  for each row execute function sync_appointment_reminders();
```

`tests/db/reminders.test.ts`

```ts
import { afterAll, describe, expect, it } from "vitest";
import { asUser, closePool, createPatientRow, pool, seedClinic } from "./helpers";

afterAll(closePool);

const hours = (n: number) => new Date(Date.now() + n * 3_600_000).toISOString();

async function book(startsInHours: number) {
  const a = await seedClinic();
  const patientId = await createPatientRow(a.clinicId);
  const { rows } = await pool.query<{ id: string }>(
    "insert into appointments (clinic_id, patient_id, membership_id, starts_at, ends_at) values ($1, $2, $3, $4, $5) returning id",
    [
      a.clinicId,
      patientId,
      a.dentist.membershipId,
      hours(startsInHours),
      hours(startsInHours + 0.5),
    ],
  );
  return { a, id: rows[0]?.id as string };
}
const reminders = async (id: string) =>
  (
    await pool.query(
      "select kind, status, due_at from reminders where appointment_id = $1 order by kind",
      [id],
    )
  ).rows;

describe("reminders", () => {
  it("a confirmed appointment 72h away gets pending h24 and h2 reminders at the right times", async () => {
    const { id } = await book(72);
    const rows = await reminders(id);
    expect(rows.map((r) => [r.kind, r.status])).toEqual([
      ["h24", "pending"],
      ["h2", "pending"],
    ]);
    const start = Date.now() + 72 * 3_600_000;
    expect(Math.abs(new Date(rows[0].due_at).getTime() - (start - 24 * 3_600_000))).toBeLessThan(
      5_000,
    );
  });

  it("an appointment under 24h away gets only the h2 reminder; under 2h away, none", async () => {
    expect((await reminders((await book(10)).id)).map((r) => r.kind)).toEqual(["h2"]);
    expect(await reminders((await book(1)).id)).toEqual([]);
  });

  it("cancelling skips pending reminders; rescheduling moves their due time", async () => {
    const { id } = await book(72);
    await pool.query("update appointments set starts_at = $2, ends_at = $3 where id = $1", [
      id,
      hours(96),
      hours(96.5),
    ]);
    const moved = await reminders(id);
    const start = Date.now() + 96 * 3_600_000;
    expect(Math.abs(new Date(moved[0].due_at).getTime() - (start - 24 * 3_600_000))).toBeLessThan(
      5_000,
    );
    await pool.query("update appointments set status = 'cancelled' where id = $1", [id]);
    expect((await reminders(id)).every((r) => r.status === "skipped")).toBe(true);
  });

  it("an already-sent reminder is not reset when the appointment is touched", async () => {
    const { id } = await book(72);
    await pool.query(
      "update reminders set status = 'sent', sent_at = now() where appointment_id = $1 and kind = 'h24'",
      [id],
    );
    await pool.query("update appointments set starts_at = starts_at where id = $1", [id]);
    expect((await reminders(id)).find((r) => r.kind === "h24")?.status).toBe("sent");
  });

  it("works when a signed-in user books under RLS: the trigger writes reminders on their behalf", async () => {
    const a = await seedClinic();
    const patientId = await createPatientRow(a.clinicId);
    const { rows } = await asUser(a.assistant.userId, (c) =>
      c.query<{ id: string }>(
        "insert into appointments (clinic_id, patient_id, membership_id, starts_at, ends_at) values ($1, $2, $3, $4, $5) returning id",
        [a.clinicId, patientId, a.dentist.membershipId, hours(72), hours(72.5)],
      ),
    );
    const id = rows[0]?.id as string;
    expect((await reminders(id)).map((r) => r.kind)).toEqual(["h24", "h2"]);
    await asUser(a.assistant.userId, (c) =>
      c.query("update appointments set status = 'cancelled' where id = $1", [id]),
    );
    expect((await reminders(id)).every((r) => r.status === "skipped")).toBe(true);
  });
});
```

**`src/lib/whatsapp/client.ts`**:
```ts
export const GRAPH_API_VERSION = "v23.0"; // UNVERIFIED: ejemplo en la documentación de Meta; confirmar la versión vigente antes de producción (§20.2)
export type TemplateMessage = { to: string /* E.164 */; template: "recordatorio_cita"; language: "es"; params: string[] };
export type TextMessage = { to: string; body: string };
export interface WhatsAppSender {
  sendTemplate(phoneNumberId: string, message: TemplateMessage): Promise<{ id: string }>;
  sendText(phoneNumberId: string, message: TextMessage): Promise<{ id: string }>;
}
export class SimulatorSender implements WhatsAppSender { readonly sent: Array<{ kind: "template" | "text"; to: string; payload: unknown }>; /* ids "sim-1", "sim-2"… */ }
export class CloudApiSender implements WhatsAppSender {
  constructor(accessToken: string, fetchImpl?: typeof fetch);
  // POST https://graph.facebook.com/{GRAPH_API_VERSION}/{phoneNumberId}/messages con Authorization: Bearer; cuerpo { messaging_product: "whatsapp", to, type: "template", template: { name, language: { code: "es" }, components: [{ type: "body", parameters: params.map(text => ({ type: "text", text })) }] } } (o type "text" con text.body);
  // respuesta no 2xx => Error con el status y el cuerpo; éxito => { id: json.messages[0].id }
}
export function getSender(): WhatsAppSender; // getEnv("whatsapp"): "cloud" => CloudApiSender(token); "simulator" => una instancia SimulatorSender compartida por proceso
```
**Plantilla de WhatsApp** (se registra en Meta; categoría *utility*, idioma `es`), nombre `recordatorio_cita`, cuerpo exacto:
```
Hola {{1}}, le recordamos su cita en {{2}} el {{3}} a las {{4}} con {{5}}. Responda 1 para confirmar o 2 para reprogramar.
```
Parámetros: nombre del paciente, nombre de la clínica, fecha `dd/MM/yyyy`, hora `HH:mm` (zona de la clínica), nombre del dentista.

**`src/server/reminders.ts`**:
```ts
export function runDueReminders(opts?: { now?: Date; sender?: WhatsAppSender; limit?: number }): Promise<{ sent: number; failed: number; skipped: number }>;
// En una transacción por lote (withService): SELECT … FROM reminders WHERE status='pending' AND due_at <= now ORDER BY due_at LIMIT limit FOR UPDATE SKIP LOCKED.
// Por recordatorio: cargar cita, paciente, clínica (whatsapp_phone_number_id), dentista.
//  - cita no 'confirmed', o starts_at <= now, o paciente sin teléfono/opt-in, o clínica sin whatsapp_phone_number_id (y modo cloud) => status 'skipped'.
//  - si no: sender.sendTemplate(...) con los 5 parámetros; insertar whatsapp_messages {direction:'out', template_name, status:'sent', wa_message_id}; reminder => 'sent', sent_at, message_id.
//  - si el sender lanza: attempts += 1; last_error = mensaje; si attempts >= 3 => 'failed', si no se queda 'pending'.
```
**`src/app/api/cron/auth.ts`**: `export function assertCron(request: Request): Response | null` — compara `Authorization: Bearer <CRON_SECRET>` (`getEnv("cron")`) en tiempo constante (`crypto.timingSafeEqual` sobre buffers del mismo largo; largo distinto ⇒ no autorizado); devuelve `Response.json({ error: "unauthorized" }, { status: 401 })` si no coincide y `null` si sí. Lo reutilizan las demás rutas de cron.

**`src/app/api/cron/tick/route.ts`**: `export async function POST(request: Request)` (y `GET` igual, para pruebas manuales): si `assertCron` devuelve respuesta ⇒ la devuelve sin procesar; si no ⇒ `runDueReminders()` y `Response.json({ reminders })`. Otras tareas programadas viven en sus propias rutas (`/api/google/cron` en el paso 11, `/api/whatsapp/cron` en el paso 17); el programador del paso 18 las llama a las tres.

**Tests de servicio** (`tests/db/reminders-service.test.ts`, nuevo, escrito por el builder): criterios 2 a 6, con `SimulatorSender`/un sender falso, citas insertadas por SQL (como en `tests/db/reminders.test.ts`) y `opts.now` para adelantar el reloj. La concurrencia (criterio 5): dos `runDueReminders` en paralelo con el mismo sender; el total de envíos debe ser igual al número de recordatorios.

**Acceptance**
- [ ] WHEN `pnpm test:db tests/db/reminders.test.ts` runs THE SYSTEM SHALL pass, proving that a confirmed appointment 72 hours away gets pending `h24` and `h2` reminders due 24 h and 2 h before it, that one 10 hours away gets only `h2`, that cancelling skips pending reminders, and that a `sent` reminder is not reset.
- [ ] WHEN `runDueReminders` runs for a due reminder whose patient has `whatsapp_opt_in = true` THE SYSTEM SHALL send the template `recordatorio_cita` with 5 parameters through the injected sender, insert one outbound `whatsapp_messages` row, and set the reminder `sent`.
- [ ] WHEN the patient has no opt-in or no phone THE SYSTEM SHALL mark the reminder `skipped` and SHALL NOT call the sender.
- [ ] WHEN the sender throws THE SYSTEM SHALL increment `attempts` and keep the reminder `pending` until the third failure, after which it SHALL be `failed` with `last_error` set.
- [ ] WHEN two `runDueReminders` calls run concurrently over the same due reminders THE SYSTEM SHALL send each reminder exactly once.
- [ ] WHEN `POST /api/cron/tick` receives a missing or wrong bearer token THE SYSTEM SHALL answer 401 and process nothing, and WHEN it receives `Authorization: Bearer <CRON_SECRET>` THE SYSTEM SHALL answer 200 with a JSON summary.

**Verify**
```bash
pnpm db:up
pnpm test:db tests/db/reminders.test.ts
pnpm test:db tests/db/reminders-service.test.ts
pnpm typecheck
pnpm lint
```

**Checkpoint**
```bash
git add -A && git commit -m "step 10: reminders"
git tag step-10-reminders
git rev-parse --verify step-10-reminders   # expect: a commit id, exit 0
```

---

### E2-T5 — Step 11: Google Calendar: conexión, publicación de citas y bloqueos

| | |
|---|---|
| **Depende de** | `E2-T2`, `E2-T4` |
| **Prioridad** | p1 |
| **Archivos** | `supabase/migrations/20261020000006_google.sql`, `src/lib/google/**`, `src/app/api/google/**`, `src/app/(app)/configuracion/google/**`, `tests/db/google.test.ts` |
| **Etiqueta** | `step-11-google-calendar` |

**Do**
Cada dentista puede conectar **su** Google Calendar (OAuth, acceso sin conexión). Las citas confirmadas se publican como eventos y sus bloqueos de "ocupado" se leen para no ofrecer esos horarios. **Diseño desacoplado:** la sincronización corre en el cron (cada 5 minutos), no dentro de la reserva, de modo que un fallo de Google nunca impide agendar. El refresh token se guarda **cifrado** (AES-256-GCM) y el navegador nunca puede leerlo (permiso de columna en la migración).

`supabase/migrations/20261020000006_google.sql`

```sql
-- supabase/migrations/20261020000006_google.sql
create table google_connections (
  id uuid primary key default gen_random_uuid(),
  clinic_id uuid not null references clinics (id) on delete restrict,
  membership_id uuid not null unique references memberships (id) on delete restrict,
  google_email text not null,
  calendar_id text not null default 'primary',
  refresh_token_enc text not null,
  status text not null default 'active' check (status in ('active', 'revoked', 'error')),
  last_error text,
  created_at timestamptz not null default now()
);

alter table google_connections enable row level security;
-- refresh_token_enc must never reach the browser: no SELECT for authenticated, the server reads it as owner.
revoke select on google_connections from authenticated;
grant select (id, clinic_id, membership_id, google_email, calendar_id, status, created_at)
  on google_connections to authenticated;
create policy google_connections_select on google_connections for select to authenticated
  using (membership_id in (select id from memberships where user_id = auth.uid()) or is_clinic_admin(clinic_id));
```

**`src/lib/google/`** (usa `fetch` directo; todas las funciones reciben `fetchImpl: typeof fetch = fetch` para los tests):
```ts
// crypto.ts — getEnv("crypto").TOKEN_ENC_KEY (32 bytes base64)
export function encryptToken(plain: string): string;      // "v1:<iv b64>:<tag b64>:<ciphertext b64>", IV aleatorio de 12 bytes, AES-256-GCM
export function decryptToken(enc: string): string;        // lanza si el formato, el tag o el contenido no son válidos
export function signState(membershipId: string, now?: Date): string;  // "<membershipId>.<expEpochSeconds>.<hmac-sha256 hex>" con TOKEN_ENC_KEY; vigencia 10 minutos
export function verifyState(state: string, now?: Date): string;       // devuelve membershipId o lanza (firma mala, vencido, formato)
// oauth.ts
export const SCOPES = ["openid", "email", "https://www.googleapis.com/auth/calendar.events", "https://www.googleapis.com/auth/calendar.freebusy"]; // UNVERIFIED: confirmar contra la documentación de Google (§20.2)
export function buildAuthUrl(state: string): string;      // https://accounts.google.com/o/oauth2/v2/auth con client_id, redirect_uri = APP_URL + "/api/google/oauth/callback", response_type=code, scope, access_type=offline, prompt=consent, state
export function exchangeCode(code: string, fetchImpl?: typeof fetch): Promise<{ refreshToken: string; email: string }>;  // POST https://oauth2.googleapis.com/token; email del payload del id_token (se decodifica sin verificar: llega directo de Google por TLS)
export function accessTokenFromRefresh(refreshToken: string, fetchImpl?: typeof fetch): Promise<string>;  // lanza GoogleAuthError con code "invalid_grant" cuando Google responde error invalid_grant
export class GoogleAuthError extends Error { code: string }
// calendar.ts — base https://www.googleapis.com/calendar/v3
export function createEvent(accessToken: string, calendarId: string, ev: { summary: string; description?: string; startsAt: Date; endsAt: Date; timeZone: string }, fetchImpl?: typeof fetch): Promise<string>; // POST /calendars/{id}/events => id
export function deleteEvent(accessToken: string, calendarId: string, eventId: string, fetchImpl?: typeof fetch): Promise<void>; // DELETE; 404/410 se tratan como éxito
export function queryBusy(accessToken: string, calendarId: string, from: Date, to: Date, fetchImpl?: typeof fetch): Promise<Array<{ startsAt: Date; endsAt: Date }>>; // POST https://www.googleapis.com/calendar/v3/freeBusy
```
**`src/lib/google/sync.ts`**:
```ts
export function connectGoogle(actor: Actor, membershipId: string, code: string, fetchImpl?: typeof fetch): Promise<void>; // exchangeCode + upsert google_connections (refresh_token_enc = encryptToken)
export function runGoogleSync(opts?: { now?: Date; fetchImpl?: typeof fetch }): Promise<{ created: number; deleted: number; connections: number; revoked: number }>;
// Por conexión 'active' (withService): access token => (a) borrar eventos de citas 'cancelled' con google_event_id; (b) crear evento para citas 'confirmed' futuras sin google_event_id
// (summary "Cita: <paciente> — <motivo|Consulta>", sin datos clínicos) y guardar google_event_id; (c) queryBusy(now, now + 30 días) y reemplazar external_busy del dentista (DELETE + INSERT en una transacción; es una caché).
// GoogleAuthError invalid_grant => status 'revoked', last_error; seguir con las demás.
```
**Rutas** (`src/app/api/google/`): `oauth/start/route.ts` (`GET`, requiere sesión; `redirect(buildAuthUrl(signState(ctx.membershipId)))`) y `oauth/callback/route.ts` (`GET`, pública para el proxy pero valida `state` con `verifyState`, llama `connectGoogle` y redirige a `/configuracion/horarios?google=ok`; error ⇒ `?google=error`). Y `cron/route.ts` (`POST`/`GET`; `assertCron` de `@/app/api/cron/auth`; ruta pública para el proxy: `/api/google/cron`) que ejecuta `runGoogleSync()` y responde `{ google: <resumen> }`.

**Tests** (`tests/db/google.test.ts`, escrito por el builder): los 6 criterios con un `fetch` falso que registra las llamadas y responde según la URL; el criterio 5 también llama `loadSlots` (paso 8).

**Interfaz** (`src/app/(app)/configuracion/google/page.tsx`): estado de la conexión de Google Calendar del dentista que inicia sesión (conectado como <correo> / desconectado / revocado) y botón "Conectar Google Calendar" (enlace a `/api/google/oauth/start`); los administradores ven el estado de todos los dentistas.

**Acceptance**
- [ ] WHEN `encryptToken` encrypts the same plaintext twice THE SYSTEM SHALL produce two different `v1:` ciphertexts that both decrypt to the plaintext, and WHEN a ciphertext byte is altered THE SYSTEM SHALL throw on `decryptToken`, and WHEN the `authenticated` role selects `refresh_token_enc` from `google_connections` THE SYSTEM SHALL fail with `permission denied` while selecting `google_email` and `status` succeeds for the connection's owner.
- [ ] WHEN `verifyState` receives a state signed by `signState` within its lifetime THE SYSTEM SHALL return the membership id, and WHEN it is expired or tampered THE SYSTEM SHALL throw.
- [ ] WHEN `runGoogleSync` runs with a fake `fetch` and an active connection THE SYSTEM SHALL create one Calendar event per `confirmed` appointment that has no `google_event_id`, store the returned id, and WHEN it runs again THE SYSTEM SHALL create no new event.
- [ ] WHEN an appointment with a `google_event_id` is `cancelled` THE SYSTEM SHALL issue one DELETE for that event and clear `google_event_id`.
- [ ] WHEN the fake free/busy response lists busy blocks THE SYSTEM SHALL replace that dentist's `external_busy` rows with them, and `loadSlots` SHALL stop offering overlapping slots.
- [ ] WHEN Google answers `invalid_grant` while refreshing the token THE SYSTEM SHALL set the connection `revoked`, record `last_error`, and continue with the other connections without throwing.

**Verify**
```bash
pnpm db:up
pnpm test:db tests/db/google.test.ts
pnpm typecheck
pnpm lint
pnpm build
```

**Checkpoint**
```bash
git add -A && git commit -m "step 11: google-calendar"
git tag step-11-google-calendar
git rev-parse --verify step-11-google-calendar   # expect: a commit id, exit 0
```

---

## Aceptación de la épica
- [ ] `step-07-availability-engine` existe en git (`git rev-parse --verify step-07-availability-engine` sale 0).
- [ ] `step-08-appointments` existe en git (`git rev-parse --verify step-08-appointments` sale 0).
- [ ] `step-09-agenda-ui` existe en git (`git rev-parse --verify step-09-agenda-ui` sale 0).
- [ ] `step-10-reminders` existe en git (`git rev-parse --verify step-10-reminders` sale 0).
- [ ] `step-11-google-calendar` existe en git (`git rev-parse --verify step-11-google-calendar` sale 0).
- [ ] `pnpm typecheck && pnpm lint && pnpm test` salen 0 sobre el árbol resultante.
