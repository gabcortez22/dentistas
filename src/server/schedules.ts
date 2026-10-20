import { DateTime } from "luxon";
import { z } from "zod";
import { runAs, withTenant } from "@/lib/db";
import { ForbiddenError, type Role, type UserActor } from "@/server/session";

export type WeeklyRule = { weekday: number; startTime: string; endTime: string };

const time = z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/);
const rulesSchema = z
  .array(
    z
      .object({ weekday: z.number().int().min(1).max(7), startTime: time, endTime: time })
      .refine((r) => r.endTime > r.startTime, {
        message: "la hora de fin debe ser posterior",
        path: ["endTime"],
      }),
  )
  .max(28)
  .superRefine((rules, ctx) => {
    const sorted = [...rules].sort(
      (a, b) => a.weekday - b.weekday || a.startTime.localeCompare(b.startTime),
    );
    for (let i = 1; i < sorted.length; i++) {
      const prev = sorted[i - 1];
      const cur = sorted[i];
      if (prev && cur && prev.weekday === cur.weekday && cur.startTime < prev.endTime) {
        ctx.addIssue({
          code: "custom",
          message: "las franjas de un mismo día no pueden solaparse",
        });
      }
    }
  });

function assertCanEdit(actor: UserActor, role: Role, membershipId: string) {
  if (role === "admin") return;
  if (role === "dentist" && membershipId === actor.membershipId) return;
  throw new ForbiddenError();
}

async function clinicToday(client: import("pg").PoolClient, clinicId: string, now: Date) {
  const { rows } = await client.query<{ timezone: string }>(
    "select timezone from clinics where id = $1",
    [clinicId],
  );
  const zone = rows[0]?.timezone ?? "America/Lima";
  return DateTime.fromJSDate(now, { zone }).startOf("day");
}

export async function getWeeklyRules(
  actor: import("@/lib/db").Actor,
  membershipId: string,
  opts: { now?: Date } = {},
): Promise<WeeklyRule[]> {
  return runAs(actor, async (client) => {
    const today = (await clinicToday(client, actor.clinicId, opts.now ?? new Date())).toISODate();
    const { rows } = await client.query(
      `select weekday, to_char(start_time, 'HH24:MI') as start_time, to_char(end_time, 'HH24:MI') as end_time
         from availability_rules
        where membership_id = $1 and clinic_id = $2
          and valid_from <= $3::date and (valid_until is null or valid_until >= $3::date)
        order by weekday, start_time`,
      [membershipId, actor.clinicId, today],
    );
    return rows.map((r) => ({ weekday: r.weekday, startTime: r.start_time, endTime: r.end_time }));
  });
}

export async function setWeeklyRules(
  actor: UserActor,
  role: Role,
  membershipId: string,
  rules: WeeklyRule[],
  opts: { now?: Date } = {},
): Promise<void> {
  assertCanEdit(actor, role, membershipId);
  const parsed = rulesSchema.parse(rules);
  await withTenant(actor.userId, async (client) => {
    const today = await clinicToday(client, actor.clinicId, opts.now ?? new Date());
    const todayIso = today.toISODate();
    const own = await client.query("select 1 from memberships where id = $1 and clinic_id = $2", [
      membershipId,
      actor.clinicId,
    ]);
    if (!own.rowCount) throw new ForbiddenError();
    // Rules already in effect end yesterday; rules that start today or later become empty ranges.
    await client.query(
      `update availability_rules
          set valid_until = greatest($3::date - 1, valid_from - 1)
        where membership_id = $1 and clinic_id = $2 and (valid_until is null or valid_until >= $3::date)`,
      [membershipId, actor.clinicId, todayIso],
    );
    for (const r of parsed) {
      await client.query(
        `insert into availability_rules (clinic_id, membership_id, weekday, start_time, end_time, valid_from)
         values ($1, $2, $3, $4, $5, $6::date)`,
        [actor.clinicId, membershipId, r.weekday, r.startTime, r.endTime, todayIso],
      );
    }
  });
}

export async function addBlockException(
  actor: UserActor,
  role: Role,
  membershipId: string,
  input: { startsAt: Date; endsAt: Date; reason?: string },
): Promise<{ id: string }> {
  assertCanEdit(actor, role, membershipId);
  z.object({ startsAt: z.date(), endsAt: z.date() })
    .refine((v) => v.endsAt > v.startsAt)
    .parse(input);
  return withTenant(actor.userId, async (client) => {
    const { rows } = await client.query<{ id: string }>(
      `insert into availability_exceptions (clinic_id, membership_id, starts_at, ends_at, type, reason)
       select $1, $2, $3, $4, 'block', $5
        where exists (select 1 from memberships where id = $2 and clinic_id = $1)
       returning id`,
      [actor.clinicId, membershipId, input.startsAt, input.endsAt, input.reason ?? null],
    );
    if (!rows[0]) throw new ForbiddenError();
    return { id: rows[0].id };
  });
}
