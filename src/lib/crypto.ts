import { createCipheriv, createDecipheriv, createHash, createHmac, randomBytes, timingSafeEqual } from "node:crypto";
import { env } from "@/lib/env";

/** 256-bit random token, base64url (used for sessions, resets, API keys). */
export function randomToken(bytes = 32): string {
  return randomBytes(bytes).toString("base64url");
}

/** SHA-256 hex digest — used for storing session / reset / API-key tokens. */
export function sha256(input: string): string {
  return createHash("sha256").update(input).digest("hex");
}

export function hmac(input: string, secret = env().SESSION_SECRET): string {
  return createHmac("sha256", secret).update(input).digest("base64url");
}

export function safeEqual(a: string, b: string): boolean {
  const ba = Buffer.from(a);
  const bb = Buffer.from(b);
  if (ba.length !== bb.length) return false;
  return timingSafeEqual(ba, bb);
}

// ── Field-level encryption (AES-256-GCM) for PAN / Aadhaar / UAN / bank account ──

function key(): Buffer {
  return Buffer.from(env().FIELD_ENCRYPTION_KEY, "hex");
}

export function encryptField(plain: string): string {
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", key(), iv);
  const enc = Buffer.concat([cipher.update(plain, "utf8"), cipher.final()]);
  const tag = cipher.getAuthTag();
  return `v1.${iv.toString("base64url")}.${tag.toString("base64url")}.${enc.toString("base64url")}`;
}

export function decryptField(payload: string | null | undefined): string | null {
  if (!payload) return null;
  const [v, ivB, tagB, encB] = payload.split(".");
  if (v !== "v1" || !ivB || !tagB || !encB) return null;
  const decipher = createDecipheriv("aes-256-gcm", key(), Buffer.from(ivB, "base64url"));
  decipher.setAuthTag(Buffer.from(tagB, "base64url"));
  const dec = Buffer.concat([decipher.update(Buffer.from(encB, "base64url")), decipher.final()]);
  return dec.toString("utf8");
}

/** Mask all but the last `keep` characters: "ABCDE1234F" → "******234F". */
export function mask(value: string | null | undefined, keep = 4): string | null {
  if (!value) return null;
  if (value.length <= keep) return "*".repeat(value.length);
  return "*".repeat(value.length - keep) + value.slice(-keep);
}
