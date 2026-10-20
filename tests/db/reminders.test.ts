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
