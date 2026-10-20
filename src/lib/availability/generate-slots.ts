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
