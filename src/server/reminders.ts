import { DateTime } from "luxon";
import { withService } from "@/lib/db";
import { getEnv } from "@/lib/env";
import { getSender, type WhatsAppSender } from "@/lib/whatsapp/client";

type Counts = { sent: number; failed: number; skipped: number };
const MAX_ATTEMPTS = 3;

export async function runDueReminders(
  opts: { now?: Date; sender?: WhatsAppSender; limit?: number } = {},
): Promise<Counts> {
  const now = opts.now ?? new Date();
  const sender = opts.sender ?? getSender();
  const cloud = getEnvMode() === "cloud";
  const counts: Counts = { sent: 0, failed: 0, skipped: 0 };
  await withService(async (client) => {
    const due = await client.query(
      `select r.id, r.kind, r.attempts, a.id as appointment_id, a.status, a.starts_at, a.clinic_id,
              p.id as patient_id, p.first_name, p.phone_e164, p.whatsapp_opt_in,
              c.name as clinic_name, c.timezone, c.whatsapp_phone_number_id,
              m.display_name as dentist_name
         from reminders r
         join appointments a on a.id = r.appointment_id
         join patients p on p.id = a.patient_id
         join clinics c on c.id = a.clinic_id
         join memberships m on m.id = a.membership_id
        where r.status = 'pending' and r.due_at <= $1
        order by r.due_at
        limit $2
        for update of r skip locked`,
      [now, opts.limit ?? 50],
    );
    for (const row of due.rows) {
      const skip =
        row.status !== "confirmed" ||
        new Date(row.starts_at) <= now ||
        !row.whatsapp_opt_in ||
        !row.phone_e164 ||
        (cloud && !row.whatsapp_phone_number_id);
      if (skip) {
        await client.query("update reminders set status = 'skipped' where id = $1", [row.id]);
        counts.skipped++;
        continue;
      }
      const local = DateTime.fromJSDate(new Date(row.starts_at), { zone: row.timezone });
      const params = [
        row.first_name,
        row.clinic_name,
        local.toFormat("dd/MM/yyyy"),
        local.toFormat("HH:mm"),
        row.dentist_name,
      ];
      await client.query("savepoint reminder");
      try {
        const sent = await sender.sendTemplate(row.whatsapp_phone_number_id ?? "", {
          to: row.phone_e164,
          template: "recordatorio_cita",
          language: "es",
          params,
        });
        const message = await client.query<{ id: string }>(
          `insert into whatsapp_messages
             (clinic_id, patient_id, direction, wa_message_id, phone_e164, body, template_name, status)
           values ($1, $2, 'out', $3, $4, $5, 'recordatorio_cita', 'sent') returning id`,
          [row.clinic_id, row.patient_id, sent.id, row.phone_e164, params.join(" | ")],
        );
        await client.query(
          "update reminders set status = 'sent', sent_at = $2, message_id = $3 where id = $1",
          [row.id, now, message.rows[0]?.id],
        );
        await client.query("release savepoint reminder");
        counts.sent++;
      } catch (error) {
        await client.query("rollback to savepoint reminder");
        const attempts = (row.attempts as number) + 1;
        const failed = attempts >= MAX_ATTEMPTS;
        await client.query(
          "update reminders set attempts = $2, last_error = $3, status = $4 where id = $1",
          [row.id, attempts, (error as Error).message, failed ? "failed" : "pending"],
        );
        if (failed) counts.failed++;
      }
    }
  });
  return counts;
}

function getEnvMode() {
  return getEnv("whatsapp").WHATSAPP_MODE;
}
