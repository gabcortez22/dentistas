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
