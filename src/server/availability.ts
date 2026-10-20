import { DateTime } from "luxon";
import { generateSlots, type Rule, type Span } from "@/lib/availability/generate-slots";
import { type Actor, runAs } from "@/lib/db";

export type SlotQuery = {
  membershipId: string;
  from: Date;
  to: Date;
  durationMinutes: number;
};
export type SlotOffer = { startsAt: Date; endsAt: Date };

export const SLOT_DEFAULTS = {
  slotIntervalMinutes: 30,
  minNoticeMinutes: 60,
  maxAdvanceDays: 60,
} as const;

const dateOnly = (value: Date | string): string =>
  typeof value === "string"
    ? value.slice(0, 10)
    : (DateTime.fromJSDate(value, { zone: "utc" }).toISODate() ?? "");

export async function loadSlots(
  actor: Actor,
  q: SlotQuery,
  opts: { now?: Date; ignoreBookings?: boolean } = {},
): Promise<SlotOffer[]> {
  return runAs(actor, async (client) => {
    const clinic = await client.query<{ timezone: string }>(
      "select timezone from clinics where id = $1",
      [actor.clinicId],
    );
    const zone = clinic.rows[0]?.timezone ?? "America/Lima";
    const rules = await client.query(
      `select weekday, start_time::text, end_time::text, valid_from::text, valid_until::text
         from availability_rules where membership_id = $1 and clinic_id = $2`,
      [q.membershipId, actor.clinicId],
    );
    const exceptions = await client.query(
      `select starts_at, ends_at, type from availability_exceptions
        where membership_id = $1 and clinic_id = $2 and ends_at > $3 and starts_at < $4`,
      [q.membershipId, actor.clinicId, q.from, q.to],
    );
    // The booking write is authoritative (exclusion constraint); a write-time check ignores bookings
    // so a conflict is always reported as SlotTakenError, never as "outside availability".
    const booked = opts.ignoreBookings
      ? { rows: [] as Array<{ starts_at: Date; ends_at: Date }> }
      : await client.query(
          `select starts_at, ends_at from appointments
            where membership_id = $1 and clinic_id = $2 and status in ('held', 'confirmed')
              and ends_at > $3 and starts_at < $4`,
          [q.membershipId, actor.clinicId, q.from, q.to],
        );
    const busy = await client.query(
      `select starts_at, ends_at from external_busy
        where membership_id = $1 and clinic_id = $2 and ends_at > $3 and starts_at < $4`,
      [q.membershipId, actor.clinicId, q.from, q.to],
    );
    const span = (r: { starts_at: Date; ends_at: Date }): Span => ({
      startsAt: r.starts_at,
      endsAt: r.ends_at,
    });
    const mappedRules: Rule[] = rules.rows.map((r) => ({
      weekday: r.weekday,
      startTime: r.start_time,
      endTime: r.end_time,
      validFrom: dateOnly(r.valid_from),
      validUntil: r.valid_until ? dateOnly(r.valid_until) : null,
    }));
    return generateSlots({
      zone,
      rules: mappedRules,
      exceptions: exceptions.rows.map((r) => ({ ...span(r), type: r.type })),
      booked: booked.rows.map(span),
      externalBusy: busy.rows.map(span),
      now: opts.now ?? new Date(),
      from: q.from,
      to: q.to,
      durationMinutes: q.durationMinutes,
      ...SLOT_DEFAULTS,
    });
  });
}
