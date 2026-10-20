export class InvalidDiscountError extends Error {
  constructor() {
    super("the discount cannot exceed the subtotal");
    this.name = "InvalidDiscountError";
  }
}

export function quoteTotals(
  items: Array<{ quantity: number; unitPriceCents: number }>,
  discountCents: number,
): { subtotalCents: number; discountCents: number; totalCents: number } {
  const subtotalCents = items.reduce((sum, i) => sum + i.quantity * i.unitPriceCents, 0);
  if (discountCents > subtotalCents) throw new InvalidDiscountError();
  return { subtotalCents, discountCents, totalCents: subtotalCents - discountCents };
}

/** Integer céntimos of PEN to "S/ 1,200.50". */
export function formatPEN(cents: number): string {
  const sign = cents < 0 ? "-" : "";
  const abs = Math.abs(cents);
  const soles = Math.floor(abs / 100).toLocaleString("en-US");
  return `${sign}S/ ${soles}.${String(abs % 100).padStart(2, "0")}`;
}

/** "120.5", "S/ 1,200.50" to céntimos; negative or non-numeric input gives null. */
export function parsePEN(input: string): number | null {
  const cleaned = input.replace(/S\/\.?/gi, "").replace(/[\s,]/g, "");
  if (!/^\d+(\.\d{1,2})?$/.test(cleaned)) return null;
  return Math.round(Number.parseFloat(cleaned) * 100);
}
