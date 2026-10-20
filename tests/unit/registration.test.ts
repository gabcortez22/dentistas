import { afterEach, describe, expect, it } from "vitest";
import { isRegistrationOpen, isValidInviteCode } from "@/lib/registration";

const saved = { ...process.env };
afterEach(() => {
  process.env = { ...saved };
});

describe("clinic registration", () => {
  it("is closed and accepts no code when REGISTRATION_CODE is not set", () => {
    delete process.env.REGISTRATION_CODE;
    expect(isRegistrationOpen()).toBe(false);
    expect(isValidInviteCode("")).toBe(false);
    expect(isValidInviteCode("cualquier-cosa-larga")).toBe(false);
  });

  it("opens with a code and accepts only that exact code", () => {
    process.env.REGISTRATION_CODE = "codigo-secreto-123";
    expect(isRegistrationOpen()).toBe(true);
    expect(isValidInviteCode("codigo-secreto-123")).toBe(true);
    expect(isValidInviteCode("  codigo-secreto-123  ")).toBe(true);
    expect(isValidInviteCode("codigo-secreto-124")).toBe(false);
    expect(isValidInviteCode("corto")).toBe(false);
    expect(isValidInviteCode("")).toBe(false);
  });

  it("rejects a code shorter than 12 characters as misconfiguration", () => {
    process.env.REGISTRATION_CODE = "corto";
    expect(() => isRegistrationOpen()).toThrow(/REGISTRATION_CODE/);
  });
});
