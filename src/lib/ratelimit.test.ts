import { describe, expect, it } from "vitest";
import { rateLimit } from "./ratelimit";
import { RateLimitedError } from "./errors";
import { db } from "./db";

describe("rateLimit (DB-backed)", () => {
  it("allows up to the limit then blocks within the window", async () => {
    const key = `test:${Date.now()}`;
    await rateLimit(key, 3, 60);
    await rateLimit(key, 3, 60);
    await rateLimit(key, 3, 60);
    await expect(rateLimit(key, 3, 60)).rejects.toBeInstanceOf(RateLimitedError);
    await db.rateLimit.delete({ where: { key } });
  });
  it("resets after the window expires", async () => {
    const key = `test:${Date.now()}:b`;
    await rateLimit(key, 1, 60);
    await db.rateLimit.update({ where: { key }, data: { resetAt: new Date(Date.now() - 1000) } });
    await expect(rateLimit(key, 1, 60)).resolves.toBeUndefined();
    await db.rateLimit.delete({ where: { key } });
  });
});
