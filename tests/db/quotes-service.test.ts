import { afterAll, describe, expect, it } from "vitest";
import { closePool as closeAppPool } from "@/lib/db";
import { formatPEN, InvalidDiscountError, parsePEN, quoteTotals } from "@/lib/money";
import { createPatient } from "@/server/patients";
import {
  createQuote,
  expireOverdueQuotes,
  getQuote,
  listQuotes,
  QuoteLockedError,
  setQuoteStatus,
  updateDraftQuote,
} from "@/server/quotes";
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
  const patient = await createPatient(assistant, {
    docNumber: String(Math.random()).slice(2, 10),
    lastName: "Vega",
    firstName: "Rosa",
  });
  return { a, dentist, assistant, patient };
}
const items = [
  { description: "Limpieza", quantity: 2, unitPriceCents: 5000 },
  { description: "Resina", quantity: 1, unitPriceCents: 3000 },
];

describe("money", () => {
  it("computes totals and rejects a discount above the subtotal", () => {
    expect(quoteTotals(items, 1000)).toEqual({
      subtotalCents: 13000,
      discountCents: 1000,
      totalCents: 12000,
    });
    expect(() => quoteTotals(items, 13001)).toThrow(InvalidDiscountError);
  });
  it("formats and parses soles", () => {
    expect(formatPEN(120050)).toBe("S/ 1,200.50");
    expect(parsePEN("S/ 1,200.50")).toBe(120050);
    expect(parsePEN("120.5")).toBe(12050);
    expect(parsePEN("-3")).toBeNull();
    expect(parsePEN("abc")).toBeNull();
  });
});

describe("quotes service", () => {
  it("numbers quotes 1 and 2, starts as draft and valid 30 days ahead in Lima", async () => {
    const { dentist, patient } = await setup();
    const now = new Date("2027-03-01T15:00:00Z");
    const one = await createQuote(dentist, { patientId: patient.id, items }, { now });
    const two = await createQuote(dentist, { patientId: patient.id, items }, { now });
    expect([one.number, two.number]).toEqual([1, 2]);
    const got = await getQuote(dentist, one.id);
    expect(got?.quote.status).toBe("draft");
    expect(got?.quote.validUntil).toBe("2027-03-31");
    expect(got?.totals.totalCents).toBe(13000);
  });

  it("only draft quotes can be edited", async () => {
    const { dentist, patient } = await setup();
    const { id } = await createQuote(dentist, { patientId: patient.id, items });
    await updateDraftQuote(dentist, id, {
      items: [{ description: "Extracción", quantity: 1, unitPriceCents: 20000 }],
      discountCents: 500,
    });
    expect((await getQuote(dentist, id))?.totals).toEqual({
      subtotalCents: 20000,
      discountCents: 500,
      totalCents: 19500,
    });
    await setQuoteStatus(dentist, id, "sent");
    await expect(updateDraftQuote(dentist, id, { notes: "x" })).rejects.toBeInstanceOf(
      QuoteLockedError,
    );
    await expect(setQuoteStatus(dentist, id, "draft" as never)).rejects.toThrow(
      /invalid quote status change/,
    );
  });

  it("expireOverdueQuotes expires draft and sent quotes past their date and leaves the others", async () => {
    const { dentist, patient, a } = await setup();
    const past = "2027-01-01";
    const draft = await createQuote(dentist, { patientId: patient.id, items, validUntil: past });
    const sent = await createQuote(dentist, { patientId: patient.id, items, validUntil: past });
    const accepted = await createQuote(dentist, { patientId: patient.id, items, validUntil: past });
    await setQuoteStatus(dentist, sent.id, "sent");
    await setQuoteStatus(dentist, accepted.id, "sent");
    await setQuoteStatus(dentist, accepted.id, "accepted");
    const count = await expireOverdueQuotes({ now: new Date("2027-06-01T12:00:00Z") });
    expect(count).toBeGreaterThanOrEqual(2);
    const status = async (id: string) =>
      (await pool.query("select status from quotes where id = $1", [id])).rows[0].status;
    expect([await status(draft.id), await status(sent.id), await status(accepted.id)]).toEqual([
      "expired",
      "expired",
      "accepted",
    ]);
    expect(a.clinicId).toBeTruthy();
  });

  it("an assistant cannot create or list quotes", async () => {
    const { assistant, patient } = await setup();
    await expect(createQuote(assistant, { patientId: patient.id, items })).rejects.toBeInstanceOf(
      ForbiddenError,
    );
    await expect(listQuotes(assistant)).rejects.toBeInstanceOf(ForbiddenError);
  });
});
