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
