import { assertCron } from "@/app/api/cron/auth";
import { runGoogleSync } from "@/lib/google/sync";

async function handle(request: Request) {
  const denied = assertCron(request);
  if (denied) return denied;
  return Response.json({ google: await runGoogleSync() });
}

export const POST = handle;
export const GET = handle;
