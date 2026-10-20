import { afterAll, describe, expect, it } from "vitest";
import { closePool as closeAppPool } from "@/lib/db";
import {
  OverpaymentError,
  patientBalance,
  QuoteNotAcceptedError,
  recordCharge,
  voidCharge,
} from "@/server/charges";
import { createPatient } from "@/server/patients";
import { createQuote, setQuoteStatus } from "@/server/quotes";
import { ForbiddenError, type UserActor } from "@/server/session";
import { closePool, pool, seedClinic } from "./helpers";

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
  const dentist = of(a.dentist);
  const assistant = of(a.assistant);
  const admin = of(a.admin);
  const patient = await createPatient(assistant, {
    docNumber: String(Math.random()).slice(2, 10),
    lastName: "Soto",
    firstName: "Ana",
  });
  const quote = await createQuote(dentist, {
    patientId: patient.id,
    items: [{ description: "Limpieza", quantity: 2, unitPriceCents: 5000 }],
    discountCents: 1000,
  });
  const accept = async () => {
    await setQuoteStatus(dentist, quote.id, "sent");
    await setQuoteStatus(dentist, quote.id, "accepted");
  };
  return { a, dentist, assistant, admin, patient, quote, accept };
}
const charge = (
  actor: UserActor,
  patientId: string,
  quoteId: string | undefined,
  amountCents: number,
) => recordCharge(actor, { patientId, quoteId, amountCents, method: "yape", concept: "abono" });

describe("charges service", () => {
  it("records a partial payment as an assistant and reports the remaining balance", async () => {
    const { assistant, patient, quote, accept } = await setup();
    await accept();
    await charge(assistant, patient.id, quote.id, 3000);
    expect(await patientBalance(assistant, patient.id)).toEqual({
      totalCents: 9000,
      paidCents: 3000,
      balanceCents: 6000,
    });
  });

  it("refuses a quote that is not accepted and an amount above the balance", async () => {
    const { assistant, patient, quote, accept } = await setup();
    await expect(charge(assistant, patient.id, quote.id, 100)).rejects.toBeInstanceOf(
      QuoteNotAcceptedError,
    );
    await accept();
    await expect(charge(assistant, patient.id, quote.id, 9001)).rejects.toBeInstanceOf(
      OverpaymentError,
    );
    const { rows } = await pool.query(
      "select count(*)::int as n from charges where quote_id = $1",
      [quote.id],
    );
    expect(rows[0].n).toBe(0);
  });

  it("two concurrent charges of 6000 against a balance of 9000: exactly one succeeds", async () => {
    const { assistant, patient, quote, accept } = await setup();
    await accept();
    const results = await Promise.allSettled([
      charge(assistant, patient.id, quote.id, 6000),
      charge(assistant, patient.id, quote.id, 6000),
    ]);
    expect(results.filter((r) => r.status === "fulfilled")).toHaveLength(1);
    const failure = results.find((r): r is PromiseRejectedResult => r.status === "rejected");
    expect(failure?.reason).toBeInstanceOf(OverpaymentError);
  });

  it("an admin voids a charge: the balance grows back, the row stays; a non-admin cannot void", async () => {
    const { admin, assistant, patient, quote, accept } = await setup();
    await accept();
    const { id } = await charge(assistant, patient.id, quote.id, 3000);
    await expect(voidCharge(assistant, id, "error")).rejects.toBeInstanceOf(ForbiddenError);
    await voidCharge(admin, id, "monto mal digitado");
    expect((await patientBalance(admin, patient.id)).balanceCents).toBe(9000);
    expect(
      (await pool.query("select count(*)::int as n from charges where id = $1", [id])).rows[0].n,
    ).toBe(1);
    await expect(voidCharge(admin, id, "otra vez")).rejects.toThrow(/already voided/);
  });
});
