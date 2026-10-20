import { afterAll, describe, expect, it } from "vitest";
import type { LlmBlock, LlmClient, LlmMessage, LlmResponse } from "@/lib/agent/llm";
import { FALLBACK_TEXT, runAgent } from "@/lib/agent/loop";
import { closePool as closeAppPool } from "@/lib/db";
import { createPatient } from "@/server/patients";
import { closePool, pool, seedClinic } from "./helpers";

afterAll(async () => {
  await closePool();
  await closeAppPool();
});

const NOW = new Date("2027-02-28T12:00:00Z");
const SLOT = "2027-03-01T14:00:00.000Z";

const text = (t: string): LlmResponse => ({
  blocks: [{ type: "text", text: t }],
  stopReason: "end_turn",
  inputTokens: 10,
  outputTokens: 5,
});
const use = (id: string, name: string, input: unknown): LlmResponse => ({
  blocks: [{ type: "tool_use", id, name, input }],
  stopReason: "tool_use",
  inputTokens: 10,
  outputTokens: 5,
});

function scripted(steps: Array<LlmResponse | ((messages: LlmMessage[]) => LlmResponse)>) {
  let i = 0;
  const calls: LlmMessage[][] = [];
  const llm: LlmClient = {
    async complete({ messages }) {
      calls.push(structuredClone(messages));
      const step = steps[Math.min(i++, steps.length - 1)];
      return typeof step === "function" ? step(messages) : (step as LlmResponse);
    },
  };
  return { llm, calls: () => calls.length };
}

async function setup() {
  const a = await seedClinic();
  await pool.query(
    "insert into availability_rules (clinic_id, membership_id, weekday, start_time, end_time) values ($1, $2, 1, '09:00', '12:00')",
    [a.clinicId, a.dentist.membershipId],
  );
  const phone = `+519${String(Math.random()).slice(2, 10)}`;
  const patient = await createPatient(
    { kind: "service", clinicId: a.clinicId },
    { docNumber: String(Math.random()).slice(2, 10), lastName: "Paz", firstName: "Gil", phone },
  );
  const convo = await pool.query<{ id: string }>(
    "insert into agent_conversations (clinic_id, phone_e164, patient_id) values ($1, $2, $3) returning id",
    [a.clinicId, phone, patient.id],
  );
  return {
    a,
    id: convo.rows[0]?.id as string,
    deps: (llm: LlmClient) => ({ llm, now: () => NOW }),
  };
}
const status = async (id: string) =>
  (await pool.query("select status from agent_conversations where id = $1", [id])).rows[0]
    .status as string;

describe("runAgent", () => {
  it("answers with the model text and stores both turns", async () => {
    const { id, deps } = await setup();
    const { llm } = scripted([text("Hola, ¿en qué puedo ayudarle?")]);
    expect(await runAgent(deps(llm), id, "Hola")).toBe("Hola, ¿en qué puedo ayudarle?");
    const turns = await pool.query(
      "select role from agent_turns where conversation_id = $1 order by id",
      [id],
    );
    expect(turns.rows.map((t) => t.role)).toEqual(["user", "assistant"]);
  });

  it("a full booking flow: propose, the patient confirms in a later message, then book", async () => {
    const { a, id, deps } = await setup();
    const first = scripted([
      use("t1", "propose_appointment", {
        dentistId: a.dentist.membershipId,
        startsAt: SLOT,
        minutes: 30,
        reason: "Limpieza",
      }),
      text("¿Confirma la cita el lunes a las 09:00?"),
    ]);
    expect(await runAgent(deps(first.llm), id, "Quiero una cita el lunes")).toContain("Confirma");
    const proposalId = (
      await pool.query("select id from appointment_proposals where conversation_id = $1", [id])
    ).rows[0].id as string;
    const second = scripted([
      use("t2", "book_appointment", { proposalId }),
      text("Listo, su cita quedó agendada."),
    ]);
    expect(await runAgent(deps(second.llm), id, "Sí, confirmo")).toContain("agendada");
    expect(
      (
        await pool.query("select source, status from appointments where clinic_id = $1", [
          a.clinicId,
        ])
      ).rows,
    ).toEqual([{ source: "whatsapp", status: "confirmed" }]);
  });

  it("booking in the same turn as the proposal is refused", async () => {
    const { a, id, deps } = await setup();
    let proposalId = "";
    const sc = scripted([
      use("t1", "propose_appointment", {
        dentistId: a.dentist.membershipId,
        startsAt: SLOT,
        minutes: 30,
      }),
      (messages) => {
        const last = messages.at(-1)?.content[0] as Extract<LlmBlock, { type: "tool_result" }>;
        proposalId = JSON.parse(last.content).proposalId;
        return use("t2", "book_appointment", { proposalId });
      },
      text("No pude agendar todavía."),
    ]);
    await runAgent(deps(sc.llm), id, "Quiero una cita");
    expect(
      (
        await pool.query("select count(*)::int as n from appointments where clinic_id = $1", [
          a.clinicId,
        ])
      ).rows[0].n,
    ).toBe(0);
    expect(proposalId).not.toBe("");
  });

  it("stops after 8 model calls with the fixed text and hands the conversation to a person", async () => {
    const { id, deps } = await setup();
    const sc = scripted([use("loop", "identify_patient", {})]);
    expect(await runAgent(deps(sc.llm), id, "Hola")).toBe(FALLBACK_TEXT);
    expect(sc.calls()).toBe(8);
    expect(await status(id)).toBe("handoff");
  });

  it("handoff_to_human stops the agent: later messages return null without calling the model", async () => {
    const { id, deps } = await setup();
    const sc = scripted([
      use("h", "handoff_to_human", { reason: "quiere hablar con alguien" }),
      text("Alguien del equipo le responderá."),
    ]);
    expect(await runAgent(deps(sc.llm), id, "Quiero hablar con una persona")).toContain("equipo");
    expect(await status(id)).toBe("handoff");
    const calls = sc.calls();
    expect(await runAgent(deps(sc.llm), id, "¿Hola?")).toBeNull();
    expect(sc.calls()).toBe(calls);
  });

  it("a model error hands the conversation to a person instead of throwing", async () => {
    const { id, deps } = await setup();
    const llm: LlmClient = {
      complete: async () => {
        throw new Error("model down");
      },
    };
    expect(await runAgent(deps(llm), id, "Hola")).toBe(FALLBACK_TEXT);
    expect(await status(id)).toBe("handoff");
  });
});
