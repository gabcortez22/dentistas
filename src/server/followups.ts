import { withService } from "@/lib/db";
import { getSender, type WhatsAppSender } from "@/lib/whatsapp/client";

const DAY = 86_400_000;
const STALE_PROSPECT_DAYS = 2;
const STALE_QUOTE_DAYS = 3;

/** Idempotent: `auto_key` is unique per prospect, so a task is created once per cause. Returns how many were created. */
export async function generateAutoFollowups(opts: { now?: Date } = {}): Promise<number> {
  const now = opts.now ?? new Date();
  return withService(async (client) => {
    // (a) open prospects with no activity for 2 days: one task per inactivity period
    const stale = await client.query(
      `insert into followup_tasks (clinic_id, prospect_id, due_at, kind, note, assigned_to, auto_key)
       select p.clinic_id, p.id, $1, case when p.whatsapp_opt_in then 'whatsapp' else 'call' end,
              'Contactar al prospecto (sin actividad reciente)', p.assigned_to,
              'contact:' || to_char(act.last_at at time zone 'UTC', 'YYYY-MM-DD')
         from prospects p
         cross join lateral (
           select coalesce(max(e.created_at), p.created_at) as last_at
             from prospect_events e where e.prospect_id = p.id
         ) act
        where p.stage in ('new', 'contacted') and act.last_at < $2
       on conflict (prospect_id, auto_key) do nothing`,
      [now, new Date(now.getTime() - STALE_PROSPECT_DAYS * DAY)],
    );
    // (b) quotes sent more than 3 days ago to a patient that is a quoted prospect
    const quotes = await client.query(
      `insert into followup_tasks (clinic_id, prospect_id, due_at, kind, note, assigned_to, auto_key)
       select p.clinic_id, p.id, $1, case when p.whatsapp_opt_in then 'whatsapp' else 'call' end,
              'Dar seguimiento a la cotización N° ' || lpad(q.number::text, 6, '0'), p.assigned_to,
              'quote:' || q.id::text
         from quotes q join prospects p on p.patient_id = q.patient_id and p.clinic_id = q.clinic_id
        where q.status = 'sent' and q.created_at < $2 and p.stage = 'quoted'
       on conflict (prospect_id, auto_key) do nothing`,
      [now, new Date(now.getTime() - STALE_QUOTE_DAYS * DAY)],
    );
    return (stale.rowCount ?? 0) + (quotes.rowCount ?? 0);
  });
}

type Counts = { sent: number; failed: number };

/** Sends the follow-up template only to prospects with explicit WhatsApp consent; the rest stay for a person. */
export async function sendDueWhatsappFollowups(
  opts: { now?: Date; sender?: WhatsAppSender; limit?: number } = {},
): Promise<Counts> {
  const now = opts.now ?? new Date();
  const sender = opts.sender ?? getSender();
  const counts: Counts = { sent: 0, failed: 0 };
  await withService(async (client) => {
    const due = await client.query(
      `select t.id, t.prospect_id, t.clinic_id, p.name, p.phone_e164, c.name as clinic_name, c.whatsapp_phone_number_id
         from followup_tasks t
         join prospects p on p.id = t.prospect_id
         join clinics c on c.id = t.clinic_id
        where t.status = 'pending' and t.kind = 'whatsapp' and t.due_at <= $1
          and p.whatsapp_opt_in and p.phone_e164 is not null and p.stage in ('new', 'contacted', 'appointment_booked', 'quoted')
        order by t.due_at limit $2
        for update of t skip locked`,
      [now, opts.limit ?? 50],
    );
    for (const row of due.rows) {
      await client.query("savepoint followup");
      try {
        const sent = await sender.sendTemplate(row.whatsapp_phone_number_id ?? "", {
          to: row.phone_e164,
          template: "seguimiento_prospecto",
          language: "es",
          params: [row.name, row.clinic_name],
        });
        await client.query(
          "insert into prospect_events (clinic_id, prospect_id, kind, body) values ($1, $2, 'contact_attempt', $3)",
          [
            row.clinic_id,
            row.prospect_id,
            JSON.stringify({
              channel: "whatsapp",
              template: "seguimiento_prospecto",
              messageId: sent.id,
            }),
          ],
        );
        await client.query(
          "update followup_tasks set status = 'done', done_at = $2 where id = $1",
          [row.id, now],
        );
        await client.query("release savepoint followup");
        counts.sent++;
      } catch {
        await client.query("rollback to savepoint followup");
        counts.failed++;
      }
    }
  });
  return counts;
}
