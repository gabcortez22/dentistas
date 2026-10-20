import { runDueReminders } from "@/server/reminders";
import { assertCron } from "../auth";

async function handle(request: Request) {
  const denied = assertCron(request);
  if (denied) return denied;
  const reminders = await runDueReminders();
  return Response.json({ reminders });
}

export const POST = handle;
export const GET = handle;
