import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { closePool as closeAppPool } from "@/lib/db";
import { SimulatorSender, type WhatsAppSender } from "@/lib/whatsapp/client";
import { runDueReminders } from "@/server/reminders";
import { closePool, createPatientRow, pool, seedClinic } from "./helpers";

afterAll(async () => {
  await closePool();
  await closeAppPool();
});

const hours = (n: number) => new Date(Date.now() + n * 3_600_000).toISOString();

async function book(opts: { optIn?: boolean; startsInHours?: number } = {}) {
  const a = await seedClinic();
  const patientId = await createPatientRow(a.clinicId);
  await pool.query(
    "update patients set phone_e164 = '+51987654321', whatsapp_opt_in = $2, whatsapp_opt_in_at = case when $2 then now() end where id = $1",
    [patientId, opts.optIn ?? true],
  );
  const start = opts.startsInHours ?? 72;
  const { rows } = await pool.query<{ id: string }>(
    "insert into appointments (clinic_id, patient_id, membership_id, starts_at, ends_at) values ($1, $2, $3, $4, $5) returning id",
    [a.clinicId, patientId, a.dentist.membershipId, hours(start), hours(start + 0.5)],
  );
  return { a, patientId, id: rows[0]?.id as string };
}
// 71 h from now: after both reminders of a 72 h appointment are due (h24 at 48 h, h2 at 70 h), before it starts.
const farFuture = () => new Date(Date.now() + 71 * 3_600_000);
// 9 h from now: after the h2 reminder of a 10 h appointment is due (8 h).
const nearFuture = () => new Date(Date.now() + 9 * 3_600_000);
const statuses = async (id: string) =>
  (
    await pool.query(
      "select kind, status, attempts from reminders where appointment_id = $1 order by kind",
      [id],
    )
  ).rows;

beforeEach(async () => {
  // keep the table small and independent: other tests' pending reminders must not be processed here
  await pool.query("update reminders set status = 'skipped' where status = 'pending'");
});

describe("runDueReminders", () => {
  it("sends the template with 5 parameters and records the message for an opted-in patient", async () => {
    const { id, a } = await book();
    const sender = new SimulatorSender();
    const result = await runDueReminders({ now: farFuture(), sender });
    expect(result.sent).toBe(2);
    expect(sender.sent).toHaveLength(2);
    const first = sender.sent[0]?.payload as { template: string; params: string[]; to: string };
    expect(first.template).toBe("recordatorio_cita");
    expect(first.params).toHaveLength(5);
    expect(first.to).toBe("+51987654321");
    expect((await statuses(id)).every((r) => r.status === "sent")).toBe(true);
    const out = await pool.query(
      "select count(*)::int as n from whatsapp_messages where clinic_id = $1 and direction = 'out'",
      [a.clinicId],
    );
    expect(out.rows[0].n).toBe(2);
  });

  it("skips a patient without opt-in and never calls the sender", async () => {
    const { id } = await book({ optIn: false });
    const sender = new SimulatorSender();
    const result = await runDueReminders({ now: farFuture(), sender });
    expect(result.skipped).toBe(2);
    expect(sender.sent).toHaveLength(0);
    expect((await statuses(id)).every((r) => r.status === "skipped")).toBe(true);
  });

  it("retries up to three attempts, then marks the reminder failed", async () => {
    const { id } = await book({ startsInHours: 10 });
    const failing: WhatsAppSender = {
      sendTemplate: async () => {
        throw new Error("meta down");
      },
      sendText: async () => ({ id: "x" }),
    };
    for (const expected of ["pending", "pending", "failed"]) {
      await runDueReminders({ now: nearFuture(), sender: failing });
      expect((await statuses(id))[0]?.status).toBe(expected);
    }
    const row = await pool.query(
      "select attempts, last_error from reminders where appointment_id = $1",
      [id],
    );
    expect(row.rows[0]).toEqual({ attempts: 3, last_error: "meta down" });
  });

  it("two concurrent runs send each reminder exactly once", async () => {
    await book();
    await book();
    const sender = new SimulatorSender();
    const results = await Promise.all([
      runDueReminders({ now: farFuture(), sender }),
      runDueReminders({ now: farFuture(), sender }),
    ]);
    expect(results.reduce((n, r) => n + r.sent, 0)).toBe(4);
    expect(sender.sent).toHaveLength(4);
  });
});

describe("POST /api/cron/tick", () => {
  it("answers 401 without the bearer token and 200 with it", async () => {
    process.env.CRON_SECRET = "0123456789abcdef-secret";
    const { POST } = await import("@/app/api/cron/tick/route");
    expect((await POST(new Request("http://x/api/cron/tick", { method: "POST" }))).status).toBe(
      401,
    );
    expect(
      (
        await POST(
          new Request("http://x/api/cron/tick", {
            method: "POST",
            headers: { authorization: "Bearer wrong-wrong-wrong-wrong" },
          }),
        )
      ).status,
    ).toBe(401);
    const ok = await POST(
      new Request("http://x/api/cron/tick", {
        method: "POST",
        headers: { authorization: "Bearer 0123456789abcdef-secret" },
      }),
    );
    expect(ok.status).toBe(200);
    expect(await ok.json()).toHaveProperty("reminders");
  });
});
