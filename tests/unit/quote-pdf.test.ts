import { describe, expect, it } from "vitest";
import { type QuotePdfData, renderQuotePdf } from "@/lib/pdf/quote-document";

const base: QuotePdfData = {
  clinicName: "Clínica Sonrisa",
  patientName: "Vega, Rosa",
  patientDocument: "DNI 12345678",
  number: 7,
  createdAt: new Date("2027-03-01T15:00:00Z"),
  validUntil: "2027-03-31",
  items: [
    { description: "Limpieza", quantity: 2, unitPriceCents: 5000 },
    { description: "Resina", toothFdi: 26, quantity: 1, unitPriceCents: 3000 },
    { description: "Control", quantity: 1, unitPriceCents: 0 },
  ],
  discountCents: 1000,
};

describe("renderQuotePdf", () => {
  it("renders a valid PDF for a quote with 3 items", async () => {
    const pdf = await renderQuotePdf(base);
    expect(pdf.subarray(0, 5).toString("latin1")).toBe("%PDF-");
    expect(pdf.length).toBeGreaterThan(1000);
  });

  it("still renders a valid PDF with no items", async () => {
    const pdf = await renderQuotePdf({ ...base, items: [], discountCents: 0 });
    expect(pdf.subarray(0, 5).toString("latin1")).toBe("%PDF-");
  });
});
