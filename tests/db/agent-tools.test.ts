import { afterAll, describe, expect, it } from "vitest";
import { closePool as closeAppPool } from "@/lib/db";
import { executeTool, TOOL_NAMES } from "@/server/agent-tools";
import { createPatient } from "@/server/patients";
import { closePool, pool, seedClinic } from "./helpers";

afterAll(async () => {
  await closePool();
  await closeAppPool();
});

// Sunday 2027-02-28 07:00 in Lima; Monday 2027-03-01 09:00-12:00 Lima = 14:00Z-17:00Z.
const NOW = new Date("2027-02-28T12:00:00Z");
const SLOT = "2027-03-01T14:00:00.000Z";
const PHONE = "+51987654321";

async function setup(opts: { identified?: boolean } = {}) {
  const a = await seedClinic();
  await pool.query(
    "insert into availability_rules (clinic_id, membership_id, weekday, start_time, end_time) values ($1, $2, 1, '09:00', '12:00')",
    [a.clinicId, a.dentist.membershipId],
  );
  const patient = await createPatient(
    { kind: "service", clinicId: a.clinicId },
    {
      docNumber: String(Math.random()).slice(2, 10),
      lastName: "Mora",
      firstName: "Eli",
      phone: PHONE,
    },
  );
  const convo = await pool.query<{ id: string }>(
    "insert into agent_conversations (clinic_id, phone_e164, patient_id) values ($1, $2, $3) returning id",
    [a.clinicId, PHONE, opts.identified === false ? null : patient.id],
  );
  const ctx = { conversationId: convo.rows[0]?.id as string, now: () => NOW };
  const userTurn = () =>
    pool.query("insert into agent_turns (conversation_id, role, content) values ($1, 'user', $2)", [
      ctx.conversationId,
      JSON.stringify([{ type: "text", text: "sí, confirmo" }]),
    ]);
  const parse = (r: { content: string }) =>
    JSON.parse(r.content) as {
      proposalId: string;
      found?: boolean;
      firstName?: string;
      slots: Array<{ startsAt: string }>;
    };
  return { a, patient, ctx, userTurn, parse };
}
const propose = (ctx: { conversationId: string; now: () => Date }, dentistId: string) =>
  executeTool(ctx, "propose_appointment", {
    dentistId,
    startsAt: SLOT,
    minutes: 30,
    reason: "Limpieza",
  });
const count = async (clinicId: string) =>
  (await pool.query("select count(*)::int as n from appointments where clinic_id = $1", [clinicId]))
    .rows[0].n as number;

describe("agent tools", () => {
  it("book_appointment without a proposal made in an earlier turn creates nothing", async () => {
    const { a, ctx } = await setup();
    const none = await executeTool(ctx, "book_appointment", { proposalId: crypto.randomUUID() });
    expect(none.isError).toBe(true);
    const proposed = JSON.parse((await propose(ctx, a.dentist.membershipId)).content);
    const early = await executeTool(ctx, "book_appointment", { proposalId: proposed.proposalId });
    expect(early.isError).toBe(true);
    expect(await count(a.clinicId)).toBe(0);
  });

  it("propose, a later patient turn, then book: one confirmed whatsapp appointment; a second book fails", async () => {
    const { a, ctx, userTurn, parse } = await setup();
    const proposed = parse(await propose(ctx, a.dentist.membershipId));
    await userTurn();
    const booked = await executeTool(ctx, "book_appointment", { proposalId: proposed.proposalId });
    expect(booked.isError).toBe(false);
    const row = await pool.query("select status, source from appointments where clinic_id = $1", [
      a.clinicId,
    ]);
    expect(row.rows).toEqual([{ status: "confirmed", source: "whatsapp" }]);
    const again = await executeTool(ctx, "book_appointment", { proposalId: proposed.proposalId });
    expect(again.isError).toBe(true);
    expect(await count(a.clinicId)).toBe(1);
  });

  it("an expired proposal cannot be booked", async () => {
    const { a, ctx, userTurn, parse } = await setup();
    const proposed = parse(await propose(ctx, a.dentist.membershipId));
    await userTurn();
    const late = await executeTool(
      { ...ctx, now: () => new Date(NOW.getTime() + 11 * 60_000) },
      "book_appointment",
      { proposalId: proposed.proposalId },
    );
    expect(late.isError).toBe(true);
    expect(await count(a.clinicId)).toBe(0);
  });

  it("an unknown tool or invalid arguments return an error result and never throw", async () => {
    const { ctx } = await setup();
    expect((await executeTool(ctx, "read_clinical_history", {})).isError).toBe(true);
    expect(
      (await executeTool(ctx, "list_open_slots", { fromDate: "mañana", toDate: "x", minutes: 1 }))
        .isError,
    ).toBe(true);
  });

  it("get_balance and cancel_appointment need an identified patient; the allow-list is exactly the 9 tools", async () => {
    const { ctx } = await setup({ identified: false });
    expect((await executeTool(ctx, "get_balance", {})).isError).toBe(true);
    expect(
      (await executeTool(ctx, "cancel_appointment", { appointmentId: crypto.randomUUID() }))
        .isError,
    ).toBe(true);
    expect([...TOOL_NAMES]).toEqual([
      "identify_patient",
      "register_patient",
      "list_open_slots",
      "propose_appointment",
      "book_appointment",
      "cancel_appointment",
      "get_balance",
      "capture_prospect",
      "handoff_to_human",
    ]);
    expect(TOOL_NAMES.some((n) => /clinical|history|historia/.test(n))).toBe(false);
  });

  it("identify_patient links the chat phone to the registered patient and list_open_slots offers slots", async () => {
    const { ctx, parse } = await setup({ identified: false });
    expect(parse(await executeTool(ctx, "identify_patient", {}))).toEqual({
      found: true,
      firstName: "Eli",
    });
    const slots = parse(
      await executeTool(ctx, "list_open_slots", {
        fromDate: "2027-03-01",
        toDate: "2027-03-01",
        minutes: 30,
      }),
    );
    expect(slots.slots).toHaveLength(6);
    expect(slots.slots[0]?.startsAt).toBe(SLOT);
  });
});
