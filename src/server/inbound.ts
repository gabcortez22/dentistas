import { createHmac, timingSafeEqual } from "node:crypto";
import { z } from "zod";
import type { LlmClient } from "@/lib/agent/llm";
import { runAgent } from "@/lib/agent/loop";
import { withService } from "@/lib/db";
import { getEnv } from "@/lib/env";
import type { WhatsAppSender } from "@/lib/whatsapp/client";

export function verifySignature(
  rawBody: string,
  header: string | null,
  appSecret: string,
): boolean {
  if (!header?.startsWith("sha256=")) return false;
  const expected = Buffer.from(createHmac("sha256", appSecret).update(rawBody).digest("hex"));
  const given = Buffer.from(header.slice(7));
  return expected.length === given.length && timingSafeEqual(expected, given);
}

const payloadSchema = z.object({
  entry: z.array(
    z.object({
      changes: z.array(
        z.object({
          value: z.object({
            metadata: z.object({ phone_number_id: z.string() }),
            messages: z
              .array(
                z.object({
                  id: z.string(),
                  from: z.string(),
                  type: z.string(),
                  text: z.object({ body: z.string() }).optional(),
                }),
              )
              .optional(),
          }),
        }),
      ),
    }),
  ),
});

export type IngestResult = { messageIds: string[]; ignored: number };

export async function ingestPayload(payload: unknown): Promise<IngestResult> {
  const parsed = payloadSchema.safeParse(payload);
  const result: IngestResult = { messageIds: [], ignored: 0 };
  if (!parsed.success) return result;
  for (const entry of parsed.data.entry) {
    for (const change of entry.changes) {
      for (const message of change.value.messages ?? []) {
        if (message.type !== "text" || !message.text) {
          result.ignored++;
          continue;
        }
        const id = await withService(async (client) => {
          const clinic = await client.query<{ id: string }>(
            "select id from clinics where whatsapp_phone_number_id = $1",
            [change.value.metadata.phone_number_id],
          );
          const clinicId = clinic.rows[0]?.id;
          if (!clinicId) return null;
          const { rows } = await client.query<{ id: string }>(
            `insert into whatsapp_messages (clinic_id, direction, wa_message_id, phone_e164, body, status)
             values ($1, 'in', $2, $3, $4, 'received')
             on conflict (wa_message_id) do nothing returning id`,
            [clinicId, message.id, `+${message.from.replace(/^\+/, "")}`, message.text?.body],
          );
          return rows[0]?.id ?? null;
        });
        if (id) result.messageIds.push(id);
        else result.ignored++;
      }
    }
  }
  return result;
}

type Deps = { llm: LlmClient; sender: WhatsAppSender; now?: () => Date };

export async function processInbound(messageId: string, deps: Deps): Promise<void> {
  // Claim atomically: only one worker moves a message from 'received' to 'queued'.
  const message = await withService(async (client) => {
    const { rows } = await client.query(
      `update whatsapp_messages m set status = 'queued'
         from clinics c
        where m.id = $1 and m.direction = 'in' and m.status = 'received' and c.id = m.clinic_id
        returning m.id, m.clinic_id, m.phone_e164, m.body, c.whatsapp_phone_number_id`,
      [messageId],
    );
    return rows[0] ?? null;
  });
  if (!message) return;
  const finish = (status: "processed" | "failed", error?: string) =>
    withService((client) =>
      client.query("update whatsapp_messages set status = $2, error = $3 where id = $1", [
        messageId,
        status,
        error ?? null,
      ]),
    );
  try {
    const conversationId = await withService(async (client) => {
      const open = await client.query<{ id: string }>(
        "select id from agent_conversations where clinic_id = $1 and phone_e164 = $2 and status in ('active', 'handoff')",
        [message.clinic_id, message.phone_e164],
      );
      if (open.rows[0]) {
        await client.query("update agent_conversations set last_message_at = now() where id = $1", [
          open.rows[0].id,
        ]);
        return open.rows[0].id;
      }
      const created = await client.query<{ id: string }>(
        "insert into agent_conversations (clinic_id, phone_e164) values ($1, $2) returning id",
        [message.clinic_id, message.phone_e164],
      );
      return created.rows[0]?.id as string;
    });
    const reply = await runAgent({ llm: deps.llm, now: deps.now }, conversationId, message.body);
    if (reply !== null) {
      const sent = await deps.sender.sendText(message.whatsapp_phone_number_id ?? "", {
        to: message.phone_e164,
        body: reply,
      });
      await withService((client) =>
        client.query(
          `insert into whatsapp_messages (clinic_id, direction, wa_message_id, phone_e164, body, status)
           values ($1, 'out', $2, $3, $4, 'sent')`,
          [message.clinic_id, sent.id, message.phone_e164, reply],
        ),
      );
    }
    await finish("processed");
  } catch (error) {
    await finish("failed", (error as Error).message);
  }
}

export async function sweepUnprocessed(
  deps: Deps & { now?: () => Date } & { at?: Date },
): Promise<number> {
  const at = deps.at ?? new Date();
  const ids = await withService(async (client) =>
    (
      await client.query<{ id: string }>(
        `select id from whatsapp_messages
        where direction = 'in' and status = 'received' and created_at < $1 order by created_at limit 20`,
        [new Date(at.getTime() - 60_000)],
      )
    ).rows.map((r) => r.id),
  );
  for (const id of ids) await processInbound(id, deps);
  return ids.length;
}

/** Shared by the route and the tests: validate, store, answer 200 right away, process after the response. */
export async function receiveWebhook(
  rawBody: string,
  signatureHeader: string | null,
  schedule: (job: () => Promise<void>) => void,
  makeDeps: () => Deps,
): Promise<Response> {
  const env = getEnv("whatsapp");
  // Fail closed: only Meta signs deliveries, so without cloud mode nothing here can be authenticated.
  // The simulator calls ingestPayload directly and never goes through the webhook.
  if (env.WHATSAPP_MODE !== "cloud") {
    return Response.json({ error: "webhook_disabled" }, { status: 403 });
  }
  if (!verifySignature(rawBody, signatureHeader, env.WHATSAPP_APP_SECRET as string)) {
    return Response.json({ error: "invalid_signature" }, { status: 401 });
  }
  let payload: unknown;
  try {
    payload = JSON.parse(rawBody);
  } catch {
    return Response.json({ error: "invalid_json" }, { status: 400 });
  }
  const { messageIds } = await ingestPayload(payload);
  if (messageIds.length > 0) {
    schedule(async () => {
      try {
        const deps = makeDeps();
        for (const id of messageIds) await processInbound(id, deps);
      } catch {
        // messages stay 'received' and are picked up by the sweep
      }
    });
  }
  return Response.json({ received: messageIds.length });
}
