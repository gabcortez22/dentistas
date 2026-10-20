import { assertCron } from "@/app/api/cron/auth";
import { anthropicLlm } from "@/lib/agent/llm";
import { getSender } from "@/lib/whatsapp/client";
import { sweepUnprocessed } from "@/server/inbound";

async function handle(request: Request) {
  const denied = assertCron(request);
  if (denied) return denied;
  let llm: ReturnType<typeof anthropicLlm>;
  try {
    llm = anthropicLlm();
  } catch {
    return Response.json({ error: "agent_not_configured" }, { status: 503 });
  }
  const processed = await sweepUnprocessed({ llm, sender: getSender() });
  return Response.json({ whatsapp: { processed } });
}

export const POST = handle;
export const GET = handle;
