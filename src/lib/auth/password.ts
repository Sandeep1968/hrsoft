import "server-only";
import { hash, verify } from "@node-rs/argon2";

const ARGON_OPTS = { memoryCost: 19456, timeCost: 2, outputLen: 32, parallelism: 1 };

export async function hashPassword(password: string): Promise<string> {
  return hash(password, ARGON_OPTS);
}

export async function verifyPassword(hashed: string, password: string): Promise<boolean> {
  try {
    return await verify(hashed, password, ARGON_OPTS);
  } catch {
    return false;
  }
}

/** Minimum policy: 10+ chars, at least one letter and one number. */
export function passwordPolicyIssue(password: string): string | null {
  if (password.length < 10) return "Password must be at least 10 characters";
  if (!/[a-zA-Z]/.test(password) || !/[0-9]/.test(password)) return "Password must contain letters and numbers";
  if (password.length > 128) return "Password is too long";
  return null;
}
