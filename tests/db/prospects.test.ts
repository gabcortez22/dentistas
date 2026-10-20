import { afterAll, describe, expect, it } from "vitest";
import { asUser, closePool, createPatientRow, pool, seedClinic } from "./helpers";

afterAll(closePool);

async function prospect(clinicId: string, patientId: string | null = null, stage = "new") {
  const { rows } = await pool.query<{ id: string }>(
    "insert into prospects (clinic_id, name, patient_id, stage) values ($1, 'Lucía', $2, $3) returning id",
    [clinicId, patientId, stage],
  );
  return rows[0]?.id as string;
}
const stage = async (id: string) =>
  (await pool.query("select stage from prospects where id = $1", [id])).rows[0].stage as string;
const autoEvents = async (id: string) =>
  (
    await pool.query(
      "select body from prospect_events where prospect_id = $1 and kind = 'auto' order by created_at, id",
      [id],
    )
  ).rows.map((r) => r.body.to as string);

describe("prospects at the database level", () => {
  it("another clinic sees no prospects, events or tasks; every role of the clinic does", async () => {
    const a = await seedClinic();
    const b = await seedClinic();
    const id = await prospect(a.clinicId);
    await pool.query(
      "insert into prospect_events (clinic_id, prospect_id, kind) values ($1, $2, 'note')",
      [a.clinicId, id],
    );
    await pool.query(
      "insert into followup_tasks (clinic_id, prospect_id, due_at) values ($1, $2, now())",
      [a.clinicId, id],
    );
    for (const table of ["prospects", "prospect_events", "followup_tasks"]) {
      expect(
        (await asUser(b.admin.userId, (c) => c.query(`select 1 from ${table}`))).rowCount,
      ).toBe(0);
      expect(
        (await asUser(a.assistant.userId, (c) => c.query(`select 1 from ${table}`))).rowCount,
      ).toBe(1);
    }
  });

  it("events are append-only and a prospect cannot be deleted by a user", async () => {
    const a = await seedClinic();
    const id = await prospect(a.clinicId);
    const { rows } = await pool.query(
      "insert into prospect_events (clinic_id, prospect_id, kind) values ($1, $2, 'note') returning id",
      [a.clinicId, id],
    );
    await expect(
      pool.query("update prospect_events set kind = 'created' where id = $1", [rows[0].id]),
    ).rejects.toThrow(/append-only/);
    await expect(
      pool.query("delete from prospect_events where id = $1", [rows[0].id]),
    ).rejects.toThrow(/append-only/);
    await expect(
      asUser(a.admin.userId, (c) => c.query("delete from prospects where id = $1", [id])),
    ).rejects.toThrow(/permission denied/);
  });

  it("only one open prospect per phone and clinic; a closed one frees the phone", async () => {
    const a = await seedClinic();
    const insert = () =>
      pool.query(
        "insert into prospects (clinic_id, name, phone_e164) values ($1, 'X', '+51987654321')",
        [a.clinicId],
      );
    await insert();
    await expect(insert()).rejects.toThrow(/duplicate key/);
    await pool.query(
      "update prospects set stage = 'lost', lost_reason = 'no responde' where clinic_id = $1",
      [a.clinicId],
    );
    await insert();
  });

  it("a lost prospect needs a reason", async () => {
    const a = await seedClinic();
    const id = await prospect(a.clinicId);
    await expect(
      pool.query("update prospects set stage = 'lost' where id = $1", [id]),
    ).rejects.toThrow(/check constraint/);
  });

  it("booking, quoting and accepting advance the linked prospect and record why", async () => {
    const a = await seedClinic();
    const patientId = await createPatientRow(a.clinicId);
    const id = await prospect(a.clinicId, patientId, "contacted");
    await pool.query(
      "insert into appointments (clinic_id, patient_id, membership_id, starts_at, ends_at) values ($1, $2, $3, now() + interval '3 days', now() + interval '3 days 30 minutes')",
      [a.clinicId, patientId, a.dentist.membershipId],
    );
    expect(await stage(id)).toBe("appointment_booked");
    const quote = await pool.query<{ id: string }>(
      "insert into quotes (clinic_id, patient_id, number, valid_until, created_by) values ($1, $2, 1, current_date + 30, $3) returning id",
      [a.clinicId, patientId, a.dentist.membershipId],
    );
    expect(await stage(id)).toBe("quoted");
    await pool.query("update quotes set status = 'sent' where id = $1", [quote.rows[0]?.id]);
    expect(await stage(id)).toBe("quoted");
    await pool.query("update quotes set status = 'accepted' where id = $1", [quote.rows[0]?.id]);
    expect(await stage(id)).toBe("won");
    expect(await autoEvents(id)).toEqual(["appointment_booked", "quoted", "won"]);
  });

  it("a prospect that is already lost is not reopened by a booking", async () => {
    const a = await seedClinic();
    const patientId = await createPatientRow(a.clinicId);
    const id = await prospect(a.clinicId, patientId, "new");
    await pool.query("update prospects set stage = 'lost', lost_reason = 'precio' where id = $1", [
      id,
    ]);
    await pool.query(
      "insert into appointments (clinic_id, patient_id, membership_id, starts_at, ends_at) values ($1, $2, $3, now() + interval '4 days', now() + interval '4 days 30 minutes')",
      [a.clinicId, patientId, a.dentist.membershipId],
    );
    expect(await stage(id)).toBe("lost");
  });
});
