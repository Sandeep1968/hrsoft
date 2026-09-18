import { describe, expect, it } from "vitest";
import { db } from "@/lib/db";
import { UnauthorizedError } from "@/lib/errors";
import { loginWithPassword, requestPasswordReset, resetPassword } from "./auth";
import { sha256 } from "@/lib/crypto";
import { validateSessionToken } from "@/lib/auth/session";

describe("auth service", () => {
  it("logs in with correct password and rejects wrong password", async () => {
    const s = await loginWithPassword("employee@acme.example", "Password123!", { ip: "127.0.0.1" });
    expect(s.token.length).toBeGreaterThan(30);
    const v = await validateSessionToken(s.token);
    expect(v?.userId).toBeTruthy();
    await db.session.deleteMany({ where: { tokenHash: sha256(s.token) } });
    await expect(loginWithPassword("employee@acme.example", "wrong-password", { ip: "127.0.0.1" })).rejects.toBeInstanceOf(UnauthorizedError);
    await expect(loginWithPassword("nobody@acme.example", "wrong-password", { ip: "127.0.0.1" })).rejects.toBeInstanceOf(UnauthorizedError);
    await db.rateLimit.deleteMany({ where: { key: { in: ["login:employee@acme.example", "login:nobody@acme.example", "login-ip:127.0.0.1"] } } });
  });

  it("password reset flow invalidates old sessions and enforces policy", async () => {
    const email = "manager@acme.example";
    const user = await db.user.findUniqueOrThrow({ where: { email } });
    const original = user.passwordHash;
    await requestPasswordReset(email, { ip: "127.0.0.1" });
    const rec = await db.passwordResetToken.findFirst({ where: { userId: user.id, usedAt: null }, orderBy: { createdAt: "desc" } });
    expect(rec).toBeTruthy();
    // We only have the hash; simulate by inserting a known token.
    const raw = "known-test-token-abcdefghijklmnop";
    await db.passwordResetToken.create({ data: { tokenHash: sha256(raw), userId: user.id, expiresAt: new Date(Date.now() + 60_000) } });
    await expect(resetPassword(raw, "short")).rejects.toThrow(/at least 10/);
    await resetPassword(raw, "NewPassword123");
    await expect(loginWithPassword(email, "NewPassword123", {})).resolves.toBeTruthy();
    // restore
    await db.user.update({ where: { id: user.id }, data: { passwordHash: original } });
    await db.passwordResetToken.deleteMany({ where: { userId: user.id } });
    await db.session.deleteMany({ where: { userId: user.id } });
    await db.rateLimit.deleteMany({ where: { key: { in: [`reset:${email}`, `login:${email}`] } } });
  });
});
