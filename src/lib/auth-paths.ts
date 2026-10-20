const PUBLIC_PREFIXES = [
  "/login",
  "/registro",
  "/api/health",
  "/api/whatsapp",
  "/api/cron",
  "/api/google/cron",
  "/api/google/oauth/callback",
];

/** Paths that answer without a session. Webhook and cron routes authenticate themselves (signature / bearer secret). */
export function isPublicPath(pathname: string): boolean {
  if (pathname === "/") return true;
  return PUBLIC_PREFIXES.some((prefix) => pathname === prefix || pathname.startsWith(`${prefix}/`));
}

/** Only same-site absolute paths are valid post-login targets; anything else falls back. */
export function safeNext(next: string | null | undefined, fallback = "/pacientes"): string {
  if (!next?.startsWith("/") || next.startsWith("//") || next.includes("\\")) return fallback;
  return next;
}
