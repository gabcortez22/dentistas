import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";
import { type Actor, closePool as closeAppPool } from "@/lib/db";
import { createPatient } from "@/server/patients";
import { createQuote } from "@/server/quotes";
import type { SessionCtx, UserActor } from "@/server/session";
import { closePool, seedClinic } from "./helpers";

const session = vi.hoisted(() => ({ current: null as unknown }));
vi.mock("@/server/session", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/server/session")>()),
  getSession: async () => session.current,
}));

afterAll(async () => {
  await closePool();
  await closeAppPool();
});
beforeEach(() => {
  session.current = null;
});

const ctxOf = (
  clinicId: string,
  role: SessionCtx["role"],
  m: { userId: string; membershipId: string },
): SessionCtx => ({
  userId: m.userId,
  clinicId,
  membershipId: m.membershipId,
  role,
  displayName: "x",
});

async function setup() {
  const a = await seedClinic();
  const dentist: UserActor = {
    kind: "user",
    userId: a.dentist.userId,
    clinicId: a.clinicId,
    membershipId: a.dentist.membershipId,
  };
  const patient = await createPatient(dentist as Actor, {
    docNumber: String(Math.random()).slice(2, 10),
    lastName: "Vega",
    firstName: "Rosa",
  });
  const quote = await createQuote(dentist, {
    patientId: patient.id,
    items: [{ description: "Limpieza", quantity: 1, unitPriceCents: 8000 }],
  });
  return { a, quote };
}
const call = async (id: string) => {
  const { GET } = await import("@/app/api/quotes/[id]/pdf/route");
  return GET(new Request(`http://x/api/quotes/${id}/pdf`), { params: Promise.resolve({ id }) });
};

describe("GET /api/quotes/[id]/pdf", () => {
  it("answers 401 without a session", async () => {
    const { quote } = await setup();
    expect((await call(quote.id)).status).toBe(401);
  });

  it("answers 403 to an assistant and 404 for a quote of another clinic", async () => {
    const { a, quote } = await setup();
    session.current = ctxOf(a.clinicId, "assistant", a.assistant);
    const forbidden = await call(quote.id);
    expect(forbidden.status).toBe(403);
    expect(forbidden.headers.get("content-type")).not.toContain("pdf");
    const other = await seedClinic();
    session.current = ctxOf(other.clinicId, "dentist", other.dentist);
    expect((await call(quote.id)).status).toBe(404);
  });

  it("answers 200 with a PDF to a dentist of the clinic", async () => {
    const { a, quote } = await setup();
    session.current = ctxOf(a.clinicId, "dentist", a.dentist);
    const response = await call(quote.id);
    expect(response.status).toBe(200);
    expect(response.headers.get("content-type")).toBe("application/pdf");
    expect(response.headers.get("content-disposition")).toBe(
      `inline; filename="cotizacion-${quote.number}.pdf"`,
    );
    expect(
      Buffer.from(await response.arrayBuffer())
        .subarray(0, 5)
        .toString("latin1"),
    ).toBe("%PDF-");
  });
});
