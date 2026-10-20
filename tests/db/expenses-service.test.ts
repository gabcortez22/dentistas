import { afterAll, describe, expect, it } from "vitest";
import { closePool as closeAppPool } from "@/lib/db";
import { listExpenses, monthlySummary, recordExpense, voidExpense } from "@/server/expenses";
import { ForbiddenError, type UserActor } from "@/server/session";
import { closePool, createPatientRow, pool, seedClinic } from "./helpers";

afterAll(async () => {
  await closePool();
  await closeAppPool();
});

async function setup() {
  const a = await seedClinic();
  const of = (m: { userId: string; membershipId: string }): UserActor => ({
    kind: "user",
    userId: m.userId,
    clinicId: a.clinicId,
    membershipId: m.membershipId,
  });
  return { a, admin: of(a.admin), dentist: of(a.dentist), assistant: of(a.assistant) };
}
const gloves = {
  category: "insumos" as const,
  description: "Guantes",
  amountCents: 2000,
  method: "cash" as const,
  incurredOn: "2027-03-10",
};

describe("expenses service", () => {
  it("an admin records an expense and lists it", async () => {
    const { admin } = await setup();
    const { id } = await recordExpense(admin, gloves);
    const list = await listExpenses(admin, { month: "2027-03" });
    expect(list.map((e) => e.id)).toEqual([id]);
    expect(list[0]).toMatchObject({ amountCents: 2000, category: "insumos", voided: false });
  });

  it("dentists and assistants are forbidden from every finance function", async () => {
    const { admin, dentist, assistant } = await setup();
    const { id } = await recordExpense(admin, gloves);
    for (const actor of [dentist, assistant]) {
      await expect(recordExpense(actor, gloves)).rejects.toBeInstanceOf(ForbiddenError);
      await expect(voidExpense(actor, id, "x")).rejects.toBeInstanceOf(ForbiddenError);
      await expect(listExpenses(actor)).rejects.toBeInstanceOf(ForbiddenError);
      await expect(monthlySummary(actor)).rejects.toBeInstanceOf(ForbiddenError);
    }
  });

  it("voiding removes the expense from the totals and keeps the row", async () => {
    const { admin } = await setup();
    await recordExpense(admin, gloves);
    const { id } = await recordExpense(admin, { ...gloves, amountCents: 500 });
    expect((await monthlySummary(admin))[0]?.expenseCents).toBe(2500);
    await voidExpense(admin, id, "duplicado");
    expect((await monthlySummary(admin))[0]?.expenseCents).toBe(2000);
    expect(
      (await pool.query("select count(*)::int as n from expenses where id = $1", [id])).rows[0].n,
    ).toBe(1);
    expect((await listExpenses(admin)).find((e) => e.id === id)?.voided).toBe(true);
  });

  it("monthlySummary returns income, expense and net for the month", async () => {
    const { a, admin } = await setup();
    const patientId = await createPatientRow(a.clinicId);
    await recordExpense(admin, gloves);
    await pool.query(
      "insert into charges (clinic_id, patient_id, amount_cents, method, concept, paid_at, created_by) values ($1, $2, 10000, 'cash', 'consulta', '2027-03-15T15:00:00Z', $3)",
      [a.clinicId, patientId, a.admin.membershipId],
    );
    expect(await monthlySummary(admin)).toEqual([
      { month: "2027-03", incomeCents: 10000, expenseCents: 2000, netCents: 8000 },
    ]);
  });
});
