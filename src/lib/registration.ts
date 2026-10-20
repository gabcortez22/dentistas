import { timingSafeEqual } from "node:crypto";
import { getEnv } from "./env";

/** Clinic registration is closed unless REGISTRATION_CODE is set. */
export function isRegistrationOpen(): boolean {
  return getEnv("registration").REGISTRATION_CODE !== undefined;
}

/** True only when registration is open and `code` equals the configured invite code. */
export function isValidInviteCode(code: string): boolean {
  const expected = getEnv("registration").REGISTRATION_CODE;
  if (expected === undefined) return false;
  const a = Buffer.from(code.trim());
  const b = Buffer.from(expected);
  return a.length === b.length && timingSafeEqual(a, b);
}
