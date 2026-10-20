import { afterAll, describe, expect, it } from "vitest";
import { asUser, closePool, createPatientRow, pool, seedClinic } from "./helpers";

afterAll(closePool);

async function acceptedQuote(a: Awaited<ReturnType<typeof seedClinic>>) {
  const patientId = await createPatientRow(a.clinicId);
  const { rows } = await pool.query<{ id: string }>(
    "insert into quotes (clinic_id, patient_id, number, valid_until, discount_cents, created_by) values ($1, $2, 1, current_date + 30, 1000, $3) returning id",
    [a.clinicId, patientId, a.dentist.membershipId],
  );
  const quoteId = rows[0]?.id as string;
  await pool.query(
    "insert into quote_items (clinic_id, quote_id, description, quantity, unit_price_cents) values ($1, $2, 'Limpieza', 2, 5000)",
    [a.clinicId, quoteId],
  );
  await pool.query("update quotes set status = 'sent' where id = $1", [quoteId]);
  await pool.query("update quotes set status = 'accepted' where id = $1", [quoteId]);
  return { patientId, quoteId };
}

const charge = (
  a: Awaited<ReturnType<typeof seedClinic>>,
  patientId: string,
  quoteId: string,
  cents: number,
) =>
  pool.query<{ id: string }>(
    "insert into charges (clinic_id, patient_id, quote_id, amount_cents, method, concept, created_by) values ($1, $2, $3, $4, 'yape', 'abono', $5) returning id",
    [a.clinicId, patientId, quoteId, cents, a.admin.membershipId],
  );
const balance = async (quoteId: string) =>
  (
    await pool.query(
      "select total_cents, paid_cents, balance_cents from quote_balances where quote_id = $1",
      [quoteId],
    )
  ).rows[0];

describe("charges", () => {
  it("balance = items - discount - non-voided charges", async () => {
    const a = await seedClinic();
    const { patientId, quoteId } = await acceptedQuote(a);
    expect(await balance(quoteId)).toEqual({
      total_cents: "9000",
      paid_cents: "0",
      balance_cents: "9000",
    });
    await charge(a, patientId, quoteId, 3000);
    expect(await balance(quoteId)).toEqual({
      total_cents: "9000",
      paid_cents: "3000",
      balance_cents: "6000",
    });
  });

  it("voiding a charge returns its amount to the balance and the charge row stays", async () => {
    const a = await seedClinic();
    const { patientId, quoteId } = await acceptedQuote(a);
    const { rows } = await charge(a, patientId, quoteId, 3000);
    await pool.query(
      "insert into charge_voids (charge_id, clinic_id, reason, voided_by) values ($1, $2, 'monto mal digitado', $3)",
      [rows[0]?.id, a.clinicId, a.admin.membershipId],
    );
    expect((await balance(quoteId)).paid_cents).toBe("0");
    expect(
      (await pool.query("select count(*)::int as n from charges where id = $1", [rows[0]?.id]))
        .rows[0].n,
    ).toBe(1);
  });

  it("charges are immutable and a non-positive amount is rejected", async () => {
    const a = await seedClinic();
    const { patientId, quoteId } = await acceptedQuote(a);
    const { rows } = await charge(a, patientId, quoteId, 1000);
    await expect(
      pool.query("update charges set amount_cents = 1 where id = $1", [rows[0]?.id]),
    ).rejects.toThrow(/append-only/);
    await expect(pool.query("delete from charges where id = $1", [rows[0]?.id])).rejects.toThrow(
      /append-only/,
    );
    await expect(charge(a, patientId, quoteId, 0)).rejects.toThrow(/check constraint/);
  });

  it("only admins void; assistants may record charges; other clinics see nothing", async () => {
    const a = await seedClinic();
    const b = await seedClinic();
    const { patientId, quoteId } = await acceptedQuote(a);
    const { rows } = await charge(a, patientId, quoteId, 1000);
    const voidAs = (userId: string, membershipId: string) =>
      asUser(userId, (c) =>
        c.query(
          "insert into charge_voids (charge_id, clinic_id, reason, voided_by) values ($1, $2, 'x', $3)",
          [rows[0]?.id, a.clinicId, membershipId],
        ),
      );
    await expect(voidAs(a.assistant.userId, a.assistant.membershipId)).rejects.toThrow(
      /row-level security/,
    );
    await voidAs(a.admin.userId, a.admin.membershipId);
    expect((await asUser(b.admin.userId, (c) => c.query("select id from charges"))).rowCount).toBe(
      0,
    );
    expect(
      (await asUser(a.assistant.userId, (c) => c.query("select id from charges"))).rowCount,
    ).toBe(1);
  });
});
