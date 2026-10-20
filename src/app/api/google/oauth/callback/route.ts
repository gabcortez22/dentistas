import { redirect } from "next/navigation";
import { verifyState } from "@/lib/google/crypto";
import { connectGoogle } from "@/lib/google/sync";
import { getSession, userActor } from "@/server/session";

export async function GET(request: Request) {
  const url = new URL(request.url);
  const ctx = await getSession();
  if (!ctx) redirect("/login");
  try {
    const membershipId = verifyState(url.searchParams.get("state") ?? "");
    if (membershipId !== ctx.membershipId) throw new Error("state belongs to another user");
    const code = url.searchParams.get("code");
    if (!code) throw new Error("missing code");
    await connectGoogle(userActor(ctx), membershipId, code);
  } catch {
    redirect("/configuracion/google?google=error");
  }
  redirect("/configuracion/google?google=ok");
}
