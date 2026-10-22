"use server";

import { redirect } from "next/navigation";
import { anthropicLlm } from "@/lib/agent/llm";
import { getSender } from "@/lib/whatsapp/client";
import { ingestPayload, processInbound } from "@/server/inbound";
import { requireRole, requireSession, userActor } from "@/server/session";
import { ensureSimulatorNumber } from "@/server/simulator";

export async function sendSimulatedAction(formData: FormData) {
  const ctx = await requireSession();
  requireRole(ctx, "admin");
  const phone = String(formData.get("phone") ?? "").replace(/[^\d]/g, "");
  const body = String(formData.get("body") ?? "").trim();
  if (!phone || !body) redirect("/simulador?error=Escribe+un+tel%C3%A9fono+y+un+mensaje.");
  const phoneNumberId = await ensureSimulatorNumber(userActor(ctx));
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
