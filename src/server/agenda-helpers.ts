import { DateTime } from "luxon";

const ZONE = "America/Lima";

/** Monday 00:00 (Lima) of the week containing the given YYYY-MM-DD (or today). */
export function weekStart(date?: string): DateTime {
  const base = date ? DateTime.fromISO(date, { zone: ZONE }) : DateTime.now().setZone(ZONE);
  const valid = base.isValid ? base : DateTime.now().setZone(ZONE);
  return valid.startOf("day").minus({ days: valid.weekday - 1 });
}

export function dayBounds(date: string): { from: Date; to: Date } | null {
  const d = DateTime.fromISO(date, { zone: ZONE });
  if (!d.isValid) return null;
  return { from: d.startOf("day").toJSDate(), to: d.startOf("day").plus({ days: 1 }).toJSDate() };
}
