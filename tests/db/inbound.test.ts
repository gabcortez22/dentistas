import { createHmac } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { LlmClient, LlmResponse } from "@/lib/agent/llm";
import { closePool as closeAppPool } from "@/lib/db";
import { SimulatorSender } from "@/lib/whatsapp/client";
import { ingestPayload, processInbound, receiveWebhook, sweepUnprocessed } from "@/server/inbound";
import { closePool, pool, seedClinic } from "./helpers";

beforeAll(() => {
  process.env.WHATSAPP_MODE = "cloud";
  process.env.WHATSAPP_ACCESS_TOKEN = "token";
  process.env.WHATSAPP_APP_SECRET = "app-secret";
  process.env.WHATSAPP_VERIFY_TOKEN = "verify-me";
  process.env.CRON_SECRET = "0123456789abcdef-secret";
});
afterAll(async () => {
  await closePool();
  await closeAppPool();
});

const reply = (text: string): LlmResponse => ({
  blocks: [{ type: "text", text }],
  stopReason: "end_turn",
  inputTokens: 1,
  outputTokens: 1,
});
function fakeLlm(text = "¡Hola! Soy el asistente.") {
  let calls = 0;
  const llm: LlmClient = {
    complete: async () => {
      calls++;
      return reply(text);
    },
  };
  return { llm, calls: () => calls };
}
async function clinicWithNumber() {
  const a = await seedClinic();
  const phoneNumberId = `pn-${crypto.randomUUID()}`;
  await pool.query("update clinics set whatsapp_phone_number_id = $2 where id = $1", [
    a.clinicId,
    phoneNumberId,
  ]);
  return { a, phoneNumberId };
}
const payload = (
  phoneNumberId: string,
  id = `wamid-${crypto.randomUUID()}`,
  from = "51987654321",
  body = "Hola",
) => ({
  entry: [
    {
      changes: [
        {
          value: {
            metadata: { phone_number_id: phoneNumberId },
            messages: [{ id, from, type: "text", text: { body } }],
          },
        },
      ],
    },
  ],
});
const sign = (raw: string, secret = "app-secret") =>
  `sha256=${createHmac("sha256", secret).update(raw).digest("hex")}`;
const count = async (clinicId: string) =>
  (
    await pool.query(
      "select count(*)::int as n from whatsapp_messages where clinic_id = $1 and direction = 'in'",
      [clinicId],
    )
  ).rows[0].n as number;

describe("GET /api/whatsapp/webhook", () => {
  it("echoes the challenge for the right token and refuses a wrong one", async () => {
    const { GET } = await import("@/app/api/whatsapp/webhook/route");
    const ok = await GET(
      new Request(
        "http://x/api/whatsapp/webhook?hub.mode=subscribe&hub.verify_token=verify-me&hub.challenge=abc",
      ),
    );
    expect([ok.status, await ok.text()]).toEqual([200, "abc"]);
    expect(
      (
        await GET(
          new Request(
            "http://x/api/whatsapp/webhook?hub.mode=subscribe&hub.verify_token=nope&hub.challenge=abc",
          ),
        )
      ).status,
    ).toBe(403);
  });
});

describe("receiveWebhook", () => {
  it("rejects an invalid signature and stores nothing; accepts a valid one", async () => {
    const { a, phoneNumberId } = await clinicWithNumber();
    const raw = JSON.stringify(payload(phoneNumberId));
    const jobs: Array<() => Promise<void>> = [];
    const deps = () => ({ llm: fakeLlm().llm, sender: new SimulatorSender() });
    const bad = await receiveWebhook(raw, sign(raw, "wrong"), (j) => jobs.push(j), deps);
    expect(bad.status).toBe(401);
    expect(await count(a.clinicId)).toBe(0);
    const good = await receiveWebhook(raw, sign(raw), (j) => jobs.push(j), deps);
    expect(good.status).toBe(200);
    expect(await count(a.clinicId)).toBe(1);
  });

  it("a message delivered twice is stored once and the agent runs once", async () => {
    const { a, phoneNumberId } = await clinicWithNumber();
    const raw = JSON.stringify(payload(phoneNumberId, "wamid-dup"));
    const model = fakeLlm();
    const jobs: Array<() => Promise<void>> = [];
    const deps = () => ({ llm: model.llm, sender: new SimulatorSender() });
    await receiveWebhook(raw, sign(raw), (j) => jobs.push(j), deps);
    await receiveWebhook(raw, sign(raw), (j) => jobs.push(j), deps);
    for (const job of jobs) await job();
    expect(await count(a.clinicId)).toBe(1);
    expect(model.calls()).toBe(1);
  });

  it("a payload for a phone number that belongs to no clinic answers 200 and stores nothing", async () => {
    const raw = JSON.stringify(payload("unknown-number", "wamid-unknown"));
    const response = await receiveWebhook(
      raw,
      sign(raw),
      () => undefined,
      () => ({ llm: fakeLlm().llm, sender: new SimulatorSender() }),
    );
    expect(response.status).toBe(200);
    expect(
      (
        await pool.query(
          "select count(*)::int as n from whatsapp_messages where wa_message_id = 'wamid-unknown'",
        )
      ).rows[0].n,
    ).toBe(0);
  });
});

describe("processInbound and sweepUnprocessed", () => {
  it("sends the agent reply through the sender and marks the message processed", async () => {
    const { phoneNumberId } = await clinicWithNumber();
    const { messageIds } = await ingestPayload(payload(phoneNumberId));
    const sender = new SimulatorSender();
    await processInbound(messageIds[0] as string, { llm: fakeLlm("Respuesta").llm, sender });
    expect(sender.sent).toHaveLength(1);
    expect(sender.sent[0]?.payload).toEqual({ to: "+51987654321", body: "Respuesta" });
    expect(
      (await pool.query("select status from whatsapp_messages where id = $1", [messageIds[0]]))
        .rows[0].status,
    ).toBe("processed");
  });

  it("sends nothing when the conversation is in handoff", async () => {
    const { a, phoneNumberId } = await clinicWithNumber();
    await pool.query(
      "insert into agent_conversations (clinic_id, phone_e164, status) values ($1, '+51987654321', 'handoff')",
      [a.clinicId],
    );
    const { messageIds } = await ingestPayload(payload(phoneNumberId));
    const sender = new SimulatorSender();
    const model = fakeLlm();
    await processInbound(messageIds[0] as string, { llm: model.llm, sender });
    expect(sender.sent).toHaveLength(0);
    expect(model.calls()).toBe(0);
  });

  it("the sweep processes messages that stayed 'received' for more than 60 seconds", async () => {
    const { phoneNumberId } = await clinicWithNumber();
    const { messageIds } = await ingestPayload(payload(phoneNumberId));
    const deps = { llm: fakeLlm().llm, sender: new SimulatorSender() };
    expect(await sweepUnprocessed({ ...deps, at: new Date() })).toBe(0);
    await sweepUnprocessed({ ...deps, at: new Date(Date.now() + 120_000) });
    expect(
      (await pool.query("select status from whatsapp_messages where id = $1", [messageIds[0]]))
        .rows[0].status,
    ).toBe("processed");
  });

  it("POST /api/whatsapp/cron answers 401 without the bearer token", async () => {
    const { POST } = await import("@/app/api/whatsapp/cron/route");
    expect((await POST(new Request("http://x/api/whatsapp/cron", { method: "POST" }))).status).toBe(
      401,
    );
  });
});
