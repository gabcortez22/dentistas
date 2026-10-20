import { timingSafeEqual } from "node:crypto";
import { getEnv } from "@/lib/env";

/** Returns a 401 response when the bearer token is missing or wrong, otherwise null. */
export function assertCron(request: Request): Response | null {
  const unauthorized = () => Response.json({ error: "unauthorized" }, { status: 401 });
  let secret: string;
  try {
    secret = getEnv("cron").CRON_SECRET;
  } catch {
    return unauthorized();
  }
  const header = request.headers.get("authorization") ?? "";
  const given = Buffer.from(header.startsWith("Bearer ") ? header.slice(7) : "");
  const expected = Buffer.from(secret);
  if (given.length !== expected.length || !timingSafeEqual(given, expected)) return unauthorized();
  return null;
}
