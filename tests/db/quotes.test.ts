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
