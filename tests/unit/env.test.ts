import { afterEach, describe, expect, it } from "vitest";
import { getEnv } from "@/lib/env";

const saved = { ...process.env };
afterEach(() => {
  process.env = { ...saved };
});

describe("getEnv", () => {
  it("names the missing variable and the group", () => {
    delete process.env.DATABASE_URL;
    expect(() => getEnv("core")).toThrow(/"core".*DATABASE_URL/);
  });

  it("does not require a later step's variables", () => {
    process.env.DATABASE_URL = "postgres://x";
    expect(getEnv("core").DATABASE_URL).toBe("postgres://x");
  });

  it("defaults WHATSAPP_MODE to simulator and demands tokens only in cloud mode", () => {
    delete process.env.WHATSAPP_MODE;
    expect(getEnv("whatsapp").WHATSAPP_MODE).toBe("simulator");
    process.env.WHATSAPP_MODE = "cloud";
    expect(() => getEnv("whatsapp")).toThrow(/WHATSAPP_ACCESS_TOKEN/);
  });

  it("rejects a TOKEN_ENC_KEY that is not 32 bytes", () => {
    process.env.TOKEN_ENC_KEY = Buffer.from("short").toString("base64");
    expect(() => getEnv("crypto")).toThrow(/TOKEN_ENC_KEY/);
    process.env.TOKEN_ENC_KEY = Buffer.alloc(32, 1).toString("base64");
    expect(getEnv("crypto").TOKEN_ENC_KEY).toHaveLength(44);
  });
});
