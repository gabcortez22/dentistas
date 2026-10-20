import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { closePool as closeAppPool } from "@/lib/db";
import { SimulatorSender, type WhatsAppSender } from "@/lib/whatsapp/client";
import { executeTool } from "@/server/agent-tools";
import { generateAutoFollowups, sendDueWhatsappFollowups } from "@/server/followups";
import { closePool, createPatientRow, pool, seedClinic } from "./helpers";

afterAll(async () => {
  await closePool();
  await closeAppPool();
});
beforeEach(async () => {
  // earlier tests leave pending tasks around; only this test's rows should be due
  await pool.query("update followup_tasks set status = 'cancelled' where status = 'pending'");
});

const NOW = new Date("2027-06-10T15:00:00Z");
const DAY = 86_400_000;

async function prospect(
  clinicId: string,
  over: { created?: Date; optIn?: boolean; stage?: string; patientId?: string | null } = {},
) {
  const { rows } = await pool.query<{ id: string }>(
    "insert into prospects (clinic_id, name, phone_e164, whatsapp_opt_in, stage, patient_id, created_at) values ($1, 'Lucía', $2, $3, $4, $5, $6) returning id",
    [
      clinicId,
      `+519${String(Math.random()).slice(2, 10)}`,
      over.optIn ?? false,
      over.stage ?? "new",
      over.patientId ?? null,
      over.created ?? new Date(NOW.getTime() - 3 * DAY),
    ],
  );
  return rows[0]?.id as string;
}
const tasks = async (id: string) =>
  (
    await pool.query(
      "select kind, status, auto_key from followup_tasks where prospect_id = $1 order by created_at",
      [id],
    )
  ).rows;

describe("generateAutoFollowups", () => {
  it("creates a task for a stale open prospect and a sent quote older than 3 days, and none on a second run", async () => {
    const a = await seedClinic();
    const stale = await prospect(a.clinicId);
    const fresh = await prospect(a.clinicId, { created: new Date(NOW.getTime() - DAY) });
    const closed = await prospect(a.clinicId, { stage: "won" });
    const patientId = await createPatientRow(a.clinicId);
    const quoted = await prospect(a.clinicId, {
      stage: "quoted",
      patientId,
      created: new Date(NOW.getTime() - DAY),
    });
    await pool.query(
      "insert into quotes (clinic_id, patient_id, number, valid_until, status, created_by, created_at) values ($1, $2, 1, current_date + 30, 'draft', $3, $4)",
      [a.clinicId, patientId, a.dentist.membershipId, new Date(NOW.getTime() - 4 * DAY)],
    );
    await pool.query("update quotes set status = 'sent' where clinic_id = $1", [a.clinicId]);
    const first = await generateAutoFollowups({ now: NOW });
    expect(first).toBeGreaterThanOrEqual(2);
    expect((await tasks(stale)).map((t) => t.auto_key)).toEqual([
      expect.stringMatching(/^contact:/),
    ]);
    expect(await tasks(fresh)).toHaveLength(0);
    expect(await tasks(closed)).toHaveLength(0);
    expect((await tasks(quoted)).map((t) => t.auto_key)).toEqual([
      expect.stringMatching(/^quote:/),
    ]);
    await generateAutoFollowups({ now: NOW });
    expect(await tasks(stale)).toHaveLength(1);
    expect(await tasks(quoted)).toHaveLength(1);
  });
});

describe("sendDueWhatsappFollowups", () => {
  it("sends the template to a consenting prospect, logs the attempt and completes the task", async () => {
    const a = await seedClinic();
    const id = await prospect(a.clinicId, { optIn: true });
    await generateAutoFollowups({ now: NOW });
    const sender = new SimulatorSender();
    const result = await sendDueWhatsappFollowups({ now: NOW, sender });
    expect(result.sent).toBeGreaterThanOrEqual(1);
    const sent = sender.sent.find((s) => (s.payload as { params: string[] }).params[0] === "Lucía");
    expect((sent?.payload as { template: string } | undefined)?.template).toBe(
      "seguimiento_prospecto",
    );
    expect((await tasks(id))[0]?.status).toBe("done");
    const events = await pool.query(
      "select body from prospect_events where prospect_id = $1 and kind = 'contact_attempt'",
      [id],
    );
    expect(events.rowCount).toBe(1);
  });

  it("leaves the task for a person when the prospect has no consent and sends nothing", async () => {
    const a = await seedClinic();
    const id = await prospect(a.clinicId, { optIn: false });
    await generateAutoFollowups({ now: NOW });
    const sender = new SimulatorSender();
    await sendDueWhatsappFollowups({ now: NOW, sender });
    const phone = (await pool.query("select phone_e164 from prospects where id = $1", [id])).rows[0]
      .phone_e164 as string;
    expect(sender.sent.filter((m) => m.to === phone)).toHaveLength(0);
    expect(await tasks(id)).toEqual([
      { kind: "call", status: "pending", auto_key: expect.stringMatching(/^contact:/) },
    ]);
  });

  it("a failing send keeps the task pending", async () => {
    const a = await seedClinic();
    const id = await prospect(a.clinicId, { optIn: true });
    await generateAutoFollowups({ now: NOW });
    const failing: WhatsAppSender = {
      sendTemplate: async () => {
        throw new Error("meta down");
      },
      sendText: async () => ({ id: "x" }),
    };
    const result = await sendDueWhatsappFollowups({ now: NOW, sender: failing });
    expect(result.failed).toBeGreaterThanOrEqual(1);
    expect((await tasks(id))[0]?.status).toBe("pending");
  });
});

describe("capture_prospect", () => {
  const convo = async (patientId: string | null = null) => {
    const a = await seedClinic();
    const phone = `+519${String(Math.random()).slice(2, 10)}`;
    const { rows } = await pool.query<{ id: string }>(
      "insert into agent_conversations (clinic_id, phone_e164, patient_id) values ($1, $2, $3) returning id",
      [a.clinicId, phone, patientId],
    );
    return { a, phone, ctx: { conversationId: rows[0]?.id as string } };
  };

  it("creates a whatsapp prospect with the chat phone, and the same phone twice creates one", async () => {
    const { a, phone, ctx } = await convo();
    const first = await executeTool(ctx, "capture_prospect", {
      name: "Marco",
      interest: "ortodoncia",
    });
    expect(first.isError).toBe(false);
    await executeTool(ctx, "capture_prospect", { name: "Marco", interest: "ortodoncia" });
    const rows = await pool.query(
      "select name, source, interest, phone_e164 from prospects where clinic_id = $1",
      [a.clinicId],
    );
    expect(rows.rows).toEqual([
      { name: "Marco", source: "whatsapp", interest: "ortodoncia", phone_e164: phone },
    ]);
  });

  it("refuses when the chat already has an identified patient", async () => {
    const a = await seedClinic();
    const patientId = await createPatientRow(a.clinicId);
    const { rows } = await pool.query<{ id: string }>(
      "insert into agent_conversations (clinic_id, phone_e164, patient_id) values ($1, '+51999000111', $2) returning id",
      [a.clinicId, patientId],
    );
    const result = await executeTool(
      { conversationId: rows[0]?.id as string },
      "capture_prospect",
      { name: "Marco" },
    );
    expect(result.isError).toBe(true);
    expect(
      (
        await pool.query("select count(*)::int as n from prospects where clinic_id = $1", [
          a.clinicId,
        ])
      ).rows[0].n,
    ).toBe(0);
  });
});

describe("POST /api/prospects/cron", () => {
  it("answers 401 without the bearer token and 200 with it", async () => {
    process.env.CRON_SECRET = "0123456789abcdef-secret";
    const { POST } = await import("@/app/api/prospects/cron/route");
    expect(
      (await POST(new Request("http://x/api/prospects/cron", { method: "POST" }))).status,
    ).toBe(401);
    expect(
      (
        await POST(
          new Request("http://x/api/prospects/cron", {
            method: "POST",
            headers: { authorization: "Bearer wrong-wrong-wrong-wrong" },
          }),
        )
      ).status,
    ).toBe(401);
    const ok = await POST(
      new Request("http://x/api/prospects/cron", {
        method: "POST",
        headers: { authorization: "Bearer 0123456789abcdef-secret" },
      }),
    );
    expect(ok.status).toBe(200);
    expect(await ok.json()).toHaveProperty("prospects");
  });
});
