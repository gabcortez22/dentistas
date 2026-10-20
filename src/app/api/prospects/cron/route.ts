import { assertCron } from "@/app/api/cron/auth";
import { generateAutoFollowups, sendDueWhatsappFollowups } from "@/server/followups";

async function handle(request: Request) {
  const denied = assertCron(request);
  if (denied) return denied;
  const created = await generateAutoFollowups();
  const whatsapp = await sendDueWhatsappFollowups();
  return Response.json({ prospects: { created, ...whatsapp } });
}

export const POST = handle;
export const GET = handle;
