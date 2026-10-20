import { NextRequest } from "next/server";
import { afterEach, describe, expect, it } from "vitest";
import { isPublicPath, safeNext } from "@/lib/auth-paths";
import { proxy } from "@/proxy";

describe("isPublicPath", () => {
  it.each([
    "/",
    "/login",
    "/registro",
    "/api/health",
    "/api/whatsapp/webhook",
    "/api/whatsapp/cron",
    "/api/cron/tick",
    "/api/google/cron",
    "/api/prospects/cron",
    "/api/google/oauth/callback",
  ])("%s is public", (path) => expect(isPublicPath(path)).toBe(true));
  it.each([
    "/pacientes",
    "/agenda",
    "/api/availability",
    "/loginx",
    "/api/cronjob",
    "/api/google/oauth/start",
    "/api/whatsappx",
    "/api/prospects",
  ])("%s is private", (path) => expect(isPublicPath(path)).toBe(false));
});

describe("safeNext", () => {
  it("keeps same-site paths and rejects everything else", () => {
    expect(safeNext("/agenda?dia=1")).toBe("/agenda?dia=1");
    expect(safeNext("//evil.com")).toBe("/pacientes");
    expect(safeNext("https://evil.com")).toBe("/pacientes");
    expect(safeNext("/\\evil.com")).toBe("/pacientes");
    expect(safeNext(null)).toBe("/pacientes");
  });
});

describe("proxy without auth configuration", () => {
  const saved = { ...process.env };
  afterEach(() => {
    process.env = { ...saved };
  });

  it("fails closed on private paths and serves public ones", async () => {
    delete process.env.NEXT_PUBLIC_SUPABASE_URL;
    delete process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY;
    expect((await proxy(new NextRequest("http://localhost/pacientes"))).status).toBe(503);
    expect((await proxy(new NextRequest("http://localhost/api/health"))).status).toBe(200);
  });
});
