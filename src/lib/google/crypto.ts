import {
  createCipheriv,
  createDecipheriv,
  createHmac,
  randomBytes,
  timingSafeEqual,
} from "node:crypto";
import { getEnv } from "@/lib/env";

const key = () => Buffer.from(getEnv("crypto").TOKEN_ENC_KEY, "base64");
const STATE_LIFETIME_SECONDS = 600;

export function encryptToken(plain: string): string {
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", key(), iv);
  const ciphertext = Buffer.concat([cipher.update(plain, "utf8"), cipher.final()]);
  const tag = cipher.getAuthTag();
  return ["v1", iv.toString("base64"), tag.toString("base64"), ciphertext.toString("base64")].join(
    ":",
  );
}

export function decryptToken(enc: string): string {
  const [version, iv, tag, ciphertext] = enc.split(":");
  if (version !== "v1" || !iv || !tag || !ciphertext) throw new Error("invalid token format");
  const decipher = createDecipheriv("aes-256-gcm", key(), Buffer.from(iv, "base64"));
  decipher.setAuthTag(Buffer.from(tag, "base64"));
  return Buffer.concat([
    decipher.update(Buffer.from(ciphertext, "base64")),
    decipher.final(),
  ]).toString("utf8");
}

const sign = (payload: string) => createHmac("sha256", key()).update(payload).digest("hex");

export function signState(membershipId: string, now: Date = new Date()): string {
  const expires = Math.floor(now.getTime() / 1000) + STATE_LIFETIME_SECONDS;
  const payload = `${membershipId}.${expires}`;
  return `${payload}.${sign(payload)}`;
}

export function verifyState(state: string, now: Date = new Date()): string {
  const parts = state.split(".");
  if (parts.length !== 3) throw new Error("invalid state");
  const [membershipId, expires, signature] = parts as [string, string, string];
  const expected = Buffer.from(sign(`${membershipId}.${expires}`));
  const given = Buffer.from(signature);
  if (expected.length !== given.length || !timingSafeEqual(expected, given)) {
    throw new Error("invalid state signature");
  }
  if (Number(expires) * 1000 < now.getTime()) throw new Error("state expired");
  return membershipId;
}
