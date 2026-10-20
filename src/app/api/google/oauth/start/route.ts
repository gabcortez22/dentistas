import { redirect } from "next/navigation";
import { signState } from "@/lib/google/crypto";
import { buildAuthUrl } from "@/lib/google/oauth";
import { getSession } from "@/server/session";

export async function GET() {
  const ctx = await getSession();
  if (!ctx) return Response.json({ error: "unauthorized" }, { status: 401 });
  redirect(buildAuthUrl(signState(ctx.membershipId)));
}
