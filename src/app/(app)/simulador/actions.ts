"use server";

import { redirect } from "next/navigation";
import { anthropicLlm } from "@/lib/agent/llm";
import { withService } from "@/lib/db";
import { getSender } from "@/lib/whatsapp/client";
import { ingestPayload, processInbound } from "@/server/inbound";
import { requireRole, requireSession } from "@/server/session";

export async function sendSimulatedAction(formData: FormData) {
  const ctx = await requireSession();
  requireRole(ctx, "admin");
  const phone = String(formData.get("phone") ?? "").replace(/[^\d]/g, "");
  const body = String(formData.get("body") ?? "").trim();
  if (!phone || !body) redirect("/simulador?error=Escribe+un+tel%C3%A9fono+y+un+mensaje.");
  const phoneNumberId = await withService(async (client) => {
    const id = `SIMULADOR-${ctx.clinicId}`;
    await client.query(
      "update clinics set whatsapp_phone_number_id = coalesce(whatsapp_phone_number_id, $2) where id = $1",
      [ctx.clinicId, id],
    );
    const { rows } = await client.query<{ whatsapp_phone_number_id: string }>(
      "select whatsapp_phone_number_id from clinics where id = $1",
      [ctx.clinicId],
    );
    return rows[0]?.whatsapp_phone_number_id as string;
  });
  const payload = {
    entry: [
      {
        changes: [
          {
            value: {
              metadata: { phone_number_id: phoneNumberId },
              messages: [
                { id: `sim-in-${crypto.randomUUID()}`, from: phone, type: "text", text: { body } },
              ],
            },
          },
        ],
      },
    ],
  };
  const { messageIds } = await ingestPayload(payload);
  let error = "";
  try {
    const deps = { llm: anthropicLlm(), sender: getSender() };
    for (const id of messageIds) await processInbound(id, deps);
  } catch {
    error = "&error=Falta+configurar+ANTHROPIC_API_KEY+para+usar+el+agente.";
  }
  redirect(`/simulador?phone=${phone}${error}`);
}
